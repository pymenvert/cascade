# Cascade v2 — travailler des textures sur un axe 3D

> Réponse à la question de Pym du 2026-07-26 : « pour envoyer des textures sur
> un axe, quelle est la meilleure solution — Materials/NDI via MadMapper, ou
> NDI depuis Resolume ? Et comment on l'applique sur l'axe ? »
>
> Établi par recherche documentée (sources en fin de document). Complète
> [PLAN-V2.md](PLAN-V2.md), qu'il ne remet pas en cause mais qu'il précise.
>
> ⚠ **Deux tests (T11 et T12) décident de l'architecture.** Dix minutes avec
> MadMapper ouvert. Ne rien coder avant.

## 1. Le mécanisme, en une image

MadMapper fabrique **une seule image** sur la carte graphique — sa composition de sortie. Chaque fixture DMX y est posée **comme un calque**, et une barre de N LEDs va lire **N points de cette image** le long de son segment, un point par LED, puis expédier ces N couleurs en Art-Net. Cascade, lui, ne voit jamais cette image : il décide seulement **où chaque barre va lire** (`output/x`, `output/y`, `output/rot`) et **combien de ce qu'elle lit passe** (`luminosity`, `color/*`).

Autrement dit : **déplacer une barre dans la composition MadMapper, c'est changer la texture qu'elle joue.** C'est là toute l'affaire.

Preuve que ce n'est pas une théorie — doc officielle MM6, page *DMX Fixtures*, réglage **DMX Filtering** :
> *"None: Samples a single, exact pixel at the center of the fixture. Box: Averages a square grid of pixels around the sample point. Anamorphic: Averages an area with independent width and height parameters (X and Y), which is perfect for mapping rectangular LED strips."*

Un réglage qui existe pour éviter le scintillement « quand on joue une vidéo très contrastée sur des LEDs de basse résolution » n'aurait aucun sens si une barre ne lisait qu'un seul point. Et garageCube l'écrit noir sur blanc sur son forum, à propos d'une barre de 18 LEDs : *« you can see the 18 squares corresponding to each LED. The color at the center of this square will be sent to ArtNet DMX. »*

**Manip à faire ce soir, en 3 minutes, pour voir le mécanisme de tes yeux :** pose un Material animé en plein cadre dans MadMapper, vérifie que tes fixtures DMX sont bien dans la composition, et **fais glisser une barre à la souris**. Elle change de contenu en temps réel. Voilà. Tu viens de faire à la main ce que Cascade v2 ferait au calcul.

**Verdict sur l'hypothèse de travail : CONFIRMÉE**, avec une correction et une réserve, détaillées plus bas (§3 et §8).

---

## 2. Quelle source de texture : Materials d'abord, Resolume en second

**Recommandation principale : les Materials de MadMapper.**

Trois raisons, dans l'ordre d'importance :

1. **Leurs paramètres sont adressables en OSC un par un** — forme documentée `/media/[nom_du_media]/[Groupe]/[Paramètre]`, exemple officiel `/media/Lines/Global/Line_Width`. Ça veut dire que **Cascade peut jouer du shader** : faire varier une épaisseur de trait, une vitesse, une couleur, une position 2D, au rythme de tes chases et de ton Ableton Link. C'est exactement ce que tu cherches. Existent aussi `/media/select_by_name`, `/media/[nom]/assign`, `/media/[nom]/restart`, `/master/engine_speed`, `/master/Global_BPM/BPM` et `/master/Global_BPM/TAP`.
2. **Zéro machine, zéro réseau, zéro latence.** C'est un shader GPU rendu sur place.
3. **Réservoir gratuit énorme** : MadMapper est livré avec un dossier *Materials/Factory* plus les bibliothèques MadNoise et MadSDF de Simon Geilfus, et la catégorie *ISFs* du Media Bin te permet d'importer des milliers de shaders d'interactiveshaderformat.com. (La conversion depuis Shadertoy passe par un convertisseur et n'est *pas* garantie à 100 % — l'ISF Editor fait *« most of the heavy lifting, though not everything is going to work »*.)

**Un flux NDI, à l'inverse, est une image opaque.** Cascade peut l'assigner, il ne peut rien régler dedans. Il faudrait piloter Resolume séparément : deuxième protocole, deuxième surface d'erreur, deuxième chose qui peut planter en régie.

**Prends Resolume quand :** tu veux jouer du **contenu préparé** (vidéos, captations, contenu fabriqué pour le spectacle), tu veux une **console visuelle séparée** avec quelqu'un dessus, ou tu réutilises une **bibliothèque que tu as déjà**. Vu tes dossiers de projets (`Materiaux Madmapper`, `Materiaux IFS`, `Ndi Test pour Dome`, `OSC CUE Resolume`), tu as manifestement les deux mondes en main — donc le critère n'est pas « est-ce que je sais faire », c'est « qu'est-ce que je veux pouvoir **piloter** ».

**Si Resolume tourne sur la MÊME machine que MadMapper : Spout, pas NDI.** Spout partage la texture entre applications sur le même GPU — pas de compression, pas de réseau, latence quasi nulle. NDI full-bandwidth ajoute au minimum une image d'encodage et une image de décodage (≈16,7 ms chacune à 60 fps, soit ~33 ms) plus 135–150 Mbit/s en 1080p60. NDI ne se justifie que si Resolume est sur une **autre** machine — et alors il faut un switch gigabit dédié, jamais le wifi de la salle. Côté Resolume, Syphon/Spout et NDI sortent en Avenue **et** en Arena.

**Sur les « slices » :** en Resolume Arena, tu peux définir un écran NDI dédié avec sa propre résolution et ses propres slices, qui serait le dépliage exact de tes barres. C'est séduisant, mais ça **duplique le mapping dans deux logiciels** : deux vérités, deux endroits à corriger quand une barre bouge sur le pont. Mon conseil : garde le dépliage dans **un seul** endroit — MadMapper — et sers-toi de Resolume comme simple fournisseur d'image plein cadre.

---

## 3. Comment on l'applique sur l'axe : Cascade calcule la **disposition**, pas les pixels

Le rôle de Cascade v2 est bien celui de l'hypothèse : **faire le dépliage** du modèle 3D de la scéno vers le plan 2D de la composition MadMapper. Mais avec **une correction importante** :

> **Le dépliage n'est PAS un calcul temps réel. C'est un livrable de préparation.**

La scéno ne bouge pas pendant le show. Les barres sont là où elles sont. Faire cracher 3 messages OSC (x, y, rot) × N fixtures à 40 Hz pour recalculer en permanence une géométrie **constante**, ce serait 4800 messages/seconde sur 40 barres pour rien, et un point de fragilité en régie. Le dépliage se pose **une fois, à froid**, et on le vérifie à l'œil dans MadMapper.

### Les trois façons d'écrire le dépliage dans MadMapper, du plus sûr au plus ambitieux

**(a) À la main — ça marche aujourd'hui, zéro ligne de code.** Tu places tes barres dans la composition, et Cascade **lit** la disposition : la fonction `readGeometry()` de `C:\Users\pymenvert\Claude\Projects\Cascade\server.js` (lignes 734-764) et la route `POST /api/layout` font déjà exactement ça. C'est le repli qui ne peut pas échouer. Ce que Cascade v2 apporte par-dessus, c'est **le gain de temps et la fidélité métrique** — pas une capacité qui n'existerait pas.

**(b) Par fichier SVG — la voie que je recommande pour v2.** MadMapper importe des fixtures depuis un SVG (`File / Import Fixtures…`), et il existe en parallèle `File / Import SVG Lines…` qui crée les surfaces vidéo à partir du même type de fichier. Un SVG, c'est du texte : Cascade le produit avec un `fs.writeFileSync`, **zéro dépendance npm**, parfaitement dans son identité. Un élément `<line>` par barre, avec x1/y1/x2/y2 en pixels, l'`id` sous forme `"Groupe/Nom"` pour créer les groupes, et les attributs d'univers/canal/définition de fixture. Bonus décisif : **le même fichier sert aux fixtures ET aux surfaces vidéo**, donc alignement au pixel garanti. ⚠️ **Le format d'attributs a changé en MadMapper 6.1** (*« SVG tags for universe & start channel as shown in FixturesCsvDemo.svg are no more supported »* — l'univers et le canal passent désormais « in device id »). Avant d'écrire une ligne de code, il faut **exporter un patch depuis TON MadMapper** et lire le fichier produit (test T19 plus bas).

**(c) Par OSC en direct sur `output/x|y|rot`** — pour l'**ajustement** (« la barre 12 est 30 cm trop haut »), pas pour poser le patch. ⚠️ **Non vérifié** : voir §8.

### Le système de coordonnées

Bonne nouvelle : l'import SVG et les contrôles `output/x|y` d'une fixture utilisent **le même repère** — pixels, origine en haut à gauche, Y vers le bas. Une seule convention à coder. À ne pas confondre avec les **surfaces vidéo**, qui utilisent `handles/N/x|y` en cartésien centré, Y vers le haut (`docs/madmapper-osc-api.md`, ligne 31).

### Choisir l'échelle : une projection **métrique**, pas un rangement

Décide un rapport fixe — par exemple **100 pixels = 1 mètre** — et place chaque barre à ses coordonnées réelles projetées. **Ne range PAS les barres en lignes régulières « pour que ça rentre ».** C'est ce qui fait que tout marche ensuite sans effort : un balayage horizontal traverse la salle à vitesse constante, une onde circulaire dans un Material devient une onde circulaire **dans l'espace**, une diagonale reste une diagonale. Si les barres sont rangées en catalogue, la moindre texture donne un résultat sans aucun rapport avec ce que voit le public.

### Les modes de projection utiles

| Mode | Ce que ça fait | Quand |
|---|---|---|
| **Élévation** (face / côté / dessus) | Projection orthographique sur un plan de la salle. Le plus lisible. | Scéno frontale, mur de barres, plan de sol |
| **Isométrique / 3/4** | Projection oblique. Aucune direction de la salle ne s'écrase complètement. | Scéno volumétrique, barres dans les trois directions |
| **Cylindrique / polaire** (« déroulé ») | Un cercle de barres devient une bande droite. Un défilement horizontal = une **rotation** dans la salle. | Dôme, arène, cercle de barres |
| **Développé par barre** (« à plat ») | Chaque barre devient un segment droit, rangé côte à côte, **orientation ignorée**. | Quand tu veux que la texture coure le long de **chaque** barre |

### La barre perpendiculaire à l'axe : ce n'est pas un bug

C'est **le** point qu'il faut avoir compris avant de choisir un mode.

Si tu fais une projection métrique de face et qu'une barre est orientée **de face vers le public** (le long de l'axe de projection), elle s'écrase en 2D : elle devient un point. Ses N LEDs lisent quasiment le même pixel → **toute la barre clignote d'un bloc**. Une barre perpendiculaire à un balayage gauche-droite : pareil, elle s'allume entièrement d'un coup.

Ce n'est pas une erreur. **C'est physiquement juste** : une vague plane qui traverse la salle atteint bien cette barre d'un seul coup. Si tu veux que la lumière raconte *l'espace*, c'est ce que tu veux.

Mais si tu veux que la texture **coure le long de chaque barre** quelle que soit son orientation, c'est un autre désir, qui demande un autre dépliage : le mode **développé**, où chaque barre est posée à plat comme un segment, la cohérence spatiale abandonnée. **Ces deux intentions sont incompatibles dans une même zone du canvas** — mais Cascade peut parfaitement disposer le **groupe A** en projection métrique et le **groupe B** en développé, dans le même canvas, chacun sous sa propre zone de texture. C'est même, à mon avis, la fonctionnalité qui fera dire « ah oui, d'accord » à quelqu'un qui découvre l'outil.

Trois garde-fous à intégrer au solveur : **longueur minimale** (une barre dégénérée reçoit une longueur plancher pour garder quelques pixels distincts), **projection oblique par défaut** (évite les écrasements accidentels), **non-recouvrement obligatoire** (voir §8).

---

## 4. Faut-il récupérer le patch DMX de MadMapper ?

**Pour les pixels : NON, franchement non.** Il n'existe **aucune adresse OSC par pixel** dans MadMapper. L'arborescence OSC expose des **contrôles d'interface** (curseurs, boutons, paramètres), jamais le contenu d'un buffer d'image. La seule façon d'envoyer une image serait que Cascade devienne lui-même une source Spout ou NDI — ce qui exige un binaire natif, donc **viole la contrainte zéro-dépendance** qui fait l'identité du projet. C'est un non définitif, et c'est une bonne nouvelle : ça supprime des mois de travail.

**Pour la géométrie : OUI, et Cascade le fait déjà.** `POST /api/discover` trouve les fixtures, `POST /api/layout` lit leur position via `readGeometry()`. Ça reste utile — c'est l'étape « je découvre ce qui existe » et « je vérifie que ce que j'ai écrit est bien arrivé ».

**Mais la vraie inversion de v2, c'est le sens de circulation : Cascade doit surtout ÉCRIRE le patch, pas le lire.** MadMapper ne connaît pas la géométrie 3D réelle de ta salle. Cascade, oui. **C'est le seul endroit où Cascade apporte quelque chose que rien d'autre n'apporte.**

Et pour « lui envoyer les infos barre par barre » : oui, une fois, à froid, au moment de poser le patch. Jamais 40 fois par seconde.

---

## 5. Les deux régimes de Cascade

| | **Régime « Cascade calcule la lumière »** (aujourd'hui) | **Régime « Cascade cartographie »** (v2) |
|---|---|---|
| Qui décide de la couleur | Cascade (chases, vagues, presets, Link) | La composition MadMapper |
| Ce que Cascade envoie | `luminosity` + `color/*`, ~40 fois/s | `output/x|y|rot`, **une fois** |
| Trafic OSC | ~40 msg/s × N barres | quasi nul |
| Ce qui se passe si Cascade plante | Les barres gèlent sur leur dernière valeur | **Rien ne change, la texture continue** |
| Ce que ça sait faire | Rythme, structure, chases nettes, tempo | Contenu, matière, dégradés, images |

**Sur un même show : oui, évidemment, et c'est même l'intérêt.** Les barres de la face en régime texture, les barres de contre en chase Cascade calée sur le Link. Cascade sait déjà travailler par groupes de barres depuis la v1.5.

**Sur une même barre : ça dépend d'UN fait que personne n'a vérifié.** Quand une fixture échantillonne une texture, est-ce que le `luminosity` que Cascade écrit **multiplie** la couleur échantillonnée, ou est-ce qu'il est **écrasé** par l'échantillonnage ?

- **Si c'est multiplicatif** → jackpot. Cascade devient le **gradateur et l'enveloppe** par-dessus la texture : la texture fournit la matière, Cascade fournit le rythme. Tes chases, tes fondus, tes presets, ton Link continuent de fonctionner **exactement comme aujourd'hui**, mais sur du contenu vivant. C'est le meilleur des deux mondes et ça ne coûte presque rien à coder.
- **Si c'est exclusif** → il faut choisir barre par barre, et Cascade combine les deux régimes en **découpant le rig en groupes**. Ça marche aussi, c'est juste moins beau.

Un indice faible en faveur du multiplicatif : `docs/madmapper-osc-api.md` note que *« le pourcentage d'un réglage est multiplié par celui du groupe »* — MadMapper raisonne en multiplications. Mais ce n'est pas une preuve. **C'est le test T11, à faire avant toute décision d'architecture.**

⚠️ **Et un piège de sécurité propre à Cascade** : ta règle n°4 dit *« STOP relâche le contrôle (aucun envoi OSC) ; seul BLACKOUT envoie des zéros »*. En régime texture, **STOP ne coupe plus rien du tout** : Cascade se tait, et les barres continuent de jouer la texture, plein pot. Et si l'échantillonnage écrase `luminosity`, **BLACKOUT ne marche pas non plus**. Pour un régisseur, c'est inacceptable : il faut un noir garanti. Il faudra donner à BLACKOUT une seconde voie en régime texture (couper la source côté MadMapper, ou masquer les fixtures via `visible`). À traiter comme un point dur, pas comme une finition.

---

## 6. Ce que ça change au plan v2

Franchement — et en précisant que **je n'ai pas le document du plan v2 sous les yeux** dans cette session, je raisonne sur ce que le brief en dit (modèle 3D, position et direction de chaque barre en mètres).

**Ça n'invalide rien d'essentiel.** Le modèle 3D reste la pièce maîtresse — il devient même *plus* central : il cesse d'être un joli aperçu pour devenir **l'entrée d'un calcul de dépliage**. Le moteur de chase, le mix HTP, les presets, le Link : intacts.

**Ce que ça supprime, s'il y en avait dans le plan :** tout ce qui ressemblerait à « moteur de dégradé par LED », « envoi pixel par pixel », « Cascade génère l'image ». Mort, définitivement, et tant mieux.

**Ce que ça ajoute — un module, deux écrivains :**
- le **dépliage** (3D mètres → 2D pixels de composition), avec les modes du §3 ;
- l'**écrivain SVG** (froid, fiable) et l'**écrivain OSC** (chaud, à valider) ;
- une **contrainte de non-recouvrement** dans le solveur de placement. Ce n'est pas un détail cosmétique, c'est un vrai problème de placement géométrique (voir §8).

**Ce que ça change dans l'ordre des priorités — et c'est le point le plus important de cette section :**

1. **Les tests T11 et T13 passent devant TOUT.** Dix minutes avec MadMapper ouvert décident de l'architecture de plusieurs semaines. Ne code rien avant.
2. **L'export SVG passe devant l'écriture OSC de la géométrie** : le SVG est documenté, vérifiable à l'œil, et ne dépend pas d'un comportement OSC non attesté.
3. **Le pilotage des paramètres de Material (`/media/…`) devient une fonctionnalité de premier plan**, pas un bonus. C'est ce qui permet à Cascade de rester un instrument qu'on *joue*, au lieu d'un simple poseur de patch.

**Un piège de conception à noter dès maintenant :** en v2 il y aura **trois systèmes de coordonnées** dans le code, et les confondre coûtera cher —
(1) le **3D réel** en mètres, (2) les **pixels de composition** MadMapper (origine en haut à gauche, Y vers le bas), (3) le **normalisé 0–1** que le moteur actuel utilise déjà pour les vagues et les miroirs (`state.fixtures[].x|y`). Nomme-les explicitement dans le code dès la première ligne.

---

## 7. Les tests à faire avec MadMapper ouvert (suite des T1–T10)

> **T11 — LE test bloquant : `luminosity` par-dessus une texture.**
> Pose un Material **coloré et contrasté** (un dégradé arc-en-ciel, pas un blanc uni) en plein cadre. Une fixture Line dessus. Depuis Cascade, envoie `<adresse>/luminosity` à 1.0, puis 0.5, puis 0.
> **Attendu si multiplicatif :** la barre garde ses couleurs et s'assombrit progressivement jusqu'au noir.
> **Attendu si exclusif :** aucun effet, ou saut binaire.
> **→ Cette réponse décide de toute l'architecture v2. À faire en premier.**

> **T12 — `color/*` par-dessus une texture.** Même Material arc-en-ciel. Envoie `color/red`=1, `color/green`=0, `color/blue`=0.
> **Attendu si teinte multiplicative :** le dégradé apparaît **filtré en rouge** — les zones vertes et bleues deviennent noires, les rouges restent.
> **Attendu si écrasement :** toute la barre devient rouge **uniforme**, le dégradé disparaît.
> (C'est pour ça qu'il faut un Material coloré : sur du blanc, les deux cas sont indiscernables.)

> **T13 — Écriture OSC de la position.** Fais d'abord `POST /api/layout` pour relever la valeur actuelle de `output/x` (tu sauras l'unité et l'ordre de grandeur). Puis envoie cette valeur **+200**.
> **Attendu :** la fixture se déplace visiblement dans la vue Output et sa couleur change en conséquence.
> **Si rien ne bouge :** ces adresses sont en lecture seule → le dépliage devient un livrable froid par SVG uniquement, et l'ajustement live disparaît du plan.

> **T14 — Rotation.** `output/rot` à 90.
> **Attendu :** la barre pivote. **Ce qu'on mesure vraiment :** autour de quel point — son centre ou son extrémité ? Le solveur en dépend.

> **T15 — Échelle.** `output/width` de 1 à 2.
> **Attendu :** l'empreinte d'échantillonnage s'allonge, les N points s'écartent, le dégradé lu s'étale. C'est le « zoom » du dépliage. Si rien ne bouge, ces adresses servent à autre chose. (`docs/ETAT-DU-PROJET.md` les dit déjà « inexploitables comme longueur ».)

> **T16 — La démonstration : le dégradé voyage.** Un Material à dégradé animé horizontal, une barre **horizontale**.
> **Attendu :** les LEDs s'allument successivement d'un bout à l'autre. Puis pivote la barre à 90° → **attendu : toutes les LEDs changent ensemble.** C'est le §3 en direct, et c'est ce qu'il faut filmer pour le README.

> **T17 — DMX Filtering.** Sur une texture fine, passe de `None` à `Anamorphic`.
> **Attendu :** le scintillement disparaît. **Relève au passage :** la valeur par défaut du filtre, et l'unité du paramètre `Size` (pixels de composition ? normalisé ?) — non documenté.

> **T18 — Recouvrement.** Superpose volontairement deux fixtures dans la composition.
> **Attendu (doc MM6) :** celle du dessus **écrase**, aucun mélange. Confirme que le solveur doit interdire les recouvrements.

> **T19 — Format SVG de TA version.** Exporte un patch de fixtures depuis ton MadMapper, ouvre le fichier dans un éditeur de texte, relève le format exact des attributs. **Livrable : ranger ce fichier d'exemple dans `docs/`.** Sans ça, l'exportateur SVG de Cascade sera écrit à l'aveugle sur un format périmé en 6.1.

> **T20 — Résolution du canvas DMX.** Trouve le réglage (*Definition: Same as Output Size / Custom X-Y*), mets-le volontairement bas, et regarde une barre de 60 LEDs jouer un dégradé fin.
> **Attendu :** le dégradé devient escalier. **Ce que ça donne :** le plafond réel de finesse de ton système.

---

## 8. Limites et risques, sans édulcorant

1. **Le point pivot n'est pas vérifié.** Le comportement de `luminosity` / `color` par-dessus une texture échantillonnée n'est documenté **nulle part**. Aucune source, ni officielle ni forum. Toute l'architecture v2 en dépend (§5). Tant que T11 n'est pas fait, tout plan détaillé est de la spéculation.

2. **L'écriture OSC de `output/x|y|rot` n'est corroborée par aucune documentation.** La page officielle *OSC Commands and Channels List* **ne publie aucune adresse de fixture** — seulement `/outputs/DMX-Output-[1-X]/enabled`. Ces adresses s'obtiennent par clic droit → *Copy OSC Address*. Le relevé de Cascade est la **seule** source. Et j'ai vérifié dans le code : `server.js` **lit** ces adresses (`readGeometry`, lignes 734-764) et **ne leur a jamais rien envoyé** (aucun `oscSend` vers `output/*` dans tout le fichier). Le sens écriture est **entièrement non testé**.

3. **Pas d'opacité entre fixtures.** Doc *DMX Fundamentals*, mot pour mot : *« a fixture will **overwrite** the one below it because there are no opacity settings for fixtures. »* Si le dépliage fait se chevaucher deux barres dans le plan 2D, ce n'est pas un mélange, c'est un écrasement. Le solveur doit **garantir** la non-superposition — et ça peut entrer en conflit direct avec la fidélité métrique dans une scéno dense (deux barres proches dans la salle sont proches dans le canvas). Il faudra arbitrer, et l'arbitrage sera visible.

4. **La résolution du canvas DMX borne tout.** Ce n'est pas le nombre de LEDs qui fixe la finesse du dégradé, c'est la résolution de la zone de rendu. Une barre de 60 LEDs sur un canvas de 40 px ne produira pas 60 valeurs distinctes, quoi qu'on fasse.

5. **Cascade perd la vérité sur ce qui sort.** Aujourd'hui, l'aperçu de Cascade *est* ce qui sort. En régime texture, **l'aperçu ment** — Cascade ne sait pas ce que MadMapper affiche. Et les presets de Cascade ne rappellent pas le média MadMapper : rappeler un preset ne remettra pas la bonne texture. (Piste : ajouter `/media/select_by_name` aux presets. Mais alors Cascade devient dépendant du nommage des médias dans le projet MadMapper.)

6. **STOP et BLACKOUT deviennent douteux.** Détaillé en §5. Pour un régisseur, c'est le risque le plus concret de toute cette liste : **un noir qui ne fait pas noir.** À traiter avant les jolies fonctionnalités.

7. **Le format SVG a changé en 6.1, et rien ne dit qu'il ne rechangera pas.** L'exportateur sera calé sur *ta* version et devra être revalidé à chaque mise à jour de MadMapper. Fragilité de long terme sur une pièce centrale. (Atténuation : l'import à la main reste toujours possible, §3 option (a).)

8. **L'import de fixtures crée des fixtures — il ne met pas à jour les tiennes.** Réimporter un SVG corrigé risque de te faire un patch en double. À vérifier lors de T19, et à documenter très clairement dans le manuel, sinon ça fera un incident un soir de montage.

9. **NDI : ~33 ms de latence de transport avant même le rendu**, 135–150 Mbit/s en 1080p60, et un sous-échantillonnage chroma 4:2:2 dont les artefacts se voient **LED par LED** en filtrage `None`. Acceptable pour de la matière, sensible pour du flash synchro à la frappe.

10. **La démo MadMapper est inutilisable pour ces tests** : *« les appareils DMX s'éteignent toutes les 30 secondes »*, et l'export SVG/PNG/PDF est désactivé. Il faut une licence pour valider quoi que ce soit.

11. **Résolution de Resolume vs MadMapper (point 9) et les débits NDI : je ne les ai pas revérifiés moi-même** dans cette session.

---

### Ce que je n'ai PAS vérifié — à dire clairement

- **Les citations de documentation ci-dessus viennent de la phase de recherche de cette session ; je ne les ai pas re-consultées moi-même.** Les seules choses que j'ai vérifiées **en direct**, moi, sont dans le code de Cascade : `readGeometry()` et `/api/layout` en lecture (`C:\Users\pymenvert\Claude\Projects\Cascade\server.js`, lignes 734-764 et 1479-1483), l'absence totale d'envoi vers `output/*`, la structure `state.fixtures[]`, et les conventions de repères de `C:\Users\pymenvert\Claude\Projects\Cascade\docs\madmapper-osc-api.md`.
- **Le comportement de `luminosity`/`color` sur une fixture qui échantillonne** (§5, T11-T12) : aucune source. **Point le plus critique.**
- **Que `output/x|y|rot` soient inscriptibles en OSC** (T13) : aucune source.
- **Que `output/width|height` écartent les points d'échantillonnage** (T15) : impliqué, non documenté.
- **La valeur par défaut du DMX Filtering et l'unité de `Size`** (T17).
- **Le format SVG exact de ta version de MadMapper** (T19) : le format cité est celui d'**avant** 6.1.
- **Le document de plan v2** : je ne l'ai pas eu sous les yeux (§6 raisonne sur ce que le brief en dit).
- **Que la fixture « Line » de MM6 soit exactement le même objet** que la fixture « largeur N / hauteur 1 » des sources forum, qui datent de MM3/MM4. Le vocabulaire a changé (*Fixed Size / LED Strip Mode / Matrix Mode*).

**Sources principales :** [DMX Fixtures](https://docs.madmapper.com/madmapper/6/5.-dmx-and-led-mapping/dmx-fixtures) · [DMX Fundamentals](https://docs.madmapper.com/madmapper/6/5.-dmx-and-led-mapping/dmx-fundamentals) · [Outputs](https://docs.madmapper.com/madmapper/6/6.-outputs) · [OSC Commands and Channels List](https://docs.madmapper.com/madmapper/6/11.-live-performance-and-control/osc-commands-and-channels-list) · [Media Bin](https://docs.madmapper.com/madmapper/6/3.-media/media-bin) · [MadMapper Materials — MaterialsDoc.md](https://github.com/madmappersoftware/MadMapper-Materials/blob/main/MaterialsDoc.md) · [Fonctionnalités MadMapper](https://madmapper.com/madmapper/features) · [FAQ MadMapper](https://madmapper.com/madmapper/faq) · [forum garageCube — import SVG de fixtures](https://forum.garagecube.com/viewtopic.php?t=35819) · [forum garageCube — « 18 squares »](http://forum.garagecube.com/viewtopic.php?t=9773) · [Resolume — Syphon/Spout](https://resolume.com/support/en/syphonspout) · [Resolume — NDI](https://www.resolume.com/support/en/NDI_inputs_and_outputs) · [NDI — encodage/décodage](https://docs.ndi.video/docs/white-paper/encoding-and-decoding) · [ISF & MadMapper Materials](https://projectileobjects.com/2020/10/22/isf-shaders-and-madmapper-materials/)