# Journal des versions

Toutes les évolutions notables de Cascade. Format inspiré de
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ;
versionnage [sémantique](https://semver.org/lang/fr/).

## [Non publié]

### Corrigé — les correctifs de sécurité avaient eux-mêmes deux trous bloquants

Les correctifs de la relecture précédente ont été relus à leur tour, même
consigne. Deux d'entre eux étaient **contournables ou nuisibles**, mesurés contre
un vrai serveur :

- ⛔ **Le garde CSRF se contournait en une ligne.** Il testait une *sous-chaîne* :
  `Content-Type: multipart/form-data; boundary=application/json` la contient, et
  la règle CORS ne regarde que l'**essence** du type (`type/sous-type`), en
  ignorant les paramètres. Ce type est donc « safelisté » : un `fetch` en
  `no-cors` le pose **sans pré-vol**. Mesuré : `/api/quit` tuait le serveur et
  `/api/acces` posait le code de l'installation. On compare désormais l'essence,
  ce qui refuse au passage `application/jsonp` et accepte `APPLICATION/JSON`.
- ⛔ **Le dialogue Réglages retirait le code d'accès à chaque enregistrement.**
  Le champ du code est vidé à chaque ouverture (le serveur ne renvoie jamais le
  code), et un champ vide déclenchait un retrait. Ouvrir Réglages pour changer le
  port MadMapper et enregistrer **supprimait donc le code en silence**, et
  déconnectait toutes les tablettes. Un champ vide ne touche plus à rien ; le
  retrait est passé sur un **bouton dédié**, avec confirmation.

Trois autres, moins graves :

- une balise `<img src="…/api/state?a=1">` sur une page piégée pouvait **clouer
  un modulateur audio en butée** — sur le master avec `min` à 0, le noir en plein
  show. Le niveau n'est plus accepté que d'une requête de script ;
- un rappel de preset qui remplace le plateau change l'empreinte des presets
  **sans disposition propre** (les projets importés en ont) : la révision bouge
  maintenant dans ce cas précis ;
- changer d'entrée son pile pendant le démarrage du micro pouvait **avaler le
  redémarrage** : plus aucune attente après l'activation, la fenêtre disparaît.

⚠ Un anti-mutant ajouté au premier jet **survivait** : aucun test n'envoyait
l'en-tête qu'il concernait. Un garde-fou que rien ne tue est un faux garde-fou —
le test manquant a été écrit, et les 33 mutants sont vérifiés tueurs.

### Corrigé — trois défauts trouvés par relecture adversariale

Les trois fonctions ajoutées ci-dessous ont été relues par des yeux hostiles,
consigne : **essayer de les casser**. Trois trous réels, tous corrigés et tous
couverts par un test qui échoue sans le correctif.

- ⚠ **Le suiveur audio plongeait vers le noir en décrochant.** Le fondu de
  péremption faisait décroître le **niveau** vers 0 — or `min + (max−min) × niveau`
  envoie un niveau nul sur `min`. Le paramètre visait donc sa borne basse pendant
  450 ms avant de rendre la main d'un coup : sur le master avec `min` à 0, le noir
  en plein spectacle, exactement ce que la documentation de la fonction promettait
  d'éviter. La fraîcheur dose désormais le **retour à la main**, pas le niveau :
  la valeur glisse du micro vers le réglage réglé à la main sans jamais viser
  `min`. ⚠ L'ancien test de sécurité ne mesurait qu'**après** la péremption
  complète — il ratait le creux. Le nouveau échantillonne **pendant** le fondu.
- **La limitation du code d'accès s'effondrait face à plusieurs adresses.** Le
  blocage par IP (5 essais/minute) arrête un curieux, mais un attaquant qui fait
  varier son IP source — trivial en IPv6, où il tient tout un /64 — retrouvait les
  10 000 combinaisons. Un **plafond global**, indépendant de l'IP, s'ajoute :
  au-delà de 30 échecs par minute tous clients confondus, toute tentative depuis
  le réseau est refusée. La machine hôte n'est jamais prise dedans. Au passage,
  `accesEssais` grandissait sans borne (un attaquant multi-IP remplissait la
  mémoire) : les adresses inactives sont maintenant oubliées, les jetons expirés
  balayés, avec un plafond dur.
- **CSRF sur la machine hôte.** L'exemption locale du code d'accès laisse passer
  `localhost` sans jeton — c'est voulu, on ne peut pas s'enfermer dehors. Mais
  rien n'empêchait une page web piégée, ouverte dans le navigateur de l'hôte, de
  poster un formulaire vers `/api/new` (efface le projet), `/api/quit` (coupe le
  serveur) ou `/api/blackout`. Les POST exigent désormais
  `Content-Type: application/json` : un formulaire ne peut pas poser ce type, et
  toute l'interface l'envoie déjà.

### Corrigé — deux défauts de fraîcheur et de cycle de vie

- **L'empreinte d'un preset pouvait mentir.** Elle passe par `resolveBars`, qui
  résout les groupes **vivants** — un preset n'en mémorise pas. Modifier le
  contenu d'un groupe, ou changer le plateau, changeait donc ce qu'un preset
  piloterait au rappel, sans que la vignette bouge : elle restait figée jusqu'au
  prochain enregistrement. Ces deux routes rafraîchissent maintenant le compteur
  de révision, et un test le vérifie route par route.
- **Double clic sur « Écouter » : deux micros ouverts.** `suiveur.actif` n'était
  posé qu'après `getUserMedia` *et* `AudioContext.resume()` — or la demande
  d'autorisation du navigateur est le moment le plus long, et celui où l'on
  reclique parce qu'il ne se passe rien. Le second démarrage écrasait alors le
  flux et le contexte du premier, qui restaient orphelins : micro jamais relâché,
  `AudioContext` fuité (les navigateurs en plafonnent une poignée), deux boucles
  d'analyse. Une garde **synchrone**, posée avant le moindre `await`, ferme la
  course.

### Ajouté — la voie résiduelle du défaut v1 est enfin couverte

Un test fixe le comportement documenté mais jamais testé : **vider** un groupe
(au lieu de le supprimer, qui délie les couches) fait retomber une couche couleur
sur tout le plateau. C'est la dernière voie vivante qui reproduit le symptôme
d'origine de la v1. Le test ne corrige rien — il verrouille un choix (« mieux
vaut éclairer trop que rester dans le noir sans comprendre ») pour qu'un mutant
ne le change pas en silence.

### Ajouté — code d'accès facultatif à 4 chiffres

Cascade s'ouvre depuis un iPad ou un téléphone, donc depuis le Wi-Fi de la salle.
Un code facultatif (⚙ Réglages) empêche un curieux de prendre la main sur la
lumière pendant le spectacle.

**Ce qu'il protège** : l'API, depuis le réseau. Trois choix assumés :

- **il n'est JAMAIS demandé sur la machine hôte.** C'est ce qui garantit qu'on ne
  peut pas s'enfermer dehors : il y a toujours une voie pour le retirer. Et
  c'est le bon périmètre — la menace, c'est le Wi-Fi de la salle, pas la machine
  qu'on a physiquement sous la main ;
- **la page reste servie sans le code**, sinon il serait impossible d'afficher la
  demande. C'est l'API qui est fermée, pas l'interface ;
- **l'OSC et le MIDI ne sont pas concernés** : ils passent par un câble ou une
  console posée sur le réseau de production, c'est un autre domaine de confiance,
  et les fermer casserait les installations existantes.

**⚠ Les tentatives sont limitées, et c'est le cœur de la fonction.** Quatre
chiffres, c'est 10 000 combinaisons : sans limitation, ça se casse en quelques
secondes et le code ne protège rien. Cinq essais ratés bloquent l'appareil une
minute, et pendant ce blocage même le bon code est refusé. Un anti-mutant
verrouille cette propriété — la première version écrite avait précisément ce
défaut, le compteur repartant de zéro à chaque essai (`jusqua <= maintenant` est
vrai aussi pour `jusqua = 0`).

Le code n'est jamais stocké en clair : on garde un **haché salé**, qui ne sort
lui-même **jamais** du serveur — ni dans `/api/state`, ni dans `/api/settings`,
ni dans un projet exporté. Un haché de 4 chiffres se casse hors ligne
instantanément, donc l'envoyer reviendrait à envoyer le code. Le jeton de session
voyage dans un cookie `HttpOnly` + `SameSite=Strict` : la page ne le lit jamais,
donc un nom de fixture piégé ne peut pas le faire fuir. Changer ou retirer le
code déconnecte les appareils déjà entrés.

Dernier détail, mais il compte en régie : une page qui affiche la demande de code
**continue de compter comme une interface ouverte**. Sans ça, l'arrêt automatique
aurait pu couper Cascade pendant que le régisseur tape son code. Le pire qu'un
curieux puisse faire est donc de garder le serveur allumé — sans rien piloter.

### Corrigé — le fichier de configuration écrivait `scene` deux fois

Clé dupliquée dans l'objet sérialisé, sans conséquence (la seconde écrasait la
première avec la même valeur), trouvée en passant.

### Modifié — le panneau Couches se replie

Le panneau alignait une trentaine de réglages à plat, dont beaucoup ne se
touchent qu'au montage. Deux replis les rangent, sur le motif de « Groove &
découpe » déjà en place — la CSS était d'ailleurs écrite au pluriel pour être
réutilisée :

- **Symétries** — les deux miroirs et leurs axes ;
- **Mélange & espace** — fusion, profondeur, décalage réparti, jeu du crossfader.

Chacun porte une **pastille** qui compte et nomme ce qui est hors de sa valeur
neutre : un miroir ou une fusion oubliés derrière un repli fermé deviendraient
sinon un mystère. Le repli s'ouvre tout seul en **arrivant** sur une couche qui a
des réglages actifs, et pas à chaque rendu — sans quoi on ne pourrait jamais le
refermer, piège déjà payé sur « Groove ».

### Ajouté — suiveur audio : le micro devient une source de modulateur

Le micro se branche là où l'oscillateur était déjà branché. Un modulateur — de
couche ou global — gagne un réglage **Source** : « Oscillateur (boucle) » ou
« Micro (suiveur audio) ». Tout le reste est inchangé, donc le micro peut piloter
tout ce qu'un modulateur pilotait déjà : niveau, largeur, netteté, profondeur,
crossfader, master…

L'analyse vit **dans le navigateur** (Web Audio) : le zéro-dépendance interdit
une entrée son côté serveur. Le niveau part ensuite en paramètre du poll qu'on
fait déjà — aucune requête de plus, ~8 octets sur la ligne de requête, zéro dans
la réponse. Réglages : bande (grave / médium / aigu / tout), gain, seuil (porte
de bruit), attaque et relâchement, avec un vu-mètre.

**Deux limites, dites noir sur blanc dans l'aide et dans le panneau :**

- ⚠ **Il lit une ÉNERGIE, pas un tempo.** Il fait respirer la lumière avec le
  son ; il ne détecte pas les battements et ne cale pas le chase sur la musique.
  La détection de tempo est ~150 lignes de DSP dont la justesse dépend du
  répertoire, avec l'erreur d'octave comme échec structurel : elle attend un
  essai en salle plutôt qu'une hypothèse.
- ⚠ **Le micro n'est lisible que sur la machine où tourne Cascade.** Les
  navigateurs interdisent l'accès au micro hors origine sûre, donc jamais depuis
  `http://<adresse>:3333`. C'est le même choix que celui déjà assumé pour Web
  MIDI. Depuis un iPad, tout le reste fonctionne — et sans micro, la page ne
  pousse rien, donc une tablette ne peut pas écraser ce qu'entend la machine hôte.

**La propriété de sécurité, et elle est verrouillée par un anti-mutant : la
péremption REND LA MAIN.** Sans niveau frais depuis 700 ms — onglet fermé, micro
débranché, machine en veille — le modulateur laisse le réglage du régisseur
intact, avec un fondu pour éviter la marche d'escalier. Retomber sur la borne
basse aurait été le noir en plein spectacle dès que `min` vaut 0 sur le master ;
rester figé sur la dernière valeur aurait cloué le show sur ce qu'entendait un
onglet fermé.

Aucun conflit avec Ableton Link, et c'est mieux que de bien l'arbitrer : le
suiveur n'écrit jamais `stepMs`, donc il n'y a rien à écraser. L'état n'est
jamais écrit non plus — comme les modulateurs, le niveau vit le temps d'une
image et ne se retrouve ni dans la configuration, ni dans un export, ni figé
dans un preset.

La calibration vit dans `state.settings`, **pas** dans le `localStorage` : la
promesse du projet est que la régie tienne sur une clé USB, et un réglage laissé
dans le navigateur resterait sur la machine.

Vérifiable **sans micro**, ce qui était le critère décisif du choix : la moitié
serveur se teste en poussant un niveau en query (`/api/state?a=0.9`), et la DSP
est isolée en fonction pure qu'on nourrit d'un spectre fabriqué à la main. Le
chemin nominal est tout de même exécuté pour de vrai — les tests d'interface
lancent Chromium avec un faux périphérique audio.

### Ajouté — les 16 presets deviennent une grille

Les presets étaient une rangée de boutons numérotés qui se repliait selon la
largeur de la fenêtre : en régie, dans le noir, on vise une case dont on croit
connaître la place et elle a bougé. C'est maintenant une **grille** — 8 colonnes
sur poste, 4 sur tablette — et chaque pavé porte trois informations qu'il fallait
jusque-là deviner :

- **une empreinte** : une case par barre que le preset pilote, teintée comme la
  couche qui la pilote. ⚠ C'est une **couverture, pas une image du motif** : un
  chase n'allume qu'une barre à la fois, une photo serait presque vide et
  changerait à chaque image. Elle passe par `resolveBars`, donc elle ment
  exactement comme mentirait le moteur — une vignette qui corrigerait le moteur
  serait pire qu'inutile ;
- **le pavé qui joue**, et celui d'où l'on vient pendant un fondu ;
- **« ce preset ne pilote plus aucune barre »**, en bord pointillé. C'est
  l'information la plus utile avant de tirer un pavé, et la masquer laisserait
  croire à une panne au moment du rappel.

Les empreintes sont servies par une route dédiée (`GET /api/presets-info`),
tirée seulement quand le compteur de révision de la banque bouge. `/api/state`
ne gagne que trois entiers : cette réponse part **huit fois par seconde**, et y
loger 16 empreintes aurait coûté une demi-kilo-octet à chaque tour pour une
donnée qui ne change qu'à l'enregistrement. Un test vérifie qu'aucune empreinte
n'y est jamais réapparue.

Le calcul n'instancie aucun moteur, ne touche à aucun état d'exécution et
n'émet aucun OSC : on peut l'appeler en plein spectacle sans rien déranger. Si
la route échoue, les pavés s'affichent simplement sans bande, sans un bruit.

### Corrigé — un nom de preset de plus de 12 caractères était raboté

`sanitizePresets` coupait à 12 là où l'enregistrement et le renommage coupent à
16. Le rabotage n'arrivait donc ni à la saisie ni au rappel, mais au
**rechargement du fichier** — quand plus personne ne regarde. « Refrain final 2 »
revenait « Refrain fin ». Deux anti-mutants gardent désormais ce chemin, qui
n'en avait aucun.

## [2.0.2] — 2026-08-04

Deuxième version de fiabilisation. Deux défauts bloquants trouvés par relecture
adversariale, un bruit 3D qui se répétait dans le temps, et surtout une **suite
de tests qui se mentait à elle-même** : des tests qui ne mesuraient rien, et
32 tests d'interface qui ne tournaient pas du tout sans que rien ne rougisse.
Aucun nouveau réglage, aucune nouvelle fonction — le manuel est inchangé.

### Corrigé — le bruit 3D se répétait dans le temps

Le multiplicateur de l'axe Z de `hash3` valait 2147483647, soit 2³¹−1. En
arithmétique 32 bits, multiplier par cette valeur revient à `-z` plus un bit de
parité : un multiplicateur **dégénéré**. L'avalanche qui suit brouillait assez
la sortie pour que rien ne se voie à l'œil, mais la mesure est sans appel — sur
199 pas consécutifs, l'axe Z ne donnait que **14 écarts distincts**, contre 199
pour X et 197 pour Y. Or c'est Z qui porte le **temps** : le bruit se répétait
dans la durée.

La constante d'étalement a été **recalibrée en conséquence** : un hachage
correct élargit la distribution, et l'ancienne valeur faisait remonter la
saturation à 15,2 % — le clignotement dur qu'on avait justement chassé. 0,2000
ramène la saturation à 4,2 %, exactement l'intention des ±2 écarts-types.
⚠ Calibré sur la mesure réelle du moteur, pas sur un balayage synthétique :
celui-ci donnait 0,1844, une valeur qui laissait le test tomber.

`tests/hachage.test.js` verrouille la propriété en lisant `hash3` dans la source
et en comptant les écarts distincts par axe.

### Corrigé — deux défauts bloquants

Trouvés par une relecture adversariale menée en parallèle, **reproduits ici à
l'identique avant toute correction**.

- **Le crossfader en butée rallumait tout le plateau.** Une couche d'intensité
  rangée dans un jeu était *retirée* du mix à poids nul au lieu d'y contribuer
  zéro. La barre disparaissait alors du mélange, et le repli « pilotée seulement
  en couleur, on ouvre le gradateur » s'appliquait à tort. Mesuré : 0,0980 à
  `xfade` 0,90 ; 0,0118 à 0,99 ; 0,0039 à 0,995 ; puis **1,0000 à 1,00**.
  C'est-à-dire à la fin de *chaque* transfert, quand le régisseur pose son fader
  en butée — et pareil depuis une console avec `/chaser/xfade 1`.
  Le mélange remonte désormais l'ensemble des barres **ciblées** par une couche
  d'intensité, rempli avant le test du poids nul.
- **La page Conduite ne déplaçait plus rien.** Glissé, pivoter, Ligne, Colonne,
  les deux miroirs, et surtout « Importer depuis MadMapper » qui annonçait
  « N fixtures placées » sans que rien ne bouge. La page renvoie tout le tableau
  des fixtures, `p3` compris ; le serveur voyait une 3D valide, décrétait
  qu'elle fait foi, et recalculait x/y/rot depuis l'ancienne position. La 2D
  gagne maintenant quand elle contredit la 3D reçue, en **préservant la
  profondeur** — ranger une barre de gauche à droite ne doit pas la ramener au
  premier plan.

Les deux trous de test qui les avaient laissés passer sont bouchés : le test du
crossfader n'avait **aucune couche couleur** en scène, donc le repli ne pouvait
pas se déclencher ; et aucun test n'envoyait de fixtures **avec** `p3` et une 2D
modifiée.

### Tests — la suite était verte pour de mauvaises raisons

Une suite verte ne prouve pas que tout a tourné. Trois cas, tous vérifiés en
cassant volontairement le comportement pour voir le test tomber.

- **32 tests d'interface ne tournaient pas.** `findBrowser()` ne regardait que
  les chemins système ; les conteneurs installent Chromium sous
  `PLAYWRIGHT_BROWSERS_PATH`. La suite d'interface s'y annonçait « ignorée »,
  la sortie restait **verte**, et on lisait 230 tests au lieu de 262 sans que
  rien ne le signale. Deux voies ajoutées avant les chemins système :
  `CASCADE_NAVIGATEUR` (binaire imposé) et un balayage de l'installation
  Playwright. Chromium refusant de démarrer en root, `--no-sandbox` est ajouté
  **uniquement si l'uid vaut 0** — sur une machine de développement, le bac à
  sable reste en place. En intégration continue, l'absence de navigateur fait
  désormais échouer le job au lieu d'être signalée par un simple message.
- **Un test qui ne mesurait rien concluait que tout allait bien.** L'assertion
  demandait qu'un écart soit *petit* ; sans relevé, l'écart valait 0 et le test
  passait. Les assertions du même genre ont été balayées : les autres sont
  saines, parce qu'elles tombent bruyamment sur un relevé vide.
- **Un test intitulé « la coupure survit à un redémarrage » ne redémarrait
  rien.** Il vérifie maintenant qu'un serveur **neuf**, nourri de la
  configuration écrite par le premier, retrouve la coupure engagée. Piège
  consigné au passage : l'écriture est différée de 500 ms, donc lire le fichier
  trop tôt donne un `ENOENT`.

Le nettoyage des tests du champ 3D passe par un crochet `afterEach` : une
assertion qui tombe ne peut plus laisser un plateau et une couche dans un état
inconnu pour le test suivant. Honnêteté sur ce point : la cascade d'échecs a été
**cherchée sans être reproduite** — c'est une garantie structurelle, pas une
correction. Le test de palette hostile compare désormais *quels* arrêts
survivent, et non plus seulement combien.

### Documentation

- Les fichiers de reprise annonçaient la **1.6.0** et une branche `v2` fusionnée
  depuis. Schéma d'état et liste d'API recollés sur `server.js` ; comptes remis
  d'aplomb (262 tests, 27 mutants) ; `PLAN-V2.md` et `V1-V2.md` marqués
  historiques — le second disait encore de committer sur une branche disparue.
- **Deux défauts présentés comme ouverts étaient corrigés depuis la 2.0.1** : la
  couche couleur qui allume les barres qu'elle ne pilote pas, et la phase non
  préservée au changement de tempo. Ils venaient d'une relecture arrêtée avant
  sa phase de vérification. Une piste réellement ouverte est notée à leur place :
  `resolveBars()` replie sur *toutes* les barres actives quand le groupe d'une
  couche est vidé.
- Deux mesures MadMapper consignées : **le pivot de `output/rot` est le point de
  position lui-même** (écart 0,00 en x et y — l'ordre position/orientation est
  donc libre), et MadMapper **ne développe pas les motifs OSC** (`* ? [ ] { }`),
  donc les envoyer verbatim est correct. Il ne reste que **deux** mesures à
  faire, pas trois.

## [2.0.1] — 2026-07-28

Version de fiabilisation, issue de l'audit complet de la 2.0.0. Aucun réglage,
aucune fonction : uniquement des adresses OSC qui partaient au mauvais endroit
dans des cas anormaux. En usage courant — fixtures scannées depuis MadMapper —
le comportement est strictement identique à la 2.0.0.

### Corrigé

- **Les adresses OSC des fixtures sont nettoyées.** Trouvé à l'audit de la
  2.0.0, en envoyant des adresses hostiles et en lisant ce qui sortait vraiment
  sur le réseau. Trois défauts silencieux :
  - un **octet nul tronquait l'adresse** à l'encodage : `/fixtures/bar zzz`
    partait comme `/fixtures/bar`. Cascade pilotait un nœud différent de celui
    affiché, sans le moindre signe ;
  - une adresse **sans `/` initial** partait telle quelle, alors qu'elle n'est
    pas valide au sens de la spécification OSC ;
  - une adresse **vide** produisait `/luminosity`, un message adressé à personne.
    Une fixture sans adresse n'envoie plus rien.

  Les fixtures normales ne changent pas d'un iota, espaces compris — les noms de
  fixtures MadMapper en contiennent souvent, et un test le verrouille.

## [2.0.0] — 2026-07-28

Version « espace » : Cascade sort du plan. Un effet devient une fonction de la
position réelle de chaque barre dans le volume, et la scénographie se dessine
en trois dimensions.

Rien de ce qui suit ne modifie le rendu d'un show existant : tous les nouveaux
réglages sont neutres par défaut, et un projet 1.x est migré sans bouger d'un
pixel. Les quatre défauts marqués **v1** ci-dessous étaient en revanche présents
dans la 1.6.0 — c'est la raison la plus sérieuse de passer à cette version.

### Ajouté

- **Une deuxième page, « Scène »** — la scénographie en 3D, à côté de la page
  Conduite. Caméra orbitale, quatre vues (Face, Dessus, Côté, 3/4), les barres
  allumées en direct pendant le show. Les trois vues de plan sont
  orthographiques : sans ça, la vue de face ne coïnciderait plus avec la page
  Conduite, or c'est tout son intérêt. Sélection commune aux deux pages.
- **Un repère en mètres.** X = jardin↔cour, Y = profondeur, Z = hauteur,
  origine au centre du plateau au sol — la convention des plans de feu. La 3D
  est la vérité, la 2D en est la projection. Un projet v1 est migré sans bouger
  d'un pixel.
- **Manipulation à la souris** : glisser une barre la déplace (magnétisme 5 cm),
  <kbd>Maj</kbd> limite à la hauteur, <kbd>Alt</kbd> l'oriente (magnétisme 5°),
  glisser le vide tourne la vue. <kbd>Ctrl</kbd>+<kbd>Z</kbd> défait.
- **Moteur « Champ 3D »** — un effet devient une fonction de la position réelle
  de chaque barre. Cinq formes : plan avec axe réglable, sphère, cylindre
  (le phare), boîte, et bruit 3D. Le champ ne produit qu'une grandeur, qui
  traverse ensuite **exactement** la chaîne existante — forme d'onde, niveau
  bas, niveau, couleur, HTP, master, courbe de gradateur, Ableton Link. Un plan
  sur l'axe X rend les mêmes valeurs qu'une vague « G › D », et c'est vérifié
  par un test : le champ est une généralisation, pas un second moteur.
- **« Ordre = axe 3D »** pour le pas-à-pas : le chase suit la géométrie réelle
  du plateau au lieu de l'ordre de la liste.
- **Groupes de barres nommés**, avec lien vivant : modifier le groupe met à
  jour toutes les couches qui le suivent.
- **« Renvoyer la disposition vers MadMapper »** — un bouton, avec
  confirmation, et rien d'autre. Déplacer une barre dans Cascade n'envoie
  aucune géométrie : c'est le réglage du régisseur, on ne l'écrase pas dans son
  dos.
- **« Trouver le port »** dans les réglages : interroge les ports habituels et
  dit lequel répond. Le port d'entrée OSC de MadMapper est un réglage **de
  projet**, il n'est pas toujours 8000, et rien ne permettait de s'en
  apercevoir.
- **Messages passagers** (en bas de l'écran) à la place de `alert()`, qui
  bloquait la page — inacceptable pendant un show.

### Mesuré sur MadMapper 6.0.9

Une campagne complète, valeurs DMX réelles lues en Art-Net. Tout est consigné
dans `docs/V2-TESTS-MADMAPPER.md` et `docs/madmapper-osc-api.md`.

- `luminosity` **multiplie** la texture échantillonnée, linéairement
  (255 → 127 → 64), et le motif des LED allumées ne change pas. Le blackout
  coupe vraiment, même en régime texture.
- La chaîne est linéaire **de bout en bout** : exposant mesuré 1,00 sur des
  demi-teintes.
- **Déplacer une barre change ce qu'elle joue** — vérifié sur la sortie DMX,
  pas seulement par relecture OSC.
- `output/x` et `output/y` sont en **pixels**, pas en 0..1. `output/rot`
  n'accepte que **[0 ; 360[** et, hors plage, ignore le message **sans rien
  dire**. Ces deux pièges ont chacun coûté un bug, tous deux corrigés.

### Ajouté (suite)

- **Vues** — choisir l'axe sur lequel une texture est projetée. Une vue = un
  dossier de fixtures MadMapper ; chaque barre y existe en une copie, toutes à la
  **même adresse DMX**. On bascule d'un axe à l'autre en n'allumant qu'un
  dossier : rien ne se déplace pendant le spectacle. Fondu réglable entre vues,
  voyant d'existence du dossier, et une case « à moi » pour la vue dessinée à la
  main que Cascade ne recalculera jamais.
- **Coupure de secours** — met la sortie DMX de MadMapper à zéro d'un message.
  C'est la seule voie qui coupe vraiment quand une texture joue. Volontairement
  séparée de BLACKOUT, avec un bandeau rouge impossible à manquer.
- **Netteté du motif** (5–100 %) — sans elle, le motif occupait toujours 100 % de
  sa longueur d'onde : la moitié du plateau était allumée en permanence, et une
  comète était impossible.
- **Source mobile** — elle balaie un segment le long de l'axe. Sphère + course +
  netteté serrée = comète.
- **Sept modes de fusion** entre couches (`htp`, addition, multiplication,
  écran, minimum, soustraction, remplacement). Cascade ne savait faire que du
  HTP — le réflexe des consoles, parfait pour empiler des chases, mais qui
  interdit de *mixer*. La multiplication transforme une couche en **masque** :
  un plan en profondeur posé sur une nappe ne laisse passer la texture que dans
  la tranche éclairée. HTP reste le défaut, donc aucun projet existant ne bouge.
- **Perspective atmosphérique** (0–100 % par couche) — les barres du lointain
  sortent plus sombres, normalisé sur la cote du plateau pour que le réglage
  garde son sens dans une autre salle. C'est ce qui fait **lire** la profondeur :
  sans elle, deux barres à cinq mètres l'une derrière l'autre se confondent en
  une seule surface.
- **Palette à N arrêts** (jusqu'à 8), avec cinq palettes prêtes — Feu, Glace,
  Coucher de soleil, Forêt, Distance. Deux couleurs interdisaient tout dégradé
  qui ne passe pas par le mélange des extrêmes : pas de feu noir → rouge →
  orange → jaune → blanc.
- **« La palette suit »** — le motif, la profondeur, ou la hauteur. Branchée sur
  la profondeur, la couleur d'une barre ne dépend que de sa distance au public :
  chaud devant, froid derrière. C'est la seconde moitié du depth-cue, la
  perspective agissant sur l'intensité et celle-ci sur la teinte.
- **Modulateur par couche** — un LFO branchable sur neuf réglages continus
  (niveau, niveau bas, largeur, vitesse, netteté, course, profondeur, décalage,
  décalage réparti), quatre formes, période de 0,1 s à 2 min — ou **calée sur
  le tempo**, la période devenant un multiple du cycle de la couche, donc suivant
  le tap tempo, la vitesse globale et Ableton Link toute seule. Il n'écrit jamais
  dans l'état : le moteur travaille sur une copie modulée, donc l'interface
  affiche toujours le réglage du régisseur et le couper rend la main. Sa valeur
  subit le même nettoyage qu'une saisie, donc il ne peut pas sortir un réglage
  de sa plage. La liste des paramètres modulables est fermée — moduler `target`
  ou `bars` fabriquerait des états incohérents plusieurs fois par seconde.
- **Modulateur global** — le même mécanisme, sur le crossfader, le master ou la
  vitesse globale. Sur le crossfader, la scène passe d'un jeu à l'autre toute
  seule : elle respire entre deux ambiances sans qu'on tienne le fader. Un
  projet neuf n'en hérite jamais.
- **Crossfader entre deux jeux de couches** — l'outil de conduite de Madrix.
  Chaque couche se range dans le jeu A, le jeu B, ou nulle part (« Toujours »,
  le défaut). Un fader passe de l'un à l'autre, et une console peut le tenir :
  `/chaser/xfade 0-1`. La différence entre déclencher un preset — un saut — et
  **jouer** un passage. Le poids s'applique sur le résultat de la fusion, pas
  sur la valeur : sinon une couche en multiplication baissée à zéro deviendrait
  un masque noir et éteindrait tout ce qui est dessous.
- **Décalage réparti** (0–1440°) — l'idée des MAtricks de grandMA. La première
  barre à 0°, la dernière à N°, étalé sur la sélection. Combiné à « ordre = axe
  3D », une vague traverse la scéno selon un axe réel avec un seul réglage.
- **« Inverser la LED »** par barre, pour les barres câblées à l'envers.
- **Quatre démos** — Profondeur, Comète, Phare, Feu.
- **Repère du champ dans la vue 3D** : l'axe en flèche, la source en croix, sa
  course en trait épais.

### Corrigé

Quatre de ces défauts existaient **déjà en v1** — donc dans la version qui part
en spectacle. Chacun a été reproduit sur un vrai serveur avant d'être corrigé,
et chacun a son test dans `tests/regressions.test.js`.

- **v1 · une couche COULEUR allumait les barres qu'elle ne pilote pas.** Un
  chase couleur sur trois barres en éclairait douze.
- **v1 · la phase n'était pas préservée au changement de tempo** pour les
  moteurs continus. Passer le tempo de 0,01 % téléportait le motif (saut de
  0,93 cycle mesuré). Remplacé par une horloge de phase intégrée.
- **v1 · GO / RESYNC ne ramenait pas** les moteurs continus au début du cycle.
- **v1 · le rappel de preset ne re-dérivait pas la 2D** depuis la 3D.
- **Le bruit 3D était figé dans le temps** : le mélange de bits dépassait 2⁵³ en
  virgule flottante et la composante temporelle disparaissait. Corrigé avec
  `Math.imul`.
- Le bruit 3D **saturait 24,5 %** de ses valeurs aux butées — du clignotement
  dur au lieu de mouvement organique. Ramené à 3,8 % en mesurant sa distribution
  réelle plutôt qu'en la devinant.
- Le **centre du champ en profondeur** n'était pas le milieu du plateau.
- Le **cylindre basculait** en traversant certaines élévations, et se déchirait
  à certaines étendues. Base construite analytiquement depuis l'azimut.
- La **boîte** était restée proportionnelle à la sphère : sur un rig plat elle
  ne se distinguait pas. C'est maintenant un vrai pavé mobile.
- Les positions 3D sont bornées à ±500 m : un glissé emballé, ou une requête
  hostile, expédiait une barre hors d'atteinte de la souris.
- `setPointerCapture` sous `try/catch` : la capture peut légitimement échouer,
  et l'exception interrompait le début du geste.

### Intégration continue

Le dépôt n'avait **aucun workflow GitHub** — jamais. Les exécutables se
construisaient sur un poste et s'attachaient à la main dans le navigateur.

- `tests.yml` : la suite sur chaque push vers `main` et chaque PR. Elle vérifie
  aussi qu'aucune dépendance npm n'a été introduite — la règle du zéro
  dépendance ne se surveille pas toute seule.
- `release.yml` : pousser un tag `vX.Y.Z` construit les quatre exécutables et
  publie la release avec eux. Il refuse de publier si la suite n'est pas verte,
  et vérifie que les quatre fichiers sont là plutôt que de sortir une release
  amputée. La description vient du CHANGELOG, extraite par
  `tools/notes-version.js` : un texte de release recopié à côté finit toujours
  par diverger.

### Tests

248 tests (contre 129 en 1.6.0), dont le pilotage d'un vrai navigateur avec de
véritables événements de souris injectés par CDP, et un **outil de mutation**
(`npm run test:mutation`) qui casse le code exprès pour vérifier que la suite
s'en aperçoit — **21 mutations, 21 détectées**.

Un garde-fou a été ajouté après incident : un commit était parti avec un
cassage volontaire encore en place, et toute la suite restait verte — c'est
normal, un mutant tue une fonction, pas un test. Un test vérifie désormais que
le code source contient toujours la forme saine de chacun des vingt-et-un endroits
que l'outil sait casser.

## [1.6.0] — 2026-07-25

Version « phase » : Cascade ne se contente plus de suivre le tempo d'Ableton
Link, il joue **sur** les temps.

### Ajouté

- **Synchronisation de phase Ableton Link.** Jusqu'ici Cascade prenait le BPM
  de la session : le bon tempo, mais démarré n'importe où — donc capable de
  jouer à contretemps de la musique toute la soirée. Désormais chaque pas est
  calé sur un beat de la grille Link, et le pas 0 tombe sur un temps fort.
  - Recalculé à **chaque image** depuis la position réelle sur la grille :
    aucune dérive possible, même après des heures.
  - Mesuré : les allumages tombent à moins d'un tick moteur (25 ms) du beat.
  - Activé par défaut, débrayable d'une case (« Phase ») pour retrouver le
    comportement précédent. Aussi en OSC : `/cascade/linkphase 0-1`.
- **Témoin de mesure** — une rangée de points, un par temps, le temps fort en
  tête, qui bat avec la session Link. On voit d'un coup d'œil si Cascade est
  accroché à la musique. Mesure réglable de 1 à 16 temps (valse comprise).
- Le premier allumage part **au moment du START**, pas au beat suivant : un
  show doit démarrer quand on appuie. La grille reprend la main dès le pas
  suivant.

### Corrigé

- **Démarrer avec Link rejouait toute l'histoire de la session.** L'origine
  des pas étant le beat 0 de Link — vieux de plusieurs heures — un START
  déclenchait d'un coup tous les pas écoulés depuis. Trouvé par les nouveaux
  tests de phase.

### Interne

- `tests/link.test.js` : un faux Carabiner en TCP répond aux `status` avec une
  position de beat qui avance réellement. Huit tests vérifient le tempo, le
  verrouillage de la grille, l'alignement réel des allumages, le changement de
  tempo à chaud, et le repli propre quand Carabiner se tait.
- 111 tests (103 auparavant).

## [1.5.0] — 2026-07-25

Version « scéno » : les groupes de barres, et des tests qui pilotent enfin un
vrai navigateur.

### Ajouté

- **Groupes de barres nommés** — « sol », « contres », « portique ». Une couche
  peut **suivre** un groupe : c'est un lien vivant, pas une copie. Vous changez
  les barres du groupe, tous les chasers qui le suivent se mettent à jour.
  - Jusqu'à 16 groupes, gérés depuis le panneau Fixtures : clic pour choisir
    les barres dans la vue spatiale, double-clic pour renommer.
  - Chaque couche choisit sa cible : toutes les barres, un groupe, ou une
    sélection manuelle.
  - Les groupes appartiennent à la scéno, pas au look : ils voyagent avec le
    fichier projet mais ne sont **pas** mémorisés dans les presets.
  - Un groupe vidé ou supprimé ramène la couche sur toutes les barres — mieux
    vaut éclairer trop que rester noir sans explication.
- **Icône d'application** — une petite cascade de barres orange, intégrée en
  SVG dans la page (aucun fichier de plus à distribuer).

### Corrigé

- Le navigateur réclamait une icône à chaque chargement et récoltait un 404.
  Trouvé par les nouveaux tests d'interface.

### Interne

- **Tests pilotant un vrai navigateur, toujours sans aucune dépendance.**
  Chrome ou Edge est lancé en arrière-plan et piloté par le protocole DevTools,
  à travers le WebSocket intégré à Node. Douze tests chargent la page, cliquent
  sur les vrais boutons, envoient de vraies touches, et vérifient qu'aucune
  erreur JavaScript ne survient.
  - Vérifié en cassant volontairement trois choses : une erreur au chargement,
    un bouton débranché, une injection HTML réintroduite. Les trois sont
    attrapées.
  - Sans navigateur installé, ces tests s'annoncent ignorés au lieu d'échouer.
  - `npm run test:ui` pour ne lancer que ceux-là.
- 103 tests (91 auparavant).

## [1.4.0] — 2026-07-25

Version « conduite » : moins de réglages sous les yeux, plus de repères
pendant le show.

### Ajouté

- **Fondu entre presets** (réglable, 0 à 30 s) — au rappel d'un preset, la
  scène sortante **continue de jouer** et décroît pendant que la nouvelle
  monte. Ce n'est pas un simple fondu au noir : les deux chases tournent en
  parallèle, chacun avec son propre état moteur, et les niveaux se mélangent.
  À 0 le rappel reste sec, comme avant.
  - Réglage global dans le panneau Tempo, échelle logarithmique (au dixième de
    seconde dans les temps courts, là où ça compte).
  - Un filet orange sous la rangée de presets montre la progression.
  - Pilotable en OSC : `/cascade/presetfade 0-1` (0 à 10 s).
  - Forçable pour un rappel précis : `POST /api/preset {action:'recall', slot, fadeMs}`.
  - STOP, BLACKOUT et START annulent un fondu en cours. Aucun fondu n'est
    déclenché si rien ne joue.
- **Presets nommables** — à l'enregistrement, Cascade demande un nom ; un
  double-clic sur un slot le renomme. En conduite, on retrouve « Refrain »
  bien plus vite que « P7 ». Le numéro reste affiché en petit : c'est lui qui
  compte pour le MIDI et l'OSC. Le nom suit l'export et l'import.
- **Raccourcis clavier** — `S` démarrer/arrêter, `B` blackout, `Espace` tap,
  `R` resync, `G` GO sur la couche courante, `1`–`8` choisir une couche,
  `?` ou `H` pour l'aide. Un bouton **?** ouvre la même liste.
  Les raccourcis sont ignorés pendant une saisie et quand un dialogue est ouvert.
- **Premier lancement guidé** — sans barre configurée, l'interface affiche les
  quatre étapes à suivre au lieu d'une page vide, avec un témoin qui dit si
  MadMapper répond déjà.

### Modifié

- **Panneau Couches simplifié** — les réglages fins (décalage, swing, blocs,
  scintillement, une fois) sont regroupés sous un repli « Groove & découpe ».
  Une pastille orange indique combien y sont actifs, et le repli s'ouvre tout
  seul quand on arrive sur une couche qui en utilise : rien ne se cache
  silencieusement.
- Le manuel PDF passe à 9 pages (presets nommés, repli, chapitre raccourcis).

### Interne

- `node sync-dist.js` recopie les sources dans `dist/`, et **un test échoue si
  `dist/` diverge**. La copie manuelle était une source d'erreur : livrer un
  `dist/` obsolète, c'est livrer une version jamais testée.
- **Le script de l'interface est désormais analysé par la suite de tests.** Une
  variable redéclarée avait cassé toute la page sans qu'aucun des 82 autres
  tests ne s'en aperçoive : ils parlent au serveur, jamais au JavaScript du
  navigateur. Ce trou est comblé.
- 84 tests (71 auparavant).

## [1.3.0] — 2026-07-24

Version « spectacle » : nouvelles fonctions de chase reprises des consoles
lumière, fiabilité renforcée, exécutables autonomes.

### Ajouté

- **Niveau bas** (par couche) — les barres « éteintes » restent à un niveau
  choisi : le chase court au-dessus d'un fond allumé au lieu de partir du noir.
- **Décalage de phase** (0–360°, par couche) — décale le départ dans le cycle.
  Deux couches identiques avec des phases différentes se répondent.
- **Swing** (−75 à +75 %) — groove : retarde un pas sur deux, comme un shuffle.
- **Blocs** (1–8) — découpe les barres en tronçons qui jouent le motif **en
  même temps** (les « blocks » des consoles MA / Chamsys).
- **Une fois / one-shot** + bouton **GO** — le motif joue un seul cycle puis se
  tait, jusqu'au prochain GO. Pour les accents ponctuels.
- **Scintillement** (0–100 %) — chaque allumage tire une intensité au hasard.
- **Courbe de gradateur** globale (linéaire / carrée / racine) — les LED DMX ne
  répondent pas linéairement ; « carrée » affine les bas de fondu.
- **QR code de connexion** — bouton `QR` près de l'adresse réseau : une popup
  affiche un QR code de l'adresse LAN à scanner depuis un iPad ou un téléphone.
  Générateur maison en pur JavaScript/SVG (zéro dépendance).
- **Exécutables portables** pour Windows, macOS (Intel et Apple Silicon) et
  Linux — `node build.js`. Plus besoin d'installer Node.
- **Suite de tests automatisés** (`npm test`, 71 tests) — sans aucune
  dépendance : lance de vrais serveurs et vérifie l'OSC réellement émis.
  Inclut charge et endurance (8 couches × 128 barres) et des garde-fous de
  source contre le retour des défauts corrigés.
- Nouvelles adresses OSC entrantes : `layer/N/floor|phase|swing|blocks|sparkle|oneshot`
  et `layer/N/go` (alias de `resync`).
- Variables d'environnement `CASCADE_PORT`, `CASCADE_CONFIG`, `CASCADE_OSCIN`,
  `CASCADE_FEEDBACK`, `CASCADE_MMPORT`, `CASCADE_MMHOST`, `CASCADE_NO_BROWSER`,
  `CASCADE_NO_AUTOQUIT` — pour lancer plusieurs instances ou automatiser.

### Corrigé

- **Durcissement de l'affichage des noms** — les noms de fixtures, de couches et
  de projets sont désormais posés en texte pur, et un test le vérifie à chaque
  fois. Recommandé pour tout le monde.
- **Changer le paramètre de sortie ne prenait pas effet** sur les fixtures dont
  le niveau n'avait pas bougé : le cache d'envoi n'était pas invalidé. Le cache
  est aussi vidé au START, qui réaffirme donc toujours l'état complet.
- **Une requête HTTP interrompue laissait un traitement en suspens pour
  toujours** (promesse jamais résolue, socket jamais refermée).
- **Un flux OSC entrant continu** (un fader tenu sur TouchOSC) déclenchait une
  écriture disque toutes les 500 ms. Sauvegarde désormais throttlée à 3 s, et
  les commandes non persistantes (start/stop/tap/resync) n'écrivent plus rien.
- **La configuration lue au démarrage n'était pas validée** : un fichier
  corrompu pouvait injecter des couches invalides dans le moteur. Tout ce qui
  vient du disque passe maintenant par les mêmes contrôles que l'API.
- **Les barres clignotaient à chaque changement de tempo.** Les fondus en cours
  restaient datés sur l'ancienne échelle de temps : en accélérant, une barre
  devenait « trop vieille » pour son enveloppe raccourcie et s'éteignait le
  temps d'un pas. Visible à chaque TAP, ÷2, ×2 et à chaque dérive de BPM
  Ableton Link. Mesuré : 32 extinctions sur 30 changements de tempo avant
  correction, aucune après.
- **Une mise en veille de l'ordinateur** faisait rejouer des dizaines de
  milliers de pas d'un coup au réveil (interface figée). Le moteur repart
  désormais du pas courant.
- **Fuite mémoire** : les caches indexés par fixture n'étaient jamais purgés
  après un changement de scéno.
- La carte MIDI et les réglages acceptaient n'importe quelle donnée ; clés et
  valeurs sont maintenant validées et bornées.
- Le fichier exporté porte le nom du projet au lieu de `chaser-projet.json`.
- Un fichier `chaser-config.json` traînant à côté de l'application ne peut plus
  écraser silencieusement une configuration explicitement demandée.
- Les valeurs affichées à côté des curseurs recevaient une chaîne au lieu d'un
  nombre : « 1 blocs » au lieu de « 1 (entier) », et les états neutres
  (« droit », « noir », « — ») ne s'affichaient jamais.
- La reconnexion à Ableton Link retentait toutes les 700 ms sans fin ; un
  Carabiner en boucle de plantage aurait consommé du processeur pendant un show.
  Le délai s'allonge maintenant jusqu'à 5 s, et seule une liaison stable
  (10 s) remet le compteur à zéro.

### Modifié

- Barre de transport **collante** : START / STOP / BLACKOUT restent atteignables
  quand on descend dans la page — en spectacle, on ne fait pas défiler.
- Repères visuels de show : filet orange animé et bouton START qui respire
  pendant que les chasers tournent, halo de préview proportionnel au niveau,
  pastille sur les presets occupés.
- Anneaux de focus clavier nets, respect de « animations réduites ».

## [1.2.0] — 2026-07-09

### Ajouté

- **Ableton Link** via Carabiner : le BPM de la session (Pulse, Ableton Live,
  Traktor…) pilote le temps/pas de toutes les couches.
- **Mode application** : lancement sans terminal, fenêtre dédiée sans barre
  d'adresse (Chrome/Edge/Brave), bouton Quitter dans l'interface.
- **Arrêt automatique** quand la dernière fenêtre se ferme — jamais pendant un
  show, jamais avant la première connexion.
- Nom de projet, suivi des modifications non exportées, dialogue de sortie.
- Charte graphique reprise du manuel (orange signature sur anthracite).

## [1.1.0]

### Ajouté

- Multi-couches (jusqu'à 8 séquenceurs indépendants mixés en HTP).
- Moteur vague, cible couleur, miroirs spatiaux, presets, MIDI et OSC entrants.

## [1.0.0]

Première version : chase pas-à-pas sur les fixtures DMX de MadMapper, en OSC.
