import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ClaudeCodeAdapter } from './adapters/claudeCode';
import { InterventionEngine, ALL_QUIZ_TYPES, type QuizConfig } from './engine/interventionEngine';
import { KnowledgeStateStore } from './storage/knowledgeState';
import { CodebaseStoryStore } from './storage/codebaseStoryStore';
import { VibeLearnPanel } from './ui/panel';
import { logger } from './logger';
import type { Intervention, InterventionType, SessionAdapter, TriggerReason } from './types';

let adapter: SessionAdapter | undefined;
let store: KnowledgeStateStore | undefined;
let storyStore: CodebaseStoryStore | undefined;
let sessionGapTimer: NodeJS.Timeout | undefined;
let currentIntervention: Intervention | undefined;
let isGenerating = false; // concurrency guard — prevents overlapping API calls
let statusBarItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext): void {
  store = new KnowledgeStateStore(context.globalStorageUri.fsPath);

  const panel = new VibeLearnPanel();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VibeLearnPanel.viewType, panel)
  );

  // Status bar item — shows prompt count and provides quick access
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'vibelearn.quizNow';
  statusBarItem.tooltip = 'VibeLearn — click to quiz yourself now';
  statusBarItem.text = '$(zap) 0/10';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const quizNow = () => {
    if (!adapter) {
      vscode.window.showWarningMessage('VibeLearn: Open a workspace folder to enable quizzes.');
      return;
    }
    triggerIntervention('manual', adapter, panel, store!, storyStore);
  };

  const explainCodebase = () => {
    if (!adapter) {
      vscode.window.showWarningMessage('VibeLearn: Open a workspace folder to use this feature.');
      return;
    }
    runExplainCodebase(adapter, panel, store!);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('vibelearn.quizNow', quizNow),
    vscode.commands.registerCommand('vibelearn.explainCodebase', explainCodebase),
    vscode.commands.registerCommand('vibelearn.snooze', () => {
      if (!adapter) return;
      scheduleSnoozedTrigger(adapter, panel, store!, storyStore, getSetting('sessionGapMinutes', 10));
    })
  );

  panel.onQuizNow(quizNow);
  panel.onExplainCodebase(explainCodebase);
  panel.onSnooze(() => {
    scheduleSnoozedTrigger(adapter!, panel, store!, storyStore, getSetting('sessionGapMinutes', 10));
  });
  panel.onAnswer((answer, _webviewScore) => {
    if (!currentIntervention) return;

    let score: number;
    let isCorrect: boolean;

    const isGraded = (currentIntervention.type === 'concept_check' || currentIntervention.type === 'spot_the_bug')
      && currentIntervention.answer;
    if (isGraded) {
      isCorrect = answer.trim() === currentIntervention.answer!.trim();
      score = isCorrect ? 1 : 0;
    } else {
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

    panel.showFeedback(isCorrect, explanation, currentIntervention.conceptTags);

    // Update last concept in idle view
    updatePanelLastConcept(panel, store!);
  });
  panel.onRate((stars, conceptTags) => {
    store!.recordRating(stars, conceptTags);
    logger.log(`Debrief rated ${stars}/5 for concepts: ${conceptTags.join(', ')}`);
  });
  panel.onOpenStory(() => {
    if (!storyStore) return;
    panel.showStory(storyStore.getAllEntries());
  });

  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspacePath) return;

  adapter = new ClaudeCodeAdapter(workspacePath);
  storyStore = new CodebaseStoryStore(workspacePath);
  panel.setStoryEntryCount(storyStore.getAllEntries().length);
  updatePanelLastConcept(panel, store);

  setupTriggerLoop(adapter, panel, store, storyStore, context);

  context.subscriptions.push({
    dispose: () => {
      adapter?.dispose();
      store?.dispose();
      clearTimeout(sessionGapTimer);
      logger.dispose();
    },
  });
}

export function deactivate(): void {
  adapter?.dispose();
  store?.dispose();
  statusBarItem?.dispose();
  clearTimeout(sessionGapTimer);
  logger.dispose();
}

// ── Trigger loop ─────────────────────────────────────────────────────────────

function setupTriggerLoop(
  adapter: SessionAdapter,
  panel: VibeLearnPanel,
  store: KnowledgeStateStore,
  storyStore: CodebaseStoryStore,
  context: vscode.ExtensionContext
): void {
  const promptThreshold = getSetting('promptTriggerCount', 10);

  adapter.onPromptSubmitted((_prompt) => {
    resetSessionGapTimer(adapter, panel, store, storyStore);
    const count = adapter.getPromptCount();
    updateStatusBar(count, promptThreshold);
    panel.setPromptCount(count, promptThreshold);
    if (count % promptThreshold === 0) {
      triggerIntervention('prompt_count', adapter, panel, store, storyStore);
    }
  });

  // Set initial counts
  const initialCount = adapter.getPromptCount();
  updateStatusBar(initialCount, promptThreshold);
  panel.setPromptCount(initialCount, promptThreshold);

  resetSessionGapTimer(adapter, panel, store, storyStore);
}

function updateStatusBar(count: number, threshold: number): void {
  if (statusBarItem) {
    statusBarItem.text = `$(zap) ${count % threshold || (count > 0 ? threshold : 0)}/${threshold}`;
  }
}

function resetSessionGapTimer(
  adapter: SessionAdapter,
  panel: VibeLearnPanel,
  store: KnowledgeStateStore,
  storyStore: CodebaseStoryStore | undefined
): void {
  clearTimeout(sessionGapTimer);
  const gapMs = getSetting('sessionGapMinutes', 10) * 60 * 1000;
  sessionGapTimer = setTimeout(() => {
    triggerIntervention('session_gap', adapter, panel, store, storyStore);
  }, gapMs);
}

function scheduleSnoozedTrigger(
  adapter: SessionAdapter,
  panel: VibeLearnPanel,
  store: KnowledgeStateStore,
  storyStore: CodebaseStoryStore | undefined,
  minutes: number
): void {
  clearTimeout(sessionGapTimer);
  sessionGapTimer = setTimeout(() => {
    triggerIntervention('session_gap', adapter, panel, store, storyStore);
  }, minutes * 60 * 1000);
}

// ── Core trigger ─────────────────────────────────────────────────────────────

async function triggerIntervention(
  reason: TriggerReason,
  adapter: SessionAdapter,
  panel: VibeLearnPanel,
  store: KnowledgeStateStore,
  storyStore: CodebaseStoryStore | undefined
): Promise<void> {
  if (isGenerating) {
    logger.warn(`triggerIntervention(${reason}): skipped — another generation is in flight`);
    return;
  }

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
    logger.log(`triggerIntervention(${reason}): skipped — no session activity yet`);
    return;
  }

  isGenerating = true;
  logger.log(`triggerIntervention(${reason}): starting generation`);

  try {
    const engine = new InterventionEngine(apiKey);
    const mode = getInterventionMode(reason);
    let intervention: Intervention;

    if (mode === 'debrief') {
      const priorStory = storyStore?.getRecentEntries(3) ?? [];
      intervention = await engine.generateDebrief(context, priorStory);

      // Persist to codebase story
      if (storyStore) {
        try {
          const isFirst = storyStore.append({
            timestamp: new Date().toISOString(),
            title: intervention.title,
            summary: intervention.body,
            conceptTags: intervention.conceptTags,
          });
          panel.setStoryEntryCount(storyStore.getAllEntries().length);
          logger.log(`Debrief appended to codebase story (firstWrite=${isFirst})`);

          if (isFirst) {
            offerGitignoreUpdate(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
          }
        } catch (err) {
          logger.error('Failed to append to codebase story', err);
          vscode.window.showWarningMessage('VibeLearn: Could not save to codebase story.');
        }
      }

      // If the panel isn't visible, notify so the user can open it
      panel.showDebrief(intervention);
      if (!isPanelVisible()) {
        vscode.window.showInformationMessage(
          'VibeLearn: Your session debrief is ready →',
          'Open'
        ).then((selection) => {
          if (selection === 'Open') {
            vscode.commands.executeCommand('vibelearn.panel.focus');
          }
        });
      }
    } else {
      const quizConfig: QuizConfig = {
        enabledTypes: getSetting<InterventionType[]>('enabledInterventionTypes', ALL_QUIZ_TYPES as InterventionType[]),
        minDifficulty: getSetting<number>('minDifficulty', 1),
        maxDifficulty: getSetting<number>('maxDifficulty', 5),
      };
      intervention = await engine.generateQuiz(context, knowledgeState, quizConfig);
      adapter.markQuizTriggered?.();
      currentIntervention = intervention;
      panel.showIntervention(intervention);
    }

    logger.log(`triggerIntervention(${reason}): completed — type=${intervention.type}`);
  } catch (err) {
    logger.error(`triggerIntervention(${reason}): generation failed`, err);
    const errMsg = err instanceof Error ? err.message : String(err);
    const friendly = errMsg.includes('401') || errMsg.includes('invalid')
      ? 'API key invalid or expired. Check your settings.'
      : errMsg.includes('429') || errMsg.includes('rate')
        ? 'Rate limit reached. Try again in a moment.'
        : 'Check your API key and internet connection.';
    panel.showError(friendly, () => {
      triggerIntervention(reason, adapter, panel, store, storyStore);
    });
  } finally {
    isGenerating = false;
  }
}

async function runExplainCodebase(
  adapter: SessionAdapter,
  panel: VibeLearnPanel,
  store: KnowledgeStateStore
): Promise<void> {
  if (isGenerating) {
    vscode.window.showInformationMessage('VibeLearn: A generation is already in progress.');
    return;
  }

  const apiKey = getSetting<string>('anthropicApiKey', '');
  if (!apiKey) {
    vscode.window.showWarningMessage(
      'VibeLearn: Set your Anthropic API key in settings.'
    );
    return;
  }

  isGenerating = true;
  panel.showLoading('Analyzing your codebase...');
  logger.log('explainCodebase: starting');

  try {
    const context = await adapter.getSessionContext('manual');
    const fileStructure = adapter.getFileStructure?.() ?? [];
    const engine = new InterventionEngine(apiKey);
    const intervention = await engine.generateExplain(context, fileStructure);
    panel.showExplain(intervention);
    logger.log('explainCodebase: completed');
  } catch (err) {
    logger.error('explainCodebase: failed', err);
    panel.showError('Could not analyze the codebase. Check your API key and connection.', () => {
      runExplainCodebase(adapter, panel, store);
    });
  } finally {
    isGenerating = false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Routes a trigger reason to an intervention mode.
 *   session_gap  → debrief  (natural pause = time to reflect on architecture)
 *   prompt_count → quiz     (active coding = time to test a concept)
 *   manual       → quiz     (explicit user request defaults to quiz)
 */
export function getInterventionMode(reason: TriggerReason): 'quiz' | 'debrief' {
  return reason === 'session_gap' ? 'debrief' : 'quiz';
}

function isPanelVisible(): boolean {
  // Heuristic: if showDebrief set pending content, panel was not visible
  // The actual visibility check is handled by panel.ts via the pending queue
  return true; // optimistic — the notification is a safety net
}

function offerGitignoreUpdate(workspacePath: string | undefined): void {
  if (!workspacePath) return;

  const gitignorePath = path.join(workspacePath, '.gitignore');
  try {
    const content = fs.existsSync(gitignorePath)
      ? fs.readFileSync(gitignorePath, 'utf-8')
      : '';
    if (content.includes('.vibelearn')) return; // already ignored
  } catch {
    return;
  }

  vscode.window.showInformationMessage(
    'VibeLearn: .vibelearn/ is not in your .gitignore — add it to keep your learning history local.',
    'Add to .gitignore'
  ).then((selection) => {
    if (selection !== 'Add to .gitignore') return;
    try {
      const sep = fs.existsSync(gitignorePath)
        ? (fs.readFileSync(gitignorePath, 'utf-8').endsWith('\n') ? '' : '\n')
        : '';
      fs.appendFileSync(gitignorePath, `${sep}# VibeLearn local learning data\n.vibelearn/\n`, 'utf-8');
      logger.log('.vibelearn/ added to .gitignore');
    } catch (err) {
      logger.error('Failed to update .gitignore', err);
    }
  });
}

function getSetting<T>(key: string, defaultValue: T): T {
  return vscode.workspace.getConfiguration('vibelearn').get<T>(key, defaultValue);
}

function updatePanelLastConcept(panel: VibeLearnPanel, store: KnowledgeStateStore): void {
  const concepts = store.getState().concepts;
  const entries = Object.entries(concepts);
  if (entries.length === 0) return;
  const [tag, record] = entries.sort((a, b) => b[1].lastSeen.localeCompare(a[1].lastSeen))[0];
  panel.setLastConcept(tag, record.lastSeen, record.avgScore);
}
