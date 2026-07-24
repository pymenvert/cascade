# MadMapper — API OSC (référence locale condensée)

Sources : docs.madmapper.com (MadMapper 6), github.com/cansik/madmapperapi, easyguet.ch/blog/madmapper-osc-api

## Transport
- OSC sur UDP. Deux canaux : **entrée** MadMapper (port par défaut **8000**) et **feedback** (port par défaut **9000**). Configurables dans Préférences MadMapper > OSC.
- La liste complète des adresses contrôlables : menu **Help → OSC Channels List** dans MadMapper. Clic droit sur un widget → copier l'adresse OSC.
- MadMapper implémente aussi le protocole **OSC Query**.

## Écrire une valeur
Envoyer un message OSC à l'adresse du contrôle avec la valeur en argument :
- `/surfaces/Quad 1/opacity` + float (0.0–1.0)
- `/surfaces/Quad 1/visible` + bool
- Pas de réponse de MadMapper (écriture simple).

## Lire / découvrir (via le port d'entrée, réponse en bundle sur le port feedback)
- **Lister les contrôles** : `/getControls?root=ROOT&recursive=0|1`
  - Ex : `/getControls?root=/surfaces&recursive=0` → bundle de messages vides dont l'adresse est chaque enfant (`/surfaces/selected`, `/surfaces/Quad 1`, …)
- **Lire des valeurs** : `/getControlValues?url=URL_REGEX&normalized=0|1`
  - Ex : `/getControlValues?url=/surfaces/Quad 1/opacity&normalized=1`
  - URL est une regex ; normalized=1 → float 0–1 (RGBA/STRING non normalisables : pas de réponse).
- Réponses asynchrones, pas de corrélation requête/réponse → collecter pendant un délai.

## Fixtures DMX (MadMapper 6)
- Les fixtures DMX (Fixture, Line, Circle, Bézier) **échantillonnent la composition de sortie** et se comportent comme des layers.
- Inspecteur fixture : **Appearance → Opacity, Color** (donc contrôlables), Fixture Definition, Channel/DipSwitch, Response Curve, Output.
- Le pourcentage d'un réglage est multiplié par celui du groupe → un **groupe** a aussi une opacité pilotable (chases de groupes possibles).
- Attention au namespace OSC : selon la version, les fixtures apparaissent sous `/surfaces/…` et/ou `/fixtures/…`. Le plus fiable : scanner les deux racines avec `/getControls`, ou copier l'adresse via clic droit dans MadMapper.

## Contrôles réels d'une fixture DMX Line (relevé sur le setup de Pym, MadMapper 6, 2026-07)
`select`, `visible`, **`luminosity`** (= intensité, PAS opacity), `color/red|green|blue|rgba|hue|saturation|value`, **`output/x`**, **`output/y`** (position en **pixels** de la composition, Y vers le bas), `output/width`, `output/height` (facteurs d'échelle, =1 par défaut), **`output/rot`** (rotation en degrés), `response`, `sliders`.
→ Pour la géométrie des fixtures DMX : lire `output/x|y|rot`. Pour les surfaces vidéo : `handles/N/x|y` (cartésien, centre 0,0, Y vers le haut).

## Notes d'implémentation chaser
- ~30–60 msg/s par fixture : OK pour MadMapper.
- N'envoyer que si la valeur change (quantifier à 1/255) pour limiter le trafic.
- Coordonnées MadMapper : cartésiennes, centre (0,0).
