import { html, escHtml, renderMarkdown, renderChips } from './shared';

export interface FeedbackQuestion {
  title: string;
  body: string;
}

export function getFeedbackHtml(
  wasCorrect: boolean,
  explanation: string,
  conceptTags: string[] = [],
  question?: FeedbackQuestion
): string {
  const headline = wasCorrect ? 'Correct.' : 'Not quite.';
  const questionHtml = question
    ? `<div class="feedback-question">
        <p class="hint feedback-question-label">Question</p>
        <p class="feedback-question-title">${escHtml(question.title)}</p>
        <div class="feedback-question-body">${renderMarkdown(question.body)}</div>
      </div>`
    : '';
  return html(`
    <div class="feedback ${wasCorrect ? 'correct' : 'incorrect'}">
      ${questionHtml}
      <div class="feedback-answer">
        <h2>${headline}</h2>
        ${renderChips(conceptTags)}
        <p>${escHtml(explanation)}</p>
      </div>
      <button onclick="postMsg('skip')">Back to coding</button>
    </div>
    <script>
      const vscode = acquireVsCodeApi();
      function postMsg(type) { vscode.postMessage({ type }); }
    </script>
  `);
}
