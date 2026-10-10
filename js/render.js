// Carte : fond de carte marine (bathymétrie, côte, zones), étiquettes, et couche dynamique
// dessinée à chaque image (pistes, moyens, nappes, passages satellites).
(function () {
  const D = window.DIAMBAR_DATA;
  const GEO = window.DIAMBAR_GEO;
  const NM = 1852;

  // ---------- Palettes (couleur = affiliation, comme sur un écran de commandement) ----------
  const PAL = {
    friend: { hull: '#6FB4F6', line: '#0560B8', house: '#F3F9FF', dark: '#2E86DE', light: '#D6EAFD', ink: '#0560B8' },
    state: { hull: '#93A9CC', line: '#1A3768', house: '#F1F4FA', dark: '#3C5A8C', light: '#DCE4F1', ink: '#1A3768' },
    neutral: { hull: '#A5D6B6', line: '#2E7048', house: '#F4FBF6', dark: '#78B892', light: '#E3F3E9', ink: '#2E6A45' },
    unknown: { hull: '#FFDF73', line: '#8C6800', house: '#FFF8DE', dark: '#E2BD45', light: '#FFF1BF', ink: '#7A5C00' },
    suspect: { hull: '#F4A3A6', line: '#A0242A', house: '#FFF3F3', dark: '#DE7B80', light: '#FBE0E1', ink: '#A0242A' },
    stale: { hull: '#D7DEE6', line: '#7D8A9A', house: '#F5F7FA', dark: '#B7C1CD', light: '#EEF1F5', ink: '#5D6E84' },
    truth: { hull: '#C9CED6', line: '#4B5563', house: '#F3F4F6', dark: '#9CA3AF', light: '#E5E7EB', ink: '#374151' },
    install: { hull: '#C9B9A0', line: '#5B4A33', house: '#F6F1E8', dark: '#8F7B5E', light: '#E9E0D0', ink: '#5B4A33' },
  };
  const SEV = { crit: '#C81E1E', high: '#DC5A0E', mid: '#B07D00', low: '#64758B' };
  const sevOf = (s) => (s >= 85 ? 'crit' : s >= 65 ? 'high' : s >= 45 ? 'mid' : 'low');
  const DEPTH_TINT = { 0: '#CFE6F5', 200: '#DDEEF8', 1000: '#E6F2FA', 2000: '#EDF5FB', 3000: '#F2F8FC', 4000: '#F6FAFD', 5000: '#F9FCFE' };
  const MIN_PX = { container: 24, bulk: 23, tanker: 23, cargo: 21, reefer: 21, ferry: 20, shuttle: 13, supply: 17, tug: 12, trawler: 16, longliner: 15, seiner: 16, poleline: 14, yacht: 13, pirogue: 11, gofast: 11, opv: 21, vedette: 14, usv: 15, fpso: 30, flng: 28 };

  const R = { map: null, hits: [], layers: {}, opts: { zones: true, amp: true, infra: true, ais: false, grid: true, sat: false, trails: true, truth: false }, smooth: new Map(), assetTrail: new Map() };

  // ---------- Construction de la carte ----------
  function init(el) {
    const map = L.map(el, {
      zoomControl: false, attributionControl: true, minZoom: 6, maxZoom: 15, zoomSnap: 0.25, zoomDelta: 0.5,
      wheelPxPerZoomLevel: 110, maxBounds: L.latLngBounds([8.4, -26.2], [20.6, -9.6]), maxBoundsViscosity: 0.75,
      preferCanvas: true,
    }).setView([14.3, -17.75], 7.75);
    R.map = map;
    map.attributionControl.setPrefix(false);
    map.attributionControl.addAttribution('Trait de côte © contributeurs OpenStreetMap, bathymétrie Natural Earth, limites indicatives');
    L.control.zoom({ position: 'topright', zoomInTitle: 'Zoom avant', zoomOutTitle: 'Zoom arrière' }).addTo(map);

    const pane = (name, z, events) => { const p = map.createPane(name); p.style.zIndex = z; if (!events) p.style.pointerEvents = 'none'; return p; };
    pane('sat', 160); pane('bathy', 200); pane('veil', 250); pane('zones', 300); pane('halo', 320); pane('land', 340); pane('landlines', 350); pane('grid', 360); pane('night', 400); pane('labels', 430); pane('dyn', 450);
    const rc = (p, pad) => L.canvas({ pane: p, padding: pad || 0.4 });
    const r = { bathy: rc('bathy'), veil: rc('veil'), zones: rc('zones'), halo: rc('halo'), land: rc('land'), landlines: rc('landlines'), grid: rc('grid') };
    R.renderers = r;

    // Bathymétrie : le fond de carte est la teinte du plateau continental (moins de 200 m)
    el.style.background = DEPTH_TINT[0];
    const bathy = L.layerGroup().addTo(map);
    GEO.bathy.slice().sort((a, b) => a.depth - b.depth).forEach((b) => {
      L.geoJSON(b.geom, { renderer: r.bathy, interactive: false, style: { stroke: true, color: b.depth === 200 ? '#8DBAD9' : '#B3D2E6', weight: b.depth === 200 ? 1 : 0.7, opacity: 0.9, fillColor: DEPTH_TINT[b.depth] || '#F9FCFE', fillOpacity: 1 } }).addTo(bathy);
    });
    R.layers.bathy = bathy;

    // Voile hors de la ZEE : on garde l'œil sur les eaux sénégalaises
    const outer = [[4, -32], [4, -4], [24, -4], [24, -32]];
    const zeePolys = GEO.zee.type === 'Polygon' ? [GEO.zee.coordinates] : GEO.zee.coordinates;
    const holes = zeePolys.map((poly) => poly[0].map(([lo, la]) => [la, lo]));
    R.layers.veil = L.polygon([outer, ...holes], { renderer: r.veil, interactive: false, stroke: false, fillColor: '#FFFFFF', fillOpacity: 0.42 }).addTo(map);

    // Zones réglementaires (hachures, pour ne pas les confondre avec la terre)
    const zones = L.layerGroup().addTo(map);
    R.hatchStrong = hatch('rgba(196,138,0,0.42)', 7);
    R.hatchLight = hatch('rgba(196,138,0,0.22)', 9);
    R.band6 = L.geoJSON(GEO.band6, { renderer: r.zones, interactive: false, style: { color: '#B27A00', weight: 0.9, opacity: 0.6, dashArray: '2 3', fillColor: R.hatchStrong, fillOpacity: 1 } }).addTo(zones);
    L.geoJSON(GEO.agc, { renderer: r.zones, interactive: false, style: { color: '#6D5BB0', weight: 1, opacity: 0.7, dashArray: '5 4', fillColor: hatch('rgba(109,91,176,0.3)', 10), fillOpacity: 1 } }).addTo(zones);
    L.geoJSON(GEO.ts12, { renderer: r.zones, interactive: false, style: { color: '#1A3768', weight: 0.9, opacity: 0.55 } }).addTo(zones);
    L.geoJSON(GEO.zeeLimit, { renderer: r.zones, interactive: false, style: { color: '#1A3768', weight: 1.6, opacity: 0.85, dashArray: '9 5 2 5' } }).addTo(zones);
    R.layers.zones = zones;

    const amp = L.layerGroup().addTo(map);
    D.amps.forEach((a) => L.circle(a.pos, { renderer: r.zones, interactive: false, radius: a.rNm * NM, color: '#2F7D4A', weight: 1.1, opacity: 0.8, fillColor: '#5BAA74', fillOpacity: 0.16 }).addTo(amp));
    R.layers.amp = amp;

    const infra = L.layerGroup().addTo(map);
    D.cables.forEach((c) => L.polyline(c.line, { renderer: r.zones, interactive: false, color: '#7B4FB8', weight: 1.4, opacity: 0.75, dashArray: '1 4', lineCap: 'round' }).addTo(infra));
    L.polygon(D.anchorage.poly, { renderer: r.zones, interactive: false, color: '#1A3768', weight: 1, opacity: 0.7, dashArray: '4 3', fillColor: '#1A3768', fillOpacity: 0.04 }).addTo(infra);
    R.layers.infra = infra;

    const ais = L.layerGroup();
    D.aisStations.forEach((s) => L.circle(s.pos, { renderer: r.zones, interactive: false, radius: D.AIS_RANGE_NM * NM, color: '#097FED', weight: 1, opacity: 0.45, dashArray: '3 4', fillColor: '#097FED', fillOpacity: 0.05 }).addTo(ais));
    R.layers.ais = ais;

    // Côte : liseré d'eau claire, terre couleur sable, trait de côte (lissé pour l'affichage)
    const landShown = smoothLand(GEO.land);
    L.geoJSON(landShown, { renderer: r.halo, interactive: false, style: { stroke: true, color: '#BBDCF1', weight: 7, opacity: 1, fill: false, lineJoin: 'round' } }).addTo(map);
    L.geoJSON(landShown, { renderer: r.land, interactive: false, style: { stroke: true, color: '#9C8C6E', weight: 0.9, opacity: 1, fillColor: '#EFE7D5', fillOpacity: 1, lineJoin: 'round' } }).addTo(map);
    const landlines = L.layerGroup().addTo(map);
    GEO.rivers.forEach((rv) => L.polyline(rv.line.map(([lo, la]) => [la, lo]), { renderer: r.landlines, interactive: false, color: '#86B9DE', weight: 1.3, opacity: 0.95, lineJoin: 'round' }).addTo(landlines));
    L.geoJSON(GEO.borders, { renderer: r.landlines, interactive: false, style: { color: '#8E7F66', weight: 1.1, opacity: 0.85, dashArray: '6 3 1.5 3' } }).addTo(landlines);

    // Fond satellite (si le réseau le permet)
    R.layers.sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { pane: 'sat', maxZoom: 15, attribution: 'Imagerie © Esri' });

    // Voile de nuit : la carte s'assombrit légèrement entre le coucher et le lever du soleil
    R.nightVeil = L.rectangle([[0, -40], [30, 0]], { renderer: L.canvas({ pane: 'night', padding: 0.5 }), interactive: false, stroke: false, fillColor: '#031D45', fillOpacity: 0 }).addTo(map);
    R.grid = L.layerGroup().addTo(map);
    buildGrid();
    buildLabels();

    // Couche dynamique
    R.dyn = L.canvas({ pane: 'dyn', padding: 0.25 });
    map.addLayer(R.dyn);
    map.on('zoomend', () => {
      buildGrid(); updateLabels();
      // Hachures plus discrètes quand on zoome près de la côte
      R.band6.setStyle({ fillColor: map.getZoom() >= 10 ? R.hatchLight : R.hatchStrong });
    });
    map.on('moveend zoomend resize', drawFrame);
    map.whenReady(() => { updateLabels(); drawFrame(); });
    setTimeout(drawFrame, 50);
    return map;
  }

  // Lissage de Chaikin : arrondit les angles des contours simplifiés (lagunes, bolongs du Saloum)
  function chaikin(ring, n) {
    let pts = ring;
    for (let k = 0; k < n; k++) {
      const out = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
      }
      out.push(out[0]);
      pts = out;
    }
    return pts;
  }
  function smoothLand(g) {
    return { type: 'MultiPolygon', coordinates: g.coordinates.map((poly) => poly.map((ring, i) => (ring.length >= 4 ? chaikin(ring, i === 0 && ring.length > 12 ? 1 : 2) : ring))) };
  }

  // Motif de hachures obliques
  function hatch(color, step) {
    const c = document.createElement('canvas');
    c.width = step; c.height = step;
    const x = c.getContext('2d');
    x.strokeStyle = color; x.lineWidth = 1;
    x.beginPath(); x.moveTo(0, step); x.lineTo(step, 0); x.moveTo(-1, 1); x.lineTo(1, -1); x.moveTo(step - 1, step + 1); x.lineTo(step + 1, step - 1); x.stroke();
    return x.createPattern(c, 'repeat');
  }

  // ---------- Graticule ----------
  function gridStep() { const z = R.map.getZoom(); return z >= 11 ? 1 / 12 : z >= 9.5 ? 0.25 : z >= 8 ? 0.5 : 1; }
  function buildGrid() {
    R.grid.clearLayers();
    if (!R.opts.grid) return;
    const s = gridStep();
    const style = { renderer: R.renderers.grid, interactive: false, color: '#5D7FA0', weight: 0.6, opacity: 0.32 };
    for (let la = Math.ceil(9 / s) * s; la <= 20; la += s) L.polyline([[la, -27], [la, -9]], style).addTo(R.grid);
    for (let lo = Math.ceil(-27 / s) * s; lo <= -9; lo += s) L.polyline([[8, lo], [21, lo]], style).addTo(R.grid);
  }

  // Cadre de carte : graduations en degrés et minutes, échelle en milles nautiques
  const fmtDeg = (v, pos, neg) => {
    const a = Math.abs(v); let d = Math.floor(a + 1e-9); let m = Math.round((a - d) * 60);
    if (m === 60) { d++; m = 0; }
    return `${d}°${m ? String(m).padStart(2, '0') + '′' : ''} ${v >= 0 ? pos : neg}`;
  };
  function drawFrame() {
    const cv = document.getElementById('chartFrame');
    if (!cv || !R.map) return;
    const map = R.map, size = map.getSize(), dpr = window.devicePixelRatio || 1;
    if (cv.width !== size.x * dpr || cv.height !== size.y * dpr) { cv.width = size.x * dpr; cv.height = size.y * dpr; cv.style.width = size.x + 'px'; cv.style.height = size.y + 'px'; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    if (!R.opts.grid) return;
    const s = gridStep(), b = map.getBounds();
    ctx.font = '600 11px "Barlow Condensed", "Arial Narrow", sans-serif';
    ctx.textBaseline = 'middle';
    const tag = (txt, x, y, align) => {
      const w = ctx.measureText(txt).width + 8;
      const x0 = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.fillRect(x0, y - 8, w, 16);
      ctx.fillStyle = '#41556E'; ctx.textAlign = 'left'; ctx.fillText(txt, x0 + 4, y + 0.5);
    };
    for (let la = Math.ceil(b.getSouth() / s) * s; la < b.getNorth(); la += s) {
      const y = map.latLngToContainerPoint([la, b.getWest()]).y;
      if (y < 60 || y > size.y - 30) continue;
      tag(fmtDeg(la, 'N', 'S'), 6, y, 'left');
    }
    for (let lo = Math.ceil(b.getWest() / s) * s; lo < b.getEast(); lo += s) {
      const x = map.latLngToContainerPoint([b.getSouth(), lo]).x;
      if (x < 120 || x > size.x - 140) continue;
      tag(fmtDeg(lo, 'E', 'O'), x, size.y - 12, 'center');
    }
    // Échelle graphique en milles nautiques, alternance noir et blanc comme sur les cartes marines
    const c = map.getCenter();
    const p0 = map.latLngToContainerPoint(c), p1 = map.latLngToContainerPoint([c.lat, c.lng + 1]);
    const pxPerNm = Math.abs(p1.x - p0.x) / (60 * Math.cos((c.lat * Math.PI) / 180));
    const nice = [0.5, 1, 2, 5, 10, 20, 50, 100].find((n) => n * pxPerNm >= 110) || 100;
    const W = nice * pxPerNm, x0 = 14, y0 = size.y - 44;
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x0 - 6, y0 - 16, W + 46, 30);
    for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? '#FFFFFF' : '#13233B'; ctx.fillRect(x0 + (i * W) / 4, y0, W / 4, 5); }
    ctx.strokeStyle = '#13233B'; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, W, 5);
    ctx.fillStyle = '#13233B'; ctx.textAlign = 'left'; ctx.font = '600 11px "Barlow Condensed", "Arial Narrow", sans-serif';
    ctx.fillText('0', x0 - 2, y0 - 7);
    ctx.textAlign = 'right'; ctx.fillText(`${String(nice).replace('.', ',')} ${nice > 1 ? 'milles' : 'mille'}`, x0 + W + 34, y0 - 7);
  }

  // ---------- Étiquettes ----------
  R.labels = [];
  function addLabel(pos, html, cls, minZ, maxZ) {
    const m = L.marker(pos, { pane: 'labels', interactive: false, keyboard: false, icon: L.divIcon({ className: 'lbl-anchor', html: `<span class="lbl ${cls}">${html}</span>`, iconSize: [0, 0] }) }).addTo(R.map);
    R.labels.push({ m, minZ, maxZ: maxZ || 99, cls });
  }
  function buildLabels() {
    const rankZ = { 1: 6, 2: 7, 3: 8.5, 4: 9.75, 5: 10.75 };
    D.regions.forEach((r) => {
      const cls = r.kind === 'country' ? 'lbl-country' : r.kind === 'ocean' ? 'lbl-ocean' : r.kind === 'seafeature' ? 'lbl-water' : 'lbl-feature';
      const html = r.rot ? `<i style="transform:rotate(${r.rot}deg)">${r.name}</i>` : r.name;
      addLabel(r.pos, html, cls, rankZ[r.rank] || 8, r.kind === 'country' ? 10.5 : 99);
    });
    D.places.forEach((p) => {
      if (p.kind === 'island') { addLabel(p.pos, p.name, 'lbl-water lbl-island', 11); return; }
      addLabel(p.pos, `<em class="pt pt-${p.kind}"></em>${p.name}`, `lbl-place lbl-${p.kind}`, rankZ[p.rank] || 9);
    });
    GEO.isoLabels.forEach((l) => addLabel(l.pos, `${l.depth.toLocaleString('fr-FR')} m`, 'lbl-depth', l.depth >= 3000 ? 7 : 7.5));
    D.amps.forEach((a) => addLabel([a.pos[0] - (a.rNm / 60) - 0.012, a.pos[1]], a.name, 'lbl-amp', 9.75));
    D.installations.forEach((i) => addLabel([i.pos[0] - 0.012, i.pos[1]], i.name, 'lbl-infra', 10));
    addLabel([14.6, -17.345], 'Zone de mouillage', 'lbl-infra', 11);
    addLabel([14.93, -17.95], 'Câbles sous-marins', 'lbl-cable', 9);
    addLabel([13.33, -18.25], 'Eaux gambiennes', 'lbl-zone', 7.5);
    addLabel([12.22, -18.95], 'Zone commune Sénégal / Guinée-Bissau', 'lbl-zone', 7.25);
    addLabel([15.2, -20.05], 'Limite de la ZEE (tracé indicatif)', 'lbl-zone lbl-zee', 6.75);
    addLabel([14.25, -17.2], 'Bande des 6 milles', 'lbl-band', 10.5);
    D.ports.slice(1).forEach((p) => addLabel(p.pos, '<em class="pt pt-port"></em>', 'lbl-port', 9));
    // Bases aériennes : symbole dès le zoom 9, nom un peu plus bas quand on zoome davantage
    D.airbases.forEach((p) => {
      addLabel(p.pos, '<em class="pt pt-air"></em>', 'lbl-air', 9);
      addLabel([p.pos[0] - 0.016, p.pos[1]], p.name.replace('Base aérienne de ', 'Base aérienne de '), 'lbl-air lbl-airname', 11);
    });
  }
  function updateLabels() {
    const z = R.map.getZoom();
    R.labels.forEach((l) => {
      const el = l.m.getElement();
      if (!el) return;
      let show = z >= l.minZ && z <= l.maxZ;
      if (!R.opts.amp && l.cls.includes('lbl-amp')) show = false;
      if (!R.opts.infra && (l.cls.includes('lbl-infra') || l.cls.includes('lbl-cable'))) show = false;
      if (!R.opts.zones && (l.cls.includes('lbl-zone') || l.cls.includes('lbl-band'))) show = false;
      el.style.display = show ? '' : 'none';
    });
  }

  // ---------- Couches optionnelles ----------
  function setOpt(name, on) {
    R.opts[name] = on;
    const map = R.map;
    const toggle = (layer, v) => { if (!layer) return; if (v && !map.hasLayer(layer)) layer.addTo(map); if (!v && map.hasLayer(layer)) map.removeLayer(layer); };
    if (name === 'zones') toggle(R.layers.zones, on);
    if (name === 'amp') toggle(R.layers.amp, on);
    if (name === 'infra') toggle(R.layers.infra, on);
    if (name === 'ais') toggle(R.layers.ais, on);
    if (name === 'grid') { buildGrid(); drawFrame(); }
    if (name === 'sat') {
      toggle(R.layers.sat, on);
      map.getContainer().classList.toggle('sat-on', on);
      toggle(R.layers.bathy, !on);
    }
    updateLabels();
  }

  // ---------- Outils de dessin ----------
  function lp(pos) { return R.map.latLngToLayerPoint(pos); }
  function pxPerNm(lat) {
    const z = R.map.getZoom();
    const mPerPx = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z + 8);
    return NM / mPerPx;
  }
  function label(ctx, txt, x, y, color, opts) {
    ctx.font = (opts && opts.font) || '600 12px "Barlow Condensed", "Arial Narrow", sans-serif';
    ctx.textAlign = (opts && opts.align) || 'left'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3.2; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineJoin = 'round';
    ctx.strokeText(txt, x, y);
    ctx.fillStyle = color; ctx.fillText(txt, x, y);
  }
  // Étiquettes des navires et moyens : placées à la fin, sans se chevaucher
  let queue = [];
  function queueLabel(txt, x, y, r, color, prio, font) { queue.push({ txt, x, y, r, color, prio, font: font || '600 12px "Barlow Condensed", "Arial Narrow", sans-serif' }); }
  function flushLabels(ctx) {
    const placed = [];
    const hit = (a) => placed.some((b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y);
    queue.sort((a, b) => b.prio - a.prio);
    queue.forEach((l) => {
      ctx.font = l.font;
      const w = ctx.measureText(l.txt).width + 4, h = 15, g = l.r + 4;
      const cands = [
        { x: l.x + g, y: l.y - h / 2 }, { x: l.x - g - w, y: l.y - h / 2 },
        { x: l.x - w / 2, y: l.y + g }, { x: l.x - w / 2, y: l.y - g - h },
        { x: l.x + g, y: l.y + 2 }, { x: l.x + g, y: l.y - h - 2 },
      ];
      let pos = cands.find((c) => !hit({ x: c.x, y: c.y, w, h }));
      if (!pos) { if (l.prio < 3) return; pos = cands[0]; }
      placed.push({ x: pos.x, y: pos.y, w, h });
      label(ctx, l.txt, pos.x + 2, pos.y + h / 2, l.color, { font: l.font });
    });
    queue = [];
  }

  function dashedLine(ctx, a, b, color, dash, width) {
    ctx.save(); ctx.setLineDash(dash || [5, 4]); ctx.strokeStyle = color; ctx.lineWidth = width || 1.3;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
  }
  function ring(ctx, p, r, color, width, dash, alpha) {
    ctx.save(); if (dash) ctx.setLineDash(dash); ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.strokeStyle = color; ctx.lineWidth = width || 1.2; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }

  // Taille d'affichage : échelle réelle quand on zoome, taille minimale lisible sinon
  function shipPx(kind, lengthM, lat) {
    const real = (lengthM / NM) * pxPerNm(lat);
    const grow = 1 + Math.max(0, Math.min(4, R.map.getZoom() - 9)) * 0.14; // plus lisible quand on zoome
    return Math.max((MIN_PX[kind] || 14) * grow, real);
  }

  function drawVessel(ctx, p, heading, kind, lengthM, pal, opts) {
    const L = shipPx(kind, lengthM, opts.lat);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(((heading || 0) * Math.PI) / 180);
    if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
    SYM.vessel(ctx, kind, L, Object.assign({ lw: L > 30 ? 1.2 : 1 }, pal), L >= 20 ? 1 : 0, opts.seed || 1);
    ctx.restore();
    return L;
  }

  // Vecteur vitesse : route prévue pour le prochain quart d'heure
  function speedLeader(ctx, p, heading, sog, lat, color) {
    if (!sog || sog < 1) return;
    const len = Math.min(56, sog * 0.25 * pxPerNm(lat));
    if (len < 5) return;
    const a = ((heading - 90) * Math.PI) / 180;
    ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(a) * len, p.y + Math.sin(a) * len); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---------- Image dynamique ----------
  let view = null, nightOn = null;
  function frame(v) {
    view = v;
    const night = SIM.isNight(Math.floor(v.t));
    if (night !== nightOn) { nightOn = night; R.nightVeil.setStyle({ fillOpacity: night ? 0.075 : 0 }); }
    const map = R.map;
    if (!map || !R.dyn._ctx || map._animatingZoom) return;
    const ctx = R.dyn._ctx, b = R.dyn._bounds;
    ctx.clearRect(b.min.x, b.min.y, b.max.x - b.min.x, b.max.y - b.min.y);
    R.hits = [];
    const { w, P } = v;
    const t = v.t;
    const z = map.getZoom();
    const vb = map.getBounds().pad(0.15);
    const inView = (pos) => vb.contains(pos);

    // Passages satellites récents : bande balayée, détections
    drawSatPasses(ctx, w, t);
    // Nappes d'hydrocarbures
    drawSlicks(ctx, w, P, t, v.truth);
    // Installations en mer
    drawInstallations(ctx, z);

    // Alertes ouvertes par piste
    const alertOf = new Map();
    P.incidents.forEach((i) => { if (!i.closed && (!alertOf.has(i.trackId) || alertOf.get(i.trackId).score < i.score)) alertOf.set(i.trackId, i); });
    const selTrack = v.sel && v.sel.trackId;

    // Mode formateur : vérité terrain, dessinée en dessous
    if (v.truth) drawTruth(ctx, w, v, inView);

    // Pistes de la plateforme
    const items = [];
    P.tracks.forEach((tr) => {
      if (!tr.lastPos || tr.closedTrack || tr.slick) return;
      const age = t - tr.lastT;
      const alert = alertOf.get(tr.id);
      if (age > (alert || tr.id === selTrack ? 600 : tr.unknown ? 120 : 240)) return;
      items.push({ tr, age, alert });
    });
    const rank = (it) => (it.tr.id === selTrack ? 4 : it.alert ? 3 : it.tr.unknown ? 2 : 1);
    items.sort((a, b) => rank(a) - rank(b));

    const showNames = z >= 10.5;
    items.forEach(({ tr, age, alert }) => {
      const sel = tr.id === selTrack;
      const live = age <= (tr.unknown ? 20 : 45);
      const est = PLATFORM.drPos(tr, t) || tr.lastPos;
      const pos = smoothPos(tr, est, v.realDt);
      if (!inView(pos) && !sel) return;
      const p = lp(pos);
      if (R.opts.trails && (sel || alert || z >= 10)) drawTrail(ctx, tr, alert ? PAL.suspect.line : tr.unknown ? PAL.unknown.line : PAL.neutral.line, sel || alert ? 0.75 : 0.3);
      const aff = alert && alert.score >= 50 ? 'suspect' : tr.unknown && !tr.visual ? 'unknown' : tr.unknown ? 'unknown' : 'neutral';
      const pal = live ? PAL[aff] : PAL.stale;
      const kind = shipKind(tr);
      const heading = tr.cog !== undefined ? tr.cog : 0;
      const lengthM = tr.lengthM || tr.sizeEst || (tr.cls === 'small' ? 14 : 60);

      if (tr.gather) { drawGather(ctx, p, tr, t, v.now); R.hits.push({ x: p.x, y: p.y, r: 16, type: 'track', id: tr.id }); return; }
      if (!live) {
        // Dernière position connue, position estimée en pointillés
        const last = lp(tr.lastPos);
        dashedLine(ctx, last, p, PAL.stale.line, [2, 3], 1);
        ring(ctx, last, 3, PAL.stale.line, 1);
      }
      if (alert) haloAlert(ctx, p, alert, v.now);
      if (live) speedLeader(ctx, p, heading, tr.sog, pos[0], pal.line);
      const L = drawVessel(ctx, p, heading, kind, lengthM, pal, { lat: pos[0], seed: hashId(tr.id), alpha: live ? 1 : 0.85 });
      if (tr.unknown && !tr.visual) ring(ctx, p, Math.max(9, L * 0.55), PAL.unknown.line, 1, [2, 2.5], 0.9);
      if (sel) selectionRing(ctx, p, Math.max(14, L * 0.62), v.now);
      R.hits.push({ x: p.x, y: p.y, r: Math.max(10, L * 0.5), type: 'track', id: tr.id });
      if (showNames || sel || alert) {
        const name = tr.unknown ? (tr.visual ? tr.label : tr.contactNo || tr.label) : (tr.name || tr.label);
        queueLabel(name, p.x, p.y, Math.max(8, L * 0.42), alert ? PAL.suspect.ink : tr.unknown ? PAL.unknown.ink : '#24384F', sel ? 5 : alert ? 4 : tr.unknown ? 2 : 1, alert || sel ? '700 12.5px "Barlow Condensed", sans-serif' : undefined);
      }
    });

    drawAssets(ctx, w, v, inView);
    flushLabels(ctx);
    drawFocus(ctx, v);
  }

  function hashId(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h % 97) + 1; }

  // Corrige en douceur la position affichée quand un nouveau rapport arrive
  function smoothPos(tr, est, realDt) {
    let s = R.smooth.get(tr.id);
    if (!s) { s = { lastT: tr.lastT, off: [0, 0], shown: est }; R.smooth.set(tr.id, s); }
    if (s.lastT !== tr.lastT) {
      const jump = G.distNm(s.shown, est);
      s.off = jump < 6 ? [s.shown[0] - est[0], s.shown[1] - est[1]] : [0, 0];
      s.lastT = tr.lastT;
    }
    const k = Math.exp(-(realDt || 16) / 260);
    s.off = [s.off[0] * k, s.off[1] * k];
    s.shown = [est[0] + s.off[0], est[1] + s.off[1]];
    return s.shown;
  }

  function shipKind(tr) {
    if (tr.kind && SYM.SPEC[tr.kind]) return tr.kind;
    if (tr.kind === 'gofast') return 'gofast';
    return tr.cls === 'small' ? 'pirogue' : 'cargo';
  }

  function drawTrail(ctx, tr, color, alpha) {
    const h = tr.hist;
    if (!h || h.length < 2) return;
    ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = 1.2; ctx.setLineDash([1.5, 3]);
    ctx.beginPath();
    h.forEach((pt, i) => { const p = lp(pt.pos); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = color;
    h.forEach((pt) => { const p = lp(pt.pos); ctx.beginPath(); ctx.arc(p.x, p.y, 1.4, 0, 7); ctx.fill(); });
    ctx.restore();
  }

  function haloAlert(ctx, p, alert, now) {
    const c = SEV[sevOf(alert.score)];
    const k = (now / 1400) % 1;
    ctx.save();
    ctx.globalAlpha = 0.5 * (1 - k); ctx.strokeStyle = c; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 13 + k * 16, 0, 7); ctx.stroke();
    ctx.globalAlpha = 0.16; ctx.fillStyle = c; ctx.beginPath(); ctx.arc(p.x, p.y, 13, 0, 7); ctx.fill();
    ctx.restore();
  }
  function selectionRing(ctx, p, r, now) {
    ctx.save();
    ctx.strokeStyle = '#F9B02A'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.arc(p.x, p.y, r + 3, 0, 7); ctx.stroke();
    ctx.strokeStyle = '#031D45'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p.x, p.y, r + 5.5, 0, 7); ctx.stroke();
    const a = (now / 900) % (Math.PI * 2);
    ctx.strokeStyle = '#F9B02A'; ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) { const ang = a + (i * Math.PI) / 2; ctx.beginPath(); ctx.arc(p.x, p.y, r + 9, ang, ang + 0.5); ctx.stroke(); }
    ctx.restore();
  }

  // Rassemblement sur une plage : pirogues tirées au sec et foule
  function drawGather(ctx, p, tr, t, now) {
    ctx.save();
    ctx.globalAlpha = 0.18 + 0.1 * Math.sin(now / 400); ctx.fillStyle = PAL.suspect.line;
    ctx.beginPath(); ctx.arc(p.x, p.y, 22, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    for (let i = 0; i < 7; i++) {
      ctx.save(); ctx.translate(p.x - 14 + (i % 4) * 9, p.y - 7 + Math.floor(i / 4) * 12); ctx.rotate(-0.35);
      SYM.vessel(ctx, 'pirogue', 13, Object.assign({ lw: 0.8 }, PAL.suspect), 0, i);
      ctx.restore();
    }
    ring(ctx, p, 22, PAL.suspect.line, 1.4, [3, 3]);
    ctx.restore();
    queueLabel('Rassemblement de pirogues', p.x, p.y, 22, PAL.suspect.ink, 4, '700 12.5px "Barlow Condensed", sans-serif');
  }

  function drawSatPasses(ctx, w, t) {
    w.satDone.forEach((s) => {
      const age = t - s.t;
      if (age < 0 || age > 50) return;
      const a = 1 - age / 50;
      const pass = s.pass;
      ctx.save();
      if (pass.box) {
        const c = pass.box.c, h = pass.box.halfKm / 111.32, hx = h / Math.cos((c[0] * Math.PI) / 180);
        const p1 = lp([c[0] + h, c[1] - hx]), p2 = lp([c[0] - h, c[1] + hx]);
        ctx.globalAlpha = 0.1 * a; ctx.fillStyle = '#6D3FC9'; ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
        ctx.globalAlpha = 0.7 * a; ctx.strokeStyle = '#6D3FC9'; ctx.lineWidth = 1.4; ctx.setLineDash([6, 4]); ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
        ctx.setLineDash([]);
        label(ctx, `${pass.name}, ${PLATFORM.hhmm(s.t)}`, p1.x + 6, p1.y + 12, '#4B2A93');
      } else {
        const A = pass.swath.a, B = pass.swath.b, half = pass.swath.halfKm / 111.32;
        const brg = Math.atan2(B[1] - A[1], B[0] - A[0]);
        const off = (q, k) => [q[0] - Math.sin(brg) * half * k, q[1] + (Math.cos(brg) * half * k) / Math.cos((q[0] * Math.PI) / 180)];
        const pts = [off(A, 1), off(B, 1), off(B, -1), off(A, -1)].map(lp);
        // La bande se dessine au fil du passage, puis s'efface
        ctx.globalAlpha = 0.11 * a; ctx.fillStyle = '#097FED';
        ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 0.6 * a; ctx.strokeStyle = '#097FED'; ctx.lineWidth = 1.2; ctx.setLineDash([7, 5]);
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); ctx.moveTo(pts[2].x, pts[2].y); ctx.lineTo(pts[3].x, pts[3].y); ctx.stroke();
        ctx.setLineDash([]);
        const mid = lp([(A[0] + B[0]) / 2 + 1.2, (A[1] + B[1]) / 2]);
        ctx.globalAlpha = Math.min(1, a * 1.5);
        label(ctx, `${pass.name}, ${pass.sensor === 'radar' ? 'radar' : 'optique'}, ${PLATFORM.hhmm(s.t)}`, mid.x, mid.y, '#0560B8', { align: 'center', font: '700 12.5px "Barlow Condensed", sans-serif' });
      }
      // Détections du passage
      ctx.globalAlpha = Math.min(1, a * 1.3); ctx.strokeStyle = '#0560B8'; ctx.lineWidth = 1.1;
      s.dets.forEach((d) => { const q = lp(d); ctx.strokeRect(q.x - 6, q.y - 6, 12, 12); });
      ctx.restore();
    });
  }

  function drawSlicks(ctx, w, P, t, truth) {
    w.slicks.forEach((sl) => {
      const known = P.tracks.has('slick:' + sl.id);
      if (!known && !truth) return;
      if (sl.pts.length < 2) return;
      const lat = sl.pts[0].pos[0];
      const ppn = pxPerNm(lat);
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const path = () => { ctx.beginPath(); sl.pts.forEach((q, i) => { const p = lp(q.pos); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); };
      const wPx = (q) => Math.max(3, (SIM.slickWidthM(q, t) / NM) * ppn);
      const W = wPx(sl.pts[0]);
      path(); ctx.strokeStyle = 'rgba(126, 87, 160, 0.20)'; ctx.lineWidth = W + 8; ctx.stroke();
      path(); ctx.strokeStyle = 'rgba(64, 70, 74, 0.55)'; ctx.lineWidth = W; ctx.stroke();
      path(); ctx.strokeStyle = 'rgba(30, 32, 36, 0.55)'; ctx.lineWidth = Math.max(1.2, W * 0.35); ctx.stroke();
      const mid = lp(sl.pts[Math.floor(sl.pts.length / 2)].pos);
      R.hits.push({ x: mid.x, y: mid.y, r: 14, type: 'track', id: 'slick:' + sl.id });
      sl.pts.forEach((q, i) => { if (i % 4 === 0) { const pp = lp(q.pos); R.hits.push({ x: pp.x, y: pp.y, r: 8, type: 'track', id: 'slick:' + sl.id }); } });
      const end = lp(sl.pts[0].pos);
      ctx.restore();
      queueLabel(known ? 'Nappe d\'hydrocarbures' : 'Nappe (non détectée)', end.x, end.y, 6, '#3D3A44', 3);
    });
  }

  function drawInstallations(ctx, z) {
    if (!R.opts.infra) return;
    D.installations.forEach((ins) => {
      const p = lp(ins.pos);
      if (z >= 10.5) {
        const r = (ins.safetyM / NM) * pxPerNm(ins.pos[0]);
        ctx.save(); ctx.fillStyle = 'rgba(200,30,30,0.07)'; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill(); ctx.restore();
        ring(ctx, p, r, '#B42318', 1.2, [5, 4], 0.85);
      }
      const kind = ins.id.startsWith('flng') ? 'flng' : 'fpso';
      drawVessel(ctx, p, ins.heading, kind, ins.lengthM, PAL.install, { lat: ins.pos[0] });
      R.hits.push({ x: p.x, y: p.y, r: 14, type: 'install', id: ins.id });
    });
  }

  function drawTruth(ctx, w, v, inView) {
    const frac = v.frac;
    w.ships.forEach((s) => {
      if (!s.exists) return;
      const pos = s.prevPos ? G.lerpPos(s.prevPos, s.pos, frac) : s.pos;
      if (!inView(pos)) return;
      const p = lp(pos);
      const heading = G.lerpAng(s.prevHeading || s.heading, s.heading, frac);
      const bad = (s.violations || []).length > 0;
      const pal = s.kind === 'pirogue' && s.colors ? Object.assign({}, PAL.truth, { colors: s.colors, hull: '#F3EBDD' }) : PAL.truth;
      drawVessel(ctx, p, heading, SYM.SPEC[s.kind] ? s.kind : 'cargo', s.lengthM, pal, { lat: pos[0], alpha: 0.7, seed: hashId(s.id) });
      if (bad) ring(ctx, p, 10, '#C026D3', 1.3, [3, 2], 0.9);
      // Seuls les navires invisibles pour la plateforme (sans AIS) portent une étiquette de vérité terrain
      const dark = !s.hasAis || !s.aisOn;
      if (dark && !s.artisanal && R.map.getZoom() >= 10) queueLabel(s.name, p.x, p.y, 10, '#86198F', bad ? 2 : 0, 'italic 600 11.5px Barlow, sans-serif');
    });
  }

  function drawAssets(ctx, w, v, inView) {
    const frac = v.frac, t = v.t;
    const selA = v.sel && v.sel.assetId;
    // Moyens de surface d'abord, aéronefs au-dessus
    const order = w.assets.slice().sort((a, b) => (a.type === 'drone' || a.type === 'mpa' ? 1 : 0) - (b.type === 'drone' || b.type === 'mpa' ? 1 : 0));
    order.forEach((a) => {
      const pos = a.prevPos ? G.lerpPos(a.prevPos, a.pos, frac) : a.pos;
      const heading = G.lerpAng(a.prevHeading || a.heading, a.heading, frac);
      const air = a.type === 'drone' || a.type === 'mpa';
      const atBase = ['base', 'turnaround', 'maintenance', 'prep'].includes(a.state);
      if (!inView(pos) && a.id !== selA) return;
      const p = lp(pos);
      const pal = a.type === 'usv' ? PAL.friend : PAL.state;
      const sel = a.id === selA;
      // Mission : ligne vers la cible, zone de recherche
      if (a.task && !atBase) {
        const tgt = a.task.estimate;
        if (tgt) {
          const q = lp(tgt);
          dashedLine(ctx, p, q, pal.line, [5, 4], 1.3);
          ctx.save(); ctx.strokeStyle = pal.line; ctx.lineWidth = 1.3;
          ctx.beginPath(); ctx.moveTo(q.x - 6, q.y); ctx.lineTo(q.x - 2, q.y); ctx.moveTo(q.x + 2, q.y); ctx.lineTo(q.x + 6, q.y); ctx.moveTo(q.x, q.y - 6); ctx.lineTo(q.x, q.y - 2); ctx.moveTo(q.x, q.y + 2); ctx.lineTo(q.x, q.y + 6); ctx.stroke(); ctx.restore();
          if (a.state === 'recherche') ring(ctx, q, Math.min(180, 6 * pxPerNm(tgt[0])), pal.line, 1.2, [3, 4], 0.7);
        }
      }
      // Portée des capteurs (moyen sélectionné ou en mission)
      if (!atBase && (sel || (a.task && a.type === 'usv'))) {
        const ppn = pxPerNm(pos[0]);
        ring(ctx, p, a.detectLarge * ppn, pal.line, 1, [4, 5], sel ? 0.55 : 0.28);
        if (sel) ring(ctx, p, a.detectSmall * ppn, pal.line, 1, [2, 4], 0.5);
        if (air && a.task && ['surveillance', 'suivi'].includes(a.state)) {
          ctx.save(); ctx.globalAlpha = 0.12; ctx.fillStyle = pal.line; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(10, a.identify * ppn), 0, 7); ctx.fill(); ctx.restore();
        }
      }
      // Trace récente des moyens en mouvement
      trailAsset(ctx, a, pos, t, pal.line, atBase);
      if (atBase && air) {
        // Aéronef au sol : petit, discret
        ctx.save(); ctx.globalAlpha = 0.55; ctx.translate(p.x, p.y); ctx.rotate(Math.PI / 4);
        if (a.type === 'mpa') SYM.mpa(ctx, 20, Object.assign({ lw: 0.8 }, pal)); else SYM.drone(ctx, 18, Object.assign({ lw: 0.8 }, pal));
        ctx.restore();
        R.hits.push({ x: p.x, y: p.y, r: 9, type: 'asset', id: a.id });
        return;
      }
      if (air) {
        const span = a.type === 'mpa' ? 34 : 30;
        ctx.save(); ctx.globalAlpha = 0.18; ctx.translate(p.x + 6, p.y + 8); ctx.rotate((heading * Math.PI) / 180);
        if (a.type === 'mpa') SYM.mpa(ctx, span, { hull: '#000', line: '#000', dark: '#000' }); else SYM.drone(ctx, span, { hull: '#000', line: '#000', dark: '#000' });
        ctx.restore();
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate((heading * Math.PI) / 180);
        if (a.type === 'mpa') SYM.mpa(ctx, span, Object.assign({ lw: 1.1 }, pal)); else SYM.drone(ctx, span, Object.assign({ lw: 1.1 }, pal));
        ctx.restore();
      } else {
        const kind = a.type === 'opv' ? 'opv' : a.type === 'vedette' ? 'vedette' : 'usv';
        const len = { opv: 62, vedette: 20, usv: 11 }[kind];
        if (a.state === 'maintenance') drawVessel(ctx, p, 200, kind, len, PAL.stale, { lat: pos[0], alpha: 0.8 });
        else {
          if (!atBase && a.task) { const sog = a.state === 'transit' ? a.kn : 0; speedLeader(ctx, p, heading, sog, pos[0], pal.line); }
          drawVessel(ctx, p, atBase ? 200 : heading, kind, len, pal, { lat: pos[0] });
        }
      }
      if (sel) selectionRing(ctx, p, 15, v.now);
      R.hits.push({ x: p.x, y: p.y, r: 13, type: 'asset', id: a.id });
      const z = R.map.getZoom();
      if (!atBase || z >= 10.5 || sel) {
        const name = a.type === 'usv' ? a.name : a.short || a.name;
        queueLabel(name, p.x, p.y, 12, pal.ink, sel ? 5 : 3, '700 12.5px "Barlow Condensed", sans-serif');
      }
    });
  }

  function trailAsset(ctx, a, pos, t, color, atBase) {
    let tr = R.assetTrail.get(a.id);
    if (!tr) { tr = []; R.assetTrail.set(a.id, tr); }
    if (atBase) { tr.length = 0; return; }
    if (!tr.length || t - tr[tr.length - 1].t >= 4 || t < tr[tr.length - 1].t) {
      if (tr.length && t < tr[tr.length - 1].t) tr.length = 0;
      tr.push({ t, pos: pos.slice() });
      if (tr.length > 30) tr.shift();
    }
    if (tr.length < 2) return;
    ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = 0.35; ctx.lineWidth = 1.5;
    ctx.beginPath(); tr.forEach((q, i) => { const p = lp(q.pos); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.lineTo(lp(pos).x, lp(pos).y); ctx.stroke(); ctx.restore();
  }

  // Point d'attention (démo guidée) : cercle doré autour de la zone commentée
  function drawFocus(ctx, v) {
    if (!v.focus) return;
    const p = lp(v.focus);
    const k = (v.now / 1600) % 1;
    ctx.save(); ctx.strokeStyle = '#F9B02A'; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.8 * (1 - k);
    ctx.beginPath(); ctx.arc(p.x, p.y, 30 + k * 30, 0, 7); ctx.stroke(); ctx.restore();
  }

  // ---------- Interaction ----------
  function hitTest(layerPoint) {
    let best = null, bd = 1e9;
    R.hits.forEach((h) => {
      const d = Math.hypot(h.x - layerPoint.x, h.y - layerPoint.y);
      if (d <= h.r + 5 && d < bd) { best = h; bd = d; }
    });
    return best;
  }

  // Centre la carte sur un point ; « at » place ce point ailleurs qu'au centre (fraction de la carte)
  function flyTo(pos, zoom, opts) {
    const map = R.map;
    const target = zoom || Math.max(map.getZoom(), 9);
    let center = L.latLng(pos);
    if (opts && opts.at) {
      const size = map.getSize();
      const pt = map.project(center, target).subtract(L.point(size.x * (opts.at[0] - 0.5), size.y * (opts.at[1] - 0.5)));
      center = map.unproject(pt, target);
    }
    if (opts && opts.instant) map.setView(center, target, { animate: false });
    else map.flyTo(center, target, { duration: 0.9 });
  }

  Object.assign(R, { init, frame, hitTest, flyTo, setOpt, drawFrame, PAL, SEV, sevOf, updateLabels });
  window.RENDER = R;
})();
