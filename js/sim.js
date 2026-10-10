// Moteur de simulation : mouvement réel des navires (vérité terrain), émissions AIS et VMS,
// passages satellites, nappes, déplacements des moyens. La plateforme (detect.js) ne voit que
// les rapports produits ici, jamais la vérité terrain.
(function () {
  const D = window.DIAMBAR_DATA;
  const GEO = window.DIAMBAR_GEO;
  const NM_KM = 1.852;

  // ---------- Géométrie des routes ----------
  function prepRoute(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + G.distNm(pts[i - 1], pts[i]));
    return { pts, cum, len: cum[cum.length - 1] };
  }
  function along(r, s) {
    if (s <= 0) return { pos: r.pts[0].slice(), heading: G.bearing(r.pts[0], r.pts[1]) };
    if (s >= r.len) { const n = r.pts.length; return { pos: r.pts[n - 1].slice(), heading: G.bearing(r.pts[n - 2], r.pts[n - 1]) }; }
    let i = 1;
    while (r.cum[i] < s) i++;
    const k = (s - r.cum[i - 1]) / (r.cum[i] - r.cum[i - 1]);
    return { pos: G.lerpPos(r.pts[i - 1], r.pts[i], k), heading: G.bearing(r.pts[i - 1], r.pts[i]) };
  }

  const isNight = (t) => t < D.sun.rise || t >= D.sun.set; // fenêtre du scénario : nuit avant 07:02 et après 18:51
  const nearAisStation = (p) => D.aisStations.some((s) => G.distNm(s.pos, p) <= D.AIS_RANGE_NM);
  // Tirage stable pour une paire (passage, navire) : le résultat ne dépend pas du reste de la simulation.
  function hrand(a, b) {
    let h = 2166136261;
    const s = a + '|' + b;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  // ---------- Création du monde ----------
  function createWorld(opts) {
    const rand = G.rng(20271014);
    const defs = D.actors.concat(D.background(rand));
    const ships = defs.map((d) => {
      const s = {
        ...d,
        pos: d.start ? d.start.slice() : [0, 0], prevPos: null, heading: 0, prevHeading: 0, sog: 0,
        exists: false, legIdx: 0, legState: {}, evIdx: 0,
        aisOn: d.hasAis ? d.aisOn !== false : false, vmsOn: !!d.vmsId,
        gathering: false, distress: false, rescued: false, diverted: false,
        lastAisTx: -9999, aisNext: D.PRE_MIN + Math.floor(rand() * 6), lastVmsTx: D.PRE_MIN - 60 + Math.floor(rand() * 60),
        ghostPos: d.vmsGhost ? d.vmsGhost.center.slice() : null,
        trail: [], rand: G.rng(Math.floor(rand() * 1e9)),
      };
      if (d.route) s.routeGeo = prepRoute(d.route.pts);
      if (d.trips) d.trips.list.forEach((tr) => { tr.geo = prepRoute(tr.pts); });
      if (d.trip) {
        const dist = G.distNm(d.trip.start, d.trip.spot);
        const go = (dist / d.trip.kn) * 60;
        s.tripT = { dep: d.trip.dep, arr: d.trip.dep + go, fishEnd: d.trip.dep + go + d.trip.fish, back: d.trip.dep + 2 * go + d.trip.fish };
      }
      if (d.plan) s.plan = d.plan.map((l) => ({ ...l }));
      return s;
    });
    const assets = D.assets.map((a) => ({
      ...a,
      pos: (a.startAt || a.base).slice(), prevPos: null, heading: 0, prevHeading: 0,
      state: a.maintenance ? 'maintenance' : a.patrol ? 'patrouille' : 'base',
      patrolIdx: 0, patrolPhase: 0, task: null, usedMin: 0, readyAt: 0, lastScan: D.PRE_MIN + 8, missions: 0,
    }));
    const w = {
      t: D.PRE_MIN, ships, shipById: new Map(ships.map((s) => [s.id, s])), assets, slicks: [], rand,
      // Masque de terre pour la navigation des moyens de surface (contournement de la presqu'île du Cap-Vert)
      navMask: G.rasterize(GEO.land, { w: -18.5, e: -15.8, s: 11.8, n: 16.6 }, 0.003),
      opts: Object.assign({ srModel: true }, opts),
      pendingSat: D.satPasses.map((p) => ({ ...p })), satDone: [], reports: [], events: [],
    };
    return w;
  }

  // ---------- Mouvement des navires ----------
  function setPose(s, pos, heading, sog) {
    s.pos = pos; s.heading = heading; s.sog = sog;
  }

  function stepAnalytic(w, s) {
    const t = w.t;
    if (s.route) {
      const r = s.route;
      const dist = (r.kn * (t - r.t0)) / 60;
      if (dist < 0) {
        s.exists = !!r.dockBefore;
        if (s.exists) { const a = along(s.routeGeo, 0); setPose(s, a.pos, a.heading, 0); s.docked = true; }
        return;
      }
      if (dist > s.routeGeo.len) {
        s.exists = !!r.dockAfter;
        if (s.exists) { const a = along(s.routeGeo, s.routeGeo.len); setPose(s, a.pos, a.heading, 0); s.docked = true; }
        return;
      }
      s.exists = true; s.docked = false;
      const a = along(s.routeGeo, dist);
      setPose(s, a.pos, a.heading, r.kn);
      return;
    }
    if (s.anchored) {
      s.exists = true;
      const sw = Math.sin((t + s.mmsi.length * 37) / 47) * 6;
      setPose(s, s.anchored.pos, (s.anchored.heading + sw + 360) % 360, 0);
      return;
    }
    if (s.trips) {
      s.exists = true;
      const act = s.trips.list.find((tr) => t >= tr.t0 && t <= tr.t0 + (tr.geo.len / s.trips.kn) * 60);
      if (act) {
        const a = along(act.geo, (s.trips.kn * (t - act.t0)) / 60);
        setPose(s, a.pos, a.heading, s.trips.kn); s.docked = false;
      } else {
        const past = s.trips.list.filter((tr) => tr.t0 + (tr.geo.len / s.trips.kn) * 60 < t).pop();
        const p = past ? past.pts[past.pts.length - 1] : s.trips.rest;
        setPose(s, p.slice(), s.heading, 0); s.docked = true;
      }
      return;
    }
    if (s.loiter) {
      s.exists = true;
      const L = s.loiter;
      const th = ((L.kn / L.r) * t) / 60 + s.mmsi.length;
      const p = G.move(L.center, (G.deg(th) % 360 + 360) % 360, L.r);
      setPose(s, p, (G.deg(th) + 90 + 360) % 360, L.kn);
      return;
    }
    if (s.trip) {
      const T = s.tripT, tr = s.trip;
      if (t < T.dep || t > T.back) { s.exists = false; return; }
      s.exists = true;
      if (t < T.arr) {
        const k = (t - T.dep) / (T.arr - T.dep);
        setPose(s, G.lerpPos(tr.start, tr.spot, k), G.bearing(tr.start, tr.spot), tr.kn);
      } else if (t < T.fishEnd) {
        const th = (t - T.arr) / 9;
        const p = G.move(tr.spot, (G.deg(th) % 360 + 360) % 360, 0.25);
        setPose(s, p, (G.deg(th) + 90 + 360) % 360, 1.6);
      } else {
        const k = (t - T.fishEnd) / (T.back - T.fishEnd);
        setPose(s, G.lerpPos(tr.spot, tr.start, k), G.bearing(tr.spot, tr.start), tr.kn);
      }
    }
  }

  function nextLeg(s) { s.legIdx++; s.legState = {}; }

  function stepLegs(w, s, dt) {
    while (s.evIdx < (s.events || []).length && s.events[s.evIdx].at <= w.t) {
      const ev = s.events[s.evIdx];
      if (ev.set) Object.assign(s, ev.set);
      if (ev.plan) { s.plan = ev.plan.map((l) => ({ ...l })); s.legIdx = 0; s.legState = {}; }
      s.evIdx++;
    }
    const leg = s.plan && s.plan[s.legIdx];
    if (!leg) { s.sog = 0; s.exists = false; s.gone = true; return; } // route terminée : le navire quitte la zone
    const st = s.legState;
    const goTo = (target, kn) => {
      const d = G.distNm(s.pos, target);
      const step = (kn * dt) / 60;
      if (d <= step) { s.pos = target.slice(); return true; }
      const brg = G.bearing(s.pos, target);
      s.pos = G.move(s.pos, brg, step);
      s.heading = G.lerpAng(s.heading, brg, 0.6);
      return false;
    };
    if (leg.kind === 'goto') {
      s.sog = leg.kn;
      if (goTo(leg.to, leg.kn)) nextLeg(s);
    } else if (leg.kind === 'path') {
      if (st.i === undefined) st.i = 0;
      s.sog = leg.kn;
      if (goTo(leg.pts[st.i], leg.kn)) { st.i++; if (st.i >= leg.pts.length) { nextLeg(s); s.exists = s.exists && !leg.vanish; } }
    } else if (leg.kind === 'loiter') {
      if (!st.center) { st.center = s.pos.slice(); st.brg = s.rand() * 360; st.change = w.t + 15; }
      if (w.t >= st.change) { st.brg = (st.brg + 90 + s.rand() * 180) % 360; st.change = w.t + 12 + s.rand() * 25; }
      if (G.distNm(s.pos, st.center) > leg.r) st.brg = G.bearing(s.pos, st.center);
      s.pos = G.move(s.pos, st.brg, (leg.kn * dt) / 60);
      s.heading = G.lerpAng(s.heading, st.brg, 0.35); s.sog = leg.kn;
      if (w.t >= leg.until) nextLeg(s);
    } else if (leg.kind === 'trawl') {
      // Traits de chalut parallèles : aller, demi-tour, décalage latéral, retour.
      if (!st.center) { st.center = s.pos.slice(); st.k = 0; st.dir = 1; st.leg = 0; }
      const perp = (leg.dir + 90) % 360;
      const off = ((st.k % 6) - 2.5) * 0.45;
      const a = G.move(st.center, perp, off);
      const target = st.leg % 2 === 0 ? G.move(a, leg.dir, leg.len / 2) : G.move(a, (leg.dir + 180) % 360, leg.len / 2);
      s.sog = leg.kn;
      if (goTo(target, leg.kn)) { st.leg++; st.k++; }
      if (w.t >= leg.until) nextLeg(s);
    } else if (leg.kind === 'hold') {
      s.sog = 0;
      if (!leg.still) s.pos = G.move(s.pos, D.weather.current.brg, (0.15 * dt) / 60);
      if (w.t >= leg.until) nextLeg(s);
    } else if (leg.kind === 'drift') {
      if (leg.distress && !s.distress) { s.distress = true; w.events.push({ t: w.t, text: s.name + ' : panne moteur, l\'embarcation dérive.' }); }
      s.pos = G.move(s.pos, leg.brg + (s.rand() - 0.5) * 20, (leg.kn * dt) / 60);
      s.sog = leg.kn;
      s.heading = G.lerpAng(s.heading, (leg.brg + 40) % 360, 0.05);
      if (w.t >= leg.until) nextLeg(s);
    }
  }

  function stepShip(w, s, dt) {
    s.prevPos = s.exists ? s.pos.slice() : null;
    s.prevHeading = s.heading;
    if (s.route || s.anchored || s.trips || s.loiter || s.trip) {
      stepAnalytic(w, s);
    } else {
      if (!s.exists && w.t >= (s.spawn ?? D.PRE_MIN) && !(s.despawn && w.t >= s.despawn) && !s.gone) s.exists = true;
      if (s.exists && s.despawn && w.t >= s.despawn) { s.exists = false; s.gone = true; }
      if (s.exists) stepLegs(w, s, dt);
    }
    if (!s.prevPos && s.exists) { s.prevPos = s.pos.slice(); s.prevHeading = s.heading; }
    // Balise VMS posée sur une pirogue d'appui
    if (s.ghostPos && w.t >= s.vmsGhost.from) {
      const c = s.vmsGhost.center;
      s.ghostPos = G.move(s.ghostPos, (w.t * 23) % 360, (2 * dt) / 60);
      if (G.distNm(s.ghostPos, c) > 1.5) s.ghostPos = G.move(s.ghostPos, G.bearing(s.ghostPos, c), 0.2);
    }
    // Trace vraie (vérité terrain) toutes les 6 minutes
    if (s.exists && (!s.trail.length || w.t - s.trail[s.trail.length - 1].t >= 6)) {
      s.trail.push({ t: w.t, pos: s.pos.slice() });
      if (s.trail.length > 40) s.trail.shift();
    }
    // Rejet d'hydrocarbures : la nappe naît sur la route du navire
    if (s.discharge && s.exists && w.t >= s.discharge.from && w.t <= s.discharge.to) {
      let sl = w.slicks.find((x) => x.shipId === s.id);
      if (!sl) { sl = { id: 'N-' + (w.slicks.length + 1), shipId: s.id, pts: [] }; w.slicks.push(sl); }
      if (!sl.pts.length || w.t - sl.pts[sl.pts.length - 1].t0 >= 2) sl.pts.push({ pos: s.pos.slice(), t0: w.t });
    }
  }

  function stepSlicks(w, dt) {
    const cur = D.weather.current;
    w.slicks.forEach((sl) => sl.pts.forEach((p) => { p.pos = G.move(p.pos, cur.brg, (cur.kn * dt) / 60); }));
  }
  const slickWidthM = (p, t) => Math.min(650, 60 + (t - p.t0) * 1.8);

  // ---------- Capteurs ----------
  function sensors(w) {
    const t = w.t;
    w.ships.forEach((s) => {
      if (s.signal && !s.signalSent && t >= s.signal.at) {
        s.signalSent = true;
        w.reports.push({ kind: 'signal', t, ...s.signal, _id: s.id });
      }
      if (!s.exists) return;
      // AIS
      if (s.hasAis && s.aisOn && t >= s.aisNext) {
        const coastal = nearAisStation(s.pos);
        const classB = s.aisClass === 'B';
        let interval;
        if (coastal) interval = classB ? 6 : s.sog < 0.5 ? 6 : 2;
        else interval = classB ? 40 + s.rand() * 20 : 14 + s.rand() * 16;
        s.aisNext = t + interval;
        let p = s.pos;
        if (s.spoof && t >= s.spoof.from && t < s.spoof.to) p = G.move(s.pos, s.spoof.brg, s.spoof.nm);
        const id = s.cloneOf || s;
        w.reports.push({
          kind: 'ais', t, name: id.name, imo: id.imo, mmsi: id.mmsi, shipKind: id.kind || s.kind, lengthM: id.lengthM || s.lengthM,
          flag: s.cloneOf ? 'Sénégal' : s.flag, dest: s.dest, aisClass: s.aisClass || 'A', pos: p.slice(), sog: s.sog, cog: s.heading, coastal, _id: s.id,
        });
        s.lastAisTx = t;
      }
      // VMS (transmis à la DPSP, puis à la plateforme par convention)
      if (s.vmsId && s.vmsOn && t - s.lastVmsTx >= 60) {
        s.lastVmsTx = t;
        const p = s.ghostPos && t >= s.vmsGhost.from ? s.ghostPos : s.pos;
        w.reports.push({ kind: 'vms', t, vmsId: s.vmsId, pos: p.slice(), _id: s.id });
      }
    });

    // Passages satellites
    w.pendingSat.forEach((p) => {
      if (p.done || p.t > t) return;
      p.done = true;
      const inFoot = footprint(p);
      const night = isNight(t);
      const dets = [];
      let filtered = 0;
      w.ships.forEach((s) => {
        if (!s.exists || s.docked) return;
        if (!inFoot(s.pos)) return;
        if (G.coastDist(s.pos) < 0.4 && !s.gathering) return; // au port ou au quai
        const small = s.lengthM < 24;
        let pd;
        if (p.sensor === 'optique' && night) pd = 0;
        else if (s.gathering) pd = p.kind === 'COM' ? 0.95 : w.opts.srModel ? 1 : 0.15;
        else if (!small) pd = p.sensor === 'radar' ? (p.kind === 'COM' ? 0.99 : 0.93) : 0.95;
        else if (p.kind === 'COM') pd = w.opts.srModel ? 0.92 : 0.6;
        else if (p.sensor === 'radar') pd = w.opts.srModel ? 0.45 : 0.1;
        else pd = w.opts.srModel ? 0.7 : 0.3;
        const roll = hrand(p.t + p.name, s.id);
        if (s.artisanal && G.coastDist(s.pos) < 12) { if (roll < pd) filtered++; return; }
        if (roll >= pd) return;
        const err = small ? 0.06 : 0.04;
        const est = { pos: G.move(s.pos, w.rand() * 360, w.rand() * err), sizeEst: Math.round(s.lengthM * (0.82 + w.rand() * 0.36)), gathering: s.gathering, _id: s.id };
        if (!small && s.sog > 3) { est.heading = (s.heading + (w.rand() - 0.5) * 24 + 360) % 360; est.speed = Math.max(1, s.sog + (w.rand() - 0.5) * 3); }
        // Une embarcation rapide laisse un sillage visible au radar : cap et vitesse estimés
        else if (small && s.sog > 15 && p.sensor === 'radar') { est.heading = (s.heading + (w.rand() - 0.5) * 16 + 360) % 360; est.speed = Math.max(1, s.sog + (w.rand() - 0.5) * 6); est.wake = true; }
        if (s.gathering) est.count = 14 + Math.floor(w.rand() * 8);
        dets.push(est);
      });
      const slicks = [];
      w.slicks.forEach((sl) => {
        const inside = sl.pts.filter((q) => inFoot(q.pos)).length;
        if (!sl.pts.length || inside / sl.pts.length < 0.6) return;
        if (p.sensor !== 'radar' && hrand(p.t + p.name, sl.id) > 0.5) return;
        const pts = sl.pts.map((q) => q.pos.slice());
        let len = 0;
        for (let i = 1; i < pts.length; i++) len += G.distNm(pts[i - 1], pts[i]);
        slicks.push({ id: sl.id, pts, lengthNm: len, widthM: Math.round(slickWidthM(sl.pts[0], t)), _shipId: sl.shipId });
      });
      const rep = { kind: 'sat', t, pass: { name: p.name, detail: p.detail, sensor: p.sensor, kind: p.kind, swath: p.swath, box: p.box }, dets, slicks, filtered };
      w.reports.push(rep);
      w.satDone.push({ t, pass: rep.pass, dets: dets.map((d) => d.pos), slicks: slicks.length });
    });

    // Capteurs embarqués des moyens (radar, caméra jour/nuit)
    w.assets.forEach((a) => {
      if (['base', 'maintenance', 'prep', 'turnaround'].includes(a.state)) return;
      if (t - a.lastScan < 3) return;
      a.lastScan = t;
      const dets = [];
      w.ships.forEach((s) => {
        if (!s.exists || s.docked) return;
        const d = G.distNm(a.pos, s.pos);
        const small = s.lengthM < 24;
        const range = small ? a.detectSmall : a.detectLarge;
        if (d > range) return;
        if (s.gathering && a.type !== 'drone' && a.type !== 'mpa' && d > 2.5) return;
        const ident = d <= a.identify;
        const det = { pos: G.move(s.pos, w.rand() * 360, 0.02), sog: s.sog, cog: s.heading, sizeEst: s.lengthM, small, identified: ident, gathering: s.gathering, _id: s.id };
        if (ident) {
          det.kind = s.kind;
          det.name = s.nameHidden || s.kind === 'pirogue' || s.kind === 'gofast' ? null : s.name;
          det.imo = s.kind === 'pirogue' || s.kind === 'gofast' || s.nameHidden ? null : s.imo;
          det.distress = s.distress;
          det.persons = s.persons || null;
          det.migrants = !!s.migrants;
        }
        dets.push(det);
      });
      const slickSeen = [];
      if (a.type === 'drone' || a.type === 'mpa') {
        w.slicks.forEach((sl) => { if (sl.pts.some((q) => G.distNm(a.pos, q.pos) <= 3)) slickSeen.push(sl.id); });
      }
      w.reports.push({ kind: 'asset', t, assetId: a.id, assetName: a.short || a.name, assetType: a.type, pos: a.pos.slice(), dets, slickSeen });
    });
  }

  function footprint(p) {
    if (p.box) {
      const c = p.box.c, h = p.box.halfKm / NM_KM / 60;
      const hx = h / Math.cos(G.rad(c[0]));
      return (q) => Math.abs(q[0] - c[0]) <= h && Math.abs(q[1] - c[1]) <= hx;
    }
    const a = p.swath.a, b = p.swath.b, half = p.swath.halfKm / NM_KM;
    return (q) => G.distToLineNm(q, [a, b]) <= half;
  }

  // ---------- Moyens ----------
  function moveAsset(w, a, target, kn, dt) {
    const air = a.type === 'drone' || a.type === 'mpa';
    let wp = target;
    if (!air) {
      if (!a.nav || G.distNm(a.nav.goal, target) > 1.5 || w.t - a.nav.t > 20) {
        a.nav = { goal: target.slice(), pts: G.navPath(w.navMask, a.pos, target), t: w.t };
      } else a.nav.pts[a.nav.pts.length - 1] = target.slice();
      wp = a.nav.pts[0];
    }
    let left = (kn * dt) / 60;
    for (let guard = 0; guard < 6; guard++) {
      const d = G.distNm(a.pos, wp);
      if (d > left) {
        const brg = G.bearing(a.pos, wp);
        a.heading = G.lerpAng(a.heading, brg, air ? 0.5 : 0.35);
        a.pos = G.move(a.pos, brg, left);
        return false;
      }
      a.pos = wp.slice(); left -= d;
      if (air || a.nav.pts.length <= 1) return true;
      a.nav.pts.shift(); wp = a.nav.pts[0];
    }
    return false;
  }

  // Distance à parcourir (milles) : ligne droite pour les aéronefs, route contournant la terre sinon.
  const routeCache = new Map();
  function routeNm(w, a, to) {
    const d = G.distNm(a.pos, to);
    if (a.type === 'drone' || a.type === 'mpa') return d;
    if (d > 60) return d * 1.2; // trajet très long : approximation suffisante pour classer les moyens
    if (G.clearLine(w.navMask, a.pos, to)) return d;
    // Clé grossière (~3 milles) : l'estimation d'un temps d'arrivée n'a pas besoin de plus
    const key = a.pos.map((v) => (Math.round(v * 20) / 20).toFixed(2)).join(',') + '>' + to.map((v) => (Math.round(v * 20) / 20).toFixed(2)).join(',');
    if (!routeCache.has(key)) {
      const pts = G.navPath(w.navMask, a.pos, to);
      let nm = 0, prev = a.pos;
      pts.forEach((p) => { nm += G.distNm(prev, p); prev = p; });
      if (routeCache.size > 400) routeCache.clear();
      routeCache.set(key, nm);
    }
    return routeCache.get(key);
  }

  // Patrouille active à l'instant t (les patrouilleurs patrouillent en permanence,
  // les drones de surface selon des créneaux, la nuit en particulier).
  function patrolRoute(a, t) {
    if (!a.patrol) return null;
    return a.patrol.find((p) => (p.from === undefined || t >= p.from) && t < p.until) || null;
  }

  const enduranceLeft = (a) => a.enduranceH * 60 - a.usedMin;
  const returnMin = (a) => (G.distNm(a.pos, a.base) / a.kn) * 60;

  function stepAsset(w, a, dt) {
    a.prevPos = a.pos.slice();
    a.prevHeading = a.heading;
    const t = w.t;
    if (a.state === 'maintenance') return;
    if (a.state === 'turnaround') { if (t >= a.readyAt) a.state = 'base'; return; }
    if (a.state === 'base') {
      if (!a.task && patrolRoute(a, t)) { a.state = 'patrouille'; a.patrolIdx = 0; a._pr = null; }
      return;
    }
    if (a.state === 'prep') { if (t >= a.readyAt) a.state = 'transit'; return; }
    if (!['patrouille'].includes(a.state) || a.type !== 'opv') a.usedMin += dt;

    if (a.state === 'patrouille') {
      const pr = patrolRoute(a, t);
      if (!pr) { a.state = 'retour'; return; }
      if (pr !== a._pr) { a._pr = pr; a.patrolIdx = 0; }
      if (moveAsset(w, a, pr.route[a.patrolIdx], pr.kn, dt)) a.patrolIdx = (a.patrolIdx + 1) % pr.route.length;
      return;
    }
    if (a.state === 'retour') {
      const pr = patrolRoute(a, t);
      // Retour vers le point de patrouille le plus proche, ou vers la base
      const home = pr ? pr.route.reduce((b, p) => (G.distNm(a.pos, p) < G.distNm(a.pos, b) ? p : b)) : a.base;
      if (moveAsset(w, a, home, a.kn, dt)) {
        if (pr) { a.state = 'patrouille'; a._pr = pr; a.patrolIdx = pr.route.indexOf(home); } else { a.state = a.usedMin > 90 ? 'turnaround' : 'base'; a.readyAt = t + (a.usedMin > 90 ? a.turnMin : 0); a.usedMin = 0; }
        a.task = null;
      }
      return;
    }
    const task = a.task;
    if (!task) { a.state = 'retour'; return; }
    // Réserve d'énergie : retour obligatoire
    if (a.type !== 'opv' && enduranceLeft(a) < returnMin(a) + 20) { task.lowEnergy = true; }

    const target = task.target.kind === 'ship' ? w.shipById.get(task.target.truthId) : null;
    const targetPos = target && target.exists ? target.pos : task.target.kind === 'point' ? task.target.pos : null;
    const range = target ? (target.lengthM < 24 ? a.detectSmall : a.detectLarge) : 99;
    const seen = targetPos && G.distNm(a.pos, targetPos) <= range;

    if (['secours', 'arraisonnement'].includes(a.state)) {
      if (targetPos) moveAsset(w, a, G.move(targetPos, (t * 9) % 360, 0.15), 2, dt);
      return;
    }
    // Veille au large d'une plage : le drone de surface ne s'approche pas du rivage
    if (task.standoff && target && target.gathering) {
      if (G.distNm(a.pos, task.standoff) < 0.3 || moveAsset(w, a, task.standoff, a.kn, dt)) {
        a.state = 'suivi';
        if (!task.arrivedAt) task.arrivedAt = t;
      } else a.state = 'transit';
      return;
    }
    if (seen) {
      task.acquired = true;
      const close = task.purpose === 'rescue' || task.purpose === 'intervention' ? 0.25 : a.identify * 0.75;
      const d = G.distNm(a.pos, targetPos);
      if (d <= close) {
        if (!task.arrivedAt) task.arrivedAt = t;
        a.state = task.purpose === 'suivi' ? 'suivi' : 'surveillance';
        // Tenir la cible : orbite (drone) ou accompagnement (navire)
        const orbit = a.type === 'drone' || a.type === 'mpa' ? G.move(targetPos, (t * 14) % 360, a.identify * 0.45) : G.move(targetPos, ((target ? target.heading : 0) + 120) % 360, 0.35);
        moveAsset(w, a, orbit, Math.max(a.kn * 0.5, (target ? target.sog : 0) + 2), dt);
      } else {
        a.state = 'transit';
        moveAsset(w, a, targetPos, a.kn, dt);
      }
    } else {
      task.acquired = false;
      if (a.state !== 'recherche') {
        a.state = 'transit';
        if (moveAsset(w, a, task.estimate, a.kn, dt)) { a.state = 'recherche'; task.searchStart = t; }
      } else {
        // Recherche en spirale autour de la dernière position connue
        const k = (t - task.searchStart) / 5;
        const p = G.move(task.estimate, (k * 75) % 360, Math.min(12, 0.8 + k * 0.6));
        moveAsset(w, a, p, a.kn, dt);
        if (t - task.searchStart > 75) task.lost = true;
      }
    }
  }

  // ---------- Pas de simulation ----------
  function step(w, dt) {
    w.t += dt;
    w.ships.forEach((s) => stepShip(w, s, dt));
    stepSlicks(w, dt);
    w.assets.forEach((a) => stepAsset(w, a, dt));
    sensors(w);
  }

  function orderSat(w, sensor, center) {
    const night = isNight(w.t);
    const s = night && sensor === 'optique' ? 'radar' : sensor;
    const delay = s === 'radar' ? 50 : 35;
    const p = { t: w.t + delay, sensor: s, kind: 'COM', name: s === 'radar' ? 'Radar commercial' : 'Optique commerciale', detail: 'acquisition commandée par l\'opérateur', box: { c: center.slice(), halfKm: 30 }, ordered: true };
    w.pendingSat.push(p);
    return p;
  }

  window.SIM = { createWorld, step, orderSat, isNight, footprint, slickWidthM, prepRoute, along, nearAisStation, routeNm };
})();
