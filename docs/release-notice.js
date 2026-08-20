'use strict';

(() => {
  const RELEASE = 'v18.4';
  const STORAGE_KEY = 'yjmbReleaseNoticeDismissedVersion';
  const SESSION_KEY = `yjmbReleaseNoticeSeen:${RELEASE}`;
  try {
    if (localStorage.getItem(STORAGE_KEY) === RELEASE || sessionStorage.getItem(SESSION_KEY) === '1') return;
  } catch (_) {
    // Storage may be unavailable in restrictive browser modes; show the notice anyway.
  }

  const VERSION_SECTIONS = [
    {
      version: 'v18.4',
      items: [
        'Fixed isolated straight-down family trees whose connector path could disappear when Show tree / Show connected tree was used.',
        'Made the connector halo lighter and slightly more opaque while keeping the black relationship line in front of it.',
        'Expanded this release notice into a scrollable version-18 history.',
      ],
    },
    {
      version: 'v18.3',
      items: [
        'Improved focused-tree connector ownership handling for older/generated tree payloads.',
        'When a newly added person names an existing VET but is missing from that VET\'s RAT list, the new RAT is inserted as RAT 1 and existing RAT entries shift down safely.',
      ],
    },
    {
      version: 'v18.2',
      items: [
        'Improved Show tree filtering so unrelated trees disappear without intentionally removing the selected family\'s connections.',
        'Strengthened the gray connector halo around the black relationship network.',
        'Correction-page VET/RAT additions can create missing people as real rows/cards and reciprocate the relationship.',
        'Lightened several section colors to improve black-text readability while retaining the section-family color progression.',
      ],
    },
    {
      version: 'v18.1',
      items: [
        'Changed 100% zoom to mean the full vertical height of the tree fits in the viewport; Reset returns to that baseline.',
        'Changed visible family connections to one unified SVG path with a black relationship stroke and a translucent gray halo behind it.',
      ],
    },
    {
      version: 'v18',
      items: [
        'Introduced the version-18 section palette and standardized the section label to Saxophone.',
        'Add Yourself can merge new information into an existing matching profile instead of forcing a separate correction flow.',
        'New VETs and RATs that do not yet exist can be created as real person rows/cards and reciprocated automatically.',
        'Added the notice that protected online changes may take a few minutes to rebuild and appear on the live tree.',
        'Reduced public-repository Markdown documentation to the simplified root README workflow.',
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
          <h2>Version 18 updates</h2>
        </div>
      </div>
      <div class="release-notice-body">
        <p class="release-desktop-note"><strong>This site works best on a desktop or laptop.</strong> Phone support is available, but the full tree is easier to navigate on a larger screen.</p>
        <p>Scroll through the version 18 changes below. The newest update is listed first.</p>
        <div class="release-history" aria-label="Version 18 update history">
          ${historyHtml}
        </div>
        <div class="release-notice-actions">
          <button class="secondary-button" type="button" data-release-close>Continue</button>
          <button class="primary-button" type="button" data-release-dismiss>Don’t show again for v18.4</button>
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
    // There is deliberately no X button. Escape behaves like Continue so the
    // modal never traps a keyboard user.
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    dialog.showModal();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, { once: true });
  else show();
})();
