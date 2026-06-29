/**
 * gps.js
 * GPS data manager.
 * Handles: interpolation between GPS samples, speed smoothing,
 * haversine distance, unit conversion, and index lookup by timestamp.
 */

'use strict';

window.GPS = (() => {

  let _points   = [];        // raw sorted GPS array
  let _smoothed = [];        // smoothed copy
  let _maxSpeed = 0;
  let _distance = 0;         // total km

  // ── Haversine distance (km) ───────────────────────────────────────────────
  function haversineKm(lat1, lon1, lat2, lon2) {
    const R    = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a    = Math.sin(dLat / 2) ** 2
               + Math.cos(lat1 * Math.PI / 180)
               * Math.cos(lat2 * Math.PI / 180)
               * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ── Sliding-window speed smoother ─────────────────────────────────────────
  function smoothSpeeds(points, windowSize = 5) {
    if (!points.length) return [];
    const half   = Math.floor(windowSize / 2);
    return points.map((p, i) => {
      const lo  = Math.max(0, i - half);
      const hi  = Math.min(points.length - 1, i + half);
      let   sum = 0, count = 0;
      for (let j = lo; j <= hi; j++) {
        sum += points[j].speed || 0;
        count++;
      }
      return { ...p, speed: sum / count };
    });
  }

  // ── Load new GPS dataset ──────────────────────────────────────────────────
  function load(points, smoothWindow = 5) {
    if (!Array.isArray(points) || points.length === 0) {
      _points   = [];
      _smoothed = [];
      _maxSpeed = 0;
      _distance = 0;
      return;
    }

    // Sort by timestamp
    _points = [...points].sort((a, b) => a.timestamp - b.timestamp);

    // Recompute speed from positions if all zeros (GPX without speed)
    const hasSpeed = _points.some(p => p.speed > 0);
    if (!hasSpeed) {
      for (let i = 1; i < _points.length; i++) {
        const dt = _points[i].timestamp - _points[i - 1].timestamp;
        const d  = haversineKm(
          _points[i - 1].lat, _points[i - 1].lon,
          _points[i].lat,     _points[i].lon
        );
        _points[i].speed = dt > 0 ? (d / dt) * 3600 : 0;
      }
      _points[0].speed = _points[1]?.speed ?? 0;
    }

    // Smooth
    _smoothed = smoothSpeeds(_points, smoothWindow);

    // Stats
    _maxSpeed = Math.max(..._smoothed.map(p => p.speed));
    _distance = 0;
    for (let i = 1; i < _points.length; i++) {
      _distance += haversineKm(
        _points[i - 1].lat, _points[i - 1].lon,
        _points[i].lat,     _points[i].lon
      );
    }
  }

  // ── Binary search for closest index ──────────────────────────────────────
  function nearestIndex(timeS) {
    if (!_smoothed.length) return -1;
    let lo = 0, hi = _smoothed.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (_smoothed[mid].timestamp < timeS) lo = mid + 1;
      else hi = mid;
    }
    // Pick closest of lo-1 and lo
    if (lo > 0) {
      const dLo = Math.abs(_smoothed[lo].timestamp     - timeS);
      const dHi = Math.abs(_smoothed[lo - 1].timestamp - timeS);
      if (dHi < dLo) return lo - 1;
    }
    return lo;
  }

  /**
   * Interpolated GPS point at exactly timeS seconds.
   * Returns a blended point between two samples.
   */
  function atTime(timeS) {
    if (!_smoothed.length) return null;

    const idx = nearestIndex(timeS);
    if (idx <= 0)                          return { ..._smoothed[0] };
    if (idx >= _smoothed.length - 1)       return { ..._smoothed[_smoothed.length - 1] };

    const a  = _smoothed[idx - 1];
    const b  = _smoothed[idx];
    const dt = b.timestamp - a.timestamp;
    const t  = dt === 0 ? 0 : (timeS - a.timestamp) / dt;

    return {
      timestamp: timeS,
      lat:   a.lat   + (b.lat   - a.lat)   * t,
      lon:   a.lon   + (b.lon   - a.lon)   * t,
      alt:   (a.alt  ?? 0) + ((b.alt ?? 0) - (a.alt ?? 0)) * t,
      speed: (a.speed ?? 0) + ((b.speed ?? 0) - (a.speed ?? 0)) * t,
    };
  }

  // ── Getters ───────────────────────────────────────────────────────────────
  function getAll()         { return _smoothed; }
  function getMaxSpeed()    { return _maxSpeed; }
  function getTotalDistKm() { return _distance; }
  function getCount()       { return _smoothed.length; }
  function getDuration()    {
    if (_smoothed.length < 2) return 0;
    return _smoothed[_smoothed.length - 1].timestamp - _smoothed[0].timestamp;
  }

  /**
   * Re-smooth with a new window (called from settings change).
   */
  function resmooth(windowSize) {
    if (!_points.length) return;
    _smoothed = smoothSpeeds(_points, windowSize);
    _maxSpeed = Math.max(..._smoothed.map(p => p.speed));
  }

  /**
   * Smart max-speed suggestion for the speedometer dial.
   * Rounds up to nearest "nice" number.
   */
  function suggestMaxSpeed(unit = 'kmh') {
    const raw = unit === 'mph' ? _maxSpeed / 1.609344 : _maxSpeed;
    const nice = [40, 60, 80, 100, 120, 140, 160, 200, 240, 260, 320];
    for (const n of nice) {
      if (n >= raw * 1.15) return n;
    }
    return Math.ceil(raw * 1.2 / 20) * 20;
  }

  return {
    load,
    atTime,
    nearestIndex,
    getAll,
    getMaxSpeed,
    getTotalDistKm,
    getCount,
    getDuration,
    resmooth,
    suggestMaxSpeed,
    haversineKm
  };

})();
