// Plateforme DIAMBAR : fusion des rapports capteurs, pistes, règles de détection,
// incidents (alertes) à indices multiples, score de risque, apprentissage par retour de
// vérification, preuves, envoi des moyens, décisions.
(function () {
  const D = window.DIAMBAR_DATA;
  const GEO = window.DIAMBAR_GEO;
  const DAKAR = D.ports[0].pos;
  const FISHING = ['trawler', 'longliner', 'seiner', 'poleline'];
  const MERCHANT = ['container', 'bulk', 'tanker', 'cargo', 'reefer', 'ferry', 'shuttle', 'supply', 'tug'];

  // ---------- Règles ----------
  const RULES = {
    AIS_OFF: { label: 'Transpondeur AIS coupé', base: 50, cat: 'peche', prior: [3, 2] },
    VMS_SILENT: { label: 'Balise VMS silencieuse', base: 55, cat: 'peche', prior: [3, 2] },
    VMS_AIS_GAP: { label: 'Positions VMS et AIS incompatibles', base: 76, cat: 'peche', prior: [4, 1] },
    ZONE_6: { label: 'Pêche industrielle dans la bande des 6 milles', base: 72, cat: 'peche', prior: [4, 1] },
    ZONE_LIC: { label: 'Hors de la zone autorisée par la licence', base: 56, cat: 'peche', prior: [3, 2] },
    AMP: { label: 'Pêche dans une aire marine protégée', base: 74, cat: 'peche', prior: [4, 1] },
    NO_LICENCE: { label: 'Navire de pêche sans licence', base: 72, cat: 'peche', prior: [4, 1] },
    LOITER_OFFSHORE: { label: 'Arrêt prolongé en pleine mer', base: 46, cat: 'peche', prior: [2, 2] },
    TRANSSHIP: { label: 'Transbordement en mer', base: 78, cat: 'peche', prior: [4, 1] },
    PORT_IUU: { label: 'Navire inscrit sur une liste INN', base: 92, cat: 'peche', prior: [5, 1] },
    MMSI_DUP: { label: 'Identité AIS clonée', base: 80, cat: 'peche', prior: [4, 1] },
    DARK_LARGE: { label: 'Navire sans AIS', base: 60, cat: 'peche', prior: [3, 2] },
    SPOOF: { label: 'Position AIS falsifiée', base: 68, cat: 'trafic', prior: [3, 1] },
    GO_FAST: { label: 'Embarcation rapide de nuit', base: 84, cat: 'trafic', prior: [4, 1] },
    GATHER: { label: 'Rassemblement sur une plage de départ', base: 54, cat: 'migration', prior: [2, 2] },
    DARK_SMALL: { label: 'Embarcation non identifiée au large', base: 56, cat: 'migration', prior: [2, 2] },
    DISTRESS: { label: 'Embarcation en détresse', base: 96, cat: 'sauvetage', prior: [6, 1] },
    MISSING: { label: 'Pirogue de pêche portée disparue', base: 88, cat: 'sauvetage', prior: [5, 1] },
    SAFETY_ZONE: { label: 'Intrusion dans la zone de sécurité d\'une plateforme', base: 78, cat: 'surete', prior: [4, 1] },
    CABLE: { label: 'Navire stationnaire sur les câbles sous-marins', base: 70, cat: 'surete', prior: [3, 1] },
    OIL_SLICK: { label: 'Nappe d\'hydrocarbures', base: 80, cat: 'environnement', prior: [4, 1] },
  };

  // ---------- Masques de zones ----------
  let M = null;
  function masks() {
    if (M) return M;
    const coast = { w: -18.2, e: -15.9, s: 12.0, n: 16.4 };
    const sea = { w: -21.2, e: -15.9, s: 10.4, n: 16.6 };
    const anchor = { type: 'Polygon', coordinates: [D.anchorage.poly.map(([la, lo]) => [lo, la])] };
    M = {
      zee: G.rasterize(GEO.zee, sea, 0.01),
      ts12: G.rasterize(GEO.ts12poly, coast, 0.005),
      band6: G.rasterize(GEO.band6, coast, 0.004),
      gambia: G.rasterize(GEO.gambia, sea, 0.02),
      agc: G.rasterize(GEO.agc, sea, 0.02),
      anchorage: G.rasterize(anchor, { w: -17.45, e: -17.25, s: 14.58, n: 14.7 }, 0.002),
    };
    return M;
  }
  const inZee = (p) => G.inMask(masks().zee, p);
  const in12 = (p) => G.inMask(masks().ts12, p);
  const in6 = (p) => G.inMask(masks().band6, p);
  const inAgc = (p) => G.inMask(masks().agc, p);
  const inAnchorage = (p) => G.inMask(masks().anchorage, p);

  const regByImo = Object.fromEntries(D.registry.map((r) => [r.imo, r]));
  const regByVms = Object.fromEntries(D.registry.map((r) => [r.vms, r]));
  const iuuByImo = Object.fromEntries(D.iuuList.map((r) => [r.imo, r]));

  // ---------- État de la plateforme ----------
  function createPlatform(opts) {
    const learn = {};
    Object.entries(RULES).forEach(([k, r]) => { learn[k] = { a: r.prior[0], b: r.prior[1], n: 0, ok: 0 }; });
    return {
      tracks: new Map(), incidents: [], learn, journal: [], streams: {}, clones: {},
      seqInc: 0, seqContact: 0, lastEval: -9999, auto: true, script: false, scriptDone: new Set(),
      stats: { saved: 0, satPasses: 0, reports: 0 }, opts: Object.assign({}, opts),
    };
  }

  const journal = (P, t, type, text, ref) => { P.jseq = (P.jseq || 0) + 1; P.journal.unshift({ t, type, text, ref, n: P.jseq }); if (P.journal.length > 600) P.journal.pop(); };
  const hhmm = (t) => { const d = new Date(D.START + t * 60000); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };

  function track(P, key, init) {
    let tr = P.tracks.get(key);
    if (!tr) {
      tr = Object.assign({ id: key, hist: [], sources: {}, sogHist: [], created: init && init.t }, init);
      P.tracks.set(key, tr);
    }
    return tr;
  }

  function setPos(tr, t, pos, src) {
    if (tr.lastT !== undefined && t < tr.lastT) return;
    tr.lastPos = pos.slice(); tr.lastT = t;
    tr.sources[src] = t;
    const h = tr.hist;
    if (!h.length || t - h[h.length - 1].t >= 4 || src !== h[h.length - 1].src) h.push({ t, pos: pos.slice(), src });
    else { h[h.length - 1].pos = pos.slice(); h[h.length - 1].t = t; }
    while (h.length > 2 && t - h[0].t > 600) h.shift();
  }

  // Position estimée (navigation à l'estime) d'une piste à l'instant t.
  function drPos(tr, t) {
    if (!tr.lastPos) return null;
    const age = t - tr.lastT;
    if (tr.drift) return G.move(tr.lastPos, tr.drift.brg, (tr.drift.kn * Math.max(0, age)) / 60);
    // Un navire en route (plus de 6 nœuds) garde son cap : estime prolongée jusqu'à 4 h
    const maxAge = tr.sog > 6 ? 240 : 40;
    if (tr.sog > 0.5 && tr.cog !== undefined && age > 0) return deadReckon(tr, Math.min(age, maxAge));
    return tr.lastPos;
  }

  // Position à l'estime après « minutes » de route, sans traverser la côte
  function deadReckon(tr, minutes) {
    const nm = (tr.sog * minutes) / 60;
    if (tr.sog > 15 && tr.unknown) {
      if (!tr._land || tr._land.t !== tr.lastT || tr._land.cog !== tr.cog) {
        let p = tr.lastPos, d = 0, hit = null;
        while (d < 90) { p = G.move(p, tr.cog, 0.5); d += 0.5; if (G.coastDist(p) < 0.8) { hit = { pos: p, nm: d }; break; } }
        tr._land = { t: tr.lastT, cog: tr.cog, hit };
      }
      if (tr._land.hit && nm >= tr._land.hit.nm) return tr._land.hit.pos.slice();
    }
    return G.move(tr.lastPos, tr.cog, nm);
  }

  function newContact(P, t, det, src) {
    P.seqContact++;
    const id = 'C-' + String(P.seqContact).padStart(3, '0');
    const small = det.sizeEst < 24 || !!det.small;
    const tr = track(P, id, { label: 'Contact ' + id, contactNo: id, unknown: true, cls: small ? 'small' : 'large', sizeEst: det.sizeEst, t });
    tr.truthId = det._id;
    if (det.heading !== undefined) { tr.cog = det.heading; tr.sog = det.speed; }
    setPos(tr, t, det.pos, src);
    return tr;
  }

  function correlate(P, det, t, opts) {
    let best = null; let bestD = 1e9;
    const small = det.sizeEst < 24 || !!det.small;
    P.tracks.forEach((tr) => {
      if (!tr.lastPos || tr.closedTrack || tr.slick) return;
      const age = t - tr.lastT;
      if (age > (tr.missing ? 720 : tr.unknown ? 180 : 300)) return;
      // Une piste suivie en ce moment par un autre numéro radar n'est pas récupérée
      if (opts && opts.radarId && tr.assetSeen && t - tr.assetSeen < 12 && tr.truthId !== opts.radarId) return;
      const est = drPos(tr, t);
      const gate = tr.missing ? Math.min(2 + 0.5 * (age / 60), 9) : tr.unknown ? Math.min(1.5 + Math.max(tr.sog || 0, 10) * (age / 60), 9) : Math.min(1.5 + (tr.sog || 0) * (age / 60) * 0.6, 6);
      const d = G.distNm(est, det.pos);
      // Le radar d'un moyen mesure la vitesse : une pirogue lente n'est pas le go-fast suivi
      if (det.sog !== undefined && tr.sog !== undefined && age < 45 && Math.abs(det.sog - tr.sog) > 12) return;
      const ambiguous = det.sizeEst >= 17 && det.sizeEst <= 32; // la taille estimée au radar reste imprécise
      if (tr.cls && (tr.cls === 'small') !== small && !ambiguous && !(opts && opts.anySize)) return;
      if (d < gate && d < bestD) { best = tr; bestD = d; }
    });
    return best;
  }

  // ---------- Ingestion ----------
  function ingest(P, w, r) {
    P.stats.reports++;
    if (r.kind === 'ais') ingestAis(P, w, r);
    else if (r.kind === 'vms') ingestVms(P, w, r);
    else if (r.kind === 'sat') ingestSat(P, w, r);
    else if (r.kind === 'asset') ingestAsset(P, w, r);
    else if (r.kind === 'signal') ingestSignal(P, w, r);
  }

  // Signalement d'une embarcation disparue : point de départ de la recherche
  function ingestSignal(P, w, r) {
    const drift = { brg: 205, kn: 0.8 }; // courant portant au SSO + dérive due au vent de NNE
    const cands = [...P.tracks.values()]
      .filter((x) => x.unknown && x.cls === 'small' && !x.gather && !x.closedTrack && x.lastPos && r.t - x.lastT < 720 && G.distNm(x.lastPos, r.area) < 15)
      .sort((a, b) => G.distNm(a.lastPos, r.area) - G.distNm(b.lastPos, r.area));
    let tr = cands[0];
    const f = [{ txt: `Signalement : ${r.source}`, pts: 0 }, { txt: r.text, pts: 0 }];
    if (tr) {
      f.push({ txt: `Contact sans identité repéré à ${hhmm(tr.lastT)} (${Object.keys(tr.sources).join(', ')}), à ${G.fmtNum(G.distNm(tr.lastPos, r.area), 0)} milles de la zone déclarée`, pts: 6 });
    } else {
      const hours = Math.max(0, (r.t - (r.since + 240)) / 60);
      tr = track(P, 'signal:' + r._id, { label: 'Pirogue portée disparue', unknown: true, cls: 'small', sizeEst: 14, t: r.t });
      tr.truthId = r._id;
      setPos(tr, r.t, G.move(r.area, drift.brg, drift.kn * hours), 'Signalement');
      f.push({ txt: 'Aucun contact radar ou satellite dans la zone : position estimée par le calcul de dérive', pts: 0 });
    }
    tr.label = 'Pirogue de pêche disparue';
    tr.drift = drift; tr.missing = r.t; tr.persons = r.persons;
    f.push({ txt: `Dérive estimée : ${G.fmtNum(drift.kn, 1)} nœud vers le sud-sud-ouest (courant et vent de ${D.weather.windDir})`, pts: 0 });
    journal(P, r.t, 'info', `Signalement reçu (${r.source}) : ${r.text}`);
    raise(P, w, 'MISSING', tr, f, { report: { source: r.source, text: r.text, t: r.t } });
  }

  function ingestAis(P, w, r) {
    const key = 'imo:' + r.imo;
    let tr = P.tracks.get(key);
    const cloneKey = P.clones[r.imo];
    if (cloneKey && tr) {
      const c = P.tracks.get(cloneKey);
      if (c && G.distNm(drPos(c, r.t), r.pos) < G.distNm(drPos(tr, r.t), r.pos)) tr = c;
    }
    if (!tr) {
      tr = track(P, key, { label: r.name, name: r.name, imo: r.imo, mmsi: r.mmsi, flag: r.flag, kind: r.shipKind, lengthM: r.lengthM, cls: r.lengthM >= 24 ? 'large' : 'small', dest: r.dest, aisClass: r.aisClass, t: r.t });
      // Un contact radar ou satellite sans identité qui correspond à ce nouvel AIS est fusionné
      P.tracks.forEach((c) => {
        if (!c.unknown || c.gather || c.clone || c.slick || c.closedTrack || !c.lastPos || r.t - c.lastT > 40) return;
        if (G.distNm(drPos(c, r.t), r.pos) > 1.5) return;
        c.closedTrack = true;
        P.incidents.forEach((inc) => {
          if (inc.trackId === c.id && !inc.closed) {
            inc.closed = true; inc.status = 'identifiée'; inc.decision = `Contact identifié par son AIS : ${r.name}`;
            inc.timeline.push({ t: r.t, kind: 'decision', txt: inc.decision });
            journal(P, r.t, 'info', `${inc.id} : ${c.label} identifié par son AIS (${r.name}), alerte levée.`, inc.id);
          }
        });
      });
    }
    tr.truthId = r._id;
    const last = tr.lastAis;
    const jumpNow = last && G.distNm(last.pos, r.pos) > 8 && G.distNm(last.pos, r.pos) / Math.max(0.05, (r.t - last.t) / 60) > 40;
    // Analyse du flux d'une même identité : saut, falsification, clonage
    if (!cloneKey) {
      checkStream(P, w, r, tr);
      const ck = P.clones[r.imo];
      if (ck) {
        // Le clonage vient d'être établi : ce message appartient peut-être au second émetteur
        const c = P.tracks.get(ck);
        if (c && G.distNm(c.lastPos, r.pos) < G.distNm(tr.lastPos, r.pos)) {
          c.aisCount = (c.aisCount || 0) + 1; c.lastAis = { t: r.t, pos: r.pos, sog: r.sog, cog: r.cog, coastal: r.coastal };
          c.sog = r.sog; c.cog = r.cog; setPos(c, r.t, r.pos, 'AIS');
          return;
        }
      } else if (jumpNow && !tr.spoofRaised) {
        tr.pendingJump = { t: r.t, pos: r.pos };
        return; // saut inexpliqué : la piste reste en place en attendant le message suivant
      }
    }
    tr.aisCount = (tr.aisCount || 0) + 1;
    tr.lastAis = { t: r.t, pos: r.pos, sog: r.sog, cog: r.cog, coastal: r.coastal };
    tr.sog = r.sog; tr.cog = r.cog; tr.dest = r.dest;
    tr.sogHist.push({ t: r.t, sog: r.sog });
    while (tr.sogHist.length > 60) tr.sogHist.shift();
    setPos(tr, r.t, r.pos, 'AIS');
  }

  function checkStream(P, w, r, tr) {
    const st = (P.streams[r.imo] = P.streams[r.imo] || []);
    st.push({ t: r.t, pos: r.pos, _id: r._id });
    if (st.length > 6) st.shift();
    const n = st.length;
    if (n < 3) return;
    const v = (a, b) => (b.t > a.t ? G.distNm(a.pos, b.pos) / ((b.t - a.t) / 60) : 999);
    const jump = (a, b) => G.distNm(a.pos, b.pos) > 8 && v(a, b) > 40;
    const [p1, p2, p3] = st.slice(-3);
    // Alternance A, B, A : deux émetteurs pour une seule identité
    if (jump(p1, p2) && jump(p2, p3) && G.distNm(p1.pos, p3.pos) < 25) {
      splitClone(P, w, r, tr, p2, p1);
      return;
    }
    // Saut suivi d'une route cohérente : position falsifiée
    if (jump(p1, p2) && !jump(p2, p3) && G.distNm(p2.pos, p3.pos) < 15 && !tr.spoofRaised) {
      if (tr.lastVms && w.t - tr.lastVms.t < 90 && G.distNm(tr.lastVms.pos, p1.pos) < 30 && G.distNm(tr.lastVms.pos, p3.pos) > 30) {
        splitClone(P, w, r, tr, p3, p1);
        return;
      }
      tr.spoofRaised = true;
      tr.credible = { t: p1.t, pos: p1.pos, sog: tr.sog || 10, cog: tr.cog || 0 };
      const dist = G.distNm(p1.pos, p2.pos);
      raise(P, w, 'SPOOF', tr, [
        { txt: `Saut de ${G.fmtNum(dist, 0)} milles en ${Math.round(p2.t - p1.t)} min, puis route cohérente à la nouvelle position`, pts: 0 },
        { txt: 'Vitesse implicite impossible pour ce navire', pts: 6 },
      ]);
    }
    // Retour à la position réelle après une falsification
    if (tr.spoofRaised && !tr.spoofEnd && n >= 2 && jump(st[n - 2], st[n - 1])) {
      tr.spoofEnd = r.t;
      journal(P, r.t, 'indice', `${tr.label} : la position AIS revient brusquement de ${G.fmtNum(G.distNm(st[n - 2].pos, st[n - 1].pos), 0)} milles. La séquence précédente était falsifiée.`);
    }
  }

  function splitClone(P, w, r, tr, odd, ref) {
    if (P.clones[r.imo]) return;
    // Le vrai navire est celui que confirme le VMS (ou la position la plus ancienne)
    let genuine = ref.pos, clonePt = odd;
    if (tr.lastVms && w.t - tr.lastVms.t < 120) {
      const dRef = G.distNm(tr.lastVms.pos, ref.pos), dOdd = G.distNm(tr.lastVms.pos, odd.pos);
      if (dOdd < dRef) { genuine = odd.pos; clonePt = ref; }
    }
    const key = 'clone:' + r.imo;
    const c = track(P, key, {
      label: 'Identité clonée (' + tr.name + ')', name: tr.name, cloneOf: tr.name, imo: null, kind: tr.kind, lengthM: tr.lengthM, cls: 'large',
      unknown: true, clone: true, t: r.t,
    });
    c.truthId = clonePt._id;
    c.sog = 9; c.cog = 0;
    setPos(c, clonePt.t, clonePt.pos, 'AIS');
    P.clones[r.imo] = key;
    // Un contact radar ou satellite sans identité au même endroit est le même navire
    P.tracks.forEach((u) => {
      if (!u.unknown || u === c || u.gather || u.clone || u.slick || u.closedTrack || !u.lastPos || w.t - u.lastT > 90) return;
      if (G.distNm(drPos(u, w.t), clonePt.pos) > 4) return;
      u.closedTrack = true;
      P.incidents.forEach((inc) => {
        if (inc.trackId !== u.id || inc.closed) return;
        inc.trackId = key; inc.label = c.label;
        inc.timeline.push({ t: w.t, kind: 'detect', txt: `${u.label} rattaché à l'identité clonée de ${tr.name}` });
      });
    });
    // Nettoie l'historique de la piste d'origine
    tr.hist = tr.hist.filter((h) => G.distNm(h.pos, genuine) < 60);
    if (G.distNm(tr.lastPos, genuine) > 30) { tr.lastPos = genuine.slice(); }
    tr.spoofRaised = false;
    // Une éventuelle alerte de falsification sur la piste d'origine est reclassée
    P.incidents.forEach((inc) => {
      if (inc.trackId === tr.id && !inc.closed && inc.indicators.every((i) => i.rule === 'SPOOF')) {
        inc.closed = true; inc.status = 'reclassée'; inc.decision = 'Reclassée en identité clonée';
        w.assets.forEach((a) => { if (a.task && a.task.incidentId === inc.id) { a.task = null; a.state = 'retour'; } });
        journal(P, w.t, 'info', `${inc.id} reclassée : il ne s'agit pas d'une falsification mais d'une identité clonée.`, inc.id);
      }
    });
    const dist = G.distNm(genuine, clonePt.pos);
    const vmsOk = tr.lastVms && w.t - tr.lastVms.t < 120;
    raise(P, w, 'MMSI_DUP', c, [
      { txt: `Deux émetteurs annoncent ${tr.name} à ${G.fmtNum(dist, 0)} milles l'un de l'autre`, pts: 0 },
      { txt: vmsOk ? `La balise VMS confirme que le vrai ${tr.name} est au ${genuine[0] > clonePt.pos[0] ? 'nord' : 'sud'}` : 'Aucune balise VMS pour départager les deux positions', pts: vmsOk ? 6 : 0 },
    ], { cloneOf: tr.name });
  }

  function ingestVms(P, w, r) {
    const reg = regByVms[r.vmsId];
    if (!reg) return;
    const tr = track(P, 'imo:' + reg.imo, { label: reg.name, name: reg.name, imo: reg.imo, mmsi: reg.mmsi, flag: reg.flag, kind: reg.kind, lengthM: reg.lengthM, cls: 'large', t: r.t });
    if (tr.lastVms && (!tr.lastAis || r.t - tr.lastAis.t > 30) && r.t > tr.lastVms.t) {
      tr.sog = G.distNm(tr.lastVms.pos, r.pos) / ((r.t - tr.lastVms.t) / 60);
      tr.cog = G.bearing(tr.lastVms.pos, r.pos);
    }
    tr.vmsPrev = tr.lastVms;
    tr.lastVms = { t: r.t, pos: r.pos };
    tr.sources.VMS = r.t;
    if (!tr.lastAis || r.t - tr.lastAis.t > 30) setPos(tr, r.t, r.pos, 'VMS');
    if (!tr.truthId) tr.truthId = r._id;
  }

  function nearestBeach(p) {
    return D.beaches.reduce((b, x) => (G.distNm(x.pos, p) < G.distNm(b.pos, p) ? x : b));
  }

  function ingestSat(P, w, r) {
    P.stats.satPasses++;
    let matched = 0, fresh = 0, gathers = 0, coastal = 0;
    const chipShips = [];
    r.dets.forEach((det) => {
      if (det.gathering) {
        gathers++;
        const beach = nearestBeach(det.pos);
        const tr = track(P, 'gather:' + beach.name, { label: 'Rassemblement de pirogues', unknown: true, cls: 'small', gather: true, beach: beach.name, t: r.t });
        tr.truthId = det._id; tr.gatherSeen = r.t; tr.count = det.count;
        setPos(tr, r.t, det.pos, r.pass.kind === 'COM' ? 'Satellite commercial' : r.pass.name);
        tr.lastSat = { t: r.t, pass: r.pass, pos: det.pos, gathering: true, count: det.count };
        return;
      }
      const small = det.sizeEst < 24;
      if (small && G.coastDist(det.pos) < 12) { coastal++; return; }
      const src = r.pass.kind === 'COM' ? 'Satellite commercial' : r.pass.name;
      let tr = correlate(P, det, r.t);
      if (tr) { matched++; } else { fresh++; tr = newContact(P, r.t, det, src); }
      if (tr.unknown) { tr.sizeEst = det.sizeEst; if (det.heading !== undefined) { tr.cog = det.heading; tr.sog = det.speed; } }
      if (det.wake && det.speed > 25) { tr.fastSeen = r.t; tr.wakeSeen = r.t; }
      tr.truthId = tr.truthId || det._id;
      setPos(tr, r.t, det.pos, src);
      tr.lastSat = { t: r.t, pass: r.pass, pos: det.pos, sizeEst: det.sizeEst, heading: det.heading, wake: det.wake };
      chipShips.push(det);
    });
    r.slicks.forEach((sl) => ingestSlick(P, w, r, sl));
    const total = r.dets.length + r.filtered;
    journal(P, r.t, 'sat', `${r.pass.name} (${r.pass.detail}) : ${total} détections, ${matched} associées à des navires suivis, ${fresh} contact${fresh > 1 ? 's' : ''} sans identité${gathers ? ', 1 rassemblement sur une plage' : ''}${r.slicks.length ? `, ${r.slicks.length} nappe suspecte` : ''}. ${r.filtered + coastal} petites embarcations côtières filtrées.`);
  }

  // Nappe : recherche du pollueur en remontant les traces AIS (dérive du courant corrigée)
  function ingestSlick(P, w, r, sl) {
    const key = 'slick:' + sl.id;
    const center = sl.pts[Math.floor(sl.pts.length / 2)];
    const tr = track(P, key, { label: 'Nappe ' + sl.id, slick: true, unknown: true, cls: 'large', t: r.t });
    tr.slickPts = sl.pts; tr.lengthNm = sl.lengthNm; tr.widthM = sl.widthM;
    tr.truthId = sl._shipId;
    setPos(tr, r.t, center, r.pass.name);
    const cur = D.weather.current;
    // Dérive du courant en degrés par minute (approximation locale, suffisante à cette échelle)
    const kLat = (cur.kn / 60 / 60) * Math.cos(G.rad(cur.brg));
    const kLon = ((cur.kn / 60 / 60) * Math.sin(G.rad(cur.brg))) / Math.cos(G.rad(center[0]));
    const box = sl.pts.reduce((b, p) => [Math.min(b[0], p[0]), Math.max(b[1], p[0]), Math.min(b[2], p[1]), Math.max(b[3], p[1])], [90, -90, 180, -180]);
    let best = null;
    P.tracks.forEach((c) => {
      if (!c.lastAis || c.slick) return;
      const hs = c.hist.filter((h) => {
        if (h.src !== 'AIS' || r.t - h.t > 600 || h.t > r.t) return false;
        const la = h.pos[0] + kLat * (r.t - h.t), lo = h.pos[1] + kLon * (r.t - h.t);
        return la > box[0] - 0.05 && la < box[1] + 0.05 && lo > box[2] - 0.05 && lo < box[3] + 0.05;
      });
      if (!hs.length) return;
      let hits = 0, when = null;
      sl.pts.forEach((sp) => {
        const ok = hs.some((h) => {
          const drifted = [h.pos[0] + kLat * (r.t - h.t), h.pos[1] + kLon * (r.t - h.t)];
          if (G.distNm(drifted, sp) < 1.2) { when = when === null ? h.t : Math.min(when, h.t); return true; }
          return false;
        });
        if (ok) hits++;
      });
      const score = hits / sl.pts.length;
      if (score > 0.5 && (!best || score > best.score)) best = { tr: c, score, when };
    });
    const factors = [
      { txt: `Tache sombre de ${G.fmtNum(sl.lengthNm * 1.852, 0)} km sur ${sl.widthM} m détectée au radar`, pts: 0 },
      { txt: 'Forme allongée et rectiligne, typique d\'un rejet en route', pts: 4 },
    ];
    if (best) factors.push({ txt: `Pollueur présumé : ${best.tr.label}, passé sur ce tracé à ${hhmm(best.when)} (concordance ${Math.round(best.score * 100)} %)`, pts: 6 });
    raise(P, w, 'OIL_SLICK', tr, factors, best ? { suspect: { trackId: best.tr.id, label: best.tr.label, at: best.when, match: best.score } } : {});
    const inc = P.incidents.find((i) => i.trackId === key);
    if (inc && !inc.satChip) inc.satChip = { t: r.t, pass: r.pass, center, slick: sl.pts, sensor: 'radar' };
  }

  function ingestAsset(P, w, r) {
    r.dets.forEach((det) => {
      let tr = null;
      if (det.gathering) {
        const beach = nearestBeach(det.pos);
        tr = track(P, 'gather:' + beach.name, { label: 'Rassemblement de pirogues', unknown: true, cls: 'small', gather: true, beach: beach.name, t: r.t });
        tr.gatherSeen = r.t;
      } else {
        // Le pistage radar du moyen conserve le numéro de piste d'un balayage à l'autre
        tr = [...P.tracks.values()].find((x) => x.truthId === det._id && !x.closedTrack && !x.slick && r.t - x.lastT < (x.visual || x.identifiedBy || x.missing ? 720 : 240)) || null;
        if (tr && tr.gather && !det.gathering) { tr.gather = false; tr.departed = r.t; tr.label = 'Pirogue partie de ' + tr.beach.split(' (')[0]; }
        if (!tr) tr = correlate(P, det, r.t, { anySize: det.identified, radarId: det._id });
        if (det.identified && det.imo) {
          const byImo = P.tracks.get('imo:' + det.imo);
          if (tr && tr.clone) {
            tr.trueName = det.name; tr.trueImo = det.imo;
            tr.label = `${det.name} (identité AIS de ${tr.cloneOf})`;
          } else if (tr && tr.unknown && !tr.gather && !tr.slick) {
            if (byImo && byImo !== tr) { tr.closedTrack = true; tr = byImo; } else {
              tr.unknown = false; tr.imo = det.imo; tr.name = det.name || tr.name; tr.kind = det.kind; tr.lengthM = det.sizeEst;
              tr.label = det.name ? `${det.name}` : `${kindLabel(det.kind)} (nom masqué)`;
              tr.identifiedBy = r.assetName;
            }
          } else if (!tr) {
            tr = byImo || track(P, 'imo:' + det.imo, { label: det.name || kindLabel(det.kind), name: det.name, imo: det.imo, kind: det.kind, lengthM: det.sizeEst, cls: det.small ? 'small' : 'large', identifiedBy: r.assetName, t: r.t });
          }
        } else if (det.identified && tr && tr.unknown && !tr.gather && !tr.slick && !tr.visual) {
          tr.visual = true; tr.kind = det.kind;
          tr.label = tr.missing ? 'Pirogue de pêche disparue' : det.migrants ? 'Pirogue de migrants' : det.kind === 'pirogue' ? 'Pirogue' : det.kind === 'gofast' ? 'Go-fast' : det.kind === 'reefer' ? 'Frigorifique (nom masqué)' : kindLabel(det.kind);
          tr.identifiedBy = r.assetName;
        }
        if (!tr) {
          // Une pirogue suivie qui quitte la plage devient la piste du départ
          const g = [...P.tracks.values()].find((x) => x.gather && x.truthId === det._id && r.t - x.gatherSeen < 600);
          if (g) { tr = g; g.gather = false; g.departed = r.t; g.label = 'Pirogue partie de ' + g.beach.split(' (')[0]; }
          else if (det.small && (det.sog === undefined || det.sog < 12) && G.coastDist(det.pos) < 8 && !det.distress && !det.migrants) {
            P.coastalSeen = (P.coastalSeen || 0) + 1; // pêche artisanale côtière : écho noté, sans piste ni alerte
            return;
          }
          else tr = newContact(P, r.t, det, r.assetName);
        }
        if (tr.gather && !det.gathering && det._id === tr.truthId) { tr.gather = false; tr.departed = r.t; tr.label = 'Pirogue partie de ' + tr.beach.split(' (')[0]; }
      }
      // Vitesse estimée par les relèvements successifs (pistes sans AIS)
      if (tr.lastPos && r.t - tr.lastT >= 3 && (!tr.lastAis || r.t - tr.lastAis.t > 20)) {
        const v = G.distNm(tr.lastPos, det.pos) / ((r.t - tr.lastT) / 60);
        if (v < 60) { tr.sog = tr.sog === undefined ? v : tr.sog * 0.4 + v * 0.6; tr.cog = G.bearing(tr.lastPos, det.pos); }
        if (tr.sog > 25) tr.fastSeen = r.t;
      } else if (!tr.lastAis && det.sog !== undefined && tr.sog === undefined) { tr.sog = det.sog; tr.cog = det.cog; }
      if (!tr.lastAis || r.t - tr.lastAis.t > 20) { tr.sogHist.push({ t: r.t, sog: tr.sog || 0 }); while (tr.sogHist.length > 60) tr.sogHist.shift(); }
      tr.truthId = det._id;
      setPos(tr, r.t, det.pos, r.assetName);
      if (det.distress) tr.distress = r.t;
      if (det.persons && det.migrants) tr.persons = det.persons;
      tr.assetSeen = r.t;
    });
    (r.slickSeen || []).forEach((id) => { const tr = P.tracks.get('slick:' + id); if (tr) tr.sources[r.assetName] = r.t; });
  }

  const kindLabel = (k) => ({
    container: 'Porte-conteneurs', bulk: 'Vraquier', tanker: 'Pétrolier', cargo: 'Cargo', reefer: 'Frigorifique', trawler: 'Chalutier', longliner: 'Palangrier',
    seiner: 'Senneur', poleline: 'Canneur', pirogue: 'Pirogue', yacht: 'Yacht', gofast: 'Go-fast', ferry: 'Ferry', shuttle: 'Chaloupe', supply: 'Navire de servitude', tug: 'Remorqueur',
  }[k] || 'Navire');

  // ---------- Incidents ----------
  function reliability(P, rule) { const L = P.learn[rule]; return L.a / (L.a + L.b); }
  function indicatorScore(P, rule, factors) {
    const raw = RULES[rule].base + factors.reduce((s, f) => s + f.pts, 0);
    return Math.max(5, Math.min(100, Math.round(raw * (0.75 + 0.5 * reliability(P, rule)))));
  }
  function refreshScore(inc) {
    const sc = inc.indicators.map((i) => i.score).sort((a, b) => b - a);
    inc.score = Math.min(100, sc[0] + 4 * (sc.length - 1));
    const top = inc.indicators.slice().sort((a, b) => RULES[b.rule].base - RULES[a.rule].base)[0];
    inc.rule = top.rule;
    inc.title = RULES[top.rule].label;
    inc.cat = RULES[top.rule].cat;
    const has = (r) => inc.indicators.some((i) => i.rule === r);
    if (inc.cat === 'sauvetage' && !has('MISSING') && (has('GATHER') || has('DARK_SMALL'))) inc.cat = 'migration';
  }

  function raise(P, w, rule, tr, factors, extra) {
    let inc = P.incidents.find((i) => i.trackId === tr.id && !i.closed);
    // Une alerte déjà traitée et close n'est pas relevée une seconde fois pour le même motif
    if (!inc && rule !== 'DISTRESS' && P.incidents.some((i) => i.trackId === tr.id && i.closed && i.indicators.some((x) => x.rule === rule))) return null;
    if (!inc && rule !== 'DISTRESS' && tr.handledUntil && w.t < tr.handledUntil) return null;
    const score = indicatorScore(P, rule, factors);
    const ship = w.shipById.get(tr.truthId);
    const truthRules = ship ? ship.violations || [] : [];
    if (!inc) {
      P.seqInc++;
      inc = {
        id: 'A-' + String(P.seqInc).padStart(3, '0'), trackId: tr.id, label: tr.label, created: w.t, updated: w.t,
        pos: (tr.lastPos || [0, 0]).slice(), indicators: [], status: 'nouvelle', timeline: [], truthId: tr.truthId,
      };
      P.incidents.push(inc);
      if (tr.lastSat && w.t - tr.lastSat.t < 40) inc.satChip = { t: tr.lastSat.t, pass: tr.lastSat.pass, center: tr.lastSat.pos, sensor: tr.lastSat.pass.sensor, gathering: tr.lastSat.gathering, count: tr.lastSat.count, sizeEst: tr.lastSat.sizeEst, heading: tr.lastSat.heading, wake: tr.lastSat.wake };
      Object.assign(inc, extra || {});
      inc.indicators.push({ rule, t: w.t, factors, score, truth: truthRules.includes(rule) });
      refreshScore(inc);
      inc.timeline.push({ t: w.t, kind: 'detect', txt: `Détection : ${RULES[rule].label.toLowerCase()}` });
      journal(P, w.t, 'alert', `${inc.id} ${RULES[rule].label} : ${tr.label} (score ${inc.score}).`, inc.id);
      inc.isNew = true;
      return inc;
    }
    const ind = inc.indicators.find((i) => i.rule === rule);
    if (ind) {
      ind.factors = factors; ind.score = score;
    } else {
      inc.indicators.push({ rule, t: w.t, factors, score, truth: truthRules.includes(rule) });
      inc.timeline.push({ t: w.t, kind: 'detect', txt: `Nouvel indice : ${RULES[rule].label.toLowerCase()}` });
      journal(P, w.t, 'indice', `${inc.id} : nouvel indice, ${RULES[rule].label.toLowerCase()} (${tr.label}).`, inc.id);
      inc.escalated = w.t;
    }
    Object.assign(inc, extra || {});
    if (!inc.satChip && tr.lastSat && w.t - tr.lastSat.t < 40) inc.satChip = { t: tr.lastSat.t, pass: tr.lastSat.pass, center: tr.lastSat.pos, sensor: tr.lastSat.pass.sensor, gathering: tr.lastSat.gathering, count: tr.lastSat.count, sizeEst: tr.lastSat.sizeEst, heading: tr.lastSat.heading, wake: tr.lastSat.wake };
    inc.updated = w.t; inc.label = tr.label;
    inc.pos = (tr.lastPos || inc.pos).slice();
    refreshScore(inc);
    return inc;
  }

  // ---------- Règles ----------
  const fishingCapable = (tr) => FISHING.includes(tr.kind) || (tr.unknown && tr.cls === 'large' && !tr.slick);
  function slowFor(tr, t, minutes, max) {
    const h = tr.sogHist.filter((x) => t - x.t <= minutes);
    return h.length >= 3 && h[0].t <= t - minutes * 0.8 && h.every((x) => x.sog < max);
  }
  function fishingFor(tr, t, minutes) {
    const h = tr.sogHist.filter((x) => t - x.t <= minutes);
    return h.length >= 3 && h[0].t <= t - minutes * 0.7 && h.every((x) => x.sog > 1.2 && x.sog < 6);
  }

  function evaluate(P, w) {
    if (w.t - P.lastEval < 5) return;
    P.lastEval = w.t;
    const t = w.t;
    const night = SIM.isNight(t);
    P.tracks.forEach((tr) => {
      if (!tr.lastPos || tr.closedTrack || tr.slick) return;
      const age = t - tr.lastT;
      if (age > 360) return;
      const pos = tr.lastPos;
      const reg = tr.imo ? regByImo[tr.imo] : null;
      const recent = age <= 30;

      // Transpondeur AIS coupé
      if (tr.lastAis && tr.aisCount >= 3 && !tr.clone) {
        const gap = t - tr.lastAis.t;
        const limit = tr.lastAis.coastal ? 16 : 80;
        if (gap > limit && inZee(tr.lastAis.pos) && G.coastDist(tr.lastAis.pos) > 1) {
          const f = [{ txt: `Dernier message AIS il y a ${Math.round(gap)} min (${tr.lastAis.coastal ? 'zone couverte par les stations côtières' : 'AIS satellite'})`, pts: 0 }];
          if (FISHING.includes(tr.kind)) f.push({ txt: 'Navire de pêche', pts: 10 });
          if (G.coastDist(tr.lastAis.pos) < 25) f.push({ txt: 'Coupure à moins de 25 milles de la côte', pts: 12 });
          if (MERCHANT.includes(tr.kind)) f.push({ txt: 'Navire marchand sur une route commerciale', pts: -14 });
          if (!tr.lastAis.coastal) f.push({ txt: 'Hors de portée des stations côtières : trous de couverture possibles', pts: -6 });
          if (night) f.push({ txt: 'De nuit', pts: 5 });
          if (tr.spoofRaised) f.push({ txt: 'Position falsifiée juste avant la coupure', pts: 15 });
          raise(P, w, 'AIS_OFF', tr, f);
        }
      }
      // Balise VMS silencieuse
      if (reg && tr.lastVms && t - tr.lastVms.t > 125) {
        const f = [{ txt: `Aucune position VMS depuis ${Math.round(t - tr.lastVms.t)} min (une toutes les 60 min attendue)`, pts: 0 }];
        if (!tr.lastAis || t - tr.lastAis.t > 30) f.push({ txt: 'AIS également muet', pts: 12 });
        raise(P, w, 'VMS_SILENT', tr, f);
      }
      // Positions VMS et AIS incompatibles
      if (tr.lastAis && tr.lastVms && t - tr.lastAis.t < 30 && t - tr.lastVms.t < 65 && !tr.clone) {
        const ref = tr.hist.filter((h) => h.src === 'AIS').reduce((b, h) => (!b || Math.abs(h.t - tr.lastVms.t) < Math.abs(b.t - tr.lastVms.t) ? h : b), null);
        if (ref && Math.abs(ref.t - tr.lastVms.t) <= 15) {
          const d = G.distNm(ref.pos, tr.lastVms.pos);
          if (d > Math.max(5, 2 + 14 * (Math.abs(ref.t - tr.lastVms.t) / 60))) {
            raise(P, w, 'VMS_AIS_GAP', tr, [
              { txt: `La balise VMS place le navire à ${G.fmtNum(d, 0)} milles de sa position AIS`, pts: 0 },
              { txt: 'Balise déplacée sur une autre embarcation ou AIS falsifié', pts: 6 },
            ]);
          }
        }
      }
      const capable = fishingCapable(tr) && tr.cls === 'large';
      const slowish = tr.sog === undefined || tr.sog < 6;
      // Bande des 6 milles
      if (recent && capable && slowish && in6(pos) && G.distNm(pos, DAKAR) > 6) {
        const f = [{ txt: 'Position dans la bande réservée à la pêche artisanale', pts: 0 }];
        if (tr.sog > 1.5 && tr.sog < 5) f.push({ txt: `Vitesse de pêche (${G.fmtNum(tr.sog, 1)} nœuds)`, pts: 8 });
        if (!tr.lastAis || t - tr.lastAis.t > 30) f.push({ txt: 'Sans AIS actif', pts: 8 });
        if (night) f.push({ txt: 'De nuit', pts: 4 });
        raise(P, w, 'ZONE_6', tr, f);
      }
      // Hors zone de licence
      if (recent && reg && slowish && in12(pos) && G.distNm(pos, DAKAR) > 6 && !inAnchorage(pos)) {
        raise(P, w, 'ZONE_LIC', tr, [{ txt: `Licence « ${reg.licence} » valable au-delà de 12 milles`, pts: 0 }]);
      }
      // Aire marine protégée
      if (recent && capable && slowish) {
        const amp = D.amps.find((a) => G.distNm(pos, a.pos) <= a.rNm);
        if (amp) raise(P, w, 'AMP', tr, [{ txt: amp.name, pts: 0 }, { txt: 'Toute pêche industrielle y est interdite', pts: 4 }]);
      }
      // Pêche sans licence
      if (recent && FISHING.includes(tr.kind) && tr.imo && !reg && !tr.clone && inZee(pos) && !inAgc(pos) && fishingFor(tr, t, 25)) {
        const f = [{ txt: `${tr.label} absent du registre des navires autorisés`, pts: 0 }, { txt: `Comportement de pêche (${G.fmtNum(tr.sog || 0, 1)} nœuds en traits réguliers)`, pts: 4 }];
        if (tr.flag) f.push({ txt: `Pavillon : ${tr.flag}`, pts: 0 });
        const entry = tr.hist.find((h, i) => i > 0 && inZee(h.pos) && !inZee(tr.hist[i - 1].pos));
        if (entry) f.push({ txt: `Entré dans les eaux sénégalaises à ${hhmm(entry.t)}`, pts: 4 });
        raise(P, w, 'NO_LICENCE', tr, f);
      }
      // Arrêt prolongé en pleine mer
      if (tr.lastAis && t - tr.lastAis.t < 45 && !MERCHANT.includes(tr.kind) && slowFor(tr, t, 60, 1) && G.coastDist(pos) > 40) {
        const f = [{ txt: 'Vitesse inférieure à 1 nœud depuis plus d\'une heure', pts: 0 }, { txt: `À ${G.fmtNum(G.coastDist(pos), 0)} milles de la côte`, pts: 4 }];
        if (night) f.push({ txt: 'De nuit', pts: 4 });
        const dark = [...P.tracks.values()].find((x) => x.unknown && x.cls === 'large' && !x.slick && !x.gather && x.lastPos && t - x.lastT < 480 && G.distNm(x.lastPos, pos) < 35);
        if (dark) f.push({ txt: `Navire sans AIS repéré à ${G.fmtNum(G.distNm(dark.lastPos, pos), 0)} milles à ${hhmm(dark.lastT)} (${dark.label})`, pts: 14 });
        raise(P, w, 'LOITER_OFFSHORE', tr, f);
      }
      // Navire sans AIS (contact satellite ou radar)
      if (tr.unknown && !tr.gather && !tr.clone && tr.cls === 'large' && age < 60 && inZee(pos)) {
        const srcs = Object.keys(tr.sources).join(', ');
        const f = [{ txt: `Détecté par ${srcs}, longueur estimée ${tr.sizeEst || '?'} m`, pts: 0 }, { txt: 'Aucun AIS ni VMS correspondant', pts: 0 }];
        if (in12(pos)) f.push({ txt: 'Dans les 12 milles', pts: 10 });
        raise(P, w, 'DARK_LARGE', tr, f);
      }
      // Embarcation non identifiée au large
      if (tr.unknown && !tr.gather && tr.cls === 'small' && age < 60 && inZee(pos) && (!in12(pos) || tr.departed)) {
        const f = [{ txt: `Embarcation de ${tr.sizeEst || '?'} m détectée par ${Object.keys(tr.sources).join(', ')}`, pts: 0 }];
        if (!in12(pos)) f.push({ txt: 'Au-delà des 12 milles, loin des zones de pêche artisanale', pts: 4 });
        if (night) f.push({ txt: 'De nuit, période habituelle des départs', pts: 10 });
        else f.push({ txt: 'De jour : pêche artisanale probable', pts: -8 });
        if (tr.departed) f.push({ txt: `Partie de la plage de ${tr.beach} à ${hhmm(tr.departed)}`, pts: 12 });
        if (tr.persons) f.push({ txt: `Environ ${tr.persons} personnes à bord`, pts: 8 });
        raise(P, w, 'DARK_SMALL', tr, f);
      }
      // Navire inscrit sur une liste INN en approche du port
      if (tr.imo && iuuByImo[tr.imo] && G.distNm(pos, DAKAR) < 30) {
        const toward = tr.cog !== undefined && Math.abs(G.angDiff(tr.cog, G.bearing(pos, DAKAR))) < 50;
        if (toward || G.distNm(pos, DAKAR) < 6) {
          const hit = iuuByImo[tr.imo];
          raise(P, w, 'PORT_IUU', tr, [
            { txt: `Numéro OMI ${tr.imo} identique à celui de ${hit.name}`, pts: 0 },
            { txt: `${hit.source}, inscrit depuis ${hit.since}`, pts: 0 },
            { txt: `Nom déclaré dans l'AIS : ${tr.label}. Destination annoncée : ${tr.dest || 'Dakar'}`, pts: 0 },
          ]);
        }
      }
      // Détresse
      if (tr.distress && t - tr.distress < 180) {
        raise(P, w, 'DISTRESS', tr, [
          { txt: 'Embarcation immobilisée et surchargée, observée par un drone', pts: 0 },
          ...(tr.persons ? [{ txt: `Environ ${tr.persons} personnes à bord`, pts: 0 }] : []),
          ...(night ? [{ txt: 'De nuit, mer de force 3', pts: 0 }] : []),
        ], { rescue: true });
      }
      // Rassemblement sur une plage de départ
      if (tr.gather && tr.gatherSeen && t - tr.gatherSeen < 300) {
        const f = [{ txt: `Plage de ${tr.beach}`, pts: 0 }];
        if (tr.count) f.push({ txt: `Environ ${tr.count} pirogues et de nombreux groupes de personnes`, pts: 6 });
        f.push({ txt: `Nuit sans lune après ${hhmm(D.moon.set)} : conditions habituelles d'un départ`, pts: 4 });
        raise(P, w, 'GATHER', tr, f);
      }
      // Go-fast de nuit
      if (tr.unknown && tr.cls === 'small' && tr.fastSeen && t - tr.fastSeen < 40 && night && tr.sog > 22) {
        const land = landingEstimate(tr, t);
        const f = [{ txt: `${G.fmtNum(tr.sog, 0)} nœuds sans AIS, cap ${Math.round(tr.cog)}°`, pts: 0 }];
        if (tr.wakeSeen && t - tr.wakeSeen < 40) f.push({ txt: 'Sillage visible sur l\'image radar', pts: 4 });
        if (land) f.push({ txt: `Atterrissage estimé : ${land.place}, vers ${hhmm(land.t)}`, pts: 6 });
        raise(P, w, 'GO_FAST', tr, f, land ? { landing: land } : {});
      }
      // Zone de sécurité d'une installation
      D.installations.forEach((ins) => {
        const dm = G.distNm(pos, ins.pos) * 1852;
        if (recent && dm < ins.safetyM && !D.authorizedSupply.includes(tr.imo) && !MERCHANT.includes(tr.kind)) {
          raise(P, w, 'SAFETY_ZONE', tr, [
            { txt: `À ${Math.round(dm / 10) * 10} m du ${ins.name} (zone de sécurité de ${ins.safetyM} m)`, pts: 0 },
            { txt: `${tr.label} n'est pas un navire de servitude autorisé`, pts: 4 },
            ...(night ? [{ txt: 'De nuit', pts: 4 }] : []),
          ], { installation: ins.name });
        }
      });
      // Câbles sous-marins
      if (recent && slowFor(tr, t, 25, 1.5) && !inAnchorage(pos) && G.coastDist(pos) > 1) {
        const near = D.cables.map((c) => ({ c, d: G.distToLineNm(pos, c.line) })).sort((a, b) => a.d - b.d)[0];
        if (near.d < 0.8) {
          const f = [{ txt: `À ${Math.round(near.d * 1852)} m du tracé « ${near.c.name} »`, pts: 0 }, { txt: 'Hors de la zone de mouillage autorisée', pts: 6 }];
          if (tr.sog > 0.2) f.push({ txt: `Dérive de ${G.fmtNum(tr.sog, 1)} nœud : ancre possiblement traînante`, pts: 8 });
          raise(P, w, 'CABLE', tr, f);
        }
      }
    });

    // Transbordement : deux navires à l'arrêt côte à côte au large
    const still = [...P.tracks.values()].filter((x) => x.lastPos && !x.slick && !x.closedTrack && t - x.lastT < 30 && x.cls === 'large' && (x.sog === undefined || x.sog < 1.5) && G.coastDist(x.lastPos) > 20 && !inAnchorage(x.lastPos));
    for (let i = 0; i < still.length; i++) {
      for (let j = i + 1; j < still.length; j++) {
        const d = G.distNm(still[i].lastPos, still[j].lastPos);
        if (d < 0.6) {
          const a = regByImo[still[i].imo] ? still[i] : regByImo[still[j].imo] ? still[j] : (still[i].unknown ? still[j] : still[i]);
          const b = a === still[i] ? still[j] : still[i];
          raise(P, w, 'TRANSSHIP', a, [
            { txt: `Amarré à ${b.label}, à ${Math.round(d * 1852)} m`, pts: 0 },
            { txt: 'Les deux navires sont à l\'arrêt, loin des côtes', pts: 4 },
            ...(b.unknown ? [{ txt: 'L\'un des deux n\'émet aucun AIS', pts: 8 }] : []),
          ], { partner: b.label });
        }
      }
    }
    P.incidents.forEach((inc) => { if (!inc.closed) { const tr = P.tracks.get(inc.trackId); if (tr && tr.lastPos) { inc.pos = tr.lastPos.slice(); inc.label = tr.label; } } });
    if (P.auto) autoDispatch(P, w);
    if (P.script) runScript(P, w);
  }

  function landingEstimate(tr, t) {
    let p = tr.lastPos;
    for (let k = 1; k <= 120; k++) {
      p = G.move(p, tr.cog, 0.5);
      if (G.coastDist(p) < 0.8) {
        const place = D.places.filter((x) => x.rank >= 3).reduce((b, x) => (G.distNm(x.pos, p) < G.distNm(b.pos, p) ? x : b));
        return { pos: p, t: Math.round(t + ((k * 0.5) / tr.sog) * 60), place: place.name };
      }
    }
    return null;
  }

  // ---------- Moyens ----------
  const etaMin = (a, pos, w) => {
    const prep = a.state === 'base' ? a.readyMin : a.state === 'turnaround' && w ? Math.max(0, a.readyAt - w.t) : 0;
    const nm = w ? SIM.routeNm(w, a, pos) : G.distNm(a.pos, pos);
    return Math.round(prep + (nm / a.kn) * 60);
  };
  function available(w, types) {
    return w.assets.filter((a) => types.includes(a.type) && !a.task && (['base', 'patrouille'].includes(a.state) || (a.state === 'retour' && a.usedMin < a.enduranceH * 60 * 0.4)));
  }
  function targetOf(P, inc) {
    const tr = P.tracks.get(inc.trackId);
    if (tr && tr.slick) return { kind: 'point', pos: tr.lastPos.slice() };
    return { kind: 'ship', truthId: inc.truthId || (tr && tr.truthId) };
  }
  function estimateOf(P, inc, t) {
    const tr = P.tracks.get(inc.trackId);
    if (!tr) return inc.pos.slice();
    if (tr.drift) return G.move(tr.lastPos, tr.drift.brg, (tr.drift.kn * Math.max(0, t - tr.lastT)) / 60);
    if (tr.credible && tr.spoofRaised) {
      return G.move(tr.credible.pos, tr.credible.cog || 0, ((tr.credible.sog || 0) * Math.min(90, t - tr.credible.t)) / 60);
    }
    // Contact sans AIS : on extrapole le cap et la vitesse estimés (sillage radar) pour orienter la recherche
    if (tr.unknown && tr.sog > 2 && tr.cog !== undefined && t - tr.lastT > 40) {
      return deadReckon(tr, Math.min(180, t - tr.lastT));
    }
    return drPos(tr, t) || inc.pos.slice();
  }

  function assign(P, w, incId, assetId, purpose) {
    const inc = P.incidents.find((i) => i.id === incId);
    const a = w.assets.find((x) => x.id === assetId);
    if (!inc || !a || a.task || a.state === 'maintenance' || a.state === 'turnaround') return null;
    a.task = { incidentId: incId, purpose, target: targetOf(P, inc), estimate: estimateOf(P, inc, w.t), start: w.t };
    const gtr = P.tracks.get(inc.trackId);
    if (gtr && gtr.gather) { const b = D.beaches.find((x) => x.name === gtr.beach); if (b) a.task.standoff = b.watch; }
    a.missions++;
    if (a.state === 'base') { a.state = 'prep'; a.readyAt = w.t + a.readyMin; } else a.state = 'transit';
    const eta = w.t + etaMin(a, a.task.estimate, w) + (a.state === 'prep' ? 0 : 0);
    if (purpose === 'verification') { inc.assigned = a.id; inc.assignedAt = w.t; if (!inc.verdict) inc.status = 'en vérification'; }
    if (purpose === 'suivi') { inc.followedBy = a.id; if (!inc.verdict) inc.status = 'en suivi'; }
    if (purpose === 'rescue') { inc.rescueBy = a.id; inc.status = 'secours en route'; }
    if (purpose === 'intervention') { inc.intervention = a.id; inc.status = 'intervention en cours'; }
    const label = { verification: 'vérification', suivi: 'suivi continu', rescue: 'sauvetage', intervention: 'intervention' }[purpose];
    inc.timeline.push({ t: w.t, kind: 'asset', txt: `${a.short || a.name} engagé (${label}), arrivée estimée ${hhmm(eta)}` });
    journal(P, w.t, 'asset', `${a.short || a.name} envoyé sur ${inc.id} (${label}), arrivée estimée ${hhmm(eta)}.`, inc.id);
    return a;
  }

  function recall(P, w, assetId) {
    const a = w.assets.find((x) => x.id === assetId);
    if (!a || !a.task) return;
    const inc = P.incidents.find((i) => i.id === a.task.incidentId);
    if (inc) {
      if (inc.assigned === a.id && !inc.verdict) { inc.assigned = null; inc.status = 'nouvelle'; }
      if (inc.followedBy === a.id) inc.followedBy = null;
      inc.timeline.push({ t: w.t, kind: 'asset', txt: `${a.short || a.name} rappelé` });
    }
    a.task = null; a.state = 'retour';
  }

  // Envoi automatique des drones de vérification (jamais d'intervention ni de sauvetage)
  function autoDispatch(P, w) {
    P.incidents.forEach((inc) => {
      if (inc.closed || inc.verdict || inc.assigned || inc.followedBy || inc.rescueBy) return;
      if (inc.indicators.some((i) => i.rule === 'DISTRESS')) return;
      if (inc.rule === 'PORT_IUU') return; // preuve documentaire : registre et liste INN
      const gather = inc.rule === 'GATHER';
      if (!gather && inc.score < 60) return;
      if (inc.waitUntil && w.t < inc.waitUntil) return;
      const pos = estimateOf(P, inc, w.t);
      const fast = inc.indicators.some((i) => i.rule === 'GO_FAST');
      const types = gather ? ['usv'] : fast ? ['drone'] : ['usv', 'drone'];
      const cands = available(w, types).map((a) => ({ a, eta: etaMin(a, pos, w) }))
        .filter((c) => c.a.type !== 'drone' || (c.eta * 2 + 60) / 60 < c.a.enduranceH)
        .sort((x, y) => x.eta - y.eta);
      // Pendant la première heure, on préfère attendre qu'un moyen proche se libère
      if (cands.length && cands[0].eta > 120 && w.t - inc.created < 60 && inc.cat !== 'sauvetage') {
        if (!inc.waitNoted) { inc.waitNoted = true; journal(P, w.t, 'info', `${inc.id} : aucun moyen à moins de 2 h, attente d'un drone qui se libère.`, inc.id); }
        inc.waitUntil = w.t + 10;
        return;
      }
      if (!cands.length || cands[0].eta > 240) {
        if (!inc.noAsset) { inc.noAsset = true; journal(P, w.t, 'info', `${inc.id} : aucun drone disponible à moins de 4 h, alerte en attente.`, inc.id); }
        inc.waitUntil = w.t + 20;
        return;
      }
      inc.noAsset = false;
      inc.autoAssigned = true;
      // Les drones aériens sont réservés aux urgences et aux cibles lointaines :
      // un drone de surface DIAMBAR qui arrive en moins de 2 h est préféré.
      let pick = cands[0];
      const usv = cands.find((c) => c.a.type === 'usv' && c.eta <= 120);
      if (usv && !['trafic', 'sauvetage'].includes(inc.cat)) pick = usv;
      assign(P, w, inc.id, pick.a.id, gather ? 'suivi' : 'verification');
    });
  }

  // ---------- Preuves et suites ----------
  function makeEvidence(P, w, inc, a, ship) {
    const tr = P.tracks.get(inc.trackId);
    const slick = tr && tr.slick;
    const positive = slick ? true : !!ship && (ship.violations || []).some((v) => inc.indicators.some((i) => i.rule === v));
    const night = SIM.isNight(w.t);
    const ev = {
      id: 'PV-' + inc.id.slice(2) + '-' + hhmm(w.t).replace(':', ''),
      time: D.START + w.t * 60000, t: w.t, pos: (slick ? tr.lastPos : ship.pos).slice(), heading: slick ? 0 : Math.round(ship.heading), sog: slick ? 0 : ship.sog,
      asset: a.short || a.name, assetType: a.type, sensor: night ? 'IR' : 'EO', night,
      identity: slick ? `Nappe ${tr.id.split(':')[1]}` : ship.kind === 'pirogue' || ship.kind === 'gofast' ? (ship.persons ? `${kindLabel(ship.kind)}, environ ${ship.persons} personnes` : kindLabel(ship.kind)) : ship.nameHidden ? `${kindLabel(ship.kind)} (nom masqué)` : `${ship.name} (OMI ${ship.imo})`,
      shipKind: slick ? 'slick' : ship.kind, lengthM: slick ? 0 : ship.lengthM, persons: slick ? null : ship.persons || null, migrants: !!(ship && ship.migrants),
      name: slick ? null : ship.name, colors: ship && ship.colors,
      observations: positive
        ? (slick ? (w.shipById.get(tr.truthId) || {}).observations
          : ship.migrants ? (ship.gathering ? ship.obsGather : ship.distress ? ship.observations : ship.obsTransit)
            : ship.obsLanded && ship.sog < 1 && G.coastDist(ship.pos) < 1 ? ship.obsLanded : ship.observations)
        : (ship.benign || `${ship.name} : aucune infraction constatée.`),
      verdict: positive ? 'confirmée' : 'infondée', partner: inc.partner || null,
    };
    if (slick) { ev.slickLen = tr.lengthNm; ev.slickW = tr.widthM; }
    // Scène vue par la caméra, pour l'image de la preuve
    const landed = ship && ship.obsLanded && ship.sog < 1 && G.coastDist(ship.pos) < 1;
    ev.scene = slick ? 'slick' : ship.gathering ? 'gather' : inc.indicators.some((i) => i.rule === 'TRANSSHIP') && ship.sog < 1.5 ? 'transship'
      : ship.distress ? 'distress' : landed ? 'landed' : ship.plan && ship.plan[ship.legIdx] && ship.plan[ship.legIdx].kind === 'drift' && !ship.migrants ? 'anchored' : 'vessel';
    ev.trawling = !slick && ['trawler'].includes(ship.kind) && ship.sog > 1.5 && ship.sog < 5;
    ev.fishing = !slick && ['seiner', 'longliner', 'poleline'].includes(ship.kind) && ship.sog < 4;
    ev.partnerKind = ev.scene === 'transship' ? 'reefer' : null;
    ev.dist = slick ? 0.6 : G.distNm(a.pos, ship.pos);
    ev.alt = a.type === 'drone' ? 1200 : a.type === 'mpa' ? 900 : 4;
    ev.hash = Array.from(ev.id + ev.time).reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381).toString(16).toUpperCase().padStart(8, '0');
    return { ev, positive };
  }

  function update(P, w) {
    w.assets.forEach((a) => {
      const task = a.task;
      if (!task) return;
      const inc = P.incidents.find((i) => i.id === task.incidentId);
      if (!inc) { a.task = null; a.state = 'retour'; return; }
      const ship = task.target.kind === 'ship' ? w.shipById.get(task.target.truthId) : null;
      // Mise à jour de la position visée à partir de la piste
      const tr = P.tracks.get(inc.trackId);
      if (tr && tr.lastPos) {
        const est = estimateOf(P, inc, w.t);
        if (a.state === 'recherche' && G.distNm(est, task.estimate) > 3) { a.state = 'transit'; task.lost = false; }
        task.estimate = est;
      }
      // Cible trop rapide pour le moyen engagé : il est relevé, un drone aérien prend le relais
      if (!task.arrivedAt && task.purpose === 'verification' && tr && tr.sog > a.kn + 4 && inc.indicators.some((i) => i.rule === 'GO_FAST')) {
        journal(P, w.t, 'asset', `${a.short || a.name} relevé : la cible file à ${G.fmtNum(tr.sog, 0)} nœuds, trop vite pour lui.`, inc.id);
        inc.timeline.push({ t: w.t, kind: 'asset', txt: `${a.short || a.name} relevé, cible trop rapide` });
        if (inc.assigned === a.id) { inc.assigned = null; if (!inc.verdict) inc.status = 'nouvelle'; }
        a.task = null; a.state = 'retour';
        return;
      }
      if (task.lowEnergy && !task.lowNoted) {
        task.lowNoted = true;
        journal(P, w.t, 'asset', `${a.short || a.name} : réserve d'énergie basse, retour à la base.`, inc.id);
        if (inc.followedBy === a.id) inc.followedBy = null;
        if (inc.assigned === a.id && !inc.verdict) { inc.assigned = null; inc.status = 'nouvelle'; inc.waitUntil = w.t + 5; }
        a.task = null; a.state = 'retour';
        return;
      }
      if (task.lost && !task.done) {
        task.done = true;
        if (task.purpose === 'verification') { inc.status = 'cible non retrouvée'; inc.verdict = 'non retrouvée'; inc.verifiedAt = w.t; }
        inc.timeline.push({ t: w.t, kind: 'asset', txt: `${a.short || a.name} n'a pas retrouvé la cible après 75 min de recherche` });
        journal(P, w.t, 'preuve', `${inc.id} : ${a.short || a.name} n'a pas retrouvé la cible.`, inc.id);
        a.task = null; a.state = 'retour';
        return;
      }
      // Arrivée sur zone
      if (task.arrivedAt && !task.handled) {
        task.handled = true;
        if (task.purpose === 'verification' || (task.purpose === 'suivi' && !inc.evidence)) {
          if (!ship && task.target.kind === 'ship') { a.task = null; a.state = 'retour'; return; }
          const { ev, positive } = makeEvidence(P, w, inc, a, ship);
          if (!inc.evidence || task.purpose === 'verification') {
            inc.evidence = ev;
            inc.verdict = positive ? 'confirmée' : 'infondée';
            inc.verifiedAt = w.t; inc.delay = w.t - inc.created;
            if (task.purpose === 'verification') inc.status = positive ? 'confirmée' : 'infondée';
            inc.indicators.forEach((i) => {
              const L = P.learn[i.rule];
              L.n++;
              if (positive && (i.truth || inc.trackId.startsWith('slick:'))) { L.a++; L.ok++; } else if (!positive) L.b++;
            });
            inc.timeline.push({ t: w.t, kind: 'proof', txt: `Preuve ${ev.id} : alerte ${inc.verdict} par ${a.short || a.name}` });
            journal(P, w.t, 'preuve', `${inc.id} ${inc.verdict} par ${a.short || a.name} : ${ev.observations}`, inc.id);
            if (positive && ship && ship.linkedTo) {
              const other = P.incidents.find((x) => x.truthId === ship.linkedTo);
              if (other) {
                inc.linked = other.id;
                other.timeline.push({ t: w.t, kind: 'proof', txt: `Pièce complémentaire ${ev.id} (${inc.id}) : ${ship.linkNote}` });
                journal(P, w.t, 'preuve', `${other.id} : ${ship.linkNote}`, other.id);
              }
            }
          }
          if (task.purpose === 'verification') {
            // Suspect confirmé en mouvement (trafic, migration) : le moyen reste au contact
            if (positive && ['trafic', 'migration', 'sauvetage'].includes(inc.cat) && a.type !== 'mpa') {
              task.purpose = 'suivi'; inc.followedBy = a.id;
              inc.timeline.push({ t: w.t, kind: 'asset', txt: `${a.short || a.name} reste au contact et suit la cible` });
            } else task.releaseAt = w.t + 12;
          }
        } else if (task.purpose === 'intervention') {
          a.state = 'arraisonnement'; task.busyUntil = w.t + 25; inc.status = 'arraisonnement en cours';
          inc.timeline.push({ t: w.t, kind: 'asset', txt: `${a.short || a.name} sur zone : arraisonnement en cours` });
        } else if (task.purpose === 'rescue') {
          a.state = 'secours'; task.busyUntil = w.t + Math.round(12 + Math.min(24, ((ship && ship.persons) || 20) / 6)); inc.status = 'sauvetage en cours';
          inc.timeline.push({ t: w.t, kind: 'asset', txt: `${a.short || a.name} sur zone : transbordement des personnes` });
        }
      }
      // Fin d'arraisonnement ou de sauvetage
      if (task.busyUntil && w.t >= task.busyUntil && !task.finished) {
        task.finished = true;
        if (task.purpose === 'intervention') {
          const positive = ship && (ship.violations || []).length > 0;
          inc.outcome = positive
            ? (inc.rule === 'PORT_IUU' ? 'Navire escorté hors des eaux sous juridiction, accès au port refusé.' : 'Arraisonnement : infraction constatée, navire dérouté vers Dakar, procès-verbal établi.')
            : 'Contrôle effectué : aucune infraction constatée.';
          inc.status = positive ? 'arraisonnée' : 'contrôlée';
          inc.timeline.push({ t: w.t, kind: 'decision', txt: inc.outcome });
          journal(P, w.t, 'decision', `${inc.id} : ${a.short || a.name}. ${inc.outcome}`, inc.id);
          if (ship && positive) {
            ship.plan = [{ kind: 'goto', to: [14.6, -17.45], kn: 9 }, { kind: 'goto', to: [14.632, -17.355], kn: 7 }, { kind: 'hold', until: 99999, still: true }];
            ship.legIdx = 0; ship.legState = {}; ship.events = []; ship.evIdx = 0; ship.diverted = true;
            if (ship.hasAis) ship.aisOn = true;
            if (ship.vmsId) ship.vmsOn = true;
          }
        } else if (task.purpose === 'rescue') {
          const n = (ship && ship.persons) || 0;
          const by = a.type === 'opv' ? `du patrouilleur ${a.short}` : a.type === 'vedette' ? `de la vedette ${a.short}` : `de ${a.short || a.name}`;
          inc.outcome = inc.indicators.some((i) => i.rule === 'MISSING')
            ? `${n} pêcheurs recueillis à bord ${by}, pirogue prise en remorque vers Kayar.`
            : `${n} personnes recueillies à bord ${by}, débarquement prévu au port de Dakar.`;
          inc.status = 'secourue'; inc.rescued = w.t; inc.closed = true; inc.closedAt = w.t;
          P.stats.saved += n;
          if (ship) { ship.exists = false; ship.gone = true; ship.rescued = true; }
          inc.timeline.push({ t: w.t, kind: 'decision', txt: inc.outcome });
          journal(P, w.t, 'decision', `${inc.id} : ${inc.outcome}`, inc.id);
          w.assets.forEach((o) => { if (o !== a && o.task && o.task.incidentId === inc.id) { o.task = null; o.state = 'retour'; } });
          if (tr) tr.closedTrack = true;
        }
        task.releaseAt = w.t + 2;
      }
      if (task.releaseAt && w.t >= task.releaseAt) { a.task = null; a.state = 'retour'; }
      // Suivi : cible disparue
      if (task.purpose === 'suivi' && ship && !ship.exists) { a.task = null; a.state = 'retour'; if (inc.followedBy === a.id) inc.followedBy = null; }
    });
  }

  // ---------- Décisions ----------
  const DECISIONS = {
    dpsp: { label: 'Transmettre à la DPSP', done: 'Dossier transmis à la DPSP (procès-verbal)', closes: true },
    marine: { label: 'Transmettre à la Marine nationale', done: 'Dossier transmis à la Marine nationale', closes: true },
    gendarmerie: { label: 'Prévenir la Gendarmerie', done: 'Gendarmerie prévenue', closes: false },
    hassmar: { label: 'Notifier la HASSMAR', done: 'HASSMAR notifiée, inspection demandée au prochain port d\'escale', closes: true },
    port: { label: 'Refuser l\'accès au port', done: 'Accès au port de Dakar refusé (accord sur les mesures du ressort de l\'État du port)', closes: true },
    operateur: { label: 'Alerter l\'exploitant de la plateforme', done: 'Exploitant de la plateforme et Marine nationale alertés', closes: true },
    classer: { label: 'Classer l\'alerte', done: 'Alerte classée par l\'opérateur', closes: true },
  };
  function decide(P, w, incId, key) {
    const inc = P.incidents.find((i) => i.id === incId);
    if (!inc || inc.closed) return;
    const d = DECISIONS[key];
    inc.decisions = (inc.decisions || []).concat({ key, t: w.t, label: d.done });
    inc.decision = d.done;
    inc.decidedAt = w.t;
    if (key === 'classer' && !inc.verdict) P.learn[inc.rule].b += 0.5;
    if (d.closes) {
      inc.closed = true; inc.closedAt = w.t; inc.status = key === 'classer' ? 'classée' : 'transmise';
      const tr = P.tracks.get(inc.trackId);
      if (tr) tr.handledUntil = w.t + 360;
      if (key === 'port') {
        const ship = w.shipById.get(inc.truthId);
        if (ship && ship.exists) { ship.plan = [{ kind: 'path', pts: [[14.56, -17.9], [14.2, -18.6], [13.4, -19.9]], kn: 10 }]; ship.legIdx = 0; ship.legState = {}; }
      }
      w.assets.forEach((a) => { if (a.task && a.task.incidentId === inc.id && ['verification', 'suivi'].includes(a.task.purpose)) { a.task = null; a.state = 'retour'; } });
    }
    else if (!inc.verdict && inc.status === 'nouvelle') inc.status = 'transmise';
    inc.timeline.push({ t: w.t, kind: 'decision', txt: d.done });
    journal(P, w.t, 'decision', `${inc.id} : ${d.done}.`, inc.id);
  }

  // ---------- Scénario de référence (opérateur) ----------
  // Utilisé pour l'avance rapide et la démo guidée : les décisions humaines du centre.
  const SCRIPT = [
    { id: 'nordic-dec', truth: 'nordic', when: (i) => i.verdict === 'confirmée', after: 10, act: (P, w, i) => decide(P, w, i.id, 'hassmar') },
    { id: 'falcon-int', truth: 'falcon', when: (i) => i.verdict === 'confirmée', after: 5, act: (P, w, i) => assign(P, w, i.id, 'OPV-NIANI', 'intervention') },
    { id: 'falcon-dec', truth: 'falcon', when: (i) => i.status === 'arraisonnée', after: 15, act: (P, w, i) => decide(P, w, i.id, 'dpsp') },
    { id: 'lompoul-dec', truth: 'lompoul', when: (i) => i.verdict === 'confirmée', after: 15, act: (P, w, i) => decide(P, w, i.id, 'dpsp') },
    { id: 'rover-dec', truth: 'rover', when: (i) => i.verdict === 'confirmée', after: 20, act: (P, w, i) => decide(P, w, i.id, 'marine') },
    { id: 'baltic-dec', truth: 'baltic', when: (i) => i.verdict === 'confirmée', after: 10, act: (P, w, i) => decide(P, w, i.id, 'marine') },
    { id: 'migr-gend', truth: 'migrants', when: (i) => i.rule === 'GATHER' && !!i.followedBy, after: 5, act: (P, w, i) => decide(P, w, i.id, 'gendarmerie') },
    { id: 'migr-rescue', truth: 'migrants', when: (i) => i.indicators.some((x) => x.rule === 'DISTRESS'), after: 3, act: (P, w, i) => { const c = available(w, ['opv', 'usv']).filter((a) => a.id !== i.followedBy).map((a) => ({ a, eta: etaMin(a, i.pos, w) })).sort((x, y) => x.eta - y.eta)[0]; if (c) assign(P, w, i.id, c.a.id, 'rescue'); } },
    { id: 'polar-dec', truth: 'polar', when: (i) => i.verdict === 'confirmée', after: 10, act: (P, w, i) => decide(P, w, i.id, 'marine') },
    { id: 'marlin-int', truth: 'marlin', when: (i) => i.verdict === 'confirmée', after: 5, act: (P, w, i) => assign(P, w, i.id, 'OPV-WALO', 'intervention') },
    { id: 'marlin-dec', truth: 'marlin', when: (i) => i.status === 'arraisonnée', after: 15, act: (P, w, i) => decide(P, w, i.id, 'dpsp') },
    { id: 'hailong-dec', truth: 'hailong', when: (i) => i.verdict === 'confirmée' && ['ZONE_6', 'VMS_SILENT'].every((r) => i.indicators.some((x) => x.rule === r)), after: 15, act: (P, w, i) => decide(P, w, i.id, 'dpsp') },
    { id: 'seagrace-dec', truth: 'seagrace', when: (i) => i.rule === 'PORT_IUU', after: 8, act: (P, w, i) => decide(P, w, i.id, 'port') },
    { id: 'capvert-dec', truth: 'capvert', when: (i) => i.verdict === 'confirmée' && i.indicators.some((x) => x.rule === 'ZONE_6'), after: 15, act: (P, w, i) => decide(P, w, i.id, 'dpsp') },
    { id: 'hunter-dec', truth: 'hunter', when: (i) => i.verdict === 'confirmée', after: 8, act: (P, w, i) => decide(P, w, i.id, 'operateur') },
    { id: 'golden-dec', truth: 'golden', when: (i, P) => i.verdict === 'confirmée' && P.incidents.some((g) => g.rule === 'GO_FAST'), after: 10, act: (P, w, i) => decide(P, w, i.id, 'marine') },
    { id: 'gofast-dec', truth: 'gofast', when: (i) => i.rule === 'GO_FAST', after: 4, act: (P, w, i) => decide(P, w, i.id, 'gendarmerie') },
    { id: 'atlantic-ver', truth: 'atlantic', when: (i, P, w) => !i.assigned && !i.verdict && available(w, ['usv', 'drone']).some((a) => etaMin(a, i.pos, w) <= 150), after: 10, act: (P, w, i) => { const c = available(w, ['usv', 'drone']).map((a) => ({ a, eta: etaMin(a, i.pos, w) })).sort((x, y) => x.eta - y.eta)[0]; if (c && c.eta <= 150) assign(P, w, i.id, c.a.id, 'verification'); } },
    { id: 'missing-rescue', truth: 'disparus', when: (i) => i.indicators.some((x) => x.rule === 'DISTRESS'), after: 3, act: (P, w, i) => { const c = available(w, ['vedette', 'opv']).map((a) => ({ a, eta: etaMin(a, i.pos, w) + (a.type === 'vedette' ? 0 : 30) })).sort((x, y) => x.eta - y.eta)[0]; if (c) assign(P, w, i.id, c.a.id, 'rescue'); } },
    { id: 'appui-dec', truth: 'appui', when: (i) => i.verdict === 'confirmée', after: 8, act: (P, w, i) => decide(P, w, i.id, 'dpsp') },
    { id: 'atlantic-dec', truth: 'atlantic', when: (i) => i.verdict === 'infondée', after: 5, act: (P, w, i) => decide(P, w, i.id, 'classer') },
    { id: 'pecheurs-dec', truth: 'pecheurs', when: (i) => i.verdict === 'infondée', after: 5, act: (P, w, i) => decide(P, w, i.id, 'classer') },
  ];
  function runScript(P, w) {
    SCRIPT.forEach((s) => {
      if (P.scriptDone.has(s.id)) return;
      const inc = P.incidents.find((i) => i.truthId === s.truth && !i.closed && s.when(i, P, w));
      if (!inc) return;
      const key = s.id + ':armed';
      if (!P[key]) { P[key] = w.t; return; }
      if (w.t - P[key] < s.after) return;
      P.scriptDone.add(s.id);
      s.act(P, w, inc);
    });
  }

  window.PLATFORM = {
    RULES, DECISIONS, createPlatform, ingest, evaluate, update, assign, recall, decide, available, etaMin, drPos,
    regByImo, iuuByImo, kindLabel, reliability, hhmm, inZee, in12, in6, masks, MERCHANT, FISHING,
  };
})();
