'use strict';

(() => {
  const DEFAULT_ADMIN_EMAIL = 'fitzcb2020@gmail.com';
  let cachedConfig = null;

  async function loadConfig() {
    if (cachedConfig) return cachedConfig;
    try {
      const response = await fetch('site_config.json', { cache: 'no-store' });
      cachedConfig = response.ok ? await response.json() : {};
    } catch {
      cachedConfig = {};
    }
    return cachedConfig;
  }

  async function adminEmail() {
    const config = await loadConfig();
    return String(config.adminEmail || DEFAULT_ADMIN_EMAIL).trim() || DEFAULT_ADMIN_EMAIL;
  }

  async function formSubmitRecipient() {
    const config = await loadConfig();
    return String(config.formSubmitRecipient || config.adminEmail || DEFAULT_ADMIN_EMAIL).trim() || DEFAULT_ADMIN_EMAIL;
  }

  async function sendAdminEmail({ subject, fields }) {
    const recipient = await formSubmitRecipient();
    const endpoint = `https://formsubmit.co/ajax/${encodeURIComponent(recipient)}`;
    const payload = {
      _subject: subject,
      _template: 'table',
      ...fields,
    };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
    let result = {};
    try { result = await response.json(); } catch { /* non-JSON error page */ }
    if (!response.ok || result.success === false || result.success === 'false') {
      throw new Error(result.message || `Email service returned HTTP ${response.status}.`);
    }
    return result;
  }

  function ensureBanner() {
    let banner = document.querySelector('#admin-success-banner');
    if (banner) return banner;
    banner = document.createElement('div');
    banner.id = 'admin-success-banner';
    banner.className = 'admin-success-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.hidden = true;
    document.body.appendChild(banner);
    return banner;
  }

  function showAdminBanner(kind) {
    const banner = ensureBanner();
    const label = kind === 'entry change request'
      ? 'entry change request'
      : (kind === 'tree submission' ? 'tree submission' : 'bug report');
    banner.textContent = `your ${label} has been sent to admins for updating.`;
    banner.hidden = false;
    banner.classList.remove('is-hiding');
    clearTimeout(banner._hideTimer);
    banner._hideTimer = setTimeout(() => {
      banner.classList.add('is-hiding');
      setTimeout(() => { banner.hidden = true; }, 220);
    }, 5000);
  }

  function bugReportMarkup() {
    return `
      <section class="bug-report-section" aria-labelledby="bug-report-heading">
        <details>
          <summary id="bug-report-heading" class="bug-report-trigger" title="Report a bug" aria-label="Report a bug">
            <svg class="bug-report-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 3h6M10 3l1-2m3 2-1-2M8 8 5 6M16 8l3-2M7 12H3m14 0h4M7 17l-3 2m13-2 3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              <path d="M7.5 10.5c0-3 2-5 4.5-5s4.5 2 4.5 5v4.2c0 3-2 5.3-4.5 5.3s-4.5-2.3-4.5-5.3Z" fill="none" stroke="currentColor" stroke-width="1.8"/>
              <path d="M8 13h8M12 6v13" fill="none" stroke="currentColor" stroke-width="1.4"/>
            </svg>
            <span class="sr-only">Report a bug</span>
          </summary>
          <form class="bug-report-form">
            <button class="bug-report-close" type="button" aria-label="Close bug report" title="Close bug report">×</button>
            <p class="field-help">Found something on this website that is not working correctly? Send the admins a bug report.</p>
            <label class="form-field form-field-wide">
              <span>What went wrong?</span>
              <textarea name="problem" rows="5" required placeholder="Describe what happened and what you expected to happen."></textarea>
            </label>
            <label class="form-field form-field-wide">
              <span>What were you doing when it happened?</span>
              <textarea name="steps" rows="4" placeholder="Include any search, filter, person, button, or questionnaire step involved."></textarea>
            </label>
            <label class="form-field">
              <span>Your email (optional)</span>
              <input name="reporterEmail" type="email" autocomplete="email" placeholder="you@example.com">
            </label>
            <label class="bug-honeypot" aria-hidden="true">
              <span>Leave blank</span>
              <input name="website" type="text" tabindex="-1" autocomplete="off">
            </label>
            <div class="correction-actions">
              <button class="primary-button bug-submit" type="submit">Send bug report</button>
              <span class="bug-form-status" role="status" aria-live="polite"></span>
            </div>
          </form>
        </details>
      </section>`;
  }

  function initBugReports() {
    document.querySelectorAll('.bug-report-slot').forEach((slot) => {
      slot.innerHTML = bugReportMarkup();
      const form = slot.querySelector('.bug-report-form');
      const status = slot.querySelector('.bug-form-status');
      const button = slot.querySelector('.bug-submit');
      const closeButton = slot.querySelector('.bug-report-close');
      closeButton?.addEventListener('click', () => {
        const details = slot.querySelector('details');
        if (details) details.open = false;
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (form.elements.website.value) return;
        const problem = form.elements.problem.value.trim();
        if (!problem) return;
        button.disabled = true;
        status.textContent = 'Sending…';
        try {
          const reporterEmail = form.elements.reporterEmail.value.trim();
          await sendAdminEmail({
            subject: `[Bug Report] ${document.title}`,
            fields: {
              ...(reporterEmail ? { _replyto: reporterEmail } : {}),
              'Report type': 'Bug Report',
              'Page title': document.title,
              'Page URL': window.location.href,
              'What went wrong': problem,
              'What the visitor was doing': form.elements.steps.value.trim() || '[not provided]',
              'Reporter email': reporterEmail || '[not provided]',
              'Browser': navigator.userAgent,
              'Submitted at': new Date().toISOString(),
            },
          });
          form.reset();
          status.textContent = '';
          showAdminBanner('bug report');
        } catch (error) {
          console.error(error);
          status.textContent = `Could not send the bug report: ${error.message}`;
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  window.YJMBAdminMail = {
    loadConfig,
    adminEmail,
    formSubmitRecipient,
    sendAdminEmail,
    showAdminBanner,
    initBugReports,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBugReports, { once: true });
  } else {
    initBugReports();
  }
})();
