// Outils géographiques : distances en milles nautiques, caps, déplacements,
// appartenance d'un point à un polygone GeoJSON.
(function () {
  const R_NM = 3440.065; // rayon terrestre en milles nautiques
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;

  // Distance orthodromique entre deux points [lat, lon], en milles nautiques.
  function distNm(a, b) {
    const dLat = rad(b[0] - a[0]);
    const dLon = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Cap vrai (0 à 360°) de a vers b.
  function bearing(a, b) {
    const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
    const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) -
      Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }

  // Point atteint depuis p en suivant un cap sur une distance (milles).
  function move(p, brg, nm) {
    const d = nm / R_NM;
    const lat1 = rad(p[0]);
    const lon1 = rad(p[1]);
    const t = rad(brg);
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(t));
    const lon2 = lon1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    return [deg(lat2), deg(lon2)];
  }

  function inRing(lat, lon, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function inPolygonCoords(lat, lon, poly) {
    if (!poly || !poly[0] || !poly[0].length) return false;
    if (!inRing(lat, lon, poly[0])) return false;
    for (let k = 1; k < poly.length; k++) if (inRing(lat, lon, poly[k])) return false;
    return true;
  }

  // p = [lat, lon] ; f = Feature ou géométrie GeoJSON (Polygon / MultiPolygon).
  function inFeature(p, f) {
    if (!f) return false;
    const g = f.geometry || f;
    if (g.type === 'Polygon') return inPolygonCoords(p[0], p[1], g.coordinates);
    if (g.type === 'MultiPolygon') return g.coordinates.some((c) => inPolygonCoords(p[0], p[1], c));
    return false;
  }

  function bboxOf(f) {
    const g = f.geometry || f;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    let s = 90, n = -90, w = 180, e = -180;
    polys.forEach((p) => p[0].forEach(([x, y]) => {
      s = Math.min(s, y); n = Math.max(n, y); w = Math.min(w, x); e = Math.max(e, x);
    }));
    return { s, n, w, e };
  }

  // Générateur pseudo-aléatoire déterministe (mulberry32) pour des scénarios rejouables.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fmtPos(p) {
    const f = (v, pos, neg) => {
      const a = Math.abs(v);
      const d = Math.floor(a);
      const m = ((a - d) * 60).toFixed(1).padStart(4, '0');
      return `${d}°${m}′ ${v >= 0 ? pos : neg}`;
    };
    return `${f(p[0], 'N', 'S')}  ${f(p[1], 'E', 'O')}`;
  }

  // Distance approximative à la côte (milles), à partir des sommets du trait de côte.
  let coastPts = null;
  function coastDist(p) {
    if (!coastPts) {
      coastPts = [];
      const geo = window.DIAMBAR_GEO;
      geo.land.features.forEach((f) => {
        if (!['Senegal', 'Gambia', 'Mauritania', 'Guinea-Bissau'].includes(f.properties.name)) return;
        const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        polys.forEach((poly) => poly && poly[0] && poly[0].forEach(([x, y]) => { if (x < -16.3 && y > 11.8 && y < 16.8) coastPts.push([y, x]); }));
      });
    }
    let m = 1e9;
    for (let i = 0; i < coastPts.length; i++) {
      const c = coastPts[i];
      if (Math.abs(c[0] - p[0]) > 4 || Math.abs(c[1] - p[1]) > 4) continue;
      const d = distNm(p, c);
      if (d < m) m = d;
    }
    return m;
  }

  window.G = { distNm, bearing, move, inFeature, bboxOf, rng, fmtPos, coastDist };
})();
