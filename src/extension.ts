import * as vscode from 'vscode';
import { ClaudeCodeAdapter } from './adapters/claudeCode';
import { InterventionEngine } from './engine/interventionEngine';
import { KnowledgeStateStore } from './storage/knowledgeState';
import { VibeLearnPanel } from './ui/panel';
import type { Intervention, SessionAdapter, TriggerReason } from './types';

let adapter: SessionAdapter | undefined;
let store: KnowledgeStateStore | undefined;
let sessionGapTimer: NodeJS.Timeout | undefined;
let currentIntervention: Intervention | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // Storage lives in the extension's global storage directory
  store = new KnowledgeStateStore(context.globalStorageUri.fsPath);

  // UI panel — must be registered for the sidebar view to appear
  const panel = new VibeLearnPanel();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VibeLearnPanel.viewType, panel)
  );

  const quizNow = () => {
    if (!adapter) {
      vscode.window.showWarningMessage('VibeLearn: Open a workspace folder to enable quizzes.');
      return;
    }
    triggerIntervention('manual', adapter, panel, store!);
  };

  // Commands — must be registered before any early returns
  context.subscriptions.push(
    vscode.commands.registerCommand('vibelearn.quizNow', quizNow),
    vscode.commands.registerCommand('vibelearn.snooze', () => {
      if (!adapter) return;
      scheduleSnoozedTrigger(adapter, panel, store!, 10);
    })
  );

  panel.onQuizNow(quizNow);

  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspacePath) return;

  // Bootstrap the trigger loop
  adapter = new ClaudeCodeAdapter(workspacePath);
  setupTriggerLoop(adapter, panel, store, context);

  // Panel snooze/skip wired to commands
  panel.onSnooze(() => {
    scheduleSnoozedTrigger(adapter!, panel, store!, getSetting('sessionGapMinutes', 10));
  });
  panel.onAnswer((answer, _webviewScore) => {
    if (!currentIntervention) return;

    let score: number;
    let isCorrect: boolean;

    if (currentIntervention.type === 'concept_check' && currentIntervention.answer) {
      // Compare the submitted answer to the known correct answer
      isCorrect = answer.trim() === currentIntervention.answer.trim();
      score = isCorrect ? 1 : 0;
    } else {
      // Free-text (explain_it_back, micro_reading): pending score until Phase 2 scoring
      score = 0.5;
      isCorrect = true;
    }

    for (const tag of currentIntervention.conceptTags) {
      store!.recordResult(tag, score);
    }

    const explanation =
      !isCorrect && currentIntervention.answer
        ? `The correct answer was: ${currentIntervention.answer}`
        : currentIntervention.body;

    panel.showFeedback(isCorrect, explanation);
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

  const hasContext = context.diffs.length > 0 || context.prompts.length > 0;
  if (!hasContext && reason !== 'manual') {
    // Auto-triggers with no session activity yet — nothing to learn from
    return;
  }
  // Manual trigger with no context: Claude will pick a general coding topic

  const engine = new InterventionEngine(apiKey);
  const intervention = await engine.generate(context, knowledgeState);

  // Advance the session window so the next quiz only sees prompts added after this point
  adapter.markQuizTriggered?.();

  // Store so the answer handler can compare against the correct answer and concept tags
  currentIntervention = intervention;
  panel.showIntervention(intervention);
}

function getSetting<T>(key: string, defaultValue: T): T {
  return vscode.workspace.getConfiguration('vibelearn').get<T>(key, defaultValue);
}
