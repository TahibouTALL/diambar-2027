// Images des preuves : vue de la caméra du drone (jour : visible, nuit : infrarouge)
// et extraits d'images satellites (radar ou optique). Dessins procéduraux, reproductibles.
(function () {
  const cache = new Map();
  const W = 640, H = 400;

  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const seedOf = (s) => Array.from(String(s)).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

  // Palettes naturelles des navires vus de près
  function natural(kind, ir, colors) {
    if (ir) {
      return { hull: '#8C8C8C', line: '#3A3A3A', house: '#C8C8C8', dark: '#6A6A6A', light: '#A8A8A8', ir: true, colors: ['#9A9A9A', '#9A9A9A', '#9A9A9A'] };
    }
    const base = {
      container: ['#1E3A5F', '#F0F0EC'], bulk: ['#7A2E2A', '#E8E4DA'], tanker: ['#5A1F1F', '#F2EFE8'], cargo: ['#26476B', '#F2F2EE'], reefer: ['#F4F4F0', '#FFFFFF'],
      ferry: ['#F5F5F2', '#FFFFFF'], shuttle: ['#F5F5F2', '#FFFFFF'], supply: ['#C2462E', '#F8F8F4'], tug: ['#1F2F45', '#F2F2EE'],
      trawler: ['#2D5F8A', '#F4F4F0'], longliner: ['#3A6E54', '#F4F4F0'], seiner: ['#9C3A2E', '#F4F4F0'], poleline: ['#2D5F8A', '#F4F4F0'],
      yacht: ['#FAFAFA', '#E6EEF5'], pirogue: ['#F3E9D6', '#F3E9D6'], gofast: ['#E9EDF0', '#3C4650'], opv: ['#8C99A3', '#C9D1D7'], vedette: ['#8C99A3', '#D5DBE0'], usv: ['#0A6CD1', '#F2F7FC'],
    }[kind] || ['#4B5563', '#F3F4F6'];
    return { hull: base[0], line: '#1B2430', house: base[1], dark: shade(base[0], -0.25), light: shade(base[0], 0.3), colors: colors || ['#C0392B', '#F1C40F', '#27AE60'] };
  }
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const f = (c) => Math.max(0, Math.min(255, Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k)));
    r = f(r); g = f(g); b = f(b);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  // ---------- Fond : mer, plage ----------
  function sea(ctx, R, ir) {
    const g = ctx.createLinearGradient(0, 0, W * 0.3, H);
    if (ir) { g.addColorStop(0, '#333'); g.addColorStop(1, '#1E1E1E'); } else { g.addColorStop(0, '#1C5674'); g.addColorStop(0.5, '#256C8C'); g.addColorStop(1, '#2E7E9E'); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // Houle du nord-ouest : longues bandes alternées
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-0.55);
    for (let k = -14; k < 14; k++) {
      const y = k * 34 + R() * 8;
      ctx.fillStyle = ir ? `rgba(255,255,255,${0.012 + R() * 0.02})` : `rgba(160,215,235,${0.035 + R() * 0.05})`;
      ctx.beginPath(); ctx.moveTo(-W, y);
      for (let x = -W; x <= W; x += 40) ctx.lineTo(x, y + Math.sin(x / 90 + k) * 5);
      ctx.lineTo(W, y + 14); ctx.lineTo(-W, y + 14); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    if (!ir) {
      const glint = ctx.createRadialGradient(W * 0.78, H * 0.18, 10, W * 0.78, H * 0.18, W * 0.45);
      glint.addColorStop(0, 'rgba(255,255,240,0.22)'); glint.addColorStop(1, 'rgba(255,255,240,0)');
      ctx.fillStyle = glint; ctx.fillRect(0, 0, W, H);
    }
    // Vagues : petits traits clairs orientés par la houle
    for (let i = 0; i < 900; i++) {
      const x = R() * W, y = R() * H, len = 4 + R() * 14 * (0.5 + y / H);
      ctx.strokeStyle = ir ? `rgba(255,255,255,${0.02 + R() * 0.05})` : `rgba(210,232,245,${0.05 + R() * 0.12})`;
      ctx.lineWidth = 0.6 + R() * (y / H) * 1.2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + len / 2, y - 1.5, x + len, y + 0.5); ctx.stroke();
    }
  }
  function beach(ctx, R, ir, side) {
    // La plage occupe la gauche de l'image, l'écume dessine le rivage
    const pts = [];
    for (let y = -10; y <= H + 10; y += 20) pts.push([side + Math.sin(y / 47) * 18 + R() * 6, y]);
    ctx.fillStyle = ir ? '#5A5A5A' : '#D8C49C';
    ctx.beginPath(); ctx.moveTo(-10, -10); pts.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.lineTo(-10, H + 10); ctx.closePath(); ctx.fill();
    for (let i = 0; i < 500; i++) { ctx.fillStyle = ir ? `rgba(255,255,255,${R() * 0.05})` : `rgba(120,95,60,${R() * 0.12})`; ctx.fillRect(R() * side, R() * H, 1.5, 1.5); }
    ctx.strokeStyle = ir ? 'rgba(220,220,220,0.5)' : 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3;
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + 6, y) : ctx.moveTo(x + 6, y))); ctx.stroke();
    ctx.lineWidth = 1.2; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + 16, y + 4) : ctx.moveTo(x + 16, y))); ctx.stroke();
  }

  // Sillage : écume en V derrière la poupe
  function wake(ctx, L, B, sog, ir, R) {
    const len = L * (0.7 + Math.min(1.6, sog / 9));
    const c = ir ? '215,215,215' : '255,255,255';
    // Ondes divergentes (angle de Kelvin, environ 19°)
    const ang = 0.34;
    ctx.lineWidth = 1.4;
    for (const side of [-1, 1]) {
      const g = ctx.createLinearGradient(0, L / 2, 0, L / 2 + len * 1.2);
      g.addColorStop(0, `rgba(${c},${ir ? 0.18 : 0.32})`); g.addColorStop(1, `rgba(${c},0)`);
      ctx.strokeStyle = g;
      ctx.beginPath(); ctx.moveTo(side * B * 0.45, -L * 0.3); ctx.lineTo(side * (B * 0.45 + Math.tan(ang) * (len * 1.2 + L * 0.8)), L / 2 + len * 1.2); ctx.stroke();
    }
    // Écume turbulente dans l'axe
    const g = ctx.createLinearGradient(0, L / 2, 0, L / 2 + len);
    g.addColorStop(0, `rgba(${c},${ir ? 0.35 : 0.62})`); g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-B * 0.38, L / 2); ctx.lineTo(B * 0.38, L / 2);
    for (let y = 0; y <= len; y += len / 8) ctx.lineTo(B * (0.38 + (y / len) * 0.5) + (R() - 0.5) * B * 0.25, L / 2 + y);
    for (let y = len; y >= 0; y -= len / 8) ctx.lineTo(-B * (0.38 + (y / len) * 0.5) + (R() - 0.5) * B * 0.25, L / 2 + y);
    ctx.closePath(); ctx.fill();
    // Vague d'étrave
    ctx.strokeStyle = `rgba(${c},${ir ? 0.25 : 0.55})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-B * 0.62, -L * 0.36); ctx.quadraticCurveTo(0, -L * 0.58, B * 0.62, -L * 0.36); ctx.stroke();
  }

  // Personnes à bord : points serrés (vêtements de couleur le jour, points chauds la nuit)
  function people(ctx, R, n, L, B, ir) {
    const cols = ['#E74C3C', '#F1C40F', '#2E86C1', '#FFFFFF', '#27AE60', '#8E44AD', '#E67E22', '#1ABC9C'];
    for (let i = 0; i < n; i++) {
      const y = -L * 0.4 + R() * L * 0.78;
      const half = (B / 2) * Math.sin(Math.PI * (0.5 + y / L)) * 0.82;
      const x = (R() * 2 - 1) * half;
      ctx.fillStyle = ir ? `rgba(255,255,255,${0.75 + R() * 0.25})` : cols[Math.floor(R() * cols.length)];
      ctx.beginPath(); ctx.arc(x, y, Math.max(1.4, B * 0.07), 0, 7); ctx.fill();
    }
  }

  function drawShip(ctx, R, kind, L, pal, opts) {
    const B = L * ((SYM.SPEC[kind] || SYM.SPEC.cargo).beam);
    if (opts.wake) wake(ctx, L, B, opts.sog, opts.ir, R);
    if (opts.trawl) {
      ctx.strokeStyle = opts.ir ? 'rgba(200,200,200,0.6)' : 'rgba(30,30,30,0.55)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-B * 0.3, L / 2); ctx.lineTo(-B * 1.5, L * 1.6); ctx.moveTo(B * 0.3, L / 2); ctx.lineTo(B * 1.5, L * 1.6); ctx.stroke();
    }
    // Ombre portée du navire sur l'eau
    ctx.save(); ctx.translate(6, 8); ctx.globalAlpha = opts.ir ? 0.25 : 0.3; SYM.vessel(ctx, kind, L, { hull: '#000', line: 'rgba(0,0,0,0)', house: '#000', dark: '#000', light: '#000' }, 0, 1); ctx.restore();
    SYM.vessel(ctx, kind, L, Object.assign({ lw: 1.4 }, pal), 1, opts.seed || 3);
    if (opts.ir) {
      // Points chauds : machine et cheminée
      const g = ctx.createRadialGradient(0, L * 0.3, 0, 0, L * 0.3, B * 0.9);
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, L * 0.3, B * 0.9, 0, 7); ctx.fill();
    }
    if (opts.persons) people(ctx, R, Math.min(opts.persons, 160), L, B, opts.ir);
    return B;
  }

  // ---------- HUD de la caméra ----------
  function hud(ctx, ev) {
    const white = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = white; ctx.lineWidth = 2;
    const c = 26, m = 14;
    [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]].forEach(([x, y, sx, sy]) => {
      ctx.beginPath(); ctx.moveTo(x, y + sy * c); ctx.lineTo(x, y); ctx.lineTo(x + sx * c, y); ctx.stroke();
    });
    ctx.lineWidth = 1.2;
    const cx = W / 2, cy = H / 2;
    ctx.beginPath(); ctx.moveTo(cx - 34, cy); ctx.lineTo(cx - 12, cy); ctx.moveTo(cx + 12, cy); ctx.lineTo(cx + 34, cy); ctx.moveTo(cx, cy - 34); ctx.lineTo(cx, cy - 12); ctx.moveTo(cx, cy + 12); ctx.lineTo(cx, cy + 34); ctx.stroke();
    ctx.font = '600 19px "Barlow Condensed", "Arial Narrow", sans-serif';
    ctx.textBaseline = 'top';
    const shadowText = (txt, x, y, align) => {
      ctx.textAlign = align || 'left';
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText(txt, x + 1, y + 1);
      ctx.fillStyle = white; ctx.fillText(txt, x, y);
    };
    const d = new Date(ev.time);
    const pad = (n) => String(n).padStart(2, '0');
    shadowText(`${ev.asset.toUpperCase()}  ${ev.sensor === 'IR' ? 'IR' : 'EO'}`, 26, 24);
    shadowText(`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad((ev.id.length * 7) % 60)} UTC`, W - 26, 24, 'right');
    shadowText(ev.assetType === 'drone' || ev.assetType === 'mpa' ? `ALT ${ev.alt.toLocaleString('fr-FR')} m` : 'MÂT 4 m', 26, 48);
    ctx.textBaseline = 'bottom';
    shadowText(G.fmtPos(ev.pos), 26, H - 22);
    if (ev.scene !== 'slick') shadowText(`CAP ${String(ev.heading).padStart(3, '0')}°  ${String(ev.sog.toFixed(1)).replace('.', ',')} ND`, W - 26, H - 22, 'right');
    ctx.fillStyle = '#E5484D'; ctx.beginPath(); ctx.arc(W / 2 - 26, 35, 6, 0, 7); ctx.fill();
    ctx.textBaseline = 'top'; shadowText('ENR', W / 2 - 15, 24);
  }

  function grain(ctx, R, amount) {
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (R() - 0.5) * amount; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    ctx.putImageData(img, 0, 0);
  }
  function irTone(ctx) {
    // Image thermique : niveaux de gris, blanc = chaud
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = d[i] * 0.33 + d[i + 1] * 0.45 + d[i + 2] * 0.22; d[i] = v; d[i + 1] = v; d[i + 2] = v; }
    ctx.putImageData(img, 0, 0);
  }
  function vignette(ctx) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.38)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  // ---------- Image de preuve ----------
  function evidence(ev) {
    const key = 'ev:' + ev.id;
    if (cache.has(key)) return cache.get(key);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const R = rng(seedOf(ev.id));
    const ir = ev.sensor === 'IR';
    sea(ctx, R, ir);
    const kind = SYM.SPEC[ev.shipKind] ? ev.shipKind : 'cargo';
    // Angle de vue : la caméra regarde la cible en biais (perspective écrasée)
    const rot = ((ev.heading - 35) * Math.PI) / 180;
    ctx.save();
    if (ev.scene === 'slick') {
      ctx.translate(W / 2, H / 2); ctx.scale(1, 0.7); ctx.rotate(-0.5);
      for (let k = 0; k < 4; k++) {
        ctx.beginPath(); ctx.moveTo(-W, -20 + k * 12);
        for (let x = -W; x <= W; x += 30) ctx.lineTo(x, Math.sin(x / 80 + k) * 18 + k * 10 - 15);
        ctx.lineWidth = 46 - k * 9;
        ctx.strokeStyle = ir ? `rgba(15,15,15,${0.35 + k * 0.08})` : ['rgba(40,45,48,0.55)', 'rgba(110,80,140,0.35)', 'rgba(60,120,110,0.3)', 'rgba(25,25,28,0.6)'][k];
        ctx.stroke();
      }
    } else if (ev.scene === 'gather' || ev.scene === 'landed') {
      ctx.restore(); ctx.save();
      beach(ctx, R, ir, W * 0.48);
      if (ev.scene === 'gather') {
        for (let i = 0; i < 9; i++) {
          ctx.save(); ctx.translate(W * 0.12 + (i % 3) * 70 + R() * 10, 70 + Math.floor(i / 3) * 110 + R() * 14); ctx.rotate(-1.35 + R() * 0.2);
          SYM.vessel(ctx, 'pirogue', 120, natural('pirogue', ir, [['#C0392B', '#F1C40F', '#27AE60'], ['#2471A3', '#F4D03F', '#C0392B'], ['#1E8449', '#E67E22', '#2E86C1']][i % 3]), 1, i);
          ctx.restore();
        }
        for (let i = 0; i < 180; i++) { ctx.fillStyle = ir ? 'rgba(255,255,255,0.9)' : ['#E74C3C', '#F1C40F', '#2E86C1', '#FFFFFF', '#27AE60'][i % 5]; ctx.beginPath(); ctx.arc(30 + R() * W * 0.42, 30 + R() * (H - 60), 2, 0, 7); ctx.fill(); }
        for (let i = 0; i < 20; i++) { ctx.fillStyle = ir ? '#bbb' : '#2C7FB8'; ctx.fillRect(40 + R() * 220, 40 + R() * 320, 5, 7); }
      } else {
        ctx.translate(W * 0.36, H * 0.52); ctx.rotate(-1.2);
        drawShip(ctx, R, 'gofast', 150, natural('gofast', ir), { ir, seed: 4 });
        ctx.restore(); ctx.save();
        for (let i = 0; i < 2; i++) { ctx.fillStyle = ir ? '#d8d8d8' : '#3E4A3C'; ctx.fillRect(60 + i * 90, 70 + i * 30, 40, 70); ctx.fillStyle = ir ? '#fff' : '#9DB3C2'; ctx.fillRect(64 + i * 90, 78 + i * 30, 32, 14); }
        for (let i = 0; i < 14; i++) { ctx.fillStyle = ir ? '#fff' : '#F2E3C4'; ctx.fillRect(110 + R() * 140, 130 + R() * 160, 9, 6); }
        for (let i = 0; i < 8; i++) { ctx.fillStyle = ir ? '#fff' : '#1F2937'; ctx.beginPath(); ctx.arc(100 + R() * 170, 120 + R() * 180, 3, 0, 7); ctx.fill(); }
      }
    } else if (ev.scene === 'transship') {
      ctx.translate(W / 2, H / 2); ctx.scale(1, 0.72); ctx.rotate(rot);
      ctx.save(); ctx.translate(-34, 0); drawShip(ctx, R, 'reefer', 250, natural('reefer', ir), { ir, seed: 9 }); ctx.restore();
      ctx.save(); ctx.translate(30, 18); drawShip(ctx, R, ev.shipKind === 'reefer' ? 'longliner' : kind, 170, natural(ev.shipKind === 'reefer' ? 'longliner' : kind, ir), { ir, seed: 5 }); ctx.restore();
      ctx.fillStyle = ir ? '#eee' : '#F6E7C1';
      for (let i = 0; i < 6; i++) ctx.fillRect(-6 + R() * 12, -40 + i * 14, 10, 8);
    } else {
      ctx.translate(W / 2, H / 2); ctx.scale(1, 0.72); ctx.rotate(rot);
      const L = kind === 'pirogue' ? 230 : kind === 'gofast' ? 170 : kind === 'usv' ? 120 : Math.min(320, 150 + (ev.lengthM || 50) * 0.7);
      drawShip(ctx, R, kind, L, natural(kind, ir, ev.colors), {
        ir, seed: seedOf(ev.id) % 50, wake: ev.sog > 1 && ev.scene !== 'distress', sog: ev.sog, trawl: ev.trawling,
        persons: kind === 'pirogue' || kind === 'gofast' ? (ev.persons || (kind === 'gofast' ? 3 : 0)) : 0,
      });
      if (ev.scene === 'anchored') {
        ctx.strokeStyle = ir ? '#ddd' : '#1F2937'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(0, -L * 0.48); ctx.lineTo(L * 0.05, -L * 0.9); ctx.stroke(); ctx.setLineDash([]);
      }
      if (ev.fishing && kind === 'seiner') {
        ctx.strokeStyle = ir ? 'rgba(220,220,220,0.6)' : 'rgba(250,215,90,0.85)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(L * 0.55, L * 0.1, L * 0.45, L * 0.35, 0, 0, 7); ctx.stroke();
        if (!ir) { ctx.fillStyle = 'rgba(255,250,220,0.5)'; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(-L * 0.1 + i * 8, -L * 0.2, 14, 0, 7); ctx.fill(); } }
      }
    }
    ctx.restore();
    if (ir) { irTone(ctx); grain(ctx, R, 26); } else grain(ctx, R, 12);
    vignette(ctx);
    hud(ctx, ev);
    const url = cv.toDataURL('image/jpeg', 0.86);
    cache.set(key, url);
    return url;
  }

  // ---------- Extrait d'image satellite ----------
  function satChip(chip, key) {
    const k = 'sat:' + key;
    if (cache.has(k)) return cache.get(k);
    const S = 240;
    const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    const ctx = cv.getContext('2d');
    const R = rng(seedOf(key));
    const radar = chip.sensor === 'radar';
    if (radar) {
      // Chatoiement radar : mer sombre et granuleuse
      const img = ctx.createImageData(S, S), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const v = 18 + Math.pow(R(), 3) * 70; d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255; }
      ctx.putImageData(img, 0, 0);
    } else {
      const g = ctx.createLinearGradient(0, 0, S, S); g.addColorStop(0, '#1F4E63'); g.addColorStop(1, '#2C6A7E');
      ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 260; i++) { ctx.fillStyle = `rgba(200,230,240,${R() * 0.08})`; ctx.fillRect(R() * S, R() * S, 2 + R() * 6, 1); }
    }
    const cx = S / 2, cy = S / 2;
    if (chip.slick) {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(1.1);
      ctx.fillStyle = radar ? 'rgba(4,4,4,0.85)' : 'rgba(40,60,70,0.6)';
      ctx.beginPath(); ctx.ellipse(0, 0, S * 0.58, 9, 0, 0, 7); ctx.fill();
      ctx.fillStyle = radar ? 'rgba(4,4,4,0.6)' : 'rgba(40,60,70,0.35)';
      ctx.beginPath(); ctx.ellipse(10, 4, S * 0.45, 15, 0, 0, 7); ctx.fill();
      ctx.restore();
    } else if (chip.gathering) {
      ctx.fillStyle = radar ? '#8A8A8A' : '#C9B58C';
      ctx.beginPath(); ctx.moveTo(S * 0.62, 0); for (let y = 0; y <= S; y += 12) ctx.lineTo(S * 0.62 + Math.sin(y / 30) * 10, y); ctx.lineTo(S, S); ctx.lineTo(S, 0); ctx.closePath(); ctx.fill();
      if (radar) for (let i = 0; i < 800; i++) { const v = 90 + R() * 120; ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(S * 0.64 + R() * S * 0.36, R() * S, 1.5, 1.5); }
      for (let i = 0; i < (chip.count || 18); i++) {
        const x = S * 0.5 + R() * S * 0.14, y = S * 0.25 + R() * S * 0.5;
        ctx.fillStyle = radar ? '#FFFFFF' : '#F4EBDD';
        ctx.fillRect(x, y, radar ? 2.2 : 4, radar ? 2.2 : 1.6);
      }
    } else {
      const len = Math.max(9, Math.min(34, 6 + (chip.sizeEst || 40) / 5));
      ctx.save(); ctx.translate(cx, cy); ctx.rotate((((chip.heading || 30) - 90) * Math.PI) / 180);
      if (radar) {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, len); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, len, len * 0.35, 0, 0, 7); ctx.fill();
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx - 34, cy); ctx.lineTo(cx + 34, cy); ctx.moveTo(cx, cy - 24); ctx.lineTo(cx, cy + 24); ctx.stroke();
        if (chip.wake) { ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - 70, cy + 40); ctx.stroke(); }
      } else {
        ctx.fillStyle = '#F8F8F4'; ctx.beginPath(); ctx.ellipse(0, 0, len, len * 0.22, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(-len * 4, -len * 0.8); ctx.moveTo(-len, 0); ctx.lineTo(-len * 4, len * 0.8); ctx.stroke();
        ctx.restore();
      }
    }
    // Échelle et légende
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, S - 22, S, 22);
    ctx.fillStyle = '#fff'; ctx.font = '600 12px "Barlow Condensed", sans-serif'; ctx.textBaseline = 'middle';
    ctx.fillText(`${chip.pass.name}, ${radar ? 'radar VV' : 'optique'}, ${PLATFORM.hhmm(chip.t)}`, 8, S - 11);
    ctx.fillRect(S - 58, S - 13, 46, 3); ctx.textAlign = 'right'; ctx.fillText('1 km', S - 10, S - 30 + 8);
    const url = cv.toDataURL('image/jpeg', 0.88);
    cache.set(k, url);
    return url;
  }

  window.CAMERA = { evidence, satChip, clear: () => cache.clear() };
})();
