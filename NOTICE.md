# Mentions

## Marques

MadMapper est une marque de GarageCUBE / 1024 architecture. Cascade est un
outil tiers indépendant, sans affiliation, qui dialogue avec MadMapper via son
interface OSC publique.

Ableton et Ableton Link sont des marques d'Ableton AG. Cascade n'est ni produit
ni approuvé par Ableton.

## Composants tiers

Cascade n'a **aucune dépendance npm** : l'encodeur OSC et le client Carabiner
sont écrits à la main dans `server.js`. Il n'y a donc aucune licence de
bibliothèque à reporter.

Deux composants externes interviennent tout de même :

- **Node.js** (licence MIT) — embarqué dans les exécutables autonomes publiés
  dans les releases, et téléchargé par les lanceurs `.bat` / `.command`.
- **Carabiner** (Deep Symmetry) — passerelle vers Ableton Link, **téléchargée
  par l'utilisateur** au premier lancement, jamais redistribuée par ce dépôt.
  Ableton Link est sous GPLv2+ pour l'usage non commercial ; une licence
  commerciale d'Ableton est requise au-delà. Comme Cascade ne redistribue pas
  Carabiner et ne se lie pas à Link, cette obligation ne s'applique pas au
  dépôt — mais elle s'appliquerait à toute distribution qui l'embarquerait.

## Licence de Cascade

[MIT](LICENSE) — © 2026 Pierre-Yves Mansour, Collectif WSK.
