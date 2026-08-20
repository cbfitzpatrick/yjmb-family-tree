'use strict';

(() => {
  const RELEASE = 'v18.2';
  const STORAGE_KEY = 'yjmbReleaseNoticeDismissedVersion';
  const SESSION_KEY = `yjmbReleaseNoticeSeen:${RELEASE}`;
  try {
    if (localStorage.getItem(STORAGE_KEY) === RELEASE || sessionStorage.getItem(SESSION_KEY) === '1') return;
  } catch (_) {
    // Storage may be unavailable in restrictive browser modes; show the notice anyway.
  }

  const show = () => {
    if (document.querySelector('#release-notice-dialog')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'release-notice-dialog';
    dialog.className = 'release-notice-dialog';
    dialog.innerHTML = `
      <div class="release-notice-header">
        <div>
          <p class="details-kicker">YJMB Family Tree ${RELEASE}</p>
          <h2>Welcome to the updated family tree</h2>
        </div>
        <button class="details-close" type="button" data-release-close aria-label="Close update notice">×</button>
      </div>
      <div class="release-notice-body">
        <p class="release-desktop-note"><strong>This site works best on a desktop or laptop.</strong> Phone support is available, but the full tree is easier to navigate on a larger screen.</p>
        <h3>What changed in v18.2</h3>
        <ul>
          <li>Focused “Show tree” views retain their family connections.</li>
          <li>Tree connectors use the stronger black-line/gray-halo treatment.</li>
          <li>Correction-page VET/RAT additions can create and reciprocate missing people automatically.</li>
          <li>Several darker section colors were lightly adjusted for clearer black card text.</li>
          <li>Online changes may take a few minutes to appear after submission.</li>
        </ul>
        <div class="release-notice-actions">
          <button class="secondary-button" type="button" data-release-close>Continue</button>
          <button class="primary-button" type="button" data-release-dismiss>Don’t show again for v18.2</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);

    const close = () => {
      try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (_) { /* no-op */ }
      if (dialog.open) dialog.close();
      dialog.remove();
    };
    dialog.querySelectorAll('[data-release-close]').forEach((button) => button.addEventListener('click', close));
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
