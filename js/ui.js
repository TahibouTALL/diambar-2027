// Interface opérateur : boucle de simulation, frise du temps, alertes, preuves, moyens,
// navires, journal, réglages, démo guidée.
(function () {
  const D = window.DIAMBAR_DATA;
  const P_ = window.PLATFORM;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hhmm = P_.hhmm;
  const num = (v, d) => G.fmtNum(v, d === undefined ? 1 : d);
  const dur = (m) => (m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}`);
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } } };

  const S = {
    w: null, P: null, playing: false, speed: 5, acc: 0, lastReal: 0,
    tab: 'alerts', view: 'list', sel: {}, follow: null,
    cat: 'all', status: 'open', jfilter: 'all', shipQuery: '',
    truth: false, script: true, auto: true, srModel: true,
    seenInc: 0, seenJournal: 0, busy: false, demo: null, focus: null,
    paneHtml: '', lastPanel: 0, dirty: true, pointerDown: false, lastStepAt: 0,
  };
  window.__diambar = S;

  const CAT = D.categories;
  const catOf = (inc) => CAT[inc.cat] || CAT.peche;
  const sev = (s) => (s >= 85 ? 'crit' : s >= 65 ? 'high' : s >= 45 ? 'mid' : 'low');
  const SEV_LABEL = { crit: 'Critique', high: 'Élevé', mid: 'Moyen', low: 'Faible' };
  const STATUS = {
    nouvelle: ['Nouvelle', 'new'], 'en vérification': ['Vérification en cours', 'verif'], 'en suivi': ['Suivi en cours', 'verif'],
    confirmée: ['Confirmée, suite à décider', 'conf'], infondée: ['Infondée', 'false'], 'cible non retrouvée': ['Cible non retrouvée', 'false'],
    'intervention en cours': ['Intervention en cours', 'action'], arraisonnée: ['Navire arraisonné', 'action'], contrôlée: ['Contrôle effectué', 'done'],
    'secours en route': ['Secours en route', 'action'], 'sauvetage en cours': ['Sauvetage en cours', 'action'], 'arraisonnement en cours': ['Arraisonnement en cours', 'action'],
    secourue: ['Personnes secourues', 'done'], transmise: ['Dossier transmis', 'done'],
    classée: ['Classée', 'done'], reclassée: ['Reclassée', 'done'], identifiée: ['Identifiée', 'done'],
  };
  const statusOf = (inc) => STATUS[inc.status] || [inc.status, 'new'];
  const KIND = (k) => P_.kindLabel(k);
  const ASSET_GROUPS = [
    { title: 'Drones de surface DIAMBAR', types: ['usv'] },
    { title: 'Drones aériens de l\'État', types: ['drone'] },
    { title: 'Marine nationale', types: ['opv', 'vedette'] },
    { title: 'Armée de l\'air', types: ['mpa'] },
  ];
  const STATE_LABEL = {
    base: 'À la base', prep: 'Préparation au départ', transit: 'En route', recherche: 'Recherche de la cible', surveillance: 'Sur zone, observation',
    suivi: 'Suivi de la cible', secours: 'Sauvetage en cours', arraisonnement: 'Arraisonnement', retour: 'Retour', turnaround: 'Ravitaillement',
    maintenance: 'En maintenance', patrouille: 'En patrouille',
  };

  // ---------- Simulation ----------
  function newWorld() {
    S.w = SIM.createWorld({ srModel: S.srModel });
    S.P = P_.createPlatform();
    S.P.auto = S.auto; S.P.script = S.script;
    S.seenInc = 0; S.seenJournal = 0; S.acc = 0;
    RENDER.smooth.clear(); RENDER.assetTrail.clear(); CAMERA.clear();
  }
  function stepOnce(quiet) {
    const w = S.w, P = S.P;
    SIM.step(w, 1);
    for (const r of w.reports) P_.ingest(P, w, r);
    w.reports.length = 0;
    P_.evaluate(P, w);
    P_.update(P, w);
    if (!quiet) announce();
    else S.seenInc = P.incidents.length;
  }
  function announce() {
    const P = S.P;
    for (; S.seenInc < P.incidents.length; S.seenInc++) {
      const inc = P.incidents[S.seenInc];
      toast(inc, `Nouvelle alerte ${inc.id}`, `${inc.title} : ${inc.label}`);
    }
    // Sauvetages terminés : on prévient l'opérateur
    for (const j of P.journal) {
      if (j.n <= S.seenJournal) break;
      if (j.type === 'decision' && /recueilli/.test(j.text)) { const inc = P.incidents.find((i) => i.id === j.ref); if (inc) toast(inc, 'Sauvetage terminé', j.text.replace(/^A-\d+ : /, ''), 'ok'); }
    }
    S.seenJournal = P.jseq || 0;
  }

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  async function seek(target, label) {
    if (S.busy) return;
    target = Math.max(0, Math.min(D.END_MIN, Math.round(target)));
    const wasPlaying = S.playing;
    setPlaying(false);
    if (target < S.w.t) newWorld();
    if (target === S.w.t) return;
    S.busy = true;
    const box = $('#busy'), bar = $('#busyBar');
    const from = S.w.t, span = Math.max(1, target - from);
    let shown = false;
    const t0 = performance.now();
    while (S.w.t < target) {
      const f0 = performance.now();
      while (S.w.t < target && performance.now() - f0 < 32) stepOnce(true);
      if (!shown && performance.now() - t0 > 150) { $('#busyText').textContent = label || `Calcul de la situation à ${hhmm(target)}`; box.hidden = false; shown = true; }
      bar.style.width = `${Math.round((100 * (S.w.t - from)) / span)}%`;
      await nextFrame();
    }
    S.seenJournal = S.P.jseq || 0;
    box.hidden = true; S.busy = false; S.dirty = true;
    if (wasPlaying && !S.demo) setPlaying(true);
  }

  function setPlaying(on) {
    if (on && S.w.t >= D.END_MIN) return;
    S.playing = on;
    $('#playBtn').classList.toggle('on', on);
    $('#playBtn').setAttribute('aria-label', on ? 'Pause' : 'Lecture');
  }

  // ---------- Boucle principale ----------
  function loop(now) {
    const dt = Math.min(120, now - (S.lastReal || now));
    S.lastReal = now;
    if (S.playing && !S.busy) {
      S.acc += (dt / 1000) * S.speed;
      let n = Math.floor(S.acc);
      if (n > 0) {
        S.acc -= n;
        n = Math.min(n, 40);
        while (n-- > 0 && S.w.t < D.END_MIN) stepOnce(false);
        S.lastStepAt = now;
      }
      if (S.w.t >= D.END_MIN) { setPlaying(false); S.acc = 0; toastText('Fin de la simulation : jeudi 15 octobre, 06 h 00. Le bilan est dans l\'onglet Système.'); }
    }
    const frac = S.playing ? S.acc : 1;
    const tDisp = S.w.t - 1 + frac;
    if (S.follow) followTarget(tDisp);
    RENDER.frame({ w: S.w, P: S.P, t: tDisp, frac, now, realDt: dt, sel: selView(), truth: S.truth, focus: S.focus, map: true });
    updateClock();
    drawTimeline(now);
    if (!S.busy && !S.pointerDown && (S.dirty || now - S.lastPanel > 450)) { renderPane(); S.lastPanel = now; S.dirty = false; }
    requestAnimationFrame(loop);
  }

  function selView() {
    const v = {};
    if (S.sel.alertId) { const inc = S.P.incidents.find((i) => i.id === S.sel.alertId); if (inc) v.trackId = inc.trackId; }
    if (S.sel.trackId) v.trackId = S.sel.trackId;
    if (S.sel.assetId) v.assetId = S.sel.assetId;
    return v;
  }
  function followTarget(t) {
    const map = RENDER.map;
    let pos = null;
    if (S.follow.type === 'asset') { const a = S.w.assets.find((x) => x.id === S.follow.id); if (a) pos = a.pos; }
    else { const tr = S.P.tracks.get(S.follow.id); if (tr && tr.lastPos) pos = P_.drPos(tr, t); }
    if (pos && !map._animatingZoom && !map._panAnim) map.panTo(pos, { animate: false });
  }

  // ---------- Horloge ----------
  const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  let lastClock = '';
  function updateClock() {
    const t = S.w.t;
    const d = new Date(D.START + t * 60000);
    const key = t + (S.playing ? 'p' : '');
    if (key === lastClock) return;
    lastClock = key;
    $('#clockDay').textContent = `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} octobre`;
    $('#clockTime').textContent = hhmm(t);
    const night = SIM.isNight(t);
    const sun = $('#sunState');
    sun.textContent = night ? (t >= D.moon.set || t < D.sun.rise ? 'Nuit sans lune' : 'Nuit') : 'Jour';
    sun.classList.toggle('night', night);
    renderEnv();
  }
  function renderEnv() {
    const t = S.w.t, wx = D.weather;
    const next = S.w.pendingSat.filter((p) => !p.done).sort((a, b) => a.t - b.t)[0];
    $('#envCard').innerHTML = `<span><b>Vent</b> ${wx.windDir} ${wx.windKn} nœuds</span><span><b>Houle</b> ${num(wx.swellM)} m</span><span><b>Lune</b> ${D.moon.illum} %, ${t >= D.moon.set ? 'couchée' : `se couche à ${hhmm(D.moon.set)}`}</span>${next ? `<span><b>Prochain satellite</b> ${esc(next.name)} à ${hhmm(next.t)}</span>` : ''}`;
  }

  // ---------- Frise du temps ----------
  const TL = { hoverT: null, drag: false };
  function tlGeom() {
    const cv = $('#tlCanvas');
    const r = cv.getBoundingClientRect();
    return { cv, W: r.width, H: r.height, x: (t) => 12 + (t / D.END_MIN) * (r.width - 24), t: (x) => ((x - 12) / (r.width - 24)) * D.END_MIN };
  }
  let tlCache = { key: '' };
  function drawTimeline(now) {
    const g = tlGeom();
    const { cv, W, H } = g;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); tlCache.key = ''; }
    const key = `${S.w.t}|${TL.hoverT}|${S.P.incidents.length}|${W}|${Math.floor(now / 500) % 2}`;
    if (key === tlCache.key) return;
    tlCache.key = key;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const x = g.x;
    const yBand = 14, hBand = H - 28;
    // Jour et nuit
    ctx.fillStyle = '#F4F7FA'; ctx.fillRect(x(0), yBand, x(D.END_MIN) - x(0), hBand);
    ctx.fillStyle = '#DCE3EC'; ctx.fillRect(x(0), yBand, x(D.sun.rise) - x(0), hBand);
    ctx.fillRect(x(D.sun.set), yBand, x(D.END_MIN) - x(D.sun.set), hBand);
    ctx.fillStyle = '#CDD6E2'; ctx.fillRect(x(D.moon.set), yBand, x(D.END_MIN) - x(D.moon.set), hBand);
    // Temps écoulé
    ctx.fillStyle = 'rgba(9,127,237,0.10)'; ctx.fillRect(x(0), yBand, x(S.w.t) - x(0), hBand);
    // Heures
    ctx.font = '600 11px "Barlow Condensed", "Arial Narrow", sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    for (let h = 0; h <= 24; h++) {
      const t = h * 60, X = x(t);
      ctx.fillStyle = '#9AA8B8'; ctx.fillRect(Math.round(X), yBand + hBand - (h % 3 ? 4 : 8), 1, h % 3 ? 4 : 8);
      if (h % 3 === 0 && (W > 520 || h % 6 === 0)) { ctx.fillStyle = '#5D6E84'; ctx.fillText(hhmm(t), X, yBand + hBand + 2); }
    }
    ctx.textAlign = 'left'; ctx.fillStyle = '#5D6E84';
    if (W > 600) { ctx.fillText('Lever 07:02', x(D.sun.rise) + 4, 1); ctx.fillText('Coucher 18:51', x(D.sun.set) + 4, 1); ctx.fillText('Lune couchée', x(D.moon.set) + 4, 1); }
    // Passages satellites
    D.satPasses.forEach((p) => {
      const X = x(p.t);
      ctx.fillStyle = p.sensor === 'radar' ? '#0560B8' : '#0E7490';
      ctx.beginPath(); ctx.moveTo(X, yBand + 2); ctx.lineTo(X + 4, yBand + 6); ctx.lineTo(X, yBand + 10); ctx.lineTo(X - 4, yBand + 6); ctx.closePath(); ctx.fill();
    });
    // Alertes levées
    S.P.incidents.forEach((inc) => {
      const X = x(inc.created);
      ctx.fillStyle = RENDER.SEV[sev(inc.score)]; ctx.fillRect(Math.round(X) - 1, yBand + hBand - 14, 2, 9);
    });
    // Cas du scénario
    D.cases.forEach((c, i) => {
      const X = x(c.t), Y = yBand + hBand / 2 - 3;
      const active = S.demo !== null && D.cases[S.demo.i] === c;
      ctx.beginPath(); ctx.arc(X, Y, active ? 6.5 : 5, 0, 7);
      ctx.fillStyle = CAT[c.cat].color; ctx.fill();
      ctx.lineWidth = active ? 2.5 : 1.5; ctx.strokeStyle = active ? '#F9B02A' : '#FFFFFF'; ctx.stroke();
    });
    // Curseur du temps présent
    const Xn = x(S.w.t);
    ctx.fillStyle = '#F9B02A'; ctx.fillRect(Xn - 1.5, yBand - 4, 3, hBand + 8);
    ctx.fillStyle = '#031D45'; ctx.beginPath(); ctx.moveTo(Xn - 6, yBand - 9); ctx.lineTo(Xn + 6, yBand - 9); ctx.lineTo(Xn, yBand - 2); ctx.closePath(); ctx.fill();
    if (TL.hoverT !== null) {
      const Xh = x(TL.hoverT);
      ctx.fillStyle = 'rgba(3,29,69,0.45)'; ctx.fillRect(Math.round(Xh), yBand, 1, hBand);
    }
  }
  function nearestCase(t, g) {
    let best = null, bd = 1e9;
    D.cases.forEach((c) => { const d = Math.abs(g.x(c.t) - g.x(t)); if (d < bd) { bd = d; best = c; } });
    return bd <= 8 ? best : null;
  }
  function bindTimeline() {
    const cv = $('#tlCanvas'), tip = $('#tlTip');
    const tAt = (e) => { const g = tlGeom(); const r = cv.getBoundingClientRect(); return Math.max(0, Math.min(D.END_MIN, g.t(e.clientX - r.left))); };
    cv.addEventListener('pointermove', (e) => {
      const g = tlGeom(); const t = tAt(e);
      TL.hoverT = t;
      const c = nearestCase(t, g);
      const pass = D.satPasses.find((p) => Math.abs(g.x(p.t) - g.x(t)) < 6);
      tip.hidden = false;
      tip.innerHTML = c ? `<b>${hhmm(c.t)}</b> ${esc(c.title)}` : pass ? `<b>${hhmm(pass.t)}</b> ${esc(pass.name)}, ${esc(pass.detail)}` : `<b>${hhmm(Math.round(t))}</b> Aller à cette heure`;
      const r = cv.getBoundingClientRect();
      tip.style.left = `${Math.max(4, Math.min(r.width - 220, e.clientX - r.left - 60))}px`;
    });
    cv.addEventListener('pointerleave', () => { TL.hoverT = null; tip.hidden = true; });
    cv.addEventListener('click', (e) => {
      const g = tlGeom(); const t = tAt(e);
      const c = nearestCase(t, g);
      if (c) openCase(D.cases.indexOf(c), false);
      else seek(t);
    });
  }

  // ---------- Notifications ----------
  function toast(inc, title, text, kind) {
    const box = $('#toasts');
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `toast sev-${kind === 'ok' ? 'ok' : sev(inc.score)}`;
    el.innerHTML = `<i></i><span><b>${esc(title)}</b>${esc(text)}</span>`;
    el.addEventListener('click', () => { openAlert(inc.id, true); el.remove(); });
    box.prepend(el);
    while (box.children.length > 3) box.lastChild.remove();
    setTimeout(() => el.classList.add('out'), 6500);
    setTimeout(() => el.remove(), 7000);
  }
  function toastText(text) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast sev-info'; el.innerHTML = `<i></i><span>${esc(text)}</span>`;
    box.prepend(el);
    setTimeout(() => el.remove(), 7000);
  }

  // ---------- Sélection ----------
  function openAlert(id, fly) {
    const inc = S.P.incidents.find((i) => i.id === id);
    if (!inc) return;
    S.sel = { alertId: id }; S.view = 'alert'; setTab('alerts', true);
    if (fly) { const tr = S.P.tracks.get(inc.trackId); RENDER.flyTo((tr && tr.lastPos) || inc.pos, Math.max(RENDER.map.getZoom(), 9.5)); }
    S.dirty = true;
  }
  function openTrack(id, fly) {
    const tr = S.P.tracks.get(id);
    if (!tr) return;
    const inc = S.P.incidents.filter((i) => i.trackId === id).sort((a, b) => (a.closed - b.closed) || b.score - a.score)[0];
    if (inc && !inc.closed) { openAlert(inc.id, fly); return; }
    S.sel = { trackId: id }; S.view = 'track'; setTab('ships', true);
    if (fly) RENDER.flyTo(tr.lastPos, Math.max(RENDER.map.getZoom(), 9.5));
    S.dirty = true;
  }
  function openAsset(id, fly) {
    const a = S.w.assets.find((x) => x.id === id);
    if (!a) return;
    S.sel = { assetId: id }; S.view = 'asset'; setTab('assets', true);
    if (fly) RENDER.flyTo(a.pos, Math.max(RENDER.map.getZoom(), 9));
    S.dirty = true;
  }
  function setTab(tab, keepView) {
    S.tab = tab;
    if (!keepView) { S.view = 'list'; }
    $$('.tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    S.paneHtml = ''; S.dirty = true;
    $('#pane').scrollTop = 0;
  }

  // ---------- Panneau ----------
  function renderPane() {
    const pane = $('#pane');
    let html;
    if (S.tab === 'alerts') html = S.view === 'alert' ? alertDetail() : alertList();
    else if (S.tab === 'assets') html = S.view === 'asset' ? assetDetail() : assetList();
    else if (S.tab === 'ships') html = S.view === 'track' ? trackDetail() : shipList();
    else if (S.tab === 'journal') html = journalView();
    else html = systemView();
    if (html !== S.paneHtml) {
      const focusKey = document.activeElement && pane.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
      pane.innerHTML = html; S.paneHtml = html;
      if (focusKey) { const f = pane.querySelector(`[data-focus="${focusKey}"]`); if (f) { f.focus(); if (f.setSelectionRange && f.value) f.setSelectionRange(f.value.length, f.value.length); } }
    }
    const open = S.P.incidents.filter((i) => !i.closed).length;
    const badge = $('#badgeAlerts');
    badge.hidden = !open; badge.textContent = open;
  }

  function stats() {
    const P = S.P;
    const verified = P.incidents.filter((i) => i.evidence);
    const delays = verified.filter((i) => i.delay !== undefined).map((i) => i.delay);
    return {
      open: P.incidents.filter((i) => !i.closed).length,
      verified: verified.length,
      confirmed: verified.filter((i) => i.verdict === 'confirmée').length,
      unfounded: P.incidents.filter((i) => i.verdict === 'infondée').length,
      delay: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : null,
      saved: P.stats.saved,
    };
  }

  function alertList() {
    const P = S.P, st = stats();
    const cats = ['all', 'peche', 'trafic', 'migration', 'sauvetage', 'surete', 'environnement'];
    const count = (c) => P.incidents.filter((i) => (c === 'all' || i.cat === c) && (S.status === 'all' || (S.status === 'open' ? !i.closed : i.closed))).length;
    let list = P.incidents.filter((i) => (S.cat === 'all' || i.cat === S.cat) && (S.status === 'all' || (S.status === 'open' ? !i.closed : i.closed)));
    list = list.slice().sort((a, b) => (a.closed - b.closed) || (S.status === 'open' ? b.score - a.score : b.created - a.created));
    let h = `<div class="statstrip">
      <div><b>${st.open}</b><span>en cours</span></div>
      <div><b>${st.confirmed}</b><span>infractions prouvées</span></div>
      <div><b>${st.delay === null ? '–' : dur(st.delay)}</b><span>de l'alerte à la preuve</span></div>
      <div><b>${st.saved}</b><span>personnes secourues</span></div>
    </div>
    <div class="filters">
      <div class="seg" role="group" aria-label="État des alertes">
        ${[['open', 'En cours'], ['closed', 'Traitées'], ['all', 'Toutes']].map(([k, l]) => `<button type="button" data-status="${k}" aria-pressed="${S.status === k}">${l}</button>`).join('')}
      </div>
      <div class="chips">${cats.map((c) => { const n = count(c); if (c !== 'all' && !n && S.cat !== c) return ''; return `<button type="button" class="chip" data-cat="${c}" aria-pressed="${S.cat === c}"${c !== 'all' ? ` style="--c:${CAT[c].color}"` : ''}>${c === 'all' ? 'Toutes' : CAT[c].short}<small>${n}</small></button>`; }).join('')}</div>
    </div>`;
    if (!list.length) {
      h += `<div class="empty">${P.incidents.length ? 'Aucune alerte dans cette sélection.' : `<b>Aucune alerte pour l'instant.</b><br>Lancez la lecture : la plateforme analyse en continu les positions AIS, les balises VMS et les images satellites. La première image radar arrive à 06 h 48.`}</div>`;
      return h;
    }
    h += '<div class="alist">';
    list.forEach((inc) => {
      const [stl, stc] = statusOf(inc);
      const a = inc.assigned || inc.followedBy || inc.rescueBy || inc.intervention;
      const asset = a ? S.w.assets.find((x) => x.id === a) : null;
      let sub = '';
      if (asset && asset.task && asset.task.incidentId === inc.id && !inc.closed) {
        const eta = ['transit', 'prep', 'recherche'].includes(asset.state) ? `, arrivée ${hhmm(S.w.t + P_.etaMin(asset, asset.task.estimate, S.w))}` : '';
        sub = `${esc(asset.short || asset.name)}${eta}`;
      }
      h += `<button type="button" class="al sev-${sev(inc.score)}${inc.closed ? ' closed' : ''}${S.sel.alertId === inc.id ? ' sel' : ''}" data-alert="${inc.id}">
        <span class="al-score" title="Score de risque">${inc.score}</span>
        <span class="al-main">
          <span class="al-title">${esc(inc.title)}</span>
          <span class="al-target">${esc(inc.label)}</span>
          <span class="al-meta"><span class="cat" style="--c:${catOf(inc).color}">${catOf(inc).short}</span><span>${hhmm(inc.created)}</span><span class="st st-${stc}">${stl}</span>${sub ? `<span class="al-asset">${sub}</span>` : ''}</span>
        </span>
      </button>`;
    });
    return h + '</div>';
  }

  function stepper(inc) {
    const steps = [];
    steps.push({ k: 'done', t: 'Détection', s: hhmm(inc.created) });
    const doc = inc.rule === 'PORT_IUU' && !inc.evidence;
    if (doc) steps.push({ k: 'done', t: 'Vérification', s: 'registres' });
    else if (inc.evidence) steps.push({ k: 'done', t: 'Vérification', s: esc(inc.evidence.asset) });
    else if (inc.assigned || inc.followedBy) { const a = S.w.assets.find((x) => x.id === (inc.assigned || inc.followedBy)); steps.push({ k: 'now', t: 'Vérification', s: a ? esc(a.short || a.name) : 'en cours' }); }
    else if (inc.verdict) steps.push({ k: 'done', t: 'Vérification', s: esc(inc.verdict) });
    else steps.push({ k: '', t: 'Vérification', s: 'à lancer' });
    if (inc.evidence) steps.push({ k: 'done', t: 'Preuve', s: hhmm(inc.verifiedAt) });
    else if (doc) steps.push({ k: 'done', t: 'Preuve', s: 'liste INN' });
    else steps.push({ k: '', t: 'Preuve', s: '–' });
    if (inc.closed) steps.push({ k: 'done', t: 'Suites', s: hhmm(inc.closedAt || inc.decidedAt || S.w.t) });
    else if (inc.intervention || inc.rescueBy) steps.push({ k: 'now', t: 'Suites', s: inc.rescueBy ? 'sauvetage' : 'intervention' });
    else if (inc.evidence || doc || inc.decisions) steps.push({ k: 'now', t: 'Suites', s: 'à décider' });
    else steps.push({ k: '', t: 'Suites', s: '–' });
    return `<ol class="stepper">${steps.map((x) => `<li class="${x.k}"><b>${x.t}</b><span>${x.s}</span></li>`).join('')}</ol>`;
  }

  function candidates(types, pos, n) {
    return P_.available(S.w, types).map((a) => ({ a, eta: P_.etaMin(a, pos, S.w) })).sort((x, y) => x.eta - y.eta).slice(0, n || 3);
  }
  const assetBtn = (c, purpose, cls) => `<button type="button" class="btn ${cls || ''}" data-assign="${c.a.id}" data-purpose="${purpose}"><b>${esc(c.a.short || c.a.name)}</b><small>arrivée ${hhmm(S.w.t + c.eta)}</small></button>`;
  const decBtn = (key, primary) => `<button type="button" class="btn ${primary ? 'primary' : ''}" data-decide="${key}">${P_.DECISIONS[key].label}</button>`;

  function recommendation(inc) {
    const has = (r) => inc.indicators.some((i) => i.rule === r);
    const pos = inc.pos;
    if (inc.closed) {
      const last = (inc.decisions || []).slice(-1)[0];
      return `<section class="reco done"><h3>Issue</h3><p>${esc(inc.outcome || (last && last.label) || inc.decision || statusOf(inc)[0])}</p>${inc.outcome && last ? `<p class="hint">${esc(last.label)}.</p>` : ''}</section>`;
    }
    let h = '<section class="reco"><h3>Prochaine étape</h3>';
    if (has('DISTRESS') && !inc.rescueBy) {
      const c = candidates(['opv', 'vedette', 'usv'], pos, 3);
      h += `<p class="urgent">Vies en danger : déclencher le sauvetage avec le moyen le plus proche.</p><div class="btnrow">${c.map((x, i) => assetBtn(x, 'rescue', i ? '' : 'danger')).join('') || '<span class="hint">Aucun moyen disponible.</span>'}</div>`;
    } else if (inc.rescueBy) {
      const a = S.w.assets.find((x) => x.id === inc.rescueBy);
      h += `<p>${esc(a.short || a.name)} ${a.state === 'secours' ? 'recueille les personnes.' : `fait route, arrivée vers ${hhmm(S.w.t + P_.etaMin(a, a.task ? a.task.estimate : pos, S.w))}.`}</p>`;
    } else if (inc.intervention) {
      const a = S.w.assets.find((x) => x.id === inc.intervention);
      h += `<p>${esc(a.short || a.name)} ${a.state === 'arraisonnement' ? 'procède à l\'arraisonnement.' : `fait route pour l'arraisonnement, arrivée vers ${hhmm(S.w.t + P_.etaMin(a, a.task ? a.task.estimate : pos, S.w))}.`}</p>`;
    } else if (inc.rule === 'PORT_IUU') {
      h += `<p>L'identité est établie par les registres : le navire figure sur une liste INN. L'accord sur les mesures du ressort de l'État du port impose de lui refuser l'accès.</p><div class="btnrow">${decBtn('port', true)}${decBtn('marine')}</div>`;
    } else if (has('GO_FAST') && !inc.verdict && !inc.assigned) {
      const c = candidates(['drone', 'mpa'], pos, 2);
      const told = (inc.decisions || []).some((d) => d.key === 'gendarmerie');
      h += `<p>Embarcation trop rapide pour un drone de surface. ${told ? 'La Gendarmerie est prévenue du point d\'arrivée.' : 'Prévenir la Gendarmerie du point d\'arrivée estimé'} et envoyer un drone aérien la suivre.</p><div class="btnrow">${told ? '' : decBtn('gendarmerie', true)}${c.map((x, i) => assetBtn(x, 'verification', i || !told ? '' : 'own')).join('')}</div>`;
    } else if (!inc.verdict && !inc.assigned && !inc.followedBy) {
      const c = candidates(['usv', 'drone', 'mpa'], pos, 3);
      h += `<p>Envoyer un moyen vérifier sur place. ${S.auto ? 'La plateforme le fait seule dès que le score atteint 60.' : ''}</p><div class="btnrow">${c.map((x, i) => assetBtn(x, has('GATHER') ? 'suivi' : 'verification', i ? '' : 'own')).join('') || '<span class="hint">Tous les moyens sont engagés.</span>'}</div>`;
      h += `<div class="btnrow minor">${decBtn('classer')}</div>`;
    } else if (!inc.verdict) {
      const a = S.w.assets.find((x) => x.id === (inc.assigned || inc.followedBy));
      if (a && a.task) h += `<p>${esc(a.short || a.name)} : ${STATE_LABEL[a.state].toLowerCase()}${['transit', 'prep', 'recherche'].includes(a.state) ? `, arrivée vers ${hhmm(S.w.t + P_.etaMin(a, a.task.estimate, S.w))}` : ''}.</p><div class="btnrow minor"><button type="button" class="btn" data-recall="${a.id}">Rappeler ${esc(a.short || a.name)}</button></div>`;
      if (has('GATHER')) h += `<div class="btnrow">${decBtn('gendarmerie', true)}</div>`;
    } else if (inc.verdict === 'infondée') {
      h += `<p>La vérification sur place n'a relevé aucune infraction. Classer l'alerte fait baisser la fiabilité de la règle.</p><div class="btnrow">${decBtn('classer', true)}</div>`;
    } else if (inc.verdict === 'non retrouvée') {
      const c = candidates(['usv', 'drone', 'mpa'], pos, 2);
      h += `<p>La cible n'a pas été retrouvée. Commander une image satellite sur la zone ou renvoyer un moyen.</p><div class="btnrow"><button type="button" class="btn primary" data-order="radar">Commander une image radar</button>${c.map((x) => assetBtn(x, 'verification')).join('')}</div><div class="btnrow minor">${decBtn('classer')}</div>`;
    } else {
      // Infraction confirmée : suites selon la nature de l'alerte
      const cat = inc.cat;
      const opvs = candidates(['opv', 'vedette'], pos, 2);
      if (cat === 'peche') {
        h += `<p>Infraction établie, preuve ${esc(inc.evidence ? inc.evidence.id : '')} disponible. Transmettre le dossier à la DPSP${opvs.length ? ', ou faire arraisonner le navire par la Marine' : ''}.</p><div class="btnrow">${decBtn('dpsp', true)}${opvs.map((x) => assetBtn(x, 'intervention')).join('')}</div>`;
      } else if (cat === 'trafic') {
        h += `<p>Trafic présumé : la Marine nationale et la Gendarmerie sont compétentes.</p><div class="btnrow">${decBtn('marine', true)}${decBtn('gendarmerie')}${opvs.slice(0, 1).map((x) => assetBtn(x, 'intervention')).join('')}</div>`;
      } else if (cat === 'migration') {
        h += `<p>Départ confirmé. Prévenir la Gendarmerie et garder un moyen au contact pour intervenir en cas de détresse.</p><div class="btnrow">${decBtn('gendarmerie', true)}${decBtn('marine')}</div>`;
      } else if (cat === 'surete') {
        h += `<p>Menace pour une infrastructure critique.</p><div class="btnrow">${decBtn(inc.installation ? 'operateur' : 'marine', true)}${decBtn(inc.installation ? 'marine' : 'operateur')}</div>`;
      } else if (cat === 'environnement') {
        h += `<p>Pollution établie et pollueur présumé identifié : saisir la HASSMAR pour une inspection à la prochaine escale.</p><div class="btnrow">${decBtn('hassmar', true)}${decBtn('marine')}</div>`;
      } else {
        const c = candidates(['opv', 'vedette', 'usv'], pos, 2);
        h += `<div class="btnrow">${c.map((x, i) => assetBtn(x, 'rescue', i ? '' : 'danger')).join('')}</div>`;
      }
      h += `<div class="btnrow minor">${decBtn('classer')}</div>`;
    }
    if (S.script) h += '<p class="hint auto">Décisions automatiques activées : l\'opérateur virtuel suivra le scénario de référence si vous ne décidez pas.</p>';
    return h + '</section>';
  }

  function evidenceBlock(inc) {
    const ev = inc.evidence;
    if (!ev) return '';
    const ok = ev.verdict === 'confirmée';
    return `<section class="evidence">
      <h3>Preuve ${esc(ev.id)}</h3>
      <figure><img src="${CAMERA.evidence(ev)}" alt="Image ${ev.sensor === 'IR' ? 'infrarouge' : 'visible'} prise par ${esc(ev.asset)}" width="640" height="400"><figcaption class="${ok ? 'ok' : 'no'}">${ok ? 'Infraction constatée' : 'Aucune infraction constatée'}</figcaption></figure>
      <p class="obs">${esc(ev.observations)}</p>
      <dl class="kv">
        <dt>Moyen</dt><dd>${esc(ev.asset)}, caméra ${ev.sensor === 'IR' ? 'infrarouge (nuit)' : 'visible (jour)'}</dd>
        <dt>Heure</dt><dd>${hhmm(ev.t)}, ${dur(ev.t - inc.created)} après l'alerte</dd>
        <dt>Position</dt><dd>${G.fmtPos(ev.pos)}</dd>
        <dt>Identité</dt><dd>${esc(ev.identity)}</dd>
        <dt>Intégrité</dt><dd>Image horodatée, empreinte ${esc(ev.hash)}</dd>
      </dl>
    </section>`;
  }

  function whyBlock(inc) {
    const items = inc.indicators.slice().sort((a, b) => b.score - a.score).map((i) => {
      const rel = Math.round(P_.reliability(S.P, i.rule) * 100);
      return `<li><div class="ind-head"><b>${esc(P_.RULES[i.rule].label)}</b><span class="ind-score sev-${sev(i.score)}">${i.score}</span></div>
        <ul>${i.factors.map((f) => `<li>${esc(f.txt)}${f.pts ? `<em class="${f.pts > 0 ? 'up' : 'down'}">${f.pts > 0 ? '+' : ''}${f.pts}</em>` : ''}</li>`).join('')}</ul>
        <small>Détecté à ${hhmm(i.t)}. Fiabilité de cette règle : ${rel} %.</small></li>`;
    }).join('');
    return `<section class="why"><h3>Pourquoi cette alerte</h3><ul class="inds">${items}</ul><p class="hint">Le score retient l'indice le plus fort et ajoute 4 points par indice supplémentaire.</p></section>`;
  }

  function satBlock(inc) {
    const c = inc.satChip;
    if (!c) return '';
    const what = c.slick ? 'Nappe sombre sur l\'image radar' : c.gathering ? `Rassemblement d'environ ${c.count || 'vingt'} embarcations sur la plage, détecté par le modèle entraîné sur les images de drones` : `Écho de ${c.sizeEst || '?'} m${c.wake ? ', sillage visible' : ''}`;
    return `<section class="satsec"><h3>Image satellite</h3><div class="satrow"><img src="${CAMERA.satChip(c, inc.id)}" alt="Extrait de l'image ${esc(c.pass.name)}" width="240" height="240"><p>${esc(c.pass.name)}, ${esc(c.pass.detail || '')}, ${hhmm(c.t)}.<br>${what}.</p></div></section>`;
  }

  function historyBlock(inc) {
    return `<section class="hist"><h3>Historique</h3><ol class="tline">${inc.timeline.map((e) => `<li class="k-${e.kind}"><time>${hhmm(e.t)}</time><span>${esc(e.txt)}</span></li>`).join('')}</ol></section>`;
  }

  function alertDetail() {
    const inc = S.P.incidents.find((i) => i.id === S.sel.alertId);
    if (!inc) { S.view = 'list'; return alertList(); }
    const tr = S.P.tracks.get(inc.trackId);
    const s = sev(inc.score);
    const [stl, stc] = statusOf(inc);
    let target = esc(inc.label);
    if (tr && !tr.slick && !tr.gather) {
      const bits = [];
      if (tr.kind) bits.push(KIND(tr.kind).toLowerCase());
      if (tr.lengthM || tr.sizeEst) bits.push(`${Math.round(tr.lengthM || tr.sizeEst)} m`);
      if (tr.flag) bits.push(`pavillon ${tr.flag}`);
      if (tr.imo && !String(tr.imo).startsWith('null')) bits.push(`OMI ${tr.imo}`);
      if (bits.length) target += `<span>${esc(bits.join(', '))}</span>`;
    }
    return `<div class="detail">
      <button type="button" class="back" data-back="alerts">Toutes les alertes</button>
      <header class="d-head">
        <div class="d-tags"><span class="cat" style="--c:${catOf(inc).color}">${catOf(inc).label}</span><span class="d-id">${inc.id}</span><span class="st st-${stc}">${stl}</span></div>
        <h2>${esc(inc.title)}</h2>
        <p class="d-target">${target}</p>
        <div class="score sev-${s}"><div class="score-bar"><i style="width:${inc.score}%"></i></div><b>${inc.score}</b><span>Risque ${SEV_LABEL[s].toLowerCase()}</span></div>
        <div class="d-actions"><button type="button" class="btn sm" data-center="${inc.trackId}">Centrer la carte</button>${tr ? `<button type="button" class="btn sm" data-follow="${inc.trackId}" aria-pressed="${S.follow && S.follow.id === inc.trackId}">Suivre</button>` : ''}${tr && !tr.slick && !tr.gather ? `<button type="button" class="btn sm" data-track="${inc.trackId}">Fiche du navire</button>` : ''}</div>
      </header>
      ${stepper(inc)}
      ${inc.report ? `<section class="report"><h3>Signalement reçu à ${hhmm(inc.report.t)}</h3><p>${esc(inc.report.text)}</p><p class="hint">${esc(inc.report.source)}</p></section>` : ''}
      ${inc.landing ? `<section class="landing"><h3>Point d'arrivée estimé</h3><p><b>${esc(inc.landing.place)}</b> vers ${hhmm(inc.landing.t)}, d'après le cap et la vitesse mesurés.</p></section>` : ''}
      ${inc.suspect ? `<section class="landing"><h3>Pollueur présumé</h3><p><b>${esc(inc.suspect.label)}</b>, passé sur le tracé de la nappe à ${hhmm(inc.suspect.at)} (concordance ${Math.round(inc.suspect.match * 100)} %, dérive du courant corrigée).</p></section>` : ''}
      ${recommendation(inc)}
      ${evidenceBlock(inc)}
      ${satBlock(inc)}
      ${whyBlock(inc)}
      ${historyBlock(inc)}
    </div>`;
  }

  // ---------- Moyens ----------
  function endurance(a) {
    if (a.type === 'opv') return null;
    return Math.max(0, 1 - a.usedMin / (a.enduranceH * 60));
  }
  function assetList() {
    let h = '<p class="intro">Moyens disponibles pour vérifier les alertes. Les drones de surface DIAMBAR tiennent la mer 36 heures ; les drones aériens arrivent vite mais volent 6 à 8 heures.</p>';
    ASSET_GROUPS.forEach((g) => {
      const list = S.w.assets.filter((a) => g.types.includes(a.type));
      h += `<h3 class="grp">${g.title}</h3><div class="assets">`;
      list.forEach((a) => {
        const e = endurance(a);
        const inc = a.task ? S.P.incidents.find((i) => i.id === a.task.incidentId) : null;
        const busy = !['base', 'patrouille', 'maintenance', 'turnaround'].includes(a.state);
        h += `<button type="button" class="asset ${a.type === 'usv' ? 'own' : 'state'}${S.sel.assetId === a.id ? ' sel' : ''}" data-asset="${a.id}">
          <span class="as-name"><b>${esc(a.type === 'usv' ? a.name : a.short || a.name)}</b><small>${esc(a.baseName)}</small></span>
          <span class="as-state ${busy ? 'busy' : a.state === 'maintenance' ? 'off' : ''}">${STATE_LABEL[a.state] || a.state}${inc ? ` <em>${inc.id}</em>` : ''}</span>
          ${e === null ? '<span class="as-fuel"><small>Autonomie de plusieurs semaines</small></span>' : `<span class="as-fuel"><span class="meter"><i style="width:${Math.round(e * 100)}%"></i></span><small>${Math.round(e * 100)} % d'autonomie</small></span>`}
        </button>`;
      });
      h += '</div>';
    });
    return h;
  }
  function assetDetail() {
    const a = S.w.assets.find((x) => x.id === S.sel.assetId);
    if (!a) { S.view = 'list'; return assetList(); }
    const inc = a.task ? S.P.incidents.find((i) => i.id === a.task.incidentId) : null;
    const e = endurance(a);
    const purpose = a.task ? { verification: 'vérification', suivi: 'suivi continu', rescue: 'sauvetage', intervention: 'intervention' }[a.task.purpose] : null;
    return `<div class="detail">
      <button type="button" class="back" data-back="assets">Tous les moyens</button>
      <header class="d-head">
        <div class="d-tags"><span class="cat" style="--c:${a.type === 'usv' ? 'var(--friend)' : 'var(--state)'}">${esc(D.assetTypeLabel[a.type])}</span></div>
        <h2>${esc(a.name)}</h2>
        <p class="d-target">Basé à ${esc(a.baseName)}. ${STATE_LABEL[a.state] || a.state}.</p>
        <div class="d-actions"><button type="button" class="btn sm" data-center-asset="${a.id}">Centrer la carte</button><button type="button" class="btn sm" data-follow-asset="${a.id}" aria-pressed="${S.follow && S.follow.id === a.id}">Suivre</button>${a.task ? `<button type="button" class="btn sm" data-recall="${a.id}">Rappeler</button>` : ''}</div>
      </header>
      ${inc ? `<section class="reco"><h3>Mission en cours</h3><p><button type="button" class="link" data-alert="${inc.id}">${inc.id}, ${esc(inc.title.toLowerCase())}</button> : ${purpose}. ${['transit', 'prep', 'recherche'].includes(a.state) ? `Arrivée estimée ${hhmm(S.w.t + P_.etaMin(a, a.task.estimate, S.w))}.` : ''}</p></section>` : ''}
      <dl class="kv">
        <dt>Vitesse</dt><dd>${a.kn} nœuds</dd>
        <dt>Autonomie</dt><dd>${e === null ? 'plusieurs semaines' : `${a.enduranceH} h, reste ${dur(Math.max(0, a.enduranceH * 60 - a.usedMin))}`}</dd>
        <dt>Radar</dt><dd>navires de commerce à ${a.detectLarge} milles, petites embarcations à ${a.detectSmall} milles</dd>
        <dt>Identification</dt><dd>caméra jour et nuit, à ${num(a.identify)} mille</dd>
        <dt>Délai d'appareillage</dt><dd>${a.readyMin ? `${a.readyMin} min` : 'immédiat'}</dd>
        <dt>Position</dt><dd>${G.fmtPos(a.pos)}</dd>
        <dt>Missions du jour</dt><dd>${a.missions}</dd>
      </dl>
    </div>`;
  }

  // ---------- Navires ----------
  function trackRow(tr, alertOf) {
    const inc = alertOf.get(tr.id);
    const srcs = Object.keys(tr.sources);
    const tag = (s) => (s === 'AIS' ? 'AIS' : s === 'VMS' ? 'VMS' : /Sentinel|Satellite/.test(s) ? 'SAT' : 'RADAR');
    const tags = [...new Set(srcs.map(tag))];
    const cls = inc ? 'suspect' : tr.unknown ? 'unknown' : 'neutral';
    return `<button type="button" class="ship ${cls}${S.sel.trackId === tr.id ? ' sel' : ''}" data-track="${tr.id}">
      <i class="aff"></i>
      <span class="sh-main"><b>${esc(tr.unknown && !tr.visual ? tr.contactNo || tr.label : tr.name || tr.label)}</b><small>${esc(tr.kind ? KIND(tr.kind) : tr.cls === 'small' ? 'Petite embarcation' : 'Navire')}${tr.flag ? `, ${esc(tr.flag)}` : ''}</small></span>
      <span class="sh-src">${tags.map((x) => `<em>${x}</em>`).join('')}</span>
      <span class="sh-age">${hhmm(tr.lastT)}</span>
    </button>`;
  }
  function shipList() {
    const P = S.P, t = S.w.t;
    const alertOf = new Map();
    P.incidents.forEach((i) => { if (!i.closed) alertOf.set(i.trackId, i); });
    const q = S.shipQuery.trim().toLowerCase();
    let all = [...P.tracks.values()].filter((tr) => tr.lastPos && !tr.closedTrack && !tr.slick && !tr.gather && t - tr.lastT < 360);
    const counts = { ais: all.filter((x) => x.lastAis && t - x.lastAis.t < 60).length, vms: all.filter((x) => x.lastVms && t - x.lastVms.t < 120).length, unk: all.filter((x) => x.unknown).length };
    if (q) all = all.filter((tr) => [tr.name, tr.label, tr.imo, tr.mmsi, tr.contactNo].some((v) => v && String(v).toLowerCase().includes(q)));
    const groups = [
      { title: 'Sous alerte', list: all.filter((x) => alertOf.has(x.id)) },
      { title: 'Contacts sans identité', list: all.filter((x) => x.unknown && !alertOf.has(x.id)) },
      { title: 'Pêche', list: all.filter((x) => !x.unknown && !alertOf.has(x.id) && P_.FISHING.includes(x.kind)) },
      { title: 'Commerce, passagers et servitude', list: all.filter((x) => !x.unknown && !alertOf.has(x.id) && P_.MERCHANT.includes(x.kind)) },
      { title: 'Autres', list: all.filter((x) => !x.unknown && !alertOf.has(x.id) && !P_.FISHING.includes(x.kind) && !P_.MERCHANT.includes(x.kind)) },
    ];
    let h = `<div class="statstrip three"><div><b>${counts.ais}</b><span>suivis par AIS</span></div><div><b>${counts.vms}</b><span>balises VMS actives</span></div><div><b>${counts.unk}</b><span>sans identité</span></div></div>
      <div class="search"><input type="search" placeholder="Nom, numéro OMI ou MMSI" value="${esc(S.shipQuery)}" data-focus="shipq" aria-label="Rechercher un navire"></div>`;
    groups.forEach((g) => {
      if (!g.list.length) return;
      g.list.sort((a, b) => String(a.name || a.label).localeCompare(String(b.name || b.label), 'fr'));
      h += `<h3 class="grp">${g.title} <small>${g.list.length}</small></h3><div class="ships">${g.list.slice(0, 80).map((tr) => trackRow(tr, alertOf)).join('')}</div>`;
    });
    if (S.P.coastalSeen) h += `<p class="hint">Les pirogues de pêche artisanale à moins de 12 milles de la côte sont filtrées : elles ne déclenchent ni piste ni alerte.</p>`;
    return h;
  }
  function trackDetail() {
    const tr = S.P.tracks.get(S.sel.trackId);
    if (!tr) { S.view = 'list'; return shipList(); }
    const t = S.w.t;
    const reg = tr.imo ? P_.regByImo[tr.imo] : null;
    const iuu = tr.imo ? P_.iuuByImo[tr.imo] : null;
    const incs = S.P.incidents.filter((i) => i.trackId === tr.id);
    const src = Object.entries(tr.sources).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} à ${hhmm(v)}`).join(', ');
    let regTxt = 'Non concerné';
    if (P_.FISHING.includes(tr.kind) || tr.unknown) regTxt = reg ? `Licence « ${esc(reg.licence)} »` : tr.unknown ? 'Identité inconnue' : 'Absent du registre des navires autorisés';
    if (iuu) regTxt = `Inscrit sur une liste INN : ${esc(iuu.name)}`;
    return `<div class="detail">
      <button type="button" class="back" data-back="ships">Tous les navires</button>
      <header class="d-head">
        <div class="d-tags"><span class="cat" style="--c:${tr.unknown ? 'var(--unknown-ink)' : 'var(--neutral)'}">${tr.unknown ? 'Contact sans identité' : 'Navire identifié'}</span></div>
        <h2>${esc(tr.unknown && !tr.visual ? tr.contactNo || tr.label : tr.name || tr.label)}</h2>
        <p class="d-target">${esc(tr.kind ? KIND(tr.kind) : tr.cls === 'small' ? 'Petite embarcation' : 'Navire')}${tr.lengthM || tr.sizeEst ? `, ${Math.round(tr.lengthM || tr.sizeEst)} m` : ''}${tr.flag ? `, pavillon ${esc(tr.flag)}` : ''}</p>
        <div class="d-actions"><button type="button" class="btn sm" data-center="${tr.id}">Centrer la carte</button><button type="button" class="btn sm" data-follow="${tr.id}" aria-pressed="${S.follow && S.follow.id === tr.id}">Suivre</button></div>
      </header>
      <dl class="kv">
        ${tr.imo ? `<dt>Numéro OMI</dt><dd>${esc(tr.imo)}</dd>` : ''}
        ${tr.mmsi ? `<dt>MMSI</dt><dd>${esc(tr.mmsi)}</dd>` : ''}
        <dt>Registre</dt><dd>${regTxt}</dd>
        <dt>Dernières sources</dt><dd>${src || '–'}</dd>
        <dt>Route</dt><dd>${tr.sog !== undefined ? `${num(tr.sog)} nœuds, cap ${Math.round(tr.cog || 0)}°` : 'inconnue'}</dd>
        ${tr.dest ? `<dt>Destination déclarée</dt><dd>${esc(tr.dest)}</dd>` : ''}
        <dt>Position</dt><dd>${G.fmtPos(tr.lastPos)}${t - tr.lastT > 30 ? `, il y a ${dur(t - tr.lastT)}` : ''}</dd>
        <dt>Distance à la côte</dt><dd>${num(G.coastDist(tr.lastPos), 0)} milles</dd>
      </dl>
      ${incs.length ? `<section class="reco"><h3>Alertes</h3>${incs.map((i) => `<p><button type="button" class="link" data-alert="${i.id}">${i.id}, ${esc(i.title)}</button> (${statusOf(i)[0].toLowerCase()})</p>`).join('')}</section>` : '<p class="hint">Aucune alerte sur ce navire.</p>'}
    </div>`;
  }

  // ---------- Journal ----------
  const JTYPES = { all: 'Tout', alert: 'Alertes', preuve: 'Preuves', decision: 'Décisions', asset: 'Moyens', sat: 'Satellites' };
  function journalView() {
    const list = S.P.journal.filter((j) => S.jfilter === 'all' || j.type === S.jfilter || (S.jfilter === 'alert' && j.type === 'indice')).slice(0, 250);
    let h = `<div class="filters"><div class="chips">${Object.entries(JTYPES).map(([k, l]) => `<button type="button" class="chip" data-jf="${k}" aria-pressed="${S.jfilter === k}">${l}</button>`).join('')}</div>
      <div class="copyrow"><button type="button" class="btn sm" data-copy="journal">Copier le journal et les alertes</button><span class="hint" id="copyMsg">${esc(S.copyMsg || '')}</span></div></div>`;
    if (!list.length) return h + '<div class="empty">Le journal se remplit au fil de la simulation : alertes, envois de drones, preuves, décisions et passages satellites.</div>';
    h += `<ol class="journal">${list.map((j) => `<li class="j-${j.type}"><time>${hhmm(j.t)}</time><span>${j.ref ? `<button type="button" class="link" data-alert="${j.ref}">${esc(j.text)}</button>` : esc(j.text)}</span></li>`).join('')}</ol>`;
    return h;
  }

  // ---------- Système ----------
  function systemView() {
    const st = stats();
    const learn = Object.entries(S.P.learn).filter(([, L]) => L.n > 0 || true).map(([k, L]) => ({ k, p: L.a / (L.a + L.b), n: L.n })).sort((a, b) => b.n - a.n || b.p - a.p);
    const passes = S.w.pendingSat.slice().sort((a, b) => a.t - b.t);
    const tog = (key, title, txt) => `<label class="toggle"><input type="checkbox" data-set="${key}" ${S[key] ? 'checked' : ''}><span><b>${title}</b><small>${txt}</small></span></label>`;
    return `<section class="sys"><h3>Bilan</h3>
      <div class="statstrip">
        <div><b>${S.P.incidents.length}</b><span>alertes levées</span></div>
        <div><b>${st.confirmed}</b><span>infractions prouvées</span></div>
        <div><b>${st.unfounded}</b><span>fausses alertes levées sans patrouilleur</span></div>
        <div><b>${st.saved}</b><span>personnes secourues</span></div>
      </div></section>
      <section class="sys"><h3>Réglages de la démonstration</h3>
        <div class="btnrow minor"><button type="button" class="btn" data-restart="1">Revenir au mercredi, 06 h 00</button></div>
        ${tog('script', 'Décisions automatiques', 'Un opérateur virtuel applique les décisions du scénario de référence (transmissions, interventions, sauvetages).')}
        ${tog('auto', 'Envoi automatique des drones', 'Un drone part vérifier dès que le score d\'une alerte atteint 60.')}
        ${tog('srModel', 'Modèle drones et satellites', 'Modèle de super-résolution entraîné sur les images des drones : les pirogues deviennent visibles sur les images satellites.')}
        ${tog('truth', 'Vérité terrain (mode formateur)', 'Affiche tous les navires, y compris ceux qu\'aucun capteur ne voit.')}
      </section>
      <section class="sys"><h3>Fiabilité des règles</h3>
        <p class="hint">Mise à jour après chaque vérification sur place. Le score des nouvelles alertes en tient compte.</p>
        <div class="rel">${learn.map((x) => `<div class="rel-row"><span>${esc(P_.RULES[x.k].label)}</span><span class="meter"><i style="width:${Math.round(x.p * 100)}%"></i></span><b>${Math.round(x.p * 100)} %</b><small>${x.n ? `${x.n} vérif.` : 'a priori'}</small></div>`).join('')}</div>
      </section>
      <section class="sys"><h3>Images satellites</h3>
        <ol class="passes">${passes.map((p) => `<li class="${p.done ? 'done' : ''}"><time>${hhmm(p.t)}</time><span><b>${esc(p.name)}</b>, ${esc(p.detail)}</span><em>${p.done ? 'reçue' : 'à venir'}</em></li>`).join('')}</ol>
        <button type="button" class="btn" data-order="radar-center">Commander une image radar sur la zone affichée</button>
        <p class="hint">Un satellite radar commercial livre en 50 minutes environ, de jour comme de nuit.</p>
      </section>
      <section class="sys about"><h3>À propos des données</h3>
        <p>Scénario simulé. Navires civils, numéros OMI et MMSI, licences et listes INN sont fictifs (préfixe SIM). Les moyens de l'État portent leurs noms, leurs positions et missions sont simulées.</p>
        <p>Trait de côte : OpenStreetMap. Bathymétrie et fleuves : Natural Earth. Zone économique exclusive, mer territoriale, bande des 6 milles et zone commune avec la Guinée-Bissau : tracés calculés pour la démonstration, non officiels.</p>
      </section>`;
  }

  // ---------- Événements du panneau ----------
  function bindPane() {
    const pane = $('#pane');
    pane.addEventListener('pointerdown', () => { S.pointerDown = true; });
    window.addEventListener('pointerup', () => { setTimeout(() => { S.pointerDown = false; }, 60); });
    pane.addEventListener('click', (e) => {
      const b = e.target.closest('button, [data-alert]');
      if (!b) return;
      const d = b.dataset;
      if (d.alert) { openAlert(d.alert, true); return; }
      if (d.back) { S.view = 'list'; S.sel = {}; S.dirty = true; return; }
      if (d.status) { S.status = d.status; S.dirty = true; return; }
      if (d.cat) { S.cat = d.cat; S.dirty = true; return; }
      if (d.jf) { S.jfilter = d.jf; S.dirty = true; return; }
      if (d.asset) { openAsset(d.asset, true); return; }
      if (d.track) { S.sel = { trackId: d.track }; S.view = 'track'; setTab('ships', true); const tr = S.P.tracks.get(d.track); if (tr) RENDER.flyTo(tr.lastPos, Math.max(RENDER.map.getZoom(), 9.5)); return; }
      if (d.center) { const tr = S.P.tracks.get(d.center); if (tr && tr.lastPos) RENDER.flyTo(P_.drPos(tr, S.w.t) || tr.lastPos, Math.max(RENDER.map.getZoom(), 10)); return; }
      if (d.centerAsset) { const a = S.w.assets.find((x) => x.id === d.centerAsset); if (a) RENDER.flyTo(a.pos, Math.max(RENDER.map.getZoom(), 9.5)); return; }
      if (d.follow) { S.follow = S.follow && S.follow.id === d.follow ? null : { type: 'track', id: d.follow }; S.dirty = true; return; }
      if (d.followAsset) { S.follow = S.follow && S.follow.id === d.followAsset ? null : { type: 'asset', id: d.followAsset }; S.dirty = true; return; }
      if (d.assign) {
        const inc = S.P.incidents.find((i) => i.id === S.sel.alertId);
        if (inc) { P_.assign(S.P, S.w, inc.id, d.assign, d.purpose); S.dirty = true; }
        return;
      }
      if (d.decide) { const inc = S.P.incidents.find((i) => i.id === S.sel.alertId); if (inc) { P_.decide(S.P, S.w, inc.id, d.decide); S.dirty = true; } return; }
      if (d.recall) { P_.recall(S.P, S.w, d.recall); S.dirty = true; return; }
      if (d.copy) { copyJournal(); return; }
      if (d.restart) { $('#caption').hidden = true; S.demo = null; seek(0).then(() => toastText('Scénario remis au mercredi 14 octobre, 06 h 00.')); return; }
      if (d.order) {
        const inc = S.P.incidents.find((i) => i.id === S.sel.alertId);
        const c = d.order === 'radar-center' || !inc ? RENDER.map.getCenter() : null;
        const center = c ? [c.lat, c.lng] : inc.pos;
        const p = SIM.orderSat(S.w, 'radar', center);
        toastText(`Image radar commandée : livraison prévue à ${hhmm(p.t)}.`);
        S.dirty = true;
      }
    });
    pane.addEventListener('change', (e) => {
      const k = e.target.dataset.set;
      if (!k) return;
      S[k] = e.target.checked;
      if (k === 'script') S.P.script = S.script;
      if (k === 'auto') S.P.auto = S.auto;
      if (k === 'srModel') S.w.opts.srModel = S.srModel;
      if (k === 'truth') { syncLayersPanel(); }
      S.dirty = true;
    });
    pane.addEventListener('input', (e) => {
      if (e.target.dataset.focus === 'shipq') { S.shipQuery = e.target.value; S.dirty = true; }
    });
  }

  // Copie du journal et des alertes au format JSON (pour un rapport ou une analyse)
  function copyJournal() {
    const P = S.P;
    const data = JSON.stringify({
      scenario: 'DIAMBAR 2027, démonstrateur', heure: hhmm(S.w.t),
      journal: P.journal.slice().reverse().map((j) => ({ heure: hhmm(j.t), type: j.type, texte: j.text })),
      alertes: P.incidents.map((i) => ({ id: i.id, titre: i.title, cible: i.label, score: i.score, statut: i.status, levee: hhmm(i.created), preuve: i.evidence ? { id: i.evidence.id, moyen: i.evidence.asset, heure: hhmm(i.evidence.t), constat: i.evidence.observations } : null, suites: (i.decisions || []).map((x) => x.label) })),
    }, null, 2);
    const say = (m) => { S.copyMsg = m; S.dirty = true; };
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = data; ta.className = 'copybox'; ta.setAttribute('readonly', '');
      $('.copyrow').after(ta); ta.focus(); ta.select();
      say('Texte sélectionné : copiez-le avec Ctrl+C.');
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(data).then(() => say('Copié dans le presse-papiers.'), fallback);
      else fallback();
    } catch (e) { fallback(); }
  }

  // ---------- Couches et légende ----------
  const LAYERS = [
    ['zones', 'Zones : ZEE, 12 et 6 milles, zone commune'],
    ['amp', 'Aires marines protégées'],
    ['infra', 'Câbles, mouillage, plateformes'],
    ['ais', 'Portée des stations AIS côtières'],
    ['grid', 'Graduations et échelle'],
    ['trails', 'Traces des navires'],
    ['truth', 'Vérité terrain (mode formateur)'],
    ['sat', 'Fond satellite (nécessite Internet)'],
  ];
  function syncLayersPanel() {
    $('#layersPanel').innerHTML = `<h3>Couches</h3>${LAYERS.map(([k, l]) => `<label><input type="checkbox" data-layer="${k}" ${(k === 'truth' ? S.truth : RENDER.opts[k]) ? 'checked' : ''}>${l}</label>`).join('')}<p class="hint" id="satNote" hidden>Le fond satellite n'a pas pu être chargé ici : la carte marine reste affichée.</p>`;
  }
  function bindLayers() {
    const btn = $('#layersBtn'), panel = $('#layersPanel');
    syncLayersPanel();
    btn.addEventListener('click', () => { panel.hidden = !panel.hidden; btn.setAttribute('aria-expanded', String(!panel.hidden)); });
    panel.addEventListener('change', (e) => {
      const k = e.target.dataset.layer;
      if (!k) return;
      if (k === 'truth') { S.truth = e.target.checked; S.dirty = true; return; }
      if (k === 'trails') { RENDER.opts.trails = e.target.checked; return; }
      RENDER.setOpt(k, e.target.checked);
      if (k === 'sat' && e.target.checked) {
        let failed = false;
        RENDER.layers.sat.once('tileerror', () => {
          if (failed) return; failed = true;
          RENDER.setOpt('sat', false); e.target.checked = false; $('#satNote').hidden = false;
        });
      }
    });
    document.addEventListener('click', (e) => { if (!panel.hidden && !e.target.closest('.map-tools')) { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
  }

  function legendSwatch(kind, pal, L, rot) {
    const cv = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    cv.width = 34 * dpr; cv.height = 22 * dpr;
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr); ctx.translate(17, 11); ctx.rotate(rot === undefined ? Math.PI / 2 : rot);
    if (kind === 'drone') SYM.drone(ctx, 24, Object.assign({ lw: 1 }, pal));
    else SYM.vessel(ctx, kind, L, Object.assign({ lw: 1 }, pal), L >= 20 ? 1 : 0, 3);
    return cv.toDataURL();
  }
  function buildLegend() {
    const P = RENDER.PAL;
    const colors = [
      [P.friend.hull, P.friend.line, 'Drone de surface DIAMBAR'],
      [P.state.hull, P.state.line, 'Moyen de l\'État'],
      [P.neutral.hull, P.neutral.line, 'Navire identifié, en règle'],
      [P.unknown.hull, P.unknown.line, 'Contact sans identité'],
      [P.suspect.hull, P.suspect.line, 'Navire sous alerte'],
    ];
    const g = { hull: '#D7DEE6', line: '#4B5563', house: '#F5F7FA', dark: '#9CA3AF', light: '#EEF1F5' };
    const shapes = [['container', 32, 'Porte-conteneurs'], ['tanker', 32, 'Pétrolier'], ['trawler', 26, 'Chalutier'], ['pirogue', 26, 'Pirogue'], ['opv', 32, 'Patrouilleur'], ['drone', 0, 'Drone aérien']];
    const el = $('#legend');
    el.innerHTML = `<button type="button" class="legend-btn" aria-expanded="false">Légende</button>
      <div class="legend-body" hidden>
        <h4>La couleur dit le statut</h4>
        ${colors.map(([f, l, txt]) => `<div class="lg-row"><span class="lg-sw" style="background:${f};border-color:${l}"></span>${txt}</div>`).join('')}
        <h4>La forme dit le type</h4>
        <div class="lg-shapes">${shapes.map(([k, L, txt]) => `<div class="lg-row"><img src="${legendSwatch(k, g, L)}" alt="" width="34" height="22">${txt}</div>`).join('')}</div>
        <h4>Zones</h4>
        <div class="lg-row"><span class="lg-line" style="border-top:2px dashed #1A3768"></span>Limite de la ZEE</div>
        <div class="lg-row"><span class="lg-area" style="background:repeating-linear-gradient(-45deg,rgba(196,138,0,.45) 0 1px,transparent 1px 5px);border:1px dotted #B27A00"></span>Bande des 6 milles</div>
        <div class="lg-row"><span class="lg-area round" style="background:rgba(91,170,116,.25);border:1px solid #2F7D4A"></span>Aire marine protégée</div>
        <div class="lg-row"><span class="lg-line" style="border-top:2px dotted #7B4FB8"></span>Câble sous-marin</div>
      </div>`;
    const b = $('.legend-btn', el), body = $('.legend-body', el);
    b.addEventListener('click', () => { body.hidden = !body.hidden; b.setAttribute('aria-expanded', String(!body.hidden)); });
    if (window.innerWidth > 1500 && window.innerHeight > 860) { body.hidden = false; b.setAttribute('aria-expanded', 'true'); }
  }

  // ---------- Carte : survol et clic ----------
  function bindMap() {
    const map = RENDER.map, card = $('#hovercard');
    map.on('mousemove', (e) => {
      const h = RENDER.hitTest(e.layerPoint);
      map.getContainer().style.cursor = h ? 'pointer' : '';
      if (!h) { card.hidden = true; return; }
      card.hidden = false;
      card.innerHTML = hoverText(h);
      const pt = e.containerPoint;
      card.style.left = `${Math.min(pt.x + 16, map.getSize().x - 260)}px`;
      card.style.top = `${Math.max(8, pt.y - 10)}px`;
    });
    map.on('mouseout', () => { card.hidden = true; });
    map.on('click', (e) => {
      const h = RENDER.hitTest(e.layerPoint);
      if (!h) return;
      if (h.type === 'track') {
        const inc = S.P.incidents.filter((i) => i.trackId === h.id).sort((a, b) => (a.closed - b.closed) || b.created - a.created)[0];
        if (inc && (!inc.closed || h.id.startsWith('slick:') || h.id.startsWith('gather:'))) openAlert(inc.id, false); else openTrack(h.id, false);
      } else if (h.type === 'asset') openAsset(h.id, false);
    });
    map.on('dragstart', () => { if (S.follow) { S.follow = null; S.dirty = true; } });
  }
  function hoverText(h) {
    if (h.type === 'asset') {
      const a = S.w.assets.find((x) => x.id === h.id);
      return `<b>${esc(a.name)}</b><span>${esc(D.assetTypeLabel[a.type])}</span><span>${STATE_LABEL[a.state] || a.state}${a.task ? `, ${a.task.incidentId}` : ''}</span>`;
    }
    if (h.type === 'install') {
      const i = D.installations.find((x) => x.id === h.id);
      return `<b>${esc(i.name)}</b><span>${esc(i.field)}, zone de sécurité de ${i.safetyM} m</span>`;
    }
    const tr = S.P.tracks.get(h.id);
    if (!tr) return '';
    const inc = S.P.incidents.find((i) => i.trackId === tr.id && !i.closed);
    const srcs = Object.entries(tr.sources).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k} ${hhmm(v)}`).join(', ');
    return `<b>${esc(tr.unknown && !tr.visual ? (tr.contactNo || tr.label) : tr.name || tr.label)}</b><span>${esc(tr.slick ? 'Nappe d\'hydrocarbures' : tr.gather ? 'Plage de ' + tr.beach : tr.kind ? KIND(tr.kind) : 'Contact sans identité')}${tr.sog !== undefined && !tr.slick ? `, ${num(tr.sog)} nœuds` : ''}</span><span>${esc(srcs)}</span>${inc ? `<span class="hv-alert sev-${sev(inc.score)}">${inc.id}, ${esc(inc.title)}</span>` : ''}`;
  }

  // ---------- Cas et démo guidée ----------
  function incidentForCase(c) {
    const P = S.P;
    const of = P.incidents.filter((i) => i.truthId === c.truth);
    if (c.id === 'distress') return of.find((i) => i.indicators.some((x) => x.rule === 'DISTRESS')) || of[0];
    return of.sort((a, b) => (a.closed - b.closed) || b.score - a.score)[0];
  }
  async function openCase(i, demo) {
    const c = D.cases[i];
    if (!c) return;
    closeMenus();
    S.demo = demo ? { i } : null;
    S.follow = null;
    await seek(c.t, `Préparation du cas : ${c.title}`);
    setPlaying(false);
    const inc = incidentForCase(c);
    const tr = inc ? S.P.tracks.get(inc.trackId) : null;
    const pos = tr && tr.lastPos ? P_.drPos(tr, S.w.t) || tr.lastPos : inc ? inc.pos : null;
    if (inc) { S.sel = { alertId: inc.id }; S.view = 'alert'; setTab('alerts', true); }
    showCaption(c, i, demo);
    // Sur grand écran, la fiche du cas couvre le bas à gauche : le point commenté est placé en haut à droite
    const overlay = getComputedStyle($('#caption')).position === 'absolute';
    if (pos) { RENDER.flyTo(pos, c.zoom, overlay ? { at: [0.62, 0.36] } : null); S.focus = pos; setTimeout(() => { S.focus = null; }, 5200); }
    S.dirty = true;
  }
  function showCaption(c, i, demo) {
    const cap = $('#caption');
    cap.hidden = false;
    cap.innerHTML = `<div class="cap-top"><span class="cat" style="--c:${CAT[c.cat].color}">${CAT[c.cat].label}</span><span class="cap-step">${demo ? `Cas ${i + 1} sur ${D.cases.length}` : hhmm(c.t)}</span><button type="button" class="close" data-cap="close" aria-label="Fermer">×</button></div>
      <h3>${esc(c.title)}</h3><p>${esc(c.text)}</p>
      <div class="cap-actions">${demo ? `<button type="button" class="btn" data-cap="prev" ${i === 0 ? 'disabled' : ''}>Précédent</button>` : ''}<button type="button" class="btn" data-cap="play">Voir la suite en direct</button>${demo ? `<button type="button" class="btn primary" data-cap="next">${i === D.cases.length - 1 ? 'Terminer' : 'Cas suivant'}</button>` : ''}</div>`;
  }
  function bindCaption() {
    $('#caption').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cap]');
      if (!b) return;
      const k = b.dataset.cap;
      if (k === 'close') { $('#caption').hidden = true; S.demo = null; }
      if (k === 'play') { $('#caption').hidden = true; S.demo = null; S.speed = 1; syncSpeeds(); setPlaying(true); }
      if (k === 'next') {
        const n = S.demo ? S.demo.i + 1 : 0;
        if (n >= D.cases.length) { $('#caption').hidden = true; S.demo = null; toastText('Fin de la démo guidée. Continuez librement : la frise du bas permet de revenir à n\'importe quel moment.'); }
        else openCase(n, true);
      }
      if (k === 'prev' && S.demo) openCase(Math.max(0, S.demo.i - 1), true);
    });
  }
  function buildCasesMenu() {
    const menu = $('#casesMenu');
    menu.innerHTML = `<p class="menu-head">Seize situations du scénario, dans l'ordre de la journée</p>${D.cases.map((c, i) => `<button type="button" data-case="${i}"><i style="--c:${CAT[c.cat].color}"></i><time>${hhmm(c.t)}</time><span>${esc(c.title)}</span></button>`).join('')}`;
    menu.addEventListener('click', (e) => { const b = e.target.closest('[data-case]'); if (b) openCase(+b.dataset.case, false); });
    $('#casesBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden; $('#casesBtn').setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('.menu-wrap')) closeMenus(); });
  }
  function closeMenus() { $('#casesMenu').hidden = true; $('#casesBtn').setAttribute('aria-expanded', 'false'); }

  // ---------- Commandes ----------
  function syncSpeeds() { $$('#speeds button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.speed === S.speed))); }
  function bindControls() {
    $('#playBtn').addEventListener('click', () => { if (S.w.t >= D.END_MIN) { seek(0).then(() => setPlaying(true)); return; } setPlaying(!S.playing); });
    $$('#speeds button').forEach((b) => b.addEventListener('click', () => { S.speed = +b.dataset.speed; syncSpeeds(); }));
    $$('.tabs [role=tab]').forEach((b) => b.addEventListener('click', () => { S.sel = {}; setTab(b.dataset.tab); }));
    $('#demoBtn').addEventListener('click', () => openCase(0, true));
    $('#helpBtn').addEventListener('click', () => { $('#help').hidden = false; });
    $('#helpClose').addEventListener('click', () => { $('#help').hidden = true; });
    $('#help').addEventListener('click', (e) => { if (e.target.id === 'help') $('#help').hidden = true; });
    $('#wDemo').addEventListener('click', () => { closeWelcome(); openCase(0, true); });
    $('#wFree').addEventListener('click', () => { closeWelcome(); setPlaying(true); });
    document.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea, select')) return;
      if (e.key === ' ') { e.preventDefault(); setPlaying(!S.playing); }
      if (e.key === 'Escape') { $('#help').hidden = true; closeMenus(); if (!$('#welcome').hidden) closeWelcome(); }
      if (e.key === 'ArrowRight' && S.demo) openCase(Math.min(D.cases.length - 1, S.demo.i + 1), true);
      if (e.key === 'ArrowLeft' && S.demo) openCase(Math.max(0, S.demo.i - 1), true);
    });
  }
  function closeWelcome() { $('#welcome').hidden = true; store.set('diambar-2027-vu', '1'); }

  // ---------- Démarrage ----------
  async function start() {
    RENDER.init($('#map'));
    newWorld();
    while (S.w.t < 0) stepOnce(true);
    S.seenJournal = S.P.jseq || 0;
    bindTimeline(); bindPane(); bindLayers(); buildLegend(); bindMap(); bindCaption(); buildCasesMenu(); bindControls(); syncSpeeds();
    renderEnv();
    requestAnimationFrame(loop);
    if (!store.get('diambar-2027-vu')) $('#welcome').hidden = false;
    window.addEventListener('resize', () => { tlCache.key = ''; RENDER.drawFrame(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
