// Silhouettes vues de dessus : navires, embarcations, drones et avions.
// Repère local : l'étrave pointe vers le haut (y négatif), origine au milieu du navire,
// L = longueur en pixels. Les mêmes dessins servent à la carte et aux images des caméras.
(function () {
  // Proportions largeur / longueur et niveau de détail minimal par type
  const SPEC = {
    container: { beam: 0.145, hull: 'merchant' },
    bulk: { beam: 0.16, hull: 'merchant' },
    tanker: { beam: 0.175, hull: 'merchant' },
    cargo: { beam: 0.16, hull: 'merchant' },
    reefer: { beam: 0.16, hull: 'merchant' },
    ferry: { beam: 0.18, hull: 'round' },
    shuttle: { beam: 0.26, hull: 'round' },
    supply: { beam: 0.22, hull: 'supply' },
    tug: { beam: 0.34, hull: 'tug' },
    trawler: { beam: 0.22, hull: 'fishing' },
    longliner: { beam: 0.2, hull: 'fishing' },
    seiner: { beam: 0.26, hull: 'fishing' },
    poleline: { beam: 0.22, hull: 'fishing' },
    yacht: { beam: 0.22, hull: 'yacht' },
    pirogue: { beam: 0.11, hull: 'pirogue' },
    gofast: { beam: 0.26, hull: 'gofast' },
    opv: { beam: 0.15, hull: 'warship' },
    vedette: { beam: 0.24, hull: 'gofast' },
    usv: { beam: 0.3, hull: 'usv' },
    fpso: { beam: 0.18, hull: 'merchant' },
    flng: { beam: 0.17, hull: 'merchant' },
  };

  function hullPath(ctx, shape, L, B) {
    const h = L / 2, b = B / 2;
    ctx.beginPath();
    switch (shape) {
      case 'round':
        ctx.moveTo(0, -h);
        ctx.bezierCurveTo(b * 0.7, -h, b, -h + L * 0.12, b, -h + L * 0.24);
        ctx.lineTo(b, h - L * 0.1);
        ctx.quadraticCurveTo(b, h, 0, h);
        ctx.quadraticCurveTo(-b, h, -b, h - L * 0.1);
        ctx.lineTo(-b, -h + L * 0.24);
        ctx.bezierCurveTo(-b, -h + L * 0.12, -b * 0.7, -h, 0, -h);
        break;
      case 'tug':
        ctx.moveTo(0, -h);
        ctx.bezierCurveTo(b * 0.9, -h, b, -h + L * 0.2, b, -h + L * 0.35);
        ctx.lineTo(b, h - L * 0.2);
        ctx.quadraticCurveTo(b, h, 0, h);
        ctx.quadraticCurveTo(-b, h, -b, h - L * 0.2);
        ctx.lineTo(-b, -h + L * 0.35);
        ctx.bezierCurveTo(-b, -h + L * 0.2, -b * 0.9, -h, 0, -h);
        break;
      case 'pirogue':
        // Pirogue sénégalaise : deux pointes effilées, l'avant plus long
        ctx.moveTo(0, -h);
        ctx.bezierCurveTo(b * 0.9, -h + L * 0.22, b, -h + L * 0.4, b, 0);
        ctx.bezierCurveTo(b, h - L * 0.3, b * 0.7, h - L * 0.08, 0, h);
        ctx.bezierCurveTo(-b * 0.7, h - L * 0.08, -b, h - L * 0.3, -b, 0);
        ctx.bezierCurveTo(-b, -h + L * 0.4, -b * 0.9, -h + L * 0.22, 0, -h);
        break;
      case 'gofast':
      case 'yacht':
        ctx.moveTo(0, -h);
        ctx.bezierCurveTo(b * 0.75, -h + L * 0.12, b, -h + L * 0.32, b, -h + L * 0.5);
        ctx.lineTo(b * 0.96, h);
        ctx.lineTo(-b * 0.96, h);
        ctx.lineTo(-b, -h + L * 0.5);
        ctx.bezierCurveTo(-b, -h + L * 0.32, -b * 0.75, -h + L * 0.12, 0, -h);
        break;
      case 'warship':
        ctx.moveTo(0, -h);
        ctx.bezierCurveTo(b * 0.55, -h + L * 0.1, b, -h + L * 0.3, b, -h + L * 0.45);
        ctx.lineTo(b * 0.95, h - L * 0.02);
        ctx.lineTo(-b * 0.95, h - L * 0.02);
        ctx.lineTo(-b, -h + L * 0.45);
        ctx.bezierCurveTo(-b, -h + L * 0.3, -b * 0.55, -h + L * 0.1, 0, -h);
        break;
      case 'usv':
        ctx.moveTo(0, -h);
        ctx.bezierCurveTo(b * 0.8, -h + L * 0.1, b, -h + L * 0.3, b, -h + L * 0.45);
        ctx.lineTo(b * 0.9, h);
        ctx.lineTo(-b * 0.9, h);
        ctx.lineTo(-b, -h + L * 0.45);
        ctx.bezierCurveTo(-b, -h + L * 0.3, -b * 0.8, -h + L * 0.1, 0, -h);
        break;
      case 'fishing':
      case 'supply':
        ctx.moveTo(0, -h);
        ctx.bezierCurveTo(b * 0.8, -h + L * 0.06, b, -h + L * 0.2, b, -h + L * 0.32);
        ctx.lineTo(b, h - L * 0.05);
        ctx.quadraticCurveTo(b, h, b * 0.7, h);
        ctx.lineTo(-b * 0.7, h);
        ctx.quadraticCurveTo(-b, h, -b, h - L * 0.05);
        ctx.lineTo(-b, -h + L * 0.32);
        ctx.bezierCurveTo(-b, -h + L * 0.2, -b * 0.8, -h + L * 0.06, 0, -h);
        break;
      default: // navire marchand : étrave effilée, corps parallèle, tableau arrière
        ctx.moveTo(0, -h);
        ctx.bezierCurveTo(b * 0.5, -h + L * 0.03, b, -h + L * 0.13, b, -h + L * 0.22);
        ctx.lineTo(b, h - L * 0.045);
        ctx.quadraticCurveTo(b, h, b * 0.55, h);
        ctx.lineTo(-b * 0.55, h);
        ctx.quadraticCurveTo(-b, h, -b, h - L * 0.045);
        ctx.lineTo(-b, -h + L * 0.22);
        ctx.bezierCurveTo(-b, -h + L * 0.13, -b * 0.5, -h + L * 0.03, 0, -h);
    }
    ctx.closePath();
  }

  const rect = (ctx, x, y, w, h, fill) => { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); };
  const CONT = ['#B5543C', '#2F6E9E', '#D3A23A', '#3F7D55', '#8B8F96', '#C4CBD2', '#7B4F9E', '#A23E48'];

  // Détails de pont par type. pal : { hull, deck, house, dark, light, line, ir }
  function details(ctx, kind, L, B, pal, seed) {
    const h = L / 2, b = B / 2;
    const r = (i) => { const x = Math.sin((seed + i) * 12.9898) * 43758.5453; return x - Math.floor(x); };
    switch (kind) {
      case 'container': {
        const y0 = -h + L * 0.11, y1 = h - L * 0.2, bays = Math.max(4, Math.round((y1 - y0) / (B * 0.55)));
        const bh = (y1 - y0) / bays, cols = 4, cw = (B * 0.82) / cols;
        for (let i = 0; i < bays; i++) {
          for (let j = 0; j < cols; j++) {
            rect(ctx, -B * 0.41 + j * cw + 0.3, y0 + i * bh + 0.3, cw - 0.6, bh - 0.6, pal.ir ? pal.deck : CONT[Math.floor(r(i * 7 + j) * CONT.length)]);
          }
        }
        rect(ctx, -b * 0.88, h - L * 0.17, B * 0.88, L * 0.07, pal.house);
        break;
      }
      case 'bulk': case 'reefer': case 'cargo': {
        const n = kind === 'bulk' ? 7 : 4;
        const y0 = -h + L * 0.13, y1 = h - L * 0.22, step = (y1 - y0) / n;
        for (let i = 0; i < n; i++) rect(ctx, -b * 0.62, y0 + i * step + step * 0.12, b * 1.24, step * 0.76, pal.dark);
        if (kind !== 'bulk') {
          ctx.strokeStyle = pal.line; ctx.lineWidth = Math.max(0.6, B * 0.05);
          for (let i = 1; i < n; i++) { const y = y0 + i * step; ctx.beginPath(); ctx.arc(0, y, B * 0.09, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(b * 0.75, y - step * 0.45); ctx.stroke(); }
        }
        rect(ctx, -b * 0.9, h - L * 0.18, B * 0.9, L * 0.08, pal.house);
        break;
      }
      case 'tanker': case 'fpso': case 'flng': {
        ctx.strokeStyle = pal.line; ctx.lineWidth = Math.max(0.6, B * 0.06);
        ctx.beginPath(); ctx.moveTo(0, -h + L * 0.1); ctx.lineTo(0, h - L * 0.2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-b * 0.8, -h + L * 0.45); ctx.lineTo(b * 0.8, -h + L * 0.45); ctx.stroke();
        if (kind !== 'tanker') {
          for (let i = 0; i < 6; i++) rect(ctx, -b * 0.7, -h + L * (0.2 + i * 0.09), B * 0.7, L * 0.06, i % 2 ? pal.dark : pal.light);
          ctx.fillStyle = pal.house; ctx.beginPath(); ctx.arc(0, -h + L * 0.08, B * 0.28, 0, 7); ctx.fill();
          if (kind === 'fpso') { ctx.strokeStyle = pal.dark; ctx.beginPath(); ctx.moveTo(0, h - L * 0.05); ctx.lineTo(b * 1.6, h + L * 0.06); ctx.stroke(); }
        }
        rect(ctx, -b * 0.9, h - L * 0.17, B * 0.9, L * 0.08, pal.house);
        break;
      }
      case 'ferry': case 'shuttle':
        rect(ctx, -b * 0.8, -h + L * 0.2, B * 0.8, L * 0.62, pal.house);
        ctx.fillStyle = pal.dark; ctx.beginPath(); ctx.arc(0, h - L * 0.3, B * 0.13, 0, 7); ctx.fill();
        break;
      case 'supply':
        rect(ctx, -b * 0.85, -h + L * 0.1, B * 0.85, L * 0.24, pal.house);
        rect(ctx, -b * 0.82, -h + L * 0.4, B * 0.82, L * 0.55, pal.dark);
        break;
      case 'tug':
        rect(ctx, -b * 0.55, -h + L * 0.28, B * 0.55, L * 0.3, pal.house);
        break;
      case 'trawler':
        rect(ctx, -b * 0.75, -h + L * 0.16, B * 0.75, L * 0.2, pal.house);
        rect(ctx, -b * 0.7, h - L * 0.3, B * 0.7, L * 0.22, pal.dark);
        ctx.strokeStyle = pal.line; ctx.lineWidth = Math.max(0.7, B * 0.07);
        ctx.beginPath(); ctx.moveTo(-b * 0.95, h - L * 0.07); ctx.lineTo(b * 0.95, h - L * 0.07); ctx.stroke();
        break;
      case 'longliner': case 'poleline':
        rect(ctx, -b * 0.7, -h + L * (kind === 'poleline' ? 0.18 : 0.42), B * 0.7, L * 0.2, pal.house);
        ctx.fillStyle = pal.dark; ctx.beginPath(); ctx.arc(0, h - L * 0.18, B * 0.2, 0, 7); ctx.fill();
        break;
      case 'seiner':
        rect(ctx, -b * 0.75, -h + L * 0.14, B * 0.75, L * 0.2, pal.house);
        rect(ctx, -b * 0.65, -h + L * 0.45, B * 0.65, L * 0.38, pal.dark);
        ctx.fillStyle = pal.light; ctx.beginPath(); ctx.ellipse(0, h - L * 0.02, B * 0.22, L * 0.07, 0, 0, 7); ctx.fill();
        break;
      case 'yacht':
        ctx.fillStyle = pal.house; ctx.beginPath(); ctx.ellipse(0, -h + L * 0.5, b * 0.6, L * 0.24, 0, 0, 7); ctx.fill();
        rect(ctx, -b * 0.5, h - L * 0.2, B * 0.5, L * 0.14, pal.light);
        break;
      case 'pirogue': {
        // Bandeau peint le long du plat-bord, bancs, moteur hors-bord
        const cols = pal.colors || ['#C0392B', '#F1C40F', '#27AE60'];
        ctx.save(); hullPath(ctx, 'pirogue', L, B); ctx.clip();
        ctx.lineWidth = Math.max(0.8, B * 0.28);
        cols.forEach((c, i) => { ctx.strokeStyle = pal.ir ? pal.dark : c; ctx.beginPath(); ctx.moveTo(-b, -h + L * (0.15 + i * 0.25)); ctx.lineTo(b, -h + L * (0.15 + i * 0.25)); ctx.stroke(); });
        ctx.restore();
        ctx.strokeStyle = pal.line; ctx.lineWidth = Math.max(0.5, B * 0.08);
        for (let i = 1; i < 6; i++) { const y = -h + L * (0.16 * i); ctx.beginPath(); ctx.moveTo(-b * 0.8, y); ctx.lineTo(b * 0.8, y); ctx.stroke(); }
        rect(ctx, -B * 0.16, h - L * 0.02, B * 0.32, L * 0.05, pal.dark);
        break;
      }
      case 'gofast':
        rect(ctx, -b * 0.6, -h + L * 0.4, B * 0.6, L * 0.2, pal.house);
        for (let i = -1; i <= 1; i++) rect(ctx, i * B * 0.28 - B * 0.08, h - L * 0.02, B * 0.16, L * 0.08, pal.dark);
        break;
      case 'vedette':
        rect(ctx, -b * 0.6, -h + L * 0.32, B * 0.6, L * 0.3, pal.house);
        for (let i = -1; i <= 1; i += 2) rect(ctx, i * B * 0.22 - B * 0.08, h - L * 0.02, B * 0.16, L * 0.07, pal.dark);
        break;
      case 'opv':
        ctx.fillStyle = pal.dark; ctx.beginPath(); ctx.arc(0, -h + L * 0.24, B * 0.2, 0, 7); ctx.fill();
        ctx.strokeStyle = pal.dark; ctx.lineWidth = Math.max(0.6, B * 0.07); ctx.beginPath(); ctx.moveTo(0, -h + L * 0.24); ctx.lineTo(0, -h + L * 0.12); ctx.stroke();
        rect(ctx, -b * 0.75, -h + L * 0.33, B * 0.75, L * 0.3, pal.house);
        ctx.strokeStyle = pal.light; ctx.lineWidth = Math.max(0.5, B * 0.05);
        ctx.beginPath(); ctx.arc(0, h - L * 0.16, B * 0.3, 0, 7); ctx.stroke();
        break;
      case 'usv':
        rect(ctx, -b * 0.7, -h + L * 0.36, B * 0.7, L * 0.42, pal.dark);
        ctx.strokeStyle = pal.light; ctx.lineWidth = Math.max(0.4, B * 0.03);
        for (let i = 1; i < 4; i++) { const y = -h + L * (0.36 + 0.105 * i); ctx.beginPath(); ctx.moveTo(-b * 0.7, y); ctx.lineTo(b * 0.7, y); ctx.stroke(); }
        ctx.fillStyle = pal.house; ctx.beginPath(); ctx.arc(0, -h + L * 0.26, B * 0.16, 0, 7); ctx.fill();
        break;
      default:
    }
  }

  // Navire complet. lod : 0 silhouette seule, 1 avec détails.
  function vessel(ctx, kind, L, pal, lod, seed) {
    const sp = SPEC[kind] || SPEC.cargo;
    const B = Math.max(L * sp.beam, kind === 'pirogue' ? 2.6 : 3.2);
    hullPath(ctx, sp.hull, L, B);
    ctx.fillStyle = pal.hull; ctx.fill();
    if (lod > 0 && L >= 16) {
      ctx.save(); hullPath(ctx, sp.hull, L, B); ctx.clip();
      details(ctx, kind, L, B, pal, seed || 1);
      ctx.restore();
    }
    hullPath(ctx, sp.hull, L, B);
    ctx.lineWidth = pal.lw || 1; ctx.strokeStyle = pal.line; ctx.stroke();
    return B;
  }

  // Drone aérien à voilure fixe (vue de dessus) : L = envergure
  function drone(ctx, L, pal) {
    const s = L / 2;
    ctx.fillStyle = pal.hull; ctx.strokeStyle = pal.line; ctx.lineWidth = pal.lw || 1;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.62);
    ctx.quadraticCurveTo(s * 0.08, -s * 0.55, s * 0.08, -s * 0.2);
    ctx.lineTo(s, -s * 0.12); ctx.lineTo(s, s * 0.02); ctx.lineTo(s * 0.08, 0);
    ctx.lineTo(s * 0.06, s * 0.42);
    ctx.lineTo(s * 0.36, s * 0.62); ctx.lineTo(s * 0.33, s * 0.7); ctx.lineTo(0, s * 0.6);
    ctx.lineTo(-s * 0.33, s * 0.7); ctx.lineTo(-s * 0.36, s * 0.62);
    ctx.lineTo(-s * 0.06, s * 0.42);
    ctx.lineTo(-s * 0.08, 0); ctx.lineTo(-s, s * 0.02); ctx.lineTo(-s, -s * 0.12); ctx.lineTo(-s * 0.08, -s * 0.2);
    ctx.quadraticCurveTo(-s * 0.08, -s * 0.55, 0, -s * 0.62);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = pal.dark; ctx.beginPath(); ctx.ellipse(0, -s * 0.48, s * 0.05, s * 0.09, 0, 0, 7); ctx.fill();
  }

  // Avion de patrouille maritime bimoteur à aile haute : L = envergure
  function mpa(ctx, L, pal) {
    const s = L / 2;
    ctx.fillStyle = pal.hull; ctx.strokeStyle = pal.line; ctx.lineWidth = pal.lw || 1;
    ctx.beginPath(); ctx.ellipse(0, s * 0.02, s * 0.1, s * 0.78, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s, -s * 0.16); ctx.lineTo(s, -s * 0.16); ctx.lineTo(s * 0.96, -s * 0.02); ctx.lineTo(-s * 0.96, -s * 0.02); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.38, s * 0.66); ctx.lineTo(s * 0.38, s * 0.66); ctx.lineTo(s * 0.34, s * 0.76); ctx.lineTo(-s * 0.34, s * 0.76); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = pal.dark;
    [-0.38, 0.38].forEach((x) => { ctx.beginPath(); ctx.ellipse(x * s, -s * 0.16, s * 0.07, s * 0.18, 0, 0, 7); ctx.fill(); });
  }

  window.SYM = { SPEC, vessel, drone, mpa, hullPath };
})();
