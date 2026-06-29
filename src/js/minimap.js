/**
 * minimap.js
 * Renders the mini-map overlay: full route trace + current position dot.
 * All projection is done inline — no external map tiles needed.
 */

'use strict';

window.Minimap = (() => {

  // ── Lat/lon bounding box → pixel ──────────────────────────────────────────
  function buildProjection(points, mapW, mapH, padding = 14) {
    if (!points || points.length === 0) return null;

    let minLat =  Infinity, maxLat = -Infinity;
    let minLon =  Infinity, maxLon = -Infinity;

    for (const p of points) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }

    // Ensure non-zero range (stationary GPS edge case)
    const latSpan = maxLat - minLat || 0.0001;
    const lonSpan = maxLon - minLon || 0.0001;

    // Scale uniformly to preserve shape
    const innerW = mapW - padding * 2;
    const innerH = mapH - padding * 2;
    const scaleX = innerW / lonSpan;
    const scaleY = innerH / latSpan;
    const scale  = Math.min(scaleX, scaleY);

    // Center the track
    const projW = lonSpan * scale;
    const projH = latSpan * scale;
    const offX  = padding + (innerW - projW) / 2;
    const offY  = padding + (innerH - projH) / 2;

    return {
      project(lat, lon) {
        const px = offX + (lon - minLon) * scale;
        const py = offY + (maxLat - lat) * scale;   // flip Y axis
        return { x: px, y: py };
      }
    };
  }

  /**
   * drawMinimap(ctx, x, y, opts)
   *
   * opts: {
   *   points        Array<{lat, lon, speed}>   full GPS track
   *   currentIndex  number                     index of current position
   *   size          number                     map width/height px
   *   accentColor   string
   *   opacity       number
   *   trackWidth    number
   * }
   */
  function drawMinimap(ctx, x, y, opts) {
    const {
      points       = [],
      currentIndex = 0,
      size         = 180,
      accentColor  = '#2563eb',
      opacity      = 0.9,
      trackWidth   = 2
    } = opts;

    if (!points || points.length < 2) return;

    const S       = size;
    const radius  = 10;

    ctx.save();
    ctx.globalAlpha = opacity;

    // ── Panel background ────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.roundRect(x, y, S, S, radius);
    ctx.fillStyle = 'rgba(8, 12, 20, 0.82)';
    ctx.fill();

    // ── Border ──────────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.roundRect(x, y, S, S, radius);
    ctx.strokeStyle = accentColor + '44';
    ctx.lineWidth   = 1;
    ctx.stroke();

    // Clip content to the rounded panel
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, S - 2, S - 2, radius - 1);
    ctx.clip();

    // ── Grid lines ──────────────────────────────────────────────────────────
    ctx.strokeStyle = '#1e2d47';
    ctx.lineWidth   = 0.5;
    const gridStep = S / 4;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x + gridStep * i, y);
      ctx.lineTo(x + gridStep * i, y + S);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x, y + gridStep * i);
      ctx.lineTo(x + S, y + gridStep * i);
      ctx.stroke();
    }

    // ── Build projection ─────────────────────────────────────────────────────
    const proj = buildProjection(points, S, S);
    if (!proj) { ctx.restore(); return; }

    // ── Walked portion of route (behind current pos) — dimmed accent ─────────
    if (currentIndex > 0) {
      ctx.beginPath();
      const p0 = proj.project(points[0].lat, points[0].lon);
      ctx.moveTo(x + p0.x, y + p0.y);
      for (let i = 1; i <= currentIndex; i++) {
        const pt = proj.project(points[i].lat, points[i].lon);
        ctx.lineTo(x + pt.x, y + pt.y);
      }
      ctx.strokeStyle = accentColor + 'aa';
      ctx.lineWidth   = trackWidth + 0.5;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.stroke();
    }

    // ── Full route (remaining) — dimmed ──────────────────────────────────────
    ctx.beginPath();
    const startIdx = Math.max(0, currentIndex);
    const start    = proj.project(points[startIdx].lat, points[startIdx].lon);
    ctx.moveTo(x + start.x, y + start.y);
    for (let i = startIdx + 1; i < points.length; i++) {
      const pt = proj.project(points[i].lat, points[i].lon);
      ctx.lineTo(x + pt.x, y + pt.y);
    }
    ctx.strokeStyle = '#334155';
    ctx.lineWidth   = trackWidth;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.stroke();

    // ── Start marker (hollow circle) ─────────────────────────────────────────
    const sp = proj.project(points[0].lat, points[0].lon);
    ctx.beginPath();
    ctx.arc(x + sp.x, y + sp.y, 4, 0, Math.PI * 2);
    ctx.fillStyle   = '#10b981';
    ctx.fill();

    // ── Current position ─────────────────────────────────────────────────────
    const idx = Math.min(currentIndex, points.length - 1);
    const cp  = proj.project(points[idx].lat, points[idx].lon);
    const cpX = x + cp.x;
    const cpY = y + cp.y;

    // Pulse ring
    ctx.beginPath();
    ctx.arc(cpX, cpY, 9, 0, Math.PI * 2);
    ctx.fillStyle = accentColor + '33';
    ctx.fill();

    // Dot
    ctx.beginPath();
    ctx.arc(cpX, cpY, 5, 0, Math.PI * 2);
    ctx.fillStyle   = '#fff';
    ctx.shadowColor = accentColor;
    ctx.shadowBlur  = 10;
    ctx.fill();
    ctx.shadowBlur  = 0;

    // ── "MAP" label ──────────────────────────────────────────────────────────
    ctx.fillStyle    = '#334155';
    ctx.font         = `500 9px Inter, sans-serif`;
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('GPS TRACK', x + S - 7, y + 6);

    ctx.restore();
  }

  return { drawMinimap };

})();
