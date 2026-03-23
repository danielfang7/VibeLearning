import type { Intervention } from '../../types';
import { html, escHtml, renderMarkdown, renderChips } from './shared';

function formatType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderDifficultyDots(score: number): string {
  return Array.from(
    { length: 5 },
    (_, i) =>
      `<span class="dot-${i < score ? 'filled' : 'empty'}">●</span>`
  ).join('');
}

export function getInterventionHtml(intervention: Intervention): string {
  const isMcq = Boolean(intervention.options && intervention.options.length > 0);
  const correctAnswerAttr = intervention.answer
    ? ` data-correct-answer="${escHtml(intervention.answer)}"`
    : '';

  const optionsHtml = isMcq
    ? `<div id="options" role="group" aria-label="Answer choices"${correctAnswerAttr}>
        ${intervention
          .options!.map(
            (opt) =>
              `<button class="option" data-option="${escHtml(opt)}" aria-label="${escHtml(opt)}">${escHtml(opt)}</button>`
          )
          .join('')}
       </div>`
    : `<div>
        <textarea id="answer" aria-label="Your answer" placeholder="Your answer…"></textarea>
        <button onclick="submitFreeText()">Submit</button>
       </div>`;

  return html(`
    <div class="intervention">
      <div class="tag">
        ${formatType(intervention.type)}
        &nbsp;·&nbsp;
        <span class="diff-dots" aria-label="Difficulty ${intervention.difficultyScore} out of 5">
          ${renderDifficultyDots(intervention.difficultyScore)}
        </span>
      </div>
      <h2>${escHtml(intervention.title)}</h2>
      ${renderChips(intervention.conceptTags)}
      <div class="body">${renderMarkdown(intervention.body)}</div>
      ${optionsHtml}
      <div aria-live="polite" aria-atomic="true" class="sr-only" id="feedback-announce"></div>
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

      const optionsEl = document.getElementById('options');
      if (optionsEl) {
        const correctAnswer = optionsEl.dataset.correctAnswer || '';
        const announce = document.getElementById('feedback-announce');

        optionsEl.querySelectorAll('.option').forEach(function(btn) {
          btn.addEventListener('click', function() {
            const selected = btn.dataset.option;
            const isCorrect = !correctAnswer || selected === correctAnswer;

            // Disable all options immediately
            optionsEl.querySelectorAll('.option').forEach(function(b) {
              b.disabled = true;
            });

            // Highlight selected and reveal correct answer
            btn.classList.add(isCorrect ? 'opt-correct' : 'opt-wrong');
            if (!isCorrect && correctAnswer) {
              optionsEl.querySelectorAll('.option').forEach(function(b) {
                if (b.dataset.option === correctAnswer) b.classList.add('opt-correct');
              });
            }

            if (announce) {
              announce.textContent = isCorrect ? 'Correct!' : 'Incorrect. Correct answer highlighted.';
            }

            // Transition to feedback after a short pause
            setTimeout(function() {
              postMsg('answer', { answer: selected, score: isCorrect ? 1 : 0 });
            }, 1400);
          });
        });
      }
    </script>
  `);
}
