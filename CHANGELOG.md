# Journal des versions

Toutes les évolutions notables de Cascade. Format inspiré de
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ;
versionnage [sémantique](https://semver.org/lang/fr/).

## [1.3.0] — 2026-07-24

Version « spectacle » : nouvelles fonctions de chase reprises des consoles
lumière, fiabilité renforcée, exécutables autonomes.

### Ajouté

- **Niveau bas** (par couche) — les barres « éteintes » restent à un niveau
  choisi : le chase court au-dessus d'un fond allumé au lieu de partir du noir.
- **Décalage de phase** (0–360°, par couche) — décale le départ dans le cycle.
  Deux couches identiques avec des phases différentes se répondent.
- **Swing** (−75 à +75 %) — groove : retarde un pas sur deux, comme un shuffle.
- **Blocs** (1–8) — découpe les barres en tronçons qui jouent le motif **en
  même temps** (les « blocks » des consoles MA / Chamsys).
- **Une fois / one-shot** + bouton **GO** — le motif joue un seul cycle puis se
  tait, jusqu'au prochain GO. Pour les accents ponctuels.
- **Scintillement** (0–100 %) — chaque allumage tire une intensité au hasard.
- **Courbe de gradateur** globale (linéaire / carrée / racine) — les LED DMX ne
  répondent pas linéairement ; « carrée » affine les bas de fondu.
- **QR code de connexion** — bouton `QR` près de l'adresse réseau : une popup
  affiche un QR code de l'adresse LAN à scanner depuis un iPad ou un téléphone.
  Générateur maison en pur JavaScript/SVG (zéro dépendance).
- **Exécutables portables** pour Windows, macOS (Intel et Apple Silicon) et
  Linux — `node build.js`. Plus besoin d'installer Node.
- **Suite de tests automatisés** (`npm test`, 68 tests) — sans aucune
  dépendance : lance de vrais serveurs et vérifie l'OSC réellement émis.
  Inclut charge et endurance (8 couches × 128 barres) et des garde-fous de
  source contre le retour des défauts corrigés.
- Nouvelles adresses OSC entrantes : `layer/N/floor|phase|swing|blocks|sparkle|oneshot`
  et `layer/N/go` (alias de `resync`).
- Variables d'environnement `CASCADE_PORT`, `CASCADE_CONFIG`, `CASCADE_OSCIN`,
  `CASCADE_FEEDBACK`, `CASCADE_MMPORT`, `CASCADE_MMHOST`, `CASCADE_NO_BROWSER`,
  `CASCADE_NO_AUTOQUIT` — pour lancer plusieurs instances ou automatiser.

### Corrigé

- **Injection HTML par les noms** (sécurité) — un nom de fixture, une adresse
  OSC ou un nom de couche contenant du HTML était inséré tel quel dans la page.
  Le vecteur réaliste est le **fichier projet** que l'on s'échange entre
  régisseurs. Tout passe désormais par du texte ; un test relit le source et
  échoue si l'injection réapparaît.
- **Changer le paramètre de sortie ne prenait pas effet** sur les fixtures dont
  le niveau n'avait pas bougé : le cache d'envoi n'était pas invalidé. Le cache
  est aussi vidé au START, qui réaffirme donc toujours l'état complet.
- **Une requête HTTP interrompue laissait un traitement en suspens pour
  toujours** (promesse jamais résolue, socket jamais refermée).
- **Un flux OSC entrant continu** (un fader tenu sur TouchOSC) déclenchait une
  écriture disque toutes les 500 ms. Sauvegarde désormais throttlée à 3 s, et
  les commandes non persistantes (start/stop/tap/resync) n'écrivent plus rien.
- **La configuration lue au démarrage n'était pas validée** : un fichier
  corrompu pouvait injecter des couches invalides dans le moteur. Tout ce qui
  vient du disque passe maintenant par les mêmes contrôles que l'API.
- **Une mise en veille de l'ordinateur** faisait rejouer des dizaines de
  milliers de pas d'un coup au réveil (interface figée). Le moteur repart
  désormais du pas courant.
- **Fuite mémoire** : les caches indexés par fixture n'étaient jamais purgés
  après un changement de scéno.
- La carte MIDI et les réglages acceptaient n'importe quelle donnée ; clés et
  valeurs sont maintenant validées et bornées.
- Le fichier exporté porte le nom du projet au lieu de `chaser-projet.json`.
- Un fichier `chaser-config.json` traînant à côté de l'application ne peut plus
  écraser silencieusement une configuration explicitement demandée.
- Les valeurs affichées à côté des curseurs recevaient une chaîne au lieu d'un
  nombre : « 1 blocs » au lieu de « 1 (entier) », et les états neutres
  (« droit », « noir », « — ») ne s'affichaient jamais.
- La reconnexion à Ableton Link retentait toutes les 700 ms sans fin ; un
  Carabiner en boucle de plantage aurait consommé du processeur pendant un show.
  Le délai s'allonge maintenant jusqu'à 5 s, et seule une liaison stable
  (10 s) remet le compteur à zéro.

### Modifié

- Barre de transport **collante** : START / STOP / BLACKOUT restent atteignables
  quand on descend dans la page — en spectacle, on ne fait pas défiler.
- Repères visuels de show : filet orange animé et bouton START qui respire
  pendant que les chasers tournent, halo de préview proportionnel au niveau,
  pastille sur les presets occupés.
- Anneaux de focus clavier nets, respect de « animations réduites ».

## [1.2.0] — 2026-07-09

### Ajouté

- **Ableton Link** via Carabiner : le BPM de la session (Pulse, Ableton Live,
  Traktor…) pilote le temps/pas de toutes les couches.
- **Mode application** : lancement sans terminal, fenêtre dédiée sans barre
  d'adresse (Chrome/Edge/Brave), bouton Quitter dans l'interface.
- **Arrêt automatique** quand la dernière fenêtre se ferme — jamais pendant un
  show, jamais avant la première connexion.
- Nom de projet, suivi des modifications non exportées, dialogue de sortie.
- Charte graphique reprise du manuel (orange signature sur anthracite).

## [1.1.0]

### Ajouté

- Multi-couches (jusqu'à 8 séquenceurs indépendants mixés en HTP).
- Moteur vague, cible couleur, miroirs spatiaux, presets, MIDI et OSC entrants.

## [1.0.0]

Première version : chase pas-à-pas sur les fixtures DMX de MadMapper, en OSC.
