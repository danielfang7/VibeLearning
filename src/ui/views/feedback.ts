import { html, escHtml, renderChips } from './shared';

export function getFeedbackHtml(
  wasCorrect: boolean,
  explanation: string,
  conceptTags: string[] = []
): string {
  const headline = wasCorrect ? 'Correct.' : 'Not quite.';
  return html(`
    <div class="feedback ${wasCorrect ? 'correct' : 'incorrect'}">
      <h2>${headline}</h2>
      ${renderChips(conceptTags)}
      <p>${escHtml(explanation)}</p>
      <button onclick="postMsg('skip')">Back to coding</button>
    </div>
    <script>
      const vscode = acquireVsCodeApi();
      function postMsg(type) { vscode.postMessage({ type }); }
    </script>
  `);
}
