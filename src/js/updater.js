/**
 * updater.js
 * Manages the auto-update banner (bottom-right) and the
 * version info + manual check button in the Settings tab.
 */

'use strict';

(async () => {
  if (!window.electronAPI?.updater) return;

  // ── Banner elements ───────────────────────────────────────────────────────
  const banner       = document.getElementById('update-banner');
  const bannerText   = document.getElementById('update-text');
  const bannerIcon   = document.getElementById('update-icon');
  const progressWrap = document.getElementById('update-progress-wrap');
  const progressFill = document.getElementById('update-progress-fill');
  const btnDownload  = document.getElementById('btn-update-download');
  const btnInstall   = document.getElementById('btn-update-install');
  const btnDismiss   = document.getElementById('btn-update-dismiss');

  // ── Settings tab elements ─────────────────────────────────────────────────
  const settingsVersion  = document.getElementById('settings-version');
  const btnCheckUpdates  = document.getElementById('btn-check-updates');
  const updateResult     = document.getElementById('update-check-result');

  // ── Show current version ──────────────────────────────────────────────────
  const version = await window.electronAPI.updater.version().catch(() => null);
  if (version) {
    if (settingsVersion) settingsVersion.textContent = 'v' + version;
    const logoName = document.querySelector('.logo-name');
    if (logoName) logoName.title = 'GPS Video Overlay v' + version;
  }

  // ── Settings result helper ────────────────────────────────────────────────
  function setResult(state, msg) {
    if (!updateResult) return;
    updateResult.className = 'update-check-result state-' + state;
    updateResult.textContent = msg;
    updateResult.classList.remove('hidden');
  }

  function clearResult() {
    if (!updateResult) return;
    updateResult.classList.add('hidden');
    updateResult.className = 'update-check-result hidden';
  }

  // ── Banner helpers ─────────────────────────────────────────────────────────
  function showBanner(msg, opts = {}) {
    bannerText.textContent = msg;
    bannerIcon.textContent = opts.icon ?? '🔄';
    banner.classList.remove('hidden', 'update-ready');
    if (opts.ready) banner.classList.add('update-ready');
    btnDownload.classList.toggle('hidden', !opts.download);
    btnInstall.classList.toggle('hidden',  !opts.install);
    progressWrap.classList.toggle('hidden', !opts.progress);
    if (opts.progress !== undefined) progressFill.style.width = opts.progress + '%';
  }

  function hideBanner() {
    banner.classList.add('hidden');
    banner.classList.remove('update-ready');
  }

  // ── Shared status handler (called for both auto & manual checks) ──────────
  let _userTriggered = false;

  function handleStatus(data) {
    switch (data.type) {

      case 'checking':
        if (_userTriggered) setResult('checking', '🔄 Проверяю обновления…');
        break;

      case 'up-to-date':
        if (_userTriggered) {
          setResult('ok', '✅ Установлена последняя версия ' + (version ? `(v${version})` : ''));
          if (btnCheckUpdates) btnCheckUpdates.disabled = false;
        }
        break;

      case 'available':
        // Show in both banner and settings
        showBanner(`Доступна версия ${data.version}`, { icon: '⬆️', download: true });
        setResult('available',
          `⬆️ Доступна версия ${data.version} — нажмите «Загрузить» в уведомлении`
        );
        if (btnCheckUpdates) btnCheckUpdates.disabled = false;
        break;

      case 'downloading':
        showBanner(`Загрузка… ${Math.round(data.percent ?? 0)}%`, {
          icon: '⬇️', progress: Math.round(data.percent ?? 0)
        });
        setResult('downloading', `⬇️ Загрузка обновления… ${Math.round(data.percent ?? 0)}%`);
        break;

      case 'downloaded':
        showBanner(`Версия ${data.version} готова к установке`, {
          icon: '✅', install: true, ready: true
        });
        setResult('downloaded',
          `✅ Версия ${data.version} загружена — нажмите «Установить и перезапустить»`
        );
        if (btnCheckUpdates) btnCheckUpdates.disabled = false;
        break;

      case 'error':
        if (_userTriggered) {
          setResult('error', '⚠️ Не удалось проверить обновления. Проверьте соединение.');
          if (btnCheckUpdates) btnCheckUpdates.disabled = false;
        }
        break;
    }
  }

  window.electronAPI.updater.onStatus(handleStatus);

  // ── Manual check button ───────────────────────────────────────────────────
  if (btnCheckUpdates) {
    btnCheckUpdates.addEventListener('click', async () => {
      _userTriggered = true;
      btnCheckUpdates.disabled = true;
      clearResult();
      setResult('checking', '🔄 Проверяю обновления…');
      try {
        await window.electronAPI.updater.check();
      } catch {
        setResult('error', '⚠️ Не удалось проверить обновления.');
        btnCheckUpdates.disabled = false;
      }
    });
  }

  // ── Banner buttons ────────────────────────────────────────────────────────
  btnDownload.addEventListener('click', async () => {
    _userTriggered = true;
    btnDownload.classList.add('hidden');
    showBanner('Загружаю обновление…', { icon: '⬇️', progress: 0 });
    await window.electronAPI.updater.download().catch(() => {
      showBanner('Ошибка загрузки', { icon: '⚠️' });
    });
  });

  btnInstall.addEventListener('click', () => {
    window.electronAPI.updater.install();
  });

  btnDismiss.addEventListener('click', hideBanner);

})();
