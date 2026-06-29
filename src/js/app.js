/**
 * app.js
 * Main application controller.
 * Wires all UI interactions: file opening, GPS extraction, live preview,
 * drag-and-drop overlay positioning, timeline scrubbing, and export modal.
 */

'use strict';

(async () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════════════════════
  const state = {
    videoPath:    null,
    videoInfo:    null,
    gpsLoaded:    false,

    // Overlay config (mirrors what overlays.js / export.js need)
    style:          'analog',
    size:           1.0,
    opacity:        0.9,
    accentColor:    '#2563eb',
    unit:           'kmh',          // 'kmh' | 'mph'
    maxSpeed:       'auto',         // number | 'auto'
    smoothWindow:   5,

    showSpeedometer: true,
    showMinimap:     true,
    showAltitude:    true,
    showCoords:      true,

    position:       { x: 16, y: null },    // null y = bottom-anchored at paint time
    positionPreset: 'bl',

    mapSize:     180,
    trackWidth:  2,

    // Playback
    isPlaying:       false,
    rafId:           null,

    // Drag state
    dragging:        false,
    dragStartX:      0,
    dragStartY:      0,
    dragOrigX:       0,
    dragOrigY:       0,

    // Export
    exporting:       false,
    cancelExport:    null
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // DOM refs
  // ═══════════════════════════════════════════════════════════════════════════
  const $ = id => document.getElementById(id);

  const els = {
    dropZone:       $('drop-zone'),
    playerContainer:$('player-container'),
    playerWrapper:  $('player-wrapper'),
    video:          $('video-el'),
    overlayCanvas:  $('overlay-canvas'),
    timelineBar:    $('timeline-bar'),
    timelineFill:   $('timeline-fill'),
    timelineThumb:  $('timeline-thumb'),
    timelineTrack:  $('timeline-track'),
    timeCurrent:    $('time-current'),
    timeTotal:      $('time-total'),
    btnPlay:        $('btn-play'),
    iconPlay:       $('icon-play'),
    iconPause:      $('icon-pause'),
    liveSpeed:      $('live-speed'),
    liveUnit:       $('live-unit'),
    btnOpenVideo:   $('btn-open-video'),
    btnExport:      $('btn-export'),
    btnImportGPX:   $('btn-import-gpx'),
    gpsStatus:      $('gps-status'),
    gpsStatusText:  $('gps-status-text'),
    gpsStats:       $('gps-stats'),
    statPoints:     $('stat-points'),
    statMaxspeed:   $('stat-maxspeed'),
    statDist:       $('stat-dist'),
    sliderSize:     $('slider-size'),
    valSize:        $('val-size'),
    sliderOpacity:  $('slider-opacity'),
    valOpacity:     $('val-opacity'),
    sliderMapSize:  $('slider-map-size'),
    valMapSize:     $('val-map-size'),
    sliderTrack:    $('slider-track-width'),
    sliderSmooth:   $('slider-smooth'),
    valSmooth:      $('val-smooth'),
    infoRes:        $('info-res'),
    infoFps:        $('info-fps'),
    infoCodec:      $('info-codec'),
    infoDur:        $('info-dur'),
    exportModal:    $('export-modal'),
    exportProgress: $('export-progress-wrap'),
    progressPhase:  $('progress-phase'),
    progressPct:    $('progress-pct'),
    progressBar:    $('progress-bar'),
    btnStartExport: $('btn-start-export'),
    btnCancelExport:$('btn-cancel-export'),
    expCodec:       $('exp-codec'),
    expCrf:         $('exp-crf'),
    expPreset:      $('exp-preset'),
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Init — load persisted settings
  // ═══════════════════════════════════════════════════════════════════════════
  async function init() {
    const saved = await window.electronAPI.getAllSettings();
    state.unit          = saved.speedUnit    || 'kmh';
    state.opacity       = saved.overlayOpacity ?? 0.9;
    state.size          = saved.overlaySize    ?? 1.0;
    state.style         = saved.speedometerStyle || 'analog';
    state.showMinimap   = saved.showMinimap   ?? true;
    state.showCoords    = saved.showCoords    ?? true;
    state.showAltitude  = saved.showAltitude  ?? true;

    syncUIToState();
    drawStylePreviews();
    bindEvents();
    bindExportProgress();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Sync UI controls → state values
  // ═══════════════════════════════════════════════════════════════════════════
  function syncUIToState() {
    els.sliderSize.value    = Math.round(state.size * 100);
    els.valSize.textContent = Math.round(state.size * 100) + '%';
    els.sliderOpacity.value    = Math.round(state.opacity * 100);
    els.valOpacity.textContent = Math.round(state.opacity * 100) + '%';

    document.querySelectorAll('[data-style]').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.style === state.style)
    );
    document.querySelectorAll('.color-dot').forEach(d =>
      d.classList.toggle('active', d.dataset.color === state.accentColor)
    );

    $('tog-speedometer').checked = state.showSpeedometer;
    $('tog-minimap').checked     = state.showMinimap;
    $('tog-altitude').checked    = state.showAltitude;
    $('tog-coords').checked      = state.showCoords;

    // Settings tab
    document.querySelectorAll('[name=speed-unit]').forEach(r => {
      r.checked = r.value === state.unit;
    });
    els.liveUnit.textContent = state.unit === 'mph' ? 'mph' : 'km/h';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Style preview thumbnails
  // ═══════════════════════════════════════════════════════════════════════════
  function drawStylePreviews() {
    ['analog', 'digital', 'arc', 'minimal'].forEach(s => {
      const c = document.getElementById('prev-' + s);
      if (c) window.Speedometers.drawPreview(c, s, state.accentColor);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Event bindings
  // ═══════════════════════════════════════════════════════════════════════════
  function bindEvents() {

    // ── Tab switching ─────────────────────────────────────────────────────
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + tab).classList.add('active');
      });
    });

    // ── Open video ────────────────────────────────────────────────────────
    els.btnOpenVideo.addEventListener('click', openVideo);

    // ── Drag-and-drop file onto window ────────────────────────────────────
    document.addEventListener('dragover', e => {
      e.preventDefault();
      els.dropZone.classList.add('drag-over');
    });
    document.addEventListener('dragleave', e => {
      if (!e.relatedTarget) els.dropZone.classList.remove('drag-over');
    });
    document.addEventListener('drop', async e => {
      e.preventDefault();
      els.dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && /\.(mp4|mov|avi|mkv)$/i.test(file.name)) {
        await loadVideo(file.path);
      }
    });

    // ── Import GPX ────────────────────────────────────────────────────────
    els.btnImportGPX.addEventListener('click', async () => {
      const result = await window.electronAPI.openGPXDialog();
      if (!result.canceled && result.filePaths[0]) {
        await loadGPXFile(result.filePaths[0]);
      }
    });

    // ── Style picker ──────────────────────────────────────────────────────
    document.querySelectorAll('[data-style]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.style = btn.dataset.style;
        document.querySelectorAll('[data-style]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        window.electronAPI.setSetting('speedometerStyle', state.style);
        renderOverlay();
      });
    });

    // ── Color picker ──────────────────────────────────────────────────────
    document.querySelectorAll('.color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        state.accentColor = dot.dataset.color;
        document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        drawStylePreviews();
        renderOverlay();
      });
    });

    // ── Size slider ───────────────────────────────────────────────────────
    els.sliderSize.addEventListener('input', () => {
      state.size = els.sliderSize.value / 100;
      els.valSize.textContent = els.sliderSize.value + '%';
      window.electronAPI.setSetting('overlaySize', state.size);
      renderOverlay();
    });

    // ── Opacity slider ────────────────────────────────────────────────────
    els.sliderOpacity.addEventListener('input', () => {
      state.opacity = els.sliderOpacity.value / 100;
      els.valOpacity.textContent = els.sliderOpacity.value + '%';
      window.electronAPI.setSetting('overlayOpacity', state.opacity);
      renderOverlay();
    });

    // ── Map size slider ───────────────────────────────────────────────────
    els.sliderMapSize.addEventListener('input', () => {
      state.mapSize = parseInt(els.sliderMapSize.value);
      els.valMapSize.textContent = state.mapSize + 'px';
      renderOverlay();
    });

    // ── Track width slider ────────────────────────────────────────────────
    els.sliderTrack.addEventListener('input', () => {
      state.trackWidth = parseInt(els.sliderTrack.value);
      renderOverlay();
    });

    // ── Smooth slider (settings tab) ──────────────────────────────────────
    els.sliderSmooth.addEventListener('input', () => {
      state.smoothWindow = parseInt(els.sliderSmooth.value);
      els.valSmooth.textContent = state.smoothWindow + ' точек';
      window.GPS.resmooth(state.smoothWindow);
      renderOverlay();
    });

    // ── Overlay toggles ───────────────────────────────────────────────────
    $('tog-speedometer').addEventListener('change', e => {
      state.showSpeedometer = e.target.checked; renderOverlay();
    });
    $('tog-minimap').addEventListener('change', e => {
      state.showMinimap = e.target.checked;
      window.electronAPI.setSetting('showMinimap', state.showMinimap);
      renderOverlay();
    });
    $('tog-altitude').addEventListener('change', e => {
      state.showAltitude = e.target.checked;
      window.electronAPI.setSetting('showAltitude', state.showAltitude);
      renderOverlay();
    });
    $('tog-coords').addEventListener('change', e => {
      state.showCoords = e.target.checked;
      window.electronAPI.setSetting('showCoords', state.showCoords);
      renderOverlay();
    });

    // ── Position preset grid ──────────────────────────────────────────────
    document.querySelectorAll('.pos-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.positionPreset = btn.dataset.pos;
        document.querySelectorAll('.pos-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyPositionPreset(btn.dataset.pos);
      });
    });

    // ── Speed unit (settings tab) ─────────────────────────────────────────
    document.querySelectorAll('[name=speed-unit]').forEach(r => {
      r.addEventListener('change', () => {
        state.unit = r.value;
        els.liveUnit.textContent = state.unit === 'mph' ? 'mph' : 'km/h';
        window.electronAPI.setSetting('speedUnit', state.unit);
        renderOverlay();
      });
    });

    // ── Playback controls ─────────────────────────────────────────────────
    els.btnPlay.addEventListener('click', togglePlay);

    els.video.addEventListener('timeupdate', onTimeUpdate);
    els.video.addEventListener('ended',      () => setPlaying(false));

    // Timeline scrub
    els.timelineTrack.addEventListener('click', onTimelineClick);
    els.timelineTrack.addEventListener('mousedown', e => {
      const scrub = ev => onTimelineClick(ev);
      document.addEventListener('mousemove', scrub);
      document.addEventListener('mouseup', () => {
        document.removeEventListener('mousemove', scrub);
      }, { once: true });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.code === 'ArrowRight') seekBy(5);
      if (e.code === 'ArrowLeft')  seekBy(-5);
    });

    // ── Export ────────────────────────────────────────────────────────────
    els.btnExport.addEventListener('click', showExportModal);
    els.btnStartExport.addEventListener('click', startExport);
    els.btnCancelExport.addEventListener('click', () => {
      if (state.exporting) {
        window.electronAPI.cancelExport();
        state.exporting = false;
        hideExportModal();
      } else {
        hideExportModal();
      }
    });

    // ── Overlay drag on canvas ────────────────────────────────────────────
    els.overlayCanvas.style.pointerEvents = 'auto';
    els.overlayCanvas.style.cursor        = 'move';

    els.overlayCanvas.addEventListener('mousedown', onDragStart);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup',   onDragEnd);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Open / load video
  // ═══════════════════════════════════════════════════════════════════════════
  async function openVideo() {
    const result = await window.electronAPI.openVideoDialog();
    if (result.canceled || !result.filePaths[0]) return;
    await loadVideo(result.filePaths[0]);
  }

  async function loadVideo(filePath) {
    state.videoPath = filePath;

    // Show player
    els.dropZone.classList.add('hidden');
    els.playerContainer.classList.remove('hidden');
    els.timelineBar.classList.remove('hidden');

    // Set video source
    els.video.src = 'file://' + filePath.replace(/\\/g, '/');
    await new Promise(r => els.video.addEventListener('loadedmetadata', r, { once: true }));

    // Fetch video metadata
    const info = await window.electronAPI.getVideoInfo(filePath);
    state.videoInfo = info;
    updateVideoInfoPanel(info);

    // Resize canvas to match video element
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Init timeline
    els.timeTotal.textContent = formatTime(info.duration || els.video.duration);

    // Enable export
    els.btnExport.disabled = false;

    // Try auto-extract GPS
    setGpsStatus('loading', 'Извлекаю GPS…');
    const gpsResult = await window.electronAPI.extractGPS(filePath);

    if (gpsResult.ok && gpsResult.data?.length > 2) {
      loadGpsPoints(gpsResult.data);
    } else {
      setGpsStatus('error', 'GPS не найден — импортируйте GPX');
    }

    renderOverlay();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GPS loading
  // ═══════════════════════════════════════════════════════════════════════════
  async function loadGPXFile(gpxPath) {
    setGpsStatus('loading', 'Читаю GPX файл…');
    const result = await window.electronAPI.parseGPX(gpxPath);
    if (result.ok && result.data?.length > 1) {
      loadGpsPoints(result.data);
    } else {
      setGpsStatus('error', result.error || 'Ошибка чтения GPX');
    }
  }

  function loadGpsPoints(points) {
    window.GPS.load(points, state.smoothWindow);
    state.gpsLoaded = true;

    const count    = window.GPS.getCount();
    const maxSpd   = window.GPS.getMaxSpeed().toFixed(0);
    const distKm   = window.GPS.getTotalDistKm().toFixed(2);

    setGpsStatus('ok', `${count} точек GPS · синхронизировано`);

    els.gpsStats.classList.remove('hidden');
    els.statPoints.textContent   = count;
    els.statMaxspeed.textContent = maxSpd + ' km/h';
    els.statDist.textContent     = distKm + ' km';

    renderOverlay();
  }

  function setGpsStatus(type, text) {
    els.gpsStatus.className = 'gps-status status-' + type;
    els.gpsStatusText.textContent = text;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Canvas resize
  // ═══════════════════════════════════════════════════════════════════════════
  function resizeCanvas() {
    const video  = els.video;
    const canvas = els.overlayCanvas;
    canvas.width  = video.videoWidth  || video.clientWidth;
    canvas.height = video.videoHeight || video.clientHeight;
    canvas.style.width  = '100%';
    canvas.style.height = '100%';
    renderOverlay();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Render overlay frame at current playback time
  // ═══════════════════════════════════════════════════════════════════════════
  function renderOverlay() {
    if (!state.videoInfo) return;

    const canvas = els.overlayCanvas;
    const time   = els.video.currentTime || 0;
    const point  = state.gpsLoaded ? window.GPS.atTime(time) : mockGPSPoint();

    const autoMax = window.GPS.suggestMaxSpeed(state.unit);

    const config = {
      style:          state.style,
      size:           state.size,
      opacity:        state.opacity,
      accentColor:    state.accentColor,
      unit:           state.unit === 'mph' ? 'mph' : 'km/h',
      maxSpeed:       state.maxSpeed === 'auto' ? autoMax : parseInt(state.maxSpeed),
      showSpeedometer: state.showSpeedometer,
      showMinimap:    state.showMinimap,
      showAltitude:   state.showAltitude,
      showCoords:     state.showCoords,
      position:       state.position,
      allPoints:      window.GPS.getAll(),
      currentIndex:   state.gpsLoaded ? window.GPS.nearestIndex(time) : 0,
      mapSize:        state.mapSize,
      trackWidth:     state.trackWidth,
      _previewSize:   { width: canvas.width, height: canvas.height }
    };

    window.Overlays.paintFrame(canvas, point, config);

    // Update live speed readout
    if (point) {
      const spd = state.unit === 'mph' ? point.speed / 1.609344 : point.speed;
      els.liveSpeed.textContent = Math.round(spd);
    }
  }

  function mockGPSPoint() {
    return { lat: 48.8584, lon: 2.2945, alt: 43, speed: 0 };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Playback
  // ═══════════════════════════════════════════════════════════════════════════
  function togglePlay() {
    if (els.video.paused) {
      els.video.play();
      setPlaying(true);
    } else {
      els.video.pause();
      setPlaying(false);
    }
  }

  function setPlaying(val) {
    state.isPlaying = val;
    els.iconPlay.classList.toggle('hidden', val);
    els.iconPause.classList.toggle('hidden', !val);

    if (val) {
      scheduleRaf();
    } else {
      cancelAnimationFrame(state.rafId);
    }
  }

  function scheduleRaf() {
    state.rafId = requestAnimationFrame(() => {
      renderOverlay();
      if (!els.video.paused) scheduleRaf();
    });
  }

  function onTimeUpdate() {
    const t   = els.video.currentTime;
    const dur = els.video.duration || 1;
    const pct = t / dur * 100;

    els.timelineFill.style.width = pct + '%';
    els.timelineThumb.style.left = pct + '%';
    els.timeCurrent.textContent  = formatTime(t);
    renderOverlay();
  }

  function onTimelineClick(e) {
    const rect = els.timelineTrack.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    els.video.currentTime = pct * (els.video.duration || 0);
  }

  function seekBy(sec) {
    els.video.currentTime = Math.max(0,
      Math.min(els.video.duration || 0, els.video.currentTime + sec));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Drag-and-drop overlay repositioning
  // ═══════════════════════════════════════════════════════════════════════════
  function onDragStart(e) {
    state.dragging  = true;
    state.dragStartX = e.clientX;
    state.dragStartY = e.clientY;

    const canvas = els.overlayCanvas;
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;

    // Current position in canvas coords
    const [sW, sH] = window.Speedometers.getSize(state.style, state.size);
    state.dragOrigX = state.position.x ?? 16;
    state.dragOrigY = state.position.y ?? (canvas.height - sH - 12);

    // Deactivate all preset buttons (custom positioning)
    document.querySelectorAll('.pos-btn').forEach(b => b.classList.remove('active'));
    state.positionPreset = null;
  }

  function onDragMove(e) {
    if (!state.dragging) return;

    const canvas  = els.overlayCanvas;
    const rect    = canvas.getBoundingClientRect();
    const scaleX  = canvas.width  / rect.width;
    const scaleY  = canvas.height / rect.height;

    const dx = (e.clientX - state.dragStartX) * scaleX;
    const dy = (e.clientY - state.dragStartY) * scaleY;

    const [sW, sH] = window.Speedometers.getSize(state.style, state.size);
    const newX = Math.max(0, Math.min(canvas.width  - sW, state.dragOrigX + dx));
    const newY = Math.max(0, Math.min(canvas.height - sH, state.dragOrigY + dy));

    state.position = { x: newX, y: newY };
    renderOverlay();
  }

  function onDragEnd() {
    state.dragging = false;
  }

  // ── Preset position mapping ───────────────────────────────────────────────
  function applyPositionPreset(preset) {
    const canvas   = els.overlayCanvas;
    const [sW, sH] = window.Speedometers.getSize(state.style, state.size);
    const PAD      = 16;
    const cW       = canvas.width  || 1920;
    const cH       = canvas.height || 1080;

    const map = {
      tl: { x: PAD,              y: PAD },
      tc: { x: (cW - sW) / 2,   y: PAD },
      tr: { x: cW - sW - PAD,   y: PAD },
      ml: { x: PAD,              y: (cH - sH) / 2 },
      mc: { x: (cW - sW) / 2,   y: (cH - sH) / 2 },
      mr: { x: cW - sW - PAD,   y: (cH - sH) / 2 },
      bl: { x: PAD,              y: cH - sH - PAD },
      bc: { x: (cW - sW) / 2,   y: cH - sH - PAD },
      br: { x: cW - sW - PAD,   y: cH - sH - PAD },
    };

    state.position = map[preset] || map.bl;
    renderOverlay();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Video info panel
  // ═══════════════════════════════════════════════════════════════════════════
  function updateVideoInfoPanel(info) {
    els.infoRes.textContent   = info.width + '×' + info.height;
    els.infoFps.textContent   = info.fps + ' fps';
    els.infoCodec.textContent = (info.codec || '—').toUpperCase();
    els.infoDur.textContent   = formatTime(info.duration);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Export modal
  // ═══════════════════════════════════════════════════════════════════════════
  function showExportModal() {
    els.exportModal.classList.remove('hidden');
    els.exportProgress.classList.add('hidden');
    els.btnStartExport.disabled = false;
    els.btnCancelExport.textContent = 'Отмена';

    // Pre-fill defaults from settings tab
    els.expCodec.value  = $('default-codec')?.value || 'h264';
    els.expCrf.value    = $('default-crf')?.value   || '20';
    els.expPreset.value = $('default-preset')?.value || 'medium';
  }

  function hideExportModal() {
    els.exportModal.classList.add('hidden');
    state.exporting = false;
  }

  async function startExport() {
    if (!state.videoPath || !state.gpsLoaded) {
      alert('Нет видео или GPS-данных для экспорта.');
      return;
    }

    // Choose output file
    const baseName = state.videoPath.replace(/\\/g, '/').split('/').pop().replace(/\.\w+$/, '');
    const saveResult = await window.electronAPI.saveVideoDialog(baseName + '_overlay.mp4');
    if (saveResult.canceled || !saveResult.filePath) return;

    state.exporting = true;
    els.exportProgress.classList.remove('hidden');
    els.btnStartExport.disabled  = true;
    els.btnCancelExport.textContent = 'Отменить экспорт';
    setProgress('Рендеринг кадров…', 0);

    const config = {
      style:          state.style,
      size:           state.size,
      opacity:        state.opacity,
      accentColor:    state.accentColor,
      unit:           state.unit === 'mph' ? 'mph' : 'km/h',
      maxSpeed:       state.maxSpeed === 'auto'
                        ? window.GPS.suggestMaxSpeed(state.unit)
                        : parseInt(state.maxSpeed),
      showSpeedometer: state.showSpeedometer,
      showMinimap:    state.showMinimap,
      showAltitude:   state.showAltitude,
      showCoords:     state.showCoords,
      position:       state.position,
      mapSize:        state.mapSize,
      trackWidth:     state.trackWidth,
      _previewSize:   {
        width:  els.overlayCanvas.width,
        height: els.overlayCanvas.height
      }
    };

    await window.ExportPipeline.run({
      videoPath:   state.videoPath,
      outputPath:  saveResult.filePath,
      videoInfo:   state.videoInfo,
      config,
      exportOpts:  {
        codec:  els.expCodec.value,
        crf:    parseInt(els.expCrf.value),
        preset: els.expPreset.value
      },
      onRenderProgress: pct => setProgress('Рендеринг кадров…', pct * 0.4),
      onEncodeProgress: pct => setProgress('Кодирование видео…', 40 + pct * 0.6),
      onDone: outPath => {
        state.exporting = false;
        setProgress('Готово!', 100);
        els.btnCancelExport.textContent = 'Закрыть';
        els.btnCancelExport.onclick = async () => {
          hideExportModal();
          await window.electronAPI.openPath(outPath.replace(/[^/\\]+$/, ''));
          els.btnCancelExport.onclick = () => {
            if (state.exporting) { window.electronAPI.cancelExport(); }
            hideExportModal();
          };
        };
      },
      onError: msg => {
        state.exporting = false;
        setProgress('Ошибка: ' + msg, 0);
        els.btnCancelExport.textContent = 'Закрыть';
      }
    });
  }

  function bindExportProgress() {
    window.electronAPI.onExportProgress(data => {
      if (data.phase === 'frames') setProgress('Рендеринг кадров…',   data.pct);
      if (data.phase === 'encode') setProgress('Кодирование видео…',  data.pct);
      if (data.phase === 'done')   setProgress('Готово!',             100);
    });
  }

  function setProgress(label, pct) {
    els.progressPhase.textContent    = label;
    els.progressPct.textContent      = Math.round(pct) + '%';
    els.progressBar.style.width      = Math.round(pct) + '%';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Utilities
  // ═══════════════════════════════════════════════════════════════════════════
  function formatTime(s) {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return m + ':' + sec;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Boot
  // ═══════════════════════════════════════════════════════════════════════════
  init().catch(console.error);

})();
