// Rejoue le scénario sans interface et vérifie que chaque cas lève ses alertes.
// Usage : node tools/test-scenario.js
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ctx = { window: {}, console, crypto: require('crypto').webcrypto, TextEncoder, setTimeout };
ctx.window = ctx; vm.createContext(ctx);
['geo-data', 'geo', 'data', 'sim', 'detect'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), ctx));
const { SIM, PLATFORM, DIAMBAR_DATA: D, DIAMBAR_GEO: GEO, G } = ctx;
const chk = (n, p) => console.log(n.padEnd(34), 'b6', G.inFeature(p, GEO.band6), 'b12', G.inFeature(p, GEO.band12), 'zee', G.inFeature(p, GEO.zee));
chk('hailong peche', [15.82, -16.635]); chk('capvert mbour', [14.45, -17.045]); chk('capvert ghost', [14.1, -17.55]);
chk('marlin rdv', [14.6, -18.95]); chk('pirogue panne', [14.2, -17.3]); chk('pecheurs', [14.05, -17.18]); chk('golden rdv', [14.0, -17.25]);
const auto = process.argv.includes('--auto');
const w = SIM.createWorld({ srModel: true }); const P = PLATFORM.createPlatform();
let seen = 0;
while (w.t < D.END_MIN) {
  SIM.step(w, 1); w.reports.forEach((r) => PLATFORM.ingest(P, r)); w.reports.length = 0;
  PLATFORM.evaluate(P, w); PLATFORM.update(P, w);
  for (; seen < P.alerts.length; seen++) {
    const a = P.alerts[seen];
    const hh = new Date(D.START + a.created * 60000).toISOString().slice(11, 16);
    console.log(hh, a.id, a.rule.padEnd(15), String(a.score).padStart(3), a.truthPositive ? 'VRAI' : 'faux', a.label, a.truthId);
    if (auto && a.score >= 50) {
      const av = PLATFORM.available(w, a.rule === 'DISTRESS' ? ['opv','usv'] : a.rule === 'GATHER' ? ['usv'] : ['usv', 'drone']).sort((x, y) => PLATFORM.eta(x, a.pos) - PLATFORM.eta(y, a.pos))[0];
      if (av) PLATFORM.assign(P, w, a.id, av.id, a.rule === 'DISTRESS' ? 'rescue' : a.rule === 'GATHER' ? 'suivi' : 'verification');
    }
  }
}
if (auto) P.journal.filter((j) => j.type === 'verif' || j.type === 'decision').reverse().forEach((j) => console.log('  ', new Date(D.START + j.t * 60000).toISOString().slice(11, 16), j.text.slice(0, 110)));
console.log('alertes', P.alerts.length, 'pistes', P.tracks.size);
