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

export function getLoadingHtml(message: string): string {
  return html(`
    <div class="idle">
      <p class="hint">${escHtml(message)}</p>
      <div class="spinner"></div>
    </div>
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
           font-size: 0.875rem; margin: 4px 4px 4px 0; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground);
                     color: var(--vscode-button-secondaryForeground); }
  button.option { display: block; width: 100%; text-align: left; margin: 4px 0; }
  button.star { background: none; font-size: 1.5rem; padding: 4px; border: none;
                cursor: pointer; color: var(--vscode-descriptionForeground); }
  button.star.active, button.star:hover { color: #f5a623; }
  textarea { width: 100%; min-height: 80px; box-sizing: border-box; margin-bottom: 8px;
             background: var(--vscode-input-background); color: var(--vscode-input-foreground);
             border: 1px solid var(--vscode-input-border); padding: 6px; font-family: inherit; }
  .actions { margin-top: 16px; border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
             padding-top: 12px; }
  .idle    { text-align: center; padding-top: 32px; }
  .hint    { color: var(--vscode-descriptionForeground); font-size: 0.8rem; }
  .correct   { border-left: 3px solid #4caf50; padding-left: 12px; }
  .incorrect { border-left: 3px solid #f44336; padding-left: 12px; }
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
</style>
</head>
<body>${body}</body>
</html>`;
}
