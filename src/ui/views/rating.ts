import { html } from './shared';

export function getRatingHtml(conceptTags: string[]): string {
  const tagsJson = JSON.stringify(conceptTags);

  return html(`
    <div class="idle" style="padding-top: 24px;">
      <p>How useful was this debrief?</p>
      <div id="stars" role="group" aria-label="Rate this debrief" style="margin: 12px 0;">
        ${[1, 2, 3, 4, 5]
          .map(
            (n) =>
              `<button class="star" data-stars="${n}" title="${n} star${n > 1 ? 's' : ''}" aria-pressed="false" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`
          )
          .join('')}
      </div>
      <button class="secondary" onclick="postMsg('skipRating')" style="margin-top: 8px;">Skip</button>
    </div>
    <script>
      const vscode = acquireVsCodeApi();
      const tags = ${tagsJson};
      function postMsg(type, payload) { vscode.postMessage({ type, payload }); }

      const starBtns = document.querySelectorAll('.star');
      starBtns.forEach(function(btn) {
        btn.addEventListener('mouseover', function() {
          const n = parseInt(btn.dataset.stars);
          starBtns.forEach(function(b) {
            const active = parseInt(b.dataset.stars) <= n;
            b.classList.toggle('active', active);
          });
        });
        btn.addEventListener('mouseleave', function() {
          starBtns.forEach(function(b) { b.classList.remove('active'); });
        });
        btn.addEventListener('click', function() {
          const stars = parseInt(btn.dataset.stars);
          starBtns.forEach(function(b) {
            b.setAttribute('aria-pressed', String(parseInt(b.dataset.stars) === stars));
          });
          postMsg('rate', { stars, conceptTags: tags });
        });
      });
    </script>
  `);
}
