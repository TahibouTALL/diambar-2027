// Moteur de simulation : mouvement des navires (vérité terrain), capteurs,
// déplacement des moyens. La plateforme (detect.js) ne voit que les rapports des capteurs.
(function () {
  const D = window.DIAMBAR_DATA;
  const GEO = window.DIAMBAR_GEO;

  function createWorld(opts) {
    const rand = G.rng(20271014);
    const ships = D.scenario.concat(D.background(rand)).map((s) => ({
      ...s,
      pos: s.start.slice(),
      heading: 0,
      sog: 0,
      legIdx: 0,
      legState: {},
      aisOn: s.hasAis ? s.aisOn !== false : false,
      vmsOn: !!s.vmsId,
      gathering: !!s.gathering,
      distress: false,
      ghostPos: s.vmsGhost ? s.vmsGhost.center.slice() : null,
      lastAisTx: -999,
      lastVmsTx: -999 + Math.floor(rand() * 60),
      history: [],
      evIdx: 0,
      rand: G.rng(Math.floor(rand() * 1e9)),
    }));
    const assets = D.assets.map((a) => ({
      ...a,
      pos: (a.startAt || a.base).slice(),
      state: a.maintenance ? 'maintenance' : a.patrol ? 'patrouille' : 'base',
      patrolIdx: 0,
      task: null,
      usedMin: 0,
      heading: 0,
      lastScan: -999,
    }));
    return {
      t: 0,
      ships,
      assets,
      rand,
      opts: Object.assign({ srModel: false }, opts),
      pendingSat: D.satPasses.map((p) => ({ ...p })),
      reports: [], // file des rapports capteurs à consommer par la plateforme
      log: [],
    };
  }

  const isNight = (t) => {
    const hm = ((18 * 60 + 30 + t) % 1440);
    return hm >= 19 * 60 + 12 || hm < 7 * 60 + 14;
  };

  function stepShip(w, s, dt) {
    while (s.evIdx < (s.events || []).length && s.events[s.evIdx].at <= w.t) {
      Object.assign(s, s.events[s.evIdx].set);
      s.evIdx++;
    }
    const leg = s.plan[s.legIdx];
    if (!leg) { s.sog = 0; return; }
    const st = s.legState;
    let speed = 0;
    if (leg.kind === 'goto') {
      const d = G.distNm(s.pos, leg.to);
      const brg = G.bearing(s.pos, leg.to);
      const step = (leg.kn * dt) / 60;
      if (d <= step) { s.pos = leg.to.slice(); nextLeg(s); } else { s.pos = G.move(s.pos, brg, step); s.heading = brg; }
      speed = leg.kn;
    } else if (leg.kind === 'loiter') {
      if (!st.center) { st.center = s.pos.slice(); st.brg = s.rand() * 360; st.change = w.t + 15; }
      if (w.t >= st.change) { st.brg = (st.brg + 120 + s.rand() * 120) % 360; st.change = w.t + 12 + s.rand() * 20; }
      if (G.distNm(s.pos, st.center) > leg.r) st.brg = G.bearing(s.pos, st.center);
      s.pos = G.move(s.pos, st.brg, (leg.kn * dt) / 60);
      s.heading = st.brg; speed = leg.kn;
      if (w.t >= leg.until) nextLeg(s);
    } else if (leg.kind === 'hold') {
      const drift = leg.drift !== undefined ? leg.drift : 0.3;
      if (!st.brg) st.brg = 200;
      s.pos = G.move(s.pos, st.brg, (drift * dt) / 60);
      speed = s.gathering ? 0 : drift;
      if (s.gathering) s.pos = s.start.slice();
      if (w.t >= leg.until) nextLeg(s);
    } else if (leg.kind === 'drift') {
      if (leg.distress && !s.distress) { s.distress = true; w.log.push({ t: w.t, truth: true, text: `${s.name} : panne moteur, dérive.` }); }
      s.pos = G.move(s.pos, leg.brg + (s.rand() - 0.5) * 30, (leg.kn * dt) / 60);
      s.heading = leg.brg; speed = leg.kn;
      if (w.t >= leg.until) nextLeg(s);
    }
    s.sog = speed;
    if (s.ghostPos && w.t >= s.vmsGhost.from) {
      s.ghostPos = G.move(s.ghostPos, (w.t * 37) % 360, (2.5 * dt) / 60);
      if (G.distNm(s.ghostPos, s.vmsGhost.center) > 2) s.ghostPos = G.move(s.ghostPos, G.bearing(s.ghostPos, s.vmsGhost.center), 0.2);
    }
    if (!s.history.length || w.t - s.history[s.history.length - 1].t >= 10) {
      s.history.push({ t: w.t, pos: s.pos.slice() });
      if (s.history.length > 90) s.history.shift();
    }
  }

  function nextLeg(s) { s.legIdx++; s.legState = {}; }

  const offshoreNm = (p) => G.coastDist(p);

  // ----- Capteurs -----
  function sensors(w) {
    w.ships.forEach((s) => {
      // AIS : toutes les 4 min près des côtes, 12 min au large (AIS satellite).
      if (s.hasAis && s.aisOn) {
        const interval = offshoreNm(s.pos) > 20 ? 12 : 4;
        if (w.t - s.lastAisTx >= interval) {
          s.lastAisTx = w.t;
          let p = s.pos;
          if (s.spoof && w.t >= s.spoof.from && w.t < s.spoof.to) p = G.move(s.pos, s.spoof.brg, s.spoof.nm);
          w.reports.push({ kind: 'ais', t: w.t, name: s.name, imo: s.imo, pos: p.slice(), sog: s.sog, cog: s.heading, lengthM: s.lengthM, shipType: s.type, _id: s.id });
        }
      }
      // VMS : toutes les 60 min, vers la DPSP (partenariat).
      if (s.vmsId && s.vmsOn && w.t - s.lastVmsTx >= 60) {
        s.lastVmsTx = w.t;
        const p = s.ghostPos && w.t >= s.vmsGhost.from ? s.ghostPos : s.pos;
        w.reports.push({ kind: 'vms', t: w.t, vmsId: s.vmsId, pos: p.slice(), _id: s.id });
      }
    });

    // Passages satellites.
    w.pendingSat.forEach((p) => {
      if (p.done || p.t > w.t) return;
      p.done = true;
      const dets = [];
      w.ships.forEach((s) => {
        const inZee = G.inFeature(s.pos, GEO.zee) || s.gathering;
        if (!inZee) return;
        if (p.area && G.distNm(s.pos, p.area) > 60) return; // emprise d'une acquisition commandée
        if (s.artisanal) return; // pirogues de pêche près des côtes : filtrées par la plateforme (bruit côtier)
        let pd;
        if (s.cls === 'large') pd = p.sensor === 'radar' ? 0.95 : (isNight(w.t) ? 0 : 0.9);
        else pd = p.sensor === 'radar' ? (w.opts.srModel ? 0.55 : 0.12) : (w.opts.srModel ? 0.75 : 0.3);
        if (p.commercial) pd = Math.min(0.98, pd + (s.cls === 'small' ? 0.25 : 0.03));
        if (s.gathering) pd = w.opts.srModel ? 0.9 : 0.15;
        if (w.rand() < pd) {
          const err = s.cls === 'small' ? 0.4 : 0.25;
          dets.push({ pos: G.move(s.pos, w.rand() * 360, w.rand() * err), sizeEst: s.cls === 'large' ? Math.round(s.lengthM * (0.8 + w.rand() * 0.4)) : Math.round(s.lengthM * (0.7 + w.rand() * 0.6)), gathering: s.gathering, _id: s.id });
        }
      });
      w.reports.push({ kind: 'sat', t: w.t, sensor: p.sensor, name: p.name, commercial: !!p.commercial, area: p.area || null, dets });
    });

    // Capteurs embarqués des moyens (radar, caméra optique et thermique).
    w.assets.forEach((a) => {
      if (a.state === 'base' || a.state === 'maintenance') return;
      if (w.t - a.lastScan < 5) return;
      a.lastScan = w.t;
      const dets = [];
      w.ships.forEach((s) => {
        const d = G.distNm(a.pos, s.pos);
        const range = s.cls === 'large' ? a.detectLarge : a.detectSmall;
        if (d <= range && !(s.gathering && a.type !== 'drone')) {
          dets.push({ pos: G.move(s.pos, w.rand() * 360, 0.1), identified: d <= a.identify, name: d <= a.identify ? s.name : null, imo: d <= a.identify ? s.imo : null, sizeEst: s.lengthM, cls: s.cls, distress: s.distress && d <= a.identify, gathering: s.gathering, _id: s.id });
        }
      });
      w.reports.push({ kind: 'asset', t: w.t, assetId: a.id, assetName: a.name, dets });
    });
  }

  // ----- Moyens -----
  function stepAsset(w, a, dt) {
    if (a.state === 'maintenance') return;
    const go = (target, kn) => {
      const d = G.distNm(a.pos, target);
      const step = (kn * dt) / 60;
      if (d <= step) { a.pos = target.slice(); return true; }
      a.heading = G.bearing(a.pos, target);
      a.pos = G.move(a.pos, a.heading, step);
      return false;
    };
    if (a.state !== 'base') a.usedMin += dt;
    if (a.state === 'patrouille' && a.patrol) {
      if (go(a.patrol[a.patrolIdx], 12)) a.patrolIdx = (a.patrolIdx + 1) % a.patrol.length;
    } else if (a.state === 'transit' || a.state === 'surveillance' || a.state === 'recherche') {
      const task = a.task;
      if (!task) { a.state = 'retour'; return; }
      const truth = w.ships.find((s) => s.id === task.truthId);
      // Si la cible réelle est dans la portée des capteurs, le moyen la poursuit.
      const range = truth ? (truth.cls === 'large' ? a.detectLarge : a.detectSmall) : 0;
      if (truth && G.distNm(a.pos, truth.pos) <= range) {
        task.acquired = true;
        if (G.distNm(a.pos, truth.pos) <= a.identify * 0.8) {
          a.state = 'surveillance';
          if (!task.arrivedAt) task.arrivedAt = w.t;
          go(G.move(truth.pos, (w.t * 12) % 360, a.identify * 0.5), a.kn * 0.4);
        } else {
          a.state = 'transit';
          go(truth.pos, a.kn);
        }
      } else {
        task.acquired = false;
        if (a.state !== 'recherche') {
          if (go(task.estimate, a.kn)) { a.state = 'recherche'; task.searchStart = w.t; }
        } else {
          // Recherche en spirale autour de la dernière position connue.
          const k = (w.t - task.searchStart) / 6;
          const p = G.move(task.estimate, (k * 70) % 360, Math.min(10, 0.6 + k * 0.5));
          go(p, a.kn);
          if (w.t - task.searchStart > 70) task.lost = true;
        }
      }
      if (a.usedMin / 60 > a.enduranceH * 0.85) task.lowEnergy = true;
    } else if (a.state === 'retour') {
      const home = a.patrol ? a.patrol[0] : a.base;
      if (go(home, a.kn)) { a.state = a.patrol ? 'patrouille' : 'base'; a.task = null; if (!a.patrol) a.usedMin = 0; }
    }
  }

  function step(w, dt) {
    w.t += dt;
    w.ships.forEach((s) => stepShip(w, s, dt));
    w.assets.forEach((a) => stepAsset(w, a, dt));
    sensors(w);
  }

  function orderSat(w, sensor, area) {
    const delay = sensor === 'radar' ? 50 : 35;
    const p = { t: w.t + delay, sensor, commercial: true, area, name: sensor === 'radar' ? 'Acquisition radar commerciale' : 'Acquisition optique commerciale' };
    w.pendingSat.push(p);
    return p;
  }

  window.SIM = { createWorld, step, orderSat, isNight, offshoreNm };
})();
