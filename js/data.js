// Données de référence et scénario de démonstration.
// TOUS LES NAVIRES, NUMÉROS OMI ET LISTES SONT FICTIFS (préfixe SIM).
// Les positions des zones, aires marines et installations sont indicatives.
(function () {
  // Heure 0 de la simulation : mercredi 14 octobre 2026, 18 h 30 (heure de Dakar, UTC+0).
  const START = Date.UTC(2026, 9, 14, 18, 30);
  const END_MIN = 14 * 60 + 30; // fin : jeudi 15 octobre, 09 h 00
  // Convertit "HH:MM" (jour 1 si >= 18:30, sinon jour 2) en minutes de simulation.
  const T = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    let min = h * 60 + m - (18 * 60 + 30);
    if (min < 0) min += 24 * 60;
    return min;
  };

  const ports = [
    { name: 'Dakar (base navale Amiral Faye Gassama)', pos: [14.672, -17.425] },
    { name: 'Saint-Louis', pos: [16.02, -16.515] },
    { name: 'Joal', pos: [14.162, -16.86] },
    { name: 'Ziguinchor', pos: [12.58, -16.27] },
  ];

  // Aires marines protégées (positions et rayons indicatifs).
  const amps = [
    { name: 'AMP de Saint-Louis', pos: [15.93, -16.6], rNm: 4 },
    { name: 'AMP de Kayar', pos: [14.94, -17.2], rNm: 4 },
    { name: 'AMP de Joal-Fadiouth', pos: [14.12, -16.9], rNm: 3.5 },
    { name: 'AMP d\'Abéné', pos: [12.98, -16.79], rNm: 3 },
  ];

  // Installations pétrolières et gazières en mer (zones de sécurité indicatives).
  const offshore = [
    { name: 'Hub gazier GTA (indicatif)', pos: [16.1, -17.12], rNm: 5 },
    { name: 'Champ de Sangomar (indicatif)', pos: [13.95, -17.62], rNm: 5 },
  ];

  // Plages de départ de pirogues connues (surveillance satellite prioritaire).
  const beaches = [
    { name: 'Dionewar (îles du Saloum)', pos: [13.885, -16.735] },
    { name: 'Djiffer', pos: [14.1, -16.755] },
    { name: 'Mbour', pos: [14.41, -16.965] },
    { name: 'Saint-Louis (Guet Ndar)', pos: [16.035, -16.508] },
    { name: 'Kafountine', pos: [12.93, -16.755] },
  ];

  // Moyens de l'État et drones DIAMBAR.
  const assets = [
    { id: 'USV-01', name: 'DIAMBAR-01', type: 'usv', base: [14.672, -17.425], kn: 14, enduranceH: 36, detectLarge: 8, detectSmall: 3, identify: 1.2 },
    { id: 'USV-02', name: 'DIAMBAR-02', type: 'usv', base: [14.162, -16.86], kn: 14, enduranceH: 36, detectLarge: 8, detectSmall: 3, identify: 1.2 },
    { id: 'USV-03', name: 'DIAMBAR-03', type: 'usv', base: [16.02, -16.515], kn: 14, enduranceH: 36, detectLarge: 8, detectSmall: 3, identify: 1.2 },
    { id: 'DRN-GN', name: 'Drone Gendarmerie', type: 'drone', base: [14.74, -17.49], kn: 75, enduranceH: 6, detectLarge: 10, detectSmall: 8, identify: 3 },
    { id: 'DRN-AA', name: 'Drone Armée de l\'air', type: 'drone', base: [14.79, -16.93], kn: 80, enduranceH: 8, detectLarge: 10, detectSmall: 8, identify: 3 },
    {
      id: 'OPV-WALO', name: 'Walo (OPV)', type: 'opv', base: [14.672, -17.425], kn: 16, enduranceH: 1080, detectLarge: 20, detectSmall: 6, identify: 2,
      patrol: [[14.95, -17.75], [14.55, -17.95], [14.3, -17.6], [14.75, -17.55]],
    },
    {
      id: 'OPV-NIANI', name: 'Niani (OPV)', type: 'opv', base: [14.672, -17.425], kn: 16, enduranceH: 1080, detectLarge: 20, detectSmall: 6, identify: 2,
      patrol: [[13.2, -17.25], [12.75, -17.15], [12.6, -17.55], [13.0, -17.6]], startAt: [13.2, -17.3],
    },
    { id: 'OPV-CAYOR', name: 'Cayor (OPV)', type: 'opv', base: [14.672, -17.425], kn: 16, enduranceH: 1080, detectLarge: 20, detectSmall: 6, identify: 2, maintenance: true },
  ];

  // Registre des navires autorisés (fourni par la DPSP dans la réalité).
  const registry = [
    { name: 'SIM HAI LONG 7', imo: 'SIM-8100417', flag: 'Sénégal', type: 'Chalutier pélagique', lengthM: 62, licence: 'Pêche pélagique hauturière', minNm: 12, vms: 'VMS-0417' },
    { name: 'SIM MARLIN 3', imo: 'SIM-8100233', flag: 'Sénégal', type: 'Palangrier thonier', lengthM: 45, licence: 'Thonière, haute mer et ZEE', minNm: 12, vms: 'VMS-0233' },
    { name: 'SIM CAP VERT 12', imo: 'SIM-8100612', flag: 'Sénégal', type: 'Chalutier démersal', lengthM: 38, licence: 'Démersale côtière', minNm: 12, vms: 'VMS-0612' },
    { name: 'SIM NDAR', imo: 'SIM-8100101', flag: 'Sénégal', type: 'Chalutier pélagique', lengthM: 55, licence: 'Pêche pélagique hauturière', minNm: 12, vms: 'VMS-0101' },
    { name: 'SIM GOREE', imo: 'SIM-8100102', flag: 'Sénégal', type: 'Senneur', lengthM: 48, licence: 'Pêche pélagique côtière', minNm: 12, vms: 'VMS-0102' },
    { name: 'SIM SALOUM', imo: 'SIM-8100103', flag: 'Sénégal', type: 'Chalutier démersal', lengthM: 36, licence: 'Démersale côtière', minNm: 12, vms: 'VMS-0103' },
    { name: 'SIM KAYAR', imo: 'SIM-8100104', flag: 'Sénégal', type: 'Palangrier', lengthM: 32, licence: 'Démersale profonde', minNm: 12, vms: 'VMS-0104' },
    { name: 'SIM LOMPOUL', imo: 'SIM-8100105', flag: 'Sénégal', type: 'Chalutier pélagique', lengthM: 58, licence: 'Pêche pélagique hauturière', minNm: 12, vms: 'VMS-0105' },
    { name: 'SIM SINE', imo: 'SIM-8100106', flag: 'Sénégal', type: 'Senneur', lengthM: 44, licence: 'Pêche pélagique côtière', minNm: 12, vms: 'VMS-0106' },
  ];

  // Liste fictive de navires inscrits sur des listes INN régionales.
  const iuuList = [
    { name: 'SIM ORIENT 66', imo: 'SIM-7700215', source: 'Liste INN ORGP (fictive)', since: 2011, note: 'Palangrier, a changé plusieurs fois de nom' },
    { name: 'SIM BLUE HORIZON', imo: 'SIM-7700533', source: 'Liste INN ORGP (fictive)', since: 2020, note: 'Pêche sans autorisation en haute mer' },
    { name: 'SIM MEGA 2', imo: 'SIM-7700076', source: 'Liste INN ORGP (fictive)', since: 2021, note: 'Navire sans nationalité' },
  ];

  // Passages satellites programmés (heures réalistes pour une orbite héliosynchrone).
  const satPasses = [
    { t: T('18:52'), sensor: 'radar', name: 'Sentinel-1 (radar, gratuit)' },
    { t: T('06:48'), sensor: 'radar', name: 'Sentinel-1 (radar, gratuit)' },
  ];

  // Navires du scénario. "violations" = vérité terrain cachée à l'opérateur,
  // utilisée seulement pour la vérification sur place et le mode formateur.
  const scenario = [
    {
      id: 'hailong', name: 'SIM HAI LONG 7', imo: 'SIM-8100417', vmsId: 'VMS-0417', type: 'chalutier', cls: 'large', lengthM: 62,
      hasAis: true, start: [15.6, -17.2], violations: ['AIS_OFF', 'ZONE_6', 'ZONE_LIC', 'VMS_SILENT'],
      plan: [
        { kind: 'loiter', until: T('20:30'), kn: 3.5, r: 3 },
        { kind: 'goto', to: [15.9, -16.95], kn: 12 },
        { kind: 'goto', to: [15.82, -16.635], kn: 10 },
        { kind: 'loiter', until: T('02:30'), kn: 3, r: 1.6 },
        { kind: 'goto', to: [15.7, -17.3], kn: 11 },
        { kind: 'loiter', until: T('09:00'), kn: 3.5, r: 3 },
      ],
      events: [{ at: T('21:10'), set: { aisOn: false } }, { at: T('00:50'), set: { vmsOn: false } }, { at: T('03:50'), set: { aisOn: true, vmsOn: true } }],
      story: 'Chalutier autorisé au-delà de 12 milles. Coupe son AIS en approchant de la côte, puis sa balise VMS, et chalute dans la bande des 6 milles réservée aux pirogues de Saint-Louis.',
      observations: 'Chalut de fond à l\'eau à 4 milles de la côte. Nom et numéro OMI lisibles. Captures sur le pont.',
    },
    {
      id: 'marlin', name: 'SIM MARLIN 3', imo: 'SIM-8100233', vmsId: 'VMS-0233', type: 'palangrier', cls: 'large', lengthM: 45,
      hasAis: true, start: [14.3, -18.2], violations: ['LOITER_OFFSHORE', 'TRANSSHIP'],
      plan: [
        { kind: 'goto', to: [14.6, -18.95], kn: 10 },
        { kind: 'hold', until: T('02:00') },
        { kind: 'goto', to: [13.95, -18.6], kn: 9 },
        { kind: 'loiter', until: T('09:00'), kn: 3, r: 4 },
      ],
      story: 'Palangrier autorisé qui retrouve un navire frigorifique sans licence en pleine mer pour lui transférer sa pêche hors de tout contrôle.',
      observations: 'Deux navires amarrés bord à bord. Caisses de poisson transférées vers le frigorifique.',
    },
    {
      id: 'polar', name: 'SIM POLAR STAR', imo: 'SIM-9300881', type: 'frigorifique', cls: 'large', lengthM: 92,
      hasAis: true, aisOn: false, start: [15.3, -19.6], violations: ['DARK_LARGE', 'TRANSSHIP'],
      plan: [
        { kind: 'goto', to: [14.605, -18.955], kn: 11 },
        { kind: 'hold', until: T('02:05') },
        { kind: 'goto', to: [15.8, -20.4], kn: 12 },
      ],
      story: 'Navire frigorifique sans licence, AIS éteint, venu récupérer du poisson en mer.',
      observations: 'Frigorifique de 90 m, AIS éteint, panneaux de nom masqués. Transbordement en cours.',
    },
    {
      id: 'pirogue', name: 'Pirogue non immatriculée', type: 'pirogue', cls: 'small', lengthM: 22, persons: 140,
      hasAis: false, start: [13.885, -16.735], gathering: true, violations: ['GATHER', 'DARK_SMALL', 'DISTRESS'],
      plan: [
        { kind: 'hold', until: T('22:15') },
        { kind: 'goto', to: [14.2, -17.3], kn: 7, departure: true },
        { kind: 'drift', until: T('09:00'), kn: 0.8, brg: 215, distress: true },
      ],
      events: [{ at: T('22:15'), set: { gathering: false } }],
      story: 'Rassemblement sur la plage de Dionewar, départ de nuit vers les Canaries avec environ 140 personnes. Panne moteur au large vers 3 h 30.',
      observations: 'Pirogue de 22 m, environ 140 personnes à bord dont des femmes et des enfants. Moteur à l\'arrêt, embarcation qui dérive. Besoin de secours immédiat.',
    },
    {
      id: 'pecheurs', name: 'Pirogue de pêche FAMILLE NDOYE', type: 'pirogue', cls: 'small', lengthM: 18,
      hasAis: false, start: [14.16, -16.87], violations: [],
      plan: [
        { kind: 'hold', until: T('04:00') },
        { kind: 'goto', to: [14.05, -17.18], kn: 8 },
        { kind: 'loiter', until: T('09:00'), kn: 2, r: 1.5 },
      ],
      story: 'Pirogue de pêche artisanale en règle, partie de Joal avant l\'aube. Fausse alerte possible si elle est détectée de nuit au large.',
      observations: 'Pirogue de pêche avec 9 pêcheurs, filets maillants réglementaires, permis de pêche artisanale présenté.',
      benign: 'Pirogue de pêche en règle partie de Joal. Aucune infraction.',
    },
    {
      id: 'seagrace', name: 'SIM SEA GRACE', imo: 'SIM-7700215', type: 'palangrier', cls: 'large', lengthM: 48,
      hasAis: true, start: [14.2, -18.1], violations: ['PORT_IUU'],
      plan: [
        { kind: 'hold', until: T('23:00') },
        { kind: 'goto', to: [14.66, -17.45], kn: 9 },
        { kind: 'hold', until: T('09:00'), drift: 0 },
      ],
      story: 'Palangrier inscrit sur une liste INN sous un ancien nom (SIM ORIENT 66). Il a changé de nom mais garde le même numéro OMI et demande à entrer au port de Dakar.',
      observations: 'Numéro OMI SIM-7700215 lu sur la coque, identique à celui de SIM ORIENT 66 (liste INN). Thon congelé à bord.',
      benign: 'Palangrier à l\'arrêt, en attente avant d\'entrer au port. Aucune activité de pêche observée sur ce point. Vérifier son identité au port.',
    },
    {
      id: 'capvert', name: 'SIM CAP VERT 12', imo: 'SIM-8100612', vmsId: 'VMS-0612', type: 'chalutier', cls: 'large', lengthM: 38,
      hasAis: true, start: [14.1, -17.55], violations: ['VMS_AIS_GAP', 'ZONE_6', 'ZONE_LIC'],
      vmsGhost: { from: T('00:00'), center: [14.1, -17.55] },
      plan: [
        { kind: 'loiter', until: T('00:00'), kn: 3, r: 2 },
        { kind: 'goto', to: [14.4, -17.06], kn: 10 },
        { kind: 'loiter', until: T('05:30'), kn: 3, r: 1.2 },
        { kind: 'goto', to: [14.1, -17.55], kn: 10 },
        { kind: 'loiter', until: T('09:00'), kn: 3, r: 2 },
      ],
      story: 'Chalutier autorisé qui laisse sa balise VMS sur une pirogue d\'appui au large pendant qu\'il va chaluter dans la bande des 6 milles devant Mbour. Son AIS, resté allumé, le trahit.',
      observations: 'Chalutier en pêche à moins de 5 milles de Mbour. Aucune balise VMS active à bord. La balise se trouve sur une pirogue d\'appui à 30 milles.',
    },
    {
      id: 'atlantic', name: 'SIM ATLANTIC TRADER', imo: 'SIM-9400322', type: 'cargo', cls: 'large', lengthM: 180,
      hasAis: true, start: [16.0, -18.25], violations: [],
      plan: [{ kind: 'goto', to: [12.0, -18.45], kn: 13 }],
      events: [{ at: T('01:00'), set: { aisOn: false } }, { at: T('05:10'), set: { aisOn: true } }],
      story: 'Porte-conteneurs en route vers le sud. Panne de son transpondeur AIS pendant quatre heures. Fausse alerte.',
      observations: 'Porte-conteneurs sur sa route habituelle. Le capitaine signale une panne du transpondeur AIS par VHF.',
      benign: 'Panne technique du transpondeur, signalée par le capitaine. Aucune infraction.',
    },
    {
      id: 'golden', name: 'SIM GOLDEN WAVE', imo: 'SIM-9700145', type: 'yacht', cls: 'large', lengthM: 26,
      hasAis: true, start: [13.4, -19.5], violations: ['SPOOF', 'AIS_OFF', 'DARK_LARGE'],
      spoof: { from: T('02:30'), to: T('03:30'), brg: 280, nm: 26 },
      plan: [
        { kind: 'goto', to: [14.0, -17.25], kn: 11 },
        { kind: 'hold', until: T('09:00') },
      ],
      events: [{ at: T('03:30'), set: { aisOn: false } }],
      story: 'Yacht qui transporte de la drogue vers la Petite-Côte. Il falsifie sa position AIS puis l\'éteint avant un rendez-vous près de la côte.',
      observations: 'Yacht de 26 m, ballots suspects sur le pont arrière, aucune réponse aux appels VHF. Intervention de la Marine recommandée.',
    },
  ];

  // Flotte de fond : pêche industrielle légale, cargos, pirogues artisanales.
  function background(rand) {
    const out = [];
    const legal = ['SIM NDAR', 'SIM GOREE', 'SIM SALOUM', 'SIM KAYAR', 'SIM LOMPOUL', 'SIM SINE'];
    const spots = [[15.3, -17.6], [14.95, -18.1], [14.4, -18.3], [13.8, -17.9], [12.8, -17.9], [15.7, -17.6]];
    legal.forEach((n, i) => {
      const r = registry.find((x) => x.name === n);
      out.push({
        id: 'bg-legal-' + i, name: n, imo: r.imo, vmsId: r.vms, type: r.type.startsWith('Senneur') ? 'senneur' : 'chalutier',
        cls: 'large', lengthM: r.lengthM, hasAis: true, start: spots[i], violations: [],
        plan: [{ kind: 'loiter', until: END_MIN, kn: 3 + rand() * 1.5, r: 4 }],
        observations: 'Navire autorisé en pêche dans sa zone de licence.', benign: 'Navire autorisé, en règle.',
      });
    });
    const lanes = [
      [[16.05, -18.6], [12.1, -18.9]], [[12.1, -18.1], [16.05, -17.95]], [[16.05, -19.2], [12.2, -19.4]],
      [[14.68, -17.43], [16.05, -18.1]], [[13.0, -18.4], [14.68, -17.43]], [[14.68, -17.43], [12.3, -18.0]],
      [[15.5, -20.0], [14.68, -17.43]],
    ];
    const cargoNames = ['SIM RUFISQUE EXPRESS', 'SIM ATLAS BULK', 'SIM IVORY COAST', 'SIM HORIZON MAERSKA', 'SIM DAKAR LINE', 'SIM BISSAU STAR', 'SIM CANARIAS'];
    lanes.forEach((l, i) => {
      const f = rand();
      const p = [l[0][0] + (l[1][0] - l[0][0]) * f * 0.6, l[0][1] + (l[1][1] - l[0][1]) * f * 0.6];
      out.push({
        id: 'bg-cargo-' + i, name: cargoNames[i], imo: 'SIM-95' + String(10000 + i * 731).slice(-5), type: 'cargo', cls: 'large',
        lengthM: 120 + Math.round(rand() * 120), hasAis: true, start: p, violations: [],
        plan: [{ kind: 'goto', to: l[1], kn: 11 + rand() * 4 }, { kind: 'hold', until: END_MIN }],
        observations: 'Navire marchand en transit.', benign: 'Navire marchand en transit, en règle.',
      });
    });
    const harbours = [[16.03, -16.58], [15.75, -16.66], [14.93, -17.2], [14.72, -17.5], [14.42, -17.03], [14.17, -16.93], [13.95, -16.83], [12.9, -16.8], [12.45, -16.8]];
    for (let i = 0; i < 26; i++) {
      const h = harbours[i % harbours.length];
      const p = [h[0] + (rand() - 0.5) * 0.08, h[1] - rand() * 0.05];
      out.push({
        id: 'bg-pir-' + i, name: 'Pirogue de pêche', type: 'pirogue', cls: 'small', lengthM: 12 + Math.round(rand() * 8),
        hasAis: false, start: p, violations: [], artisanal: true,
        plan: [{ kind: 'loiter', until: END_MIN, kn: 2 + rand() * 2, r: 2 }],
        observations: 'Pirogue de pêche artisanale en activité près de la côte.', benign: 'Pêche artisanale en règle.',
      });
    }
    return out;
  }

  // Cas présentés dans le menu « Aller à ».
  const cases = [
    { id: 'gather', label: 'Rassemblement de pirogues au Saloum', t: T('19:00'), focus: [13.95, -16.85], zoom: 10 },
    { id: 'hailong', label: 'Chalutier sombre devant Saint-Louis', t: T('21:50'), focus: [15.85, -16.85], zoom: 9 },
    { id: 'marlin', label: 'Transbordement au large de Dakar', t: T('01:45'), focus: [14.6, -18.9], zoom: 10, prep: [{ rule: 'LOITER_OFFSHORE', asset: 'DRN-GN', purpose: 'verification' }] },
    { id: 'capvert', label: 'Balise VMS déplacée devant Mbour', t: T('00:35'), focus: [14.25, -17.3], zoom: 9 },
    { id: 'seagrace', label: 'Navire inscrit INN en approche de Dakar', t: T('01:15'), focus: [14.55, -17.65], zoom: 10 },
    { id: 'atlantic', label: 'Panne AIS d\'un cargo (fausse alerte)', t: T('01:35'), focus: [14.6, -18.3], zoom: 8 },
    { id: 'golden', label: 'Position AIS falsifiée (trafic)', t: T('02:35'), focus: [13.95, -18.2], zoom: 8 },
    { id: 'distress', label: 'Pirogue en détresse', t: T('03:50'), focus: [14.15, -17.25], zoom: 10, prep: [{ rule: 'GATHER', asset: 'USV-02', purpose: 'suivi' }] },
  ];

  window.DIAMBAR_DATA = { START, END_MIN, T, ports, amps, offshore, beaches, assets, registry, iuuList, satPasses, scenario, background, cases };
})();
