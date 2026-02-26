import * as vscode from 'vscode';
import { ClaudeCodeAdapter } from './adapters/claudeCode';
import { InterventionEngine } from './engine/interventionEngine';
import { KnowledgeStateStore } from './storage/knowledgeState';
import { VibeLearnPanel } from './ui/panel';
import type { SessionAdapter, TriggerReason } from './types';

let adapter: SessionAdapter | undefined;
let store: KnowledgeStateStore | undefined;
let sessionGapTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspacePath) return;

  // Storage lives in the extension's global storage directory
  store = new KnowledgeStateStore(context.globalStorageUri.fsPath);

  // UI panel
  const panel = new VibeLearnPanel();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VibeLearnPanel.viewType, panel)
  );

  // Bootstrap the trigger loop
  adapter = new ClaudeCodeAdapter(workspacePath);
  setupTriggerLoop(adapter, panel, store, context);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('vibelearn.quizNow', () => {
      triggerIntervention('manual', adapter!, panel, store!);
    }),
    vscode.commands.registerCommand('vibelearn.snooze', () => {
      scheduleSnoozedTrigger(adapter!, panel, store!, 10);
    })
  );

  // Panel snooze/skip wired to commands
  panel.onSnooze(() => {
    scheduleSnoozedTrigger(adapter!, panel, store!, getSetting('sessionGapMinutes', 10));
  });
  panel.onAnswer((answer, score) => {
    // score from MCQ is 1 (correct) or 0 (wrong); free text is scored 0.5 (pending)
    // TODO: for free-text, optionally send to Claude for scoring
    void answer; // will be used for scoring in Phase 2
    const state = store!.getState();
    // Record result for the most-recently-seen concepts (simplified for v1)
    const recentConcepts = Object.keys(state.concepts).slice(-3);
    for (const c of recentConcepts) {
      store!.recordResult(c, score);
    }
  });

  context.subscriptions.push({
    dispose: () => {
      adapter?.dispose();
      store?.dispose();
      clearTimeout(sessionGapTimer);
    },
  });
}

export function deactivate(): void {
  adapter?.dispose();
  store?.dispose();
  clearTimeout(sessionGapTimer);
}

function setupTriggerLoop(
  adapter: SessionAdapter,
  panel: VibeLearnPanel,
  store: KnowledgeStateStore,
  context: vscode.ExtensionContext
): void {
  const promptThreshold = getSetting('promptTriggerCount', 10);

  adapter.onPromptSubmitted((_prompt) => {
    // Reset the session-gap timer on every prompt
    resetSessionGapTimer(adapter, panel, store);

    if (adapter.getPromptCount() % promptThreshold === 0) {
      triggerIntervention('prompt_count', adapter, panel, store);
    }
  });

  // Kick off the initial session-gap timer
  resetSessionGapTimer(adapter, panel, store);
}

function resetSessionGapTimer(
  adapter: SessionAdapter,
  panel: VibeLearnPanel,
  store: KnowledgeStateStore
): void {
  clearTimeout(sessionGapTimer);
  const gapMs = getSetting('sessionGapMinutes', 10) * 60 * 1000;
  sessionGapTimer = setTimeout(() => {
    triggerIntervention('session_gap', adapter, panel, store);
  }, gapMs);
}

function scheduleSnoozedTrigger(
  adapter: SessionAdapter,
  panel: VibeLearnPanel,
  store: KnowledgeStateStore,
  minutes: number
): void {
  clearTimeout(sessionGapTimer);
  sessionGapTimer = setTimeout(() => {
    triggerIntervention('session_gap', adapter, panel, store);
  }, minutes * 60 * 1000);
}

async function triggerIntervention(
  reason: TriggerReason,
  adapter: SessionAdapter,
  panel: VibeLearnPanel,
  store: KnowledgeStateStore
): Promise<void> {
  const apiKey = getSetting<string>('anthropicApiKey', '');
  if (!apiKey) {
    vscode.window.showWarningMessage(
      'VibeLearn: Set your Anthropic API key in settings to enable learning interventions.'
    );
    return;
  }

  const [context, knowledgeState] = await Promise.all([
    adapter.getSessionContext(reason),
    Promise.resolve(store.getState()),
  ]);

  if (context.diffs.length === 0 && context.prompts.length === 0) {
    return; // Nothing to learn from yet
  }

  const engine = new InterventionEngine(apiKey);
  const intervention = await engine.generate(context, knowledgeState);

  panel.showIntervention(intervention);

  // Record concept tags as seen (score will be updated when user answers)
  for (const tag of intervention.conceptTags) {
    knowledgeState.concepts[tag] ??= {
      seenCount: 0,
      lastSeen: new Date().toISOString().split('T')[0],
      avgScore: 0,
      nextReview: new Date().toISOString().split('T')[0],
    };
  }
}

function getSetting<T>(key: string, defaultValue: T): T {
  return vscode.workspace.getConfiguration('vibelearn').get<T>(key, defaultValue);
}
