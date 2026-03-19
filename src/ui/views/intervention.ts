import type { Intervention } from '../../types';
import { html, escHtml, renderMarkdown } from './shared';

function formatType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getInterventionHtml(intervention: Intervention): string {
  const optionsHtml = intervention.options
    ? intervention.options
        .map(
          (opt) =>
            `<button class="option" data-option="${escHtml(opt)}">${escHtml(opt)}</button>`
        )
        .join('')
    : `<textarea id="answer" placeholder="Your answer..."></textarea>
       <button onclick="submitFreeText()">Submit</button>`;

  return html(`
    <div class="intervention">
      <div class="tag">${formatType(intervention.type)} · difficulty ${intervention.difficultyScore}/5</div>
      <h2>${escHtml(intervention.title)}</h2>
      <div class="body">${renderMarkdown(intervention.body)}</div>
      <div class="options">${optionsHtml}</div>
      <div class="actions">
        <button class="secondary" onclick="postMsg('snooze')">Snooze 10 min</button>
        <button class="secondary" onclick="postMsg('skip')">Skip</button>
      </div>
    </div>
    <script>
      const vscode = acquireVsCodeApi();
      function postMsg(type, payload) { vscode.postMessage({ type, payload }); }
      function submitFreeText() {
        const val = document.getElementById('answer').value.trim();
        if (val) postMsg('answer', { answer: val, score: 0.5 });
      }
      document.querySelectorAll('.option').forEach(function(btn) {
        btn.addEventListener('click', function() {
          postMsg('answer', { answer: btn.dataset.option, score: 1 });
        });
      });
    </script>
  `);
}
