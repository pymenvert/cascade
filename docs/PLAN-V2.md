# Cascade v2 — plan de version

> **Statut : plan, pas encore du code.** Établi le 2026-07-26 à partir d'une
> recherche documentée (sources citées dans le texte) et de mesures faites sur
> la machine de Pym. La v1 reste sur la branche `main` et continue de vivre ;
> ce chantier se fait sur la branche `v2`.
>
> ⚠ **Rien ne commence avant les vérifications de la section 7**, à faire avec
> MadMapper ouvert. Trois d'entre elles (T3, T4, T5) peuvent changer le plan.
>
> 📄 **Suite indispensable : [V2-TEXTURES.md](V2-TEXTURES.md)** — comment faire
> voyager une vraie texture sur un axe. Ce document-ci conclut « une valeur par
> barre » ; c'est vrai pour ce que **Cascade calcule**, mais faux dès qu'une
> texture vit dans la composition MadMapper : les fixtures l'échantillonnent
> alors à pleine résolution, LED par LED. Lire les deux.

> **En deux phrases.** Cascade v2 saura placer les barres dans l'espace réel et y faire courir des effets calculés en 3D (balayages sur n'importe quel axe, ondes sphériques, bruit organique) — avec une vue 3D en plus de la vue 2D actuelle, les deux liées. Ce que Cascade ne saura **jamais** faire par OSC, c'est allumer le pixel n° 37 d'une barre : MadMapper ne l'expose pas.

---

## 1. Ce qui est possible, ce qui ne l'est pas

### La granularité : une valeur par fixture. C'est le mur, et il est solide.

Une barre de 100 pixels est **un seul objet** pour MadMapper : une adresse OSC, une `luminosity`, une `color`. Il n'existe aucune adresse « pixel N ». La liste OSC officielle de MadMapper 6 ne contient, côté DMX, qu'une seule entrée (`/outputs/DMX-Output-[1-X]/enabled`) : ni canal DMX brut, ni pixel.

**Conséquence directe : l'ambition « effets 3D comme Smode ou Madrix » au sens strict est hors de portée avec MadMapper piloté en OSC.** Madrix et Smode calculent une image et l'écrivent pixel par pixel. Cascade ne peut écrire qu'un point par barre.

Mais — et c'est le vrai message du plan — **le modèle mental est le même, seule la résolution change.** Madrix fait : « champ 3D → échantillonné à la position de chaque pixel ». Cascade v2 fera : « champ 3D → échantillonné à la position de chaque barre ». La demande de Pym, telle qu'il l'a formulée (« on applique des visuels sur un axe de la vue 3D et Cascade identifie l'axe et envoie les bonnes infos aux bonnes barres »), est **réalisable à 100 %, littéralement**. C'est même déjà ce que fait `waveValues()` en 2D : projeter la position sur un axe (`proj`), puis appliquer une forme d'onde. La v2 généralise cette ligne à un axe 3D quelconque.

### Les quatre voies vers plus de finesse, classées

| Voie | Résolution obtenue | Compatible zéro-dép | Verdict |
|---|---|---|---|
| **Une valeur par barre** (v2.0) | 1 point / barre | oui, aucun changement de transport | **Retenu comme socle** |
| **Découper une barre en N fixtures** MadMapper (segments) | 4 à 16 points / barre | oui, le modèle actuel marche tel quel | **Retenu en option, étape 6**, conditionné à un test de débit |
| **Canaux « Expression » + sliders OSC** (GLSL avec `INDEX`/`posX` dans la définition de fixture) | vrai per-pixel, 1-3 messages/barre | oui | **À tester (T3), pas à planifier.** Documenté par MadMapper, mais aucun exemple réel connu. Si ça marche : chantier v2.1 dédié |
| **Spout / NDI / Syphon** (Cascade envoie une image) | total | **non** — API natives, addon C++ obligatoire | **Rédhibitoire.** Détruit les trois piliers de Cascade (zéro dépendance, deux fichiers, exécutables pkg) |
| **Art-Net direct** (Cascade parle au contrôleur, MadMapper hors circuit) | total | oui techniquement (~250 lignes, module `dgram`) | **Hors v2.** Oblige à réécrire un moteur DMX complet (patch, ordre R/G/B/W, 16 bits, courbes). À garder comme option experte v2.1+, jamais par défaut |

### Ce qui est également impossible, à dire noir sur blanc

- **Lire la scène 3D de MadMapper : il n'y en a pas.** Les fixtures DMX y sont strictement 2D — position à 2 doubles, rotation à un seul angle. Il n'y a **rien à importer** : Cascade doit porter la profondeur lui-même.
- **Écrire la profondeur dans MadMapper** : `output/x`, `output/y`, `output/rot` existent ; pas de `output/z`, pas de tilt.
- **Un rendu volumétrique** (fumée, particules qui traversent une barre) : une barre ne peut afficher qu'une couleur et une intensité. Ce sera de la lumière, pas de l'image.

> ⚠ *Ce que je n'ai pas vérifié moi-même dans cette session :* tout ce qui concerne MadMapper vient du dossier de recherche (documentation en ligne v6, forum garageCube, décodage du binaire `scenoled.mad`). J'ai vérifié en revanche, en lisant le code, tout ce qui est dit ici du fonctionnement actuel de Cascade, et j'ai **mesuré** les chiffres de la section 4.

---

## 2. Le modèle de données

### Le principe : une seule source de vérité, la 3D. La 2D en est la projection.

C'est la décision d'architecture la plus importante du plan. Deux jeux de coordonnées maintenus en parallèle = bugs sans fin. Donc :

```js
// state.fixtures[] en v2
{
  id, name, address, enabled,          // inchangés
  p3:   [x, y, z],                     // centre de la barre, en MÈTRES   ← VÉRITÉ
  dir3: [dx, dy, dz],                  // vecteur unitaire le long de la barre ← VÉRITÉ
  len3: 1.20,                          // longueur en mètres              ← VÉRITÉ
  seg:  1,                             // nb de segments adressables (1 = comme aujourd'hui)
  segAddr: null,                       // adresses des segments si seg > 1
  x, y, rot, len, vert                 // ← DÉRIVÉS, recalculés à chaque écriture.
                                       //   Servent à la vue 2D, aux miroirs et à la rétrocompat.
                                       //   Le moteur 3D ne les lit JAMAIS.
}
```

**Repère retenu : main droite, unité le mètre, X = jardin↔cour, Y = profondeur (vers le lointain), Z = hauteur.** Origine au centre du plateau, au sol.
Justification : c'est la convention du standard MVR/GDTF (DIN SPEC 15801), donc celle des plans de feu et des exports Vectorworks/Capture. Si un import MVR arrive un jour (faisable en Node pur — un lecteur ZIP de 85 lignes et un parseur XML de 54 lignes suffisent, c'est vérifié), la conversion sera nulle. Le passage vers l'écran se fait dans le seul moteur de rendu.

Nouvel objet `state.scene = { w: 10, d: 8, h: 6, unit: 'm' }` — dimensions du plateau, pour la grille et la normalisation 3D→2D.

### Migration automatique v1 → v2

Au chargement d'une config sans `p3` :

```
p3   = [ (x − 0.5) · scene.w ,  0 ,  (1 − y) · scene.h ]
dir3 = [ cos(rot·π/180) , 0 , −sin(rot·π/180) ]
len3 = (len ? len / len_max : 1) · 1.2 m        // ratio conservé, échelle à calibrer
seg  = 1
```

Tout se retrouve dans le plan frontal (Y = 0), exactement là où la vue 2D le montrait. **Aucun projet ne bouge visuellement, aucun show ne change de rendu.** Le régisseur donne ensuite une profondeur aux barres quand il le souhaite.

Un panneau « Scène » demande une seule mesure de calibration (« cette barre fait combien de mètres ? ») et en déduit le facteur d'échelle.

### Points d'attention pour celui qui code

- `sanitizeFixtures()` (server.js l. 292) **reconstruit l'objet champ par champ** : tout nouveau champ non déclaré est silencieusement perdu. Il faut l'étendre — et borner (NaN, Infinity, `seg` ≤ 16, `dir3` renormalisé, tableau de longueur exacte). Un projet importé est une entrée hostile ; c'est déjà le motif de `control.test.js`.
- Les presets mémorisent les fixtures (`sanitizePresets`) : la 3D doit y entrer aussi.
- La vue 2D borne `x ∈ [0.03, 0.97]`, `y ∈ [0.06, 0.94]`. La reprojection 3D→2D doit passer par la boîte englobante de la scène, sinon les barres se tassent aux bords.
- Un projet v2 rouvert dans un Cascade v1.6 doit rester utilisable : c'est le cas, puisque `x/y/rot/len` sont toujours écrits.

### Les segments (étape 6)

`seg: N` → adresses dérivées `address + '-01'…'-N'` (convention que Cascade utilisera aussi pour **générer** le CSV d'import de fixtures MadMapper). Le patch reste le travail de MadMapper ; Cascade fournit le fichier.

---

## 3. Le moteur d'effets 3D

### Modèle conceptuel retenu : **champ analytique échantillonné**. Pas de voxels.

Un effet = une fonction `f(p, t) → 0..1`, évaluée à la position 3D de chaque émetteur.

**Pourquoi pas de voxels** : une grille 3D obligerait à rastériser un volume puis à le rééchantillonner. Or on n'a que N points d'intérêt — 128 barres × 16 segments au pire = 2 048 points. Les échantillonner directement coûte 2 048 évaluations par tick, soit ~82 000/s à 40 Hz. À comparer aux **6 450 messages OSC/s déjà tenus en test d'endurance**. Les voxels ne servent que pour de la simulation (fluides, collisions) — hors sujet.

### La notion nouvelle : l'**émetteur**

Aujourd'hui le moteur travaille sur des fixtures et les caches sont indexés par `f.id`. En v2, il travaille sur des **émetteurs** : `{ fid, si, p3, address }`. Une barre à `seg = 1` donne exactement un émetteur — donc exactement le comportement actuel. Tout le reste en découle : `stepValues`/`waveValues` rendent une `Map emitterKey → v`, `computeMix`, `tick`, `sendLum`/`sendRGB`, `pruneCaches` suivent mécaniquement.

C'est la seule refonte transverse du chantier, et elle est testable à la ligne près (voir risque n° 3).

### Les familles d'effets (toutes analytiques, ~15 lignes chacune)

| Forme | Grandeur projetée | Généralise |
|---|---|---|
| **Plan / balayage** | `u = (p − centre) · axe` | `lr`, `rl`, `tb`, `bt` — **c'est la demande n° 3 de Pym**, l'axe étant réglable par gizmo ou en azimut/élévation |
| **Sphère** | `u = ‖p − source‖` | `radial` |
| **Cylindre / phare** | `u = angle autour d'un axe` | nouveau (balayage rotatif) |
| **Boîte** | appartenance à un pavé mobile | nouveau (sélection spatiale animée) |
| **Bruit 3D** (simplex maison, ~60 lignes) | `u = noise(p·k, t)` | nouveau — **c'est ce qui « fait Madrix » visuellement, plus que tout le reste** |
| **Sources mobiles** | distance à un ou plusieurs points sur trajectoire | comètes, particules |

`u` traverse ensuite exactement la chaîne existante : forme d'onde → invert → `floor` → `level` → intensité **ou** mix `colorA→colorB` → HTP → master → courbe de gradateur → OSC. **Tout l'acquis v1.3–v1.6 s'applique sans réécriture** : phase, sparkle, fondu entre presets, synchro Ableton Link.

### Ce qui est remplacé, ce qui ne l'est pas

- **`steps` (pas-à-pas) est conservé tel quel.** C'est un moteur d'*ordre*, pas de position — il n'a pas d'équivalent en champ continu, et c'est lui qui porte swing, blocks, one-shot, groupes. Il gagne **une seule chose, gratuite et forte** : l'option « ordre = projection sur l'axe 3D », qui fait suivre au chase la géométrie réelle au lieu de l'ordre de la liste.
- **`wave` est conservé** (projets, presets et tests existants), mais devient un cas particulier de `field` : plan avec axe dans le plan frontal. À terme, un alias.
- **`field` est le nouveau moteur**, choisi comme les autres via `L.engine`.
- **Test de non-régression obligatoire** : un `field` en mode plan, axe X, doit produire *exactement* les mêmes valeurs qu'un `wave lr`.

### Couleur

Le champ peut piloter l'intensité, le mix `colorA→colorB` (déjà là) ou, nouveauté, une **palette à N arrêts** — c'est l'écart visuel principal avec les consoles classiques, pour un coût dérisoire (une fonction `palette(u)`). ⚠ Cette partie dépend du test T4 : si `color/*` **multiplie** l'image échantillonnée au lieu de la remplacer, la palette devra être pensée autrement dès qu'il y a du contenu sous les barres.

---

## 4. La vue 3D

### Technologie retenue : **canvas 2D + projection maison**. Ni WebGL, ni three.js.

**Justification chiffrée — mesurée dans cette session**, sur Chrome/Edge headless lancé avec `--disable-gpu` (donc rastérisation **logicielle**, le pire cas possible), canvas 900×560, rendu complet : projection perspective + grille de sol + tri par profondeur (peintre) + flush forcé par `getImageData`. Médiane sur 240 images :

| Scène | Médiane | p95 | Budget 60 fps |
|---|---|---|---|
| 32 barres, trait simple | 0,3 ms | 0,7 ms | 16,7 ms |
| 128 barres, trait simple | **0,9 ms** | 1,6 ms | 16,7 ms |
| 128 barres + halo | 4,5 ms | 5,8 ms | 16,7 ms |
| **128 barres + halo + étiquettes** | **5,1 ms** | 8,7 ms | 16,7 ms |
| 256 barres + halo + étiquettes | 8,9 ms | 11 ms | 16,7 ms |
| 512 barres, trait simple | 3,1 ms | 5,2 ms | 16,7 ms |

Marge d'au moins 3× dans tous les cas, **sans GPU**. Des pics isolés à 96–174 ms ont été observés (ramasse-miettes + rastérisation logicielle) : à surveiller sur machine réelle, où le GPU est actif.

En face : three.js pèse de l'ordre de 600 Ko minifié à inliner dans une page qui en fait **102 Ko** aujourd'hui — *chiffre de mémoire, non vérifié dans cette session*, mais l'argument ne tient pas à 100 Ko près : le besoin mesuré est de 5 ms par image pour 128 traits. WebGL nu coûterait ~300 lignes de shaders et de buffers pour gagner 5 ms qui ne gênent personne, en perdant le texte, le halo et la robustesse sur vieil iPad.

Ce que le canvas 2D ne donne pas — occlusion de géométrie complexe, ombres, matériaux — n'est pas nécessaire : on ne dessine que des segments, un tri par profondeur suffit.

### Caméra et interactions

- Orbite (azimut / élévation / distance) : glisser sur le fond. Molette = zoom. Maj + glisser = translation.
- Trois vues d'un clic : **Face** (strictement équivalente à la vue 2D actuelle — c'est le pont mental), **Dessus**, **3/4**.
- Sélection : clic sur une barre, hit-test analytique (distance point-segment projeté, seuil 10 px).
- **Déplacement — la règle qui évite 100 % des accidents** : glisser déplace dans le **plan du sol**. Maj + glisser déplace en **hauteur**. Jamais de profondeur « libre » à la souris, qui est ambiguë par construction.
- Rotation : poignée d'extrémité, double-clic = +90° (même geste qu'en 2D), ou champs numériques.
- Grille + magnétisme 25 cm, cotes affichées.
- **Champs numériques obligatoires à côté de la vue** : un régisseur connaît ses cotes. Une vue 3D sans saisie chiffrée est un jouet.

### Lien 2D↔3D

Un seul état, deux vues. La sélection est une variable partagée : sélectionner en 2D surligne en 3D, et réciproquement — **c'est gratuit**, à condition de respecter la règle « la 3D est la vérité, la 2D est dérivée » (section 2). Bouger en 2D = bouger dans le plan frontal, profondeur inchangée. Bouger en 3D met à jour `x/y/rot` pour la 2D.

Le bouton « 3D » bascule ; sur grand écran, les deux vues cohabitent (2D pour travailler vite, 3D pour la vérité).

⚠ Le rendu 3D doit tourner en `requestAnimationFrame` et **ne redessiner que si la caméra a bougé ou si les niveaux ont changé** — pas dans le poll de 120 ms. Les niveaux arrivant à ~8 Hz, prévoir une interpolation pour que la 3D « respire ».

---

## 5. Découpage en étapes livrables

Chaque étape produit quelque chose d'utilisable seul et testable. `npm test` doit passer à la fin de chacune, et `dist/` être resynchronisé (`node sync-dist.js`).

| # | Livrable | Utilisable pour quoi, tout de suite | Effort |
|---|---|---|---|
| **0** | **Vérifications sur le matériel de Pym** (section 7). Aucun code. | Décide si l'étape 6 existe et si un chantier v2.1 « per-pixel » est ouvert | 0,5 j |
| **1** | **Repère 3D + migration.** Panneau « Scène », champs numériques X/Y/Z/azimut/élévation/longueur par barre. Pas encore de vue 3D. | Placer 24 barres au mètre plutôt qu'à la souris | 2–3 j |
| **2** | **Vue 3D en lecture seule.** Caméra orbitale, grille, barres colorées par leur niveau réel (monitoring live), sélection liée à la 2D, vues Face/Dessus/3-4. | **Objectif 1 de Pym atteint** : voir son show en 3D pendant qu'il tourne | 3–4 j |
| **3** ✅ | **Manipulation 3D.** Glisser au sol / Maj en hauteur, rotation, magnétisme, annuler. Bouton explicite « Renvoyer la disposition vers MadMapper » (`output/x|y|rot`), **jamais automatique** — sinon on écrase le réglage manuel du régisseur. | **Objectif 2 atteint** — livré | 2–3 j |
| **4** ✅ | **Moteur « Champ 3D ».** 4 formes (plan/axe libre, sphère, cylindre, boîte), axe réglable au gizmo + numériquement, formes d'onde et palettes. Option « ordre = projection sur l'axe » pour le pas-à-pas. | **Objectif 3 atteint**, version « une valeur par barre ». Livrer avec 3-4 presets de démonstration qui exploitent la profondeur | 4–5 j |
| **5** | **Bruit 3D et sources mobiles.** Feu, nuages, scintillement organique, comètes. | Le « wow ». Indépendant du reste | 2–3 j |
| **6** | **Segments** *(conditionnelle — dépend de T5/T6)*. `seg` par barre, adresses dérivées, **export CSV de définition de fixtures**, compteur de messages/s dans l'UI, garde-fou de débit. | Multiplie la résolution par 4 à 16 **sans toucher à un seul effet** | 4–6 j |
| **7** | **Finitions v2.** Manuel PDF, CHANGELOG, presets mémorisant la 3D, exécutables, capture 3D dans le README. | La version se vend | 3–4 j |

**Total ≈ 20 à 28 jours-homme**, dont ~14 pour un premier ensemble complet (étapes 1 à 4).
**Ordre de valeur si le temps manque : 1 → 2 → 4 → 3 → 5 → 6.**

**Explicitement hors v2** : import MVR/GDTF (faisable, mais sans intérêt tant que Pym n'a pas d'export MVR de sa scéno — à garder pour v2.1), sortie Art-Net directe, Surface FX de MadMapper (l'éditeur demande littéralement de ne pas diffuser les `#ifdef SURFACE_IS_fixture` — bâtir un produit distribué dessus, c'est acheter une panne sur un show), Spout/NDI.

---

## 6. Risques

| # | Risque | Parade |
|---|---|---|
| 1 | **Le régisseur ne voit pas la différence.** Sur une scéno plate, un balayage 3D résolu à la barre ressemble à ce que la v1 fait déjà. | Livrer la **vue 3D (étape 2) avant les effets** pour que la valeur soit visible tout de suite ; livrer l'étape 4 avec des presets qui exploitent la profondeur (avant-arrière, sphère qui explose, bruit) |
| 2 | **La 2D et la 3D divergent** — deux sources de vérité pour la position = bugs infinis. | `p3/dir3/len3` sont la seule vérité ; `x/y/rot` sont **dérivés**, recalculés à chaque écriture, jamais lus par le moteur 3D. Test automatique d'aller-retour |
| 3 | **La refonte fixture→émetteur casse le moteur** (caches, presets, miroirs, groupes, fondu). | **Écrire le test AVANT la refonte** : à `seg = 1`, la séquence OSC émise doit être *identique* à celle de la v1.6. Les tests existants écoutent déjà l'OSC réellement émis avec un décodeur indépendant — c'est directement faisable |
| 4 | **Débit OSC en mode segments** : estimation de 25 000 msg/s pour 20 barres × 8 segments à 40 img/s, **jamais mesurée côté MadMapper**. | Test T5 avant de coder ; compteur de messages/s visible ; plafond réglable ; envoi étalé en tourniquet si dépassement ; le filtre « n'envoyer que si ça change » divise déjà ce chiffre par 3 à 10 |
| 5 | **Le régisseur doit repatcher MadMapper** pour les segments. Coût social, pas technique. | Cascade **génère le CSV** d'import ; le mode segments reste optionnel, jamais imposé |
| 6 | **Perte d'identité** : la 3D est le prétexte parfait pour glisser three.js. | Décision écrite (canvas 2D) chiffres à l'appui + un test qui échoue si `index.html` dépasse une taille plafond ou contient une URL externe |
| 7 | **Interface illisible** : le panneau Couches est déjà dense. 6 formes × 4 paramètres peuvent noyer un non-développeur. | « Champ 3D » est un choix de moteur comme `wave` ; 4 réglages visibles au maximum, le reste dans un repli (motif `advGroove` déjà en place) ; les presets font la pédagogie |
| 8 | **MadMapper change d'API** (aucune trace publique d'une v7, tout repose sur la v6). | Archiver le relevé de T1 dans `docs/madmapper-osc-api.md` **avec le numéro de version exact** ; Cascade sait déjà découvrir dynamiquement (`/getControls`) |
| 9 | **Régression de tempo / Link** : un champ coûteux évalué dans le tick de 25 ms pourrait dérégler le groove. | Budget mesuré (82 k évaluations/s au pire, contre 6 450 msg OSC/s déjà tenus) ; bruit précalculé en table ; le tick garde son `try/catch` ; test de charge à chaque étape |
| 10 | **Entrées hostiles** : `seg = 9999`, `dir3` nul, coordonnées `Infinity` dans un projet importé. | Étendre `sanitizeFixtures` et ajouter les cas hostiles aux tests, comme pour l'OSC entrant |

---

## 7. À vérifier sur le vrai matériel, avant de s'engager

Une demi-journée, MadMapper ouvert. **T3, T4 et T5 sont les trois qui comptent.**

| # | Manipulation | Résultat attendu | Ce qu'on en fait |
|---|---|---|---|
| **T1** | Aide → **OSC Channels List**, exporter/photographier. Puis clic droit → *Copy OSC Address* sur une fixture Line. Noter le **numéro de version exact**. | `luminosity`, `color/*`, `output/x|y|rot` confirmés, **et aucun sous-nœud par pixel** | Si un sous-namespace par pixel apparaît, **tout le plan change — en mieux**. À signaler avant d'écrire une ligne |
| **T2** | `/getControls?root=<adresse de la barre>/sliders&recursive=1` — le bouton 🔍 Diagnostic de Cascade le fait déjà — sur une fixture dont la définition contient un canal *Slider*. | Une adresse OSC par slider nommé | Conditionne T3 |
| **T3** | **Le test le plus rentable (20 min).** Créer une définition de fixture Line avec R,G,B en canaux **Expression** utilisant `posX` (ou `INDEX`) et un slider nommé `POS`, p. ex. `R = 255*smoothstep(0.0, 0.1, 1.0 - abs(posX - POS))`. L'assigner à une barre, bouger le slider à la souris, puis depuis Cascade. | **Une bosse lumineuse qui se déplace le long de la barre** | Si oui : per-pixel réel à 1–3 messages par barre → **chantier v2.1 dédié**. Si non : voie fermée, on reste sur le plan ci-dessus, qui n'en dépend pas |
| **T4** | Mettre un média coloré (dégradé) sous une barre, puis envoyer depuis Cascade `luminosity = 1` et `color/red = 1, green = 0, blue = 0`. | À trancher : la barre devient **rouge** (remplacement) ou prend **rouge × image** (multiplication) | Détermine toute la partie couleur du moteur de champ dès qu'il y a du contenu dans MadMapper |
| **T5** | Patcher 8 fixtures supplémentaires (segments d'une barre), lancer un chase à 25 ms sur tout, observer : fluidité de MadMapper, fluidité du rendu DMX, et le voyant MadMapper de Cascade (sondage toutes les 3 s). | Pas de saccade jusqu'à ~5 000 msg/s ; le voyant ne clignote pas | **Dimensionne l'étape 6.** Si MadMapper décroche, les segments sont plafonnés (ou abandonnés) |
| **T6** | Créer à la main un CSV de 8 fixtures « Barre A-01…08 » à adresses DMX consécutives, l'importer dans MadMapper. | 8 fixtures adressables en OSC, nommées comme prévu | Valide que Cascade peut générer ce fichier — c'est ce qui rend l'étape 6 acceptable pour un non-développeur |
| **T7** | Envoyer `output/x` puis `output/rot` sur une barre **pendant que le show tourne**. | La barre bouge dans la composition, sans artefact ni latence gênante, l'échantillonnage suit | Valide l'étape 3 (renvoi de la disposition vers MadMapper) |
| **T8** | Envoyer `/surfaces/*/luminosity 0`. | Tout s'éteint en **un seul message** | Si oui : blackout en 1 paquet — un gain net au moment le plus critique |
| **T9** | Envoyer un **bundle** OSC contenant 20 messages. | Les 20 valeurs appliquées | Si oui, l'étape 6 devient bien plus confortable (1 datagramme par image au lieu de N). Ajouter l'émission de bundles à l'encodeur maison ≈ 20 lignes |
| **T10** | Mesurer pour de vrai : largeur du plateau, hauteur d'accroche, écart entre deux barres, longueur d'une barre. | Quatre nombres | Sans ça, la vue 3D est jolie mais fausse. C'est l'entrée du panneau « Scène » |

Les résultats de T1, T2, T3 et T4 sont à consigner dans `C:\Users\pymenvert\Claude\Projects\Cascade\docs\madmapper-osc-api.md` — c'est le fichier qui évite de refaire ces recherches.

---

### Fichiers concernés (pour celui qui code)

- `C:\Users\pymenvert\Claude\Projects\Cascade\server.js` — `sanitizeFixtures` (l. 292), `posX`/`posY` (l. 770) → couche « émetteurs », `stepValues` (l. 897), `waveValues` (l. 1019) + nouveau `fieldValues`, `computeMix` (l. 1116), `tick` (l. 1153), `sendLum`/`sendRGB` (l. 1075) réindexés par émetteur, `pruneCaches` (l. 1204), presets, export/import, nouvel endpoint `/api/scene`.
- `C:\Users\pymenvert\Claude\Projects\Cascade\public\index.html` — `renderSpatial` (l. 1089) et `positionBar`, nouveau canvas 3D, panneau Scène, réglages du moteur `field`.
- `C:\Users\pymenvert\Claude\Projects\Cascade\tests\` — migration, non-régression OSC à `seg = 1`, aller-retour 2D↔3D, charge.
- **Règle n° 1 du projet** : toute modification de `server.js` ou `public/index.html` est recopiée dans `dist/` (`node sync-dist.js`, vérifié par `interface.test.js`).
- Le chantier a déjà sa branche : **`v2`** (locale et distante).

Banc d'essai du rendu 3D, réutilisable : `C:\Users\PYMENV~1\AppData\Local\Temp\claude\C--Users-pymenvert-Claude-Projects-Cascade\7c3b1939-88d4-47ad-aff7-d9375b1d5648\scratchpad\bench3d.html` et `run-bench.js`.
---

## Avancement réel

- **Étape 1** ✅ repère 3D, migration v1→v2, champs numériques en mètres.
- **Étape 2** ✅ deuxième page « Scène », vue 3D en canvas 2D maison, caméra
  orbitale, quatre vues (les trois vues de plan sont orthographiques, sinon la
  vue de face ne coïncide plus avec la page Conduite), sélection commune.
- **Étape 3** ✅ manipulation à la souris :
  - glisser une barre = la déplacer, magnétisme 5 cm ;
    Maj = hauteur seule, Alt = orienter (lacet + tangage, magnétisme 5°) ;
  - glisser le vide = tourner la vue, molette = zoom ;
  - `Ctrl+Z` défait le dernier déplacement (pile de 40) ;
  - bouton **« Renvoyer la disposition vers MadMapper »**, avec confirmation.
    `/api/geometrie` n'envoie `output/x|y|rot` que sur ce clic — un déplacement
    de barre n'envoie **rien**, et un test le vérifie.
  - Positions bornées à ±500 m côté serveur : un glissé emballé ou une requête
    malveillante ne peut plus expédier une barre hors d'atteinte de la souris.
  - Les axes du glissé sont dérivés de la caméra (`axesEcran()`) au lieu
    d'inverser la projection : ça évite le cas dégénéré de la vue de face, où le
    plan du sol est vu par la tranche.
- **Étape 4** — à faire, et **conditionnée par T11/T12** (voir
  `V2-TESTS-MADMAPPER.md`, section « Relevé du 2026-07-26 » : l'entrée OSC de
  MadMapper est désactivée sur le poste, ces tests restent à faire à la main).

- **Étape 4** ✅ moteur « champ 3D » (`engine: 'field'`), cinq formes :
  - **plan / balayage** — axe réglable en azimut et élévation ;
  - **sphère** — ondes concentriques depuis une source en mètres ;
  - **cylindre** — balayage rotatif autour d'un axe (le « phare ») ;
  - **boîte** — coques rectangulaires (distance de Tchebychev) ;
  - **bruit 3D** — value noise trilinéaire écrit à la main, zéro dépendance.

  Le champ ne produit qu'une grandeur `u` : elle traverse **exactement** la
  chaîne existante (forme d'onde → inversion → niveau bas → niveau → intensité
  ou mélange de couleurs → HTP → master → courbe de gradateur → OSC). Rien de
  l'acquis v1 n'est réécrit, et c'est ce qui rend le test de non-régression
  possible : **un plan sur l'axe X rend les mêmes valeurs qu'une vague `lr`**, et
  un plan vers le bas les mêmes qu'une vague `tb` — les deux sont testés.

  Décisions prises en écrivant, et leurs raisons :
  - **Pas de refonte « émetteurs ».** Le plan la prévoyait pour préparer les
    segments (étape 6, conditionnelle). Avec `seg = 1` une barre vaut un
    émetteur : le champ s'évalue à `f.p3` et la refonte transverse — la partie
    risquée — attend que les segments soient décidés.
  - **Le champ est centré sur (0, d/2, h/2)**, le milieu du plateau. C'est ce
    centrage précis qui fait qu'un plan sur +X rend `f.x` et qu'un plan vers le
    bas rend `f.y`. Le déplacer casserait la compatibilité en silence.
  - **Le bruit ne traverse pas la forme d'onde** : il produit déjà une valeur.
    L'y faire passer donnerait de la bouillie.
  - **L'étalement du bruit a été mesuré, pas deviné.** L'interpolation de huit
    tirages donne une moyenne de 0,500 et un écart-type de 0,181 — donc tout se
    serre au milieu. Ma première version divisait par 0,44 et **saturait 24,5 %
    des valeurs aux butées** : sur scène, du clignotement dur, pas du mouvement
    organique. À ±2 écarts-types on tombe à 3,8 %.
  - **`width` et `group` gardent la sémantique de la vague**, pour que les deux
    moteurs soient interchangeables sans réapprentissage.
  - **L'interface ne montre que les réglages qui agissent** : le plan n'affiche
    pas de source, la sphère n'affiche pas d'axe, le bruit ni l'un ni l'autre, et
    la grille de motifs disparaît. Un réglage sans effet passe pour une panne.

- **Reste de la spécification, non fait** : les sources mobiles (comètes,
  étape 5), la palette à N arrêts, et l'option « ordre = projection sur l'axe »
  pour le moteur pas-à-pas.
