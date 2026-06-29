/**
 * overlays.js
 * Renders all secondary data overlays (altitude, coordinates) and
 * provides the main compositing function that paints everything onto
 * the live preview canvas.
 */

'use strict';

window.Overlays = (() => {

  // ── Rounded rect helper ───────────────────────────────────────────────────
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Altitude panel
  // ══════════════════════════════════════════════════════════════════════════
  /**
   * drawAltitude(ctx, x, y, opts)
   * opts: { altitude, accentColor, opacity, size }
   */
  function drawAltitude(ctx, x, y, opts) {
    const { altitude = 0, accentColor = '#2563eb', opacity = 0.9, size = 1 } = opts;

    const W = 110 * size;
    const H = 46 * size;
    const R = 8 * size;

    ctx.save();
    ctx.globalAlpha = opacity;

    // Background
    rr(ctx, x, y, W, H, R);
    ctx.fillStyle = 'rgba(8,12,20,0.82)';
    ctx.fill();

    // Left accent bar
    rr(ctx, x, y, 3 * size, H, [R, 0, 0, R]);
    ctx.fillStyle = '#10b981';   // green — altitude is "elevation"
    ctx.fill();

    // Mountain icon  ⛰
    ctx.fillStyle    = '#10b981';
    ctx.font         = `${Math.round(16 * size)}px Inter, sans-serif`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('⛰', x + 8 * size, y + H * 0.38);

    // Label
    ctx.fillStyle    = '#64748b';
    ctx.font         = `500 ${Math.round(9 * size)}px Inter, sans-serif`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('ВЫСОТА', x + 8 * size, y + H * 0.1);

    // Value
    ctx.fillStyle    = '#e2e8f0';
    ctx.font         = `bold ${Math.round(22 * size)}px JetBrains Mono, monospace`;
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(altitude), x + W - 24 * size, y + H / 2);

    // Unit
    ctx.fillStyle    = '#64748b';
    ctx.font         = `${Math.round(9 * size)}px Inter, sans-serif`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('m', x + W - 20 * size, y + H / 2 + 4 * size);

    ctx.restore();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Coordinates panel
  // ══════════════════════════════════════════════════════════════════════════
  /**
   * drawCoords(ctx, x, y, opts)
   * opts: { lat, lon, accentColor, opacity, size }
   */
  function drawCoords(ctx, x, y, opts) {
    const { lat = 0, lon = 0, accentColor = '#2563eb', opacity = 0.9, size = 1 } = opts;

    const W = 170 * size;
    const H = 46 * size;
    const R = 8 * size;

    ctx.save();
    ctx.globalAlpha = opacity;

    rr(ctx, x, y, W, H, R);
    ctx.fillStyle = 'rgba(8,12,20,0.82)';
    ctx.fill();

    rr(ctx, x, y, 3 * size, H, [R, 0, 0, R]);
    ctx.fillStyle = '#22d3ee';
    ctx.fill();

    // Pin emoji label
    ctx.fillStyle    = '#22d3ee';
    ctx.font         = `${Math.round(14 * size)}px Inter, sans-serif`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('📍', x + 8 * size, y + 4 * size);

    ctx.fillStyle    = '#64748b';
    ctx.font         = `500 ${Math.round(9 * size)}px Inter, sans-serif`;
    ctx.fillText('КООРДИНАТЫ', x + 24 * size, y + 5 * size);

    // Lat / Lon values
    const latStr = lat.toFixed(5) + '°';
    const lonStr = lon.toFixed(5) + '°';

    ctx.fillStyle    = '#e2e8f0';
    ctx.font         = `bold ${Math.round(13 * size)}px JetBrains Mono, monospace`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('N ' + latStr, x + 8 * size, y + H * 0.44);

    ctx.fillStyle = '#94a3b8';
    ctx.fillText('E ' + lonStr, x + W / 2 + 4 * size, y + H * 0.44);

    ctx.restore();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Master composite paint
  // Paints all enabled overlays onto the live preview canvas.
  // ══════════════════════════════════════════════════════════════════════════
  /**
   * paintFrame(canvas, gpsPoint, config)
   *
   * gpsPoint: { lat, lon, alt, speed }
   * config:  {
   *   style, size, opacity, accentColor,
   *   unit,  maxSpeed,
   *   showSpeedometer, showMinimap, showAltitude, showCoords,
   *   position: { x, y }   — top-left corner of the speedometer group in canvas px
   *   allPoints            — full GPS array for minimap
   *   currentIndex         — current GPS index
   *   mapSize              — minimap px
   *   trackWidth
   * }
   */
  function paintFrame(canvas, gpsPoint, config) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!gpsPoint) return;

    const {
      style         = 'analog',
      size          = 1,
      opacity       = 0.9,
      accentColor   = '#2563eb',
      unit          = 'km/h',
      maxSpeed      = 200,
      showSpeedometer = true,
      showMinimap     = true,
      showAltitude    = true,
      showCoords      = true,
      position        = { x: 16, y: null },    // null y → bottom-anchored
      allPoints       = [],
      currentIndex    = 0,
      mapSize         = 180,
      trackWidth      = 2
    } = config;

    const speed = unit === 'mph'
      ? (gpsPoint.speed || 0) / 1.609344
      : (gpsPoint.speed || 0);

    const commonOpts = { speed, maxSpeed, unit, accentColor, opacity, size };

    // ── Determine layout origin (bottom-left by default) ───────────────────
    const [sW, sH] = window.Speedometers.getSize(style, size);
    const PAD  = 12;
    const xPos = position.x ?? PAD;
    const yPos = position.y ?? (canvas.height - sH - PAD);

    // ── Draw speedometer ───────────────────────────────────────────────────
    if (showSpeedometer) {
      window.Speedometers.draw(ctx, style, xPos, yPos, commonOpts);
    }

    // ── Draw secondary items stacked below/beside speedometer ─────────────
    // Layout: stack vertically below spedometer, left-aligned
    let stackY = yPos + sH + PAD;

    if (showAltitude) {
      const altH = 46 * size;
      // If stacking would overflow canvas, put it above
      if (stackY + altH > canvas.height - PAD) {
        stackY = yPos - altH - PAD;
      }
      drawAltitude(ctx, xPos, stackY, {
        altitude: gpsPoint.alt || 0,
        accentColor, opacity, size
      });
      stackY += altH + 6;
    }

    if (showCoords) {
      const coordH = 46 * size;
      if (stackY + coordH > canvas.height - PAD) {
        stackY = yPos - (showAltitude ? 46 * size + 6 : 0) - coordH - PAD;
      }
      drawCoords(ctx, xPos, stackY, {
        lat: gpsPoint.lat || 0,
        lon: gpsPoint.lon || 0,
        accentColor, opacity, size
      });
    }

    // ── Mini-map — top-right corner ────────────────────────────────────────
    if (showMinimap && allPoints.length > 1) {
      const mapX = canvas.width - mapSize - PAD;
      const mapY = PAD;
      window.Minimap.drawMinimap(ctx, mapX, mapY, {
        points: allPoints,
        currentIndex,
        size: mapSize,
        accentColor,
        opacity,
        trackWidth
      });
    }
  }

  return { paintFrame, drawAltitude, drawCoords };

})();
