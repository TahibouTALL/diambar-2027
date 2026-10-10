// Génère js/geo-data.js : fond de carte et zones maritimes du démonstrateur.
//
// Sources (toutes ouvertes) :
//   - Trait de côte détaillé : OpenStreetMap via @geo-maps/earth-lands-100m (ODbL)
//   - Mer territoriale (12 milles) : OpenStreetMap via @geo-maps/countries-maritime-1km (ODbL)
//   - Bathymétrie, fleuves, frontières : Natural Earth 1:10 m (domaine public)
//
// La ZEE, la bande des 6 milles et la zone commune Sénégal - Guinée-Bissau sont
// CALCULÉES à partir des règles connues (parallèle 16°04' N, azimut 240° depuis le
// cap Roxo, ligne médiane avec le Cabo Verde, 200 milles). Ce sont des tracés
// indicatifs, à remplacer par les limites officielles.
//
// Usage :
//   node tools/build-geo.js --nm <node_modules> --ne <natural-earth-vector/geojson> \
//        --lands <earth-lands-100m/map.geo.json> --maritime <countries-maritime-1km/map.geo.json>
const path = require('path');
const fs = require('fs');

const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : null; };
const NM = arg('nm') || path.join(__dirname, '..', 'node_modules');
const NE = arg('ne');
const LANDS = arg('lands');
const MARITIME = arg('maritime');
if (!NE || !LANDS || !MARITIME) { console.error('Paramètres manquants (--ne, --lands, --maritime).'); process.exit(1); }

const turf = require(path.join(NM, '@turf', 'turf'));
const pc = require(path.join(NM, 'polygon-clipping'));
const topo = require(path.join(NM, 'world-atlas', 'countries-10m.json'));
const { mesh } = require(path.join(NM, 'topojson-client'));

const BBOX = [-23.6, 10.4, -11.0, 18.7]; // ouest, sud, est, nord
const NMI = 1.852; // km par mille nautique
const CAP_ROXO = [-16.7183, 12.3325];
const LAT_MRT = 16 + 4 / 60; // 16°04' N

const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', ...a);
const round = (g, d = 1e4) => JSON.parse(JSON.stringify(g, (k, v) => (typeof v === 'number' ? Math.round(v * d) / d : v)));
const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const mp = (coords) => ({ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: coords } });
const simplifyMP = (coords, tol) => turf.simplify(mp(coords), { tolerance: tol, highQuality: true }).geometry.coordinates
  .filter((p) => p && p[0] && p[0].length >= 4);

// ---------- Terres (OSM) ----------
const rawLands = JSON.parse(fs.readFileSync(LANDS, 'utf8'));
const landPolys = [];
rawLands.geometries.forEach((g) => polysOf(g).forEach((p) => {
  const ring = p[0];
  let w = 180, e = -180, s = 90, n = -90;
  for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  if (e < BBOX[0] || w > BBOX[2] || n < BBOX[1] || s > BBOX[3]) return;
  const c = turf.bboxClip(turf.polygon(p), BBOX).geometry;
  polysOf(c).forEach((q) => { if (q[0] && q[0].length >= 4) landPolys.push(q); });
}));
// Île de Gorée (absente des données à 100 m) : petite ellipse orientée NNE.
const goree = [];
for (let i = 0; i <= 24; i++) {
  const a = (i / 24) * 2 * Math.PI;
  const dx = 0.0016 * Math.cos(a), dy = 0.0042 * Math.sin(a);
  const r = (20 * Math.PI) / 180;
  goree.push([-17.3985 + dx * Math.cos(r) + dy * Math.sin(r) * 0.4, 14.6672 + dy * Math.cos(r) - dx * Math.sin(r)]);
}
goree[goree.length - 1] = goree[0];
landPolys.push([goree]);
log('terres :', landPolys.length, 'polygones');

const landDetail = simplifyMP(landPolys, 0.0006);
const landLow = pc.union(...simplifyMP(landPolys, 0.003).map((p) => [p]));
log('terres simplifiées');

// ---------- Mer territoriale OSM ----------
const maritime = JSON.parse(fs.readFileSync(MARITIME, 'utf8'));
const mar = (a3) => maritime.features.find((f) => f.properties.A3 === a3).geometry;
const senMar = simplifyMP(polysOf(mar('SEN')), 0.001);
const gmbMar = simplifyMP(polysOf(mar('GMB')), 0.001);
const gnbMar = simplifyMP(polysOf(mar('GNB')), 0.001);
const senLand = pc.intersection(landLow, senMar);
const gmbLand = pc.intersection(landLow, gmbMar);
// Côte généralisée (fermeture morphologique de 2 km) : referme les chenaux des deltas
// pour que les zones calculées restent en mer ouverte.
const closeLand = (coords) => {
  const outer = coords.map((p) => [p[0]]);
  const grown = turf.buffer(mp(outer), 2, { units: 'kilometers', steps: 8 });
  return polysOf(turf.buffer(grown, -2, { units: 'kilometers', steps: 8 }).geometry);
};
const landClosed = pc.union(closeLand(landLow), landLow.map((p) => [p[0]]));
log('terres Sénégal et Gambie, côte généralisée');

// Ligne des 12 milles : segments du contour maritime situés en mer.
function seaward(coordsMP, landMP) {
  const landF = mp(landMP);
  const lines = [];
  coordsMP.forEach((poly) => poly.forEach((ring) => {
    let cur = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], b = ring[i + 1];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const atSea = !turf.booleanPointInPolygon(turf.point(mid), landF) && mid[0] < -16.0;
      if (atSea) { if (!cur.length) cur.push(a); cur.push(b); } else if (cur.length) { lines.push(cur); cur = []; }
    }
    if (cur.length) lines.push(cur);
  }));
  return lines.filter((l) => l.length > 2);
}
const ts12 = seaward(senMar, landLow).concat(seaward(gmbMar, landLow));
log('ligne des 12 milles :', ts12.length, 'segments');

// ---------- Ligne médiane avec le Cabo Verde ----------
const coastVerts = (mpCoords, filt) => {
  const out = [];
  mpCoords.forEach((p) => p[0].forEach(([x, y]) => { if (filt(x, y)) out.push([x, y]); }));
  return out;
};
const senCoast = coastVerts(senLand, (x) => x < -16.1);
const gmbCoast = coastVerts(gmbLand, (x) => x < -16.3);
const cpvCoast = coastVerts(landLow, (x) => x < -22.0);
const dmin = (p, pts) => { let m = 1e9; for (const q of pts) { const d = turf.distance(p, q); if (d < m) m = d; } return m; };
const median = [];
for (let lat = 9.0; lat <= 18.6; lat += 0.1) {
  let lo = -23.0, hi = -17.0;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    const f = dmin([mid, lat], senCoast.concat(gmbCoast)) - dmin([mid, lat], cpvCoast);
    if (f > 0) lo = mid; else hi = mid;
  }
  median.push([(lo + hi) / 2, lat]);
}
log('ligne médiane : longitude', median[40][0].toFixed(2), 'à', median[40][1].toFixed(1) + '° N');
const eastOfMedian = [[...median, [-10, median[median.length - 1][1]], [-10, median[0][1]], median[0]]];

// ---------- Limites latérales ----------
const far240 = turf.destination(turf.point(CAP_ROXO), 800, 240, { units: 'kilometers' }).geometry.coordinates;
const northOf240 = [[CAP_ROXO, far240, [-30, 25], [-10, 25], [-10, CAP_ROXO[1]], CAP_ROXO]];
const southOfMrt = [[[-30, 5], [-10, 5], [-10, LAT_MRT], [-30, LAT_MRT], [-30, 5]]];

// Bande gambienne : mer territoriale et bande entre ses limites latérales, jusqu'à 200 milles.
const gmbSeaLats = gmbMar.flatMap((p) => p[0]).filter(([x]) => x < -16.95).map(([, y]) => y);
const gS = Math.min(...gmbSeaLats), gN = Math.max(...gmbSeaLats);
const gmb200 = turf.buffer(mp(gmbLand), 200 * NMI, { units: 'kilometers', steps: 24 }).geometry;
const gambiaZone = pc.difference(pc.union(gmbMar, pc.intersection(polysOf(gmb200), [[[-30, gS], [-10, gS], [-10, gN], [-30, gN], [-30, gS]]])), landLow);
log('bande gambienne', gS.toFixed(3), gN.toFixed(3));

// ---------- ZEE indicative ----------
const sen200 = polysOf(turf.buffer(mp(senLand), 200 * NMI, { units: 'kilometers', steps: 32 }).geometry);
const westSea = [[[-30, 5], [-15.6, 5], [-15.6, 25], [-30, 25], [-30, 5]]];
let zee = pc.intersection(sen200, northOf240, southOfMrt, eastOfMedian, westSea);
zee = pc.difference(zee, landClosed, gambiaZone);
zee = zee.filter((p) => turf.area(turf.polygon(p)) > 2000e6); // garde la mer ouverte
log('ZEE :', Math.round(turf.area(mp(zee)) / 1e6), 'km²');
// Limite extérieure de la ZEE (sans le bord côtier) pour l'affichage.
const nearCoast = mp(polysOf(turf.buffer(mp(landClosed), 3, { units: 'kilometers', steps: 8 }).geometry));
const zeeLimit = [];
zee.forEach((poly) => poly.forEach((ring) => {
  let cur = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1];
    const keep = !turf.booleanPointInPolygon(turf.point([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]), nearCoast);
    if (keep) { if (!cur.length) cur.push(a); cur.push(b); } else if (cur.length) { zeeLimit.push(cur); cur = []; }
  }
  if (cur.length) zeeLimit.push(cur);
}));
log('limite de la ZEE :', zeeLimit.length, 'segments');

// ---------- Bande des 6 milles ----------
const senClosed = pc.intersection(landClosed, senMar);
const sen6 = polysOf(turf.buffer(mp(senClosed), 6 * NMI, { units: 'kilometers', steps: 16 }).geometry);
let band6 = pc.intersection(sen6, northOf240, southOfMrt);
band6 = pc.difference(band6, landClosed, gambiaZone);
band6 = band6.filter((p) => turf.area(turf.polygon(p)) > 30e6);
log('bande des 6 milles :', Math.round(turf.area(mp(band6)) / 1e6), 'km²');

// ---------- Zone commune Sénégal - Guinée-Bissau (accord de 1993, AGC) ----------
const arc = [CAP_ROXO];
for (let b = 220; b <= 268; b += 2) arc.push(turf.destination(turf.point(CAP_ROXO), 200 * NMI, b, { units: 'kilometers' }).geometry.coordinates);
arc.push(CAP_ROXO);
let agc = pc.difference([[arc]], senMar, gnbMar, landLow);
agc = pc.intersection(agc, eastOfMedian, [[[BBOX[0], BBOX[1]], [BBOX[2], BBOX[1]], [BBOX[2], BBOX[3]], [BBOX[0], BBOX[3]], [BBOX[0], BBOX[1]]]]);
agc = agc.filter((p) => turf.area(turf.polygon(p)) > 500e6);
log('zone commune AGC :', Math.round(turf.area(mp(agc)) / 1e6), 'km²');

// ---------- Bathymétrie (Natural Earth) ----------
const bathy = [];
const isoLabels = [];
for (const [file, depth] of [['K_200', 200], ['J_1000', 1000], ['I_2000', 2000], ['H_3000', 3000], ['G_4000', 4000], ['F_5000', 5000]]) {
  const g = JSON.parse(fs.readFileSync(path.join(NE, 'ne_10m_bathymetry_' + file + '.geojson'), 'utf8'));
  const parts = [];
  g.features.forEach((f) => {
    const b = turf.bbox(f);
    if (b[2] < BBOX[0] || b[0] > BBOX[2] || b[3] < BBOX[1] || b[1] > BBOX[3]) return;
    polysOf(turf.bboxClip(f, BBOX).geometry).forEach((p) => { if (p[0] && p[0].length >= 4) parts.push(p); });
  });
  const coords = simplifyMP(parts, 0.006);
  bathy.push({ depth, geom: coords });
  // Étiquettes : sommet le plus à l'est du contour, à quelques latitudes repères.
  for (const lat of [16.6, 15.4, 13.9, 12.6]) {
    let best = null;
    coords.forEach((p) => p.forEach((ring) => ring.forEach(([x, y]) => {
      if (Math.abs(y - lat) > 0.06 || x > -16.0 || x < BBOX[0] + 0.3) return;
      if (!best || x > best[0]) best = [x, y];
    })));
    if (best) isoLabels.push({ pos: [best[1], best[0]], depth });
  }
}
log('bathymétrie :', bathy.map((b) => b.depth + ' m').join(', '));

// ---------- Fleuves et frontières ----------
const riv = JSON.parse(fs.readFileSync(path.join(NE, 'ne_10m_rivers_lake_centerlines.geojson'), 'utf8'));
const rivers = [];
riv.features.forEach((f) => {
  const b = turf.bbox(f);
  if (b[2] < BBOX[0] || b[0] > BBOX[2] || b[3] < BBOX[1] || b[1] > BBOX[3]) return;
  const c = turf.bboxClip(f, BBOX).geometry;
  const lines = c.type === 'LineString' ? [c.coordinates] : c.coordinates;
  lines.forEach((l) => { if (l.length > 1) rivers.push({ name: f.properties.name, line: turf.simplify(turf.lineString(l), { tolerance: 0.003 }).geometry.coordinates }); });
});
const borderMesh = mesh(topo, topo.objects.countries, (a, b) => a !== b);
const borders = turf.bboxClip(turf.feature(borderMesh), BBOX).geometry;
log('fleuves :', rivers.map((r) => r.name).join(', '));

// ---------- Points de côte pour les calculs de distance ----------
const coastPts = [];
simplifyMP(landPolys, 0.004).forEach((p) => p[0].forEach(([x, y]) => {
  if (x < -15.9 && y > 11.0 && y < 17.6 && x > -18.0) coastPts.push([Math.round(y * 1e4) / 1e4, Math.round(x * 1e4) / 1e4]);
}));

// Les petits lacs et mares deviennent des triangles une fois simplifiés : seuls les plans d'eau
// intérieurs de plus de 8 km² sont gardés (lac de Guiers, lac d'Aleg...).
const landShown = landDetail.map((p) => [p[0], ...p.slice(1).filter((h) => h.length >= 4 && turf.area(turf.polygon([h])) > 8e6)]);

const out = {
  bbox: BBOX,
  land: { type: 'MultiPolygon', coordinates: landShown },
  borders,
  rivers,
  bathy,
  isoLabels,
  zee: { type: 'MultiPolygon', coordinates: simplifyMP(zee, 0.004) },
  zeeLimit: { type: 'MultiLineString', coordinates: zeeLimit.filter((l) => l.length > 1).map((l) => (l.length > 2 ? turf.simplify(turf.lineString(l), { tolerance: 0.003 }).geometry.coordinates : l)) },
  ts12: { type: 'MultiLineString', coordinates: ts12.map((l) => turf.simplify(turf.lineString(l), { tolerance: 0.001 }).geometry.coordinates) },
  ts12poly: { type: 'MultiPolygon', coordinates: simplifyMP(senMar, 0.002) },
  band6: { type: 'MultiPolygon', coordinates: simplifyMP(band6, 0.002) },
  gambia: { type: 'MultiPolygon', coordinates: simplifyMP(gambiaZone, 0.004) },
  agc: { type: 'MultiPolygon', coordinates: simplifyMP(agc, 0.004) },
  median: median.map(([x, y]) => [y, x]),
  coastPts,
  zeeAreaKm2: Math.round(turf.area(mp(zee)) / 1e6),
  agcAreaKm2: Math.round(turf.area(mp(agc)) / 1e6),
};

const js = '// Généré par tools/build-geo.js. Ne pas modifier à la main.\n' +
  '// Côtes et mer territoriale : OpenStreetMap (ODbL), via geo-maps. Bathymétrie, fleuves, frontières : Natural Earth.\n' +
  '// ZEE, bande des 6 milles et zone commune : tracés calculés, indicatifs, non officiels.\n' +
  'window.DIAMBAR_GEO = ' + JSON.stringify(round(out)) + ';\n';
fs.writeFileSync(path.join(__dirname, '..', 'js', 'geo-data.js'), js);
log('écrit js/geo-data.js :', (js.length / 1024).toFixed(0), 'Ko ; ZEE', out.zeeAreaKm2, 'km² ; AGC', out.agcAreaKm2, 'km² ; points de côte', coastPts.length);
