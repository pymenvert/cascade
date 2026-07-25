# Journal des versions

Toutes les évolutions notables de Cascade. Format inspiré de
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ;
versionnage [sémantique](https://semver.org/lang/fr/).

## [1.6.0] — 2026-07-25

Version « phase » : Cascade ne se contente plus de suivre le tempo d'Ableton
Link, il joue **sur** les temps.

### Ajouté

- **Synchronisation de phase Ableton Link.** Jusqu'ici Cascade prenait le BPM
  de la session : le bon tempo, mais démarré n'importe où — donc capable de
  jouer à contretemps de la musique toute la soirée. Désormais chaque pas est
  calé sur un beat de la grille Link, et le pas 0 tombe sur un temps fort.
  - Recalculé à **chaque image** depuis la position réelle sur la grille :
    aucune dérive possible, même après des heures.
  - Mesuré : les allumages tombent à moins d'un tick moteur (25 ms) du beat.
  - Activé par défaut, débrayable d'une case (« Phase ») pour retrouver le
    comportement précédent. Aussi en OSC : `/cascade/linkphase 0-1`.
- **Témoin de mesure** — une rangée de points, un par temps, le temps fort en
  tête, qui bat avec la session Link. On voit d'un coup d'œil si Cascade est
  accroché à la musique. Mesure réglable de 1 à 16 temps (valse comprise).
- Le premier allumage part **au moment du START**, pas au beat suivant : un
  show doit démarrer quand on appuie. La grille reprend la main dès le pas
  suivant.

### Corrigé

- **Démarrer avec Link rejouait toute l'histoire de la session.** L'origine
  des pas étant le beat 0 de Link — vieux de plusieurs heures — un START
  déclenchait d'un coup tous les pas écoulés depuis. Trouvé par les nouveaux
  tests de phase.

### Interne

- `tests/link.test.js` : un faux Carabiner en TCP répond aux `status` avec une
  position de beat qui avance réellement. Huit tests vérifient le tempo, le
  verrouillage de la grille, l'alignement réel des allumages, le changement de
  tempo à chaud, et le repli propre quand Carabiner se tait.
- 111 tests (103 auparavant).

## [1.5.0] — 2026-07-25

Version « scéno » : les groupes de barres, et des tests qui pilotent enfin un
vrai navigateur.

### Ajouté

- **Groupes de barres nommés** — « sol », « contres », « portique ». Une couche
  peut **suivre** un groupe : c'est un lien vivant, pas une copie. Vous changez
  les barres du groupe, tous les chasers qui le suivent se mettent à jour.
  - Jusqu'à 16 groupes, gérés depuis le panneau Fixtures : clic pour choisir
    les barres dans la vue spatiale, double-clic pour renommer.
  - Chaque couche choisit sa cible : toutes les barres, un groupe, ou une
    sélection manuelle.
  - Les groupes appartiennent à la scéno, pas au look : ils voyagent avec le
    fichier projet mais ne sont **pas** mémorisés dans les presets.
  - Un groupe vidé ou supprimé ramène la couche sur toutes les barres — mieux
    vaut éclairer trop que rester noir sans explication.
- **Icône d'application** — une petite cascade de barres orange, intégrée en
  SVG dans la page (aucun fichier de plus à distribuer).

### Corrigé

- Le navigateur réclamait une icône à chaque chargement et récoltait un 404.
  Trouvé par les nouveaux tests d'interface.

### Interne

- **Tests pilotant un vrai navigateur, toujours sans aucune dépendance.**
  Chrome ou Edge est lancé en arrière-plan et piloté par le protocole DevTools,
  à travers le WebSocket intégré à Node. Douze tests chargent la page, cliquent
  sur les vrais boutons, envoient de vraies touches, et vérifient qu'aucune
  erreur JavaScript ne survient.
  - Vérifié en cassant volontairement trois choses : une erreur au chargement,
    un bouton débranché, une injection HTML réintroduite. Les trois sont
    attrapées.
  - Sans navigateur installé, ces tests s'annoncent ignorés au lieu d'échouer.
  - `npm run test:ui` pour ne lancer que ceux-là.
- 103 tests (91 auparavant).

## [1.4.0] — 2026-07-25

Version « conduite » : moins de réglages sous les yeux, plus de repères
pendant le show.

### Ajouté

- **Fondu entre presets** (réglable, 0 à 30 s) — au rappel d'un preset, la
  scène sortante **continue de jouer** et décroît pendant que la nouvelle
  monte. Ce n'est pas un simple fondu au noir : les deux chases tournent en
  parallèle, chacun avec son propre état moteur, et les niveaux se mélangent.
  À 0 le rappel reste sec, comme avant.
  - Réglage global dans le panneau Tempo, échelle logarithmique (au dixième de
    seconde dans les temps courts, là où ça compte).
  - Un filet orange sous la rangée de presets montre la progression.
  - Pilotable en OSC : `/cascade/presetfade 0-1` (0 à 10 s).
  - Forçable pour un rappel précis : `POST /api/preset {action:'recall', slot, fadeMs}`.
  - STOP, BLACKOUT et START annulent un fondu en cours. Aucun fondu n'est
    déclenché si rien ne joue.
- **Presets nommables** — à l'enregistrement, Cascade demande un nom ; un
  double-clic sur un slot le renomme. En conduite, on retrouve « Refrain »
  bien plus vite que « P7 ». Le numéro reste affiché en petit : c'est lui qui
  compte pour le MIDI et l'OSC. Le nom suit l'export et l'import.
- **Raccourcis clavier** — `S` démarrer/arrêter, `B` blackout, `Espace` tap,
  `R` resync, `G` GO sur la couche courante, `1`–`8` choisir une couche,
  `?` ou `H` pour l'aide. Un bouton **?** ouvre la même liste.
  Les raccourcis sont ignorés pendant une saisie et quand un dialogue est ouvert.
- **Premier lancement guidé** — sans barre configurée, l'interface affiche les
  quatre étapes à suivre au lieu d'une page vide, avec un témoin qui dit si
  MadMapper répond déjà.

### Modifié

- **Panneau Couches simplifié** — les réglages fins (décalage, swing, blocs,
  scintillement, une fois) sont regroupés sous un repli « Groove & découpe ».
  Une pastille orange indique combien y sont actifs, et le repli s'ouvre tout
  seul quand on arrive sur une couche qui en utilise : rien ne se cache
  silencieusement.
- Le manuel PDF passe à 9 pages (presets nommés, repli, chapitre raccourcis).

### Interne

- `node sync-dist.js` recopie les sources dans `dist/`, et **un test échoue si
  `dist/` diverge**. La copie manuelle était une source d'erreur : livrer un
  `dist/` obsolète, c'est livrer une version jamais testée.
- **Le script de l'interface est désormais analysé par la suite de tests.** Une
  variable redéclarée avait cassé toute la page sans qu'aucun des 82 autres
  tests ne s'en aperçoive : ils parlent au serveur, jamais au JavaScript du
  navigateur. Ce trou est comblé.
- 84 tests (71 auparavant).

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
- **Suite de tests automatisés** (`npm test`, 71 tests) — sans aucune
  dépendance : lance de vrais serveurs et vérifie l'OSC réellement émis.
  Inclut charge et endurance (8 couches × 128 barres) et des garde-fous de
  source contre le retour des défauts corrigés.
- Nouvelles adresses OSC entrantes : `layer/N/floor|phase|swing|blocks|sparkle|oneshot`
  et `layer/N/go` (alias de `resync`).
- Variables d'environnement `CASCADE_PORT`, `CASCADE_CONFIG`, `CASCADE_OSCIN`,
  `CASCADE_FEEDBACK`, `CASCADE_MMPORT`, `CASCADE_MMHOST`, `CASCADE_NO_BROWSER`,
  `CASCADE_NO_AUTOQUIT` — pour lancer plusieurs instances ou automatiser.

### Corrigé

- **Durcissement de l'affichage des noms** — les noms de fixtures, de couches et
  de projets sont désormais posés en texte pur, et un test le vérifie à chaque
  fois. Recommandé pour tout le monde.
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
- **Les barres clignotaient à chaque changement de tempo.** Les fondus en cours
  restaient datés sur l'ancienne échelle de temps : en accélérant, une barre
  devenait « trop vieille » pour son enveloppe raccourcie et s'éteignait le
  temps d'un pas. Visible à chaque TAP, ÷2, ×2 et à chaque dérive de BPM
  Ableton Link. Mesuré : 32 extinctions sur 30 changements de tempo avant
  correction, aucune après.
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
