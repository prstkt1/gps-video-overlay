/**
 * updater.js
 * Manages the auto-update banner UI.
 * Communicates with main.js via window.electronAPI.updater
 */

'use strict';

(async () => {
  // Not available in dev mode (no electron-updater)
  if (!window.electronAPI?.updater) return;

  const banner      = document.getElementById('update-banner');
  const text        = document.getElementById('update-text');
  const icon        = document.getElementById('update-icon');
  const progressWrap= document.getElementById('update-progress-wrap');
  const progressFill= document.getElementById('update-progress-fill');
  const btnDownload = document.getElementById('btn-update-download');
  const btnInstall  = document.getElementById('btn-update-install');
  const btnDismiss  = document.getElementById('btn-update-dismiss');

  // Show current app version in header
  const version = await window.electronAPI.updater.version().catch(() => null);
  if (version) {
    const logoName = document.querySelector('.logo-name');
    if (logoName) logoName.title = `v${version}`;
  }

  // ── Helper ────────────────────────────────────────────────────────────────
  function showBanner(msg, opts = {}) {
    text.textContent = msg;
    icon.textContent = opts.icon ?? '🔄';
    banner.classList.remove('hidden', 'update-ready');
    if (opts.ready) banner.classList.add('update-ready');

    // Buttons
    btnDownload.classList.toggle('hidden', !opts.download);
    btnInstall.classList.toggle('hidden',  !opts.install);
    progressWrap.classList.toggle('hidden', !opts.progress);
    if (opts.progress !== undefined) {
      progressFill.style.width = opts.progress + '%';
    }
  }

  function hideBanner() {
    banner.classList.add('hidden');
    banner.classList.remove('update-ready');
  }

  // ── Status handler ────────────────────────────────────────────────────────
  window.electronAPI.updater.onStatus(data => {
    switch (data.type) {

      case 'checking':
        // Silent — don't bother user unless something interesting happens
        break;

      case 'up-to-date':
        // Fully silent on "no update" — nothing to show
        break;

      case 'available':
        showBanner(`Доступна версия ${data.version}`, {
          icon:     '⬆️',
          download: true
        });
        break;

      case 'downloading':
        showBanner(`Загрузка обновления… ${Math.round(data.percent ?? 0)}%`, {
          icon:     '⬇️',
          progress: Math.round(data.percent ?? 0)
        });
        break;

      case 'downloaded':
        showBanner(`Версия ${data.version} загружена — готово к установке`, {
          icon:    '✅',
          install: true,
          ready:   true
        });
        break;

      case 'error':
        // Only show error banner if user actively started a download
        if (_userTriggered) {
          showBanner('Не удалось загрузить обновление', { icon: '⚠️' });
        }
        break;
    }
  });

  // ── Buttons ───────────────────────────────────────────────────────────────
  let _userTriggered = false;

  btnDownload.addEventListener('click', async () => {
    _userTriggered = true;
    btnDownload.classList.add('hidden');
    showBanner('Начинаю загрузку…', { icon: '⬇️', progress: 0 });
    await window.electronAPI.updater.download().catch(e => {
      showBanner('Ошибка загрузки: ' + e.message, { icon: '⚠️' });
    });
  });

  btnInstall.addEventListener('click', () => {
    window.electronAPI.updater.install();
  });

  btnDismiss.addEventListener('click', hideBanner);

})();
