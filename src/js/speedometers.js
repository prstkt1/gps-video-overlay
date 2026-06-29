/**
 * speedometers.js
 * Renders all 4 speedometer styles onto a Canvas 2D context.
 * All functions are pure — they only write to ctx and do not modify DOM.
 */

'use strict';

window.Speedometers = (() => {

  // ── Helpers ────────────────────────────────────────────────────────────────
  function lerp(a, b, t) { return a + (b - a) * t; }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function polarX(cx, cy, r, deg) {
    return cx + r * Math.cos((deg - 90) * Math.PI / 180);
  }
  function polarY(cx, cy, r, deg) {
    return cy + r * Math.sin((deg - 90) * Math.PI / 180);
  }

  // Rounded rectangle utility
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /**
   * Common options: { speed, maxSpeed, unit, accentColor, opacity, size }
   * size is a multiplier (1.0 = base 200×200)
   */
  const BASE = 200;   // base canvas dimension for speedometer element

  // ══════════════════════════════════════════════════════════════════════════
  // 1. ANALOG — Classic gauge with needle
  // ══════════════════════════════════════════════════════════════════════════
  function drawAnalog(ctx, x, y, opts) {
    const { speed = 0, maxSpeed = 200, accentColor = '#2563eb', opacity = 0.9, size = 1 } = opts;
    const S   = BASE * size;
    const cx  = x + S / 2;
    const cy  = y + S / 2;
    const R   = S / 2 - 4;
    const pct = clamp(speed / maxSpeed, 0, 1);

    // Gauge arc: from -135° to +135°  (270° sweep)
    const startDeg = -135;
    const sweepDeg = 270;
    const needleDeg = startDeg + sweepDeg * pct;

    ctx.save();
    ctx.globalAlpha = opacity;

    // ── Background disc ──────────────────────────────────────────────────
    const bgGrad = ctx.createRadialGradient(cx, cy - S * 0.1, 0, cx, cy, R);
    bgGrad.addColorStop(0, '#1a2337');
    bgGrad.addColorStop(1, '#080c14');
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = bgGrad;
    ctx.fill();

    // ── Outer ring ────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = '#1e2d47';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // ── Tick marks ────────────────────────────────────────────────────────
    const numTicks = 9;    // labelled ticks  (0 … maxSpeed)
    const numMini  = 4;    // mini-ticks between each

    for (let i = 0; i <= numTicks; i++) {
      const angle = (startDeg + sweepDeg * (i / numTicks)) * Math.PI / 180;
      const outerR = R - 6;
      const innerR = R - 16;

      const cosA = Math.cos(angle - Math.PI / 2);
      const sinA = Math.sin(angle - Math.PI / 2);

      ctx.beginPath();
      ctx.moveTo(cx + outerR * cosA, cy + outerR * sinA);
      ctx.lineTo(cx + innerR * cosA, cy + innerR * sinA);
      ctx.strokeStyle = '#4b6080';
      ctx.lineWidth   = 2;
      ctx.lineCap     = 'round';
      ctx.stroke();

      // Speed label
      const labelR = R - 30;
      const spd    = Math.round((maxSpeed / numTicks) * i);
      ctx.fillStyle   = '#94a3b8';
      ctx.font        = `bold ${Math.round(S * 0.065)}px JetBrains Mono, monospace`;
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(spd, cx + labelR * cosA, cy + labelR * sinA);
    }

    // Mini ticks
    for (let i = 0; i <= numTicks * numMini; i++) {
      if (i % numMini === 0) continue;
      const angle = (startDeg + sweepDeg * (i / (numTicks * numMini))) * Math.PI / 180;
      const outerR = R - 6;
      const innerR = R - 12;
      const cosA = Math.cos(angle - Math.PI / 2);
      const sinA = Math.sin(angle - Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(cx + outerR * cosA, cy + outerR * sinA);
      ctx.lineTo(cx + innerR * cosA, cy + innerR * sinA);
      ctx.strokeStyle = '#2a3a52';
      ctx.lineWidth   = 1;
      ctx.stroke();
    }

    // ── Colored arc (progress) ────────────────────────────────────────────
    const arcStart = (startDeg - 90) * Math.PI / 180;
    const arcEnd   = (needleDeg - 90) * Math.PI / 180;
    const arcR     = R - 7;

    // Red zone (last 20%)
    ctx.beginPath();
    ctx.arc(cx, cy, arcR, (startDeg + sweepDeg * 0.8 - 90) * Math.PI / 180,
                           (startDeg + sweepDeg - 90) * Math.PI / 180);
    ctx.strokeStyle = 'rgba(239,68,68,0.25)';
    ctx.lineWidth   = 4;
    ctx.stroke();

    // Active arc
    if (pct > 0) {
      const activeGrad = ctx.createLinearGradient(
        cx - arcR, cy, cx + arcR, cy
      );
      activeGrad.addColorStop(0, accentColor);
      activeGrad.addColorStop(1, '#22d3ee');

      ctx.beginPath();
      ctx.arc(cx, cy, arcR, arcStart, arcEnd);
      ctx.strokeStyle = activeGrad;
      ctx.lineWidth   = 4;
      ctx.lineCap     = 'round';
      ctx.shadowColor = accentColor;
      ctx.shadowBlur  = 8;
      ctx.stroke();
      ctx.shadowBlur  = 0;
    }

    // ── Needle ────────────────────────────────────────────────────────────
    const needleRad = needleDeg * Math.PI / 180;
    const nLen  = R * 0.60;
    const nBack = R * 0.15;
    const cosN  = Math.cos(needleRad - Math.PI / 2);
    const sinN  = Math.sin(needleRad - Math.PI / 2);

    ctx.beginPath();
    ctx.moveTo(cx - nBack * cosN, cy - nBack * sinN);
    ctx.lineTo(cx + nLen * cosN,  cy + nLen * sinN);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.shadowColor = 'rgba(255,255,255,0.5)';
    ctx.shadowBlur  = 6;
    ctx.stroke();
    ctx.shadowBlur  = 0;

    // Needle cap
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.07, 0, Math.PI * 2);
    ctx.fillStyle = accentColor;
    ctx.fill();

    // ── Digital speed readout in center ──────────────────────────────────
    const speedStr = Math.round(speed).toString();
    ctx.fillStyle   = '#fff';
    ctx.font        = `bold ${Math.round(S * 0.18)}px JetBrains Mono, monospace`;
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(speedStr, cx, cy + R * 0.28);

    ctx.fillStyle   = '#64748b';
    ctx.font        = `${Math.round(S * 0.07)}px Inter, sans-serif`;
    ctx.fillText(opts.unit || 'km/h', cx, cy + R * 0.44);

    ctx.restore();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. DIGITAL — LCD-style readout
  // ══════════════════════════════════════════════════════════════════════════
  function drawDigital(ctx, x, y, opts) {
    const { speed = 0, maxSpeed = 200, accentColor = '#2563eb', opacity = 0.9, size = 1 } = opts;
    const W = BASE * size * 1.1;
    const H = BASE * size * 0.65;

    ctx.save();
    ctx.globalAlpha = opacity;

    // Background panel
    roundRect(ctx, x, y, W, H, 12 * size);
    const panelGrad = ctx.createLinearGradient(x, y, x, y + H);
    panelGrad.addColorStop(0, '#111927');
    panelGrad.addColorStop(1, '#080c14');
    ctx.fillStyle = panelGrad;
    ctx.fill();

    // Border glow
    roundRect(ctx, x, y, W, H, 12 * size);
    ctx.strokeStyle = accentColor + '55';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Top bar label
    const barH = 22 * size;
    roundRect(ctx, x + 1, y + 1, W - 2, barH, 11 * size);
    ctx.fillStyle = accentColor + '33';
    ctx.fill();

    ctx.fillStyle    = accentColor;
    ctx.font         = `600 ${Math.round(11 * size)}px Inter, sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('СКОРОСТЬ / SPEED', x + W / 2, y + barH / 2);

    // Big speed number
    const speedStr = Math.round(speed).toString().padStart(3, ' ');
    ctx.fillStyle   = '#e2e8f0';
    ctx.font        = `bold ${Math.round(55 * size)}px JetBrains Mono, monospace`;
    ctx.textAlign   = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = accentColor;
    ctx.shadowBlur  = 12;
    ctx.fillText(speedStr, x + W - 12 * size, y + H - 14 * size);
    ctx.shadowBlur  = 0;

    // Unit label
    ctx.fillStyle   = '#64748b';
    ctx.font        = `${Math.round(12 * size)}px Inter, sans-serif`;
    ctx.textAlign   = 'left';
    ctx.fillText(opts.unit || 'km/h', x + 12 * size, y + H - 14 * size);

    // Mini progress bar at bottom
    const barY  = y + H - 7 * size;
    const barW  = W - 24 * size;
    const barX  = x + 12 * size;
    const fillW = barW * clamp(speed / maxSpeed, 0, 1);

    roundRect(ctx, barX, barY, barW, 4 * size, 2 * size);
    ctx.fillStyle = '#1e2d47';
    ctx.fill();
    if (fillW > 0) {
      roundRect(ctx, barX, barY, fillW, 4 * size, 2 * size);
      ctx.fillStyle = accentColor;
      ctx.fill();
    }

    ctx.restore();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. ARC — Modern thin-ring gauge
  // ══════════════════════════════════════════════════════════════════════════
  function drawArc(ctx, x, y, opts) {
    const { speed = 0, maxSpeed = 200, accentColor = '#2563eb', opacity = 0.9, size = 1 } = opts;
    const S   = BASE * size;
    const cx  = x + S / 2;
    const cy  = y + S / 2;
    const R   = S / 2 - 8;
    const pct = clamp(speed / maxSpeed, 0, 1);

    const startAngle = (Math.PI * 0.75);           // 135°
    const sweepAngle = (Math.PI * 1.5);            // 270° sweep

    ctx.save();
    ctx.globalAlpha = opacity;

    // Subtle disc
    ctx.beginPath();
    ctx.arc(cx, cy, R + 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,12,20,0.75)';
    ctx.fill();

    // Track arc (background)
    ctx.beginPath();
    ctx.arc(cx, cy, R, startAngle, startAngle + sweepAngle);
    ctx.strokeStyle = '#1e2d47';
    ctx.lineWidth   = 8 * size;
    ctx.lineCap     = 'round';
    ctx.stroke();

    // Active arc
    if (pct > 0) {
      const activeGrad = ctx.createConicalGradient
        ? ctx.createConicalGradient(cx, cy, startAngle)
        : null;

      ctx.beginPath();
      ctx.arc(cx, cy, R, startAngle, startAngle + sweepAngle * pct);
      ctx.strokeStyle = accentColor;
      ctx.lineWidth   = 8 * size;
      ctx.lineCap     = 'round';
      ctx.shadowColor = accentColor;
      ctx.shadowBlur  = 16;
      ctx.stroke();
      ctx.shadowBlur  = 0;

      // Moving dot at tip
      const tipAngle = startAngle + sweepAngle * pct;
      const tx = cx + R * Math.cos(tipAngle);
      const ty = cy + R * Math.sin(tipAngle);
      ctx.beginPath();
      ctx.arc(tx, ty, 5 * size, 0, Math.PI * 2);
      ctx.fillStyle   = '#fff';
      ctx.shadowColor = accentColor;
      ctx.shadowBlur  = 10;
      ctx.fill();
      ctx.shadowBlur  = 0;
    }

    // Speed readout
    ctx.fillStyle    = '#fff';
    ctx.font         = `bold ${Math.round(S * 0.22)}px JetBrains Mono, monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(speed), cx, cy);

    ctx.fillStyle    = '#64748b';
    ctx.font         = `${Math.round(S * 0.075)}px Inter, sans-serif`;
    ctx.fillText(opts.unit || 'km/h', cx, cy + S * 0.17);

    // Min/max labels
    ctx.fillStyle    = '#334155';
    ctx.font         = `${Math.round(S * 0.065)}px JetBrains Mono, monospace`;
    const lx = cx + (R + 2) * Math.cos(startAngle);
    const ly = cy + (R + 2) * Math.sin(startAngle);
    const rx = cx + (R + 2) * Math.cos(startAngle + sweepAngle);
    const ry = cy + (R + 2) * Math.sin(startAngle + sweepAngle);
    ctx.textAlign = 'right'; ctx.fillText('0', lx, ly);
    ctx.textAlign = 'left';  ctx.fillText(maxSpeed, rx, ry);

    ctx.restore();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. MINIMAL — Clean pill with a number
  // ══════════════════════════════════════════════════════════════════════════
  function drawMinimal(ctx, x, y, opts) {
    const { speed = 0, maxSpeed = 200, accentColor = '#2563eb', opacity = 0.9, size = 1 } = opts;
    const W  = BASE * size * 0.85;
    const H  = BASE * size * 0.42;
    const r  = H / 2;
    const pct = clamp(speed / maxSpeed, 0, 1);

    ctx.save();
    ctx.globalAlpha = opacity;

    // Background pill
    roundRect(ctx, x, y, W, H, r);
    ctx.fillStyle = 'rgba(8,12,20,0.85)';
    ctx.fill();

    // Accent left stripe
    const stripeW = 4 * size;
    roundRect(ctx, x, y, stripeW, H, 2 * size);
    ctx.fillStyle = accentColor;
    ctx.fill();

    // Speed number
    ctx.fillStyle    = '#e2e8f0';
    ctx.font         = `bold ${Math.round(H * 0.55)}px JetBrains Mono, monospace`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(speed), x + stripeW + 10 * size, y + H / 2);

    // Unit
    const speedW = ctx.measureText(Math.round(speed)).width;
    ctx.fillStyle    = '#64748b';
    ctx.font         = `${Math.round(H * 0.22)}px Inter, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(opts.unit || 'km/h', x + stripeW + 14 * size + speedW, y + H / 2 + H * 0.08);

    // Bottom progress strip
    const stripY = y + H - 3 * size;
    const fillW  = W * pct;
    roundRect(ctx, x, stripY, W, 3 * size, 1.5 * size);
    ctx.fillStyle = '#1e2d47';
    ctx.fill();
    if (fillW > 0) {
      roundRect(ctx, x, stripY, fillW, 3 * size, 1.5 * size);
      ctx.fillStyle = accentColor + 'cc';
      ctx.fill();
    }

    ctx.restore();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Public draw dispatcher
  // ══════════════════════════════════════════════════════════════════════════
  function draw(ctx, style, x, y, opts) {
    switch (style) {
      case 'analog':  drawAnalog(ctx, x, y, opts);  break;
      case 'digital': drawDigital(ctx, x, y, opts); break;
      case 'arc':     drawArc(ctx, x, y, opts);     break;
      case 'minimal': drawMinimal(ctx, x, y, opts); break;
      default:        drawAnalog(ctx, x, y, opts);
    }
  }

  /**
   * Returns the [width, height] bounding box for a given style + size.
   */
  function getSize(style, size = 1) {
    switch (style) {
      case 'digital': return [BASE * size * 1.1, BASE * size * 0.65];
      case 'minimal': return [BASE * size * 0.85, BASE * size * 0.42];
      default:        return [BASE * size, BASE * size];
    }
  }

  /**
   * Draw a thumbnail preview for the style-picker cards.
   */
  function drawPreview(canvas, style, accentColor = '#2563eb') {
    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const H   = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const scale = W / BASE;
    const opts  = { speed: 65, maxSpeed: 120, unit: 'km/h', accentColor, opacity: 1, size: scale };

    switch (style) {
      case 'digital': drawDigital(ctx, 0, H * 0.175, { ...opts, size: scale * 0.82 }); break;
      case 'minimal': drawMinimal(ctx, 0, H * 0.35,  { ...opts, size: scale * 1.05 }); break;
      default:        draw(ctx, style, 0, 0, opts);
    }
  }

  return { draw, getSize, drawPreview };

})();
