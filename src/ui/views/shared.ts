/** Shared HTML utilities used by all view modules. */

export function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Minimal markdown → HTML: code fences, bold, line breaks. */
export function renderMarkdown(raw: string): string {
  // Split on fenced code blocks first to avoid escaping code content incorrectly
  const parts = raw.split(/(```[\w]*\n[\s\S]*?```)/g);
  return parts.map((part) => {
    if (part.startsWith('```')) {
      const code = part.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
      return `<pre><code>${escHtml(code)}</code></pre>`;
    }
    return escHtml(part)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }).join('');
}

export function renderChips(tags: string[]): string {
  if (tags.length === 0) return '';
  const items = tags.map((t) => `<span class="chip">${escHtml(t)}</span>`).join('');
  return `<div class="chips" aria-label="Concepts: ${escHtml(tags.join(', '))}">${items}</div>`;
}

export function getLoadingHtml(message: string): string {
  return html(`
    <div class="idle">
      <p class="hint">${escHtml(message)}</p>
      <div class="spinner"></div>
    </div>
  `);
}

export function getSetupHtml(): string {
  return html(`
    <div class="setup-screen">
      <div class="setup-icon">⚡</div>
      <h2>Welcome to VibeLearn</h2>
      <p>One quiz every 10 prompts.<br>Learn while you build.</p>
      <p class="hint">Add your Anthropic API key to get started.</p>
      <button onclick="postMsg('openSettings')" style="width: 100%; margin-top: 8px;">Open Settings</button>
      <p class="hint" style="margin-top: 16px;">
        Need a key? Visit<br>
        <strong>console.anthropic.com</strong>
      </p>
    </div>
    <script>
      const vscode = acquireVsCodeApi();
      function postMsg(type) { vscode.postMessage({ type }); }
    </script>
  `);
}

export function getErrorHtml(message: string, canRetry = true): string {
  const retryBtn = canRetry
    ? `<button onclick="postMsg('retry')" style="margin-right: 8px;">Try Again</button>`
    : '';
  return html(`
    <div class="error-screen">
      <h2>Couldn't reach Claude</h2>
      <p class="hint">${escHtml(message)}</p>
      <div style="margin-top: 16px;">
        ${retryBtn}
        <button class="secondary" onclick="postMsg('openSettings')">Settings</button>
      </div>
      <button class="secondary" onclick="postMsg('skip')" style="margin-top: 8px; width: 100%;">Dismiss</button>
    </div>
    <script>
      const vscode = acquireVsCodeApi();
      function postMsg(type) { vscode.postMessage({ type }); }
    </script>
  `);
}

export function html(body: string): string {
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
  .narrative p { font-size: 1rem; line-height: 1.6; }
  .tag { font-size: 0.75rem; color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border: none; padding: 6px 12px; cursor: pointer; border-radius: 2px;
           font-size: 0.875rem; margin: 4px 4px 4px 0;
           transition: background 0.1s, outline 0.1s; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  button.secondary { background: var(--vscode-button-secondaryBackground);
                     color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground)); }
  button.option { display: block; width: 100%; text-align: left; margin: 4px 0; }
  button.option:disabled { cursor: default; opacity: 0.75; }
  button.option.opt-correct { outline: 2px solid var(--vscode-charts-green, #4caf50); outline-offset: -1px; opacity: 1 !important; }
  button.option.opt-wrong   { outline: 2px solid var(--vscode-charts-red, #f44336); outline-offset: -1px; }
  button.star { background: none; font-size: 1.5rem; padding: 8px; border: none;
                cursor: pointer; color: var(--vscode-descriptionForeground);
                min-width: 40px; min-height: 44px; }
  button.star.active, button.star:hover { color: #f5a623; }
  textarea { width: 100%; min-height: 80px; box-sizing: border-box; margin-bottom: 8px;
             background: var(--vscode-input-background); color: var(--vscode-input-foreground);
             border: 1px solid var(--vscode-input-border); padding: 6px; font-family: inherit;
             border-radius: 2px; }
  textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
  .actions { margin-top: 16px; border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
             padding-top: 12px; }
  .idle    { text-align: center; padding-top: 32px; }
  .hint    { color: var(--vscode-descriptionForeground); font-size: 0.8rem; }
  .correct   { border-left: 3px solid var(--vscode-charts-green, #4caf50); padding-left: 12px; }
  .incorrect { border-left: 3px solid var(--vscode-charts-red, #f44336); padding-left: 12px; }
  .spinner { width: 20px; height: 20px; border: 2px solid var(--vscode-descriptionForeground);
             border-top-color: transparent; border-radius: 50%; margin: 12px auto;
             animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .story-entry { margin-bottom: 16px; padding-bottom: 16px;
                 border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border); }
  .story-entry:last-child { border-bottom: none; }
  .story-date { font-size: 0.75rem; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
  strong { color: var(--vscode-foreground); }
  .section-body { font-size: 0.875rem; line-height: 1.6; margin: 0 0 12px; }
  pre  { background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
         border: 1px solid var(--vscode-editorWidget-border, transparent);
         border-radius: 4px; padding: 10px 12px; overflow-x: auto; margin: 0 0 12px; }
  code { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.8rem;
         white-space: pre; }
  /* Concept chips */
  .chips { margin: 8px 0 12px; display: flex; flex-wrap: wrap; gap: 4px; }
  .chip  { display: inline-block; font-size: 0.7rem; padding: 2px 7px; border-radius: 10px;
           background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  /* Progress block (idle view) */
  .progress-block { margin-bottom: 20px; }
  .progress-dots  { font-size: 1rem; letter-spacing: 3px; color: var(--vscode-button-background);
                    margin-bottom: 4px; }
  /* Last concept (idle view) */
  .last-concept { margin-bottom: 16px; padding: 10px 12px;
                  background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
                  border-radius: 3px; text-align: left; }
  .last-concept strong { display: block; font-size: 0.875rem; margin: 2px 0; }
  /* Setup / error screens */
  .setup-screen, .error-screen { text-align: center; padding-top: 24px; }
  .setup-icon { font-size: 2rem; margin-bottom: 12px; }
  /* Diff difficulty dots */
  .diff-dots { letter-spacing: 2px; }
  .diff-dots .dot-filled  { color: var(--vscode-button-background); }
  .diff-dots .dot-empty   { color: var(--vscode-descriptionForeground); }
  /* aria-live region */
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden;
             clip: rect(0,0,0,0); white-space: nowrap; }
  /* Feedback question recap */
  .feedback-question { margin-bottom: 16px; padding: 10px 12px;
                       background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
                       border-radius: 3px; opacity: 0.8; }
  .feedback-question-label { margin: 0 0 4px; }
  .feedback-question-title { font-size: 0.875rem; font-weight: 600; margin: 0 0 4px; }
  .feedback-question-body  { font-size: 0.8rem; color: var(--vscode-descriptionForeground);
                              margin: 0; line-height: 1.5; }
  .feedback-question-body pre { font-size: 0.75rem; margin: 6px 0 0; }
  .feedback-answer h2 { margin-top: 0; }
</style>
</head>
<body>${body}</body>
</html>`;
}
