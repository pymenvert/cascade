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

---

# Mesuré sur MadMapper 6.0.9 — 2026-07-26

Tout ce qui suit vient d'une campagne de mesures réelle sur le poste de Pym, pas
de la documentation. Chaque écriture a été faite en **lire → écrire → relire →
restituer → vérifier la restitution**. Quand une valeur est donnée ici, elle a
été observée.

## Le port n'est pas celui qu'on croit

Le port d'entrée OSC est **par projet**, dans Préférences → onglet **Project** →
OSC. Sur ce poste il valait **8010**, pas 8000. Le feedback était bien sur 9000,
IP « Custom » 127.0.0.1. Conséquence pratique : le voyant « MadMapper ? » de
Cascade est le premier réflexe, et le port se vérifie dans cette page-là.

## L'API se limite à deux verbes

`/getControls` et `/getControlValues`. Point. Ont été essayés sans succès :
`/getVersion` `/getInfo` `/getOutputs` `/getResolution` `/getSurfaces`
`/getMedias` `/getFixtures` `/getScenes` `/getCues` `/help` `/getCommands`
`/getApi` `/getState` `/getControlInfo` `/getControlRange`.

**Il n'existe donc aucun moyen de demander la résolution de la sortie** — d'où le
réglage explicite « Sortie … × … px » dans la page Scène de Cascade.

Chaque réponse est précédée de `/replyMessageCount` (int) = nombre de messages qui
suivent. C'est le seul moyen fiable de savoir qu'un lot est complet : s'arrêter
sur un délai fixe tronque les gros lots (`/media` en fait 1310).

⚠ **Piège de méthode** : sonder un port sur lequel on écoute aussi fait revenir
ses propres paquets en boucle locale. Ils ressemblent à des réponses. Filtrer sur
l'adresse envoyée, ou vérifier le port émetteur.

## Unités et plages réellement acceptées

| adresse | unité | écriture |
|---|---|---|
| `<fixture>/output/x`, `/output/y` | **pixels de la composition** | exacte. Accepte -100 comme 10000 : aucune borne, une barre peut sortir du cadre |
| `<fixture>/output/rot` | **degrés, [0 ; 360[** | exacte dans la plage. **Hors plage : le message est ignoré, sans erreur ni écrêtage.** Un `atan2` donne -180…180 : il FAUT replier |
| `<fixture>/output/width`, `/output/height` | facteur 0..1 | exacte |
| `<fixture>/luminosity` | 0..1 | exacte. C'est le curseur nommé « Opacity » dans l'interface |
| `<fixture>/color/red|green|blue` | 0..1 | exacte |
| `<fixture>/response` | — | **refusée** : la valeur ne bouge pas |
| `<fixture>/select` | booléen (`T`/`F`) | un float 1 ne sélectionne pas |

Une barre au centre d'une sortie 1920×1080 lit `output/x = 960`. Écrire 0,7 en
croyant piloter du 0..1 la colle dans le coin — c'est le premier piège.

## L'espace de noms

Racines : `/timelines /surfaces /fixtures /media /outputs /modules /master /application`.

- **`/fixtures/<nom>`** : `color/{red,green,blue,hue,saturation,value,rgba}`,
  `luminosity`, `output/{x,y,rot,width,height}`, `response`, `select`,
  `sliders`, `visible`.
- **`/fixtures/selected`** : les mêmes, plus `input/{x,y,scale,rot,flip}`,
  `output/handles/0..3/{x,y}`, `sliders/1..64`, `visual/{id,name,number,type}`.
  ⚠ Sur cette version, cette branche **n'a jamais reflété la sélection réelle** :
  `visible=false`, `visual/name="4x4.png"`, les 64 sliders à zéro, y compris
  après avoir écrit `select` et avec une fixture bel et bien sélectionnée dans
  l'interface. C'est un gabarit, pas une vue vivante — ne rien bâtir dessus.
  Les 64 sliders ne sont donc **pas** un accès par LED.
- **`/media`** : 1310 nœuds. Chaque média expose ses propres paramètres
  (`Bar Code/Size`, `Bricks/Mortar Color/…`) et surtout `assign`,
  `assign_to_all_surfaces`, `select`, `restart`. **Piste sérieuse pour la v2** :
  Cascade peut piloter les paramètres d'un Material MadMapper en OSC.
- **`/surfaces/<nom>`** : `FX/{Active,Name,Color Controls/{Brightness,Contrast,
  Hue,Invert,Saturation}}`, `blend_mode`, `color/*`, `input/{x,y,scale,rot,flip}`,
  `opacity`, `output/handles/0..3/{x,y}`.
- **`/master`** : `master_level`, `master_dmx_level`, `master_video_level`,
  `freeze_dmx_output`, `freeze_engine`, `freeze_video_output`, `engine_speed`,
  `test_pattern`, et `Global BPM/{Ableton Link, BPM, BPM Source, Range/{x,y},
  Resync, TAP}` — de quoi lire ou poser le tempo de MadMapper.
- **`/outputs/<nom>`** : `enabled`, `publish_loopback`, `publish_to_ndi`,
  `publish_to_syphon_spout`, `show_desktop_window`, `show_test_pattern`,
  `Save Video Snapshot`. Ce dernier n'a produit aucun fichier, quelle que soit la
  forme d'argument essayée.
- **`/application`** : `view/{active_tab,fullscreen,mode,orientation}`,
  `media/{add,remove}` (chaîne = chemin), `preview/additional_text`,
  `mad_light_recorder/{start,stop}_recording`.

## Observer le résultat : la vue Stage ne sert à rien

La vue Stage dessine la **zone d'échantillonnage** de la fixture, pas sa sortie.
À `luminosity = 0`, le dessin de la barre est **inchangé**. Les carrés colorés de
la liste des fixtures ne reflètent pas le niveau non plus.

Le seul endroit qui montre la vérité : **Tools → DMX Monitor** (Ctrl+Alt+M) — et
il faut que la sortie DMX soit activée dans Préférences → Project → DMX. Pour une
mesure automatisable, choisir `DMX Output Device = ArtNet` et lire les paquets
ArtDmx en UDP 6454 : on obtient les 512 canaux, chiffrés. Tant que ce réglage est
sur `None`, MadMapper n'émet **rien** — ni ArtDmx, ni réponse à un ArtPoll.

## Corrections apportées par une seconde passe

- `/surfaces/<nom>/visual/name` donne le média réellement assigné.
  `/surfaces/selected/visual/name` ne le donne **pas** — il renvoie une valeur de
  gabarit. J'ai commis exactement cette erreur : lire la branche `selected` et
  croire décrire la surface.
- **La chaîne est linéaire de bout en bout.** Mesuré en fabriquant des demi-teintes
  avec `/surfaces/<nom>/opacity` : opacité 1 / 0,75 / 0,5 / 0,25 / 0,1 donne un DMX
  de 255 / 191 / 127 / 64 / 25, soit un exposant implicite de 1,00 à chaque point.
  Et `luminosity` se compose multiplicativement par-dessus, y compris en demi-teinte.
- **`output/width` et `output/height` ne changent PAS la zone échantillonnée.**
  Testé à 0,25 · 0,5 · 1 · 2 · 4 : les 60 canaux d'une barre restent identiques.
  Ces contrôles ne sont donc pas les cotes de l'empreinte de lecture.
- **Déplacer une barre change ce qu'elle joue** : `output/x`, `output/y` et
  `output/rot` modifient tous les trois les valeurs DMX des LED. Vérifié sur la
  sortie Art-Net, pas seulement par relecture OSC.
- **Débit de la sortie DMX : ~34 trames/s** avec `Maximum FPS = 40`. Cascade émet à
  40 Hz ; MadMapper décime.

## Le noir de secours — mesuré le 2026-07-27

| adresse | effet mesuré |
|---|---|
| `/master/master_dmx_level` = 0 | **tous** les canaux DMX à zéro, toutes fixtures confondues |
| `/master/master_dmx_level` = 0,5 | tous les canaux à 127 — c'est **linéaire**, donc utilisable en fondu |
| `/master/freeze_dmx_output` = 1 | **plus aucune trame émise** : ce n'est PAS un noir, les projecteurs gardent leur dernière valeur |

C'est la seule voie qui coupe vraiment quand une texture joue : Cascade ne
pilote que le `luminosity` des barres qu'il connaît, `master_dmx_level` coupe
tout le reste avec.

## Couleur sur une fixture monochrome : Rec.601, additif et linéaire

Mesuré sur `SFX-01 W`, blanc de référence à 255 :

| | mesuré | Rec.601 | Rec.709 |
|---|---|---|---|
| rouge pur | **0,298** | 0,299 | 0,213 |
| vert pur | **0,588** | 0,587 | 0,715 |
| bleu pur | **0,114** | 0,114 | 0,072 |

Rec.709 est exclu sur les trois composantes. La loi est **additive** (rouge +
vert = 0,886, et le jaune mesuré vaut 0,886) et **linéaire** (un demi-rouge
donne exactement la moitié d'un rouge). Conséquence pratique : sur une barre
blanche, un bleu pur ne sort qu'à 11 % de l'intensité.

## Deux pièges de méthode

- **Les mires ne sont pas du contenu.** Ni `/outputs/…/show_test_pattern`, ni
  `/master/test_pattern`, ni `/master/video_color` ne remontent jusqu'aux
  fixtures : elles sont dessinées **après** la composition. Sans surface, les
  fixtures échantillonnent du noir et rien n'est mesurable.
- **Le port d'entrée ET l'IP de feedback sont des réglages de PROJET.** Ils se
  réinitialisent à chaque nouveau projet. Un feedback envoyé à la mauvaise IP
  donne exactement le même symptôme qu'une entrée éteinte : silence total.
