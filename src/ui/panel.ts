import * as vscode from 'vscode';
import type { CodebaseStoryEntry, Intervention, PatternInsight } from '../types';
import { getIdleHtml, type LastConcept } from './views/idle';
import { getInterventionHtml } from './views/intervention';
import { getDebriefHtml } from './views/debrief';
import { getRatingHtml } from './views/rating';
import { getStoryHtml } from './views/story';
import { getExplainHtml } from './views/explain';
import { getFeedbackHtml, type FeedbackQuestion } from './views/feedback';
import { getLoadingHtml, getSetupHtml, getErrorHtml } from './views/shared';

// Pending debrief/explain queued while the panel was not visible.
type PendingContent =
  | { kind: 'debrief'; intervention: Intervention }
  | { kind: 'explain'; intervention: Intervention };

export class VibeLearnPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'vibelearn.panel';

  private view?: vscode.WebviewView;
  private pending?: PendingContent;

  // Current debrief's concept tags — used when transitioning to the rating view
  private currentConceptTags: string[] = [];

  // Story entry count for the idle view hint
  private storyEntryCount = 0;

  // Session progress for the idle view progress bar
  private promptCount = 0;
  private promptThreshold = 10;

  // Last reinforced concept for the idle view
  private lastConcept?: LastConcept;

  // Architecture Literacy Score for the idle view (null = no data yet)
  private archScore: number | null = null;

  // Cross-session pattern insights for the idle view
  private patternInsights: PatternInsight[] = [];

  // Retry callback for the error view
  private retryCallback?: () => void;

  // Callbacks registered by extension.ts
  private onQuizNowCallback?: () => void;
  private onSnoozeCallback?: () => void;
  private onAnswerCallback?: (answer: string, score: number) => void;
  private onRateCallback?: (stars: number, conceptTags: string[]) => void;
  private onExplainCodebaseCallback?: () => void;
  private onOpenStoryCallback?: () => void;
  private onSkipCallback?: () => void;

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };

    // Show setup screen if no API key is configured
    const apiKey = vscode.workspace.getConfiguration('vibelearn').get<string>('anthropicApiKey', '');
    if (!apiKey && !this.pending) {
      webviewView.webview.html = getSetupHtml();
    } else if (this.pending) {
      // Flush any content that was queued while the panel was hidden
      const p = this.pending;
      this.pending = undefined;
      if (p.kind === 'debrief') {
        this.showDebrief(p.intervention);
      } else {
        this.showExplain(p.intervention);
      }
    } else {
      webviewView.webview.html = this.idleHtml();
    }

    // Auto-update when API key is added in settings
    const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('vibelearn.anthropicApiKey') && this.view) {
        const key = vscode.workspace.getConfiguration('vibelearn').get<string>('anthropicApiKey', '');
        if (key) {
          this.view.webview.html = this.idleHtml();
        }
      }
    });
    webviewView.onDidDispose(() => configListener.dispose());

    webviewView.webview.onDidReceiveMessage((msg: { type: string; payload?: unknown }) => {
      switch (msg.type) {
        case 'quizNow':
          this.onQuizNowCallback?.();
          break;
        case 'explainCodebase':
          this.onExplainCodebaseCallback?.();
          break;
        case 'snooze':
          this.onSnoozeCallback?.();
          break;
        case 'skip':
          this.onSkipCallback?.();
          webviewView.webview.html = this.idleHtml();
          break;
        case 'skipRating':
          webviewView.webview.html = this.idleHtml();
          break;
        case 'openSettings':
          vscode.commands.executeCommand('workbench.action.openSettings', 'vibelearn.anthropicApiKey');
          break;
        case 'retry':
          if (this.retryCallback) {
            const cb = this.retryCallback;
            this.retryCallback = undefined;
            cb();
          } else {
            webviewView.webview.html = this.idleHtml();
          }
          break;
        case 'answer': {
          const { answer, score } = msg.payload as { answer: string; score: number };
          this.onAnswerCallback?.(answer, score);
          break;
        }
        case 'continueDebrief': {
          const tags = msg.payload as string[] | undefined;
          if (tags) this.currentConceptTags = tags;
          webviewView.webview.html = getRatingHtml(this.currentConceptTags);
          break;
        }
        case 'rate': {
          const { stars, conceptTags } = msg.payload as { stars: number; conceptTags: string[] };
          this.onRateCallback?.(stars, conceptTags);
          this.currentConceptTags = [];
          webviewView.webview.html = this.idleHtml();
          break;
        }
        case 'openStory':
          this.onOpenStoryCallback?.();
          break;
      }
    });
  }

  // ── Show methods ────────────────────────────────────────────────────────────

  showIntervention(intervention: Intervention): void {
    if (!this.view) return;
    this.view.webview.html = getInterventionHtml(intervention);
    this.view.show(true);
  }

  showDebrief(intervention: Intervention): void {
    this.currentConceptTags = intervention.conceptTags;
    if (!this.view) {
      this.pending = { kind: 'debrief', intervention };
      return;
    }
    this.view.webview.html = getDebriefHtml(intervention);
    this.view.show(true);
  }

  showExplain(intervention: Intervention): void {
    if (!this.view) {
      this.pending = { kind: 'explain', intervention };
      return;
    }
    this.view.webview.html = getExplainHtml(intervention);
    this.view.show(true);
  }

  showStory(entries: CodebaseStoryEntry[]): void {
    if (!this.view) return;
    this.view.webview.html = getStoryHtml(entries);
    this.view.show(true);
  }

  showFeedback(wasCorrect: boolean, explanation: string, conceptTags: string[] = [], question?: FeedbackQuestion): void {
    if (!this.view) return;
    this.view.webview.html = getFeedbackHtml(wasCorrect, explanation, conceptTags, question);
  }

  showLoading(message: string): void {
    if (!this.view) return;
    this.view.webview.html = getLoadingHtml(message);
    this.view.show(true);
  }

  showSetup(): void {
    if (!this.view) return;
    this.view.webview.html = getSetupHtml();
  }

  showError(message: string, retryCallback?: () => void): void {
    if (!this.view) return;
    this.retryCallback = retryCallback;
    this.view.webview.html = getErrorHtml(message, Boolean(retryCallback));
  }

  showIdle(): void {
    if (!this.view) return;
    this.view.webview.html = this.idleHtml();
  }

  // ── State setters ────────────────────────────────────────────────────────────

  setStoryEntryCount(count: number): void {
    this.storyEntryCount = count;
  }

  setPromptCount(count: number, threshold: number): void {
    this.promptCount = count;
    this.promptThreshold = threshold;
  }

  setLastConcept(tag: string, lastSeen: string, avgScore: number): void {
    this.lastConcept = { tag, lastSeen, avgScore };
  }

  setArchScore(score: number | null): void {
    this.archScore = score;
  }

  setPatternInsights(insights: PatternInsight[]): void {
    this.patternInsights = insights;
  }

  // ── Callback registration ───────────────────────────────────────────────────

  onQuizNow(cb: () => void): void { this.onQuizNowCallback = cb; }
  onSnooze(cb: () => void): void { this.onSnoozeCallback = cb; }
  onAnswer(cb: (answer: string, score: number) => void): void { this.onAnswerCallback = cb; }
  onRate(cb: (stars: number, conceptTags: string[]) => void): void { this.onRateCallback = cb; }
  onExplainCodebase(cb: () => void): void { this.onExplainCodebaseCallback = cb; }
  onOpenStory(cb: () => void): void { this.onOpenStoryCallback = cb; }
  onSkip(cb: () => void): void { this.onSkipCallback = cb; }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private idleHtml(): string {
    return getIdleHtml(
      this.storyEntryCount,
      this.promptCount,
      this.promptThreshold,
      this.lastConcept,
      this.archScore,
      this.patternInsights
    );
  }
}
