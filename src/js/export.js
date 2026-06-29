/**
 * export.js
 * Coordinates the export pipeline:
 *   1. Pre-renders every GPS-keyed overlay frame to data URLs (PNG)
 *   2. Passes them + settings to main.js via IPC for FFmpeg compositing
 */

'use strict';

window.ExportPipeline = (() => {

  /**
   * generateOverlayFrames(videoInfo, config)
   *
   * Creates a temporary off-screen canvas at full video resolution and
   * renders one overlay PNG per GPS sample, at the GPS sample rate.
   * Returns Array<{ time, dataUrl }>.
   */
  async function generateOverlayFrames(videoInfo, config, onProgress) {
    const { width, height, duration } = videoInfo;
    const gpsPoints = window.GPS.getAll();

    if (!gpsPoints || gpsPoints.length === 0) {
      throw new Error('Нет GPS-данных для рендеринга.');
    }

    // Off-screen canvas at full resolution
    const canvas = document.createElement('canvas');
    canvas.width  = width;
    canvas.height = height;

    // Scale factor: video resolution vs preview resolution.
    // overlays.js uses "size" multiplier (base 200px) — recalculate for full res.
    const previewScaleBase = 200;
    const videoScale = (height / 1080) * config.size;

    const frames     = [];
    const total      = gpsPoints.length;

    for (let i = 0; i < total; i++) {
      const point = gpsPoints[i];
      const time  = point.timestamp;

      window.Overlays.paintFrame(canvas, point, {
        ...config,
        size:        videoScale,
        allPoints:   gpsPoints,
        currentIndex: i,
        // Scale position from preview canvas to video canvas
        position: scalePosition(config.position, config._previewSize, { width, height })
      });

      const dataUrl = canvas.toDataURL('image/png');
      frames.push({ time, dataUrl });

      if (i % 10 === 0 && onProgress) {
        onProgress(Math.round(i / total * 100));
        // Yield to UI thread
        await new Promise(r => setTimeout(r, 0));
      }
    }

    return frames;
  }

  /**
   * Scale overlay position from preview canvas coords to full video resolution.
   */
  function scalePosition(pos, previewSize, videoSize) {
    if (!pos || !previewSize) return pos;
    const scaleX = videoSize.width  / previewSize.width;
    const scaleY = videoSize.height / previewSize.height;
    return {
      x: Math.round(pos.x * scaleX),
      y: pos.y !== null ? Math.round(pos.y * scaleY) : null
    };
  }

  /**
   * run(videoPath, outputPath, videoInfo, config, exportOpts)
   *
   * Full pipeline: frame generation → send to main → listen for progress.
   */
  async function run({
    videoPath,
    outputPath,
    videoInfo,
    config,
    exportOpts,
    onRenderProgress,
    onEncodeProgress,
    onDone,
    onError
  }) {
    try {
      // Phase 1: render frames in renderer process
      const frames = await generateOverlayFrames(
        videoInfo,
        config,
        pct => onRenderProgress && onRenderProgress(pct)
      );

      // Phase 2: send to main process for FFmpeg
      const overlayConfig = {
        x:      config.position?.x ?? 16,
        y:      config.position?.y ?? (videoInfo.height - 220),
        width:  videoInfo.width,
        height: videoInfo.height
      };

      const result = await window.electronAPI.startExport({
        videoPath,
        outputPath,
        overlayFrames: frames,
        overlayConfig,
        videoInfo,
        codec:  exportOpts.codec,
        crf:    exportOpts.crf,
        preset: exportOpts.preset
      });

      if (result.ok) {
        onDone && onDone(result.outputPath);
      } else {
        throw new Error(result.error);
      }
    } catch (err) {
      onError && onError(err.message || String(err));
    }
  }

  return { run, generateOverlayFrames };

})();
