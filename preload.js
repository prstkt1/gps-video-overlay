'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe subset of Electron APIs to the renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // ── Dialogs ──────────────────────────────────────────────────────────────
  openVideoDialog:  ()              => ipcRenderer.invoke('dialog:openVideo'),
  openGPXDialog:    ()              => ipcRenderer.invoke('dialog:openGPX'),
  saveVideoDialog:  (name)          => ipcRenderer.invoke('dialog:saveVideo', name),

  // ── GPS ───────────────────────────────────────────────────────────────────
  extractGPS:       (videoPath)     => ipcRenderer.invoke('gps:extract', videoPath),
  parseGPX:         (gpxPath)       => ipcRenderer.invoke('gps:parseGPX', gpxPath),

  // ── Video info ─────────────────────────────────────────────────────────────
  getVideoInfo:     (videoPath)     => ipcRenderer.invoke('video:info', videoPath),

  // ── Settings ──────────────────────────────────────────────────────────────
  getSetting:       (key)           => ipcRenderer.invoke('settings:get', key),
  getAllSettings:   ()              => ipcRenderer.invoke('settings:getAll'),
  setSetting:       (key, val)      => ipcRenderer.invoke('settings:set', key, val),

  // ── Export ────────────────────────────────────────────────────────────────
  startExport:      (options)       => ipcRenderer.invoke('export:start', options),
  cancelExport:     ()              => ipcRenderer.send('export:cancel'),

  // ── Event listeners ───────────────────────────────────────────────────────
  onExportProgress: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('export:progress', handler);
    return () => ipcRenderer.removeListener('export:progress', handler);
  },

  // ── Shell ─────────────────────────────────────────────────────────────────
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p)
});
