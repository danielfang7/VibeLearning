import * as vscode from 'vscode';
import type { Intervention } from '../types';

// VS Code sidebar panel — never blocks the editor.
// Shown as a WebviewView in the activity bar.
export class VibeLearnPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'vibelearn.panel';

  private view?: vscode.WebviewView;
  private onSnoozeCallback?: () => void;
  private onSkipCallback?: () => void;
  private onAnswerCallback?: (answer: string, score: number) => void;

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getIdleHtml();

    webviewView.webview.onDidReceiveMessage((msg: { type: string; payload?: unknown }) => {
      switch (msg.type) {
        case 'snooze':
          this.onSnoozeCallback?.();
          break;
        case 'skip':
          this.onSkipCallback?.();
          webviewView.webview.html = this.getIdleHtml();
          break;
        case 'answer':
          // payload: { answer: string, score: number }
          const { answer, score } = msg.payload as { answer: string; score: number };
          this.onAnswerCallback?.(answer, score);
          break;
      }
    });
  }

  showIntervention(intervention: Intervention): void {
    if (!this.view) return;
    this.view.webview.html = this.getInterventionHtml(intervention);
    this.view.show(true);
  }

  showFeedback(wasCorrect: boolean, explanation: string): void {
    if (!this.view) return;
    this.view.webview.html = this.getFeedbackHtml(wasCorrect, explanation);
  }

  onSnooze(cb: () => void): void { this.onSnoozeCallback = cb; }
  onSkip(cb: () => void): void { this.onSkipCallback = cb; }
  onAnswer(cb: (answer: string, score: number) => void): void { this.onAnswerCallback = cb; }

  private getIdleHtml(): string {
    return html(`
      <div class="idle">
        <p>Coding away — VibeLearn is watching. 👀</p>
        <p class="hint">A learning check will appear after every 10 prompts or a 10-min break.</p>
        <button onclick="postMsg('manual')">Quiz Me Now</button>
      </div>
    `);
  }

  private getInterventionHtml(intervention: Intervention): string {
    const optionsHtml = intervention.options
      ? intervention.options
          .map(
            (opt) =>
              `<button class="option" onclick="submitAnswer('${escHtml(opt)}')">${escHtml(opt)}</button>`
          )
          .join('')
      : `<textarea id="answer" placeholder="Your answer..."></textarea>
         <button onclick="submitFreeText()">Submit</button>`;

    return html(`
      <div class="intervention">
        <div class="tag">${formatType(intervention.type)} · difficulty ${intervention.difficultyScore}/5</div>
        <h2>${escHtml(intervention.title)}</h2>
        <p>${escHtml(intervention.body)}</p>
        <div class="options">${optionsHtml}</div>
        <div class="actions">
          <button class="secondary" onclick="postMsg('snooze')">Snooze 10 min</button>
          <button class="secondary" onclick="postMsg('skip')">Skip</button>
        </div>
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        function postMsg(type, payload) { vscode.postMessage({ type, payload }); }
        function submitAnswer(answer) { postMsg('answer', { answer, score: 1 }); }
        function submitFreeText() {
          const val = document.getElementById('answer').value.trim();
          if (val) postMsg('answer', { answer: val, score: 0.5 }); // scored later
        }
      </script>
    `);
  }

  private getFeedbackHtml(wasCorrect: boolean, explanation: string): string {
    return html(`
      <div class="feedback ${wasCorrect ? 'correct' : 'incorrect'}">
        <h2>${wasCorrect ? 'Nice work.' : 'Not quite.'}</h2>
        <p>${escHtml(explanation)}</p>
        <button onclick="postMsg('skip')">Continue coding</button>
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        function postMsg(type) { vscode.postMessage({ type }); }
      </script>
    `);
  }
}

function formatType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function html(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         background: var(--vscode-sideBar-background); padding: 16px; margin: 0; }
  h2   { font-size: 1rem; margin: 0 0 12px; }
  p    { font-size: 0.875rem; line-height: 1.5; margin: 0 0 12px; }
  .tag { font-size: 0.75rem; color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border: none; padding: 6px 12px; cursor: pointer; border-radius: 2px;
           font-size: 0.875rem; margin: 4px 4px 4px 0; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground);
                     color: var(--vscode-button-secondaryForeground); }
  button.option { display: block; width: 100%; text-align: left; margin: 4px 0; }
  textarea { width: 100%; min-height: 80px; box-sizing: border-box; margin-bottom: 8px;
             background: var(--vscode-input-background); color: var(--vscode-input-foreground);
             border: 1px solid var(--vscode-input-border); padding: 6px; font-family: inherit; }
  .actions { margin-top: 16px; border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
             padding-top: 12px; }
  .idle    { text-align: center; padding-top: 32px; }
  .hint    { color: var(--vscode-descriptionForeground); font-size: 0.8rem; }
  .correct   { border-left: 3px solid #4caf50; padding-left: 12px; }
  .incorrect { border-left: 3px solid #f44336; padding-left: 12px; }
</style>
</head>
<body>${body}</body>
</html>`;
}
