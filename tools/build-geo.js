// Génère js/geo-data.js à partir de Natural Earth (world-atlas, 1:10m).
// Usage : node tools/build-geo.js <dossier node_modules>
// Les limites maritimes produites sont des tracés INDICATIFS calculés par
// tampon géométrique, à remplacer par les limites officielles (Marine Regions / SHOM).
const path = require('path');
const fs = require('fs');
const NM = process.argv[2] || path.join(__dirname, '..', 'node_modules');
const topo = require(path.join(NM, 'world-atlas', 'countries-10m.json'));
const { feature } = require(path.join(NM, 'topojson-client'));
const turf = require(path.join(NM, '@turf', 'turf'));

const countries = feature(topo, topo.objects.countries).features;
const pick = (names) => countries.filter((f) => names.includes(f.properties.name));
const BBOX = [-21.5, 11.6, -11.8, 17.2]; // [ouest, sud, est, nord]

const round = (g) => JSON.parse(JSON.stringify(g, (k, v) =>
  typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v));

function clip(f) {
  const c = turf.bboxClip(f, BBOX);
  return turf.simplify(c, { tolerance: 0.004, highQuality: true });
}

const landNames = ['Senegal', 'Gambia', 'Mauritania', 'Guinea-Bissau', 'Guinea', 'Mali', 'Cabo Verde'];
const land = pick(landNames).map((f) => {
  const c = clip(f);
  c.properties = { name: f.properties.name };
  return c;
}).filter((f) => f.geometry && f.geometry.coordinates.length);

const sen = pick(['Senegal'])[0];
const gmb = pick(['Gambia'])[0];
const allLand = pick(landNames).reduce((a, b) => turf.union(a, b));

// Zone de travail en mer : bornes approximatives de la ZEE sénégalaise.
// Nord : parallèle 16°04' N (limite avec la Mauritanie).
// Sud : azimut 240° depuis le cap Roxo (limite avec la Guinée-Bissau).
// Ouest : ligne médiane approximative avec le Cabo Verde (-20.1° environ).
const capRoxo = [-16.72, 12.33];
const far = turf.destination(turf.point(capRoxo), 500, 240, { units: 'kilometers' }).geometry.coordinates;
const sector = turf.polygon([[
  [-16.30, 16.07], [-20.10, 16.07], [-20.10, far[1] > 12.33 ? far[1] : 11.0],
  far, capRoxo, [-16.30, 12.33], [-16.30, 16.07],
]]);

function seaBand(nm) {
  const b = turf.buffer(sen, nm * 1.852, { units: 'kilometers', steps: 16 });
  let s = turf.intersect(b, sector);
  s = turf.difference(s, allLand);
  return s;
}

// Eaux gambiennes : bande entre les parallèles de la frontière, exclue de la ZEE.
const gambiaStrip = turf.polygon([[
  [-16.30, 13.06], [-20.2, 13.06], [-20.2, 13.59], [-16.30, 13.59], [-16.30, 13.06],
]]);

let zee = seaBand(200);
zee = turf.difference(zee, gambiaStrip);
let b12 = turf.difference(seaBand(12), gambiaStrip);
let b6 = turf.difference(seaBand(6), gambiaStrip);

const simplify = (f, t) => turf.simplify(f, { tolerance: t, highQuality: true });
const out = {
  land: turf.featureCollection(land),
  zee: simplify(zee, 0.01),
  band12: simplify(b12, 0.004),
  band6: simplify(b6, 0.003),
  gambia: turf.intersect(gambiaStrip, turf.difference(turf.buffer(gmb, 200 * 1.852, { units: 'kilometers' }), allLand)),
};
out.gambia = simplify(out.gambia, 0.01);

// Surface de la ZEE indicative (km²) pour le calcul de couverture.
out.zeeAreaKm2 = Math.round(turf.area(out.zee) / 1e6);

const js = '// Généré par tools/build-geo.js. Tracés indicatifs, non officiels.\n' +
  '// Source des côtes : Natural Earth 1:10m via world-atlas (domaine public).\n' +
  'window.DIAMBAR_GEO = ' + JSON.stringify(round(out)) + ';\n';
fs.writeFileSync(path.join(__dirname, '..', 'js', 'geo-data.js'), js);
console.log('ZEE indicative :', out.zeeAreaKm2, 'km² ; taille', (js.length / 1024).toFixed(0), 'Ko');
