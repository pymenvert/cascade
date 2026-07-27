# Projeter une texture sur l'axe qu'on veut — pistes explorées

> **La demande de Pym**, dans ses mots : « je veux pouvoir choisir l'axe sur
> lequel est projetée la texture : par exemple face / haut / droite etc. »
> 1 à 3 axes, mémorisables, activables d'un bouton.
>
> Ce fichier garde la trace de **toutes** les pistes, y compris celles qu'on
> écarte — pour ne pas refaire deux fois le même chemin. Dernière mise à jour :
> **2026-07-28**.

---

## Le mécanisme de fond, mesuré

MadMapper ignore la 3D. **Une barre joue ce qu'elle lit à l'endroit où elle est
posée dans la composition 2D.** C'est le seul levier, et il est vérifié : bouger
une barre en x, en y ou en rotation change les valeurs DMX qui sortent (17 canaux
sur 30 modifiés pour une rotation de 90°).

Donc « choisir l'axe de projection » = **choisir où chaque barre lit**. Il n'y a
pas d'autre voie.

---

## ✅ PISTE RETENUE — les dossiers de fixtures, une vue par dossier

**L'idée est de Pym.** Chaque barre physique existe en **N copies** dans le projet
MadMapper, toutes à la **même adresse DMX**, chacune placée selon une projection
différente. Les copies d'une même vue sont rangées dans un **dossier** portant le
préfixe de la vue. On bascule d'une vue à l'autre en allumant un dossier et en
éteignant les autres.

### Tout ce que ça suppose est mesuré (2026-07-28)

| Question | Réponse mesurée |
|---|---|
| MadMapper accepte-t-il deux fixtures à la même adresse ? | **oui**, sans avertissement (`Ctrl+D` auto-incrémente, il faut remettre l'adresse) |
| Une seule copie visible rend-elle bien SON contenu ? | **oui**, exactement |
| Deux copies visibles en même temps ? | **la dernière de la liste gagne** — pas un mélange, pas du HTP. Défaillance déterministe, donc bénigne |
| Aucune copie visible ? | **tous les canaux à zéro** |
| Un dossier est-il exposé en OSC ? | **oui** : `/fixtures/<dossier>/visible` et `/luminosity` |
| Le dossier commande-t-il ses membres ? | **oui** : `visible = false` → tous les canaux de ses membres à 0 |
| Son `luminosity` atténue-t-il ses membres ? | **oui, proportionnellement** : 0,5 → 127 ; 0,25 → 64 ; rapports mesurés 0,499 / 0,251 |

### Pourquoi c'est la bonne piste

- **Aucune géométrie n'est écrite pendant le spectacle.** Un seul message OSC par
  vue. Plus de relevé d'avant à sauvegarder, plus de datagramme perdu qui laisse
  une barre à côté, plus de risque d'abîmer le mapping.
- **Les fondus entre vues sont possibles**, puisque le `luminosity` du dossier est
  proportionnel.
- `visible` et `luminosity` sont des contrôles **sûrs** au sens de la règle du
  projet : écriture suivie d'une relecture qui bouge.

### Points d'attention

1. **L'ordre de la liste décide** quand deux dossiers sont visibles. Cascade doit
   garantir qu'un seul l'est, et le **vérifier par relecture**.
2. Sortir une fixture d'un dossier **change sa place dans la liste** (constaté).
   Donc l'ordre n'est pas stable dans le temps : ne jamais s'y fier, toujours
   n'allumer qu'un dossier.
3. **Une barre hors de toute zone joue du noir**, sans que rien ne le dise —
   `luminosity` multiplie ce qu'elle lit, et une composition vide vaut zéro.
   C'est la panne fantôme la plus probable de toute la fonction.
4. Le nombre de fixtures est multiplié par le nombre de vues. 24 barres × 3 vues
   = 72 fixtures dans le projet. À surveiller côté lisibilité.

---

## ⚠️ PISTE ÉCARTÉE — « ranger les barres » à chaud

Cascade calcule la disposition et écrit `output/x|y|rot` de chaque barre au
moment où l'on change de vue.

**Écartée** parce que la piste des dossiers fait la même chose sans aucun de ces
risques : il fallait un relevé d'avant obligatoire, une vérification par
relecture (l'UDP n'accuse rien : 40 barres = 120 messages, une barre peut
atterrir à côté en silence), un bouton « remettre comme avant », et l'opération
restait à froid de toute façon.

**Ce qui reste utile de cette piste** : le calcul lui-même. Cascade connaît la
position 3D de chaque barre, donc il sait où elle doit aller pour une projection
donnée. Ce calcul sert à **construire les dossiers au montage**, une fois — pas à
basculer en conduite. Le bouton « Ranger » garde donc sa raison d'être, mais
comme outil de préparation.

---

## ❌ IMPOSSIBLE — vérifié, ne pas y revenir

| Ce qu'on voudrait | Verdict, mesuré |
|---|---|
| Créer une surface, une fixture, un dossier en OSC | **aucune commande** sur 14 203 nœuds. Seuls `/application/media/add`, `/media/<nom>/assign` et `assign_to_all_surfaces` existent |
| Choisir quelle surface reçoit quel visuel | `assign` va à la surface **sélectionnée dans l'interface**, et `/surfaces/<nom>/select` **ne fonctionne pas** en OSC (essayé float, int, bang) |
| Changer l'empreinte d'échantillonnage d'une barre | `output/width|height` d'une **fixture** n'ont aucun effet (testé de 0,25 à 4) |
| Lire cette empreinte | rien ne l'expose |
| Modifier l'adressage DMX | **rien n'est exposé** — le patch Art-Net est intouchable par cette voie |
| Lire la résolution de sortie | rien ne l'expose (d'où le réglage manuel dans Cascade) |
| Déformer une surface par ses coins | **INTERDIT** : `output/handles/*` a une lecture morte et une écriture irréversible. Incident du 27/07 : une surface détruite, non récupérable par `Ctrl+Z` (les écritures de géométrie ne sont pas dans la pile d'annulation) |

---

## Le contrôleur du régisseur : Advatek PixLite 16 MkII

Question de Pym : « je sais pas comment ça va réagir si je lui envoie 2 côtés en
même temps (donc 2 barres sur une même adresse) ».

**Il ne verra jamais deux barres sur une adresse.** Les copies vivent *dans*
MadMapper, qui **résout le conflit avant d'émettre** : la capture Art-Net montre
**une seule valeur par canal**, toujours. Ce qui sort est un univers Art-Net
parfaitement ordinaire. Le PixLite reçoit 512 octets et ignore qu'il y a eu des
doublons en amont ; sa configuration (univers et canal de départ par sortie) n'a
pas à changer d'un iota.

Le seul mode de défaillance, si deux dossiers étaient visibles ensemble : le
PixLite recevrait des données **valides mais issues de la mauvaise vue**. Une
erreur de contenu, jamais une erreur de protocole. Rien ne peut « tomber ».

⚠ **Non testé sur le matériel** : je n'ai pas de PixLite. L'argument repose sur la
mesure de ce que MadMapper émet, pas sur un essai avec le boîtier.

---

## Ce qui reste à mesurer

1. **L'empreinte d'une barre en pixels**, proprement. Une estimation existe (une
   barre de 10 LED ≈ 1 600 px, soit 160 px/LED) mais un seul déplacement sur cinq
   a donné une corrélation franche. C'est le chiffre qui dit si deux barres
   rangées côte à côte se chevaucheront.
2. **Le pivot de `output/rot`** : autour du centre de la barre, ou d'une
   extrémité ? Le calcul de placement en dépend (T14, jamais fait).
3. **Le DMX Filtering** de chaque fixture : c'est lui qui fabrique les
   demi-teintes, et Cascade ne peut ni le lire ni le garantir.
