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
| Décalage de phase réparti | Phasers, MAtricks | ⚠ `phase` est **globale à la couche**, pas répartie sur la sélection |
| Palette multi-arrêts | partout | ❌ deux couleurs seulement |
| Crossfader entre deux decks | Madrix | ❌ on a un fondu entre presets, pas un crossfader tenu à la main |
| Modulateurs branchables | Smode | ❌ |
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

### 1. La palette à N arrêts *(le plus gros reste)*

Deux couleurs interdisent tout dégradé qui ne passe pas par le milieu : pas de
feu (noir → rouge sombre → orange → jaune → blanc), pas de rampe froide à trois
teintes. La spéc en fait « l'écart visuel principal avec les consoles
classiques », et le coût est dérisoire : une liste d'arrêts et une fonction
`palette(u)`.

**Bonus qui sert directement la profondeur** : une palette permet de faire une
rampe *chaud près → froid loin* en branchant la palette sur la profondeur plutôt
que sur le temps. C'est la deuxième moitié du depth-cue — l'œil lit la distance
autant par la couleur que par l'intensité.

### 2. Le décalage de phase RÉPARTI sur la sélection

Aujourd'hui `phase` décale toute la couche. Chez grandMA, la phase s'étale sur la
sélection : la première barre à 0°, la dernière à N°. Combiné à `ordre3d`, ça
donne une vague qui traverse la scéno **selon un axe réel**, avec un seul
réglage. Peu de code, gros effet.

### 3. Un crossfader entre deux jeux de couches

L'outil de conduite de Madrix. Cascade a un fondu entre presets, mais pas de
fader tenu à la main. Pour un régisseur, c'est la différence entre déclencher et
**jouer**.

### 4. Des modulateurs branchables

Un LFO ou un suiveur audio qu'on branche sur n'importe quel réglage. C'est la
brique la plus puissante de Smode, et la plus coûteuse : il faut un système de
liaison générique. À garder pour une v2.1.

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
