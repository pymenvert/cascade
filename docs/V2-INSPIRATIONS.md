# Ce que font Smode, Madrix et grandMA — et ce que Cascade en prend

> État des lieux et plan, écrit le **2026-07-28**. Objectif de Pym : *« travailler
> des effets 3D sur les structures, les sublimer en envoyant / mixant des textures
> sur la profondeur, réussir à faire ressortir cette profondeur »*.
>
> ⚠ Cascade a une contrainte que ces trois logiciels n'ont pas : **il ne calcule
> qu'une valeur par barre**, parce que c'est tout ce que l'OSC de MadMapper
> accepte. Le détail par pixel vient de la texture. Toute idée reprise ici doit
> passer ce filtre — et beaucoup n'y survivent pas.

---

## Comment chacun traite lumière / texture / 3D

### Madrix — un volume de voxels, et un compositeur

Madrix génère ses effets dans un **volume virtuel** puis mappe chaque fixture
selon sa position 3D. Ce qui compte pour nous, ce n'est pas le volume — on ne
peut pas l'exploiter — mais **son compositeur** :

- des **couches empilées** avec un **mode de fusion** chacune (normal, addition,
  soustraction, multiplication, écran, masque…) et une opacité ;
- des **filtres** par couche puis un filtre maître ;
- un **crossfader entre deux decks**, l'outil de conduite live par excellence ;
- des **Storage Places**, une grille de scènes qu'on déclenche.

### Smode — une vraie scène 3D, et des projections

Smode manipule de la géométrie réelle et **projette** des textures dessus. Le
vocabulaire qui nous concerne directement :

- les **modes de projection** : planaire, cylindrique, sphérique, triplanaire,
  ou depuis une caméra. C'est *exactement* la question de Pym : « sur quel axe
  la texture est-elle projetée ? » ;
- le **depth-cue** (brouillard) : ce qui est loin est plus sombre et moins
  contrasté. C'est le mécanisme qui fait **lire** un volume ;
- des **modulateurs** (LFO, audio, courbes) qu'on branche sur n'importe quel
  paramètre.

### grandMA3 — distribuer un effet sur une sélection

- les **Phasers** : une forme d'onde par attribut, en plusieurs pas, avec un
  décalage de phase réparti sur la sélection ;
- les **MAtricks** : *wings* (symétries), *blocks*, *groups*, *interleave*, et
  un **décalage de phase** réparti sur la sélection. C'est la façon la plus
  efficace d'étaler un effet sur un rig sans le programmer barre par barre.

---

## Où en est Cascade, honnêtement

| Idée | Chez eux | Chez nous |
|---|---|---|
| Effet calculé dans l'espace | volume Madrix / scène Smode | ✅ moteur **champ 3D**, cinq formes, axe réglable |
| Projection d'une texture sur un axe | modes de projection Smode | ✅ **vues** — une par axe, un dossier MadMapper chacune |
| Fusion entre couches | mix modes Madrix | ✅ **7 modes** (nouveau) |
| Depth-cue | brouillard Smode | ✅ **perspective atmosphérique** (nouveau) |
| Blocs / symétries | MAtricks | ✅ `blocks`, miroirs, `ordre3d` |
| Décalage de phase réparti | Phasers, MAtricks | ✅ **`spread`**, de 0 à 1440°, étalé sur la sélection (nouveau) |
| Palette multi-arrêts | partout | ✅ **jusqu'à 8 arrêts**, 5 palettes prêtes (nouveau) |
| Palette branchée sur l'espace | gradients 3D Smode | ✅ **la palette suit le motif, la profondeur ou la hauteur** (nouveau) |
| Crossfader entre deux decks | Madrix | ✅ **deux jeux de couches et un fader**, pilotable en OSC (nouveau) |
| Modulateurs branchables | Smode | ✅ **un LFO par couche**, sur neuf réglages continus (nouveau) |
| Grille de scènes à déclencher | Storage Places | ⚠ 16 presets, mais sans grille visuelle |

---

## Ce qui vient d'être fait (2026-07-28)

### Les modes de fusion

Cascade ne savait faire que du **HTP** — le plus fort gagne. C'est le réflexe des
consoles, juste pour empiler des chases, mais ça interdit de *mixer* quoi que ce
soit. Sept modes maintenant : `htp`, `add`, `mul`, `screen`, `min`, `sub`,
`remp`. HTP reste le défaut, donc **aucun projet existant ne change de rendu**.

Ce que ça débloque concrètement pour toi :

- **`mul`** — une couche « champ » devient un **masque** posé sur une autre. Un
  plan en profondeur en multiplication au-dessus d'une nappe : la texture
  n'apparaît que dans la tranche que le plan éclaire. C'est *la* façon de
  sculpter une profondeur.
- **`add`** — deux nappes s'additionnent sans s'écraser, pour des superpositions
  denses.
- **`sub`** — une couche creuse un trou dans une autre : un vide qui traverse le
  volume.

⚠ Pour tout sauf `htp`, `add` et `mul`, **l'ordre des couches compte**. C'est dit
dans l'infobulle.

### La perspective atmosphérique

Un réglage **Profondeur** par couche, de 0 à 100 %. Les barres du lointain
sortent plus sombres, linéairement, normalisé sur la cote du plateau — donc le
réglage garde son sens quand on change de salle.

**C'est le réglage qui répond le plus directement à ta demande.** Sans lui, deux
barres à cinq mètres l'une derrière l'autre sortent au même niveau et se lisent
comme une seule surface : le volume disparaît. C'est ce que fait le brouillard
dans un moteur 3D, et ce que fait l'air dans un vrai théâtre.

---

## Ce qu'il faut faire ensuite, par valeur décroissante

### 1. ~~La palette à N arrêts~~ — ✅ FAIT le 2026-07-28

Cinq palettes prêtes (Feu, Glace, Coucher de soleil, Forêt, Distance) et
jusqu'à huit arrêts. Sans palette, on retombe exactement sur colorA → colorB :
aucun projet existant ne bouge, et un test le verrouille en vérifiant qu'un
dégradé rouge → bleu ne contient **aucun** vert.

« Distance » est chaude près et froide loin : c'est la seconde moitié du
depth-cue — l'œil lit la distance par la couleur autant que par l'intensité.

### 1 bis. ~~La palette branchée sur l'espace~~ — ✅ FAIT le 2026-07-28

Réglage **« La palette suit »** : *le motif* (comportement d'avant, défaut), *la
profondeur*, ou *la hauteur*. Branchée sur la profondeur, la couleur de chaque
barre ne dépend plus que de sa distance au public : chaud devant, froid derrière,
et ça ne bouge pas quand le motif tourne.

**C'est la seconde moitié du depth-cue.** La perspective atmosphérique agit sur
l'intensité ; celle-ci agit sur la teinte. L'œil se sert des deux pour juger une
distance, et les avoir ensemble change franchement la lecture d'un volume.

Le test qui le verrouille ne dépend d'aucune convention d'axe : **la profondeur
ne bouge pas**, donc branchée dessus la couleur doit rester FIGÉE pendant que le
champ tourne. Branchée sur le motif elle doit voyager. Impossible de confondre.

### 2. ~~Le décalage de phase RÉPARTI sur la sélection~~ — ✅ FAIT le 2026-07-28

Réglage **« Décalage réparti »**, de 0 à 1440°. `phase` décale toute la couche ;
`spread` étale en plus un décalage de la première barre à la dernière. 360° =
un cycle complet réparti sur toute la sélection. Combiné à `ordre3d`, la vague
traverse la scéno **selon un axe réel**, avec un seul réglage.

Il n'agit que sur le **champ** — le seul moteur qui en tient compte — et
l'interface cache le réglage ailleurs plutôt que d'afficher un curseur inerte.

Le test place toutes les barres au **même point 3D** : le champ leur donne alors
forcément la même valeur, donc toute différence en sortie ne peut venir que du
décalage. Et il ajoute une preuve en créneau, où la symétrie de la sinusoïde ne
peut rien masquer.

### 3. ~~Un crossfader entre deux jeux de couches~~ — ✅ FAIT le 2026-07-28

Chaque couche se range dans le jeu **A**, le jeu **B**, ou nulle part
(« Toujours », le défaut — donc aucun projet existant ne change). Un fader passe
de A à B, à la main, et une console peut le tenir : `/chaser/xfade 0-1`.

C'est la différence entre **déclencher** et **jouer** : un rappel de preset est
un saut, un fader se tient.

**Le point qui fait tout le travail :** le poids du fader s'applique sur le
RÉSULTAT de la fusion, pas sur la valeur de la couche — `fond + poids × (fusion −
fond)`. C'est la seule forme correcte pour les sept modes à la fois. Appliqué
sur la valeur, une couche en multiplication baissée à zéro deviendrait un masque
NOIR et éteindrait tout ce qui est dessous : exactement l'inverse de ce qu'on
demande à un fader qu'on baisse. Sous cette forme, à poids nul, le fond ressort
intact quel que soit le mode. Un test dédié le verrouille, et une mutation
vérifie que ce test attrape bien la mauvaise formule.

### 4. ~~Des modulateurs branchables~~ — ✅ FAIT le 2026-07-28 (partiellement)

**Un modulateur par couche**, branchable sur neuf réglages continus : niveau,
niveau bas, largeur, vitesse, netteté, course, profondeur, décalage, décalage
réparti. Quatre formes (sinus, triangle, rampe, créneau), période de 0,1 s à
2 min sur une échelle logarithmique.

Deux décisions qui font la solidité de la chose :

- **Il n'écrit jamais dans l'état.** Le moteur travaille sur une COPIE modulée
  de la couche. Un modulateur qui poserait ses valeurs dans `state` les ferait
  sauvegarder, exporter et mémoriser dans les presets — on retrouverait un
  projet figé sur l'instant où on a cliqué. Ici l'interface continue d'afficher
  ce que le régisseur a réglé, et le couper rend la main immédiatement.
- **La valeur passe par le même nettoyage qu'une saisie à la main.** Aucun
  modulateur ne peut sortir un réglage de sa plage, même avec des bornes
  délirantes — testé avec min −50 et max 900.

La liste des paramètres est **fermée**, et c'est volontaire : laisser moduler
`target`, `bars` ou `groupId` reviendrait à fabriquer des états incohérents
plusieurs fois par seconde.

**Ce qui manque encore** : le suiveur audio (pas d'entrée son côté serveur), un
modulateur global qui piloterait plusieurs couches à la fois, et la synchro de
la période sur le tempo Link plutôt qu'en millisecondes.

### 5. Une grille de scènes

Les 16 presets existent mais sans grille visuelle. Une grille cliquable, avec
les noms et un aperçu, transformerait la conduite.

---

## Ce qu'il ne faut PAS chercher à copier

- **Le volume de voxels de Madrix.** On n'a pas la granularité pour l'exploiter :
  une barre = une valeur. Le détail vient de la texture MadMapper, et c'est très
  bien ainsi — on a mesuré que `luminosity` la module sans la déformer.
- **Les particules et la géométrie de Smode.** Même raison, et ça demanderait un
  moteur de rendu.
- **La projection depuis une caméra.** Tentant, mais elle suppose de pouvoir
  écrire la position d'échantillonnage de chaque LED — or on a mesuré qu'on ne
  peut ni lire ni changer l'empreinte d'une fixture.
