# v2 — la feuille de tests à faire avec MadMapper

> Une demi-journée, MadMapper ouvert, une licence (pas la démo : elle éteint le
> DMX toutes les 30 s et bloque l'export). **Rien ne se code avant.**
>
> Coche au fur et à mesure et note le résultat directement ici : ce fichier est
> la mémoire du projet. Les réponses de T1–T4 partent ensuite dans
> [`madmapper-osc-api.md`](madmapper-osc-api.md).

## Les trois qui décident de tout

Si tu ne fais que trois choses, fais celles-là. Elles arbitrent des semaines
de travail.

- [ ] **T11 — `luminosity` par-dessus une texture.**
  Un Material **coloré et contrasté** (dégradé arc-en-ciel, surtout pas du
  blanc) en plein cadre, une fixture Line dessus. Envoyer `luminosity` à 1, 0.5,
  puis 0.
  - *Multiplicatif* → la barre garde ses couleurs et s'assombrit. **Jackpot** :
    tous les chases, fondus, presets et le Link de la v1 continuent de marcher,
    mais par-dessus du contenu vivant.
  - *Exclusif* → aucun effet, ou saut binaire. Il faudra choisir barre par
    barre entre « pilotée par Cascade » et « texturée ».
  - Résultat : ⟨à remplir⟩

- [ ] **T12 — `color/*` par-dessus une texture.**
  Même Material. Envoyer `color/red`=1, `green`=0, `blue`=0.
  - *Teinte multiplicative* → le dégradé apparaît filtré en rouge.
  - *Écrasement* → toute la barre devient rouge uni, le dégradé disparaît.
  - Résultat : ⟨à remplir⟩

- [ ] **T13 — Peut-on écrire la position en OSC ?**
  D'abord `POST /api/layout` depuis Cascade pour relever `output/x` (ça donne
  l'unité et l'ordre de grandeur). Puis renvoyer cette valeur **+200**.
  - *La fixture bouge* → le dépliage peut s'ajuster à chaud.
  - *Rien ne bouge* → lecture seule ; le dépliage passe uniquement par un
    fichier SVG, et l'ajustement live sort du plan.
  - ⚠ Aucune documentation n'atteste ce sens d'écriture. Cascade n'a
    **jamais** envoyé vers `output/*` à ce jour.
  - Résultat : ⟨à remplir⟩

## La démonstration à filmer

- [ ] **T16 — Le dégradé qui voyage.**
  Un Material à dégradé animé horizontal, une barre **horizontale** :
  les LED doivent s'allumer successivement d'un bout à l'autre.
  Puis pivoter la barre à 90° : **toutes les LED doivent changer ensemble.**
  C'est tout le principe en une manip — et l'image du README.
  - Résultat : ⟨à remplir⟩

## Géométrie et dépliage

- [ ] **T14 — Rotation.** `output/rot` à 90. Autour de quel point pivote-t-elle,
  son centre ou une extrémité ? Le calcul de dépliage en dépend.
  Résultat : ⟨à remplir⟩
- [ ] **T15 — Échelle.** `output/width` de 1 à 2. Les points d'échantillonnage
  s'écartent-ils (le dégradé lu s'étale) ou rien ne bouge ?
  Résultat : ⟨à remplir⟩
- [ ] **T18 — Recouvrement.** Superposer deux fixtures volontairement.
  Attendu : celle du dessus écrase, sans mélange — donc le placement
  automatique devra interdire les chevauchements.
  Résultat : ⟨à remplir⟩
- [ ] **T19 — Format SVG de TA version.** Exporter un patch de fixtures, ouvrir
  le fichier dans un éditeur de texte, relever le format exact des attributs.
  ⚠ Il a changé en MadMapper 6.1. **Ranger le fichier d'exemple dans `docs/`.**
  Vérifier aussi : réimporter un SVG corrigé met-il à jour les fixtures, ou en
  crée-t-il en double ?
  Résultat : ⟨à remplir⟩

## Qualité d'image

- [ ] **T17 — DMX Filtering.** Sur une texture fine, passer de `None` à
  `Anamorphic` : le scintillement doit disparaître. Relever la valeur par
  défaut et l'unité du paramètre `Size`.
  Résultat : ⟨à remplir⟩
- [ ] **T20 — Résolution du canvas DMX.** La baisser volontairement et regarder
  une barre de 60 LED jouer un dégradé fin : il devient un escalier. Ça donne
  le plafond réel de finesse du système.
  Résultat : ⟨à remplir⟩

## Le point de sécurité — à ne pas oublier

- [ ] **T21 — Le noir doit faire noir.**
  Une barre en régime texture (elle joue un Material). Faire **STOP** dans
  Cascade, puis **BLACKOUT**.
  ⚠ Règle n°4 du projet : STOP relâche le contrôle, seul BLACKOUT envoie des
  zéros. En régime texture, **STOP ne coupe plus rien** — et si `luminosity`
  est écrasé par l'échantillonnage (T11), **BLACKOUT non plus**.
  Il faudra alors une seconde voie : couper la source côté MadMapper, ou
  masquer les fixtures avec `visible`.
  Pour un régisseur, un noir qui ne fait pas noir est le pire des défauts.
  Résultat : ⟨à remplir⟩

- [ ] **T22 — Spout de Resolume échantillonné par une fixture.**
  Sortie Spout dans Resolume, flux récupéré dans MadMapper, posé sur une
  surface couvrant une barre, dégradé animé horizontal joué dans Resolume.
  Attendu : les LED s'allument successivement. Relever si une surface porteuse
  est obligatoire, et la latence ressentie jusqu'aux LED.
  Résultat : ⟨à remplir⟩

## Les tests du plan initial (rappel)

Détaillés en section 7 de [`PLAN-V2.md`](PLAN-V2.md) : T1 (liste OSC et numéro
de version exact), T2 (sliders), **T3 (canaux Expression — pourrait ouvrir le
vrai per-pixel)**, T4 (couleur), T5 (débit en mode segments), T6 (import CSV),
T7 (écriture de la disposition), T8 (blackout en un message), T9 (bundles OSC),
T10 (mesures réelles du plateau).

T3 et T11 se recouvrent en partie : faire T11 d'abord, il est plus simple.

---

## Relevé du 2026-07-26 — pourquoi ces tests n'ont pas pu être faits

Tentative automatisée, en lecture seule, sur la machine de Pym :

- **MadMapper 6.0.9 tourne**, avec un projet ouvert. Installés aussi : 5.6.3,
  5.6.6, et Resolume Arena.
- **Son entrée OSC ne répond pas.** Sondage de `/getControls?root=/surfaces`,
  `/getControls?root=/`, `/getVersion` sur 10 ports candidats (8000, 8010, 8080,
  8100, 7000, 9000, 1234, 8888, 6454, 10669), en écoutant simultanément 9 ports
  de retour : **zéro réponse**. Les seules « réponses » observées étaient mes
  propres paquets revenus en boucle locale — piège à connaître quand on sonde un
  port sur lequel on écoute aussi.
- **MadMapper ne tient aucun socket UDP sur 8000.** Il écoute sur **8010** (qui
  ne répond pas à l'OSC) et sur une quarantaine de ports hauts, typiques de
  l'Art-Net / sACN.
- **La configuration de Cascade pointe sur 8000** (`chaser-config.json`) : elle
  est donc périmée par rapport à cette installation. C'est exactement le cas que
  le voyant « MadMapper ? » de la 1.3 est là pour signaler.
- Le fichier de projet (`scenoled.madproject/scenoled.mad`, 92 ko) est un
  **binaire propriétaire** (signature `0B AD BA BE`) : rien d'exploitable pour
  en déduire la structure des fixtures.

**Conclusion : ces tests ne sont pas automatisables en l'état.** Il faut d'abord
activer l'entrée OSC dans MadMapper (Préférences → OSC), et T11/T12 demandent en
plus de juger des couleurs à l'œil sur une texture — ce qui suppose de fabriquer
une scène d'essai dans le projet ouvert. Je ne l'ai pas fait : le projet était
chargé, avec peut-être du travail non enregistré.

**Ce qu'il faut faire, dans l'ordre :**
1. MadMapper → Préférences → OSC : activer l'entrée, noter le port, et le port
   de feedback. Corriger ensuite les ports dans les réglages de Cascade (⚙).
2. Vérifier que le voyant « MadMapper » de Cascade passe au vert.
3. Puis T11 et T12 (dix minutes) — ce sont eux qui décident de l'architecture.

---

# RÉSULTATS — campagne du 2026-07-26, MadMapper 6.0.9

Pym a corrigé le port de feedback (9000) ; l'entrée était en réalité sur **8010**,
lu dans Préférences → onglet **Project** → OSC. À partir de là tout est devenu
mesurable, et tout ce qui suit est **mesuré**, pas déduit.

**Banc d'essai** (le projet « Untitled » qui était ouvert) : deux barres
`SFX-01 W 1m (GarageCube)`, **60 LED × 1 canal** chacune, univers 0, canaux 1-60
et 61-120. Une surface `Quad-1` portant le générateur **`TestCard`** de MadMapper
(un damier noir et blanc, carreaux d'environ la moitié de la barre). Les
deux barres en mode **« FIXTURE IS SAMPLING THE OUTPUT »**.

**Méthode** : toute écriture en lire → écrire → relire → **restituer** → vérifier
la restitution. Les valeurs DMX réelles ont été lues en Art-Net (univers 0, 512
canaux), après avoir activé `DMX Output Device = ArtNet` — **remis à `None`
ensuite**. Aucun boîtier DMX physique n'était configuré : aucun projecteur n'a pu
s'allumer.

## T11 — la texture survit-elle à l'atténuation ? **OUI**

Motif des LED allumées sur la barre, à `luminosity = 1` puis `0.5` :

```
1 :   111111111111111111111111111111000000000000000000000000000000
0.5 : 111111111111111111111111111111000000000000000000000000000000
```

**Identique.** `luminosity` n'écrase pas le contenu échantillonné : il le module.
La deuxième barre, jamais touchée, est restée à 255 avec ses 16 LED allumées
pendant toute la campagne — c'est le témoin qui rend la mesure lisible.

## T12 — `luminosity` multiplie-t-elle ? **OUI, et linéairement**

| `luminosity` sur la barre | max des canaux 1-60 | LED allumées | valeurs distinctes |
|---|---|---|---|
| 1 | 255 | 30/60 | {0, 255} |
| 0,5 | **127** | 30/60 | {0, 127} |
| 0,25 | **64** | 30/60 | {0, 64} |
| 0 | **0** | **0/60** | {0} |

Rapport mesuré 127/255 = **0,498**. Multiplicatif, linéaire, sans courbe.

⚠ Nuance à garder en tête : la texture d'essai était un damier **binaire** (0 ou
255). Ces mesures prouvent la linéarité **de `luminosity`**, pas l'absence de toute
courbe sur des demi-teintes. Pour une barre en 8 bits ça suffit largement ; si un
jour on doit garantir un dégradé au 1/1000, il faudra remesurer avec un dégradé.

## T21 — le blackout coupe-t-il vraiment, en régime texture ? **OUI**

`luminosity = 0` → **les 60 canaux à 0**, aucun résidu. La sémantique
« BLACKOUT envoie des zéros » de Cascade tient donc aussi quand une texture joue.

## Le mur du « une valeur par fixture » : mesuré

Dans une même barre, les 60 canaux prennent des valeurs **différentes**, calées
sur le damier. La granularité par LED existe donc bel et bien — elle vient de
**MadMapper qui échantillonne la composition**, pas de ce que Cascade envoie.

C'est exactement la conclusion de `V2-TEXTURES.md` : Cascade calcule **une valeur
par barre** (un master), la texture apporte le détail. Les deux se multiplient.

## Couleur sur une barre monochrome

`color = rouge pur` sur une barre blanche (SFX-01 **W**) → max **76**, soit
76/255 = **0,298**. Le coefficient du rouge en Rec.601 vaut 0,299 : MadMapper
convertit donc la couleur en luminance pour une fixture monochrome. Une seule
mesure sur une seule couleur — à confirmer sur vert et bleu avant d'en faire une
règle (Rec.709 donnerait 0,213 pour le rouge, donc ce n'est déjà pas du 709).

Conséquence pour Cascade : sur une barre blanche, une couche « couleur » agit,
mais atténuée par le poids de luma de la teinte. Un bleu pur ne donnerait que
~11 % — utile à dire dans le manuel.

## T13 / T14 / T15 — la géométrie est-elle pilotable ? **OUI, avec deux pièges**

| contrôle | unité réelle | verdict |
|---|---|---|
| `output/x`, `output/y` | **pixels**, pas 0..1 | exact ; accepte -100 comme 10000, aucune borne |
| `output/rot` | **degrés, [0 ; 360[** | exact dans la plage ; **hors plage, ignoré sans rien dire** |
| `output/width`, `output/height` | facteur 0..1 | exact |
| `response` | — | **refusé** |

Les deux pièges ont chacun coûté un bug, tous deux trouvés par la mesure :

1. **Les pixels.** `/api/geometrie` envoyait la valeur normalisée : les barres
   auraient toutes atterri dans le coin supérieur gauche. Corrigé, avec un réglage
   « Sortie … × … px » — l'API OSC de MadMapper ne permet pas de demander la
   résolution.
2. **La plage d'angle.** Le `rot` de Cascade vient d'un `atan2`, donc entre -180
   et +180. MadMapper **ignore silencieusement** tout ce qui sort de [0 ; 360[ :
   une barre sur deux gardait son ancien angle, sans le moindre message. Corrigé
   par `rot360()`.

**Bout en bout, après correction** : Cascade a poussé `/api/geometrie`, les 6
contrôles (x, y, rot × 2 barres) sont arrivés **exacts** dans MadMapper, et la
position de départ a été restituée et vérifiée.

## Ce qui reste sans réponse

- **T16** (un dégradé qui défile le long d'une barre) : demande de fabriquer une
  scène d'essai avec un dégradé animé. Le mécanisme est établi par T11/T12 ;
  il reste à le voir vivre.
- **T19** (format d'import SVG des fixtures) : rien à en tirer par OSC.
- **T22** (Spout depuis Resolume échantillonné par une barre) : Resolume Arena est
  installé, mais lancer une session Spout complète sortait du cadre.
- **`/fixtures/selected`** est un gabarit mort sur cette version : `visible=false`,
  `visual/name="4x4.png"`, 64 sliders à zéro, même avec une barre sélectionnée
  dans l'interface et après avoir écrit `select`. Ne rien bâtir dessus. Les
  handles et le mapping d'entrée par barre ne sont donc **pas** accessibles en OSC
  pour une fixture nommée — seulement `output/{x,y,rot,width,height}`.

## Pistes ouvertes par le relevé (non prévues au plan)

- **`/media/<nom>/*`** : 1310 nœuds. Chaque Material MadMapper expose ses
  paramètres en OSC, plus `assign`, `assign_to_all_surfaces`, `select`,
  `restart`. Cascade pourrait donc **piloter un Material** au lieu de se limiter
  aux niveaux — exactement le chaînon qui manquait à `V2-TEXTURES.md`.
- **`/surfaces/<nom>/FX/Color Controls/*`** : Brightness, Contrast, Hue, Invert,
  Saturation sur une surface entière.
- **`/master/Global BPM/*`** : BPM, TAP, Resync, Ableton Link. Cascade et
  MadMapper pourraient partager le tempo dans les deux sens.

---

# Deuxième passe — ce qu'une relecture adversariale a exigé de mesurer

Les conclusions ci-dessus ont été soumises à des relecteurs chargés de les
**réfuter**. Trois objections étaient fondées, et ont mené à trois mesures de
plus. C'est la partie la plus utile de la journée : les trois premières
conclusions étaient vraies mais **sur-généralisées**.

## Objection 1 — « tu t'es trompé sur la texture »

Fondée. J'avais noté « 4x4.png » ; ce nom vient de `/surfaces/selected/visual/name`,
donc du gabarit mort. La vraie valeur est `/surfaces/Quad-1/visual/name = "TestCard"`.
**Ne jamais lire une propriété sur la branche `selected`** : elle n'est pas vivante.

## Objection 2 — « ta texture était binaire : tu n'as mesuré aucune demi-teinte »

Fondée, et importante : toutes les valeurs relevées étaient {0, 255}, {0, 127},
{0, 64}. Deux points ne contraignent aucune courbe. Un gamma de 2,2 sur la texture
serait resté totalement invisible, puisque 1^γ = 1.

**Mesure faite** en fabriquant des demi-teintes avec `/surfaces/Quad-1/opacity` :

| opacité surface | DMX mesuré | si linéaire | si gamma 2,2 | si 1/2,2 |
|---|---|---|---|---|
| 1 | 255 | 255 | 255 | 255 |
| 0,75 | **191** | 191 | 135 | 224 |
| 0,5 | **127** | 128 | 55 | 186 |
| 0,25 | **64** | 64 | 12 | 136 |
| 0,1 | **25** | 26 | 2 | 90 |

Exposant implicite déduit de chaque point : **1,005 · 1,006 · 0,997 · 1,009**.
La chaîne est donc **linéaire de bout en bout**, sans courbe de transfert.

Et la multiplicativité tient aussi en demi-teinte : à opacité 0,5 (DMX 127),
`luminosity` 0,5 donne **63** (attendu 64) et 0,25 donne **32** (attendu 32).

## Objection 3 — « tu n'as jamais vu en DMX qu'une barre déplacée joue autre chose »

Fondée, et c'était **le** trou : l'affirmation centrale de la v2 n'était étayée
que par une relecture OSC. Mesuré en déplaçant la barre et en capturant les 60
canaux à chaque position (`#` = 255, `+` = ~127, espace = 0) :

```
y=   0 |                                                            |  0/60
y= 135 |##############################                              | 30/60
y= 405 |                              ##############################| 30/60
y= 540 |++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++| 60/60  max 127
y= 810 |                              ##############################| 30/60
y=1080 |                                                            |  0/60

x= 720 |############################################################| 60/60
x= 960 |##############################                              | 30/60
x=1200 |                                                            |  0/60

rot=  0 |##############################                              | 30/60
rot= 90 |                                                            |  0/60
rot=180 |                              ##############################| 30/60
```

**Le contenu échantillonné change avec x, avec y et avec la rotation.** C'est la
preuve, en valeurs DMX, que « déplacer une barre change ce qu'elle joue ». L'objectif
« on applique un visuel sur un axe et la bonne info arrive à la bonne barre » repose
donc sur un mécanisme réel, pas sur une conjecture.

**Et l'énigme du 30/60 est résolue** : les carreaux du damier font environ la moitié
de la barre, donc à y=270 la moitié gauche est sur du blanc et la moitié droite sur
du noir. Mieux : **à y=540, les 60 canaux lisent 127** — la barre est pile sur une
frontière de carreaux et chaque LED moyenne noir et blanc. C'est le **filtrage DMX
en boîte** de MadMapper pris en flagrant délit : il fabrique bien des demi-teintes
par moyennage, et il le fait linéairement.

## Deux découvertes de cette passe

- **`output/width` et `output/height` ne changent RIEN à l'empreinte
  d'échantillonnage.** Testé à 0,25 · 0,5 · 1 · 2 · 4 : le motif des 60 canaux est
  identique à chaque fois. Ce ne sont donc pas les cotes de la zone lue. Conséquence
  directe : **on ne peut pas mettre une barre à l'échelle métrique par ces
  contrôles** — il faut passer par les positions, ou par l'éditeur de fixtures.
- **Débit réel de la sortie DMX : 34,3 trames/s** (206 trames en 6 s, `Maximum FPS`
  réglé à 40 dans MadMapper), avec 1 rupture de séquence. Cascade émet à 40 Hz :
  MadMapper décime, ce qui est sans conséquence pour des chases, mais interdit de
  promettre une précision meilleure que ~30 ms sur un strobe.

## Ce qui reste honnêtement non mesuré

- **Une fixture RVB.** Tout ce qui précède est mesuré sur une barre monochrome
  (SFX-01 **W**, un canal par LED). Le comportement de `luminosity` et de `color/*`
  sur une barre à trois canaux par LED n'est pas établi.
- **Les poids de luma exacts.** Un seul point (rouge → 0,298) : compatible avec la
  famille Rec.601/NTSC, mais le vert et le bleu n'ont pas été mesurés.
- **Le noir garanti après STOP.** À `luminosity 0` les canaux tombent bien à 0, mais
  la règle n°4 de Cascade veut que STOP n'envoie RIEN : en régime texture, MadMapper
  garderait alors le dernier `luminosity` et la texture continuerait de jouer. Les
  voies de secours (`/master/master_dmx_level`, `/master/freeze_dmx_output`) n'ont pas
  été testées. **À traiter avant de livrer le régime texture.**
- **Le réglage DMX Filtering** (None / Box / Anamorphic) n'a pas été relevé ni figé ;
  la mesure à y=540 suggère fortement qu'il était en mode moyennant.
- **Le recouvrement de deux barres**, l'export SVG (T19), et Spout depuis Resolume (T22).

---

# Troisième passe — 2026-07-27, quatre barres et une mire

Pym avait corrigé le réglage : MadMapper envoyait son feedback à la mauvaise IP.
Banc d'essai renouvelé : **quatre** `SFX-01 W 1m`, 60 LED × 1 canal, univers 0,
canaux 1-60, 61-120, 121-180, 181-240 — avec des positions et des rotations
variées, donc bien plus représentatif qu'avant.

Le projet n'avait **aucune surface** : la composition étant vide, les barres
échantillonnaient du noir et rien n'était mesurable. Ni la mire de sortie
(`/outputs/…/show_test_pattern`), ni celle du master, ni `video_color` ne
remontent jusqu'aux barres — elles sont dessinées **après** la composition.
J'ai donc ajouté une surface le temps des mesures, puis **je l'ai supprimée et
vérifié par OSC** que le projet était revenu à quatre barres, zéro surface, et
toutes les valeurs à leur position d'origine au chiffre près.

## Le noir de secours existe — et c'est `master_dmx_level`

| | résultat |
|---|---|
| `/master/master_dmx_level` = 0,5 | tous les canaux à **127** |
| `/master/master_dmx_level` = 0 | tous les canaux à **0**, 0/60 allumés |
| `/master/freeze_dmx_output` = 1 | **plus aucune trame émise** en 1,2 s |

**C'est la réponse au trou de sécurité du régime texture.** Quand une texture
joue, Cascade ne pilote que `luminosity` par barre : il ne peut couper que ce
qu'il connaît. `master_dmx_level` coupe **tout**, y compris les fixtures que
Cascade n'a jamais vues, et il est linéaire — donc utilisable en fondu.

⚠ **`freeze_dmx_output` n'est PAS un noir** : il arrête l'émission. Les
projecteurs gardent la dernière valeur reçue. À ne jamais confondre avec une
coupure — c'est même l'inverse de ce qu'on veut en cas d'urgence.

## Les poids de luma : Rec.601, additifs et linéaires

Sur une barre monochrome (`SFX-01 **W**`), avec un blanc de référence à 255 :

| couleur envoyée | DMX | fraction du blanc | Rec.601 | Rec.709 |
|---|---|---|---|---|
| rouge pur | 76 | **0,298** | 0,299 | 0,213 |
| vert pur | 150 | **0,588** | 0,587 | 0,715 |
| bleu pur | 29 | **0,114** | 0,114 | 0,072 |

**Rec.601, sans ambiguïté** — Rec.709 est exclu sur les trois composantes.
Et la loi est propre :
- **additive** : rouge + vert = 0,886, et le jaune mesuré vaut 0,886 ;
- **linéaire** : un demi-rouge donne 0,1490, exactement la moitié de 0,2980.

Conséquence pour le manuel : sur une barre blanche, un bleu pur ne sort qu'à
**11 %**, un rouge pur à **30 %**, un vert pur à **59 %**. Ce n'est pas un
défaut de Cascade — c'est la conversion en luminance de MadMapper. Un
éclairagiste qui « passe en bleu » sur du monochrome doit s'attendre à perdre
neuf dixièmes de son intensité.

## Recouvrement : aucune fixture n'en écrase une autre

En déplaçant une barre sur une autre, **la première n'a pas bougé d'un canal**
et la seconde a produit ses propres valeurs. Chaque fixture échantillonne la
composition pour son compte ; il n'y a pas de « celle du dessus gagne » entre
fixtures.

⚠ Nuance à ne pas franchir : les deux barres n'ont pas les mêmes dimensions, je
n'ai donc pas pu les superposer *exactement*. Ce qui est établi, c'est
**l'absence d'écrasement mutuel** — pas que deux barres parfaitement confondues
rendraient des canaux identiques au bit près.

## Débit

**35,7 trames/s** mesurées sur 6 s (214 trames), pour un `Maximum FPS` réglé à
40, avec 1 rupture de séquence. Cohérent avec les 34,3 de la première passe.
Cascade émet à 40 Hz : MadMapper décime. Pas de promesse de précision meilleure
que ~30 ms sur un strobe.

## Ce qui reste, et pourquoi

- **Une fixture RVB** : il faudrait patcher une nouvelle fixture dans le projet
  de Pym. Plus invasif que d'ajouter une surface — à faire quand il sera là.
- **DMX Filtering / Definition du canvas** : demandent un dégradé continu, donc
  un média à importer.
- **Export SVG (T19)**, **Spout depuis Resolume (T22)**, **réversibilité de
  l'écriture** (il faut fermer MadMapper sans enregistrer).
