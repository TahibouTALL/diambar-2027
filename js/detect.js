// Plateforme DIAMBAR : fusion des rapports capteurs, règles de détection,
// score de risque, apprentissage par retour de vérification, chaîne de preuve.
(function () {
  const D = window.DIAMBAR_DATA;
  const GEO = window.DIAMBAR_GEO;
  const DAKAR = D.ports[0].pos;

  const RULES = {
    AIS_OFF: { label: 'Transpondeur AIS coupé', base: 50, prior: [3, 2] },
    VMS_SILENT: { label: 'Balise VMS silencieuse', base: 55, prior: [3, 2] },
    VMS_AIS_GAP: { label: 'Écart entre positions VMS et AIS', base: 76, prior: [4, 1] },
    ZONE_6: { label: 'Navire industriel dans la bande des 6 milles', base: 72, prior: [4, 1] },
    ZONE_LIC: { label: 'Hors de la zone autorisée par la licence', base: 56, prior: [3, 2] },
    AMP: { label: 'Intrusion dans une aire marine protégée', base: 70, prior: [3, 1] },
    NO_LICENCE: { label: 'Navire de pêche sans licence', base: 70, prior: [3, 1] },
    LOITER_OFFSHORE: { label: 'Arrêt prolongé en pleine mer', base: 44, prior: [2, 2] },
    TRANSSHIP: { label: 'Transbordement présumé en mer', base: 78, prior: [4, 1] },
    DARK_LARGE: { label: 'Navire non identifié (sans AIS)', base: 62, prior: [3, 2] },
    DARK_SMALL: { label: 'Embarcation non identifiée au large', base: 56, prior: [2, 2] },
    SPOOF: { label: 'Position AIS falsifiée', base: 68, prior: [3, 1] },
    PORT_IUU: { label: 'Navire inscrit sur une liste INN en approche du port', base: 92, prior: [5, 1] },
    DISTRESS: { label: 'Embarcation en détresse', base: 96, prior: [6, 1] },
    GATHER: { label: 'Rassemblement de pirogues sur une plage de départ', base: 52, prior: [2, 2] },
  };

  const FISHING = ['chalutier', 'palangrier', 'senneur'];
  const regByImo = Object.fromEntries(D.registry.map((r) => [r.imo, r]));
  const regByVms = Object.fromEntries(D.registry.map((r) => [r.vms, r]));
  const iuuByImo = Object.fromEntries(D.iuuList.map((r) => [r.imo, r]));

  function createPlatform() {
    const learn = {};
    Object.entries(RULES).forEach(([k, r]) => { learn[k] = { a: r.prior[0], b: r.prior[1], n: 0, ok: 0 }; });
    return { tracks: new Map(), alerts: [], learn, journal: [], unknown: 0, alertSeq: 0, lastEval: -999, ingested: 0 };
  }

  function journal(P, t, type, text) { P.journal.unshift({ t, type, text }); if (P.journal.length > 400) P.journal.pop(); }

  function track(P, key, init) {
    let tr = P.tracks.get(key);
    if (!tr) { tr = Object.assign({ id: key, hist: [], sources: new Set() }, init); P.tracks.set(key, tr); }
    return tr;
  }

  function setPos(tr, t, pos, src) {
    if (tr.lastT !== undefined && t < tr.lastT) return;
    tr.lastPos = pos.slice(); tr.lastT = t; tr.sources.add(src);
    tr.hist.push({ t, pos: pos.slice(), src });
    if (tr.hist.length > 60) tr.hist.shift();
  }

  function newUnknown(P, det, t, src) {
    P.unknown++;
    const id = 'C-' + String(P.unknown).padStart(3, '0');
    const cls = det.cls || (det.sizeEst >= 24 ? 'large' : 'small');
    const tr = track(P, id, { label: `Contact inconnu ${id}`, unknown: true, cls, sizeEst: det.sizeEst, _id: det._id, firstT: t });
    setPos(tr, t, det.pos, src);
    return tr;
  }

  // Associe une détection non identifiée à une piste existante proche.
  function correlate(P, det, t) {
    let best = null; let bestD = 1e9;
    P.tracks.forEach((tr) => {
      if (!tr.lastPos || t - tr.lastT > (tr.unknown ? 150 : 240)) return;
      const age = (t - tr.lastT) / 60;
      const gate = tr.unknown ? Math.min(2 + Math.max(tr.sog || 0, 12) * age, 8) : 2.5 + (tr.sog || 0) * age;
      const d = G.distNm(tr.lastPos, det.pos);
      const sizeOk = !tr.cls || !det.sizeEst || (tr.cls === 'large') === (det.sizeEst >= 24);
      if (d < gate && d < bestD && sizeOk) { best = tr; bestD = d; }
    });
    return best;
  }

  function ingest(P, r) {
    P.ingested++;
    if (r.kind === 'ais') {
      const tr = track(P, 'imo:' + r.imo, { label: r.name, imo: r.imo, shipType: r.shipType, lengthM: r.lengthM, cls: r.lengthM >= 24 ? 'large' : 'small', _id: r._id });
      if (tr.lastAis) {
        const dt = (r.t - tr.lastAis.t) / 60;
        const v = dt > 0 ? G.distNm(tr.lastAis.pos, r.pos) / dt : 0;
        if (dt > 0 && v > 35) { tr.spoofAt = r.t; if (!tr.credible || r.t - tr.credible.t > 120) tr.credible = { t: tr.lastAis.t, pos: tr.lastAis.pos, cog: tr.cog, sog: tr.sog }; }
      }
      tr.aisCount = (tr.aisCount || 0) + 1;
      tr.lastAis = { t: r.t, pos: r.pos };
      tr.sog = r.sog; tr.cog = r.cog; tr.label = r.name;
      tr.sogHist = (tr.sogHist || []).concat({ t: r.t, sog: r.sog }).slice(-40);
      setPos(tr, r.t, r.pos, 'AIS');
    } else if (r.kind === 'vms') {
      const reg = regByVms[r.vmsId];
      if (!reg) return;
      const tr = track(P, 'imo:' + reg.imo, { label: reg.name, imo: reg.imo, shipType: 'chalutier', lengthM: reg.lengthM, cls: 'large', _id: r._id });
      if (tr.lastVms && (!tr.lastAis || r.t - tr.lastAis.t > 30) && r.t > tr.lastVms.t) {
        tr.sog = G.distNm(tr.lastVms.pos, r.pos) / ((r.t - tr.lastVms.t) / 60);
        tr.cog = G.bearing(tr.lastVms.pos, r.pos);
      }
      tr.lastVms = { t: r.t, pos: r.pos };
      if (!tr.lastAis || r.t - tr.lastAis.t > 30) setPos(tr, r.t, r.pos, 'VMS');
      tr.sources.add('VMS');
    } else if (r.kind === 'sat') {
      let matched = 0; let fresh = 0; let gathers = 0;
      r.dets.forEach((det) => {
        if (det.gathering) {
          gathers++;
          const tr = track(P, 'gather:' + det._id, { label: 'Rassemblement de pirogues', unknown: true, cls: 'small', gather: true, _id: det._id });
          setPos(tr, r.t, det.pos, 'Satellite');
          tr.gatherSeen = r.t;
          return;
        }
        const tr = correlate(P, det, r.t);
        if (tr) { matched++; setPos(tr, r.t, det.pos, 'Satellite'); if (tr.unknown) tr.sizeEst = det.sizeEst; tr.satSeen = r.t; } else { fresh++; const u = newUnknown(P, det, r.t, 'Satellite'); u.satSeen = r.t; }
      });
      journal(P, r.t, 'sat', `${r.name} : ${r.dets.length} détections, ${matched} associées à des navires connus, ${fresh} nouveaux contacts${gathers ? `, ${gathers} rassemblement sur plage` : ''}.`);
    } else if (r.kind === 'asset') {
      r.dets.forEach((det) => {
        let tr = null;
        if (det.identified && det.imo) {
          tr = P.tracks.get('imo:' + det.imo) || [...P.tracks.values()].find((x) => x.imo === det.imo);
          if (!tr) {
            // Un contact inconnu correspondant prend son identité.
            tr = correlate(P, det, r.t);
            if (tr && tr.unknown && !tr.gather) {
              tr.label = `${det.name} (identifié)`; tr.imo = det.imo; tr.unknown = false; tr.identifiedBy = r.assetName;
            } else {
              tr = track(P, 'imo:' + det.imo, { label: det.name, imo: det.imo, cls: det.cls, lengthM: det.sizeEst, _id: det._id, identifiedBy: r.assetName });
            }
          }
        } else if (det.gathering) {
          tr = track(P, 'gather:' + det._id, { label: 'Rassemblement de pirogues', unknown: true, cls: 'small', gather: true, _id: det._id });
          tr.gatherSeen = r.t;
        } else {
          tr = correlate(P, det, r.t) || newUnknown(P, det, r.t, r.assetName);
          if (tr.gather) { tr.gather = false; tr.label = 'Pirogue partie de la plage'; tr.visual = true; tr.departedSeen = r.t; }
        }
        if (det.identified && !det.imo && tr.unknown && !tr.gather) { tr.label = tr.label.replace('Contact inconnu', 'Embarcation'); tr.visual = true; }
        if (tr.lastT !== undefined && r.t - tr.lastT >= 1 && tr.lastPos) {
          const v = G.distNm(tr.lastPos, det.pos) / ((r.t - tr.lastT) / 60);
          if (!tr.lastAis || r.t - tr.lastAis.t > 20) tr.sog = v;
        }
        if (det.identified) tr._id = det._id; // observation visuelle directe
        setPos(tr, r.t, det.pos, r.assetName);
        if (det.distress) tr.distress = r.t;
        tr.assetSeen = r.t;
      });
    }
  }

  // ----- Règles -----
  const inBand6 = (p) => G.inFeature(p, GEO.band6);
  const inBand12 = (p) => G.inFeature(p, GEO.band12);
  const inZee = (p) => G.inFeature(p, GEO.zee);
  const nearCoast = (p, nm) => G.coastDist(p) <= nm;

  function raise(P, w, rule, tr, factors, extra) {
    const key = rule + ':' + tr.id;
    let al = P.alerts.find((a) => a.key === key);
    const raw = RULES[rule].base + factors.reduce((s, f) => s + f.pts, 0);
    const L = P.learn[rule];
    const p = L.a / (L.a + L.b);
    const score = Math.max(5, Math.min(100, Math.round(raw * (0.75 + 0.5 * p))));
    if (al) {
      if (al.closed) return al;
      al.pos = tr.lastPos.slice(); al.updated = w.t; al.factors = factors; al.score = score; al.raw = raw;
      return al;
    }
    const ship = w.ships.find((s) => s.id === tr._id);
    P.alertSeq++;
    al = {
      id: 'A-' + String(P.alertSeq).padStart(3, '0'), key, rule, title: RULES[rule].label, trackId: tr.id, label: tr.label,
      pos: tr.lastPos.slice(), created: w.t, updated: w.t, factors, raw, score, status: 'nouvelle',
      truthId: tr._id, truthPositive: ship ? (ship.violations || []).includes(rule) : false, ...extra,
    };
    P.alerts.push(al);
    journal(P, w.t, 'alert', `${al.id} ${al.title} : ${al.label} (score ${al.score}).`);
    return al;
  }

  function evaluate(P, w) {
    if (w.t - P.lastEval < 5) return;
    P.lastEval = w.t;
    const night = SIM.isNight(w.t);
    P.tracks.forEach((tr) => {
      if (!tr.lastPos) return;
      const pos = tr.lastPos;
      const age = w.t - tr.lastT;
      const reg = tr.imo ? regByImo[tr.imo] : null;
      const fishing = FISHING.includes(tr.shipType) || (reg && true);

      // AIS coupé
      if (tr.lastAis && tr.aisCount >= 3 && w.t - tr.lastAis.t > 35 && inZee(tr.lastAis.pos)) {
        const f = [{ txt: `Dernier message AIS il y a ${Math.round(w.t - tr.lastAis.t)} min`, pts: 0 }];
        if (nearCoast(tr.lastAis.pos, 20)) f.push({ txt: 'Coupure à moins de 20 milles de la bande côtière', pts: 15 });
        if (fishing) f.push({ txt: 'Navire de pêche', pts: 10 });
        if (tr.shipType === 'cargo') f.push({ txt: 'Navire marchand sur une route commerciale', pts: -14 });
        if (night) f.push({ txt: 'De nuit', pts: 5 });
        if (tr.spoofAt) f.push({ txt: 'Position AIS falsifiée juste avant la coupure', pts: 15 });
        raise(P, w, 'AIS_OFF', tr, f);
      }
      // Balise VMS silencieuse
      if (reg && tr.lastVms && w.t - tr.lastVms.t > 150) {
        const f = [{ txt: `Aucune position VMS depuis ${Math.round(w.t - tr.lastVms.t)} min (intervalle prévu : 60 min)`, pts: 0 }];
        if (tr.lastAis && w.t - tr.lastAis.t > 35) f.push({ txt: 'AIS également coupé', pts: 12 });
        raise(P, w, 'VMS_SILENT', tr, f);
      }
      // Écart VMS / AIS
      if (tr.lastAis && tr.lastVms && w.t - tr.lastAis.t < 30 && w.t - tr.lastVms.t < 70) {
        const aisH = tr.hist.filter((h) => h.src === 'AIS');
        const ref = aisH.reduce((b, h) => (!b || Math.abs(h.t - tr.lastVms.t) < Math.abs(b.t - tr.lastVms.t) ? h : b), null);
        const dtv = ref ? Math.abs(ref.t - tr.lastVms.t) : 999;
        const d = ref ? G.distNm(ref.pos, tr.lastVms.pos) : 0;
        const allow = 2 + 14 * (dtv / 60);
        if (ref && dtv <= 15 && d > Math.max(5, allow)) {
          raise(P, w, 'VMS_AIS_GAP', tr, [{ txt: `Positions VMS et AIS distantes de ${d.toFixed(1)} milles`, pts: 0 }, { txt: 'Balise déplacée sur un autre bateau ou AIS falsifié', pts: 6 }]);
        }
      }
      const isIndustrial = tr.cls === 'large' && !['cargo', 'yacht', 'frigorifique'].includes(tr.shipType);
      const recent = age <= 45;
      // Bande des 6 milles
      if (recent && isIndustrial && (fishing || tr.unknown) && inBand6(pos) && G.distNm(pos, DAKAR) > 8 && (tr.sog === undefined || tr.sog < 6)) {
        const f = [{ txt: 'Position dans la zone réservée à la pêche artisanale', pts: 0 }];
        if (tr.sog > 1.5 && tr.sog < 5) f.push({ txt: `Vitesse de pêche (${tr.sog.toFixed(1)} nœuds)`, pts: 8 });
        if (!tr.lastAis || w.t - tr.lastAis.t > 35) f.push({ txt: 'Sans AIS actif', pts: 8 });
        raise(P, w, 'ZONE_6', tr, f);
      }
      // Hors zone de licence
      if (recent && reg && inBand12(pos) && !inBand6(pos) && G.distNm(pos, DAKAR) > 8 && (tr.sog === undefined || tr.sog < 6)) {
        raise(P, w, 'ZONE_LIC', tr, [{ txt: `Licence « ${reg.licence} » valable au-delà de ${reg.minNm} milles`, pts: 0 }]);
      }
      // Aires marines protégées
      if (recent && isIndustrial) {
        const amp = D.amps.find((a) => G.distNm(pos, a.pos) <= a.rNm);
        if (amp) raise(P, w, 'AMP', tr, [{ txt: amp.name, pts: 0 }]);
      }
      // Pêche sans licence
      if (recent && FISHING.includes(tr.shipType) && tr.imo && !reg && inZee(pos) && tr.sog > 1.5 && tr.sog < 5) {
        raise(P, w, 'NO_LICENCE', tr, [{ txt: 'Absent du registre des navires autorisés', pts: 0 }]);
      }
      // Arrêt prolongé au large
      if (tr.sogHist && tr.lastAis && w.t - tr.lastAis.t < 20 && !nearCoast(pos, 40) && tr.shipType !== 'cargo') {
        const slow = tr.sogHist.filter((h) => w.t - h.t <= 70);
        if (slow.length >= 4 && slow.every((h) => h.sog < 1) && w.t - slow[0].t >= 55) {
          raise(P, w, 'LOITER_OFFSHORE', tr, [{ txt: 'Vitesse inférieure à 1 nœud depuis plus d\'une heure', pts: 0 }, { txt: 'À plus de 40 milles de la côte', pts: 6 }, ...(night ? [{ txt: 'De nuit', pts: 4 }] : [])]);
        }
      }
      // Navire inconnu de grande taille
      if (tr.unknown && !tr.gather && tr.cls === 'large' && age < 60 && inZee(pos)) {
        const f = [{ txt: `Détecté par ${[...tr.sources].join(', ')}, taille estimée ${tr.sizeEst || '?'} m`, pts: 0 }, { txt: 'Aucun AIS ni VMS correspondant', pts: 0 }];
        if (inBand12(pos)) f.push({ txt: 'Dans les 12 milles', pts: 10 });
        raise(P, w, 'DARK_LARGE', tr, f);
      }
      // Petite embarcation inconnue au large
      if (tr.unknown && !tr.gather && tr.cls === 'small' && age < 60 && !inBand12(pos) && inZee(pos)) {
        const f = [{ txt: `Embarcation de ${tr.sizeEst || '?'} m détectée par ${[...tr.sources].join(', ')}`, pts: 0 }, { txt: 'Au-delà des 12 milles', pts: 4 }];
        if (night) f.push({ txt: 'De nuit, période habituelle des départs', pts: 10 });
        raise(P, w, 'DARK_SMALL', tr, f);
      }
      // Falsification AIS
      if (tr.spoofAt && w.t - tr.spoofAt < 90) {
        raise(P, w, 'SPOOF', tr, [{ txt: 'Saut de position impossible (vitesse implicite supérieure à 35 nœuds)', pts: 0 }]);
      }
      // Contrôle portuaire : listes INN
      if (tr.imo && tr.lastAis && G.distNm(pos, DAKAR) < 30 && tr.cog !== undefined && Math.abs(((G.bearing(pos, DAKAR) - tr.cog + 540) % 360) - 180) < 40) {
        const hit = iuuByImo[tr.imo];
        if (hit) raise(P, w, 'PORT_IUU', tr, [{ txt: `Numéro OMI ${tr.imo} identique à ${hit.name} (${hit.source}, depuis ${hit.since})`, pts: 0 }, { txt: `Nom déclaré dans l'AIS : ${tr.label}`, pts: 0 }]);
      }
      // Détresse
      if (tr.distress && w.t - tr.distress < 120) {
        raise(P, w, 'DISTRESS', tr, [{ txt: 'Embarcation immobilisée et surchargée observée par un drone', pts: 0 }], { rescue: true });
      }
      // Rassemblement sur une plage
      if (tr.gather && tr.gatherSeen && w.t - tr.gatherSeen < 240) {
        const beach = D.beaches.reduce((b, x) => (G.distNm(x.pos, pos) < G.distNm(b.pos, pos) ? x : b));
        raise(P, w, 'GATHER', tr, [{ txt: `Plage de ${beach.name}`, pts: 0 }, { txt: 'Nombreuses pirogues et groupes de personnes', pts: 6 }, ...(night ? [{ txt: 'Fin de journée, avant un départ de nuit', pts: 6 }] : [])]);
      }
    });
    // Transbordement : deux pistes immobiles côte à côte au large.
    const list = [...P.tracks.values()].filter((t) => t.lastPos && w.t - t.lastT < 60 && t.cls === 'large' && (t.sog || 0) < 1.5 && !nearCoast(t.lastPos, 25));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const d = G.distNm(list[i].lastPos, list[j].lastPos);
        if (d < 0.8) {
          const a = list[i].unknown ? list[j] : list[i];
          const b = a === list[i] ? list[j] : list[i];
          raise(P, w, 'TRANSSHIP', a, [{ txt: `Avec ${b.label}, à ${(d * 1852).toFixed(0)} m`, pts: 0 }, { txt: 'Les deux navires à l\'arrêt au large', pts: 4 }]);
        }
      }
    }
    P.alerts.forEach((al) => {
      if (!al.closed && al.status === 'nouvelle') al.age = w.t - al.created;
      // Une alerte non traitée dont la condition a cessé se met en veille.
    });
  }

  // ----- Moyens -----
  function eta(asset, pos) { return Math.round((G.distNm(asset.pos, pos) / asset.kn) * 60); }

  function available(w, types) {
    return w.assets.filter((a) => types.includes(a.type) && a.state !== 'maintenance' && !a.task);
  }

  function assign(P, w, alertId, assetId, purpose) {
    const al = P.alerts.find((a) => a.id === alertId);
    const as = w.assets.find((a) => a.id === assetId);
    if (!al || !as || as.task) return null;
    const tr = P.tracks.get(al.trackId);
    as.task = { alertId, truthId: al.truthId, estimate: (tr && tr.lastPos ? tr.lastPos : al.pos).slice(), purpose, start: w.t };
    as.state = 'transit';
    if (purpose === 'verification') { al.status = 'en vérification'; al.assigned = as.id; al.assignedAt = w.t; }
    if (purpose === 'intervention') { al.intervention = as.id; al.status = al.verdict ? al.status : 'en vérification'; }
    if (purpose === 'rescue') { al.rescueBy = as.id; }
    if (purpose === 'suivi') { al.followedBy = as.id; }
    journal(P, w.t, 'asset', `${as.name} envoyé sur ${al.id} (${purposeLabel(purpose)}), arrivée estimée dans ${eta(as, as.task.estimate)} min.`);
    return as;
  }

  const purposeLabel = (p) => ({ verification: 'vérification', intervention: 'intervention', rescue: 'sauvetage', suivi: 'suivi continu' }[p]);

  async function sha256(text) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      let h = 2166136261;
      for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
      return 'fnv-' + (h >>> 0).toString(16);
    }
  }

  // Traite l'arrivée des moyens et produit les preuves.
  function update(P, w) {
    w.assets.forEach((as) => {
      const task = as.task;
      if (!task) return;
      const al = P.alerts.find((a) => a.id === task.alertId);
      if (!al) { as.task = null; as.state = 'retour'; return; }
      const ship = w.ships.find((s) => s.id === task.truthId);
      const tr = P.tracks.get(al.trackId);
      if (tr && tr.lastPos && tr.lastT > (task.estimateT || task.start)) {
        let est = tr.lastPos;
        if (tr.credible && tr.spoofAt && (al.rule === 'SPOOF' || al.rule === 'AIS_OFF')) {
          est = G.move(tr.credible.pos, tr.credible.cog || 0, ((tr.credible.sog || 0) * (w.t - tr.credible.t)) / 60);
        }
        const moved = G.distNm(est, task.estimate);
        task.estimate = est.slice(); task.estimateT = tr.lastT;
        if (as.state === 'recherche' && moved > 3) { as.state = 'transit'; task.lost = false; }
      }
      if (task.purpose === 'suivi') {
        if (task.lowEnergy) { journal(P, w.t, 'asset', `${as.name} : réserve d'énergie basse, fin du suivi, retour à la base.`); as.task = null; as.state = 'retour'; al.followedBy = null; }
        else if (task.lost) { task.lost = false; as.state = 'transit'; }
        return;
      }
      if (task.lost && !task.done) {
        task.done = true;
        if (task.purpose === 'verification') { al.status = 'cible non retrouvée'; al.verdict = 'non retrouvée'; }
        journal(P, w.t, 'verif', `${al.id} : ${as.name} n'a pas retrouvé la cible après 70 min de recherche.`);
        as.task = null; as.state = 'retour';
        return;
      }
      if (task.arrivedAt && !task.done && ship) {
        task.done = true;
        if (task.purpose === 'verification') {
          const positive = al.truthPositive;
          const L = P.learn[al.rule];
          L.n++; if (positive) { L.a++; L.ok++; } else { L.b++; }
          al.verdict = positive ? 'confirmée' : 'infondée';
          al.status = positive ? 'confirmée' : 'infondée';
          al.verifiedAt = w.t;
          al.delay = w.t - al.created;
          const ev = {
            id: 'PV-' + al.id.slice(2) + '-' + String(w.t).padStart(4, '0'),
            time: D.START + w.t * 60000,
            pos: ship.pos.slice(),
            heading: Math.round(ship.heading),
            sog: ship.sog,
            asset: as.name,
            identity: ship.imo ? `${ship.name} (OMI ${ship.imo})` : ship.name,
            shipType: ship.type,
            lengthM: ship.lengthM,
            persons: ship.persons || null,
            observations: positive ? ship.observations : (ship.benign || `${ship.name} : aucune infraction constatée pour ce motif.`),
            night: SIM.isNight(w.t),
          };
          al.evidence = ev;
          sha256(JSON.stringify(ev)).then((h) => { ev.hash = h; });
          journal(P, w.t, 'verif', `${al.id} ${al.verdict} par ${as.name} : ${ev.observations}`);
          if (al.rule === 'DISTRESS' || (positive && ship.distress)) {
            task.done = false; task.arrivedAt = null; task.purpose = 'suivi'; al.followedBy = as.id; // le moyen reste sur zone jusqu'aux secours
            return;
          }
          task.releaseAt = w.t + 15;
        } else if (task.purpose === 'intervention') {
          al.intervened = w.t;
          al.status = 'arraisonnée';
          al.outcome = al.truthPositive
            ? (al.rule === 'PORT_IUU' ? 'Navire escorté, accès au port refusé (accord PSMA).' : 'Arraisonnement : infraction constatée, navire dérouté vers Dakar, procès-verbal établi.')
            : 'Contrôle effectué : aucune infraction constatée.';
          journal(P, w.t, 'decision', `${al.id} : ${as.name}. ${al.outcome}`);
          task.releaseAt = w.t + 10;
          if (ship) ship.plan = [{ kind: 'goto', to: DAKAR, kn: 9 }, { kind: 'hold', until: 99999 }], ship.legIdx = 0, ship.legState = {}, ship.aisOn = ship.hasAis;
        } else if (task.purpose === 'rescue') {
          al.rescued = w.t; al.status = 'secourue';
          al.outcome = `${ship.persons || 'Les'} personnes secourues et ramenées à Joal.`;
          journal(P, w.t, 'decision', `${al.id} : ${al.outcome}`);
          ship.plan = [{ kind: 'goto', to: D.ports[2].pos, kn: 8 }, { kind: 'hold', until: 99999 }]; ship.legIdx = 0; ship.legState = {}; ship.distress = false;
          w.assets.forEach((o) => { if (o.task && o !== as && (o.task.alertId === al.id || o.task.truthId === ship.id)) { o.task = null; o.state = 'retour'; } });
          task.releaseAt = w.t + 5;
        }
      }
      if (task.releaseAt && w.t >= task.releaseAt) { as.task = null; as.state = 'retour'; }
      if (task.lowEnergy && task.purpose !== 'intervention') { journal(P, w.t, 'asset', `${as.name} : réserve d'énergie basse, retour à la base.`); as.task = null; as.state = 'retour'; }
    });
  }

  function decide(P, w, alertId, decision) {
    const al = P.alerts.find((a) => a.id === alertId);
    if (!al) return;
    const labels = {
      dpsp: 'Dossier transmis à la DPSP (procès-verbal)',
      marine: 'Dossier transmis à la Marine nationale',
      port: 'Accès au port de Dakar refusé (accord PSMA)',
      classer: 'Alerte classée par l\'opérateur',
    };
    al.decision = labels[decision];
    al.closed = decision !== 'marine';
    if (decision === 'classer' && !al.verdict) {
      // Classer sans vérifier compte comme un retour négatif léger.
      P.learn[al.rule].b += 0.5;
    }
    al.status = decision === 'classer' ? 'classée' : 'transmise';
    al.closed = true;
    journal(P, w.t, 'decision', `${al.id} : ${al.decision}.`);
  }

  window.PLATFORM = { RULES, createPlatform, ingest, evaluate, update, assign, decide, available, eta, regByImo, iuuByImo };
})();
