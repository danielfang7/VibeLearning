import { html, escHtml } from './shared';
import type { PatternInsight } from '../../types';

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

function renderInsightCards(insights: PatternInsight[]): string {
  if (insights.length === 0) return '';
  // Show up to 3 insights to avoid clutter
  const cards = insights.slice(0, 3).map((i) => {
    const icon = i.kind === 'struggle' ? '🔄' : '✅';
    const colorVar = i.kind === 'struggle'
      ? 'var(--vscode-charts-yellow, #e5a000)'
      : 'var(--vscode-charts-green, #4caf50)';
    return `<div class="insight-card" style="border-left: 3px solid ${colorVar};">
      <div class="insight-header">${icon} <strong>${escHtml(i.tag)}</strong></div>
      <div class="hint">${escHtml(i.message)}</div>
    </div>`;
  }).join('');
  return `<div class="insight-section">
    <div class="hint" style="margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;">Pattern Insights</div>
    ${cards}
  </div>`;
}

export function getIdleHtml(
  storyEntryCount = 0,
  promptCount = 0,
  promptThreshold = 10,
  lastConcept?: LastConcept,
  archScore?: number | null,
  patternInsights: PatternInsight[] = []
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

  const archScoreBadge = archScore != null
    ? `<span class="arch-score-badge">Arch: ${archScore}</span>`
    : `<span class="arch-score-badge" style="color: var(--vscode-descriptionForeground)">Arch: —</span>`;

  const lastConceptHtml = lastConcept
    ? `<div class="last-concept">
        <div class="hint">Last reinforced</div>
        <strong>${escHtml(lastConcept.tag)}</strong>
        <div class="hint">${daysSince(lastConcept.lastSeen)} · ${renderMasteryStars(lastConcept.avgScore)}</div>
      </div>`
    : `<div class="last-concept"><p class="hint">Answer your first quiz to start tracking concepts.</p></div>`;

  const insightsHtml = renderInsightCards(patternInsights);

  const storyHint =
    storyEntryCount > 0
      ? `<button class="secondary" onclick="postMsg('openStory')" style="width:100%; margin-top: 4px;">Codebase Story (${storyEntryCount}) →</button>`
      : '';

  return html(`
    <div class="idle">
      <div class="panel-header">
        <span class="panel-title">⚡ VibeLearning</span>
        ${archScoreBadge}
      </div>
      <div class="progress-block">
        <div class="progress-dots">${dots}</div>
        <div class="hint">${escHtml(promptLabel)}</div>
      </div>
      ${lastConceptHtml}
      ${insightsHtml}
      <button id="btn-quiz" onclick="triggerAction(this, 'quizNow', 'Generating quiz\u2026')" style="width: 100%;">Quiz Me Now</button>
      <button id="btn-explain" class="secondary" onclick="triggerAction(this, 'explainCodebase', 'Analyzing codebase\u2026')" style="width: 100%; margin-top: 4px;">Explain My Codebase</button>
      ${storyHint}
      <p class="hint" style="margin-top: 20px;">You're in flow. VibeLearn will check in soon.</p>
    </div>
    <script>
      const vscode = acquireVsCodeApi();
      function postMsg(type, payload) { vscode.postMessage({ type, payload }); }
      function triggerAction(btn, type, loadingText) {
        document.querySelectorAll('button').forEach(function(b) { b.disabled = true; });
        btn.textContent = loadingText;
        postMsg(type);
      }
    </script>
  `);
}
