'use strict';

(() => {
  let running = false;

  async function runDeveloperExport() {
    if (running) return;
    const secure = window.YJMBSecureData;
    if (!secure?.downloadDeveloperWorkbook) {
      window.alert('Developer export is unavailable in this build.');
      return;
    }

    const developerKey = window.prompt('Developer export key:');
    if (developerKey === null) return;
    if (!developerKey.trim()) {
      window.alert('No developer export key was entered.');
      return;
    }

    running = true;
    try {
      const filename = await secure.downloadDeveloperWorkbook(developerKey);
      window.alert(`Downloaded the latest protected master workbook as:\n${filename}`);
    } catch (error) {
      if (error?.name === 'AccessRequiredError' || error?.code === 'AUTH_REQUIRED') {
        window.alert('Your normal tree-access session has expired. Complete the three access questions again, then retry the developer export.');
        const base = location.pathname.replace(/[^/]*$/, '');
        location.assign(`${base}index.html`);
        return;
      }
      window.alert(`Developer export failed: ${error?.message || error}`);
    } finally {
      running = false;
    }
  }


  function openAdminMode() {
    const base = location.pathname.replace(/[^/]*$/, '');
    location.assign(`${base}admin.html`);
  }

  // Intentionally no visible developer button. The key chord is merely a
  // convenience/discovery mechanism; authorization is enforced server-side by
  // the independent DEVELOPER_EXPORT_KEY and a valid normal access session.
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.altKey && event.shiftKey && event.code === 'KeyE') {
      event.preventDefault();
      void runDeveloperExport();
      return;
    }
    if (event.ctrlKey && event.altKey && event.shiftKey && event.code === 'KeyA') {
      event.preventDefault();
      openAdminMode();
    }
  });

  // Optional console command for the site owner.
  window.YJMBDeveloperExport = runDeveloperExport;
  window.YJMBAdminMode = openAdminMode;
})();
