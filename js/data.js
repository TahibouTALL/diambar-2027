// Données de référence et scénario de démonstration (24 heures).
// TOUS LES NAVIRES CIVILS, NUMÉROS OMI, MMSI ET LISTES SONT FICTIFS (préfixe SIM).
// Les moyens de l'État portent leurs noms réels ; leurs positions et missions sont simulées.
// Zones, aires marines protégées, câbles et installations : positions indicatives.
(function () {
  // ---------- Temps ----------
  // t = minutes depuis le mercredi 14 octobre 2026, 06 h 00 (heure de Dakar = UTC).
  const START = Date.UTC(2026, 9, 14, 6, 0);
  const PRE_MIN = -120; // la simulation tourne déjà depuis 04 h 00 (pistes et traces existantes)
  const END_MIN = 24 * 60; // jeudi 15 octobre, 06 h 00
  // 'HH:MM' : de 06:00 à 23:59 le mercredi, de 00:00 à 05:59 le jeudi.
  const T = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    let v = h * 60 + m - 360;
    if (v < 0) v += 1440;
    return v;
  };
  // Heure du mercredi avant 06:00 (période de préchauffage).
  const P = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m - 360; };

  const sun = { rise: T('07:02'), set: T('18:51') };
  const moon = { phase: 'Premier croissant', illum: 18, set: T('22:14') };
  const weather = { windDir: 'NNE', windKn: 14, swellDir: 'NO', swellM: 1.4, visKm: 10, seaState: 3, sstC: 27, current: { brg: 205, kn: 0.5 } };

  // ---------- Lieux ----------
  const places = [
    { name: 'Dakar', pos: [14.6928, -17.4467], rank: 1, kind: 'capital' },
    { name: 'Banjul', pos: [13.4549, -16.579], rank: 1, kind: 'capital' },
    { name: 'Nouakchott', pos: [18.0735, -15.9582], rank: 1, kind: 'capital' },
    { name: 'Bissau', pos: [11.8636, -15.5977], rank: 1, kind: 'capital' },
    { name: 'Praia', pos: [14.933, -23.513], rank: 2, kind: 'capital' },
    { name: 'Saint-Louis', pos: [16.0179, -16.4896], rank: 2, kind: 'city' },
    { name: 'Thiès', pos: [14.791, -16.9359], rank: 2, kind: 'city' },
    { name: 'Kaolack', pos: [14.152, -16.0726], rank: 2, kind: 'city' },
    { name: 'Ziguinchor', pos: [12.5681, -16.2719], rank: 2, kind: 'city' },
    { name: 'Mbour', pos: [14.4198, -16.9693], rank: 2, kind: 'city' },
    { name: 'Rufisque', pos: [14.7154, -17.2734], rank: 3, kind: 'town' },
    { name: 'Joal-Fadiouth', pos: [14.1667, -16.8333], rank: 3, kind: 'town' },
    { name: 'Kayar', pos: [14.917, -17.11], rank: 3, kind: 'town' },
    { name: 'Louga', pos: [15.6144, -16.2286], rank: 3, kind: 'town' },
    { name: 'Fatick', pos: [14.339, -16.4111], rank: 3, kind: 'town' },
    { name: 'Cap Skirring', pos: [12.3931, -16.7468], rank: 3, kind: 'town' },
    { name: 'Saly', pos: [14.452, -17.006], rank: 4, kind: 'town' },
    { name: 'Palmarin', pos: [14.03, -16.762], rank: 4, kind: 'village' },
    { name: 'Djiffer', pos: [13.957, -16.759], rank: 4, kind: 'village' },
    { name: 'Dionewar', pos: [13.885, -16.722], rank: 4, kind: 'village' },
    { name: 'Lompoul', pos: [15.43, -16.73], rank: 4, kind: 'village' },
    { name: 'Kafountine', pos: [12.93, -16.745], rank: 4, kind: 'village' },
    { name: 'Abéné', pos: [13.05, -16.745], rank: 5, kind: 'village' },
    { name: 'Gorée', pos: [14.6672, -17.3985], rank: 4, kind: 'island' },
  ];
  const regions = [
    { name: 'SÉNÉGAL', pos: [14.9, -15.3], rank: 1, kind: 'country' },
    { name: 'MAURITANIE', pos: [17.5, -14.6], rank: 1, kind: 'country' },
    { name: 'GAMBIE', pos: [13.62, -15.55], rank: 2, kind: 'country' },
    { name: 'GUINÉE-BISSAU', pos: [11.75, -14.6], rank: 1, kind: 'country' },
    { name: 'CAP-VERT', pos: [15.85, -23.05], rank: 1, kind: 'country' },
    { name: 'Océan Atlantique', pos: [13.2, -21.6], rank: 1, kind: 'ocean' },
    { name: 'Presqu\'île du Cap-Vert', pos: [14.77, -17.33], rank: 3, kind: 'feature' },
    { name: 'Grande Côte', pos: [15.32, -16.62], rank: 3, kind: 'feature', rot: -52 },
    { name: 'Petite Côte', pos: [14.33, -16.86], rank: 3, kind: 'feature', rot: -62 },
    { name: 'Delta du Saloum', pos: [13.8, -16.52], rank: 3, kind: 'feature' },
    { name: 'Langue de Barbarie', pos: [15.86, -16.46], rank: 4, kind: 'feature', rot: -70 },
    { name: 'Fosse de Kayar', pos: [14.98, -17.42], rank: 4, kind: 'seafeature' },
    { name: 'Cap Roxo', pos: [12.31, -16.62], rank: 4, kind: 'feature' },
  ];

  // Bases et ports
  const ports = [
    { id: 'dakar', name: 'Port de Dakar et base navale', pos: [14.676, -17.425] },
    { id: 'stlouis', name: 'Saint-Louis', pos: [16.03, -16.52] },
    { id: 'joal', name: 'Port de pêche de Joal', pos: [14.165, -16.878] },
    { id: 'kafountine', name: 'Port de pêche de Kafountine', pos: [12.93, -16.772] },
    { id: 'ziguinchor', name: 'Ziguinchor', pos: [12.583, -16.272] },
  ];
  const airbases = [
    { id: 'ouakam', name: 'Base aérienne de Ouakam', pos: [14.742, -17.49] },
    { id: 'thies', name: 'Base aérienne de Thiès', pos: [14.79, -16.93] },
  ];

  // Aires marines protégées (cercles indicatifs)
  const amps = [
    { id: 'amp-sl', name: 'AMP de Saint-Louis', pos: [15.98, -16.585], rNm: 3.5 },
    { id: 'amp-ky', name: 'AMP de Kayar', pos: [14.94, -17.19], rNm: 3.5 },
    { id: 'amp-jf', name: 'AMP de Joal-Fadiouth', pos: [14.10, -16.9], rNm: 3.5 },
    { id: 'amp-sg', name: 'AMP de Sangomar', pos: [13.83, -16.82], rNm: 4.5 },
    { id: 'amp-ab', name: 'AMP d\'Abéné', pos: [13.05, -16.78], rNm: 3 },
  ];

  // Installations en mer (positions indicatives) : zone de sécurité de 500 m
  const installations = [
    { id: 'fpso-sgm', name: 'FPSO Léopold Sédar Senghor', field: 'Champ de Sangomar', pos: [13.76, -17.60], heading: 205, lengthM: 330, safetyM: 500 },
    { id: 'fpso-gta', name: 'FPSO GTA', field: 'Grand Tortue Ahmeyim', pos: [16.05, -16.92], heading: 190, lengthM: 270, safetyM: 500 },
    { id: 'flng-gta', name: 'FLNG Gimi', field: 'Terminal GTA', pos: [16.055, -16.61], heading: 180, lengthM: 290, safetyM: 500 },
  ];

  // Câbles sous-marins (tracés indicatifs depuis les atterrages de Dakar)
  const cables = [
    { id: 'c-eu', name: 'Câbles vers l\'Europe', line: [[14.745, -17.53], [14.95, -17.85], [15.5, -18.55], [16.4, -19.5], [18.7, -21.2]] },
    { id: 'c-cv', name: 'Câble vers le Cap-Vert', line: [[14.737, -17.535], [14.8, -18.2], [14.95, -19.6], [14.95, -23.6]] },
    { id: 'c-sa', name: 'Câbles vers le golfe de Guinée et l\'Amérique du Sud', line: [[14.722, -17.535], [14.55, -17.95], [14.0, -18.7], [12.8, -19.7], [10.4, -20.8]] },
  ];
  // Zone de mouillage de la rade de Dakar (indicative)
  const anchorage = { name: 'Zone de mouillage de la rade de Dakar', poly: [[14.665, -17.392], [14.662, -17.30], [14.612, -17.30], [14.61, -17.385], [14.665, -17.392]] };

  // Stations AIS côtières (portée ~40 milles)
  const aisStations = [
    { name: 'Dakar', pos: [14.65, -17.43] },
    { name: 'Saint-Louis', pos: [16.02, -16.5] },
    { name: 'Kayar', pos: [14.92, -17.12] },
    { name: 'Joal', pos: [14.17, -16.86] },
    { name: 'Cap Skirring', pos: [12.39, -16.75] },
  ];
  const AIS_RANGE_NM = 42;

  // Plages de départ surveillées (émigration irrégulière)
  // watch : point de veille en mer, d'où un drone de surface observe la plage sans s'échouer.
  const beaches = [
    { name: 'Dionewar (îles du Saloum)', pos: [13.885, -16.738], watch: [13.84, -16.86] },
    { name: 'Djiffer', pos: [13.96, -16.765], watch: [13.93, -16.86] },
    { name: 'Mbour', pos: [14.41, -16.975], watch: [14.37, -17.03] },
    { name: 'Saint-Louis (Guet Ndar)', pos: [16.03, -16.515], watch: [16.03, -16.56] },
    { name: 'Kafountine', pos: [12.93, -16.77], watch: [12.93, -16.82] },
    { name: 'Cap Skirring', pos: [12.395, -16.775], watch: [12.395, -16.82] },
  ];

  // ---------- Moyens ----------
  const assets = [
    {
      id: 'USV-01', name: 'DIAMBAR-01', type: 'usv', base: [14.676, -17.415], baseName: 'Dakar', kn: 14, enduranceH: 36, readyMin: 10, turnMin: 90, detectLarge: 8, detectSmall: 3, identify: 1.2,
      // Patrouille de nuit au large de la Petite Côte, à vitesse économique
      patrol: [{ from: T('20:30'), until: T('05:30'), route: [[14.5, -17.5], [14.2, -17.55], [13.95, -17.62], [14.05, -17.8], [14.35, -17.72]], kn: 8 }],
    },
    { id: 'USV-02', name: 'DIAMBAR-02', type: 'usv', base: [14.165, -16.885], baseName: 'Joal', kn: 14, enduranceH: 36, readyMin: 10, turnMin: 90, detectLarge: 8, detectSmall: 3, identify: 1.2 },
    { id: 'USV-03', name: 'DIAMBAR-03', type: 'usv', base: [16.03, -16.53], baseName: 'Saint-Louis', kn: 14, enduranceH: 36, readyMin: 10, turnMin: 90, detectLarge: 8, detectSmall: 3, identify: 1.2 },
    { id: 'USV-04', name: 'DIAMBAR-04', type: 'usv', base: [12.93, -16.775], baseName: 'Kafountine', kn: 14, enduranceH: 36, readyMin: 10, turnMin: 90, detectLarge: 8, detectSmall: 3, identify: 1.2 },
    { id: 'DRN-GN', name: 'Drone de la Gendarmerie', short: 'Drone Gendarmerie', type: 'drone', base: [14.742, -17.49], baseName: 'Ouakam', kn: 75, enduranceH: 6, readyMin: 15, turnMin: 60, detectLarge: 10, detectSmall: 7, identify: 2.5 },
    { id: 'DRN-AA', name: 'Drone de l\'Armée de l\'air', short: 'Drone Armée de l\'air', type: 'drone', base: [14.79, -16.93], baseName: 'Thiès', kn: 80, enduranceH: 8, readyMin: 15, turnMin: 60, detectLarge: 10, detectSmall: 7, identify: 2.5 },
    { id: 'MPA', name: 'Avion de patrouille maritime', short: 'Avion CN-235', type: 'mpa', base: [14.742, -17.49], baseName: 'Ouakam', kn: 200, enduranceH: 6, readyMin: 120, turnMin: 180, detectLarge: 30, detectSmall: 9, identify: 3 },
    {
      id: 'OPV-WALO', name: 'Walo', short: 'Walo', type: 'opv', base: [14.6815, -17.4185], baseName: 'Dakar', kn: 18, enduranceH: 1080, readyMin: 0, turnMin: 0, detectLarge: 20, detectSmall: 6, identify: 2,
      patrol: [{ until: 99999, route: [[15.0, -17.75], [15.55, -17.9], [15.6, -18.35], [15.05, -18.3]], kn: 11 }], startAt: [15.2, -17.8],
    },
    {
      id: 'OPV-NIANI', name: 'Niani', short: 'Niani', type: 'opv', base: [14.6815, -17.4185], baseName: 'Dakar', kn: 18, enduranceH: 1080, readyMin: 0, turnMin: 0, detectLarge: 20, detectSmall: 6, identify: 2,
      patrol: [
        { until: T('15:00'), route: [[12.55, -17.05], [12.95, -17.3], [12.75, -17.7], [12.45, -17.45]], kn: 11 },
        { until: 99999, route: [[13.95, -17.15], [14.3, -17.3], [14.15, -17.5], [13.85, -17.4]], kn: 10 },
      ], startAt: [12.7, -17.2],
    },
    { id: 'OPV-CAYOR', name: 'Cayor', short: 'Cayor', type: 'opv', base: [14.6835, -17.417], baseName: 'Dakar', kn: 18, enduranceH: 1080, readyMin: 0, turnMin: 0, detectLarge: 20, detectSmall: 6, identify: 2, maintenance: true },
    { id: 'VED-RETBA', name: 'Lac Retba', short: 'Lac Retba', type: 'vedette', base: [14.6745, -17.4165], baseName: 'Dakar', kn: 28, enduranceH: 10, readyMin: 15, turnMin: 60, detectLarge: 8, detectSmall: 4, identify: 1.5 },
  ];
  const assetTypeLabel = { usv: 'Drone de surface DIAMBAR', drone: 'Drone aérien de l\'État', mpa: 'Avion de patrouille maritime CN-235', opv: 'Patrouilleur de haute mer', vedette: 'Vedette rapide de la Marine' };

  // ---------- Registres ----------
  // Navires autorisés (DPSP) : licence au-delà de 12 milles.
  const registry = [
    { name: 'SIM HAI LONG 7', imo: 'SIM-8100417', mmsi: '663100417', flag: 'Sénégal', kind: 'trawler', lengthM: 62, licence: 'Pêche pélagique hauturière', vms: 'VMS-0417' },
    { name: 'SIM MARLIN 3', imo: 'SIM-8100233', mmsi: '663100233', flag: 'Sénégal', kind: 'longliner', lengthM: 45, licence: 'Thonière, ZEE et haute mer', vms: 'VMS-0233' },
    { name: 'SIM CAP VERT 12', imo: 'SIM-8100612', mmsi: '663100612', flag: 'Sénégal', kind: 'trawler', lengthM: 38, licence: 'Démersale côtière', vms: 'VMS-0612' },
    { name: 'SIM LOMPOUL', imo: 'SIM-8100105', mmsi: '663100105', flag: 'Sénégal', kind: 'trawler', lengthM: 41, licence: 'Démersale côtière', vms: 'VMS-0105' },
    { name: 'SIM OCEAN HUNTER', imo: 'SIM-8100808', mmsi: '663100808', flag: 'Sénégal', kind: 'seiner', lengthM: 58, licence: 'Pêche pélagique hauturière', vms: 'VMS-0808' },
    { name: 'SIM NDAR', imo: 'SIM-8100101', mmsi: '663100101', flag: 'Sénégal', kind: 'trawler', lengthM: 55, licence: 'Pêche pélagique hauturière', vms: 'VMS-0101' },
    { name: 'SIM GORÉE', imo: 'SIM-8100102', mmsi: '663100102', flag: 'Sénégal', kind: 'seiner', lengthM: 48, licence: 'Pêche pélagique côtière', vms: 'VMS-0102' },
    { name: 'SIM SALOUM', imo: 'SIM-8100103', mmsi: '663100103', flag: 'Sénégal', kind: 'trawler', lengthM: 36, licence: 'Démersale côtière', vms: 'VMS-0103' },
    { name: 'SIM KAYAR', imo: 'SIM-8100104', mmsi: '663100104', flag: 'Sénégal', kind: 'longliner', lengthM: 32, licence: 'Démersale profonde', vms: 'VMS-0104' },
    { name: 'SIM SINE', imo: 'SIM-8100106', mmsi: '663100106', flag: 'Sénégal', kind: 'seiner', lengthM: 44, licence: 'Pêche pélagique côtière', vms: 'VMS-0106' },
    { name: 'SIM CASAMANCE', imo: 'SIM-8100107', mmsi: '663100107', flag: 'Sénégal', kind: 'trawler', lengthM: 34, licence: 'Crevettière', vms: 'VMS-0107' },
    { name: 'SIM THIAROYE', imo: 'SIM-8100108', mmsi: '663100108', flag: 'Sénégal', kind: 'poleline', lengthM: 30, licence: 'Thonière (canne)', vms: 'VMS-0108' },
    { name: 'SIM RUFISQUE', imo: 'SIM-8100109', mmsi: '663100109', flag: 'Sénégal', kind: 'trawler', lengthM: 52, licence: 'Pêche pélagique hauturière', vms: 'VMS-0109' },
  ];
  // Listes INN des organisations régionales de pêche (entrées fictives)
  const iuuList = [
    { name: 'SIM ORIENT 66', imo: 'SIM-7700215', source: 'Liste INN de l\'ICCAT (fictive)', since: 2011, note: 'Palangrier, a changé plusieurs fois de nom et de pavillon' },
    { name: 'SIM BLUE HORIZON', imo: 'SIM-7700533', source: 'Liste INN de l\'ICCAT (fictive)', since: 2020, note: 'Pêche sans autorisation en haute mer' },
    { name: 'SIM MEGA 2', imo: 'SIM-7700076', source: 'Liste INN de l\'ICCAT (fictive)', since: 2021, note: 'Navire sans nationalité' },
  ];
  // Navires de servitude autorisés dans les zones de sécurité des installations
  const authorizedSupply = ['SIM-9500801', 'SIM-9500802'];

  // ---------- Satellites ----------
  // Bandes de passage : axe [lat, lon] de a vers b, demi-largeur en km.
  const satPasses = [
    { t: T('06:48'), sensor: 'radar', kind: 'S1', name: 'Sentinel-1', detail: 'radar, passage descendant', swath: { a: [18.7, -17.3], b: [10.4, -18.6], halfKm: 125 } },
    { t: T('11:40'), sensor: 'optique', kind: 'S2', name: 'Sentinel-2', detail: 'image optique', swath: { a: [18.7, -17.6], b: [10.4, -18.4], halfKm: 145 } },
    { t: T('18:52'), sensor: 'radar', kind: 'S1', name: 'Sentinel-1', detail: 'radar, passage ascendant', swath: { a: [10.4, -17.1], b: [18.7, -18.9], halfKm: 125 } },
    { t: T('02:10'), sensor: 'radar', kind: 'COM', name: 'Radar commercial', detail: 'acquisition programmée sur le Saloum', box: { c: [13.95, -17.0], halfKm: 32 } },
    { t: T('04:40'), sensor: 'radar', kind: 'COM', name: 'Radar commercial', detail: 'acquisition programmée sur la Petite Côte', box: { c: [14.08, -17.2], halfKm: 32 } },
  ];

  // ---------- Scénario : navires acteurs ----------
  const FPSO_SGM = installations[0].pos;
  const actors = [
    // 1. Pollution : dégazage de nuit, repéré par Sentinel-1 à 06:48
    {
      id: 'nordic', name: 'SIM NORDIC STAR', imo: 'SIM-9301144', mmsi: '636019944', flag: 'Libéria', kind: 'tanker', lengthM: 183, dest: 'LAGOS',
      hasAis: true, spawn: PRE_MIN, start: [16.05, -18.05], discharge: { from: P('04:25'), to: P('05:30') },
      plan: [{ kind: 'path', pts: [[15.0, -18.25], [13.8, -18.5], [12.5, -18.55], [10.3, -18.4]], kn: 13 }],
      violations: ['OIL_SLICK'],
      story: 'Pétrolier en transit qui vidange ses cuves en mer de 04 h 25 à 05 h 30, à 70 milles au nord-ouest de Dakar.',
      observations: 'Nappe d\'hydrocarbures confirmée : irisations sur environ 25 km de long et 300 m de large, alignée avec la route suivie par SIM NORDIC STAR à 04 h 25.',
    },
    // 2. Incursion d'un chalutier étranger sans licence, venu de Guinée-Bissau
    {
      id: 'falcon', name: 'SIM SEA FALCON', imo: 'SIM-8700512', mmsi: '630870512', flag: 'Guinée-Bissau', kind: 'trawler', lengthM: 52, dest: 'BISSAU',
      hasAis: true, spawn: 0, start: [12.1, -17.7],
      plan: [
        { kind: 'goto', to: [12.6, -17.35], kn: 10 },
        { kind: 'trawl', until: T('14:30'), kn: 3.5, len: 5, dir: 25 },
        { kind: 'path', pts: [[12.2, -17.8], [11.6, -18.2]], kn: 11 },
      ],
      violations: ['NO_LICENCE'],
      story: 'Chalutier sous pavillon de Guinée-Bissau qui remonte de la zone commune et pêche sans licence au large de la Casamance, transpondeur allumé.',
      observations: 'Chalutier SIM SEA FALCON, pavillon de Guinée-Bissau, chalut à l\'eau. Aucune licence sénégalaise ni autorisation de la zone commune.',
    },
    // 3. Chalutier autorisé qui pêche dans l'AMP de Kayar
    {
      id: 'lompoul', name: 'SIM LOMPOUL', imo: 'SIM-8100105', mmsi: '663100105', vmsId: 'VMS-0105', flag: 'Sénégal', kind: 'trawler', lengthM: 41, dest: 'DAKAR',
      hasAis: true, spawn: PRE_MIN, start: [15.06, -17.55],
      plan: [
        { kind: 'trawl', until: T('08:50'), kn: 3.5, len: 4, dir: 30 },
        { kind: 'goto', to: [14.945, -17.2], kn: 9 },
        { kind: 'trawl', until: T('13:40'), kn: 3.2, len: 2.2, dir: 50 },
        { kind: 'goto', to: [15.06, -17.55], kn: 10 },
        { kind: 'trawl', until: 99999, kn: 3.5, len: 4, dir: 30 },
      ],
      violations: ['AMP', 'ZONE_6', 'ZONE_LIC'],
      story: 'Chalutier autorisé au-delà de 12 milles qui vient chaluter en plein jour dans l\'aire marine protégée de Kayar.',
      observations: 'Chalutier SIM LOMPOUL en pêche dans l\'aire marine protégée de Kayar, chalut de fond à l\'eau, à 3 milles de la côte.',
    },
    // 4. Identité AIS clonée : un chalutier inconnu émet l'identité de SIM NDAR
    {
      id: 'rover', name: 'SIM OCEAN ROVER', imo: 'SIM-8700733', mmsi: '000000000', flag: 'Inconnu', kind: 'trawler', lengthM: 47,
      hasAis: true, spawn: T('11:30'), start: [12.52, -17.92],
      cloneOf: { name: 'SIM NDAR', imo: 'SIM-8100101', mmsi: '663100101', kind: 'trawler', lengthM: 55 },
      plan: [
        { kind: 'goto', to: [12.86, -17.62], kn: 11 },
        { kind: 'trawl', until: T('17:30'), kn: 3.5, len: 4, dir: 160 },
        { kind: 'path', pts: [[12.3, -18.1], [11.6, -18.6]], kn: 11 },
      ],
      violations: ['MMSI_DUP', 'NO_LICENCE'],
      story: 'Chalutier sans licence qui émet l\'identité AIS d\'un navire autorisé (SIM NDAR) pour pêcher au large de la Casamance sans éveiller les soupçons.',
      observations: 'Chalutier dont la coque porte le nom SIM OCEAN ROVER, alors que son AIS annonce SIM NDAR. Chalut à l\'eau, aucune licence.',
    },
    // 5. Cargo au mouillage sur les câbles sous-marins, ancre traînante
    {
      id: 'baltic', name: 'SIM BALTIC TRADER', imo: 'SIM-9400918', mmsi: '248940918', flag: 'Malte', kind: 'cargo', lengthM: 138, dest: 'DAKAR',
      hasAis: true, spawn: T('12:30'), start: [15.15, -17.85],
      plan: [
        { kind: 'goto', to: [14.818, -17.645], kn: 12 },
        { kind: 'drift', until: T('16:40'), kn: 0.45, brg: 215 },
        { kind: 'path', pts: [[15.3, -17.95], [16.4, -17.95], [18.6, -17.55]], kn: 12 },
      ],
      violations: ['CABLE'],
      story: 'Cargo qui jette l\'ancre hors de la zone de mouillage, au-dessus des câbles sous-marins de Dakar, et dérive en traînant son ancre.',
      observations: 'Cargo SIM BALTIC TRADER au mouillage hors zone autorisée : ancre filée, chaîne tendue, le navire dérive au-dessus du corridor des câbles sous-marins.',
    },
    // 6. Migration : rassemblement, départ de nuit, panne, sauvetage
    {
      id: 'migrants', name: 'Pirogue non immatriculée', kind: 'pirogue', lengthM: 22, persons: 140, migrants: true,
      hasAis: false, spawn: PRE_MIN, start: [13.885, -16.738],
      plan: [
        { kind: 'hold', until: T('22:15'), still: true },
        { kind: 'path', pts: [[13.835, -16.8], [13.98, -17.05], [14.22, -17.42], [14.6, -17.95], [15.5, -19.0]], kn: 7 },
      ],
      events: [
        { at: T('16:30'), set: { gathering: true } },
        { at: T('22:15'), set: { gathering: false } },
        { at: T('03:28'), plan: [{ kind: 'drift', until: 99999, kn: 0.7, brg: 210, distress: true }] },
      ],
      violations: ['GATHER', 'DARK_SMALL', 'DISTRESS'],
      story: 'Rassemblement sur la plage de Dionewar en fin d\'après-midi, départ de nuit vers les Canaries avec environ 140 personnes, panne moteur au large vers 03 h 30.',
      observations: 'Pirogue de 22 m, environ 140 personnes à bord dont des femmes et des enfants. Moteur à l\'arrêt, l\'embarcation dérive. Secours immédiat nécessaire.',
      obsGather: 'Rassemblement observé depuis le large à la caméra infrarouge : une vingtaine de pirogues tirées sur la plage, des groupes de personnes et des bidons de carburant.',
      obsTransit: 'Pirogue de 22 m chargée d\'environ 140 personnes, sans feux, cap au nord-ouest à 7 nœuds.',
    },
    // 7. Transbordement entre un palangrier autorisé et un frigorifique sans AIS
    {
      id: 'marlin', name: 'SIM MARLIN 3', imo: 'SIM-8100233', mmsi: '663100233', vmsId: 'VMS-0233', flag: 'Sénégal', kind: 'longliner', lengthM: 45, dest: 'DAKAR',
      hasAis: true, spawn: PRE_MIN, start: [14.3, -18.2],
      plan: [
        { kind: 'loiter', until: T('19:00'), kn: 3.5, r: 4 },
        { kind: 'goto', to: [14.55, -18.75], kn: 9 },
        { kind: 'hold', until: T('01:35') },
        { kind: 'goto', to: [14.25, -18.35], kn: 9 },
        { kind: 'loiter', until: 99999, kn: 3, r: 4 },
      ],
      violations: ['LOITER_OFFSHORE', 'TRANSSHIP'],
      story: 'Palangrier autorisé qui retrouve en pleine nuit un navire frigorifique sans transpondeur pour lui transférer sa pêche hors de tout contrôle.',
      observations: 'Deux navires amarrés bord à bord. Caisses de poisson transférées du palangrier SIM MARLIN 3 vers le frigorifique.',
    },
    {
      id: 'polar', name: 'SIM POLAR STAR', imo: 'SIM-9300881', mmsi: '352930881', flag: 'Panama', kind: 'reefer', lengthM: 92, nameHidden: true,
      hasAis: true, aisOn: false, spawn: T('14:05'), start: [15.7, -19.45],
      plan: [
        { kind: 'goto', to: [14.552, -18.755], kn: 11 },
        { kind: 'hold', until: T('01:40') },
        { kind: 'path', pts: [[15.9, -19.9], [17.5, -21.0]], kn: 11 },
      ],
      violations: ['DARK_LARGE', 'TRANSSHIP'],
      story: 'Navire frigorifique sans licence, transpondeur éteint, venu récupérer du poisson en mer.',
      observations: 'Frigorifique de 92 m, AIS éteint, nom masqué. Il fait route vers la zone des palangriers.',
    },
    // 8. Chalutier « sombre » dans la bande des 6 milles devant Saint-Louis
    {
      id: 'hailong', name: 'SIM HAI LONG 7', imo: 'SIM-8100417', mmsi: '663100417', vmsId: 'VMS-0417', flag: 'Sénégal', kind: 'trawler', lengthM: 62, dest: 'SAINT-LOUIS',
      hasAis: true, spawn: PRE_MIN, start: [15.75, -17.05],
      plan: [
        { kind: 'trawl', until: T('20:00'), kn: 3.5, len: 4, dir: 20 },
        { kind: 'goto', to: [15.85, -16.595], kn: 11 },
        { kind: 'trawl', until: T('02:30'), kn: 3.2, len: 2.4, dir: 20 },
        { kind: 'goto', to: [15.75, -17.05], kn: 11 },
        { kind: 'trawl', until: 99999, kn: 3.5, len: 4, dir: 20 },
      ],
      events: [{ at: T('21:15'), set: { aisOn: false } }, { at: T('21:25'), set: { vmsOn: false } }, { at: T('03:50'), set: { aisOn: true, vmsOn: true } }],
      violations: ['AIS_OFF', 'VMS_SILENT', 'ZONE_6', 'ZONE_LIC'],
      story: 'Chalutier autorisé au-delà de 12 milles. Il coupe son AIS en approchant de la côte, puis sa balise VMS, et chalute dans la bande des 6 milles réservée aux pirogues de Saint-Louis.',
      observations: 'Chalut de fond à l\'eau à 4 milles de la côte. Nom et numéro OMI lisibles. Captures sur le pont.',
    },
    // 9. Navire inscrit sur une liste INN, rebaptisé, en approche de Dakar
    {
      id: 'seagrace', name: 'SIM SEA GRACE', imo: 'SIM-7700215', mmsi: '671770215', flag: 'Togo', kind: 'longliner', lengthM: 48, dest: 'DAKAR',
      hasAis: true, spawn: T('23:00'), start: [14.45, -18.2],
      plan: [
        { kind: 'path', pts: [[14.6, -17.62], [14.64, -17.48]], kn: 10 },
        { kind: 'hold', until: 99999, still: true },
      ],
      violations: ['PORT_IUU'],
      story: 'Palangrier inscrit sur une liste INN sous un ancien nom (SIM ORIENT 66). Il a changé de nom mais garde le même numéro OMI et demande à entrer au port de Dakar.',
      observations: 'Numéro OMI SIM-7700215 lu sur la coque, identique à celui de SIM ORIENT 66 (liste INN). Thon congelé à bord.',
    },
    // 10. Balise VMS laissée sur une pirogue d'appui
    {
      id: 'capvert', name: 'SIM CAP VERT 12', imo: 'SIM-8100612', mmsi: '663100612', vmsId: 'VMS-0612', flag: 'Sénégal', kind: 'trawler', lengthM: 38, dest: 'DAKAR',
      hasAis: true, spawn: PRE_MIN, start: [13.95, -17.75],
      vmsGhost: { from: T('22:50'), center: [13.95, -17.75] },
      plan: [
        { kind: 'trawl', until: T('23:00'), kn: 3.2, len: 3, dir: 160 },
        { kind: 'goto', to: [14.4, -17.06], kn: 11 },
        { kind: 'trawl', until: T('05:30'), kn: 3, len: 1.6, dir: 15 },
        { kind: 'goto', to: [13.95, -17.75], kn: 11 },
        { kind: 'trawl', until: 99999, kn: 3.2, len: 3, dir: 160 },
      ],
      violations: ['VMS_AIS_GAP', 'ZONE_6', 'ZONE_LIC'],
      story: 'Chalutier autorisé qui laisse sa balise VMS sur une pirogue d\'appui au large pendant qu\'il va chaluter dans la bande des 6 milles devant Mbour. Son AIS, resté allumé, le trahit.',
      observations: 'Chalutier en pêche à moins de 4 milles de Mbour. Aucune balise VMS active à bord. La balise se trouve sur une pirogue d\'appui à 30 milles.',
    },
    {
      id: 'appui', name: 'Pirogue d\'appui', kind: 'pirogue', lengthM: 16, persons: 4, hasAis: false, spawn: T('22:20'), start: [13.99, -17.7],
      plan: [{ kind: 'goto', to: [13.95, -17.75], kn: 6 }, { kind: 'loiter', until: 99999, kn: 2, r: 1.5 }],
      violations: ['DARK_SMALL'], linkedTo: 'capvert', linkNote: 'la balise VMS de SIM CAP VERT 12 est retrouvée à bord d\'une pirogue d\'appui, à 30 milles du chalutier.',
      story: 'Pirogue qui transporte la balise VMS du chalutier SIM CAP VERT 12.',
      observations: 'Pirogue d\'appui avec 4 hommes à bord. Un boîtier de balise VMS est posé sur le banc : c\'est celui de SIM CAP VERT 12.',
    },
    // 11. Intrusion dans la zone de sécurité de la plateforme de Sangomar
    {
      id: 'hunter', name: 'SIM OCEAN HUNTER', imo: 'SIM-8100808', mmsi: '663100808', vmsId: 'VMS-0808', flag: 'Sénégal', kind: 'seiner', lengthM: 58, dest: 'DAKAR',
      hasAis: true, spawn: PRE_MIN, start: [13.62, -17.82],
      plan: [
        { kind: 'loiter', until: T('23:45'), kn: 3.5, r: 5 },
        { kind: 'goto', to: [FPSO_SGM[0] - 0.0025, FPSO_SGM[1] - 0.002], kn: 9 },
        { kind: 'loiter', until: T('03:30'), kn: 1.2, r: 0.12 },
        { kind: 'goto', to: [13.6, -17.85], kn: 9 },
        { kind: 'loiter', until: 99999, kn: 3, r: 4 },
      ],
      violations: ['SAFETY_ZONE'],
      story: 'Senneur autorisé qui vient pêcher de nuit sous la plateforme de Sangomar, attiré par les bancs de poissons que concentrent ses lumières.',
      observations: 'Senneur SIM OCEAN HUNTER en pêche à 300 m de la plateforme, filet tournant à l\'eau, projecteurs allumés pour attirer le poisson.',
    },
    // 12. Trafic : position AIS falsifiée, rendez-vous et go-fast vers la côte
    {
      id: 'golden', name: 'SIM GOLDEN WAVE', imo: 'SIM-9700145', mmsi: '378970145', flag: 'Îles Vierges', kind: 'yacht', lengthM: 26, dest: 'LAS PALMAS',
      hasAis: true, spawn: T('00:00'), start: [13.82, -18.2],
      spoof: { from: T('02:00'), to: T('03:30'), brg: 280, nm: 24 },
      plan: [
        { kind: 'goto', to: [13.93, -17.48], kn: 11 },
        { kind: 'hold', until: T('04:10') },
        { kind: 'path', pts: [[13.6, -18.8], [13.2, -20.5]], kn: 12 },
      ],
      events: [{ at: T('03:30'), set: { aisOn: false } }],
      violations: ['SPOOF', 'AIS_OFF', 'DARK_LARGE'],
      story: 'Yacht qui transporte de la cocaïne. Il falsifie sa position AIS, l\'éteint, puis transfère sa cargaison à un go-fast au large de la Petite Côte.',
      observations: 'Yacht de 26 m, ballots suspects sur le pont arrière, aucune réponse aux appels VHF. Intervention de la Marine recommandée.',
    },
    {
      id: 'gofast', name: 'Go-fast', kind: 'gofast', lengthM: 12, hasAis: false, spawn: T('03:25'), start: [13.81, -17.53],
      plan: [
        { kind: 'goto', to: [13.928, -17.474], kn: 20 },
        { kind: 'hold', until: T('04:10') },
        { kind: 'goto', to: [14.02, -16.774], kn: 34 },
        { kind: 'hold', until: T('05:45'), still: true },
      ],
      despawn: T('05:45'),
      violations: ['GO_FAST'],
      story: 'Go-fast de 12 m qui récupère la drogue au rendez-vous et file à 34 nœuds vers la plage de Palmarin.',
      observations: 'Go-fast de 12 m, trois moteurs hors-bord, chargé de ballots, cap sur la plage de Palmarin.',
      obsLanded: 'Go-fast de 12 m échoué sur la plage de Palmarin. Les ballots sont chargés dans deux véhicules tout-terrain. Images transmises en direct à la Gendarmerie.',
    },
    // 13. Recherche et sauvetage : pirogue de pêche en panne, signalée par le quai de Kayar
    {
      id: 'disparus', name: 'Pirogue de pêche (Kayar)', kind: 'pirogue', lengthM: 14, persons: 7, hasAis: false,
      spawn: P('05:40'), start: [14.925, -17.145], colors: ['#1e8449', '#f4d03f', '#c0392b'],
      plan: [
        { kind: 'goto', to: [15.08, -17.47], kn: 8 },
        { kind: 'loiter', until: T('10:20'), kn: 1.5, r: 1 },
        { kind: 'drift', until: 99999, kn: 0.6, brg: 200, distress: true },
      ],
      signal: {
        at: T('16:20'), source: 'Quai de pêche de Kayar, relayé par la HASSMAR', persons: 7,
        text: 'Pirogue de pêche non rentrée : 7 pêcheurs à bord, partie de Kayar vers 05 h 40 pour la fosse de Kayar. Aucun contact radio depuis le matin.',
        area: [15.05, -17.43], since: P('05:40'),
      },
      violations: ['MISSING', 'DISTRESS'],
      story: 'Pirogue de pêche partie de Kayar avant l\'aube. Panne de moteur au large vers 10 h 20 : sans radio, l\'équipage dérive. Les familles donnent l\'alerte en fin d\'après-midi.',
      observations: 'Pirogue de pêche de 14 m, moteur en panne, 7 pêcheurs à bord qui agitent un vêtement. Pas de blessé apparent, plus d\'eau potable.',
    },
    // 14. Fausse alerte : panne AIS d'un porte-conteneurs
    {
      id: 'atlantic', name: 'SIM ATLANTIC TRADER', imo: 'SIM-9400322', mmsi: '255940322', flag: 'Portugal', kind: 'container', lengthM: 180, dest: 'ABIDJAN',
      hasAis: true, spawn: T('13:00'), start: [16.4, -17.95],
      plan: [{ kind: 'path', pts: [[15.2, -18.15], [14.3, -18.3], [13.0, -18.45], [10.3, -18.3]], kn: 13 }],
      events: [{ at: T('15:45'), set: { aisOn: false } }, { at: T('19:45'), set: { aisOn: true } }],
      violations: [],
      story: 'Porte-conteneurs en route vers le sud. Son transpondeur AIS tombe en panne pendant quatre heures. Fausse alerte.',
      observations: 'Porte-conteneurs sur sa route habituelle. Le capitaine signale par VHF une panne du transpondeur AIS.',
      benign: 'Panne technique du transpondeur, signalée par le capitaine. Aucune infraction.',
    },
    // 15. Fausse alerte : pirogue de pêche partie de nuit
    {
      id: 'pecheurs', name: 'Pirogue de pêche (Joal)', kind: 'pirogue', lengthM: 18, persons: 9, hasAis: false, spawn: T('03:00'), start: [14.165, -16.878],
      plan: [{ kind: 'goto', to: [14.05, -17.18], kn: 8 }, { kind: 'loiter', until: 99999, kn: 1.5, r: 1 }],
      violations: [],
      story: 'Pirogue de pêche artisanale en règle, partie de Joal avant l\'aube vers des fonds éloignés.',
      observations: 'Pirogue de pêche avec 9 pêcheurs, filets maillants réglementaires, permis de pêche artisanale présenté.',
      benign: 'Pirogue de pêche en règle partie de Joal. Aucune infraction.',
    },
  ];

  // ---------- Trafic de fond (déterministe) ----------
  const lanes = {
    S: [[18.6, -17.55], [16.4, -17.95], [15.2, -18.15], [14.3, -18.3], [13.0, -18.45], [10.3, -18.3]],
    N: [[10.3, -18.0], [13.0, -18.15], [14.3, -18.0], [15.2, -17.85], [16.4, -17.65], [18.6, -17.25]],
    OS: [[18.6, -19.1], [14.5, -19.6], [10.3, -20.0]],
    ON: [[10.3, -20.4], [14.5, -20.05], [18.6, -19.55]],
  };
  const merchantNames = {
    container: ['SIM RUFISQUE EXPRESS', 'SIM SAHEL BRIDGE', 'SIM TERANGA STAR', 'SIM GORÉE LINE', 'SIM CASAMANCE BAY', 'SIM ALMADIES', 'SIM MADELEINE', 'SIM NIOKOLO', 'SIM KEDOUGOU', 'SIM BAMBEY'],
    bulk: ['SIM BAOBAB', 'SIM SINE SALOUM', 'SIM PODOR', 'SIM MATAM', 'SIM LINGUERE', 'SIM TAMBA', 'SIM KOLDA'],
    tanker: ['SIM OCEAN AMBER', 'SIM DELTA PRIDE', 'SIM ATLAS SPIRIT', 'SIM SOLENA', 'SIM HELIOS'],
    cargo: ['SIM FATICK', 'SIM LOUGA', 'SIM DIOURBEL', 'SIM KAFFRINE', 'SIM SEDHIOU'],
    reefer: ['SIM ARCTIC BAY', 'SIM FROST LINE'],
  };
  const flags = ['Panama', 'Libéria', 'Malte', 'Îles Marshall', 'Singapour', 'Portugal', 'Grèce', 'Chypre', 'Bahamas', 'Norvège'];
  const dests = { S: ['ABIDJAN', 'LOMÉ', 'LAGOS', 'TEMA', 'POINTE-NOIRE', 'SANTOS'], N: ['LAS PALMAS', 'ALGÉSIRAS', 'ROTTERDAM', 'TANGER MED', 'LE HAVRE'], OS: ['SANTOS', 'BUENOS AIRES', 'LE CAP', 'RIO DE JANEIRO'], ON: ['ROTTERDAM', 'ANVERS', 'HAMBOURG', 'LAS PALMAS'] };

  function background(rand) {
    const out = [];
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const used = new Set();
    const uniqueName = (kind) => {
      for (let k = 0; k < 30; k++) { const n = pick(merchantNames[kind]); if (!used.has(n)) { used.add(n); return n; } }
      const n = pick(merchantNames[kind]) + ' ' + (2 + Math.floor(rand() * 8)); used.add(n); return n;
    };
    let seq = 0;
    const lens = { container: [160, 260], bulk: [150, 220], tanker: [150, 240], cargo: [100, 150], reefer: [110, 150] };
    // Navires de commerce sur les routes côtières et hauturières
    for (const [lane, interval] of [['S', 190], ['N', 200], ['OS', 260], ['ON', 280]]) {
      for (let ts = -2400 + rand() * interval; ts < END_MIN; ts += interval * (0.7 + rand() * 0.7)) {
        const r = rand();
        const kind = r < 0.38 ? 'container' : r < 0.62 ? 'bulk' : r < 0.82 ? 'tanker' : r < 0.95 ? 'cargo' : 'reefer';
        const [l0, l1] = lens[kind];
        seq++;
        out.push({
          id: 'bg-m' + seq, name: uniqueName(kind), imo: 'SIM-95' + String(10000 + seq * 397).slice(-5), mmsi: String(200000000 + seq * 7919),
          flag: pick(flags), kind, lengthM: Math.round(l0 + rand() * (l1 - l0)), dest: pick(dests[lane]),
          hasAis: true, route: { pts: lanes[lane], kn: 11.5 + rand() * 4, t0: ts }, violations: [], benign: 'Navire marchand en transit, en règle.',
        });
      }
    }
    // Navires au mouillage en rade de Dakar (cap au vent de NNE)
    [[14.64, -17.34], [14.63, -17.37], [14.652, -17.322], [14.62, -17.35], [14.655, -17.36], [14.636, -17.315], [14.646, -17.38], [14.624, -17.325]].forEach((p, i) => {
      const kind = ['bulk', 'tanker', 'container', 'cargo'][i % 4];
      seq++;
      out.push({
        id: 'bg-a' + i, name: uniqueName(kind === 'cargo' ? 'cargo' : kind), imo: 'SIM-96' + String(10000 + seq * 211).slice(-5), mmsi: String(210000000 + seq * 6271),
        flag: pick(flags), kind, lengthM: Math.round(120 + rand() * 90), dest: 'DAKAR', hasAis: true,
        anchored: { pos: p, heading: 18 + rand() * 10 }, violations: [], benign: 'Navire au mouillage en zone autorisée.',
      });
    });
    // Entrées et sorties du port de Dakar
    const portRoutes = [
      { t0: T('09:10'), pts: [[14.676, -17.425], [14.655, -17.405], [14.62, -17.43], [14.5, -17.62], [14.3, -18.3], [13.0, -18.45], [10.3, -18.3]], kind: 'container', dest: 'ABIDJAN' },
      { t0: T('12:20'), pts: [[16.4, -17.65], [15.2, -17.85], [14.78, -17.62], [14.66, -17.53], [14.62, -17.45], [14.66, -17.41], [14.676, -17.425]], kind: 'bulk', dest: 'DAKAR' },
      { t0: T('17:30'), pts: [[14.676, -17.425], [14.655, -17.405], [14.62, -17.45], [14.7, -17.6], [15.2, -17.85], [16.4, -17.65], [18.6, -17.25]], kind: 'tanker', dest: 'LAS PALMAS' },
      { t0: T('21:40'), pts: [[13.0, -18.15], [14.3, -18.0], [14.55, -17.55], [14.63, -17.4], [14.66, -17.41], [14.676, -17.425]], kind: 'container', dest: 'DAKAR' },
    ];
    portRoutes.forEach((pr, i) => {
      seq++;
      out.push({
        id: 'bg-p' + i, name: uniqueName(pr.kind), imo: 'SIM-97' + String(10000 + seq * 173).slice(-5), mmsi: String(220000000 + seq * 4447),
        flag: pick(flags), kind: pr.kind, lengthM: Math.round(150 + rand() * 80), dest: pr.dest, hasAis: true,
        route: { pts: pr.pts, kn: 12, t0: pr.t0, dockBefore: i % 2 === 0, dockAfter: i % 2 === 1 }, violations: [], benign: 'Navire marchand, en règle.',
      });
    });
    // Ferry Dakar - Ziguinchor (arrivée le matin, départ le soir)
    const ferryPath = [[14.677, -17.421], [14.655, -17.405], [14.6, -17.43], [14.4, -17.42], [14.0, -17.3], [13.55, -17.12], [13.0, -17.0], [12.65, -16.92],
      [12.567, -16.751], [12.627, -16.593], [12.595, -16.431], [12.579, -16.411], [12.559, -16.361], [12.571, -16.349], [12.607, -16.325], [12.597, -16.283], [12.592, -16.276]];
    out.push({ id: 'bg-f1', name: 'SIM CASAMANCE EXPRESS', imo: 'SIM-9800011', mmsi: '663800011', flag: 'Sénégal', kind: 'ferry', lengthM: 98, dest: 'ZIGUINCHOR', hasAis: true, route: { pts: ferryPath, kn: 14, t0: T('19:30'), dockBefore: true, dockAfter: true }, violations: [], benign: 'Ferry de ligne, en règle.' });
    // Ferry parti de Ziguinchor la veille au soir (mardi 21 h 00), arrivée à Dakar vers 06 h 40.
    out.push({ id: 'bg-f2', name: 'SIM ALINE', imo: 'SIM-9800012', mmsi: '663800012', flag: 'Sénégal', kind: 'ferry', lengthM: 92, dest: 'DAKAR', hasAis: true, route: { pts: ferryPath.slice().reverse(), kn: 14, t0: -600, dockAfter: true }, violations: [], benign: 'Ferry de ligne, en règle.' });
    // Chaloupe de Gorée : allers-retours toutes les heures de 07:00 à 22:00
    const goreeTrips = [];
    for (let h = 7; h <= 22; h++) {
      goreeTrips.push({ t0: T(String(h).padStart(2, '0') + ':00'), pts: [[14.676, -17.421], [14.668, -17.405]] });
      goreeTrips.push({ t0: T(String(h).padStart(2, '0') + ':30'), pts: [[14.668, -17.405], [14.676, -17.421]] });
    }
    out.push({ id: 'bg-goree', name: 'SIM COUMBA', imo: 'SIM-9800021', mmsi: '663800021', flag: 'Sénégal', kind: 'shuttle', lengthM: 34, dest: 'GORÉE', hasAis: true, trips: { list: goreeTrips, kn: 8, rest: [14.676, -17.421] }, violations: [], benign: 'Chaloupe de Gorée, en règle.' });
    // Navires de servitude des installations
    out.push({
      id: 'bg-sup1', name: 'SIM SANGOMAR SUPPORT', imo: 'SIM-9500801', mmsi: '663500801', flag: 'Sénégal', kind: 'supply', lengthM: 75, dest: 'SANGOMAR', hasAis: true,
      trips: { list: [
        { t0: T('08:00'), pts: [[14.676, -17.425], [14.62, -17.44], [14.2, -17.55], [FPSO_SGM[0] + 0.006, FPSO_SGM[1] + 0.004]] },
        { t0: T('15:40'), pts: [[FPSO_SGM[0] + 0.006, FPSO_SGM[1] + 0.004], [14.2, -17.55], [14.62, -17.44], [14.676, -17.425]] },
      ], kn: 12, rest: [14.676, -17.425] },
      violations: [], benign: 'Navire de servitude autorisé.',
    });
    out.push({ id: 'bg-sup2', name: 'SIM GTA SUPPORT', imo: 'SIM-9500802', mmsi: '663500802', flag: 'Sénégal', kind: 'supply', lengthM: 70, dest: 'GTA', hasAis: true, loiter: { center: [16.02, -16.72], r: 2.2, kn: 4 }, violations: [], benign: 'Navire de servitude autorisé.' });
    // Remorqueurs du port
    out.push({ id: 'bg-tug1', name: 'SIM BARGNY', imo: 'SIM-9500901', mmsi: '663500901', flag: 'Sénégal', kind: 'tug', lengthM: 32, dest: 'DAKAR', hasAis: true, loiter: { center: [14.662, -17.39], r: 1.2, kn: 4 }, violations: [], benign: 'Remorqueur du port.' });
    // Pêche industrielle autorisée (au-delà de 12 milles)
    const legal = [
      ['SIM NDAR', [15.62, -17.78], 20], ['SIM GORÉE', [14.98, -17.95], 150], ['SIM SALOUM', [14.2, -17.78], 10], ['SIM KAYAR', [15.25, -17.62], 30],
      ['SIM SINE', [13.65, -17.88], 170], ['SIM CASAMANCE', [12.75, -17.25], 40], ['SIM THIAROYE', [14.45, -17.92], 0], ['SIM RUFISQUE', [16.0, -17.3], 20],
    ];
    legal.forEach(([n, p, dir], i) => {
      const r = registry.find((x) => x.name === n);
      out.push({
        id: 'bg-fish' + i, name: n, imo: r.imo, mmsi: r.mmsi, vmsId: r.vms, flag: r.flag, kind: r.kind, lengthM: r.lengthM, dest: 'DAKAR', hasAis: true,
        spawn: PRE_MIN, start: p, plan: [{ kind: r.kind === 'trawler' ? 'trawl' : 'loiter', until: 99999, kn: 3.2 + rand(), len: 4 + rand() * 2, dir, r: 3 }],
        violations: [], benign: 'Navire autorisé, en pêche dans sa zone de licence.',
      });
    });
    // Pêche artisanale : départs à l'aube, quelques sorties de nuit
    const sites = [
      ['Saint-Louis', [16.03, -16.52], 280, 8], ['Lompoul', [15.43, -16.775], 300, 2], ['Kayar', [14.925, -17.145], 290, 9],
      ['Yoff', [14.775, -17.49], 330, 3], ['Soumbédioune', [14.678, -17.48], 250, 3], ['Hann', [14.705, -17.415], 150, 2],
      ['Mbour', [14.405, -16.982], 235, 6], ['Joal', [14.165, -16.885], 250, 7], ['Djiffer', [13.96, -16.775], 260, 3],
      ['Kafountine', [12.93, -16.775], 270, 3], ['Cap Skirring', [12.395, -16.78], 270, 2],
    ];
    const colors = [['#c0392b', '#f1c40f', '#27ae60'], ['#2471a3', '#f4d03f', '#c0392b'], ['#1e8449', '#e67e22', '#2e86c1'], ['#922b21', '#f5b041', '#1abc9c'], ['#6c3483', '#f7dc6f', '#e74c3c']];
    let pseq = 0;
    sites.forEach(([site, start, brg, n]) => {
      for (let k = 0; k < n; k++) {
        const night = k === 0 && ['Saint-Louis', 'Kayar', 'Joal'].includes(site);
        const dep = night ? T('18:20') + rand() * 80 : P('05:30') + rand() * 130;
        const spot = G.move(start, brg + (rand() - 0.5) * 70, 2.5 + rand() * 6.5);
        const kn = 7 + rand() * 2;
        const fish = night ? 560 + rand() * 120 : 330 + rand() * 180;
        pseq++;
        out.push({
          id: 'bg-pir' + pseq, name: 'Pirogue de pêche (' + site + ')', kind: 'pirogue', lengthM: 11 + Math.round(rand() * 9), persons: 4 + Math.floor(rand() * 8), artisanal: true,
          hasAis: false, colors: colors[pseq % colors.length], trip: { start, spot, dep, kn, fish },
          violations: [], benign: 'Pêche artisanale en règle.',
        });
      }
    });
    return out;
  }

  // ---------- Catégories et cas ----------
  const categories = {
    peche: { label: 'Pêche illicite', short: 'Pêche', color: '#0E7490' },
    trafic: { label: 'Trafics', short: 'Trafics', color: '#6D3FC9' },
    migration: { label: 'Migration irrégulière', short: 'Migration', color: '#B45309' },
    sauvetage: { label: 'Recherche et sauvetage', short: 'Sauvetage', color: '#BE123C' },
    surete: { label: 'Sûreté des installations', short: 'Sûreté', color: '#3F4CC2' },
    environnement: { label: 'Environnement', short: 'Pollution', color: '#4D7C0F' },
    fausse: { label: 'Fausses alertes', short: 'Fausses alertes', color: '#64748B' },
  };

  // Cas présentés dans le menu et la démo guidée (t = moment montré, zoom de la carte).
  const cases = [
    { id: 'nordic', cat: 'environnement', title: 'Dégazage repéré par satellite', truth: 'nordic', t: T('08:06'), zoom: 10,
      text: 'À 06 h 48, Sentinel-1 repère une nappe sombre de 25 km au large de Saint-Louis. La plateforme remonte les traces AIS de la nuit, corrige la dérive du courant et désigne le pétrolier passé sur ce tracé à 04 h 25. Le drone de la Gendarmerie confirme la pollution à 08 h 05.' },
    { id: 'lompoul', cat: 'peche', title: 'Chalutage dans l\'AMP de Kayar', truth: 'lompoul', t: T('11:50'), zoom: 11,
      text: 'Un chalutier autorisé au-delà de 12 milles entre dans l\'aire marine protégée de Kayar et met son chalut à l\'eau. Trois indices se cumulent : bande des 6 milles, hors zone de licence, aire protégée. Le drone de la Gendarmerie documente l\'infraction 32 minutes après l\'alerte.' },
    { id: 'falcon', cat: 'peche', title: 'Chalutier étranger sans licence', truth: 'falcon', t: T('12:55'), zoom: 10,
      text: 'Un chalutier sous pavillon de Guinée-Bissau quitte la zone commune et chalute au large de la Casamance, transpondeur allumé. Il est absent du registre des licences : alerte à 10 h 06. Le drone de l\'Armée de l\'air le photographie, puis le patrouilleur Niani l\'arraisonne et le déroute vers Dakar.' },
    { id: 'rover', cat: 'peche', title: 'Identité AIS clonée', truth: 'rover', t: T('13:47'), zoom: 9,
      text: 'Deux émetteurs annoncent le même navire, SIM NDAR, à 180 milles l\'un de l\'autre. La balise VMS du vrai SIM NDAR tranche : celui du sud utilise une identité volée. Le drone lit son vrai nom sur la coque.' },
    { id: 'baltic', cat: 'surete', title: 'Ancre sur les câbles sous-marins', truth: 'baltic', t: T('16:25'), zoom: 12,
      text: 'Un cargo s\'immobilise hors de la zone de mouillage, au-dessus des câbles qui relient Dakar à l\'Europe, et dérive lentement : son ancre traîne. DIAMBAR-01 sort du port, contourne la presqu\'île et confirme sur place.' },
    { id: 'disparus', cat: 'sauvetage', title: 'Pirogue de pêche disparue', truth: 'disparus', t: T('18:28'), zoom: 11,
      text: 'À 16 h 20, le quai de Kayar signale une pirogue non rentrée avec 7 pêcheurs. La plateforme retrouve un contact vu par Sentinel-2 à 11 h 40, calcule sa dérive et y envoie un drone. Les pêcheurs sont en panne, sans eau : la vedette Lac Retba les recueille avant la nuit.' },
    { id: 'polar', cat: 'peche', title: 'Navire sans AIS repéré au radar satellite', truth: 'polar', t: T('20:16'), zoom: 10,
      text: 'Le passage Sentinel-1 de 18 h 52 révèle un navire de 90 m qui n\'émet aucun AIS. La plateforme prolonge sa route à l\'estime, le drone le retrouve et le photographie : un frigorifique au nom masqué.' },
    { id: 'migrants', cat: 'migration', title: 'Rassemblement et départ de pirogue', truth: 'migrants', t: T('22:35'), zoom: 11,
      text: 'Sentinel-1, aidé du modèle entraîné sur les images de drones, repère un rassemblement de pirogues sur la plage de Dionewar à 18 h 52. DIAMBAR-02 se poste au large et suit la pirogue dès son départ, à 22 h 15, sans feux, cap au nord-ouest.' },
    { id: 'hailong', cat: 'peche', title: 'Chalutier sombre devant Saint-Louis', truth: 'hailong', t: T('22:57'), zoom: 11,
      text: 'Le chalutier coupe son AIS en approchant de la côte, puis sa balise VMS. DIAMBAR-03 part de Saint-Louis, le retrouve au radar et le filme en train de chaluter dans la bande des 6 milles réservée aux pirogues.' },
    { id: 'capvert', cat: 'peche', title: 'Balise VMS déplacée', truth: 'capvert', t: T('00:37'), zoom: 10,
      text: 'La balise VMS place le chalutier à 30 milles au large, son AIS le place devant Mbour. La plateforme croise les deux sources. DIAMBAR-01, en patrouille de nuit, le trouve en pêche dans la bande des 6 milles.' },
    { id: 'seagrace', cat: 'peche', title: 'Navire INN en approche du port', truth: 'seagrace', t: T('00:58'), zoom: 10,
      text: 'Le palangrier a changé de nom mais pas de numéro OMI. La vérification automatique le relie à un navire inscrit sur une liste INN depuis 2011 : l\'accès au port est refusé, comme le prévoit l\'accord sur les mesures du ressort de l\'État du port.' },
    { id: 'marlin', cat: 'peche', title: 'Transbordement en pleine mer', truth: 'marlin', t: T('01:08'), zoom: 12,
      text: 'Un palangrier autorisé s\'arrête en pleine mer, de nuit, près de l\'endroit où le frigorifique sans AIS a été vu. Le drone découvre les deux navires amarrés bord à bord : la pêche passe d\'un bord à l\'autre hors de tout contrôle. Le Walo est envoyé.' },
    { id: 'hunter', cat: 'surete', title: 'Intrusion sous la plateforme de Sangomar', truth: 'hunter', t: T('02:56'), zoom: 13,
      text: 'Un senneur entre dans la zone de sécurité de 500 m du FPSO pour pêcher sous ses lumières. DIAMBAR-01, en patrouille au large de la Petite Côte, confirme. L\'exploitant et la Marine sont alertés.' },
    { id: 'golden', cat: 'trafic', title: 'Position AIS falsifiée et go-fast', truth: 'gofast', t: T('04:23'), zoom: 10,
      text: 'Un yacht annonce une fausse position puis coupe son AIS. Le drone de l\'Armée de l\'air le retrouve et assiste au transfert de ballots vers un go-fast. Quand celui-ci file à 34 nœuds, la plateforme calcule son point d\'arrivée, Palmarin vers 05 h 20, et prévient la Gendarmerie une heure avant.' },
    { id: 'distress', cat: 'migration', title: 'Pirogue en détresse : 140 personnes', truth: 'migrants', t: T('04:30'), zoom: 12,
      text: 'À 03 h 28, le moteur de la pirogue suivie par DIAMBAR-02 s\'arrête. L\'alerte passe au rouge. Le patrouilleur Niani, dirigé sur zone, recueille les 140 personnes.' },
    { id: 'false', cat: 'fausse', title: 'Fausses alertes et apprentissage', truth: 'pecheurs', t: T('04:55'), zoom: 10,
      text: 'Une panne d\'AIS sur un porte-conteneurs l\'après-midi et une pirogue de pêche partie tôt de Joal déclenchent des alertes. Les drones les lèvent sans mobiliser de patrouilleur, et chaque vérification ajuste la fiabilité des règles.' },
  ];

  window.DIAMBAR_DATA = {
    START, PRE_MIN, END_MIN, T, P, sun, moon, weather,
    places, regions, ports, airbases, amps, installations, cables, anchorage, aisStations, AIS_RANGE_NM, beaches,
    assets, assetTypeLabel, registry, iuuList, authorizedSupply, satPasses, actors, background, categories, cases,
  };
})();
