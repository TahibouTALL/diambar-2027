// Rejoue le scénario sans interface et affiche les alertes, preuves et décisions.
// Usage : node tools/test-scenario.js [--manuel] [--terre]
//   --manuel : sans le scénario de référence (seulement l'envoi automatique des drones)
//   --terre  : signale les navires qui passent sur la terre (contrôle des trajectoires)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { console, crypto: require('crypto').webcrypto, TextEncoder, setTimeout, Math, Date };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['geo-data', 'geo', 'data', 'sim', 'detect']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
}
const { SIM, PLATFORM, DIAMBAR_DATA: D, DIAMBAR_GEO: GEO, G } = ctx;
const hh = PLATFORM.hhmm;
const manual = process.argv.includes('--manuel');
const checkLand = process.argv.includes('--terre');

const landMask = checkLand ? G.rasterize(GEO.land, { w: -18.5, e: -15.8, s: 11.8, n: 16.6 }, 0.003) : null;
const t0 = Date.now();
const w = SIM.createWorld({ srModel: true });
const P = PLATFORM.createPlatform();
P.auto = true;
P.script = !manual;
let seenInc = 0;
const landWarn = new Map();
while (w.t < D.END_MIN) {
  SIM.step(w, 1);
  w.reports.forEach((r) => PLATFORM.ingest(P, w, r));
  w.reports.length = 0;
  PLATFORM.evaluate(P, w);
  PLATFORM.update(P, w);
  for (; seenInc < P.incidents.length; seenInc++) {
    const a = P.incidents[seenInc];
    console.log(hh(a.created), a.id, a.rule.padEnd(15), String(a.score).padStart(3), (a.truthId || '?').padEnd(10), a.label);
  }
  if (checkLand && w.t % 10 === 0) {
    w.ships.forEach((s) => {
      if (!s.exists || s.docked || s.artisanal) return;
      if (G.inMask(landMask, s.pos) && G.coastDist(s.pos) > 0.3 && !landWarn.has(s.id)) landWarn.set(s.id, `${hh(w.t)} ${s.id} ${s.name} [${s.pos.map((v) => v.toFixed(3))}]`);
    });
    w.assets.forEach((a) => {
      if (['base', 'maintenance', 'turnaround', 'prep'].includes(a.state) || a.type === 'drone' || a.type === 'mpa') return;
      if (G.inMask(landMask, a.pos) && G.coastDist(a.pos) > 0.3 && !landWarn.has(a.id)) landWarn.set(a.id, `${hh(w.t)} ${a.id} ${a.state} [${a.pos.map((v) => v.toFixed(3))}]`);
    });
  }
}
const ms = Date.now() - t0;
console.log('\n--- Incidents');
P.incidents.forEach((i) => {
  console.log(`${i.id} ${hh(i.created)} [${i.cat}] ${i.title} · ${i.label} · score ${i.score} · ${i.status}${i.closed ? ' (close)' : ''} · indices: ${i.indicators.map((x) => x.rule).join(', ')}`);
  i.timeline.slice(1).forEach((e) => console.log(`    ${hh(e.t)} ${e.txt}`));
});
console.log('\n--- Moyens');
w.assets.forEach((a) => console.log(a.id.padEnd(10), a.state.padEnd(14), 'missions', a.missions));
console.log('\n--- Apprentissage');
Object.entries(P.learn).forEach(([k, L]) => { if (L.n) console.log(k.padEnd(16), Math.round((100 * L.a) / (L.a + L.b)) + ' %', 'n=' + L.n); });
console.log('\nPistes', P.tracks.size, '· navires', w.ships.length, '· secourus', P.stats.saved, '· durée', ms, 'ms');
if (checkLand) { console.log('\n--- Sur la terre'); landWarn.forEach((v) => console.log(v)); }
