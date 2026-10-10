// Interface opérateur : carte, alertes, moyens, contrôle des navires, journal.
(function () {
  const D = window.DIAMBAR_DATA;
  const GEO = window.DIAMBAR_GEO;
  const P_ = window.PLATFORM;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  const state = {
    w: null, P: null, playing: false, speed: 10, acc: 0, tab: 'alerts', selAlert: null,
    filter: 'ouvertes', truth: false, srModel: true, search: '', dirty: true, lastPanel: 0,
  };

  // ---------- Temps ----------
  const DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  function clockText(t) {
    const d = new Date(D.START + t * 60000);
    return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} oct. ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
  const hhmm = (t) => clockText(t).slice(-5);
  const dur = (m) => (m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}`);

  // ---------- Sévérité ----------
  const sev = (s) => (s >= 85 ? 'crit' : s >= 65 ? 'high' : s >= 45 ? 'mid' : 'low');
  const sevLabel = { crit: 'Critique', high: 'Haute', mid: 'Moyenne', low: 'Basse' };
  const sevColor = (s) => css('--' + sev(s));

  // ---------- Carte ----------
  let map; const layers = {};
  function initMap() {
    map = L.map('map', { zoomControl: true, attributionControl: true, minZoom: 6, maxZoom: 13, preferCanvas: false, worldCopyJump: false })
      .setView([14.35, -17.75], 7);
    window.__diambarMap = map;
    map.attributionControl.setPrefix(false).addAttribution('Côtes : Natural Earth · Limites indicatives');
    map.setMaxBounds([[10.5, -23], [18.5, -11]]);

    const land = css('--land'), landLine = css('--land-line');
    L.geoJSON(GEO.zee, { style: { color: css('--accent'), weight: 1.4, dashArray: '6 5', fill: false }, interactive: false }).addTo(map);
    L.geoJSON(GEO.gambia, { style: { color: css('--muted'), weight: 0.8, dashArray: '2 4', fillColor: '#000', fillOpacity: 0.18 }, interactive: false }).addTo(map);
    L.geoJSON(GEO.band12, { style: { color: css('--muted'), weight: 0.9, fill: false }, interactive: false }).addTo(map);
    L.geoJSON(GEO.band6, { style: { color: css('--own'), weight: 0.8, opacity: 0.7, fillColor: css('--own'), fillOpacity: 0.07 }, interactive: false }).addTo(map);
    L.geoJSON(GEO.land, { style: { color: landLine, weight: 0.8, fillColor: land, fillOpacity: 1 }, interactive: false }).addTo(map);

    D.amps.forEach((a) => L.circle(a.pos, { radius: a.rNm * 1852, color: css('--ok'), weight: 1, fillOpacity: 0.16 }).bindTooltip(a.name + ' (indicative)').addTo(map));
    D.offshore.forEach((o) => L.circle(o.pos, { radius: o.rNm * 1852, color: '#9fb6ff', weight: 1, dashArray: '3 3', fillOpacity: 0.06 }).bindTooltip(o.name).addTo(map));
    D.beaches.forEach((b) => L.circleMarker(b.pos, { radius: 3, color: css('--high'), weight: 1, fillOpacity: 0.9 }).bindTooltip('Plage de départ surveillée : ' + b.name).addTo(map));

    const lbl = (pos, text, cls) => L.marker(pos, { interactive: false, icon: L.divIcon({ className: '', html: `<div class="mk-label ${cls || ''}" style="opacity:.75">${text}</div>`, iconSize: [0, 0] }) }).addTo(map);
    lbl([15.0, -16.62], 'SÉNÉGAL'); lbl([16.5, -15.9], 'MAURITANIE'); lbl([13.32, -16.2], 'GAMBIE'); lbl([12.05, -15.6], 'GUINÉE-BISSAU');
    lbl([13.32, -18.6], 'Eaux gambiennes'); lbl([15.45, -19.75], 'ZEE (indicative)');
    D.ports.forEach((p) => L.circleMarker(p.pos, { radius: 3.5, color: css('--fg'), weight: 1, fillColor: css('--ink'), fillOpacity: 1 }).bindTooltip(p.name).addTo(map));

    layers.tracks = L.layerGroup().addTo(map);
    layers.truth = L.layerGroup().addTo(map);
    layers.assets = L.layerGroup().addTo(map);
    layers.alerts = L.layerGroup().addTo(map);
    layers.overlay = L.layerGroup().addTo(map);
    layers.markers = { tracks: new Map(), truth: new Map(), assets: new Map(), alerts: new Map(), ranges: new Map(), routes: new Map() };
  }

  function shipSvg(kind, color, rot) {
    if (kind === 'unknown') return `<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><rect x="5" y="5" width="8" height="8" transform="rotate(45 9 9)" fill="none" stroke="${color}" stroke-width="1.8"/></svg>`;
    if (kind === 'small') return `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" style="transform:rotate(${rot}deg)"><path d="M7 1 L10 12 L7 10 L4 12 Z" fill="${color}"/></svg>`;
    return `<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style="transform:rotate(${rot}deg)"><path d="M9 1 L15 16 L9 12.5 L3 16 Z" fill="${color}" stroke="${css('--ink')}" stroke-width="0.8"/></svg>`;
  }

  function assetSvg(a) {
    const c = a.state === 'maintenance' ? css('--muted') : css('--own');
    if (a.type === 'drone') return `<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" style="transform:rotate(${a.heading}deg)"><path d="M11 2 L13 10 L21 13 L13 13 L12 19 L14 21 L8 21 L10 19 L9 13 L1 13 L9 10 Z" fill="${c}" stroke="${css('--ink')}" stroke-width="0.8"/></svg>`;
    if (a.type === 'opv') return `<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" style="transform:rotate(${a.heading}deg)"><path d="M11 1 L15 7 L15 20 L7 20 L7 7 Z" fill="${c}" stroke="${css('--ink')}" stroke-width="0.8"/></svg>`;
    return `<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="6.5" fill="${c}" stroke="${css('--ink')}" stroke-width="1"/><path d="M9 4 L12 12 L9 10.5 L6 12 Z" fill="${css('--ink')}" transform="rotate(${a.heading} 9 9)"/></svg>`;
  }

  function upsertMarker(store, group, key, pos, html, size, tooltip, onClick) {
    let m = store.get(key);
    const icon = L.divIcon({ className: 'mk', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
    if (!m) {
      m = L.marker(pos, { icon, keyboard: false }).addTo(group);
      if (tooltip) m.bindTooltip(tooltip, { direction: 'top', offset: [0, -8] });
      if (onClick) m.on('click', onClick);
      store.set(key, m);
    } else {
      m.setLatLng(pos);
      if (m._lastHtml !== html) m.setIcon(icon);
      if (tooltip && m.getTooltip()) m.setTooltipContent(tooltip);
    }
    m._lastHtml = html; m._seen = true;
    return m;
  }

  function sweep(store, group) {
    store.forEach((m, k) => { if (!m._seen) { group.removeLayer(m); store.delete(k); } m._seen = false; });
  }

  function renderMap() {
    const { w, P } = state;
    const M = layers.markers;
    // Pistes de la plateforme
    const alertByTrack = {};
    P.alerts.forEach((a) => { if (!a.closed && (!alertByTrack[a.trackId] || alertByTrack[a.trackId].score < a.score)) alertByTrack[a.trackId] = a; });
    P.tracks.forEach((tr) => {
      if (!tr.lastPos || w.t - tr.lastT > 240) return;
      const stale = w.t - tr.lastT > 30;
      const al = alertByTrack[tr.id];
      const color = al ? sevColor(al.score) : tr.unknown ? '#ffffff' : (stale ? css('--muted') : css('--fg'));
      const kind = tr.unknown && !tr.visual ? 'unknown' : tr.cls === 'small' ? 'small' : 'large';
      const html = `<div style="opacity:${stale ? 0.55 : 1}">${shipSvg(kind, color, tr.cog || 0)}</div>`;
      const tip = `<b>${esc(tr.label)}</b><br>${[...tr.sources].join(' · ')}<br>vu à ${hhmm(tr.lastT)}${tr.sog !== undefined ? ` · ${tr.sog.toFixed(1)} nd` : ''}`;
      upsertMarker(M.tracks, layers.tracks, tr.id, tr.lastPos, html, 18, tip, al ? () => openAlert(al.id) : null);
    });
    sweep(M.tracks, layers.tracks);

    // Vérité terrain (mode formateur)
    if (state.truth) {
      w.ships.forEach((s) => {
        const bad = (s.violations || []).length > 0;
        const html = `<div style="opacity:.8">${shipSvg(s.cls === 'small' ? 'small' : 'large', bad ? '#ff6fd8' : '#7fa0b3', s.heading)}</div>`;
        upsertMarker(M.truth, layers.truth, s.id, s.pos, html, 16, `<b>${esc(s.name)}</b> (vérité)${s.story ? '<br>' + esc(s.story) : ''}`);
      });
    }
    sweep(M.truth, layers.truth);

    // Moyens et portée des capteurs
    w.assets.forEach((a) => {
      const showLabel = a.state !== 'base' && a.state !== 'maintenance';
      const label = `<div style="position:relative">${assetSvg(a)}${showLabel ? `<div class="mk-label" style="position:absolute;left:22px;top:3px;color:${css('--own')}">${esc(a.name)}</div>` : ''}</div>`;
      upsertMarker(M.assets, layers.assets, a.id, a.pos, label, 22, `<b>${esc(a.name)}</b><br>${stateLabel(a)}`, () => { setTab('assets'); });
      const active = a.state !== 'base' && a.state !== 'maintenance';
      let rc = M.ranges.get(a.id);
      if (active) {
        if (!rc) { rc = L.circle(a.pos, { radius: a.detectLarge * 1852, color: css('--own'), weight: 0.7, opacity: 0.5, fillOpacity: 0.04, interactive: false }).addTo(layers.assets); M.ranges.set(a.id, rc); }
        rc.setLatLng(a.pos);
      } else if (rc) { layers.assets.removeLayer(rc); M.ranges.delete(a.id); }
      let rt = M.routes.get(a.id);
      if (a.task && a.task.estimate) {
        const tgt = a.task.acquired ? (w.ships.find((s) => s.id === a.task.truthId) || {}).pos || a.task.estimate : a.task.estimate;
        if (!rt) { rt = L.polyline([a.pos, tgt], { color: css('--own'), weight: 1.4, dashArray: '4 4', interactive: false }).addTo(layers.assets); M.routes.set(a.id, rt); }
        rt.setLatLngs([a.pos, tgt]);
      } else if (rt) { layers.assets.removeLayer(rt); M.routes.delete(a.id); }
    });
    sweep(M.assets, layers.assets);

    // Alertes ouvertes : anneau pulsant pour les critiques et hautes
    P.alerts.forEach((al) => {
      if (al.closed || al.score < 65 || ['infondée', 'secourue', 'arraisonnée'].includes(al.status)) return;
      const c = sevColor(al.score);
      upsertMarker(M.alerts, layers.alerts, al.id, al.pos, `<div class="pulse" style="width:30px;height:30px;border-color:${c}"></div>`, 30, null, () => openAlert(al.id));
    });
    sweep(M.alerts, layers.alerts);
  }

  // Trace de la piste sélectionnée
  let selLine = null;
  function drawSelection() {
    if (selLine) { layers.overlay.removeLayer(selLine); selLine = null; }
    const al = state.P.alerts.find((a) => a.id === state.selAlert);
    if (!al) return;
    const tr = state.P.tracks.get(al.trackId);
    if (tr && tr.hist.length > 1) selLine = L.polyline(tr.hist.map((h) => h.pos), { color: css('--accent'), weight: 1.6, opacity: 0.85, interactive: false }).addTo(layers.overlay);
  }

  function flashSwath(name, area) {
    const shape = area ? L.circle(area, { radius: 60 * 1852 }) : L.geoJSON(GEO.zee);
    shape.setStyle({ color: '#9fb6ff', weight: 1, fillColor: '#9fb6ff', fillOpacity: 0.16, interactive: false });
    shape.addTo(layers.overlay);
    setTimeout(() => layers.overlay.removeLayer(shape), 1800);
    toast(`Passage satellite : ${name}`, 'sat');
  }

  // ---------- Notifications ----------
  function toast(text, cls) {
    const el = document.createElement('div');
    el.className = 'toast ' + (cls || '');
    el.textContent = text;
    $('#toasts').prepend(el);
    setTimeout(() => el.remove(), 4200);
    while ($('#toasts').children.length > 3) $('#toasts').lastChild.remove();
  }

  // ---------- Moteur ----------
  function reset(targetT, caseDef) {
    state.w = SIM.createWorld({ srModel: state.srModel });
    state.P = P_.createPlatform();
    state.selAlert = null;
    Object.values(layers.markers).forEach((s) => s.forEach((m) => { m.remove(); }));
    Object.values(layers.markers).forEach((s) => s.clear());
    layers.tracks.clearLayers(); layers.truth.clearLayers(); layers.assets.clearLayers(); layers.alerts.clearLayers(); layers.overlay.clearLayers();
    if (targetT) {
      const prep = (caseDef && caseDef.prep) || [];
      while (state.w.t < targetT) {
        tick(1, true);
        prep.forEach((pr) => {
          if (pr.done) return;
          const al = state.P.alerts.find((a) => a.rule === pr.rule);
          if (al) { PLATFORM.assign(state.P, state.w, al.id, pr.asset, pr.purpose); pr.done = true; }
        });
      }
      prep.forEach((pr) => { pr.done = false; });
    }
    state.dirty = true;
    renderAll();
  }

  let seenAlerts = 0; let seenJournal = 0;
  function tick(dt, silent) {
    const { w, P } = state;
    SIM.step(w, dt);
    w.reports.forEach((r) => {
      PLATFORM.ingest(P, r);
      if (r.kind === 'sat' && !silent) flashSwath(r.name, r.area);
    });
    w.reports.length = 0;
    PLATFORM.evaluate(P, w);
    PLATFORM.update(P, w);
    if (silent) { seenAlerts = P.alerts.length; seenJournal = P.journal.length; return; }
    if (P.alerts.length > seenAlerts) {
      P.alerts.slice(seenAlerts).forEach((a) => toast(`${a.id} · ${a.title} · ${a.label} (score ${a.score})`, a.score >= 85 ? 'crit' : ''));
      seenAlerts = P.alerts.length; state.dirty = true;
    }
    if (P.journal.length !== seenJournal) { seenJournal = P.journal.length; state.dirty = true; }
  }

  let lastFrame = 0; let lastMap = 0;
  function frame(ts) {
    const dtReal = Math.min(0.25, (ts - (lastFrame || ts)) / 1000);
    lastFrame = ts;
    if (state.playing) {
      state.acc += dtReal * state.speed;
      while (state.acc >= 1) {
        state.acc -= 1;
        tick(1);
        if (state.w.t >= D.END_MIN) { setPlaying(false); toast('Fin du scénario : jeudi 15 octobre, 9 h 00.'); break; }
      }
    }
    if (ts - lastMap > 90) { lastMap = ts; renderMap(); renderTop(); }
    if (state.dirty && ts - state.lastPanel > 400) { state.lastPanel = ts; state.dirty = false; renderPanel(); }
    else if (ts - state.lastPanel > 1500) { state.lastPanel = ts; renderPanel(); }
    requestAnimationFrame(frame);
  }

  function setPlaying(p) {
    state.playing = p;
    $('#play').textContent = p ? 'Pause' : 'Lecture';
  }

  // ---------- Indicateurs ----------
  let covPts = null;
  function coverage() {
    if (!covPts) {
      const r = G.rng(7); const b = G.bboxOf(GEO.zee); covPts = [];
      while (covPts.length < 1400) { const p = [b.s + r() * (b.n - b.s), b.w + r() * (b.e - b.w)]; if (G.inFeature(p, GEO.zee)) covPts.push(p); }
    }
    const act = state.w.assets.filter((a) => a.state !== 'base' && a.state !== 'maintenance');
    let n = 0;
    covPts.forEach((p) => { if (act.some((a) => G.distNm(a.pos, p) <= a.detectLarge)) n++; });
    return (100 * n) / covPts.length;
  }

  function renderTop() {
    const { w, P } = state;
    $('#clock').textContent = clockText(w.t);
    $('#daynight').textContent = SIM.isNight(w.t) ? 'nuit' : 'jour';
    const open = P.alerts.filter((a) => !a.closed && !['infondée', 'secourue', 'arraisonnée'].includes(a.status));
    const by = { crit: 0, high: 0, mid: 0, low: 0 };
    open.forEach((a) => by[sev(a.score)]++);
    $('#kOpen').innerHTML = `${open.length}<span class="sevs">${['crit', 'high', 'mid'].map((k) => by[k] ? `<i style="background:${css('--' + k)}">${by[k]}</i>` : '').join('')}</span>`;
    $('#kCov').innerHTML = `${coverage().toFixed(1)}<small>% de la ZEE</small>`;
    const ver = P.alerts.filter((a) => a.verdict === 'confirmée' || a.verdict === 'infondée');
    $('#kDelay').innerHTML = ver.length ? `${Math.round(ver.reduce((s, a) => s + a.delay, 0) / ver.length)}<small>min</small>` : '–';
    $('#kFalse').innerHTML = ver.length ? `${Math.round((100 * ver.filter((a) => a.verdict === 'infondée').length) / ver.length)}<small>% de ${ver.length}</small>` : '–';
    $('#kDoc').textContent = P.alerts.filter((a) => a.verdict === 'confirmée' && a.rule !== 'DISTRESS' && a.rule !== 'GATHER').length;
    $('#kSaved').textContent = P.alerts.filter((a) => a.rescued).reduce((s, a) => s + ((w.ships.find((x) => x.id === a.truthId) || {}).persons || 0), 0);
    const cnt = open.filter((a) => a.score >= 65).length;
    $('#tabCount').hidden = !cnt; $('#tabCount').textContent = cnt;
  }

  // ---------- Panneau ----------
  function setTab(t) {
    state.tab = t;
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    if (t !== 'alerts') state.selAlert = null;
    drawSelection();
    renderPanel();
  }

  function renderAll() { renderMap(); renderTop(); renderPanel(); }

  function renderPanel() {
    const pane = $('#pane');
    const keepScroll = pane.scrollTop;
    const focusId = document.activeElement && document.activeElement.id;
    if (state.tab === 'alerts') pane.innerHTML = state.selAlert ? alertDetail() : alertList();
    if (state.tab === 'assets') pane.innerHTML = assetsPane();
    if (state.tab === 'ships') pane.innerHTML = shipsPane();
    if (state.tab === 'journal') pane.innerHTML = journalPane();
    if (state.tab === 'system') pane.innerHTML = systemPane();
    pane.scrollTop = keepScroll;
    if (focusId && document.getElementById(focusId)) { const el = document.getElementById(focusId); el.focus(); if (el.setSelectionRange && el.value) el.setSelectionRange(el.value.length, el.value.length); }
  }

  function statusChip(a) {
    const map = { 'nouvelle': '', 'en vérification': 'run', 'confirmée': 'bad', 'infondée': 'ok', 'cible non retrouvée': '', 'transmise': 'ok', 'classée': '', 'arraisonnée': 'ok', 'secourue': 'ok' };
    return `<span class="chip ${map[a.status] || ''}">${esc(a.status)}</span>`;
  }

  function alertList() {
    const { P } = state;
    const f = state.filter;
    let list = P.alerts.slice();
    if (f === 'ouvertes') list = list.filter((a) => !a.closed && !['infondée', 'secourue', 'arraisonnée'].includes(a.status));
    list.sort((a, b) => (a.closed - b.closed) || (b.score - a.score) || (b.created - a.created));
    const filt = `<div class="filters"><div class="seg" role="group" aria-label="Filtre">
      <button type="button" data-filter="ouvertes" aria-pressed="${f === 'ouvertes'}">Ouvertes</button>
      <button type="button" data-filter="toutes" aria-pressed="${f === 'toutes'}">Toutes (${P.alerts.length})</button></div>
      <span class="hint">Classées par score de risque</span></div>`;
    if (!list.length) {
      return filt + `<div class="empty">${state.w.t < 20 ? 'Aucune alerte pour l\'instant. Lancez la lecture : le premier passage satellite a lieu à 18 h 52.' : 'Aucune alerte ouverte. La plateforme surveille les flux AIS, VMS et satellites.'}</div>`;
    }
    return filt + `<div class="alerts">${list.map((a) => `
      <button class="alert ${a.closed ? 'closed' : ''}" type="button" data-alert="${a.id}">
        <span class="stripe" style="background:${sevColor(a.score)}"></span>
        <span class="body"><div class="t">${esc(a.title)}</div><div class="s">${a.id} · ${esc(a.label)} · ${hhmm(a.created)}</div></span>
        <span class="meta"><span class="score" style="color:${sevColor(a.score)}">${a.score}</span>${statusChip(a)}</span>
      </button>`).join('')}</div>`;
  }

  function nearest(types, pos, n) {
    return state.w.assets.filter((a) => types.includes(a.type) && a.state !== 'maintenance' && !a.task)
      .map((a) => ({ a, eta: P_.eta(a, pos) })).sort((x, y) => x.eta - y.eta).slice(0, n);
  }

  function alertDetail() {
    const { P, w } = state;
    const a = P.alerts.find((x) => x.id === state.selAlert);
    if (!a) { state.selAlert = null; return alertList(); }
    const tr = P.tracks.get(a.trackId);
    const L = P.learn[a.rule];
    const s = sev(a.score);
    let h = `<button class="back" type="button" data-back>← Toutes les alertes</button>
      <div class="detail-head"><div><h3>${esc(a.title)}</h3><div class="hint">${a.id} · levée à ${hhmm(a.created)} · ${statusChip(a)}</div></div>
      <div class="bigscore"><span class="score" style="color:${sevColor(a.score)}">${a.score}</span><small>${sevLabel[s]}</small></div></div>
      <dl class="kv">
        <dt>Navire</dt><dd>${esc(a.label)}</dd>
        <dt>Position</dt><dd>${G.fmtPos(tr && tr.lastPos ? tr.lastPos : a.pos)}</dd>
        <dt>Dernier contact</dt><dd>${tr ? hhmm(tr.lastT) + ' · ' + [...tr.sources].join(', ') : '–'}</dd>
        ${tr && tr.imo ? `<dt>Registre</dt><dd>${P_.regByImo[tr.imo] ? 'Autorisé · ' + esc(P_.regByImo[tr.imo].licence) : P_.iuuByImo[tr.imo] ? 'Liste INN · ' + esc(P_.iuuByImo[tr.imo].name) : 'Absent du registre'}</dd>` : ''}
      </dl>
      <h3>Pourquoi cette alerte</h3>
      <ul class="factors">${a.factors.map((f) => `<li><span>${esc(f.txt)}</span><span>${f.pts ? (f.pts > 0 ? '+' : '') + f.pts : ''}</span></li>`).join('')}
        <li><span>Base de la règle</span><span>${PLATFORM.RULES[a.rule].base}</span></li>
        <li><span>Fiabilité apprise de la règle</span><span>${Math.round((100 * L.a) / (L.a + L.b))} %</span></li></ul>`;

    if (a.evidence) h += evidenceCard(a);
    if (a.outcome) h += `<div class="outcome">${esc(a.outcome)}</div>`;

    h += '<div class="actions">';
    const pos = tr && tr.lastPos ? tr.lastPos : a.pos;
    if (!a.closed) {
      if (a.rescue || a.rule === 'DISTRESS') {
        if (!a.rescueBy && !a.rescued) {
          const best = nearest(['opv', 'usv'], pos, 2);
          h += `<div class="label">Sauvetage</div><div class="row">${best.map((b) => `<button class="btn danger" type="button" data-assign="${b.a.id}" data-purpose="rescue">Déclencher le sauvetage · ${esc(b.a.name)} · ${dur(b.eta)}</button>`).join('') || '<span class="hint">Aucun moyen disponible.</span>'}</div>`;
        } else if (a.rescueBy && !a.rescued) h += `<div class="outcome">Secours en route : ${esc(w.assets.find((x) => x.id === a.rescueBy).name)}. Le drone reste sur zone et transmet la position.</div>`;
      }
      if (!a.assigned && !a.verdict) {
        const best = nearest(['usv', 'drone'], pos, 3);
        h += `<div class="label">Vérifier sur place</div><div class="row">${best.map((b) => `<button class="btn own" type="button" data-assign="${b.a.id}" data-purpose="verification">${esc(b.a.name)} · ${dur(b.eta)}</button>`).join('') || '<span class="hint">Tous les drones sont engagés.</span>'}</div>`;
      } else if (a.assigned && !a.verdict) {
        const as = w.assets.find((x) => x.id === a.assigned);
        h += `<div class="outcome">${esc(as.name)} en route${as.task && as.task.acquired ? ', cible acquise par ses capteurs' : ''}${as.state === 'recherche' ? ', recherche en cours autour de la dernière position' : ''}. Arrivée estimée : ${dur(P_.eta(as, as.task ? as.task.estimate : pos))}.</div>`;
      }
      if (!a.followedBy && !a.rescued && !['infondée', 'arraisonnée'].includes(a.status)) {
        const fol = nearest(['usv', 'drone'], pos, 2);
        if (fol.length) h += `<div class="label">Suivre en continu</div><div class="row">${fol.map((b) => `<button class="btn" type="button" data-assign="${b.a.id}" data-purpose="suivi">${esc(b.a.name)} · ${dur(b.eta)}</button>`).join('')}</div>`;
      } else if (a.followedBy) {
        const fa = w.assets.find((x) => x.id === a.followedBy);
        if (fa && fa.task) h += `<div class="outcome">${esc(fa.name)} suit la cible en continu et transmet sa position.</div>`;
      }
      const night = SIM.isNight(w.t);
      h += `<div class="label">Autres moyens</div><div class="row">
        <button class="btn" type="button" data-sat="${night ? 'radar' : 'optique'}">Commander une image ${night ? 'radar' : 'optique'} sur la zone (${night ? '50' : '35'} min)</button>`;
      if (!a.intervention && a.rule !== 'DISTRESS' && a.rule !== 'GATHER') {
        const opv = nearest(['opv'], pos, 1)[0];
        if (opv) h += `<button class="btn" type="button" data-assign="${opv.a.id}" data-purpose="intervention">Intervention de la Marine · ${esc(opv.a.name)} · ${dur(opv.eta)}</button>`;
      }
      h += '</div>';
      h += `<div class="label">Décision</div><div class="row">`;
      if (a.rule === 'PORT_IUU') h += `<button class="btn danger" type="button" data-decide="port">Refuser l'accès au port</button>`;
      if (a.verdict === 'confirmée' || a.intervened) h += `<button class="btn primary" type="button" data-decide="dpsp">Transmettre à la DPSP</button><button class="btn" type="button" data-decide="marine">Transmettre à la Marine</button>`;
      h += `<button class="btn" type="button" data-decide="classer">Classer</button></div>`;
    } else {
      h += `<div class="outcome">${esc(a.decision || 'Alerte close.')}</div>`;
    }
    h += `<div class="row"><button class="btn" type="button" data-center>Centrer la carte</button></div></div>`;
    return h;
  }

  function evidenceCard(a) {
    const ev = a.evidence;
    const ok = a.verdict === 'confirmée';
    const d = new Date(ev.time);
    const stamp = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
    return `<div class="evidence">
      <img alt="Image de vérification simulée : ${esc(ev.identity)}" src="${photo(ev, stamp)}">
      <div class="ev-body">
        <div class="verdict ${ok ? 'ok' : 'no'}">${ok ? 'Infraction confirmée' : 'Alerte infondée'} · ${esc(ev.asset)}</div>
        <div>${esc(ev.observations)}</div>
        <dl class="kv" style="margin:0">
          <dt>Procès-verbal</dt><dd>${ev.id}</dd>
          <dt>Horodatage</dt><dd>${stamp}</dd>
          <dt>Position</dt><dd>${G.fmtPos(ev.pos)}</dd>
          <dt>Identité</dt><dd>${esc(ev.identity)}</dd>
          ${ev.persons ? `<dt>Personnes</dt><dd>environ ${ev.persons}</dd>` : ''}
        </dl>
        <div class="hash">Empreinte SHA-256 : ${ev.hash || 'calcul…'}</div>
      </div></div>`;
  }

  // Image de vérification simulée (caméra optique de jour, thermique de nuit).
  function photo(ev, stamp) {
    const night = ev.night;
    const bg1 = night ? '#0b0f0d' : '#5d7f93', bg2 = night ? '#1b2420' : '#2e4d61';
    const hull = night ? '#f2f2e6' : '#1d262c', deck = night ? '#d8d8c8' : '#c9cfd2';
    const t = ev.shipType;
    let ship;
    if (t === 'pirogue') ship = `<path d="M60 170 Q200 196 340 160 L330 176 Q200 206 70 184 Z" fill="${hull}"/><path d="M70 172 Q200 190 330 162" stroke="${night ? '#fff' : '#d9a33a'}" stroke-width="5" fill="none"/>${ev.persons ? Array.from({ length: 34 }, (_, i) => `<circle cx="${92 + i * 7}" cy="${163 + Math.sin(i) * 3 - (i % 3) * 3}" r="3.2" fill="${night ? '#ffffff' : '#2a1f1a'}"/>`).join('') : ''}`;
    else if (t === 'cargo') ship = `<path d="M30 175 L370 175 L350 200 L50 200 Z" fill="${hull}"/>${[60, 110, 160, 210, 260].map((x) => `<rect x="${x}" y="150" width="44" height="25" fill="${night ? '#bfbfb0' : ['#a33', '#357', '#c83', '#2a6', '#777'][x / 50 % 5 | 0]}"/>`).join('')}<rect x="310" y="128" width="34" height="47" fill="${deck}"/>`;
    else if (t === 'yacht') ship = `<path d="M100 178 L320 172 L300 196 L120 196 Z" fill="${night ? '#fff' : '#e9ecee'}"/><path d="M150 172 L260 168 L240 150 L175 152 Z" fill="${night ? '#ddd' : '#8fa3ad'}"/><rect x="120" y="168" width="22" height="9" fill="${night ? '#fff' : '#6b5a3a'}"/>`;
    else if (t === 'frigorifique') ship = `<path d="M30 172 L370 172 L352 202 L48 202 Z" fill="${night ? '#fff' : '#f2f2f2'}"/><rect x="70" y="140" width="190" height="32" fill="${night ? '#e8e8dc' : '#dcdcdc'}"/><rect x="290" y="118" width="46" height="54" fill="${deck}"/>`;
    else ship = `<path d="M70 176 L345 176 L325 200 L88 200 Z" fill="${hull}"/><rect x="230" y="140" width="56" height="36" fill="${deck}"/><path d="M110 176 L110 120 M110 122 L200 176" stroke="${deck}" stroke-width="3"/>${t === 'chalutier' ? `<path d="M340 186 L390 214" stroke="${night ? '#fff' : '#ddd'}" stroke-width="2"/>` : ''}`;
    const txt = night ? '#ffffff' : '#ffffff';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 230">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs>
      <rect width="400" height="230" fill="url(#g)"/>
      <rect y="186" width="400" height="44" fill="${night ? '#141a17' : '#244154'}"/>
      ${ship}
      <g font-family="monospace" font-size="10" fill="${txt}">
        <text x="10" y="16">${esc(ev.asset.toUpperCase())} · ${night ? 'CAM IR' : 'CAM VIS'} · SIMULATION</text>
        <text x="10" y="30">${stamp}</text>
        <text x="10" y="222">${esc(G.fmtPos(ev.pos))}  CAP ${ev.heading}°  ${ev.sog.toFixed(1)} ND</text>
        <text x="390" y="16" text-anchor="end">${ev.id}</text>
      </g>
      <path d="M180 100 h12 M208 100 h12 M200 80 v12 M200 108 v12" stroke="${night ? '#7fff9f' : '#ffd166'}" stroke-width="1.5"/>
    </svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function stateLabel(a) {
    const m = { base: 'À la base', patrouille: 'En patrouille', transit: 'En route', surveillance: 'Sur zone', recherche: 'Recherche', retour: 'Retour', maintenance: 'En maintenance' };
    return m[a.state] || a.state;
  }

  function assetsPane() {
    const { w, P } = state;
    const typ = { usv: 'Drone de surface DIAMBAR', drone: 'Drone aérien de l\'État (intégré)', opv: 'Patrouilleur de haute mer' };
    return `<h2>Moyens</h2><p class="hint">Les drones de surface DIAMBAR vérifient les alertes. La plateforme intègre aussi les drones aériens de l'État et les patrouilleurs de la Marine.</p>
      <div class="assets">${w.assets.map((a) => {
        const used = Math.min(1, a.usedMin / 60 / a.enduranceH);
        const al = a.task ? P.alerts.find((x) => x.id === a.task.alertId) : null;
        return `<div class="asset"><div class="top"><span class="name">${esc(a.name)}</span><span class="chip ${a.task ? 'run' : ''}">${stateLabel(a)}</span></div>
          <div class="type">${typ[a.type]} · ${a.kn} nœuds · radar ${a.detectLarge} milles${a.type !== 'opv' ? ` · autonomie ${a.enduranceH} h` : ''}</div>
          ${a.type !== 'opv' ? `<div class="bar" title="Autonomie consommée"><i style="width:${Math.round((1 - used) * 100)}%"></i></div>` : ''}
          ${al ? `<div class="hint">Mission : ${al.id} ${esc(al.title)}</div><div class="row"><button class="btn" type="button" data-open="${al.id}">Ouvrir l'alerte</button> <button class="btn" type="button" data-recall="${a.id}">Rappeler</button></div>` : ''}
          ${a.maintenance ? '<div class="hint">Indisponible : arrêt technique au port de Dakar.</div>' : ''}
        </div>`;
      }).join('')}</div>`;
  }

  function shipsPane() {
    const { P } = state;
    const q = state.search.trim().toLowerCase();
    const reg = D.registry.filter((r) => !q || (r.name + r.imo).toLowerCase().includes(q));
    const iuu = D.iuuList.filter((r) => !q || (r.name + r.imo).toLowerCase().includes(q));
    let check = '';
    if (q.length >= 3) {
      const hitIuu = D.iuuList.find((r) => r.imo.toLowerCase() === q || r.name.toLowerCase() === q);
      const hitReg = D.registry.find((r) => r.imo.toLowerCase() === q || r.name.toLowerCase() === q);
      const tr = [...P.tracks.values()].find((t) => (t.imo || '').toLowerCase() === q || (t.label || '').toLowerCase().startsWith(q));
      if (hitIuu) check = `<div class="check" style="border-color:var(--crit)">Inscrit sur une liste INN : <b>${esc(hitIuu.name)}</b> (${esc(hitIuu.source)}). Refuser l'entrée au port et alerter la Marine.</div>`;
      else if (hitReg) check = `<div class="check" style="border-color:var(--ok)">Navire autorisé : <b>${esc(hitReg.name)}</b>, licence ${esc(hitReg.licence)}, au-delà de ${hitReg.minNm} milles.</div>`;
      else if (tr && tr.imo) check = `<div class="check">Navire suivi (${esc(tr.label)}), absent du registre et des listes INN.</div>`;
    }
    const tracked = [...P.tracks.values()].filter((t) => t.lastPos && state.w.t - t.lastT < 120);
    return `<h2>Contrôle des navires</h2>
      <p class="hint">Vérification automatique de l'identité (numéro OMI), des licences et des listes de navires INN. Elle répond aux défaillances relevées par l'Union européenne en 2024.</p>
      <input class="search" id="shipSearch" type="search" placeholder="Nom ou numéro OMI (ex. SIM-7700215)" value="${esc(state.search)}" aria-label="Rechercher un navire">
      ${check}
      <h3>Registre des navires autorisés (DPSP)</h3>
      <div class="tablewrap"><table><thead><tr><th>Navire</th><th>OMI</th><th>Licence</th><th>Dernier VMS</th></tr></thead><tbody>
      ${reg.map((r) => { const t = P.tracks.get('imo:' + r.imo); return `<tr><td>${esc(r.name)}</td><td class="mono">${r.imo}</td><td>${esc(r.licence)}</td><td class="mono">${t && t.lastVms ? hhmm(t.lastVms.t) : '–'}</td></tr>`; }).join('')}
      </tbody></table></div>
      <h3>Listes INN (fictives)</h3>
      <div class="tablewrap"><table><thead><tr><th>Navire</th><th>OMI</th><th>Source</th><th>Depuis</th></tr></thead><tbody>
      ${iuu.map((r) => { const seen = P.tracks.get('imo:' + r.imo); return `<tr class="${seen ? 'hit' : ''}"><td>${esc(r.name)}${seen ? ' · suivi sous le nom ' + esc(seen.label) : ''}</td><td class="mono">${r.imo}</td><td>${esc(r.source)}</td><td class="mono">${r.since}</td></tr>`; }).join('')}
      </tbody></table></div>
      <h3>Pistes actives (${tracked.length})</h3>
      <div class="tablewrap"><table><thead><tr><th>Piste</th><th>Sources</th><th>Vu</th></tr></thead><tbody>
      ${tracked.sort((a, b) => b.lastT - a.lastT).slice(0, 40).map((t) => `<tr><td>${esc(t.label)}</td><td>${[...t.sources].join(', ')}</td><td class="mono">${hhmm(t.lastT)}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  function journalPane() {
    const { P } = state;
    const k = { sat: 'Satellite', alert: 'Alerte', verif: 'Preuve', asset: 'Moyen', decision: 'Décision' };
    return `<h2>Journal</h2><div class="row" style="margin-bottom:8px"><button class="btn" type="button" id="copyJournal">Copier le journal (JSON)</button> <span class="hint" id="copyMsg"></span></div>
      ${P.journal.length ? `<ul class="journal">${P.journal.map((e) => `<li><time>${hhmm(e.t)}</time><span class="k ${e.type}">${k[e.type]}</span><span>${esc(e.text)}</span></li>`).join('')}</ul>` : '<div class="empty">Le journal se remplit dès le lancement de la simulation.</div>'}`;
  }

  function systemPane() {
    const { P, w } = state;
    const rows = Object.entries(PLATFORM.RULES).map(([k, r]) => {
      const L = P.learn[k];
      const p = L.a / (L.a + L.b);
      return `<div class="r"><span>${esc(r.label)}</span><span class="meter"><i style="width:${Math.round(p * 100)}%"></i></span><span class="n">${Math.round(p * 100)} % · ${L.n}</span></div>`;
    }).join('');
    const passes = w.pendingSat.slice().sort((a, b) => a.t - b.t).map((p) => `<li>${hhmm(p.t)} · ${esc(p.name)}${p.done ? ' · effectué' : ''}</li>`).join('');
    return `<h2>Apprentissage</h2>
      <p class="hint">Fiabilité de chaque règle, mise à jour après chaque vérification sur place (pourcentage d'alertes confirmées · nombre de vérifications). Le score des nouvelles alertes en tient compte.</p>
      <div class="learn">${rows}</div>
      <h2 style="margin-top:18px">Modèle drones-satellite</h2>
      <p>${state.srModel ? 'Activé.' : 'Désactivé.'} Des images de drones aériens, prises au moment des passages satellites, servent de vérité terrain pour entraîner la détection des pirogues, de leurs sillages et des rassemblements sur les plages.</p>
      <p class="hint">Dans la simulation, la probabilité de détecter une pirogue au radar passe de 12 % à 55 %, et celle de repérer un rassemblement sur une plage de 15 % à 90 %. Ces valeurs illustrent l'objectif de recherche, ce ne sont pas des performances mesurées.</p>
      <h2 style="margin-top:18px">Passages satellites</h2><ul class="hint">${passes}</ul>
      <h2 style="margin-top:18px">Sources de données</h2>
      <ul class="hint">
        <li>AIS : toutes les 4 min près des côtes, 12 min au large (AIS satellite).</li>
        <li>VMS : toutes les 60 min, via un partenariat avec la DPSP.</li>
        <li>Satellites : radar Sentinel-1 gratuit à heures fixes, acquisitions commerciales sur commande.</li>
        <li>Moyens : radars et caméras des drones de surface, des drones aériens et des patrouilleurs.</li>
      </ul>
      <div class="note">Démonstrateur. Navires, numéros OMI et listes fictifs. Limites maritimes calculées par tampon géométrique à partir des côtes Natural Earth : tracés indicatifs, non officiels. La ZEE indicative couvre environ ${GEO.zeeAreaKm2.toLocaleString('fr-FR')} km².</div>`;
  }

  // ---------- Actions ----------
  function openAlert(id) {
    state.tab = 'alerts'; state.selAlert = id;
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === 'alerts')));
    drawSelection(); renderPanel();
    $('#pane').scrollTop = 0;
  }

  function onPaneClick(e) {
    const t = e.target.closest('button');
    if (!t) return;
    const { w, P } = state;
    if (t.dataset.alert) { openAlert(t.dataset.alert); const a = P.alerts.find((x) => x.id === t.dataset.alert); if (a) map.panTo(a.pos); return; }
    if (t.dataset.filter) { state.filter = t.dataset.filter; renderPanel(); return; }
    if (t.hasAttribute('data-back')) { state.selAlert = null; drawSelection(); renderPanel(); return; }
    if (t.dataset.open) { openAlert(t.dataset.open); return; }
    if (t.dataset.recall) {
      const a = w.assets.find((x) => x.id === t.dataset.recall);
      if (a && a.task) {
        const al = P.alerts.find((x) => x.id === a.task.alertId);
        if (al && al.assigned === a.id && !al.verdict) { al.assigned = null; al.status = 'nouvelle'; }
        if (al && al.followedBy === a.id) al.followedBy = null;
        a.task = null; a.state = 'retour';
      }
      state.dirty = true; return;
    }
    const al = P.alerts.find((x) => x.id === state.selAlert);
    if (!al) return;
    if (t.dataset.assign) {
      const as = PLATFORM.assign(P, w, al.id, t.dataset.assign, t.dataset.purpose);
      if (as) toast(`${as.name} engagé sur ${al.id}.`);
      if (!state.playing) setPlaying(true);
      state.dirty = true; renderPanel(); return;
    }
    if (t.dataset.sat) {
      const tr = P.tracks.get(al.trackId);
      const p = SIM.orderSat(w, t.dataset.sat, (tr && tr.lastPos ? tr.lastPos : al.pos).slice());
      P.journal.unshift({ t: w.t, type: 'sat', text: `${p.name} commandée sur ${al.id}, image attendue à ${hhmm(p.t)}.` });
      toast(`${p.name} commandée, image attendue à ${hhmm(p.t)}.`, 'sat');
      state.dirty = true; return;
    }
    if (t.dataset.decide) { PLATFORM.decide(P, w, al.id, t.dataset.decide); toast(`${al.id} : ${al.decision}.`); state.dirty = true; renderPanel(); return; }
    if (t.hasAttribute('data-center')) { const tr = P.tracks.get(al.trackId); map.setView(tr && tr.lastPos ? tr.lastPos : al.pos, Math.max(map.getZoom(), 9)); }
    if (t.id === 'copyJournal') return;
  }

  function bind() {
    $('#play').addEventListener('click', () => setPlaying(!state.playing));
    $('#speeds').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      state.speed = Number(b.dataset.s);
      document.querySelectorAll('#speeds button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    });
    $('#reset').addEventListener('click', () => { setPlaying(false); reset(0); toast('Scénario remis à 18 h 30.'); });
    const jump = $('#jump');
    D.cases.forEach((c) => { const o = document.createElement('option'); o.value = c.id; o.textContent = `${hhmm(c.t)} · ${c.label}`; jump.appendChild(o); });
    jump.addEventListener('change', () => {
      const c = D.cases.find((x) => x.id === jump.value);
      jump.value = '';
      if (!c) return;
      setPlaying(false);
      reset(c.t, c);
      map.setView(c.focus, c.zoom);
      toast(`Cas : ${c.label}. Simulation avancée à ${hhmm(c.t)}.`);
      const al = state.P.alerts.filter((a) => !a.closed).sort((a, b) => b.created - a.created)[0];
      if (al) openAlert(al.id);
    });
    $('#truth').addEventListener('change', (e) => { state.truth = e.target.checked; if (!state.truth) { layers.truth.clearLayers(); layers.markers.truth.clear(); } });
    $('#srModel').addEventListener('change', (e) => { state.srModel = e.target.checked; state.w.opts.srModel = state.srModel; toast(state.srModel ? 'Modèle drones-satellite activé pour les prochains passages.' : 'Modèle drones-satellite désactivé : détection satellite brute.'); state.dirty = true; });
    document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    $('#pane').addEventListener('click', onPaneClick);
    $('#pane').addEventListener('input', (e) => { if (e.target.id === 'shipSearch') { state.search = e.target.value; renderPanel(); } });
    $('#pane').addEventListener('click', (e) => {
      if (e.target.id !== 'copyJournal') return;
      const data = JSON.stringify({ scenario: 'DIAMBAR 2027 · démonstrateur', journal: state.P.journal.map((j) => ({ heure: hhmm(j.t), type: j.type, texte: j.text })), alertes: state.P.alerts.map((a) => ({ id: a.id, regle: a.rule, navire: a.label, score: a.score, statut: a.status, preuve: a.evidence || null })) }, null, 2);
      const done = (msg) => { const m = $('#copyMsg'); if (m) m.textContent = msg; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(data).then(() => done('Copié.'), () => done('Copie refusée par le navigateur.'));
      else done('Copie indisponible.');
    });
    $('#helpBtn').addEventListener('click', () => { $('#help').hidden = false; });
    $('#helpClose').addEventListener('click', () => { $('#help').hidden = true; });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') $('#help').hidden = true;
      if (e.key === ' ' && e.target === document.body) { e.preventDefault(); setPlaying(!state.playing); }
    });
  }

  function boot() {
    initMap();
    bind();
    reset(0);
    let seen = false;
    try { seen = localStorage.getItem('diambar-help') === '1'; localStorage.setItem('diambar-help', '1'); } catch (e) { /* stockage indisponible */ }
    $('#help').hidden = seen;
    requestAnimationFrame(frame);
  }

  if (window.L) boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
