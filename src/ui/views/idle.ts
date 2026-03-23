import { html, escHtml } from './shared';

function renderProgressDots(count: number, total: number): string {
  const filled = Math.min(count % total === 0 && count > 0 ? total : count % total, total);
  return Array.from({ length: total }, (_, i) => (i < filled ? '●' : '○')).join('');
}

function renderMasteryStars(avgScore: number): string {
  const stars = Math.max(1, Math.round(avgScore * 5));
  return Array.from({ length: 5 }, (_, i) => (i < stars ? '★' : '☆')).join('');
}

function daysSince(isoDate: string): string {
  const days = Math.floor((Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

export interface LastConcept {
  tag: string;
  lastSeen: string; // ISO date string
  avgScore: number; // 0–1
}

export function getIdleHtml(
  storyEntryCount = 0,
  promptCount = 0,
  promptThreshold = 10,
  lastConcept?: LastConcept
): string {
  const dots = renderProgressDots(promptCount, promptThreshold);
  const position = promptCount % promptThreshold;
  const left = promptThreshold - position;
  const promptLabel =
    position === 0 && promptCount > 0
      ? 'quiz ready!'
      : left === 1
        ? 'quiz next prompt'
        : `${position} / ${promptThreshold} prompts`;

  const lastConceptHtml = lastConcept
    ? `<div class="last-concept">
        <div class="hint">Last reinforced</div>
        <strong>${escHtml(lastConcept.tag)}</strong>
        <div class="hint">${daysSince(lastConcept.lastSeen)} · ${renderMasteryStars(lastConcept.avgScore)}</div>
      </div>`
    : '';

  const storyHint =
    storyEntryCount > 0
      ? `<button class="secondary" onclick="postMsg('openStory')" style="width:100%; margin-top: 4px;">Codebase Story (${storyEntryCount}) →</button>`
      : '';

  return html(`
    <div class="idle">
      <div class="progress-block">
        <div class="progress-dots">${dots}</div>
        <div class="hint">${escHtml(promptLabel)}</div>
      </div>
      ${lastConceptHtml}
      <button onclick="postMsg('quizNow')" style="width: 100%;">Quiz Me Now</button>
      <button class="secondary" onclick="postMsg('explainCodebase')" style="width: 100%; margin-top: 4px;">Explain My Codebase</button>
      ${storyHint}
      <p class="hint" style="margin-top: 20px;">You're in flow. VibeLearn will check in soon.</p>
    </div>
    <script>
      const vscode = acquireVsCodeApi();
      function postMsg(type, payload) { vscode.postMessage({ type, payload }); }
    </script>
  `);
}
