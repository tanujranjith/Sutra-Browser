/* Keep the static shell concealed until app.js confirms canonical hydration and render. */
(function () {
  'use strict';

  var gate = document.getElementById('sutraWorkspaceStartup');
  var title = document.getElementById('sutraWorkspaceStartupTitle');
  var message = document.getElementById('sutraWorkspaceStartupMessage');
  var actions = document.getElementById('sutraWorkspaceStartupActions');
  if (!gate || !title || !message || !actions) return;

  var settled = false;
  function showError(detail) {
    if (settled) return;
    title.textContent = 'Your workspace could not be opened';
    message.textContent = detail || 'Sutra could not confirm your saved workspace. It will not show an unverified empty workspace. Reload to try again.';
    actions.hidden = false;
    document.body.dataset.sutraWorkspaceBoot = 'error';
  }

  window.addEventListener('sutra:workspace-boot-result', function (event) {
    if (!event.detail || !event.detail.ok) {
      showError(event.detail && event.detail.message);
      return;
    }
    var shell = document.querySelector('.app-container');
    if (!shell) { showError('Sutra could not find the workspace shell. Reload to try again.'); return; }
    settled = true;
    shell.inert = false;
    shell.removeAttribute('aria-hidden');
    document.body.dataset.sutraWorkspaceBoot = 'ready';
    gate.hidden = true;
  }, { once: true });

  document.getElementById('sutraWorkspaceStartupReload').addEventListener('click', function () { location.reload(); });
  document.getElementById('sutraWorkspaceStartupSafeMode').addEventListener('click', function () {
    var url = new URL(location.href);
    url.searchParams.set('sutraSafeMode', '1');
    location.href = url.toString();
  });
  document.getElementById('sutraWorkspaceStartupDiagnostics').addEventListener('click', function () {
    if (window.SutraDiagnostics && typeof window.SutraDiagnostics.download === 'function') window.SutraDiagnostics.download();
  });

  // A missing or stalled boot script must not leave an unexplained spinner.
  window.setTimeout(function () { showError(); }, 20000);
})();
