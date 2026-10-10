// Outils géographiques : distances en milles nautiques, caps, déplacements,
// appartenance à une zone (masques rasterisés pour aller vite), distance à la côte.
(function () {
  const R_NM = 3440.065; // rayon terrestre en milles nautiques
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;

  // Distance orthodromique entre deux points [lat, lon], en milles nautiques.
  function distNm(a, b) {
    const dLat = rad(b[0] - a[0]);
    const dLon = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Cap vrai (0 à 360°) de a vers b.
  function bearing(a, b) {
    const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
    const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }

  // Point atteint depuis p en suivant un cap sur une distance (milles).
  function move(p, brg, nm) {
    const d = nm / R_NM;
    const lat1 = rad(p[0]);
    const lon1 = rad(p[1]);
    const t = rad(brg);
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(t));
    const lon2 = lon1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    return [deg(lat2), deg(lon2)];
  }

  // Écart angulaire signé le plus court (de a vers b), en degrés.
  const angDiff = (a, b) => ((b - a + 540) % 360) - 180;
  const lerp = (a, b, k) => a + (b - a) * k;
  const lerpPos = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
  const lerpAng = (a, b, k) => (a + angDiff(a, b) * k + 360) % 360;

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

  // ---------- Masques rasterisés (remplissage par balayage) ----------
  // Une zone devient une grille de cellules : le test d'appartenance est instantané.
  // Table des arêtes actives : chaque ligne ne teste que les arêtes qui la traversent.
  function rasterize(f, box, res) {
    const g = f.geometry || f;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    const nx = Math.ceil((box.e - box.w) / res);
    const ny = Math.ceil((box.n - box.s) / res);
    const cells = new Uint8Array(nx * ny);
    const edges = [];
    polys.forEach((poly) => poly.forEach((ring) => {
      for (let i = 0; i < ring.length - 1; i++) {
        const y1 = ring[i][1], y2 = ring[i + 1][1];
        if (y1 === y2) continue;
        const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
        if (hi < box.s || lo > box.n) continue;
        edges.push({ x1: ring[i][0], y1, x2: ring[i + 1][0], y2, lo, hi });
      }
    }));
    edges.sort((a, b) => a.lo - b.lo);
    let next = 0;
    let active = [];
    const xs = [];
    for (let j = 0; j < ny; j++) {
      const y = box.s + (j + 0.5) * res;
      while (next < edges.length && edges[next].lo <= y) active.push(edges[next++]);
      active = active.filter((e) => e.hi > y);
      xs.length = 0;
      for (const e of active) {
        if ((e.y1 > y) !== (e.y2 > y)) xs.push(e.x1 + ((y - e.y1) * (e.x2 - e.x1)) / (e.y2 - e.y1));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - box.w) / res - 0.5));
        const i1 = Math.min(nx - 1, Math.floor((xs[k + 1] - box.w) / res - 0.5));
        for (let i = i0; i <= i1; i++) cells[j * nx + i] = 1;
      }
    }
    return { box, res, nx, ny, cells };
  }
  function inMask(m, p) {
    if (!m) return false;
    const i = Math.floor((p[1] - m.box.w) / m.res);
    const j = Math.floor((p[0] - m.box.s) / m.res);
    if (i < 0 || j < 0 || i >= m.nx || j >= m.ny) return false;
    return m.cells[j * m.nx + i] === 1;
  }

  // ---------- Distance à la côte (grille de points de côte) ----------
  let coastGrid = null;
  const CELL = 0.25;
  function buildCoast() {
    coastGrid = new Map();
    (window.DIAMBAR_GEO.coastPts || []).forEach((c) => {
      const k = Math.floor(c[0] / CELL) + ':' + Math.floor(c[1] / CELL);
      if (!coastGrid.has(k)) coastGrid.set(k, []);
      coastGrid.get(k).push(c);
    });
  }
  const coastMemo = new Map();
  function coastDist(p) {
    const key = Math.round(p[0] * 400) * 100000 + Math.round(p[1] * 400);
    const hit = coastMemo.get(key);
    if (hit !== undefined) return hit;
    const v = coastDistRaw(p);
    if (coastMemo.size > 200000) coastMemo.clear();
    coastMemo.set(key, v);
    return v;
  }
  function coastDistRaw(p) {
    if (!coastGrid) buildCoast();
    const ci = Math.floor(p[0] / CELL), cj = Math.floor(p[1] / CELL);
    let best = 1e9;
    for (let r = 0; r <= 7; r++) { // au-delà de ~100 milles, la valeur exacte importe peu
      for (let a = -r; a <= r; a++) {
        for (let b = -r; b <= r; b++) {
          if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
          const pts = coastGrid.get((ci + a) + ':' + (cj + b));
          if (!pts) continue;
          for (const c of pts) { const d = distNm(p, c); if (d < best) best = d; }
        }
      }
      if (best < (r * CELL * 60) * 0.95) break; // plus aucune cellule ne peut être plus proche
    }
    return Math.min(best, 120);
  }

  // Distance d'un point à un segment (milles), en projection locale.
  function distToSegNm(p, a, b) {
    const k = Math.cos(rad(p[0]));
    const ax = (a[1] - p[1]) * k, ay = a[0] - p[0];
    const bx = (b[1] - p[1]) * k, by = b[0] - p[0];
    const dx = bx - ax, dy = by - ay;
    const L = dx * dx + dy * dy;
    let t = L ? -(ax * dx + ay * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    const x = ax + t * dx, y = ay + t * dy;
    return Math.sqrt(x * x + y * y) * 60;
  }
  function distToLineNm(p, line) {
    let m = 1e9;
    for (let i = 0; i < line.length - 1; i++) m = Math.min(m, distToSegNm(p, line[i], line[i + 1]));
    return m;
  }

  // ---------- Navigation en évitant la terre ----------
  // Ligne droite praticable si aucun point échantillonné (tous les ~0,15 mille) n'est à terre.
  function clearLine(mask, a, b) {
    const d = distNm(a, b);
    const n = Math.max(1, Math.ceil(d / 0.15));
    for (let k = 1; k < n; k++) if (inMask(mask, lerpPos(a, b, k / n))) return false;
    return true;
  }
  // Plus court chemin sur la grille du masque de terre (A*, 8 voisins), puis lissage.
  function navPath(mask, from, to) {
    if (clearLine(mask, from, to)) return [to.slice()];
    const { box, res, nx } = mask;
    const margin = 0.2;
    const i0 = Math.max(0, Math.floor((Math.min(from[1], to[1]) - margin - box.w) / res));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(from[1], to[1]) + margin - box.w) / res));
    const j0 = Math.max(0, Math.floor((Math.min(from[0], to[0]) - margin - box.s) / res));
    const j1 = Math.min(mask.ny - 1, Math.ceil((Math.max(from[0], to[0]) + margin - box.s) / res));
    const W = i1 - i0 + 1, H = j1 - j0 + 1;
    const land = (i, j) => mask.cells[(j + j0) * nx + (i + i0)] === 1;
    const cellOf = (p) => [Math.min(W - 1, Math.max(0, Math.floor((p[1] - box.w) / res) - i0)), Math.min(H - 1, Math.max(0, Math.floor((p[0] - box.s) / res) - j0))];
    const freeNear = ([ci, cj]) => {
      if (!land(ci, cj)) return [ci, cj];
      for (let r = 1; r < 30; r++) {
        for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
          const i = ci + a, j = cj + b;
          if (i >= 0 && j >= 0 && i < W && j < H && !land(i, j)) return [i, j];
        }
      }
      return [ci, cj];
    };
    const [si, sj] = freeNear(cellOf(from));
    const [gi, gj] = freeNear(cellOf(to));
    const N = W * H;
    const g = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    // Tas binaire sur tableaux typés
    let hf = new Float64Array(1024), hk = new Int32Array(1024), hn = 0;
    const push = (k, f) => {
      if (hn === hf.length) { const nf = new Float64Array(hn * 2); nf.set(hf); hf = nf; const nk = new Int32Array(hn * 2); nk.set(hk); hk = nk; }
      let c = hn++;
      while (c > 0) { const p = (c - 1) >> 1; if (hf[p] <= f) break; hf[c] = hf[p]; hk[c] = hk[p]; c = p; }
      hf[c] = f; hk[c] = k;
    };
    const pop = () => {
      const top = hk[0];
      hn--;
      if (hn > 0) {
        const f = hf[hn], k = hk[hn];
        let c = 0;
        for (;;) {
          const l = 2 * c + 1, r = l + 1;
          let m = -1, mf = f;
          if (l < hn && hf[l] < mf) { m = l; mf = hf[l]; }
          if (r < hn && hf[r] < mf) { m = r; mf = hf[r]; }
          if (m < 0) break;
          hf[c] = hf[m]; hk[c] = hk[m]; c = m;
        }
        hf[c] = f; hk[c] = k;
      }
      return top;
    };
    const h = (i, j) => 1.6 * Math.hypot(i - gi, j - gj); // A* pondéré : un peu moins optimal, beaucoup plus rapide
    const start = sj * W + si, goal = gj * W + gi;
    g[start] = 0; push(start, h(si, sj));
    const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let found = false;
    while (hn > 0) {
      const k = pop();
      if (closed[k]) continue;
      closed[k] = 1;
      if (k === goal) { found = true; break; }
      const ci = k % W, cj = (k / W) | 0;
      for (const [di, dj, c] of nb) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= W || j >= H || land(i, j)) continue;
        // Léger surcoût le long du rivage : la route garde un peu d'eau
        let pen = 0;
        if (land(Math.min(W - 1, i + 1), j) || land(Math.max(0, i - 1), j) || land(i, Math.min(H - 1, j + 1)) || land(i, Math.max(0, j - 1))) pen = 1.5;
        const nk = j * W + i;
        const ng = g[k] + c + pen;
        if (ng < g[nk]) { g[nk] = ng; came[nk] = k; push(nk, ng + h(i, j)); }
      }
    }
    if (!found) return [to.slice()];
    const cells = [];
    for (let k = goal; k !== -1; k = came[k]) cells.push(k);
    cells.reverse();
    const pts = cells.map((k) => [box.s + ((((k / W) | 0) + j0) + 0.5) * res, box.w + ((k % W) + i0 + 0.5) * res]);
    pts[0] = from.slice();
    pts.push(to.slice());
    // Lissage : on saute les points intermédiaires tant que la ligne droite reste en mer
    const out = [];
    let cur = 0;
    while (cur < pts.length - 1) {
      let nxt = pts.length - 1;
      while (nxt > cur + 1 && !clearLine(mask, pts[cur], pts[nxt])) nxt--;
      out.push(pts[nxt]);
      cur = nxt;
    }
    return out;
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
    const f = (v, pos, neg, w) => {
      const a = Math.abs(v);
      const d = Math.floor(a);
      const m = ((a - d) * 60).toFixed(1).padStart(4, '0');
      return `${String(d).padStart(w, '0')}°${m}′ ${v >= 0 ? pos : neg}`;
    };
    return `${f(p[0], 'N', 'S', 2)}  ${f(p[1], 'E', 'O', 3)}`;
  }

  const fmtNum = (v, d = 1) => v.toFixed(d).replace('.', ',');

  window.G = {
    distNm, bearing, move, angDiff, lerp, lerpPos, lerpAng, inFeature, rasterize, inMask,
    coastDist, distToLineNm, rng, fmtPos, fmtNum, rad, deg, clearLine, navPath,
  };
})();
