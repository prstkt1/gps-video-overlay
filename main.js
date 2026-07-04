/**
 * GPS Video Overlay - Electron Main Process
 * Handles: window lifecycle, IPC, GPS extraction, FFmpeg export pipeline
 */

'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// ─── FFmpeg paths ────────────────────────────────────────────────────────────
let ffmpegPath, ffprobePath;
try {
  ffmpegPath  = require('ffmpeg-static');
  ffprobePath = require('ffprobe-static').path;
} catch {
  // Dev fallback — assume ffmpeg is in PATH
  ffmpegPath  = 'ffmpeg';
  ffprobePath = 'ffprobe';
}

// ─── Settings store ──────────────────────────────────────────────────────────
let Store;
try {
  Store = require('electron-store');
} catch {
  // Minimal fallback store
  Store = class {
    constructor() { this._data = {}; }
    get(k, def) { return this._data[k] ?? def; }
    set(k, v) { this._data[k] = v; }
  };
}
const store = new Store({ defaults: {
  speedUnit: 'kmh',
  overlayOpacity: 0.9,
  overlaySize: 1.0,
  speedometerStyle: 'analog',
  showMinimap: true,
  showCoords: true,
  showAltitude: true,
  lastDir: ''
}});

// ─── Auto updater ────────────────────────────────────────────────────────────
let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload         = false;   // manual trigger from UI
  autoUpdater.autoInstallOnAppQuit = true;
} catch {
  // Not available in dev / first install
}

// ─── Active export state ─────────────────────────────────────────────────────
let exportProcess = null;
let mainWindow    = null;

// ═════════════════════════════════════════════════════════════════════════════
// Window
// ═════════════════════════════════════════════════════════════════════════════
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#080c14',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false     // allow loading local file:// video
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (!mainWindow) createWindow(); });

  // Check for updates 3 seconds after window is ready (non-blocking)
  if (autoUpdater && process.env.NODE_ENV !== 'development') {
    setTimeout(() => setupAutoUpdater(), 3000);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ═════════════════════════════════════════════════════════════════════════════
// IPC Handlers
// ═════════════════════════════════════════════════════════════════════════════

// ── File dialogs ─────────────────────────────────────────────────────────────
ipcMain.handle('dialog:openVideo', async () => {
  const lastDir = store.get('lastDir', '');
  const result  = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Action Camera Video',
    defaultPath: lastDir || undefined,
    properties: ['openFile'],
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'mov', 'avi', 'mkv', 'MP4', 'MOV'] }
    ]
  });
  if (!result.canceled && result.filePaths[0]) {
    store.set('lastDir', path.dirname(result.filePaths[0]));
  }
  return result;
});

ipcMain.handle('dialog:openGPX', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import GPX File',
    properties: ['openFile'],
    filters: [{ name: 'GPX Track', extensions: ['gpx', 'GPX'] }]
  });
  return result;
});

ipcMain.handle('dialog:saveVideo', async (_, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Video',
    defaultPath: defaultName || 'output.mp4',
    filters: [
      { name: 'MP4 (H.264)',  extensions: ['mp4'] },
      { name: 'MOV (ProRes)', extensions: ['mov'] }
    ]
  });
  return result;
});

// ── Settings ─────────────────────────────────────────────────────────────────
ipcMain.handle('settings:get',    (_, key)      => store.get(key));
ipcMain.handle('settings:getAll', ()            => store.store);
ipcMain.handle('settings:set',    (_, key, val) => { store.set(key, val); });

// ── Video info ────────────────────────────────────────────────────────────────
ipcMain.handle('video:info', async (_, videoPath) => {
  return getVideoInfo(videoPath);
});

// ── GPS extraction ────────────────────────────────────────────────────────────
ipcMain.handle('gps:extract', async (_, videoPath) => {
  try {
    const gpsData = await extractGPS(videoPath);
    return { ok: true, data: gpsData };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('gps:parseGPX', async (_, gpxPath) => {
  try {
    const xml  = fs.readFileSync(gpxPath, 'utf-8');
    const data = parseGPX(xml);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── Shell ─────────────────────────────────────────────────────────────────────
ipcMain.handle('shell:openPath', (_, p) => shell.openPath(p));

// ── App version (always available, even before updater initialises) ─────────
ipcMain.handle('updater:version', () => app.getVersion());

// ── Export ────────────────────────────────────────────────────────────────────
ipcMain.handle('export:start', async (_, options) => {
  return runExport(options);
});

ipcMain.on('export:cancel', () => {
  if (exportProcess) {
    exportProcess.kill();
    exportProcess = null;
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// GPS Extraction
// ═════════════════════════════════════════════════════════════════════════════

async function extractGPS(videoPath) {
  // 1. Try GoPro GPMF (Hero, MAX, etc.)
  try {
    const gps = await extractGoproGPMF(videoPath);
    if (gps && gps.length > 2) return gps;
  } catch (e) { /* fall through */ }

  // 2. Try subtitle / metadata stream (DJI SRT, Sony RTMD text)
  try {
    const gps = await extractSubtitleGPS(videoPath);
    if (gps && gps.length > 2) return gps;
  } catch (e) { /* fall through */ }

  throw new Error('No GPS data found in this file. Try importing a .gpx track instead.');
}

// ── GoPro GPMF ───────────────────────────────────────────────────────────────
async function extractGoproGPMF(videoPath) {
  // gpmf-extract 0.3.x — default export is the function, named export is GPMFExtract
  const gpmfExtractMod = require('gpmf-extract');
  const gpmfExtract    = typeof gpmfExtractMod === 'function'
    ? gpmfExtractMod
    : (gpmfExtractMod.GPMFExtract || gpmfExtractMod.default);

  // gopro-telemetry 1.2.x — default export is the function
  const goproTelMod    = require('gopro-telemetry');
  const GoProTelemetry = typeof goproTelMod === 'function'
    ? goproTelMod
    : (goproTelMod.GoProTelemetry || goproTelMod.goProTelemetry || goproTelMod.default);

  const fileBuffer = fs.readFileSync(videoPath);

  // gpmf-extract 0.3.x accepts a Buffer directly
  const extracted  = await gpmfExtract(fileBuffer, { useGroup: 'CAMU' }).catch(() =>
    gpmfExtract(fileBuffer)
  );

  const telemetry  = await GoProTelemetry(extracted, {
    stream:   ['GPS5', 'GPS9'],
    deviceId: []
  });

  for (const deviceId of Object.keys(telemetry)) {
    const streams = telemetry[deviceId]?.streams || {};
    const stream  = streams.GPS5 || streams.GPS9;
    if (!stream || !stream.samples?.length) continue;

    return stream.samples.map(s => {
      // 1.x samples: s.value = [lat, lon, alt, speed2d, speed3d]
      const val     = Array.isArray(s.value) ? s.value : [0, 0, 0, 0, 0];
      const [lat, lon, alt, speed2d, speed3d] = val;
      return {
        timestamp: (s.cts ?? s.timestamp ?? 0) / 1000,  // ms → s
        lat: lat ?? 0,
        lon: lon ?? 0,
        alt: alt ?? 0,
        speed: (speed2d ?? 0) * 3.6,    // m/s → km/h
        speed3d: (speed3d ?? 0) * 3.6
      };
    }).filter(p => p.lat !== 0 || p.lon !== 0);
  }
  throw new Error('No GPMF GPS stream found');
}

// ── Subtitle / text-track GPS (DJI, Sony) ────────────────────────────────────
function extractSubtitleGPS(videoPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-select_streams', 's',
      videoPath
    ];

    const proc = spawn(ffprobePath, args);
    let out = '';
    proc.stdout.on('data', d => { out += d; });
    proc.on('close', code => {
      if (code !== 0) return reject(new Error('ffprobe failed'));
      try {
        const info = JSON.parse(out);
        const streams = info.streams || [];
        if (!streams.length) return reject(new Error('No subtitle streams'));

        // Extract each subtitle stream and look for GPS-like data
        extractDJISRT(videoPath, streams, resolve, reject);
      } catch (e) { reject(e); }
    });
    proc.on('error', reject);
  });
}

function extractDJISRT(videoPath, subtitleStreams, resolve, reject) {
  const args = [
    '-i', videoPath,
    '-map', '0:s:0',
    '-f', 'srt',
    'pipe:1'
  ];

  const proc = spawn(ffmpegPath, args);
  let raw = '';
  proc.stdout.on('data', d => { raw += d; });
  proc.on('close', () => {
    const points = parseDJISRT(raw);
    if (points.length > 2) resolve(points);
    else reject(new Error('SRT has no GPS data'));
  });
  proc.on('error', reject);
}

// DJI Mavic / Air SRT format:  "latitude: 48.8584, longitude: 2.2945, altitude: 300m"
function parseDJISRT(srtText) {
  const points = [];
  const blocks  = srtText.split(/\n\n+/);
  let   ts      = 0;

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 3) continue;

    // Parse timestamp from "00:00:01,000 --> 00:00:02,000"
    const tsLine = lines.find(l => l.includes('-->'));
    if (tsLine) {
      const m = tsLine.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d+)/);
      if (m) ts = (+m[1])*3600 + (+m[2])*60 + (+m[3]) + (+m[4])/1000;
    }

    const text = lines.slice(lines.indexOf(tsLine) + 1).join(' ');

    // Match various DJI GPS formats
    const lat  = parseFloat(text.match(/(?:latitude|lat)[:\s]*([-\d.]+)/i)?.[1]);
    const lon  = parseFloat(text.match(/(?:longitude|lon|lng)[:\s]*([-\d.]+)/i)?.[1]);
    const alt  = parseFloat(text.match(/(?:altitude|alt|height)[:\s]*([-\d.]+)/i)?.[1] || '0');
    const spd  = parseFloat(text.match(/(?:speed)[:\s]*([-\d.]+)/i)?.[1] || '0');

    if (!isNaN(lat) && !isNaN(lon)) {
      points.push({ timestamp: ts, lat, lon, alt: alt || 0, speed: spd * 3.6 });
    }
  }
  return points;
}

// ── GPX parser ────────────────────────────────────────────────────────────────
function parseGPX(xml) {
  const points = [];
  const trkpt  = /<trkpt([^>]*)>([\s\S]*?)<\/trkpt>/g;
  let   base   = null;
  let   m;

  while ((m = trkpt.exec(xml)) !== null) {
    const attrs = m[1];
    const body  = m[2];

    const lat  = parseFloat(attrs.match(/lat="([^"]+)"/)?.[1]);
    const lon  = parseFloat(attrs.match(/lon="([^"]+)"/)?.[1]);
    const alt  = parseFloat(body.match(/<ele>([\s\S]*?)<\/ele>/)?.[1] || '0');
    const time = body.match(/<time>([\s\S]*?)<\/time>/)?.[1] || '';

    if (isNaN(lat) || isNaN(lon)) continue;

    const ms = time ? new Date(time).getTime() : null;
    if (base === null && ms) base = ms;

    points.push({
      timestamp: ms && base ? (ms - base) / 1000 : points.length,
      lat, lon, alt,
      speed: 0   // will be computed below
    });
  }

  // Compute speed from consecutive points
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].timestamp - points[i-1].timestamp;
    const d  = haversineKm(points[i-1].lat, points[i-1].lon, points[i].lat, points[i].lon);
    points[i].speed = dt > 0 ? (d / dt) * 3600 : 0;  // km/h
  }
  if (points.length > 0) points[0].speed = points[1]?.speed ?? 0;

  return points;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2
          + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ═════════════════════════════════════════════════════════════════════════════
// Video Info
// ═════════════════════════════════════════════════════════════════════════════
function getVideoInfo(videoPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-select_streams', 'v:0',
      videoPath
    ];

    const proc = spawn(ffprobePath, args);
    let out = '';
    proc.stdout.on('data', d => { out += d; });
    proc.on('close', code => {
      if (code !== 0) return reject(new Error('ffprobe failed'));
      try {
        const info     = JSON.parse(out);
        const vStream  = info.streams?.[0] || {};
        const fmtParts = (vStream.r_frame_rate || '30/1').split('/');
        const fps      = parseFloat(fmtParts[0]) / parseFloat(fmtParts[1] || '1');

        resolve({
          width:    vStream.width    || 1920,
          height:   vStream.height   || 1080,
          fps:      Math.round(fps * 100) / 100,
          duration: parseFloat(info.format?.duration || vStream.duration || '0'),
          codec:    vStream.codec_name || 'h264',
          bitrate:  parseInt(info.format?.bit_rate || '0'),
          size:     parseInt(info.format?.size || '0')
        });
      } catch (e) { reject(e); }
    });
    proc.on('error', reject);
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Export Pipeline
// ═════════════════════════════════════════════════════════════════════════════
async function runExport(options) {
  const {
    videoPath, outputPath,
    overlayFrames,      // Array<{ time: number, dataUrl: string }>
    overlayConfig,      // { x, y, width, height }
    videoInfo,
    codec, crf, preset
  } = options;

  const tmpDir = path.join(os.tmpdir(), `gvo-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // 1 — Write overlay PNG frames to disk
    mainWindow?.webContents.send('export:progress', { phase: 'frames', pct: 0 });

    for (let i = 0; i < overlayFrames.length; i++) {
      const frame   = overlayFrames[i];
      const outPath = path.join(tmpDir, `frame_${String(i).padStart(6, '0')}.png`);
      const b64     = frame.dataUrl.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));

      if (i % 20 === 0) {
        mainWindow?.webContents.send('export:progress', {
          phase: 'frames',
          pct:   Math.round(i / overlayFrames.length * 40)
        });
      }
    }

    // 2 — Determine overlay FPS (GPS sample rate)
    const overlayFps = overlayFrames.length / videoInfo.duration;

    // 3 — Build FFmpeg filter graph
    const x    = Math.round(overlayConfig.x);
    const y    = Math.round(overlayConfig.y);
    const vc   = codec === 'h265' ? 'libx265'
               : codec === 'prores' ? 'prores_ks'
               : 'libx264';
    const crfV = crf ?? 20;
    const pre  = codec === 'prores' ? undefined : (preset || 'medium');

    const ffArgs = [
      '-i', videoPath,
      '-framerate', overlayFps.toFixed(3),
      '-i', path.join(tmpDir, 'frame_%06d.png'),
      '-filter_complex',
      `[1:v]format=rgba,setpts=N/FRAME_RATE/TB[ov];[0:v][ov]overlay=${x}:${y}:format=auto[out]`,
      '-map', '[out]',
      '-map', '0:a?',
      '-c:v', vc,
      ...(pre ? ['-preset', pre] : []),
      ...(codec !== 'prores' ? ['-crf', String(crfV)] : ['-profile:v', '3']),
      '-c:a', 'copy',
      '-movflags', '+faststart',
      '-y',
      outputPath
    ];

    // 4 — Spawn FFmpeg and stream progress
    await new Promise((resolve, reject) => {
      exportProcess = spawn(ffmpegPath, ffArgs);

      let stderr = '';
      exportProcess.stderr.on('data', d => {
        stderr += d.toString();

        // Parse FFmpeg time progress
        const m = stderr.match(/time=(\d{2}):(\d{2}):(\d{2})/);
        if (m) {
          const elapsed = (+m[1])*3600 + (+m[2])*60 + (+m[3]);
          const pct     = Math.min(40 + Math.round(elapsed / videoInfo.duration * 60), 99);
          mainWindow?.webContents.send('export:progress', { phase: 'encode', pct });
          stderr = ''; // trim to avoid huge buffer
        }
      });

      exportProcess.on('close', code => {
        exportProcess = null;
        if (code === 0 || code === null) {
          mainWindow?.webContents.send('export:progress', { phase: 'done', pct: 100 });
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });

      exportProcess.on('error', err => {
        exportProcess = null;
        reject(err);
      });
    });

    return { ok: true, outputPath };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    // Cleanup temp frames
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Auto Updater
// ═════════════════════════════════════════════════════════════════════════════

function setupAutoUpdater() {
  if (!autoUpdater) return;

  // ── Events → renderer ─────────────────────────────────────────────────────
  autoUpdater.on('checking-for-update', () => {
    mainWindow?.webContents.send('updater:status', {
      type: 'checking',
      msg:  'Проверяю обновления…'
    });
  });

  autoUpdater.on('update-available', info => {
    mainWindow?.webContents.send('updater:status', {
      type:    'available',
      msg:     `Доступна версия ${info.version}`,
      version: info.version,
      notes:   info.releaseNotes || ''
    });
  });

  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('updater:status', {
      type: 'up-to-date',
      msg:  'Установлена последняя версия'
    });
  });

  autoUpdater.on('download-progress', progress => {
    mainWindow?.webContents.send('updater:status', {
      type:    'downloading',
      msg:     `Загрузка… ${Math.round(progress.percent)}%`,
      percent: progress.percent,
      speed:   Math.round(progress.bytesPerSecond / 1024)  // KB/s
    });
  });

  autoUpdater.on('update-downloaded', info => {
    mainWindow?.webContents.send('updater:status', {
      type:    'downloaded',
      msg:     `Версия ${info.version} готова к установке`,
      version: info.version
    });
  });

  autoUpdater.on('error', err => {
    mainWindow?.webContents.send('updater:status', {
      type: 'error',
      msg:  'Ошибка обновления: ' + (err.message || String(err))
    });
  });

  // ── IPC ───────────────────────────────────────────────────────────────────
  ipcMain.handle('updater:check',    () => autoUpdater.checkForUpdates());
  ipcMain.handle('updater:download', () => autoUpdater.downloadUpdate());
  ipcMain.handle('updater:install',  () => {
    autoUpdater.quitAndInstall(false, true);
  });

  // Run first check
  autoUpdater.checkForUpdates().catch(() => {});
}
