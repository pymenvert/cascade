# Cascade

**Séquenceur LED multi-couches pour MadMapper.** Chases, vagues, couleur, presets, contrôle MIDI et OSC — piloté depuis une page web sur l'ordinateur, une tablette ou un iPad.

**En 2.0, Cascade sort du plan** : la scénographie se dessine en 3D, et un effet devient une fonction de la position réelle de chaque barre dans l'espace.

*Pierre-Yves Mansour — Collectif WSK*

![version](https://img.shields.io/badge/version-2.0.0--dev-orange) ![licence](https://img.shields.io/badge/licence-MIT-blue) ![dépendances](https://img.shields.io/badge/d%C3%A9pendances-aucune-brightgreen) ![tests](https://img.shields.io/badge/tests-248-green) ![plateformes](https://img.shields.io/badge/plateformes-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

---

## Ce que fait Cascade

Cascade pilote l'intensité et la couleur de vos fixtures DMX (barres LED, projecteurs) directement dans MadMapper, via OSC. À chaque nouveau setup, un scan récupère les fixtures du projet et un import de géométrie les place automatiquement dans une vue spatiale — l'outil s'adapte à la scénographie au lieu de l'inverse.

Jusqu'à **8 séquenceurs indépendants** tournent en parallèle et se mixent : une couche pour les barres au sol en balayage gauche-droite, une autre pour les contres en aléatoire rapide, une troisième qui fait voyager un dégradé de couleur. Chaque couche a son moteur (pas-à-pas ou vague continue), ses miroirs à axes réglables, son tempo et ses courbes.

## Installation

### Le plus simple : l'exécutable

Téléchargez le fichier de votre système dans la [dernière release](../../releases/latest), placez-le où vous voulez, double-cliquez. **Rien à installer.**

| Système | Fichier |
|---|---|
| Windows | `Cascade-1.6.0-windows-x64.exe` |
| macOS (Apple Silicon, M1 et suivants) | `Cascade-1.6.0-macos-apple-silicon` |
| macOS (Intel) | `Cascade-1.6.0-macos-intel` |
| Linux | `Cascade-1.6.0-linux-x64` |

> **macOS et Linux**, la première fois, dans un Terminal ouvert sur le dossier :
> ```bash
> xattr -cr Cascade-1.6.0-macos-apple-silicon && chmod +x Cascade-1.6.0-macos-apple-silicon
> ```
> (les binaires ne sont pas signés — sans cela macOS annonce un « fichier endommagé »)

La configuration est enregistrée dans un `cascade-config.json` **à côté de l'exécutable** : posez le tout sur une clé USB et votre régie vous suit.

### Depuis les sources

Aucune dépendance, aucune installation système. Node.js ≥ 18 suffit.

```bash
git clone https://github.com/pymenvert/cascade.git
cd cascade
node server.js
```

Puis ouvrez **http://localhost:3333**.

### Lanceurs « mode application »

`Cascade - PC.bat` (Windows) ou `Cascade - Mac.command` (macOS — la première fois : clic droit → Ouvrir). Ils téléchargent au besoin un moteur Node portable **et** Carabiner (pour Ableton Link), puis lancent Cascade sans terminal, dans sa propre fenêtre.

Pour quitter : bouton ⏻ en haut à droite, ou fermez simplement la fenêtre — le serveur s'arrête tout seul. **Sauf si les chasers tournent : un show n'est jamais coupé**, Cascade reste alors en arrière-plan et relancer le lanceur rouvre la fenêtre. Le travail est sauvegardé automatiquement en continu.

## Fonctionnalités

### Moteurs

- **Pas à pas** : chase classique — défilement, ping-pong, aléatoire, pair/impair, tous.
- **Vague** : onde continue (sinus, triangle, carré) calculée sur les positions **réelles** des barres — directionnelle, pulse, radiale.
- **Champ 3D** *(2.0)* : l'effet est une fonction de la position réelle de chaque barre dans le volume. Cinq formes — plan à axe réglable, sphère, cylindre (le phare), pavé, bruit 3D. Le champ ne produit qu'une grandeur, qui traverse ensuite **exactement** la chaîne existante : forme d'onde, niveau bas, couleur, HTP, master, courbe de gradateur, Ableton Link. Un plan sur l'axe X rend les mêmes valeurs qu'une vague « G › D », et un test le vérifie — c'est une généralisation, pas un second moteur.

### L'espace *(2.0)*

- **Page « Scène »** : la scénographie en 3D à côté de la page Conduite. Caméra orbitale, quatre vues, les barres allumées en direct pendant le show. Glisser une barre la déplace, <kbd>Maj</kbd> limite à la hauteur, <kbd>Alt</kbd> l'oriente, <kbd>Ctrl</kbd>+<kbd>Z</kbd> défait.
- **Vues** : choisir l'axe sur lequel la texture est projetée — face, dessus, côté. Une vue = un dossier de fixtures MadMapper, et on bascule en n'allumant qu'un dossier : **rien ne se déplace pendant le spectacle**. Fondu réglable entre vues.
- **Perspective atmosphérique** : les barres du lointain sortent plus sombres. C'est ce qui fait *lire* la profondeur — sans elle, deux barres à cinq mètres l'une derrière l'autre se confondent en une seule surface.
- **La palette suit la profondeur** : chaud devant, froid derrière. La perspective agit sur l'intensité, la palette sur la teinte, et l'œil se sert des deux pour juger une distance.
- **Sept modes de fusion** entre couches : HTP (défaut), addition, multiplication, écran, minimum, soustraction, remplacement. En multiplication, une couche devient un **masque** — un plan en profondeur ne laisse passer la texture que dans la tranche qu'il éclaire.
- **Décalage réparti** : la première barre à 0°, la dernière à N°, étalé sur la sélection. Une vague traverse la scéno selon un axe réel avec un seul réglage.
- **Modulateur par couche** : un LFO qui fait respirer un réglage tout seul — niveau, largeur, vitesse, netteté, profondeur… Sa période se cale au choix en secondes ou sur le tempo, donc il ne dérive pas contre la musique. Il ne modifie jamais le réglage affiché, il se superpose : le couper rend la main immédiatement.
- **Modulateur global** : le même, branché sur le crossfader, le master ou la vitesse. Sur le crossfader, la scène passe d'un jeu à l'autre toute seule.
- **Crossfader A ↔ B** : rangez vos couches en deux jeux et passez de l'un à l'autre à la main — ou au fader d'une console, en OSC. C'est la différence entre déclencher un preset et *jouer* un passage.
- **Coupure de secours** : met la sortie DMX de MadMapper à zéro d'un message. La seule voie qui coupe vraiment quand une texture joue — volontairement séparée de BLACKOUT.

### Mise en forme du chase

| Réglage | Effet |
|---|---|
| **Barres par pas** | Nombre de barres qui s'allument ensemble à chaque pas. |
| **Tenue (traîne)** | Combien de pas une barre reste allumée — traîne de comète. |
| **Blocs** | Découpe les barres en N tronçons qui jouent le motif **en même temps**. |
| **Décalage (phase)** | Décale le départ dans le cycle : deux couches identiques se répondent. |
| **Swing** | Groove — retarde un pas sur deux, comme un shuffle. |
| **Niveau bas** | Les barres « éteintes » restent à ce niveau : le chase court au-dessus d'un fond allumé. |
| **Scintillement** | Chaque allumage tire une intensité au hasard — effet guirlande. |
| **Une fois (one-shot)** | Un seul cycle puis silence, jusqu'au prochain **GO**. Pour les accents. |
| **Miroirs ↔ ↕** | Symétries combinables, axes déplaçables, reflets strictement simultanés. |
| **Courbe dimmer** | Linéaire, carrée (fondus fins) ou racine — les LED DMX ne répondent pas linéairement. |

### Le reste

- **Intensité ou couleur** : dégradé A→B qui se déplace sur les barres, ou une **palette à 8 arrêts** (Feu, Glace, Coucher de soleil, Forêt, Distance).
- **Vue spatiale** : barres positionnables au doigt ou importées depuis MadMapper (position, rotation, taille), allumage en temps réel.
- **Groupes de barres nommés** : « sol », « contres »… Une couche qui suit un groupe se met à jour toute seule quand le groupe change.
- **16 presets nommables** qui mémorisent les couches *et* la disposition complète — rappel instantané en live. « Refrain » se retrouve plus vite que « P7 ».
- **Fondu entre presets** (0 à 30 s, réglable) : la scène sortante continue de jouer et décroît pendant que la nouvelle monte. À 0, le rappel reste sec.
- **Raccourcis clavier** : `S` start/stop, `B` blackout, `Espace` tap, `R` resync, `G` GO, `1`–`8` couches, `?` pour l'aide.
- **Tempo** : tap tempo, ÷2 ×2, resync sur le temps fort, vitesse par couche et vitesse globale.
- **Ableton Link avec synchro de phase** : Cascade rejoint la session Link du réseau (Pulse, Ableton Live, Traktor…), suit son BPM **et cale ses pas sur les temps** — plus de chase à contretemps. Un témoin de mesure bat sous le bouton.
- **Contrôle externe** : MIDI (Web MIDI, apprentissage par cible) et OSC entrant (TouchOSC, QLab, console).
- **QR code** : bouton `QR` près de l'adresse réseau — scannez avec un iPad, l'interface s'ouvre.
- **Voyant MadMapper** : une pastille verte confirme que MadMapper répond. Rouge = quelque chose ne va pas, et l'infobulle dit quoi vérifier.

## Configuration de MadMapper

Préférences → OSC : activer l'entrée OSC (port **8000**) et le feedback (port **9000**).

Le paramètre d'intensité par défaut est `luminosity` (fixtures DMX). Pour des surfaces vidéo, utilisez `opacity` — le bouton **Diagnostic** détecte et corrige automatiquement.

## Tablette / iPad

L'adresse réseau s'affiche en haut de l'interface, ou scannez le **QR code**. Même Wi-Fi, c'est tout.

> ⚠ **Il n'y a pas de mot de passe.** N'importe qui sur le même réseau peut piloter le show. En festival, préférez un point d'accès dédié.

## Contrôle OSC

Cascade écoute sur le port **7000** (réglable). Valeurs normalisées 0–1 ; pour les vitesses, `0.5` = ×1.

```
/cascade/start   /cascade/stop   /cascade/blackout   /cascade/tap   /cascade/resync
/cascade/master 0-1              /cascade/speed 0-1
/cascade/presetfade 0-1          (fondu entre presets, 0 à 10 s)
/cascade/link 0-1                (Ableton Link off/on)
/cascade/preset/1 … /cascade/preset/16

/cascade/layer/1/level | stepms | speed | pattern | enable | invert
/cascade/layer/1/mirrorh | mirrorv | width | group | tap | resync | go
/cascade/layer/1/floor | phase | swing | blocks | sparkle | oneshot
```

Le préfixe historique `/chaser/…` reste accepté.

## Développement

```bash
npm test        # 111 tests, sans aucune dépendance
node build.js   # exécutables des 4 plateformes → build/
```

Les tests lancent de **vrais** serveurs Cascade et vérifient l'OSC **réellement émis** vers un faux MadMapper. Ils couvrent le moteur, l'API HTTP, l'OSC entrant, la persistance, la résistance aux données hostiles, la charge (8 couches × 128 barres) et des garde-fous de source contre le retour des défauts corrigés.

- [`docs/ETAT-DU-PROJET.md`](docs/ETAT-DU-PROJET.md) — architecture, sémantique des paramètres, API MadMapper et Carabiner déjà établies, pièges connus.
- [`docs/madmapper-osc-api.md`](docs/madmapper-osc-api.md) — référence OSC de MadMapper.
- [`CHANGELOG.md`](CHANGELOG.md) — journal des versions.

## À savoir

**STOP arrête les chasers et relâche le contrôle** : plus aucun message OSC n'est envoyé, MadMapper conserve son dernier état. Ce n'est **pas** un noir. Pour éteindre : **BLACKOUT**.

Une seule instance tourne à la fois — un second lancement rouvre la fenêtre existante.

## Licence

[MIT](LICENSE) — © 2026 Pierre-Yves Mansour, Collectif WSK.

Aucune dépendance npm : rien d'autre à créditer côté bibliothèques. Marques et composants tiers : voir [NOTICE.md](NOTICE.md).

MadMapper est une marque de GarageCUBE / 1024 architecture. Cascade est un outil tiers indépendant, sans affiliation, qui dialogue avec MadMapper via son interface OSC publique.
