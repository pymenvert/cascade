# Journal des versions

Toutes les évolutions notables de Cascade. Format inspiré de
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ;
versionnage [sémantique](https://semver.org/lang/fr/).

## [2.0.0-dev] — en cours, branche `v2`

Version « espace » : Cascade sort du plan. La v1.6.0 reste disponible et
inchangée sur `main` — rien de ce qui suit ne modifie un show existant.

### Ajouté

- **Une deuxième page, « Scène »** — la scénographie en 3D, à côté de la page
  Conduite. Caméra orbitale, quatre vues (Face, Dessus, Côté, 3/4), les barres
  allumées en direct pendant le show. Les trois vues de plan sont
  orthographiques : sans ça, la vue de face ne coïnciderait plus avec la page
  Conduite, or c'est tout son intérêt. Sélection commune aux deux pages.
- **Un repère en mètres.** X = jardin↔cour, Y = profondeur, Z = hauteur,
  origine au centre du plateau au sol — la convention des plans de feu. La 3D
  est la vérité, la 2D en est la projection. Un projet v1 est migré sans bouger
  d'un pixel.
- **Manipulation à la souris** : glisser une barre la déplace (magnétisme 5 cm),
  <kbd>Maj</kbd> limite à la hauteur, <kbd>Alt</kbd> l'oriente (magnétisme 5°),
  glisser le vide tourne la vue. <kbd>Ctrl</kbd>+<kbd>Z</kbd> défait.
- **Moteur « Champ 3D »** — un effet devient une fonction de la position réelle
  de chaque barre. Cinq formes : plan avec axe réglable, sphère, cylindre
  (le phare), boîte, et bruit 3D. Le champ ne produit qu'une grandeur, qui
  traverse ensuite **exactement** la chaîne existante — forme d'onde, niveau
  bas, niveau, couleur, HTP, master, courbe de gradateur, Ableton Link. Un plan
  sur l'axe X rend les mêmes valeurs qu'une vague « G › D », et c'est vérifié
  par un test : le champ est une généralisation, pas un second moteur.
- **« Ordre = axe 3D »** pour le pas-à-pas : le chase suit la géométrie réelle
  du plateau au lieu de l'ordre de la liste.
- **Groupes de barres nommés**, avec lien vivant : modifier le groupe met à
  jour toutes les couches qui le suivent.
- **« Renvoyer la disposition vers MadMapper »** — un bouton, avec
  confirmation, et rien d'autre. Déplacer une barre dans Cascade n'envoie
  aucune géométrie : c'est le réglage du régisseur, on ne l'écrase pas dans son
  dos.
- **« Trouver le port »** dans les réglages : interroge les ports habituels et
  dit lequel répond. Le port d'entrée OSC de MadMapper est un réglage **de
  projet**, il n'est pas toujours 8000, et rien ne permettait de s'en
  apercevoir.
- **Messages passagers** (en bas de l'écran) à la place de `alert()`, qui
  bloquait la page — inacceptable pendant un show.

### Mesuré sur MadMapper 6.0.9

Une campagne complète, valeurs DMX réelles lues en Art-Net. Tout est consigné
dans `docs/V2-TESTS-MADMAPPER.md` et `docs/madmapper-osc-api.md`.

- `luminosity` **multiplie** la texture échantillonnée, linéairement
  (255 → 127 → 64), et le motif des LED allumées ne change pas. Le blackout
  coupe vraiment, même en régime texture.
- La chaîne est linéaire **de bout en bout** : exposant mesuré 1,00 sur des
  demi-teintes.
- **Déplacer une barre change ce qu'elle joue** — vérifié sur la sortie DMX,
  pas seulement par relecture OSC.
- `output/x` et `output/y` sont en **pixels**, pas en 0..1. `output/rot`
  n'accepte que **[0 ; 360[** et, hors plage, ignore le message **sans rien
  dire**. Ces deux pièges ont chacun coûté un bug, tous deux corrigés.

### Ajouté (suite)

- **Vues** — choisir l'axe sur lequel une texture est projetée. Une vue = un
  dossier de fixtures MadMapper ; chaque barre y existe en une copie, toutes à la
  **même adresse DMX**. On bascule d'un axe à l'autre en n'allumant qu'un
  dossier : rien ne se déplace pendant le spectacle. Fondu réglable entre vues,
  voyant d'existence du dossier, et une case « à moi » pour la vue dessinée à la
  main que Cascade ne recalculera jamais.
- **Coupure de secours** — met la sortie DMX de MadMapper à zéro d'un message.
  C'est la seule voie qui coupe vraiment quand une texture joue. Volontairement
  séparée de BLACKOUT, avec un bandeau rouge impossible à manquer.
- **Netteté du motif** (5–100 %) — sans elle, le motif occupait toujours 100 % de
  sa longueur d'onde : la moitié du plateau était allumée en permanence, et une
  comète était impossible.
- **Source mobile** — elle balaie un segment le long de l'axe. Sphère + course +
  netteté serrée = comète.
- **Sept modes de fusion** entre couches (`htp`, addition, multiplication,
  écran, minimum, soustraction, remplacement). Cascade ne savait faire que du
  HTP — le réflexe des consoles, parfait pour empiler des chases, mais qui
  interdit de *mixer*. La multiplication transforme une couche en **masque** :
  un plan en profondeur posé sur une nappe ne laisse passer la texture que dans
  la tranche éclairée. HTP reste le défaut, donc aucun projet existant ne bouge.
- **Perspective atmosphérique** (0–100 % par couche) — les barres du lointain
  sortent plus sombres, normalisé sur la cote du plateau pour que le réglage
  garde son sens dans une autre salle. C'est ce qui fait **lire** la profondeur :
  sans elle, deux barres à cinq mètres l'une derrière l'autre se confondent en
  une seule surface.
- **Palette à N arrêts** (jusqu'à 8), avec cinq palettes prêtes — Feu, Glace,
  Coucher de soleil, Forêt, Distance. Deux couleurs interdisaient tout dégradé
  qui ne passe pas par le mélange des extrêmes : pas de feu noir → rouge →
  orange → jaune → blanc.
- **« La palette suit »** — le motif, la profondeur, ou la hauteur. Branchée sur
  la profondeur, la couleur d'une barre ne dépend que de sa distance au public :
  chaud devant, froid derrière. C'est la seconde moitié du depth-cue, la
  perspective agissant sur l'intensité et celle-ci sur la teinte.
- **Crossfader entre deux jeux de couches** — l'outil de conduite de Madrix.
  Chaque couche se range dans le jeu A, le jeu B, ou nulle part (« Toujours »,
  le défaut). Un fader passe de l'un à l'autre, et une console peut le tenir :
  `/chaser/xfade 0-1`. La différence entre déclencher un preset — un saut — et
  **jouer** un passage. Le poids s'applique sur le résultat de la fusion, pas
  sur la valeur : sinon une couche en multiplication baissée à zéro deviendrait
  un masque noir et éteindrait tout ce qui est dessous.
- **Décalage réparti** (0–1440°) — l'idée des MAtricks de grandMA. La première
  barre à 0°, la dernière à N°, étalé sur la sélection. Combiné à « ordre = axe
  3D », une vague traverse la scéno selon un axe réel avec un seul réglage.
- **« Inverser la LED »** par barre, pour les barres câblées à l'envers.
- **Quatre démos** — Profondeur, Comète, Phare, Feu.
- **Repère du champ dans la vue 3D** : l'axe en flèche, la source en croix, sa
  course en trait épais.

### Corrigé

Quatre de ces défauts existaient **déjà en v1** — donc dans la version qui part
en spectacle. Chacun a été reproduit sur un vrai serveur avant d'être corrigé,
et chacun a son test dans `tests/regressions.test.js`.

- **v1 · une couche COULEUR allumait les barres qu'elle ne pilote pas.** Un
  chase couleur sur trois barres en éclairait douze.
- **v1 · la phase n'était pas préservée au changement de tempo** pour les
  moteurs continus. Passer le tempo de 0,01 % téléportait le motif (saut de
  0,93 cycle mesuré). Remplacé par une horloge de phase intégrée.
- **v1 · GO / RESYNC ne ramenait pas** les moteurs continus au début du cycle.
- **v1 · le rappel de preset ne re-dérivait pas la 2D** depuis la 3D.
- **Le bruit 3D était figé dans le temps** : le mélange de bits dépassait 2⁵³ en
  virgule flottante et la composante temporelle disparaissait. Corrigé avec
  `Math.imul`.
- Le bruit 3D **saturait 24,5 %** de ses valeurs aux butées — du clignotement
  dur au lieu de mouvement organique. Ramené à 3,8 % en mesurant sa distribution
  réelle plutôt qu'en la devinant.
- Le **centre du champ en profondeur** n'était pas le milieu du plateau.
- Le **cylindre basculait** en traversant certaines élévations, et se déchirait
  à certaines étendues. Base construite analytiquement depuis l'azimut.
- La **boîte** était restée proportionnelle à la sphère : sur un rig plat elle
  ne se distinguait pas. C'est maintenant un vrai pavé mobile.
- Les positions 3D sont bornées à ±500 m : un glissé emballé, ou une requête
  hostile, expédiait une barre hors d'atteinte de la souris.
- `setPointerCapture` sous `try/catch` : la capture peut légitimement échouer,
  et l'exception interrompait le début du geste.

### Tests

232 tests (contre 129 en 1.6.0), dont le pilotage d'un vrai navigateur avec de
véritables événements de souris injectés par CDP, et un **outil de mutation**
(`npm run test:mutation`) qui casse le code exprès pour vérifier que la suite
s'en aperçoit — **16 mutations, 16 détectées**.

Un garde-fou a été ajouté après incident : un commit était parti avec un
cassage volontaire encore en place, et toute la suite restait verte — c'est
normal, un mutant tue une fonction, pas un test. Un test vérifie désormais que
le code source contient toujours la forme saine de chacun des seize endroits
que l'outil sait casser.

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
