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
