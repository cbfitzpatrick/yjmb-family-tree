'use strict';

(() => {
  const RELEASE = 'v19.1.2';
  const STORAGE_KEY = 'yjmbReleaseNoticeDismissedVersion';
  const SESSION_KEY = `yjmbReleaseNoticeSeen:${RELEASE}`;
  try {
    if (localStorage.getItem(STORAGE_KEY) === RELEASE || sessionStorage.getItem(SESSION_KEY) === '1') return;
  } catch (_) {
    // Storage may be unavailable in restrictive browser modes; show the notice anyway.
  }

  const VERSION_SECTIONS = [
    {
      version: 'v19.1.2',
      items: [
        'Position and Year now treats commas as entry separators as well as semicolons, pipes, and line breaks.',
        'Dohmeister is now explicitly classified as Informal Leadership instead of generic Other Leadership.',
        'Mixed entries such as 2022-2023 Section Leader, 2024 Dohmeister, 2025 RAT Parent now produce all three card icons.',
        'Protected site rebuilds now copy the complete web_template/icons folder instead of looking for obsolete root-level icon files.',
      ],
    },
    {
      version: 'v19.1.1',
      items: [
        'Member names are now locked to the exact geometric center of every card regardless of which corner role icons are present.',
        'The same centering rule is used in the normal tree, Admin tree, and Admin Feature Preview.',
        'Icon-aware font fitting remains symmetric, so long names can shrink to avoid corner badges without shifting left or right.',
      ],
    },
    {
      version: 'v19.1',
      items: [
        'Position and Year is now the single source used to determine leadership and special-position icons on member cards.',
        'Card role icons are enabled for the normal tree and are derived from Position and Year rather than duplicate leadership columns.',
        'Add Yourself now records positions directly in Position and Year instead of creating separate marching-band, informal-leadership, and Band Club leadership fields.',
        'Member details, Correction, and Admin Spreadsheet/Editor hide the retired duplicate leadership metadata fields.',
        'Existing historical leadership columns are preserved in the protected workbook for recovery, but new updates no longer populate or depend on them.',
        'Older queued submissions are converted into Position and Year so leadership information is not lost during the transition.',
      ],
    },
    {
      version: 'v19.0',
      items: [
        'Moved the card-role artwork to PNG assets in dedicated icons folders for consistent source and deployed-site behavior.',
        'Reduced role-icon size and moved badges closer to the four card corners so names remain easier to read.',
        'Drum Major always occupies the top-left corner; Section Leader or Guard Captain always occupies the top-right corner.',
        'Cards display at most four role icons. Other roles fill the bottom corners first and can use an unreserved top corner when needed.',
      ],
    },
  ];

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  const historyHtml = VERSION_SECTIONS.map((section) => `
    <section class="release-history-section">
      <h3>${escapeHtml(section.version)}</h3>
      <ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </section>`).join('');

  const show = () => {
    if (document.querySelector('#release-notice-dialog')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'release-notice-dialog';
    dialog.className = 'release-notice-dialog';
    dialog.innerHTML = `
      <div class="release-notice-header">
        <div>
          <p class="details-kicker">YJMB Family Tree ${RELEASE}</p>
          <h2>Version 19 updates</h2>
        </div>
      </div>
      <div class="release-notice-body">
        <p class="release-desktop-note"><strong>This site works best on a desktop or laptop.</strong> Phone support is available, but the full tree is easier to navigate on a larger screen.</p>
        <div class="release-history" aria-label="Version 19 update history">
          ${historyHtml}
        </div>
        <div class="release-notice-actions">
          <button class="secondary-button" type="button" data-release-close>Continue</button>
          <button class="primary-button" type="button" data-release-dismiss>Don’t show again for v19.1.2</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);

    const close = () => {
      try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (_) { /* no-op */ }
      if (dialog.open) dialog.close();
      dialog.remove();
    };
    dialog.querySelector('[data-release-close]')?.addEventListener('click', close);
    dialog.querySelector('[data-release-dismiss]')?.addEventListener('click', () => {
      try { localStorage.setItem(STORAGE_KEY, RELEASE); } catch (_) { /* no-op */ }
      close();
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    dialog.showModal();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, { once: true });
  else show();
})();
