# DIAMBAR 2027

Démonstrateur de la plateforme **DIAMBAR 2027** : surveillance maritime du Sénégal par drones de surface (USV) et fusion de données AIS, VMS et satellite.

Projet porté par Papa Tahibou TALL dans le cadre du Prix spécial du Président de la République pour l'innovation technologique et industrielle à vocation militaire et paramilitaire.

> **Démonstrateur.** Toutes les données sont simulées. Les navires, numéros OMI et listes INN sont fictifs (préfixe `SIM`). Les limites maritimes, aires marines protégées et installations sont des tracés **indicatifs**, non officiels.

## Lancer la démo

Aucune installation n'est nécessaire.

- **En ligne** : activer GitHub Pages (Settings → Pages → branche `main`, dossier racine), puis ouvrir l'adresse indiquée. Sur un dépôt privé, GitHub Pages demande un compte GitHub Pro.
- **En local** : ouvrir `index.html` dans un navigateur récent (connexion Internet requise pour la bibliothèque de carte et les polices).
- **Hors ligne, un seul fichier** : `dist/diambar-2027.html` regroupe tout le code (seule la bibliothèque de carte Leaflet est chargée depuis un CDN).

## Ce que montre la plateforme

La simulation rejoue la nuit du 14 au 15 octobre 2026 (18 h 30 à 9 h 00) dans la zone économique exclusive du Sénégal. La plateforme ne voit que ce que voient les capteurs.

| Brique | Rôle dans la démo |
|---|---|
| Fusion de données | AIS (positions publiques), VMS fourni par la DPSP, passages satellites radar et optiques, radars et caméras des moyens |
| Détection | 15 règles : AIS coupé, silence VMS, écart VMS/AIS, bande des 6 milles, zone de licence, aire marine protégée, pêche sans licence, arrêt prolongé au large, transbordement, navire sans AIS, embarcation non identifiée, falsification AIS, navire INN en approche du port, détresse, rassemblement sur une plage de départ |
| Score de risque | Chaque alerte reçoit un score (base de la règle, facteurs aggravants, fiabilité apprise) et un niveau : critique, haute, moyenne, basse |
| Vérification | L'opérateur envoie le drone de surface ou le drone aérien le plus proche. À l'arrivée, il produit une preuve horodatée, géolocalisée et signée (empreinte SHA-256) |
| Apprentissage | Chaque vérification met à jour la fiabilité de la règle concernée ; les règles qui produisent des fausses alertes reculent dans le classement |
| Contrôle des navires | Vérification automatique du numéro OMI, des licences et des listes INN, en réponse aux défaillances relevées par l'Union européenne en 2024 |
| Interopérabilité | Les drones aériens de l'État et les patrouilleurs de la Marine sont intégrés comme capteurs et comme moyens d'intervention |
| Sauvetage | Détection d'une pirogue en détresse, suivi continu, déclenchement des secours |
| Modèle drones-satellite | Volet de recherche : images de drones utilisées comme vérité terrain pour améliorer la détection des pirogues sur les images satellites |

### Les huit cas du scénario

Le menu « Aller à un cas » saute directement à chacun.

1. Rassemblement de pirogues sur la plage de Dionewar (îles du Saloum)
2. Chalutier qui coupe son AIS et sa balise VMS pour pêcher dans la bande des 6 milles devant Saint-Louis
3. Transbordement en pleine mer entre un palangrier autorisé et un frigorifique sans AIS
4. Balise VMS laissée sur une pirogue d'appui pendant que le chalutier pêche devant Mbour
5. Navire inscrit sur une liste INN, qui a changé de nom, en approche du port de Dakar
6. Panne AIS d'un porte-conteneurs (fausse alerte, pour montrer l'apprentissage)
7. Yacht qui falsifie sa position AIS avant un rendez-vous près de la côte (trafic)
8. Pirogue de migrants en panne au large, sauvetage de 140 personnes

Le mode **Vérité terrain** révèle tous les navires, y compris ceux que les capteurs ne voient pas (mode formateur).

## Structure du code

```
index.html            Page principale
css/style.css         Styles (thème unique de salle d'opérations)
js/geo-data.js        Côtes et zones maritimes indicatives (généré)
js/geo.js             Outils géographiques (distances en milles, caps, polygones)
js/data.js            Données de référence et scénario de démonstration
js/sim.js             Simulation : navires (vérité terrain), capteurs, moyens
js/detect.js          Plateforme : fusion, règles, score, apprentissage, preuves
js/ui.js              Interface opérateur (carte Leaflet, panneaux)
tools/build-geo.js    Génère js/geo-data.js à partir de Natural Earth
tools/build-single.js Assemble dist/diambar-2027.html
tools/test-scenario.js Rejoue le scénario sans interface et liste les alertes
vendor/leaflet/       Feuille de style et licence de Leaflet
```

Le code est en JavaScript sans dépendance de compilation. Pour régénérer les fichiers :

```bash
npm install world-atlas@2.0.2 topojson-client@3.1.0 @turf/turf@6.5.0
node tools/build-geo.js          # zones maritimes indicatives
node tools/build-single.js       # fichier unique dans dist/
node tools/test-scenario.js --auto   # test du scénario avec envoi automatique des drones
```

## Passer aux données réelles

| Source | Accès envisagé |
|---|---|
| AIS | Flux AIS terrestre et satellite (fournisseur commercial ou récepteurs côtiers sénégalais) |
| VMS | Partenariat avec la Direction de la Protection et de la Surveillance des Pêches |
| Licences | Registre des navires autorisés publié par le ministère des Pêches |
| Listes INN | Listes publiques des organisations régionales de gestion des pêches (ICCAT, CTOI…) |
| Imagerie | Copernicus Sentinel-1 et Sentinel-2 (gratuit), acquisitions commerciales sur commande |
| Détections de navires | API de Global Fishing Watch (gratuite pour les usages non commerciaux) |
| Limites maritimes | Limites officielles (SHOM, Marine Regions) à la place des tracés indicatifs |

## Limites du démonstrateur

- Les capteurs, probabilités de détection et performances du modèle drones-satellite sont des hypothèses d'illustration, pas des mesures.
- Les limites maritimes sont calculées par tampon géométrique à partir du trait de côte Natural Earth au 1:10 000 000.
- Aucune donnée réelle ni sensible n'est utilisée.

## Crédits

- Trait de côte : [Natural Earth](https://www.naturalearthdata.com/) (domaine public), via `world-atlas`.
- Carte interactive : [Leaflet](https://leafletjs.com/) (licence BSD-2, voir `vendor/leaflet/LICENSE`).
- Polices : IBM Plex Sans, IBM Plex Mono, Barlow Condensed (Google Fonts, licence OFL).
