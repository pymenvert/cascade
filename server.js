#!/usr/bin/env node
/**
 * Chaser pour MadMapper — moteur multi-couches
 * Chaque couche = un séquenceur indépendant (pas-à-pas ou vague continue),
 * ciblant l'intensité (luminosity) ou la couleur des fixtures, mixé en HTP.
 * Zéro dépendance : Node.js >= 16.  Lancer :  node server.js
 */
'use strict';

const dgram = require('dgram');
const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, spawn } = require('child_process');

const APP_NAME = 'Cascade';
const VERSION = '2.0.0';
const SIGNATURE = 'Pierre-Yves Mansour — Collectif WSK';
const PRESET_SLOTS = 16;
const MAX_LAYERS = 8;
const MAX_FIXTURES = 128;
const MAX_MIDI_BINDINGS = 256;
const MAX_FADE_MS = 30000; // fondu entre presets : 30 s, c'est déjà très long
const MAX_GROUPS = 16;

const PACKAGED = typeof process.pkg !== 'undefined';
const DATA_DIR = PACKAGED ? path.dirname(process.execPath) : __dirname;
// Surcharges d'environnement — utilisées par les tests et les lancements
// automatisés ; en usage normal aucune n'est définie et rien ne change.
const CONFIG_FILE = process.env.CASCADE_CONFIG || path.join(DATA_DIR, 'cascade-config.json');
const BACKUP_FILE = CONFIG_FILE + '.bak';
// Configs d'avant le renommage. Ignoré si un fichier de config est imposé,
// sinon une instance isolée récupérerait la config du dossier d'à côté.
const LEGACY_FILE = process.env.CASCADE_CONFIG ? null : path.join(DATA_DIR, 'chaser-config.json');
const NO_BROWSER = process.env.CASCADE_NO_BROWSER === '1';
const NO_AUTOQUIT = process.env.CASCADE_NO_AUTOQUIT === '1';

// Robustesse : une erreur imprévue ne doit jamais tuer le show.
process.on('uncaughtException', (e) => console.error('[cascade] erreur inattendue :', e && e.message));
process.on('unhandledRejection', (e) => console.error('[cascade] promesse rejetée :', e && e.message ? e.message : e));

// ---------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------
let layerSeq = 1;
function defaultLayer(name) {
  return {
    id: 'L' + Date.now().toString(36) + Math.floor(Math.random() * 1e4),
    name: name || ('Chaser ' + (layerSeq++)),
    enabled: true,
    engine: 'steps',        // 'steps' | 'wave'
    target: 'intensity',    // 'intensity' | 'color'
    bars: null,             // null = toutes les fixtures, sinon [ids]
    groupId: null,          // si posé, la couche suit CE groupe (lien vivant)
    pattern: 'lr',          // steps : lr,rl,pingpong,random,evenodd,all — wave : lr,rl,tb,bt,pulse,radial
    mode: 'fade', curve: 'linear',
    waveform: 'sine',       // sine | triangle | square (moteur vague)
    stepMs: 250, speed: 1,
    width: 1,               // steps : tenue/traîne — wave : largeur de vague (1-8 → 1/8..1 de la scène)
    group: 1,               // steps : barres par pas — wave : pas par cycle
    mirrorH: false, mirrorV: false, axisX: 0.5, axisY: 0.5,
    fadeInPct: 20, fadeOutPct: 80,
    invert: false, level: 1,
    colorA: '#ff2000', colorB: '#0040ff',
    palette: null,          // null = les deux couleurs ci-dessus (comportement v1)
    deck: null,             // null = toujours jouée | 'a' | 'b' — voir le crossfader
    lfo: null,              // { on, param, forme, periodeMs, min, max } — voir appliquerLFO
    palSrc: 'motif',        // motif | prof | haut — d'où vient la place dans la palette
    spread: 0,              // décalage de phase étalé sur la sélection, en degrés
    // ── v1.3 : fonctions de chase des consoles lumière ──
    phase: 0,               // décalage de départ, en degrés du cycle (0-360)
    swing: 0,               // groove : retarde les pas impairs, -75..+75 % du demi-pas
    floor: 0,               // niveau bas : les barres « éteintes » restent à ce niveau
    blocks: 1,              // segmente les barres en N blocs jouant le motif en parallèle
    oneShot: false,         // le motif joue UN cycle puis se tait (relancé par GO/resync)
    sparkle: 0,             // scintillement : variation aléatoire d'intensité par pas
    // ── v2 : moteur « champ 3D » (engine: 'field') ──
    // Un effet est une fonction f(position, temps) évaluée à l'endroit RÉEL de
    // chaque barre. Les réglages ci-dessous décrivent la forme du champ ; tout
    // le reste (forme d'onde, largeur, phase, niveau bas, couleur, HTP, master,
    // Link) reste celui des autres moteurs. C'est ce qui permet à un `field` en
    // plan sur l'axe X de rendre EXACTEMENT les mêmes valeurs qu'un `wave lr`.
    field: 'plan',          // plan | sphere | cylindre | boite | bruit
    axAz: 0,                // azimut de l'axe, en degrés : 0 = vers cour (+X)
    axEl: 0,                // élévation de l'axe, en degrés : -90 = vers le sol
    srcX: 0, srcY: 0, srcZ: 2,   // source du champ, en MÈTRES (sphere/cylindre/boite)
    // Netteté : quelle part de la longueur d'onde le motif occupe, en %.
    // 100 = comportement d'origine (le motif remplit tout son cycle, donc la
    // moitié du plateau est allumée en permanence). Mesuré avant ce réglage :
    // 48 à 50 % des barres au-dessus de 50 %, quelle que soit la forme ou
    // l'étendue — impossible d'obtenir une bande étroite, ni une comète.
    duty: 100,
    // Course de la source, en MÈTRES. 0 = source fixe. Sinon elle balaie un
    // segment de cette longueur, centré sur elle, une fois par cycle, le long de
    // l'axe. Avec une sphère et une netteté serrée, ça fait une comète.
    course: 0,
    // Pas-à-pas : ordonner les barres par leur projection sur l'axe 3D au lieu
    // de l'ordre de la liste. Le chase suit alors la scénographie RÉELLE — et
    // c'est le seul réglage qui fait profiter le moteur pas-à-pas de la 3D.
    ordre3d: false,
    // Mode de fusion avec les couches précédentes. `htp` = comportement v1.
    blend: 'htp',
    // Perspective atmosphérique : force d'atténuation avec la profondeur, en %.
    prof: 0,
  };
}

const state = {
  projectName: 'Sans titre',
  settings: { mmHost: '127.0.0.1', mmPort: 8000, feedbackPort: 9000, httpPort: 3333, oscInPort: 7000,
              linkEnabled: false,
              linkPhase: true,   // caler les pas sur la grille de beats, pas seulement le tempo
              linkQuantum: 4,    // beats par mesure, pour le témoin de temps fort
              // Résolution de la sortie MadMapper, en PIXELS. Mesuré sur
              // MadMapper 6.0.9 : `output/x` et `output/y` sont en pixels de la
              // composition, PAS en 0..1 — une barre au centre d'une sortie
              // 1920×1080 lit x=960, y=540. Et son API OSC ne permet pas de
              // demander cette résolution (elle n'expose que /getControls et
              // /getControlValues). D'où ce réglage explicite : sans lui, tout
              // renvoi de disposition entasserait les barres dans le coin
              // supérieur gauche.
              outW: 1920, outH: 1080 },
  fixtures: [],
  // Dimensions du plateau, en MÈTRES. Repère main droite, origine au centre du
  // plateau au sol : X = jardin↔cour, Y = profondeur (vers le lointain),
  // Z = hauteur. C'est la convention des plans de feu (MVR/GDTF).
  scene: { w: 10, d: 8, h: 6 },
  // ── v2 : les VUES ──────────────────────────────────────────────────────
  // Une vue = une disposition des barres dans la composition MadMapper, rangée
  // dans un DOSSIER de fixtures portant son nom. Chaque barre physique existe
  // en une copie par vue, toutes à la MÊME adresse DMX : on bascule d'un axe de
  // projection à l'autre en n'allumant qu'un dossier.
  //
  // Mesuré sur MadMapper 6.0.9 (docs/V2-AXES-PISTES.md) :
  //  - deux fixtures à la même adresse coexistent sans avertissement ;
  //  - une seule visible rend exactement SON contenu ;
  //  - deux visibles → la DERNIÈRE de la liste gagne (défaillance déterministe) ;
  //  - un dossier expose `visible` ET `luminosity` en OSC, et son `luminosity`
  //    atténue ses membres proportionnellement — d'où les fondus entre vues.
  vues: [],
  // Groupes de barres nommés (« sol », « contres »…). Une couche peut suivre un
  // groupe : modifier le groupe met à jour toutes les couches qui l'utilisent.
  // Ils appartiennent à la scéno, pas au look — ils ne sont donc PAS mémorisés
  // dans les presets, mais ils voyagent avec le fichier projet.
  groups: [],
  layers: [defaultLayer()],
  global: { running: false, speed: 1, master: 1, param: 'luminosity', dimmer: 'linear',
            xfade: 0,          // 0 = jeu A seul, 1 = jeu B seul
            modGlobal: null,   // { on, param, forme, periodeMs, sync, cycles, min, max }
            vueActive: null,   // identifiant de la vue allumée, ou null
            // ⚠ Au démarrage, Cascade se SOUVIENT de la vue active mais n'a
            // rien envoyé : il ne sait donc pas ce que MadMapper a réellement.
            // Prétendre le contraire afficherait une vue « allumée » alors que
            // le dossier est peut-être éteint — et l'inverse est pire encore.
            // Cascade n'envoie RIEN au démarrage : ce serait écraser ce que le
            // régisseur a réglé à la main. Il le dit, et un clic confirme.
            vueIncertaine: false,
            presetFade: 0, // durée du fondu entre presets, en ms (0 = rappel sec)
            // Coupure générale de la sortie DMX de MadMapper. Persistée
            // volontairement : si Cascade redémarre alors que la coupure est
            // engagée, MadMapper reste noir — mieux vaut que l'interface le
            // dise que de laisser le régisseur chercher pourquoi rien ne
            // s'allume.
            coupure: false },
  presets: Array(PRESET_SLOTS).fill(null),
  midiMap: {},  // 'cc:ch:num' | 'note:ch:num' -> cible (géré par l'UI, persisté ici)
};

const LAYER_KEYS = ['name', 'enabled', 'engine', 'target', 'bars', 'groupId', 'pattern', 'mode',
  'curve', 'waveform', 'stepMs', 'speed', 'width', 'group', 'mirrorH', 'mirrorV',
  'axisX', 'axisY', 'fadeInPct', 'fadeOutPct', 'invert', 'level', 'colorA', 'colorB',
  'phase', 'swing', 'floor', 'blocks', 'oneShot', 'sparkle',
  'field', 'axAz', 'axEl', 'srcX', 'srcY', 'srcZ', 'ordre3d', 'duty', 'course', 'blend', 'prof', 'palette', 'palSrc', 'spread', 'deck', 'lfo'];

function loadConfig() {
  let saved = null;
  for (const file of [CONFIG_FILE, BACKUP_FILE, LEGACY_FILE].filter(Boolean)) {
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); break; }
    catch (e) { if (file === CONFIG_FILE && fs.existsSync(file)) console.warn('[cascade] config illisible, tentative de secours…'); }
  }
  try {
    if (!saved) return;
    if (typeof saved.projectName === 'string' && saved.projectName.trim()) {
      state.projectName = saved.projectName.trim().slice(0, 40);
    }
    // Tout ce qui vient du disque est revalidé : un fichier corrompu (coupure
    // de courant, édition manuelle) ne doit jamais faire planter le moteur.
    if (saved.settings) state.settings = sanitizeSettings(saved.settings);
    if (saved.scene) state.scene = sanitizeScene(saved.scene);
    if (saved.fixtures) state.fixtures = sanitizeFixtures(saved.fixtures);
    if (saved.groups) state.groups = sanitizeGroups(saved.groups);
    if (saved.vues) state.vues = sanitizeVues(saved.vues);
    if (saved.global) Object.assign(state.global, sanitizeGlobal(saved.global), { running: false });
    if (Array.isArray(saved.layers) && saved.layers.length) {
      state.layers = saved.layers.slice(0, MAX_LAYERS).map(sanitizeLayer);
      layerSeq = state.layers.length + 1;
    } else if (saved.params) {
      // migration ancienne config mono-chaser
      const p = saved.params;
      const L = state.layers[0];
      for (const k of LAYER_KEYS) if (k in p) L[k] = p[k];
      if (p.mirror) L.mirrorH = true;
      if (typeof p.master === 'number') state.global.master = p.master;
      if (typeof p.param === 'string') state.global.param = p.param;
      if (typeof p.speed === 'number') { L.speed = 1; state.global.speed = p.speed; }
    }
    if (Array.isArray(saved.presets)) state.presets = sanitizePresets(saved.presets);
    if (saved.midiMap) state.midiMap = sanitizeMidiMap(saved.midiMap);
    console.log('Config chargée depuis', CONFIG_FILE);
  } catch (e) { console.warn('[cascade] config partiellement chargée :', e.message); }
}
// Écriture atomique : fichier temporaire puis renommage + copie de secours.
// dirtySinceExport : des modifs ont eu lieu depuis le dernier export en fichier
// projet .json (la config, elle, est TOUJOURS sauvegardée automatiquement).
let saveTimer = null;
let dirtySinceExport = false, lastExportAt = null;
function writeConfigNow() {
  try {
    const { running, ...global } = state.global;
    const data = JSON.stringify({
      app: APP_NAME, version: VERSION, projectName: state.projectName,
      settings: state.settings, scene: state.scene, vues: state.vues,
      scene: state.scene, fixtures: state.fixtures, groups: state.groups,
      layers: state.layers, global, presets: state.presets, midiMap: state.midiMap,
    }, null, 2);
    const tmp = CONFIG_FILE + '.tmp';
    fs.writeFileSync(tmp, data);
    try { if (fs.existsSync(CONFIG_FILE)) fs.copyFileSync(CONFIG_FILE, BACKUP_FILE); } catch (e) {}
    fs.renameSync(tmp, CONFIG_FILE);
  } catch (e) { console.error('[cascade] sauvegarde config impossible :', e.message); }
}
/** À appeler avant tout process.exit : écrit la config TOUT DE SUITE
 *  (le débounce de 500 ms pourrait sinon perdre la toute dernière modif). */
function flushConfig() {
  if (!saveTimer && !slowSaveTimer) return;
  clearTimeout(saveTimer); saveTimer = null;
  clearTimeout(slowSaveTimer); slowSaveTimer = null;
  writeConfigNow();
}
function saveConfig() {
  dirtySinceExport = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; writeConfigNow(); }, 500);
}
/** Variante « flux continu » (OSC entrant, faders MIDI) : le timer n'est PAS
 *  relancé à chaque appel, sinon un fader tenu écrirait le disque sans arrêt.
 *  Une écriture au plus toutes les 3 s, et la dernière valeur est bien gardée. */
let slowSaveTimer = null;
function saveConfigSoon() {
  dirtySinceExport = true;
  if (slowSaveTimer || saveTimer) return;
  slowSaveTimer = setTimeout(() => { slowSaveTimer = null; writeConfigNow(); }, 3000);
}

// ---------------------------------------------------------------------------
// Validation des entrées (tout ce qui vient de l'extérieur est borné)
// ---------------------------------------------------------------------------
const ENUMS = {
  engine: ['steps', 'wave', 'field'], target: ['intensity', 'color'], mode: ['onoff', 'fade'],
  field: ['plan', 'sphere', 'cylindre', 'boite', 'bruit'],
  blend: ['htp', 'add', 'mul', 'screen', 'min', 'sub', 'remp'],
  palSrc: ['motif', 'prof', 'haut'],
  curve: ['linear', 'easeIn', 'easeOut', 'easeInOut', 'expo'],
  waveform: ['sine', 'triangle', 'square'],
  pattern: ['lr', 'rl', 'pingpong', 'random', 'evenodd', 'all', 'tb', 'bt', 'pulse', 'radial', 'outin', 'inout'],
  dimmer: ['linear', 'square', 'sqrt'],
};
function cnum(v, min, max, dflt) {
  v = +v;
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : dflt;
}
function sanitizeLayerSet(set) {
  const o = {};
  if (!set || typeof set !== 'object') return o;
  for (const k of LAYER_KEYS) {
    if (!(k in set)) continue;
    const v = set[k];
    switch (k) {
      case 'name': o.name = String(v).slice(0, 24).trim() || 'Chaser'; break;
      case 'enabled': case 'mirrorH': case 'mirrorV': case 'invert':
      case 'oneShot': case 'ordre3d': o[k] = !!v; break;
      case 'bars': if (v === null) o.bars = null; else if (Array.isArray(v)) o.bars = v.map(String).slice(0, 256); break;
      case 'groupId': o.groupId = (v == null || v === '') ? null : String(v).slice(0, 40); break;
      case 'stepMs': o.stepMs = Math.round(cnum(v, 30, 10000, 250)); break;
      case 'speed': o.speed = cnum(v, 0.05, 5, 1); break;
      case 'width': case 'group': case 'blocks': o[k] = Math.round(cnum(v, 1, 8, 1)); break;
      case 'level': case 'floor': case 'sparkle': o[k] = cnum(v, 0, 1, k === 'level' ? 1 : 0); break;
      case 'phase': o.phase = Math.round(cnum(v, 0, 360, 0)); break;
      case 'swing': o.swing = Math.round(cnum(v, -75, 75, 0)); break;
      case 'axisX': case 'axisY': o[k] = cnum(v, 0, 1, 0.5); break;
      // L'azimut boucle (359° et -1° sont le même axe) ; l'élévation, non :
      // au-delà de ±90° on repasse par-dessus, ce qui n'ajoute aucune direction.
      case 'axAz': o.axAz = Math.round(((cnum(v, -100000, 100000, 0) % 360) + 360) % 360); break;
      case 'axEl': o.axEl = Math.round(cnum(v, -90, 90, 0)); break;
      case 'srcX': case 'srcY': case 'srcZ': o[k] = cnum(v, -P3_MAX, P3_MAX, 0); break;
      case 'duty': o.duty = Math.round(cnum(v, 5, 100, 100)); break;
      case 'prof': o.prof = Math.round(cnum(v, 0, 100, 0)); break;
      case 'spread': o.spread = Math.round(cnum(v, 0, 1440, 0)); break;
      case 'deck': o.deck = (v === 'a' || v === 'b') ? v : null; break;
      case 'lfo': o.lfo = sanitizeLFO(v); break;
      case 'course': o.course = cnum(v, 0, 200, 0); break;
      case 'fadeInPct': o.fadeInPct = cnum(v, 0, 100, 20); break;
      case 'fadeOutPct': o.fadeOutPct = cnum(v, 0, 400, 80); break;
      case 'colorA': case 'colorB': if (/^#[0-9a-fA-F]{6}$/.test(String(v))) o[k] = String(v); break;
      case 'palette': {
        if (v === null || v === '') { o.palette = null; break; }
        // Un nom de palette prête, ou une liste d'arrêts. Deux arrêts minimum,
        // huit maximum : au-delà on ne distingue plus rien sur une barre.
        const src = typeof v === 'string' ? PALETTES[v] : v;
        if (!Array.isArray(src)) break;
        const arr = src.filter(c => /^#[0-9a-fA-F]{6}$/.test(String(c))).slice(0, 8).map(String);
        o.palette = arr.length >= 2 ? arr : null;
        break;
      }
      default: if (ENUMS[k]) { if (ENUMS[k].includes(v)) o[k] = v; } break;
    }
  }
  return o;
}
/**
 * Ce qu'un modulateur a le droit de piloter.
 *
 * Liste FERMÉE, et c'est volontaire : laisser choisir n'importe quelle clé
 * ouvrirait la porte à moduler `bars`, `groupId` ou `target`, c'est-à-dire à
 * fabriquer des états incohérents plusieurs fois par seconde. Ces neuf-là sont
 * les réglages continus qui gagnent vraiment à respirer.
 */
const LFO_PARAMS = ['level', 'floor', 'width', 'speed', 'duty', 'course',
                    'prof', 'phase', 'spread'];
const LFO_FORMES = ['sine', 'triangle', 'square', 'rampe'];

function sanitizeLFO(v) {
  if (!v || typeof v !== 'object') return null;
  if (!LFO_PARAMS.includes(v.param)) return null;
  return {
    on: !!v.on,
    param: v.param,
    forme: LFO_FORMES.includes(v.forme) ? v.forme : 'sine',
    // Bornes larges : de la respiration lente (2 min) au frémissement (100 ms).
    periodeMs: Math.round(cnum(v.periodeMs, 100, 120000, 4000)),
    // Calé sur le tempo : la période devient un multiple du cycle de la couche,
    // donc elle suit le tap tempo et Ableton Link toute seule.
    sync: !!v.sync,
    cycles: cnum(v.cycles, 0.25, 64, 4),
    min: fini(v.min, 0),
    max: fini(v.max, 1),
  };
}

/**
 * Applique le modulateur d'une couche et rend une COPIE modulée.
 *
 * ⚠ L'état n'est jamais écrit. Un modulateur qui poserait ses valeurs dans
 * `state` les ferait sauvegarder, exporter et mémoriser dans les presets : on
 * retrouverait un projet figé sur l'instant où on a cliqué. Ici la couche
 * d'origine ne bouge pas, et l'interface continue d'afficher ce que le régisseur
 * a réglé — pas ce que le modulateur en fait à cet instant.
 *
 * La valeur passe par `sanitizeLayerSet`, donc elle subit EXACTEMENT les mêmes
 * bornes qu'une saisie à la main : aucun modulateur ne peut sortir un réglage
 * de sa plage, même avec des min/max délirants.
 */
function appliquerLFO(L, now, store = engines) {
  const m = L.lfo;
  if (!m || !m.on || !LFO_PARAMS.includes(m.param)) return L;
  const e = eng(L.id, store);
  // ⚠ La période est calculée sur la couche NON MODULÉE. Sinon un modulateur
  // branché sur `speed` changerait sa propre cadence à chaque image : une
  // boucle de rétroaction, et un modulateur qui s'emballe tout seul.
  const periode = m.sync ? Math.max(100, m.cycles * periodeCouche(L))
                         : Math.max(100, m.periodeMs);
  // Horloge intégrée, comme la phase des moteurs continus : changer la période
  // ne doit pas téléporter le modulateur au milieu de son cycle.
  if (e.lfoU == null) { e.lfoU = 0; e.lfoLast = now; }
  const dt = Math.min(1000, Math.max(0, now - e.lfoLast));
  e.lfoLast = now;
  e.lfoU = (e.lfoU + dt / periode) % 1;

  const brut = m.min + (m.max - m.min) * ondeLFO(m.forme, e.lfoU);
  return { ...L, ...sanitizeLayerSet({ [m.param]: brut }) };
}

function sanitizeLayer(raw) {
  const L = defaultLayer(raw && typeof raw.name === 'string' ? raw.name.slice(0, 24) : undefined);
  Object.assign(L, sanitizeLayerSet(raw || {}));
  return L;
}
/** Nom de paramètre OSC : mot simple, pas de remontée de chemin ni de joker. */
const PARAM_RE = /^[\w][\w/ -]{0,63}$/;
function safeParam(v, dflt) {
  const s = String(v == null ? '' : v);
  return (PARAM_RE.test(s) && !s.includes('..')) ? s : dflt;
}
function sanitizeGlobal(g) {
  const o = {};
  if (!g || typeof g !== 'object') return o;
  if ('speed' in g) o.speed = cnum(g.speed, 0.05, 5, 1);
  if ('master' in g) o.master = cnum(g.master, 0, 1, 1);
  if ('xfade' in g) o.xfade = cnum(g.xfade, 0, 1, 0);
  if ('modGlobal' in g) o.modGlobal = sanitizeModGlobal(g.modGlobal);
  if ('param' in g) o.param = safeParam(g.param, 'luminosity');
  if ('dimmer' in g && ENUMS.dimmer.includes(g.dimmer)) o.dimmer = g.dimmer;
  if ('presetFade' in g) o.presetFade = Math.round(cnum(g.presetFade, 0, MAX_FADE_MS, 0));
  if ('coupure' in g) o.coupure = !!g.coupure;
  if ('vueActive' in g) o.vueActive = g.vueActive == null ? null : String(g.vueActive).slice(0, 40);
  // Une vue importée n'a jamais été envoyée : elle est incertaine par nature.
  if ('vueActive' in g) o.vueIncertaine = !!g.vueActive;
  return o;
}
/**
 * Ce qu'un modulateur global a le droit de piloter. Trois réglages, pas plus.
 *
 * `xfade` est le seul vraiment intéressant : un crossfader qui va et vient tout
 * seul, c'est une scène qui respire entre deux ambiances sans qu'on la tienne.
 * `master` et `speed` sont là par cohérence — mais ⚠ un modulateur sur le master
 * peut faire tomber un show dans le noir : ses bornes sont celles du réglage, et
 * c'est au régisseur de ne pas mettre 0 en bas.
 */
const MODG_PARAMS = ['xfade', 'master', 'speed'];

function sanitizeModGlobal(v) {
  if (!v || typeof v !== 'object') return null;
  if (!MODG_PARAMS.includes(v.param)) return null;
  return {
    on: !!v.on,
    param: v.param,
    forme: LFO_FORMES.includes(v.forme) ? v.forme : 'sine',
    periodeMs: Math.round(cnum(v.periodeMs, 100, 120000, 8000)),
    sync: !!v.sync,
    cycles: cnum(v.cycles, 0.25, 64, 8),
    min: fini(v.min, 0),
    max: fini(v.max, 1),
  };
}

/**
 * Valeur COURANTE d'un réglage global : celle du modulateur s'il en pilote un,
 * sinon celle que le régisseur a posée.
 *
 * ⚠ Passer par cette fonction partout où un réglage global est lu, sinon le
 * modulateur agirait à certains endroits et pas à d'autres — un crossfader
 * modulé qui bougerait le mixage mais pas l'affichage, par exemple.
 */
let modGlobalVal = null;
function globalEff(cle) {
  return (modGlobalVal && cle in modGlobalVal) ? modGlobalVal[cle] : state.global[cle];
}

/** Forme d'onde commune aux deux modulateurs, sur une phase 0..1. */
function ondeLFO(forme, u) {
  if (forme === 'square') return u < 0.5 ? 1 : 0;
  if (forme === 'triangle') return 1 - 2 * Math.abs(u - 0.5);
  if (forme === 'rampe') return u;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
}

/**
 * Recalcule le modulateur global. Comme celui des couches, il n'écrit JAMAIS
 * dans `state` : sa valeur vit dans `modGlobalVal`, le temps d'une image.
 * Le régisseur retrouve donc ses réglages intacts en le coupant.
 */
const engGlobal = { u: null, last: 0 };
function calculerModGlobal(now) {
  modGlobalVal = null;
  const m = state.global.modGlobal;
  if (!m || !m.on || !MODG_PARAMS.includes(m.param)) { engGlobal.u = null; return; }
  // Calé sur le tempo : on prend le cycle de la PREMIÈRE couche. Il n'y a pas de
  // tempo « global » dans Cascade — chaque couche a le sien — et la première est
  // la référence la plus prévisible pour un régisseur.
  const ref = state.layers[0];
  const periode = (m.sync && ref) ? Math.max(100, m.cycles * periodeCouche(ref))
                                  : Math.max(100, m.periodeMs);
  if (engGlobal.u == null) { engGlobal.u = 0; engGlobal.last = now; }
  const dt = Math.min(1000, Math.max(0, now - engGlobal.last));
  engGlobal.last = now;
  engGlobal.u = (engGlobal.u + dt / periode) % 1;
  const brut = m.min + (m.max - m.min) * ondeLFO(m.forme, engGlobal.u);
  // Mêmes bornes qu'une saisie à la main : le modulateur ne peut rien sortir de
  // sa plage, même avec des min/max délirants.
  const propre = sanitizeGlobal({ [m.param]: brut });
  if (m.param in propre) modGlobalVal = { [m.param]: propre[m.param] };
}

function sanitizeSettings(s) {
  const o = { ...state.settings };
  if (!s || typeof s !== 'object') return o;
  if ('mmHost' in s) o.mmHost = String(s.mmHost).slice(0, 64).trim() || '127.0.0.1';
  for (const k of ['mmPort', 'feedbackPort', 'httpPort', 'oscInPort']) {
    if (k in s) o[k] = Math.round(cnum(s[k], 1, 65535, o[k]));
  }
  if ('linkEnabled' in s) o.linkEnabled = !!s.linkEnabled;
  if ('linkPhase' in s) o.linkPhase = !!s.linkPhase;
  if ('linkQuantum' in s) o.linkQuantum = Math.round(cnum(s.linkQuantum, 1, 16, 4));
  for (const k of ['outW', 'outH']) {
    if (k in s) o[k] = Math.round(cnum(s[k], 16, 32768, o[k]));
  }
  return o;
}
/** Les clés MIDI sont bornées en nombre ET en forme (`cc:1:7`, `note:10:36`). */
function sanitizeMidiMap(map) {
  const o = {};
  if (!map || typeof map !== 'object') return o;
  let n = 0;
  for (const [k, v] of Object.entries(map)) {
    if (n >= MAX_MIDI_BINDINGS) break;
    if (!/^(cc|note):\d{1,2}:\d{1,3}$/.test(k)) continue;
    if (typeof v !== 'string' || !v || v.length > 40) continue;
    o[k] = v; n++;
  }
  return o;
}
// ---------------------------------------------------------------------------
// Espace 3D — la scénographie réelle, en mètres
//
// RÈGLE : `p3` / `dir3` / `len3` sont la VÉRITÉ. `x` / `y` / `rot` sont
// DÉRIVÉS, recalculés à chaque écriture, et servent à la vue 2D, aux miroirs
// et à la compatibilité des projets v1. Ne jamais les modifier directement :
// passer par set2D() ou set3D(), sinon les deux représentations divergent —
// et deux vérités pour une position, c'est des bugs sans fin.
// ---------------------------------------------------------------------------
const DEG = Math.PI / 180;
// ⚠ Le `v == null` n'est pas décoratif : `+null` vaut 0, donc sans lui un
// champ absent passerait pour un zéro légitime. C'est exactement ce qui
// couchait les barres verticales d'un projet v1 (rot absent, vert: true).
function fini(v, dflt) {
  if (v == null) return dflt;
  v = +v;
  return Number.isFinite(v) ? v : dflt;
}

/** Recalcule la projection 2D (vue de face) depuis la position 3D. */
function derive2D(f, scene) {
  const s = scene || state.scene;
  const [px, , pz] = f.p3;
  f.x = Math.min(1, Math.max(0, px / s.w + 0.5));
  f.y = Math.min(1, Math.max(0, 1 - pz / s.h));
  // La rotation 2D est l'angle de la barre dans le plan de face
  f.rot = Math.round(Math.atan2(-f.dir3[2], f.dir3[0]) / DEG * 10) / 10;
  f.vert = Math.abs(((f.rot % 180) + 180) % 180 - 90) < 15;
  return f;
}
// Enveloppe des positions, en mètres. Aucun plateau ne fait 500 m, mais une
// barre partie à 1e9 par un glissé emballé ou une requête malveillante rendrait
// la vue 3D inutilisable et la position irrécupérable à la souris. On borne.
const P3_MAX = 500;

/** Pose une position 3D (mètres) et met la 2D à jour. */
function set3D(f, p3, dir3, len3, scene) {
  const borne = (v) => Math.min(P3_MAX, Math.max(-P3_MAX, v));
  f.p3 = [borne(fini(p3[0], 0)), borne(fini(p3[1], 0)), borne(fini(p3[2], 0))];
  let d = [fini(dir3[0], 1), fini(dir3[1], 0), fini(dir3[2], 0)];
  const n = Math.hypot(d[0], d[1], d[2]);
  f.dir3 = n > 1e-6 ? [d[0] / n, d[1] / n, d[2] / n] : [1, 0, 0]; // jamais un vecteur nul
  f.len3 = Math.min(50, Math.max(0.05, fini(len3, 1.2)));
  return derive2D(f, scene);
}
/** Déplacement depuis la vue 2D : la profondeur est conservée. */
function set2D(f, x, y, rot, scene) {
  const s = scene || state.scene;
  const nx = Math.min(1, Math.max(0, fini(x, 0.5)));
  const ny = Math.min(1, Math.max(0, fini(y, 0.5)));
  const r = fini(rot, f.rot ?? 0) * DEG;
  return set3D(f, [(nx - 0.5) * s.w, f.p3 ? f.p3[1] : 0, (1 - ny) * s.h],
    [Math.cos(r), 0, -Math.sin(r)], f.len3 ?? 1.2, s);
}
/** Projet v1 (x/y/rot/len seuls) → espace 3D. Tout arrive dans le plan de face,
 *  exactement là où la vue 2D le montrait : aucun show ne change de rendu. */
function migre3D(f, scene, lenMax) {
  const s = scene || state.scene;
  // ⚠ En v1, une barre verticale pouvait n'avoir QUE `vert: true`, sans `rot`.
  // Oublier ce repli couche toutes les barres verticales d'un projet existant.
  const r = fini(f.rot, f.vert ? 90 : 0) * DEG;
  const l = (f.len > 0 && lenMax > 0) ? (f.len / lenMax) * 1.2 : 1.2;
  return set3D(f, [(fini(f.x, 0.5) - 0.5) * s.w, 0, (1 - fini(f.y, 0.5)) * s.h],
    [Math.cos(r), 0, -Math.sin(r)], l, s);
}

// ---------------------------------------------------------------------------
// Bascule de vue — allumer un dossier de fixtures, éteindre les autres.
//
// Le fondu passe par le `luminosity` du dossier, mesuré proportionnel. La
// visibilité, elle, ne sert qu'aux extrémités : on l'allume AVANT de monter et
// on l'éteint APRÈS être descendu à zéro, ce qui évite qu'une vue apparaisse
// d'un coup à pleine intensité pendant un fondu.
// ---------------------------------------------------------------------------
let fonduVue = null;   // { debut, duree, cibles: Map<dossier, {de, vers}> }

function stopFonduVue() {
  if (fonduVue && fonduVue.minuteur) clearInterval(fonduVue.minuteur);
  fonduVue = null;
}

/** Niveau courant envoyé à un dossier, pour l'interface. */
const niveauVue = new Map();

function envoyerVue(dossier, lum, visible) {
  if (!dossier) return;
  const d = '/fixtures/' + dossier;
  if (visible != null) oscSend(d + '/visible', [{ type: 'f', value: visible ? 1 : 0 }]);
  if (lum != null) {
    oscSend(d + '/luminosity', [{ type: 'f', value: Math.max(0, Math.min(1, lum)) }]);
    niveauVue.set(dossier, Math.max(0, Math.min(1, lum)));
  }
}

/**
 * Active une vue et éteint les autres.
 *
 * ⚠ On n'éteint QUE les dossiers déclarés dans Cascade. Toucher à un dossier
 * inconnu serait toucher au projet du régisseur en dehors de ce qu'il a confié
 * à Cascade — et il peut très bien avoir des fixtures qui ne nous concernent pas.
 */
function activerVue(id, fadeMs) {
  stopFonduVue();
  const cible = state.vues.find(v => v.id === id) || null;
  const duree = Math.round(cnum(fadeMs, 0, MAX_FADE_MS, 0));
  const plan = [];
  for (const v of state.vues) {
    if (!v.dossier) continue;
    const vers = (cible && v.id === cible.id) ? 1 : 0;
    const de = niveauVue.has(v.dossier) ? niveauVue.get(v.dossier) : (vers === 1 ? 0 : 1);
    plan.push({ dossier: v.dossier, de, vers });
  }
  state.global.vueActive = cible ? cible.id : null;
  state.global.vueIncertaine = false;   // on vient d'envoyer : on sait

  // Ce qui monte devient visible tout de suite ; ce qui descend le reste
  // jusqu'à la fin, sinon la coupure serait sèche au lieu d'être fondue.
  for (const p of plan) if (p.vers === 1) envoyerVue(p.dossier, duree ? p.de : 1, true);

  if (!duree) {
    for (const p of plan) envoyerVue(p.dossier, p.vers, p.vers === 1);
    saveConfig();
    return { fondu: 0, dossiers: plan.map(p => p.dossier) };
  }

  const debut = Date.now();
  fonduVue = { debut, duree, plan };
  fonduVue.minuteur = setInterval(() => {
    const k = Math.min(1, (Date.now() - debut) / duree);
    for (const p of fonduVue.plan) envoyerVue(p.dossier, p.de + (p.vers - p.de) * k, null);
    if (k >= 1) {
      // Arrivé à zéro, on masque : deux dossiers visibles laisseraient le
      // dernier de la liste gagner, et l'ordre de cette liste n'est pas stable.
      for (const p of fonduVue.plan) if (p.vers === 0) envoyerVue(p.dossier, 0, false);
      stopFonduVue();
      saveConfig();
    }
  }, 25);
  return { fondu: duree, dossiers: plan.map(p => p.dossier) };
}

/**
 * Angle ramené dans [0, 360[, pour MadMapper.
 *
 * Mesuré sur MadMapper 6.0.9 : `output/rot` n'accepte QUE cet intervalle. Hors
 * plage, il n'écrête pas et ne replie pas — il **ignore le message sans rien
 * dire**. Or le `rot` de Cascade vient d'un `atan2`, donc entre -180 et +180 :
 * sans cette conversion, une barre sur deux gardait silencieusement son ancien
 * angle. Trouvé par le test de bout en bout, invisible autrement.
 */
function rot360(deg) {
  const d = fini(deg, 0) % 360;
  return d < 0 ? d + 360 : d;
}

function sanitizeScene(sc) {
  const o = { ...state.scene };
  if (!sc || typeof sc !== 'object') return o;
  for (const k of ['w', 'd', 'h']) if (k in sc) o[k] = cnum(sc[k], 0.5, 200, o[k]);
  return o;
}

function sanitizeGroups(list) {
  if (!Array.isArray(list)) return [];
  const vus = new Set();
  const out = [];
  for (const g of list.slice(0, MAX_GROUPS)) {
    if (!g || typeof g !== 'object') continue;
    const id = String(g.id || '').slice(0, 40) || 'g' + Date.now() + '_' + out.length;
    if (vus.has(id)) continue; // deux groupes de même id rendraient la résolution ambiguë
    vus.add(id);
    out.push({
      id,
      name: String(g.name || 'Groupe').slice(0, 20).trim() || 'Groupe',
      bars: Array.isArray(g.bars) ? [...new Set(g.bars.map(String))].slice(0, MAX_FIXTURES) : [],
    });
  }
  return out;
}
function sanitizePresets(list) {
  if (!Array.isArray(list)) return Array(PRESET_SLOTS).fill(null);
  return list.slice(0, PRESET_SLOTS).map(p =>
    p && typeof p === 'object' && Array.isArray(p.layers) && p.layers.length
      ? { name: String(p.name || 'P').slice(0, 12),
          layers: p.layers.slice(0, MAX_LAYERS).map(sanitizeLayer),
          fixtures: Array.isArray(p.fixtures) ? sanitizeFixtures(p.fixtures) : null }
      : null
  ).concat(Array(PRESET_SLOTS).fill(null)).slice(0, PRESET_SLOTS);
}
const MAX_VUES = 8;

/**
 * Une vue = un dossier de fixtures dans MadMapper + comment Cascade le remplit.
 *
 * `manuelle` est le point important : une vue manuelle est celle que le
 * régisseur a dessinée LUI-MÊME dans MadMapper (son « déplié »). Cascade ne doit
 * JAMAIS recalculer ses positions — il ne fait que l'allumer et l'éteindre.
 * Sans ce drapeau, la première fonction de rangement écraserait son travail.
 */
function sanitizeVues(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const vus = new Set();
  for (const v of list.slice(0, MAX_VUES)) {
    if (!v || typeof v !== 'object') continue;
    const id = (typeof v.id === 'string' ? v.id.slice(0, 40) : '')
      || 'v' + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
    if (vus.has(id)) continue;
    vus.add(id);
    out.push({
      id,
      name: String(v.name || '').trim().slice(0, 20) || 'Vue ' + (out.length + 1),
      // Le nom EXACT du dossier de fixtures dans MadMapper. C'est la seule
      // chose qui relie Cascade au projet : une faute de frappe et la vue ne
      // pilote rien. D'où le voyant d'existence côté interface.
      dossier: String(v.dossier || '').trim().slice(0, 64),
      manuelle: !!v.manuelle,
      // Projection utilisée pour REMPLIR la vue (ignorée si manuelle).
      projection: ['face', 'dessus', 'cote', 'libre'].includes(v.projection) ? v.projection : 'face',
      axAz: Math.round(cnum(v.axAz, -100000, 100000, 0)) % 360,
      axEl: Math.round(cnum(v.axEl, -90, 90, 0)),
    });
  }
  return out;
}

/**
 * Nettoie l'adresse OSC d'une fixture. Trouvé à l'audit de la 2.0.0, en
 * envoyant des adresses hostiles et en lisant ce qui sortait vraiment.
 *
 * Trois défauts, tous silencieux :
 *
 *  - un **octet nul** tronque l'adresse à l'encodage. `/fixtures/bar\0zzz`
 *    partait comme `/fixtures/bar` — on pilotait un autre nœud que celui
 *    affiché, sans le moindre signe. Les caractères de contrôle sont retirés.
 *  - une adresse **sans `/` initial** n'est pas une adresse OSC valide.
 *    `fixtures/bar0` partait tel quel. On préfixe : l'intention est évidente.
 *  - une adresse **vide** produisait `/luminosity`, un message à la racine de
 *    MadMapper. Elle rend maintenant la chaîne vide, et `sendLum`/`sendRGB`
 *    n'envoient rien : une fixture sans adresse ne pilote rien, ce qui est la
 *    seule lecture honnête.
 *
 * ⚠ Ce qui n'est PAS traité ici, faute de mesure : les caractères de motif OSC
 * (`* ? [ ] { }`). Ils sont réservés et un serveur conforme les développe — une
 * seule fixture nommée « Bar * » commanderait alors TOUT le rig. On ne les
 * réécrit pas, parce qu'on ne sait pas encore si MadMapper les développe ou les
 * traite littéralement, et qu'une réécriture casserait une fixture qui marche.
 * Voir le rapport d'audit (hors dépôt) : c'est une mesure à faire sur MadMapper.
 */
function adresseOsc(brut) {
  const propre = String(brut || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  if (!propre) return '';
  const avecSlash = propre.startsWith('/') ? propre : '/' + propre;
  // `/` seul ne désigne rien : autant le traiter comme une absence d'adresse.
  return avecSlash === '/' ? '' : avecSlash;
}

function sanitizeFixtures(list, scene) {
  if (!Array.isArray(list)) return [];
  const s = scene || state.scene;
  // Pour la migration v1 : la plus grande longueur sert d'échelle relative.
  let lenMax = 0;
  for (const f of list) if (f && f.len > 0 && Number.isFinite(f.len)) lenMax = Math.max(lenMax, f.len);

  return list.slice(0, MAX_FIXTURES).map((f, i) => {
    const o = {
      id: (f && typeof f.id === 'string' ? f.id.slice(0, 40) : '') || 'fx' + Date.now() + '_' + i,
      name: String((f && f.name) || 'Fixture ' + (i + 1)).slice(0, 64),
      address: adresseOsc(f && f.address),
      enabled: !f || f.enabled !== false,
      x: f && typeof f.x === 'number' && Number.isFinite(f.x) ? Math.min(1, Math.max(0, f.x)) : null,
      y: f && typeof f.y === 'number' && Number.isFinite(f.y) ? Math.min(1, Math.max(0, f.y)) : null,
      rot: f && typeof f.rot === 'number' && Number.isFinite(f.rot) ? f.rot % 360 : null,
      len: f && typeof f.len === 'number' && Number.isFinite(f.len) && f.len > 0 ? f.len : null,
      vert: !!(f && f.vert),
      // « Inverser la LED » : la barre est branchée à l'envers par rapport au
      // sens de son vecteur. Cascade ne s'en sert PAS pour piloter les niveaux
      // (une barre n'a qu'une valeur), mais pour savoir dans quel sens la
      // DESSINER quand il génère une vue : sans ça, un dégradé qui doit courir
      // de jardin à cour part à l'envers sur une barre sur deux, et ça ne se
      // voit qu'une fois sur scène.
      inverse: !!(f && f.inverse),
    };
    // Espace 3D : on reprend celui du fichier s'il est valide, sinon on migre
    // depuis la 2D. Une barre sans position 2D non plus reste au centre.
    const p = f && f.p3, d = f && f.dir3;
    if (Array.isArray(p) && p.length === 3 && Array.isArray(d) && d.length === 3) {
      set3D(o, p, d, f.len3, s);   // la 3D fait foi, la 2D est recalculée
    } else {
      migre3D(o, s, lenMax);
    }
    return o;
  });
}

// ---------------------------------------------------------------------------
// OSC : encodage / décodage
// ---------------------------------------------------------------------------
function oscPad(len) { return (4 - (len % 4)) % 4; }
function oscString(str) {
  const b = Buffer.from(str, 'utf8');
  return Buffer.concat([b, Buffer.alloc(1 + oscPad(b.length + 1))]);
}
function oscMessage(address, args = []) {
  const parts = [oscString(address), oscString(',' + args.map(a => a.type).join(''))];
  for (const a of args) {
    if (a.type === 'f') { const b = Buffer.alloc(4); b.writeFloatBE(a.value); parts.push(b); }
    else if (a.type === 'i') { const b = Buffer.alloc(4); b.writeInt32BE(a.value); parts.push(b); }
    else if (a.type === 's') { parts.push(oscString(String(a.value))); }
  }
  return Buffer.concat(parts);
}
function oscReadString(buf, off) {
  let end = off;
  while (end < buf.length && buf[end] !== 0) end++;
  const str = buf.toString('utf8', off, end);
  end += 1 + oscPad(end - off + 1);
  return [str, end];
}
function oscDecode(buf, out = []) {
  if (buf.length === 0) return out;
  if (buf.toString('utf8', 0, 8) === '#bundle\0') {
    let off = 16;
    while (off + 4 <= buf.length) {
      const size = buf.readInt32BE(off); off += 4;
      if (size <= 0 || off + size > buf.length) break;
      oscDecode(buf.slice(off, off + size), out);
      off += size;
    }
    return out;
  }
  try {
    let [address, off] = oscReadString(buf, 0);
    let types = '';
    if (off < buf.length && buf[off] === 0x2c) { [types, off] = oscReadString(buf, off); types = types.slice(1); }
    const args = [];
    for (const t of types) {
      if (t === 'f') { args.push(buf.readFloatBE(off)); off += 4; }
      else if (t === 'i') { args.push(buf.readInt32BE(off)); off += 4; }
      else if (t === 's') { let s; [s, off] = oscReadString(buf, off); args.push(s); }
      else if (t === 'T') args.push(true);
      else if (t === 'F') args.push(false);
      else break;
    }
    out.push({ address, args });
  } catch (e) { /* ignoré */ }
  return out;
}

// ---------------------------------------------------------------------------
// Sockets UDP
// ---------------------------------------------------------------------------
let sendSock = dgram.createSocket('udp4');
let recvSock = null;
let feedbackHandlers = [];

// ── Liaison MadMapper ──────────────────────────────────────────────────────
// L'OSC part en UDP sans accusé de réception : sans ce voyant, une adresse ou
// un port erroné se traduit par « rien ne s'allume » et aucun message d'erreur.
// On interroge donc MadMapper régulièrement et on regarde s'il répond.
const mm = { lastSeen: 0, socketOk: false, error: null };
const MM_TIMEOUT_MS = 9000;
const MM_PROBE_MS = 3000;
function mmAlive() { return mm.lastSeen > 0 && Date.now() - mm.lastSeen < MM_TIMEOUT_MS; }
function probeMadMapper() {
  if (!recvSock) return;
  const f = state.fixtures.find(x => x.address);
  // Une seule valeur si on a une fixture, sinon la liste (courte) des racines.
  if (f) oscSend(`/getControlValues?url=${f.address}/${state.global.param}&normalized=0`, []);
  else oscSend('/getControls?root=/fixtures&recursive=0', []);
}
setInterval(() => { try { probeMadMapper(); } catch (e) {} }, MM_PROBE_MS);

function openFeedbackSocket() {
  if (recvSock) { try { recvSock.close(); } catch (e) {} recvSock = null; }
  mm.socketOk = false; mm.lastSeen = 0; mm.error = null;
  recvSock = dgram.createSocket('udp4');
  recvSock.on('error', (e) => {
    console.warn('Feedback OSC indisponible (port ' + state.settings.feedbackPort + ') :', e.message);
    mm.socketOk = false;
    mm.error = e.code === 'EADDRINUSE'
      ? 'Port de feedback ' + state.settings.feedbackPort + ' déjà utilisé par une autre application.'
      : e.message;
    try { recvSock.close(); } catch (_) {}
    recvSock = null;
  });
  recvSock.on('listening', () => { mm.socketOk = true; probeMadMapper(); });
  recvSock.on('message', (msg) => {
    mm.lastSeen = Date.now(); // MadMapper est bien là et nous parle
    const decoded = oscDecode(msg);
    for (const h of feedbackHandlers) h(decoded);
  });
  recvSock.bind(state.settings.feedbackPort);
}
function oscSend(address, args) {
  sendSock.send(oscMessage(address, args), state.settings.mmPort, state.settings.mmHost);
}

// ── OSC entrant (contrôleur externe : TouchOSC, console, etc.) ─────────────
let oscInSock = null;
function openOscInSocket() {
  if (oscInSock) { try { oscInSock.close(); } catch (e) {} oscInSock = null; }
  if (!state.settings.oscInPort) return;
  oscInSock = dgram.createSocket('udp4');
  oscInSock.on('error', (e) => {
    console.warn('OSC-in indisponible (port ' + state.settings.oscInPort + ') :', e.message);
    try { oscInSock.close(); } catch (_) {}
    oscInSock = null;
  });
  oscInSock.on('message', (msg) => handleControlOsc(oscDecode(msg)));
  oscInSock.bind(state.settings.oscInPort);
}

// ---------------------------------------------------------------------------
// Ableton Link — suit le tempo de Pulse, Ableton Live, etc. (activable dans
// le panneau Tempo). Passe par Carabiner (Deep Symmetry) : petit binaire
// officiel embarquant la lib Link, téléchargé par le lanceur dans runtime/,
// qui expose la session Link en TCP local (port 17000). Zéro dépendance npm.
// Quand Link est actif : BPM de la session → temps/pas de TOUTES les couches
// (1 beat = 1 pas) ; chaque couche garde sa « Vitesse » ×0.1–×4 pour varier.
// ---------------------------------------------------------------------------
const CARABINER_PORT = 17000;
const link = { active: false, connected: false, bpm: 0, peers: 0, error: null };
let linkSock = null, linkChild = null, linkRetry = null, linkBuf = '';
let linkFailStreak = 0; // reconnexions successives après une connexion réussie

// ── Synchronisation de PHASE ───────────────────────────────────────────────
// Suivre le BPM ne suffit pas : deux appareils au même tempo peuvent jouer à
// contretemps l'un de l'autre. Link expose aussi une POSITION sur la grille
// (le numéro de beat courant, fractionnaire). En l'ancrant sur notre horloge
// locale, on peut caler chaque pas exactement sur un beat — et le pas 0 tombe
// alors sur un temps fort, puisque le beat 0 de Link en est un.
//
// `beat` de Carabiner et `Date.now()` sont deux horloges différentes : on ne
// les compare jamais. On note simplement « au moment où j'ai lu ce statut,
// on était au beat B », puis on extrapole avec le BPM.
const linkClock = { anchorLocal: 0, anchorBeat: 0, bpm: 0 };
const LINK_CLOCK_TTL = 4000;   // sans nouveau statut, on cesse de faire confiance
const LINK_POLL_MS = 400;      // Carabiner ne pousse pas forcément en continu

/** Position sur la grille Link, en beats fractionnaires, ou null. */
function linkGrid(now) {
  if (!link.active || !state.settings.linkPhase) return null;
  if (!linkClock.anchorLocal || !(linkClock.bpm > 0)) return null;
  if (now - linkClock.anchorLocal > LINK_CLOCK_TTL) return null;
  const beatMs = 60000 / linkClock.bpm;
  return { beat: linkClock.anchorBeat + (now - linkClock.anchorLocal) / beatMs, beatMs };
}
/** Position dans la mesure, 0 à 1 — pour le témoin visuel de l'interface. */
function linkPhase() {
  const g = linkGrid(Date.now());
  if (!g) return null;
  const q = Math.max(1, state.settings.linkQuantum || 4);
  return ((g.beat % q) + q) % q / q;
}

function carabinerPath() {
  const bin = process.platform === 'win32' ? 'carabiner.exe' : 'carabiner';
  const p = path.join(DATA_DIR, 'runtime', bin);
  try { return fs.existsSync(p) ? p : null; } catch (e) { return null; }
}

function applyLinkBpm(bpm) {
  if (!(bpm > 0) || !link.active) return;
  link.bpm = Math.round(bpm * 100) / 100;
  const stepMs = Math.max(30, Math.min(2000, Math.round(60000 / bpm)));
  let changed = false;
  for (const L of state.layers) {
    if (L.stepMs !== stepMs) { L.stepMs = stepMs; changed = true; }
  }
  if (changed) saveConfig(); // débouncé : pas de rafale disque si le BPM dérive
}

function spawnCarabiner() {
  if (linkChild) return true;
  const bin = carabinerPath();
  if (!bin) {
    link.error = 'Module Link absent — relance le lanceur Cascade pour l’installer.';
    return false;
  }
  try {
    linkChild = spawn(bin, ['--port', String(CARABINER_PORT)], { stdio: 'ignore', windowsHide: true });
    linkChild.on('exit', () => { linkChild = null; });
    linkChild.on('error', (e) => { linkChild = null; link.error = 'Carabiner : ' + e.message; });
    return true;
  } catch (e) { link.error = 'Carabiner : ' + e.message; return false; }
}

function linkConnect(attempt) {
  if (!link.active) return;
  const sock = net.createConnection({ host: '127.0.0.1', port: CARABINER_PORT });
  linkSock = sock;
  sock.setNoDelay(true);
  linkBuf = '';
  sock.on('connect', () => {
    link.connected = true; link.error = null; sock._ok = true; sock._since = Date.now();
    sock.write('status\n'); // ensuite Carabiner pousse les mises à jour tout seul
    // …mais il ne pousse que sur changement : pour garder la grille de phase
    // fraîche, on redemande le statut régulièrement (TCP local, coût nul).
    clearInterval(sock._poll);
    sock._poll = setInterval(() => {
      try { if (!sock.destroyed) sock.write('status\n'); } catch (e) {}
    }, LINK_POLL_MS);
  });
  sock.on('data', (d) => {
    linkBuf += d.toString('utf8');
    let i;
    while ((i = linkBuf.indexOf('\n')) >= 0) {
      const line = linkBuf.slice(0, i); linkBuf = linkBuf.slice(i + 1);
      const mp = /:peers\s+(\d+)/.exec(line);
      const mb = /:bpm\s+([0-9.]+)/.exec(line);
      const mt = /:beat\s+(-?[0-9.]+)/.exec(line);
      if (mp) link.peers = +mp[1];
      if (mb) applyLinkBpm(parseFloat(mb[1]));
      // On ancre la grille à l'instant PRÉCIS de la lecture : c'est la seule
      // chose qui relie l'horloge de Link à la nôtre.
      if (mt && mb) {
        const bpm = parseFloat(mb[1]);
        if (bpm > 0) {
          linkClock.anchorLocal = Date.now();
          linkClock.anchorBeat = parseFloat(mt[1]);
          linkClock.bpm = bpm;
        }
      }
    }
  });
  sock.on('error', () => {}); // le close qui suit gère la reconnexion
  sock.on('close', () => {
    clearInterval(sock._poll);
    if (linkSock === sock) linkSock = null;
    link.connected = false;
    linkClock.anchorLocal = 0; // la grille n'est plus fiable
    if (!link.active) return;
    // Personne n'écoute encore : on lance notre Carabiner puis on réessaie.
    const canRetry = spawnCarabiner();
    const n = sock._ok ? 1 : (attempt || 0) + 1; // connexion perdue : on repart de zéro
    if (canRetry && n <= 20) {
      // Si Carabiner s'était connecté puis a lâché, on retente indéfiniment
      // (coupure réseau passagère) — mais avec un délai qui s'allonge, sinon
      // un Carabiner qui plante en boucle ferait tourner le CPU pendant le show.
      // Seule une liaison qui a TENU (10 s) remet le compteur à zéro : sans ça,
      // un cycle connexion/chute immédiate garderait un délai de 700 ms à vie.
      let delai = 700;
      if (sock._ok) {
        const stable = Date.now() - (sock._since || 0) > 10000;
        linkFailStreak = stable ? 0 : linkFailStreak + 1;
        delai = Math.min(5000, 700 * Math.pow(1.6, Math.min(6, linkFailStreak)));
      }
      linkRetry = setTimeout(() => linkConnect(n), delai);
    } else if (canRetry) {
      link.error = 'Carabiner injoignable (port ' + CARABINER_PORT + ').';
      setLinkActive(false, true);
    } else {
      setLinkActive(false, true); // binaire absent : message déjà posé
    }
  });
}

function setLinkActive(on, keepError) {
  if (on && !link.active) {
    link.active = true;
    if (!keepError) link.error = null;
    linkConnect(0);
  } else if (!on) {
    link.active = false;
    if (linkRetry) { clearTimeout(linkRetry); linkRetry = null; }
    if (linkSock) { try { linkSock.destroy(); } catch (e) {} linkSock = null; }
    if (linkChild) { try { linkChild.kill(); } catch (e) {} linkChild = null; }
    link.connected = false; link.bpm = 0; link.peers = 0;
    if (!keepError) link.error = null;
  }
  state.settings.linkEnabled = link.active;
  saveConfig();
}

function killCarabiner() { if (linkChild) { try { linkChild.kill(); } catch (e) {} linkChild = null; } }
process.on('exit', killCarabiner);
process.on('SIGINT', () => { flushConfig(); killCarabiner(); process.exit(0); });
process.on('SIGTERM', () => { flushConfig(); killCarabiner(); process.exit(0); });

// ---------------------------------------------------------------------------
// Arrêt automatique (mode app, plus de terminal visible) : quand la dernière
// fenêtre/onglet de l'interface se ferme, plus personne ne poll /api/state →
// le serveur se ferme tout seul. Garde-fous :
//  - jamais tant qu'aucune interface ne s'est encore connectée (démarrage) ;
//  - JAMAIS pendant que les chasers tournent (on ne coupe pas un show) ;
//  - jamais si un contrôleur OSC externe a parlé récemment.
// 8 s de grâce : un simple rechargement de page ne déclenche rien.
// ---------------------------------------------------------------------------
let lastUiPollAt = 0, lastOscAt = 0;
const UI_GONE_MS = 8000;
setInterval(() => {
  if (NO_AUTOQUIT || !lastUiPollAt) return;
  const now = Date.now();
  if (now - lastUiPollAt < UI_GONE_MS) return;
  if (state.global.running) return;
  if (lastOscAt && now - lastOscAt < UI_GONE_MS) return;
  console.log('[cascade] plus aucune interface ouverte — arrêt automatique.');
  flushConfig(); killCarabiner();
  process.exit(0);
}, 2000);

// Courbe vitesse : 0–1 → ×0.1 à ×4, centre 0.5 = ×1
function speedCurve(v) { return v >= 0.5 ? Math.pow(4, (v - 0.5) * 2) : Math.pow(10, (v - 0.5) * 2); }
function stepCurve(v) { return Math.round(30 * Math.pow(2000 / 30, Math.max(0, Math.min(1, v)))); }
function num01(args) {
  const v = args && args.length ? args[0] : 1;
  if (v === true) return 1;
  if (v === false) return 0;
  return typeof v === 'number' ? Math.max(0, Math.min(1, v)) : 0;
}
const STEP_PATTERNS = ['lr', 'rl', 'pingpong', 'random', 'evenodd', 'all'];
const WAVE_PATTERNS = ['lr', 'rl', 'tb', 'bt', 'pulse', 'radial'];

/**
 * Adresses reconnues :
 *  /chaser/start | /stop | /blackout | /tap
 *  /chaser/master 0-1        /chaser/speed 0-1 (0.5 = ×1)
 *  /chaser/xfade 0-1         (crossfader : 0 = jeu A, 1 = jeu B)
 *  /chaser/preset 1-8   ou   /chaser/preset/3
 *  /chaser/layer/N/level|stepms|speed|pattern|enable|invert|mirrorh|mirrorv|width|group|tap
 *   (N = numéro de couche 1-8 ; valeurs 0-1, pattern = 0-1 découpé en 6 zones)
 */
function handleControlOsc(msgs) {
  let changed = false, seen = false;
  for (const m of msgs) {
    const a = (m.address || '').toLowerCase();
    if (!a.startsWith('/cascade') && !a.startsWith('/chaser')) continue; // /chaser : rétrocompat
    const p = a.split('/').filter(Boolean);
    const v = num01(m.args);
    const on = v > 0;
    seen = true;
    changed = true; // remis à false plus bas pour les commandes non persistantes
    if (p[1] === 'start') { if (on) startChase(); changed = false; }
    else if (p[1] === 'stop') { if (on) stopChase(); changed = false; }
    else if (p[1] === 'blackout') { if (on) blackout(); changed = false; }
    else if (p[1] === 'tap') { if (on) tap(state.layers[0] && state.layers[0].id); changed = false; }
    else if (p[1] === 'resync' || p[1] === 'go') { if (on) resync(); changed = false; }
    else if (p[1] === 'link') { setLinkActive(on); changed = false; } // gère sa propre sauvegarde
    else if (p[1] === 'linkphase') state.settings.linkPhase = on;
    else if (p[1] === 'master') state.global.master = v;
    else if (p[1] === 'xfade') state.global.xfade = v;
    else if (p[1] === 'speed') state.global.speed = +speedCurve(v).toFixed(3);
    // Fondu entre presets : 0-1 → 0 à 10 s (au-delà, passer par les réglages)
    else if (p[1] === 'presetfade') state.global.presetFade = Math.round(v * 10000);
    else if (p[1] === 'preset') {
      const slot = p[2] ? (+p[2] - 1) : (m.args && typeof m.args[0] === 'number' ? Math.round(m.args[0]) - 1 : -1);
      if (on && slot >= 0 && slot < PRESET_SLOTS) recallPreset(slot);
    } else if (p[1] === 'layer' && p[2]) {
      const L = state.layers[+p[2] - 1];
      if (!L) continue;
      const k = p[3];
      if (k === 'level') L.level = v;
      else if (k === 'stepms') L.stepMs = stepCurve(v);
      else if (k === 'speed') L.speed = +speedCurve(v).toFixed(3);
      else if (k === 'enable') L.enabled = on;
      else if (k === 'invert') L.invert = on;
      else if (k === 'mirrorh') L.mirrorH = on;
      else if (k === 'mirrorv') L.mirrorV = on;
      else if (k === 'width') L.width = Math.max(1, Math.min(8, Math.round(1 + v * 7)));
      else if (k === 'group') L.group = Math.max(1, Math.min(8, Math.round(1 + v * 7)));
      else if (k === 'blocks') L.blocks = Math.max(1, Math.min(8, Math.round(1 + v * 7)));
      else if (k === 'floor') L.floor = v;
      else if (k === 'sparkle') L.sparkle = v;
      else if (k === 'phase') L.phase = Math.round(v * 360);
      else if (k === 'swing') L.swing = Math.round((v - 0.5) * 150); // 0.5 = pas de swing
      else if (k === 'oneshot') L.oneShot = on;
      else if (k === 'tap') { if (on) tap(L.id); changed = false; }
      else if (k === 'resync' || k === 'go') { if (on) resync(L.id); changed = false; }
      else if (k === 'pattern') {
        const pats = L.engine === 'wave' ? WAVE_PATTERNS : STEP_PATTERNS;
        L.pattern = pats[Math.min(pats.length - 1, Math.floor(v * pats.length))];
      }
    }
  }
  // Un contrôleur externe qui tient un fader envoie des dizaines de messages
  // par seconde : sauvegarde throttlée, jamais une écriture disque par message.
  if (seen) lastOscAt = Date.now();
  if (changed) saveConfigSoon();
}

// ---------------------------------------------------------------------------
// Découverte / inspection / géométrie
// ---------------------------------------------------------------------------
function discover(timeoutMs = 1200) {
  return new Promise((resolve) => {
    const found = new Set();
    const handler = (msgs) => {
      for (const m of msgs) {
        const a = m.address;
        if (!a || a.endsWith('/selected') || a.includes('getControls')) continue;
        if (/^\/(surfaces|fixtures)\/[^/]+$/.test(a)) found.add(a);
      }
    };
    feedbackHandlers.push(handler);
    for (const root of ['/surfaces', '/fixtures']) oscSend(`/getControls?root=${root}&recursive=0`, []);
    setTimeout(() => {
      feedbackHandlers = feedbackHandlers.filter(h => h !== handler);
      resolve([...found].map(addr => ({ address: addr, name: decodeURIComponent(addr.split('/').pop()) })));
    }, timeoutMs);
  });
}

/**
 * Sur quel port MadMapper écoute-t-il vraiment ?
 *
 * Vécu le 2026-07-26 : le port d'entrée OSC de MadMapper est un réglage de
 * PROJET (Préférences → onglet Project → OSC), et il valait 8010 alors que tout
 * le monde croyait 8000. Résultat : Cascade muet, sans autre indice qu'un voyant
 * rouge. Ce balayage remplace une demi-heure de tâtonnement par un bouton.
 *
 * On envoie une requête inoffensive sur chaque candidat et on regarde d'où vient
 * la réponse — enfin, SI elle vient : MadMapper répond sur SON port de feedback
 * configuré, qui doit être celui de Cascade. Sans réponse, c'est donc l'un ou
 * l'autre, et l'interface le dit.
 *
 * ⚠ Un port candidat égal à notre port d'écoute nous renverrait nos propres
 * paquets en boucle locale — et ça ressemble à s'y tromper à une réponse. D'où le
 * filtre sur l'adresse : une vraie réponse n'a jamais l'adresse de la requête.
 */
const PORTS_CANDIDATS = [8000, 8010, 8080, 8100, 7000, 8888, 9010, 1234];

function chercherMadMapper(parPortMs = 500) {
  const requete = '/getControls?root=/&recursive=0';
  const attendus = new Set(['/fixtures', '/surfaces', '/media', '/outputs',
                            '/master', '/modules', '/application', '/timelines']);
  const ports = [...new Set([state.settings.mmPort, ...PORTS_CANDIDATS])]
    .filter(p => p !== state.settings.feedbackPort);

  return new Promise((resolve) => {
    const resultats = [];
    let vus = 0;
    const handler = (msgs) => {
      for (const m of msgs) {
        if (!m.address || m.address === requete) continue;   // pas notre écho
        if (attendus.has(m.address) || m.address === '/replyMessageCount') vus++;
      }
    };
    feedbackHandlers.push(handler);

    const suivant = (i) => {
      // On s'arrête au premier port qui répond : le bon est presque toujours en
      // tête de liste, et un régisseur qui clique n'a pas à attendre le balayage
      // complet. Les ports non essayés sont simplement absents du résultat.
      if (i >= ports.length || resultats.some(r => r.reponses > 0)) {
        feedbackHandlers = feedbackHandlers.filter(h => h !== handler);
        return resolve(resultats);
      }
      vus = 0;
      sendSock.send(oscMessage(requete, []), ports[i], state.settings.mmHost);
      setTimeout(() => {
        resultats.push({ port: ports[i], reponses: vus });
        suivant(i + 1);
      }, parPortMs);
    };
    suivant(0);
  });
}

/**
 * Les noms des enfants directs de /fixtures dans MadMapper.
 *
 * Un dossier de fixtures y apparaît comme un nœud ordinaire — impossible de le
 * distinguer d'une fixture par l'espace de noms seul. On renvoie donc tout, et
 * c'est la comparaison avec les noms de dossiers déclarés dans Cascade qui
 * tranche. Lecture seule.
 */
function listerDossiers(timeoutMs = 2000) {
  return new Promise((resolve) => {
    const vus = new Set();
    const handler = (msgs) => {
      for (const m of msgs) {
        if (!m.address || m.address.includes('getControl')) continue;
        const mm = /^\/fixtures\/([^/]+)$/.exec(m.address);
        if (mm && mm[1] !== 'selected') vus.add(mm[1]);
      }
    };
    feedbackHandlers.push(handler);
    oscSend('/getControls?root=/fixtures&recursive=0', []);
    setTimeout(() => {
      feedbackHandlers = feedbackHandlers.filter(h => h !== handler);
      resolve([...vus]);
    }, timeoutMs);
  });
}

function inspect(address, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const found = new Map();
    const handler = (msgs) => {
      for (const m of msgs) {
        if (!m.address || m.address.includes('getControl')) continue;
        if (m.address.startsWith(address + '/')) {
          if (!found.has(m.address) || m.args.length) found.set(m.address, m.args.length ? m.args[0] : null);
        }
      }
    };
    feedbackHandlers.push(handler);
    oscSend(`/getControlValues?url=${address}/.*&normalized=0`, []);
    oscSend(`/getControls?root=${address}&recursive=1`, []);
    setTimeout(() => {
      feedbackHandlers = feedbackHandlers.filter(h => h !== handler);
      resolve([...found].map(([a, v]) => ({ address: a, value: v })));
    }, timeoutMs);
  });
}

async function readGeometry(f) {
  const controls = await inspect(f.address, 700);
  const g = { handles: {}, x: null, y: null, rot: null, pixel: false, w: null };
  for (const c of controls) {
    if (typeof c.value !== 'number') continue;
    const rel = c.address.slice(f.address.length + 1).toLowerCase();
    const m = rel.match(/^handles\/(\d+)\/(x|y)$/);
    if (m) { (g.handles[m[1]] = g.handles[m[1]] || {})[m[2]] = c.value; continue; }
    if (rel === 'output/x') { g.x = c.value; g.pixel = true; }
    else if (rel === 'output/y') { g.y = c.value; g.pixel = true; }
    else if (rel === 'output/rot') g.rot = c.value;
    else if (rel === 'output/width') g.w = c.value;
    else if (rel === 'x' || rel === 'position/x' || rel === 'pos/x') g.x = c.value;
    else if (rel === 'y' || rel === 'position/y' || rel === 'pos/y') g.y = c.value;
    else if (g.rot === null && /rotation|angle/.test(rel)) g.rot = c.value;
  }
  const hs = Object.keys(g.handles).sort((a, b) => a - b).map(k => g.handles[k])
    .filter(h => typeof h.x === 'number' && typeof h.y === 'number');
  let len = null;
  if (hs.length) {
    g.x = hs.reduce((s, h) => s + h.x, 0) / hs.length;
    g.y = hs.reduce((s, h) => s + h.y, 0) / hs.length;
    if (hs.length >= 2) {
      const dx = hs[1].x - hs[0].x, dy = hs[1].y - hs[0].y;
      len = Math.sqrt(dx * dx + dy * dy);
      if (g.rot === null) g.rot = Math.atan2(dy, dx) * 180 / Math.PI;
    }
  }
  if (len === null && g.w !== null && g.w > 0 && g.w !== 1) len = g.w;
  return (g.x !== null && g.y !== null) ? { x: g.x, y: g.y, rot: g.rot, len, pixel: g.pixel } : null;
}

// ---------------------------------------------------------------------------
// Moteur multi-couches
// ---------------------------------------------------------------------------
function enabledFixtures() { return state.fixtures.filter(f => f.enabled !== false); }
function posX(f) { return typeof f.x === 'number' ? f.x : 0.5; }
function posY(f) { return typeof f.y === 'number' ? f.y : 0.5; }
function nearestTo(x, y, list) {
  let best = null, bd = Infinity;
  for (const f of list) {
    const dx = posX(f) - x, dy = posY(f) - y, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

const CURVES = {
  linear: t => t,
  easeIn: t => t * t,
  easeOut: t => 1 - (1 - t) * (1 - t),
  easeInOut: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  expo: t => t === 0 ? 0 : Math.pow(2, 10 * t - 10),
};

// État runtime par couche
const engines = new Map();
/** `store` permet de faire tourner une seconde scène en parallèle (fondu
 *  entre presets) sans que les deux se marchent dessus : les identifiants de
 *  couche sont souvent les mêmes des deux côtés. */
/**
 * Position dans le cycle, pour les moteurs continus (vague et champ).
 *
 * ⚠ Pourquoi ne PAS écrire `now / period` — l'évidence qui était fausse.
 * `now` vaut ~1,78e12 ms. La partie fractionnaire de `now / period` n'a aucune
 * continuité quand `period` change : passer stepMs de 10000 à 9999 (0,01 %,
 * imperceptible musicalement) projetait la vague à une phase arbitraire.
 * Mesuré : les niveaux sautaient de « 0,27 0,00 0,19 0,67 0,99 0,85 » à
 * « 0,48 0,91 0,90 … », soit 0,93 d'écart. Or Ableton Link change le tempo en
 * permanence, et la règle n°4 du projet exige que la phase soit préservée.
 * Défaut présent depuis la v1 sur le moteur vague ; le champ en héritait.
 *
 * On intègre donc le temps : la phase avance de (Δt / période) à chaque appel.
 * Changer la période change la VITESSE, jamais la position. Et `resync` peut
 * enfin la remettre à zéro — ce que le bouton GO promettait sans le faire.
 */
/**
 * Durée d'un cycle complet de la couche, en millisecondes.
 *
 * C'est LE dénominateur commun du tempo : il suit `stepMs` (donc le tap tempo
 * et Ableton Link, qui écrivent dedans), le groupe, la vitesse de la couche et
 * la vitesse globale. Un modulateur calé là-dessus reste accroché à la musique
 * sans qu'on ait à lui refaire ses réglages.
 */
function periodeCouche(L) {
  const gs = Math.max(0.05, globalEff('speed'));
  return Math.max(60, (L.stepMs * Math.max(1, L.group)) / (Math.max(0.05, L.speed) * gs));
}

function phaseContinue(L, now, store = engines) {
  const e = eng(L.id, store);
  const period = periodeCouche(L);
  if (e.u == null) { e.u = 0; e.uLast = now; }
  // Un écart négatif ou délirant (horloge système reculée, machine en veille)
  // ne doit pas propulser la phase n'importe où : on borne à une seconde.
  const dt = Math.min(1000, Math.max(0, now - e.uLast));
  e.uLast = now;
  e.u = (e.u + dt / period) % 1;
  return { u: e.u, period };
}

function eng(id, store = engines) {
  let e = store.get(id);
  if (!e) {
    e = { startTime: Date.now(), lastStep: -1, stepDur: 0,
      triggers: new Map(), lastEnv: new Map(), randomCache: new Map(), gain: new Map() };
    store.set(id, e);
  }
  return e;
}
/** Copie l'état moteur d'une couche : la scène sortante d'un fondu continue
 *  sa course là où elle en était, au lieu de repartir du premier pas. */
function cloneEngine(e) {
  // ⚠ `u` et `uLast` font partie de l'état : ce sont la phase des moteurs
  // continus. Les oublier remettrait la couche sortante à zéro au début de
  // CHAQUE fondu entre presets — un saut visible, précisément au moment où
  // l'on cherche une transition douce.
  return { startTime: e.startTime, lastStep: e.lastStep, stepDur: e.stepDur,
    u: e.u, uLast: e.uLast,
    triggers: new Map(e.triggers), lastEnv: new Map(e.lastEnv),
    randomCache: new Map(e.randomCache), gain: new Map(e.gain) };
}

// ── Presets : couches + disposition des barres (ordre et vue spatiale) ─────
const deep = o => JSON.parse(JSON.stringify(o));
function savePreset(i, name) {
  const n = String(name == null ? '' : name).trim().slice(0, 16);
  return { name: n || 'P' + (i + 1), layers: deep(state.layers), fixtures: deep(state.fixtures) };
}
/** Fondu en cours entre deux presets (null = rappel sec). */
let fade = null; // { start, dur, layers, fixtures, engines }
function cancelFade() { fade = null; }

/**
 * Rappelle un preset. Si un temps de fondu est réglé ET qu'un show tourne,
 * la scène sortante est mise de côté avec son état moteur : elle continue de
 * jouer et décroît pendant que la nouvelle monte.
 * `fadeMs` permet de forcer une durée pour ce rappel précis (0 = sec).
 */
function recallPreset(i, fadeMs) {
  const p = state.presets[i];
  if (!p) return false;
  const dur = Math.round(cnum(fadeMs == null ? state.global.presetFade : fadeMs, 0, MAX_FADE_MS, 0));
  if (dur > 0 && state.global.running && state.layers.length) {
    const store = new Map();
    for (const L of state.layers) {
      const e = engines.get(L.id);
      if (e) store.set(L.id, cloneEngine(e));
    }
    // Un rappel pendant un fondu remplace le précédent : la scène en cours de
    // sortie est abandonnée, sinon il faudrait empiler les fondus à l'infini.
    fade = { start: Date.now(), dur, layers: deep(state.layers),
             fixtures: deep(state.fixtures), engines: store };
  } else cancelFade();
  state.layers = deep(p.layers);
  if (Array.isArray(p.fixtures) && p.fixtures.length) {
    // ⚠ Repasser par sanitizeFixtures, et pas seulement copier : c'était le SEUL
    // chemin d'écriture des fixtures qui ne re-dérivait pas la 2D depuis la 3D.
    // Un preset enregistré sur un plateau de 10 m, rappelé sur un plateau de
    // 20 m, laissait des x/y d'un autre monde — et « Renvoyer la disposition »
    // aurait écrit ces faux pixels dans MadMapper. Mesuré : x = 0,90 là où la
    // position 3D imposait 0,70.
    state.fixtures = sanitizeFixtures(p.fixtures);
    pruneCaches();
  }
  engines.clear();
  return true;
}
/** Noms des presets pour l'interface : null = slot vide. */
function presetNames() { return state.presets.map((p, i) => p ? (p.name || 'P' + (i + 1)) : null); }

/** Resync : recale la phase (départ des pas) d'une couche, ou de toutes. */
/**
 * GO / RESYNC : tout repart ensemble, sur le temps fort.
 *
 * Supprimer l'entrée suffit : la prochaine évaluation recrée un état neuf, donc
 * une phase à zéro pour les moteurs continus et un cycle qui redémarre pour le
 * pas-à-pas. Avant l'horloge de phase, la vague et le champ étaient sans état :
 * le bouton ne faisait rien sur eux, alors qu'il promet « tous les chasers ».
 */
function resync(layerId) {
  if (layerId) engines.delete(layerId); else engines.clear();
}

function targetsAtStep(L, e, k, N) {
  if (N === 0) return [];
  switch (L.pattern) {
    case 'lr': return [k % N];
    case 'rl': return [N - 1 - (k % N)];
    case 'pingpong': {
      if (N === 1) return [0];
      const period = 2 * N - 2, i = k % period;
      return [i < N ? i : period - i];
    }
    case 'random': {
      if (!e.randomCache.has(k)) {
        let r = Math.floor(Math.random() * N);
        const prev = e.randomCache.get(k - 1);
        if (N > 1 && r === prev) r = (r + 1) % N;
        e.randomCache.set(k, r);
        for (const key of e.randomCache.keys()) if (key < k - 4) e.randomCache.delete(key);
      }
      return [e.randomCache.get(k)];
    }
    case 'evenodd': {
      const even = k % 2 === 0;
      return Array.from({ length: N }, (_, i) => i).filter(i => (i % 2 === 0) === even);
    }
    case 'all': return Array.from({ length: N }, (_, i) => i);
    default: return [k % N];
  }
}

function envelope(L, elapsed, stepDur) {
  const onTime = Math.max(1, L.width) * stepDur;
  if (L.mode === 'onoff') return elapsed < onTime ? 1 : 0;
  const curve = CURVES[L.curve] || CURVES.linear;
  const attack = Math.min((L.fadeInPct / 100) * stepDur, onTime);
  const release = (L.fadeOutPct / 100) * stepDur;
  if (elapsed < attack) return curve(elapsed / attack);
  if (elapsed < onTime) return 1;
  if (elapsed < onTime + release) return 1 - curve((elapsed - onTime) / release);
  return -1;
}

/** Moteur pas-à-pas : renvoie Map fixtureId -> valeur 0..1 */
function stepValues(L, list, now, store) {
  const e = eng(L.id, store);
  const gs = Math.max(0.05, state.global.speed);
  // Avec la synchro de phase, la durée d'un pas est celle d'un beat Link divisé
  // par la vitesse de la couche : le pas COLLE à la grille, il ne l'approxime pas.
  const grille = linkGrid(now);
  const parBeat = Math.max(0.05, L.speed) * gs; // pas par beat
  const stepDur = grille
    ? Math.max(15, grille.beatMs / parBeat)
    : Math.max(15, L.stepMs / (Math.max(0.05, L.speed) * gs));
  if (e.stepDur > 0 && Math.abs(e.stepDur - stepDur) > 0.001) {
    const oldFloat = (now - e.startTime) / e.stepDur;
    e.startTime = now - oldFloat * stepDur; // tempo changé : phase préservée
    // Les enveloppes en cours sont datées sur l'ANCIENNE échelle : sans les
    // remettre à l'échelle, accélérer le tempo rend une barre « trop vieille »
    // que son enveloppe raccourcie, et elle s'éteint le temps d'un pas.
    const ratio = stepDur / e.stepDur;
    for (const [id, t] of e.triggers) e.triggers.set(id, now - (now - t) * ratio);
  }
  e.stepDur = stepDur;

  const mh = !!L.mirrorH, mv = !!L.mirrorV;
  const ax = L.axisX ?? 0.5, ay = L.axisY ?? 0.5;
  // « Ordre = projection sur l'axe » : le chase ne suit plus l'ordre de la liste
  // mais la géométrie réelle du plateau. C'est ce qui fait qu'un « G › D » part
  // vraiment de jardin même si les barres ont été ajoutées dans le désordre — et
  // qu'un axe incliné donne un balayage en diagonale, gratuitement.
  //
  // On trie une COPIE : `list` vient de resolveBars et peut être la vraie liste
  // des fixtures. La trier sur place changerait l'ordre d'affichage de toute
  // l'interface, pour toutes les couches.
  if (L.ordre3d) {
    const a = axeDe(L.axAz, L.axEl);
    const proj = (f) => {
      const p = f.p3 || [0, 0, 0];
      return p[0] * a[0] + p[1] * a[1] + p[2] * a[2];
    };
    // Départage par identifiant : deux barres exactement à la même hauteur sur
    // l'axe doivent garder un ordre STABLE d'un tick à l'autre, sinon le chase
    // les échange au hasard et ça se voit.
    list = [...list].sort((f, g2) => (proj(f) - proj(g2)) || (f.id < g2.id ? -1 : f.id > g2.id ? 1 : 0));
  }
  let chaseList = list;
  if (mh || mv) {
    chaseList = list.filter(f => (!mh || posX(f) <= ax) && (!mv || posY(f) <= ay));
    const covered = new Set(chaseList.map(f => f.id));
    for (const f of chaseList) {
      if (mh) { const m = nearestTo(2 * ax - posX(f), posY(f), list); if (m) covered.add(m.id); }
      if (mv) { const m = nearestTo(posX(f), 2 * ay - posY(f), list); if (m) covered.add(m.id); }
      if (mh && mv) { const m = nearestTo(2 * ax - posX(f), 2 * ay - posY(f), list); if (m) covered.add(m.id); }
    }
    for (const f of list) if (!covered.has(f.id)) chaseList.push(f);
    if (!chaseList.length) chaseList = list;
  }
  const Nc = chaseList.length;
  const g = Math.max(1, Math.min(Nc, Math.round(L.group) || 1));
  // Cellules = paquets de `group` barres qui s'allument ensemble.
  const cellCount = Math.ceil(Nc / g);
  // Blocs : le motif est joué EN PARALLÈLE sur N tronçons de la scène
  // (« blocks » des consoles MA/Chamsys). blocks=1 → comportement d'avant.
  const B = Math.max(1, Math.min(cellCount, Math.round(L.blocks) || 1));
  const cellsPerBlock = Math.ceil(cellCount / B);

  // Décalage de phase : exprimé en degrés du cycle, converti en millisecondes
  // (donc il suit le tempo). Ignoré en mode « une fois » : le coup part au GO.
  const cycleMs = cellsPerBlock * stepDur;
  const phaseMs = L.oneShot ? 0 : ((L.phase || 0) / 360) * cycleMs;
  // Origine du pas 0. Sans Link : l'instant du démarrage. Avec la synchro de
  // phase : recalculée à chaque tick depuis la position réelle sur la grille,
  // donc AUCUNE dérive possible, et le pas 0 tombe sur le beat 0 — un temps fort.
  // Le mode « une fois » garde son origine libre : le coup part au GO, pas au beat.
  const origin = (grille && !L.oneShot)
    ? now - grille.beat * parBeat * stepDur - phaseMs
    : e.startTime - phaseMs;
  // Swing : retarde un pas sur deux (groove). ±75 % du demi-pas.
  const sw = Math.max(-75, Math.min(75, L.swing || 0)) / 100;
  const stepStart = (k) => origin + k * stepDur + (k % 2 ? sw * stepDur * 0.5 : 0);

  let step = Math.floor((now - origin) / stepDur);
  while (stepStart(step + 1) <= now) step++;
  while (step >= 0 && stepStart(step) > now) step--;
  // Moteur neuf : on ENTRE dans la grille au pas courant. Sans ça, avec la
  // synchro de phase, l'origine est le beat 0 de la session Link — vieux de
  // plusieurs heures — et un START rejouerait toute cette histoire d'un coup.
  if (e.lastStep < 0) e.lastStep = step - 1;
  // Garde-fou : après une mise en veille de la machine, `now` fait un bond de
  // plusieurs minutes. Sans ça on rejouerait des dizaines de milliers de pas
  // dans un seul tick (interface figée). On repart du pas courant.
  if (step - e.lastStep > 512) e.lastStep = step - 1;
  if (step < e.lastStep) e.lastStep = step - 1; // horloge reculée / phase modifiée

  const atk = L.mode === 'fade'
    ? Math.min((L.fadeInPct / 100) * stepDur, Math.max(1, L.width) * stepDur) : 0;
  const spk = Math.max(0, Math.min(1, L.sparkle || 0));
  const trigOne = (f, t) => {
    let t2 = t;
    if (atk > 0) { const prev = e.lastEnv.get(f.id) || 0; if (prev > 0.01) t2 = t - atk * Math.min(1, prev); }
    e.triggers.set(f.id, t2);
    // Scintillement : chaque déclenchement tire son propre niveau.
    e.gain.set(f.id, spk > 0 ? 1 - spk * Math.random() : 1);
  };
  const fire = (f, t) => {
    trigOne(f, t);
    if (mh) { const m = nearestTo(2 * ax - posX(f), posY(f), list); if (m) trigOne(m, t); }
    if (mv) { const m = nearestTo(posX(f), 2 * ay - posY(f), list); if (m) trigOne(m, t); }
    if (mh && mv) { const m = nearestTo(2 * ax - posX(f), 2 * ay - posY(f), list); if (m) trigOne(m, t); }
  };
  for (let k = Math.max(0, e.lastStep + 1); k <= step; k++) {
    // « Une fois » : le motif joue un cycle complet puis se tait, jusqu'au
    // prochain GO (resync). Indispensable pour les hits ponctuels.
    if (L.oneShot && k >= cellsPerBlock) break;
    const stepTime = stepStart(k);
    for (const li of targetsAtStep(L, e, k, cellsPerBlock)) {
      for (let b = 0; b < B; b++) {
        const cell = b * cellsPerBlock + li;
        if (cell >= cellCount) continue;
        for (let j = 0; j < g; j++) {
          const f = chaseList[cell * g + j];
          if (f) fire(f, stepTime);
        }
      }
    }
  }
  e.lastStep = step;

  const out = new Map();
  for (const f of list) {
    const trig = e.triggers.get(f.id);
    let v = 0;
    if (trig !== undefined) {
      const env = envelope(L, now - trig, stepDur);
      if (env < 0) { e.triggers.delete(f.id); e.gain.delete(f.id); }
      else v = env * (e.gain.get(f.id) ?? 1);
    }
    e.lastEnv.set(f.id, v);
    out.set(f.id, v);
  }
  return out;
}

/** Moteur vague continue : renvoie Map fixtureId -> valeur 0..1 */
function waveValues(L, list, now, store) {
  const wl = Math.max(0.1, Math.max(1, L.width) / 8); // largeur de vague : 1/8 à 1 de la scène
  const ax = L.axisX ?? 0.5, ay = L.axisY ?? 0.5;
  // Phase intégrée, pas `now / period` : voir phaseContinue().
  const t = phaseContinue(L, now, store).u + (L.phase || 0) / 360;
  const out = new Map();
  for (const f of list) {
    let x = posX(f), y = posY(f);
    if (L.mirrorH) x = Math.abs(x - ax);
    if (L.mirrorV) y = Math.abs(y - ay);
    let proj;
    switch (L.pattern) {
      case 'rl': proj = -x; break;
      case 'tb': proj = y; break;
      case 'bt': proj = -y; break;
      case 'pulse': proj = 0; break;
      case 'radial': { const dx = posX(f) - ax, dy = posY(f) - ay; proj = Math.sqrt(dx * dx + dy * dy); } break;
      default: proj = x; // lr
    }
    const d = (((t - proj / wl) % 1) + 1) % 1;
    let v;
    if (L.waveform === 'triangle') v = 1 - 2 * Math.min(d, 1 - d);
    else if (L.waveform === 'square') v = d < 0.5 ? 1 : 0;
    else v = (1 + Math.cos(2 * Math.PI * d)) / 2; // sine, crête à d=0
    out.set(f.id, v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Moteur « champ 3D » — un effet est une fonction de la POSITION RÉELLE.
//
// Le principe, et la raison pour laquelle ça ne coûte presque rien : on ne
// rastérise aucun volume. On n'a que N points d'intérêt (les barres), donc on
// évalue la fonction directement à ces N points. 128 barres à 40 Hz font 5 120
// évaluations par seconde — négligeable devant les 6 450 messages OSC/s déjà
// tenus en test d'endurance.
//
// Le champ ne produit qu'une grandeur `u`, sans dimension. Ensuite `u` traverse
// EXACTEMENT la même chaîne que les autres moteurs : forme d'onde → inversion →
// niveau bas → niveau → intensité ou mélange de couleurs → HTP → master →
// courbe de gradateur → OSC. Rien de l'acquis v1 n'est réécrit, et c'est ce qui
// rend possible le test de non-régression : un plan sur l'axe X doit rendre les
// mêmes valeurs, au bit près, qu'une vague `lr`.
// ---------------------------------------------------------------------------

/** Vecteur unitaire depuis azimut/élévation en degrés. 0/0 = vers cour (+X). */
function axeDe(azDeg, elDeg) {
  const az = fini(azDeg, 0) * DEG, el = fini(elDeg, 0) * DEG;
  const ce = Math.cos(el);
  return [ce * Math.cos(az), ce * Math.sin(az), Math.sin(el)];
}

/**
 * Bruit 3D à valeurs, interpolé en douceur. Écrit à la main : c'est le seul
 * moyen de garder la promesse « zéro dépendance », et une soixantaine de lignes
 * suffisent pour ce qu'on en attend visuellement (feu, nuages, scintillement
 * organique). Déterministe : le même point au même instant rend la même valeur,
 * donc pas de tremblement parasite entre deux ticks.
 */
function hash3(x, y, z) {
  // Mélange entier, sans état ni table : reproductible d'une machine à l'autre.
  //
  // ⚠ `Math.imul` et non `*` : la multiplication ordinaire se fait en virgule
  // flottante. Or la coordonnée Z porte le TEMPS, qui vaut plusieurs centaines
  // de millions ; multipliée par 2 147 483 647 elle dépasse 2^53, la limite des
  // entiers exacts en double. Les bits de poids faible étaient perdus, donc le
  // hachage ne changeait plus quand le temps avançait : le bruit était GELÉ.
  // Mesuré : une barre à 1,0000 sur huit relevés, étendue 0,0000. Les tests ne
  // l'avaient pas vu parce qu'ils mesuraient la variation entre barres — qui,
  // elle, fonctionnait très bien.
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)
           + Math.imul(z | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const doux = (t) => t * t * (3 - 2 * t);   // lissage cubique
function bruit3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = doux(x - xi), yf = doux(y - yi), zf = doux(z - zi);
  let v = 0;
  for (let dz = 0; dz <= 1; dz++) {
    const wz = dz ? zf : 1 - zf;
    for (let dy = 0; dy <= 1; dy++) {
      const wy = dy ? yf : 1 - yf;
      for (let dx = 0; dx <= 1; dx++) {
        const wx = dx ? xf : 1 - xf;
        v += hash3(xi + dx, yi + dy, zi + dz) * wx * wy * wz;
      }
    }
  }
  return v;
}

/**
 * Étale le bruit sur [0, 1] sans l'écraser aux extrêmes.
 *
 * L'interpolation de huit valeurs tirées au hasard ne donne PAS une loi
 * uniforme : mesuré sur 60 000 tirages, moyenne 0,500 et écart-type 0,181 — donc
 * tout se serre autour du milieu. Sans étalement, un bruit direct donnerait un
 * champ mou et gris.
 *
 * Mais trop étaler est pire. Ma première version divisait par 0,44 : elle
 * saturait **24,5 %** des valeurs à 0 ou à 1, ce qui sur scène ne donne pas du
 * mouvement organique mais du clignotement dur. En prenant ±2 écarts-types on
 * tombe à 3,8 % de saturation : il reste de vrais noirs et de vrais pleins —
 * c'est ce qui fait vivre un feu — sans que le champ passe son temps aux butées.
 */
const BRUIT_MOY = 0.5, BRUIT_EC = 0.1809;
function etaler(v) {
  const r = (v - (BRUIT_MOY - 2 * BRUIT_EC)) / (4 * BRUIT_EC);
  return r < 0 ? 0 : r > 1 ? 1 : r;
}

/**
 * Valeurs du champ, une par barre.
 *
 * ⚠ Le centrage n'est pas décoratif : le champ est centré sur le MILIEU du
 * plateau, à (0, d/2, h/2). C'est ce qui fait qu'un plan sur +X rend `f.x` et
 * qu'un plan vers le bas rend `f.y` — donc que les vagues 2D existantes sont
 * des cas particuliers exacts. Déplacer ce centre casserait la compatibilité
 * sans que rien ne le signale.
 */
function fieldValues(L, list, now, store) {
  const sc = state.scene;
  // Phase intégrée, pas `now / period` : voir phaseContinue().
  const t = phaseContinue(L, now, store).u + (L.phase || 0) / 360;
  const wl = Math.max(0.1, Math.max(1, L.width) / 8);   // même sémantique que `wave`
  const forme = L.field || 'plan';
  const duty = Math.round(cnum(L.duty, 5, 100, 100));
  const a = axeDe(L.axAz, L.axEl);
  // Étendue du plateau le long de l'axe : pour un axe pur on retrouve w, d ou h.
  const ext = Math.max(0.1, Math.abs(a[0]) * sc.w + Math.abs(a[1]) * sc.d + Math.abs(a[2]) * sc.h);
  // Centre du plateau. ⚠ X et Y sont centrés sur ZÉRO — la grille du sol est
  // tracée de -d/2 à +d/2 et un projet v1 migré arrive à y = 0. Seul Z va de 0
  // à h. Prendre d/2 comme centre en profondeur décalait tout le plan d'une
  // demi-profondeur, sans que rien ne le signale.
  const cx = 0, cy = 0, cz = sc.h / 2;
  // Source, éventuellement MOBILE : elle balaie un segment de longueur `course`
  // centré sur sa position, le long de l'axe, une fois par cycle. C'est ce qui
  // fait une comète quand on l'associe à une sphère et à une netteté serrée.
  const course = Math.max(0, fini(L.course, 0));
  const glisse = course ? (t % 1 + 1) % 1 : 0;
  const dep = course ? (glisse - 0.5) * course : 0;
  const src = [fini(L.srcX, 0) + a[0] * dep,
               fini(L.srcY, 0) + a[1] * dep,
               fini(L.srcZ, 2) + a[2] * dep];
  const diag = Math.max(0.1, Math.hypot(sc.w, sc.d, sc.h) / 2);
  // Taille d'une tache de bruit, en mètres. Isotrope par construction.
  const grainBruit = Math.max(0.15, wl * Math.max(sc.w, sc.d, sc.h));
  // Demi-cotes du pavé mobile, en mètres : `width` en règle la taille,
  // proportionnellement au plateau, axe par axe.
  const demiPave = [Math.max(0.05, wl * sc.w / 2),
                    Math.max(0.05, wl * sc.d / 2),
                    Math.max(0.05, wl * sc.h / 2)];

  // Base orthonormée perpendiculaire à l'axe, pour mesurer l'angle du cylindre.
  // Calculée UNE fois : elle ne dépend que de l'axe, pas de la barre. La laisser
  // dans la boucle coûtait une vingtaine d'opérations par barre et par image —
  // 128 barres à 40 Hz, c'est cent mille opérations par seconde pour rien.
  //
  // ⚠ Le vecteur de départ est choisi selon la plus petite composante de l'axe :
  // en prendre un colinéaire annulerait le produit vectoriel et l'angle
  // deviendrait n'importe quoi. C'est le piège des pôles.
  let u1 = null, u2 = null, tours = 1;
  if (forme === 'cylindre') {
    // Base orthonormée perpendiculaire à l'axe, construite ANALYTIQUEMENT depuis
    // l'azimut. `u1 = (-sin az, cos az, 0)` est perpendiculaire à l'axe quel que
    // soit l'élévation (le produit scalaire se simplifie à zéro), unitaire
    // partout, et surtout CONTINU — y compris aux pôles.
    //
    // ⚠ La version précédente choisissait un vecteur de référence selon
    // `|a[2]| < 0.9`. Mesuré : entre 64° et 65° d'élévation la base s'inversait
    // et le faisceau sautait d'un demi-tour — 0,98 d'écart sur une barre pour
    // un degré. Et le correctif « prendre toujours (0,0,1) » qu'on m'a proposé
    // aurait dégénéré à l'aplomb : le produit vectoriel s'annule quand l'axe est
    // vertical, et le champ serait devenu uniforme. D'où cette construction, qui
    // n'a de cas dégénéré nulle part.
    const az = fini(L.axAz, 0) * DEG;
    u1 = [-Math.sin(az), Math.cos(az), 0];
    u2 = [a[1] * u1[2] - a[2] * u1[1], a[2] * u1[0] - a[0] * u1[2], a[0] * u1[1] - a[1] * u1[0]];
    // L'angle est CYCLIQUE : au raccord, `u` saute de 1 à 0, donc la phase saute
    // de 1/wl. Ce saut n'est invisible que s'il vaut un nombre ENTIER de cycles.
    // Mesuré avant correction : à width 3, deux barres voisines de 10° sautaient
    // de 0,918 alors que l'écart médian était de 0,168 — le faisceau se déchirait
    // à un angle fixe. On arrondit donc à un nombre entier de faisceaux.
    tours = Math.max(1, Math.round(1 / wl));
  }
  // Décalage de phase RÉPARTI sur la sélection — l'idée des MAtricks de
  // grandMA. `phase` décale toute la couche ; `spread` étale en plus un décalage
  // de la première barre à la dernière. C'est ce qui empêche des barres
  // symétriques de bouger à l'unisson, et ça suit l'ordre de la sélection — donc
  // l'ordre géométrique si « ordre = axe 3D » est coché.
  const etale = fini(L.spread, 0) / 360;
  const denom = Math.max(1, list.length - 1);
  const out = new Map();

  let idx = -1;
  for (const f of list) {
    idx++;
    const tf = etale ? t + etale * (idx / denom) : t;
    const p = f.p3 || [0, 0, 0];
    let u;
    switch (forme) {
      case 'sphere': {
        // Ondes concentriques depuis un point : le « radial » en volume.
        u = Math.hypot(p[0] - src[0], p[1] - src[1], p[2] - src[2]) / diag;
        break;
      }
      case 'cylindre': {
        // Phare : l'angle autour de l'axe. Un cycle du champ = un tour complet.
        const d0 = [p[0] - src[0], p[1] - src[1], p[2] - src[2]];
        const long = d0[0] * a[0] + d0[1] * a[1] + d0[2] * a[2];
        // composante perpendiculaire à l'axe
        const q = [d0[0] - long * a[0], d0[1] - long * a[1], d0[2] - long * a[2]];
        const ang = Math.atan2(q[0] * u2[0] + q[1] * u2[1] + q[2] * u2[2],
                               q[0] * u1[0] + q[1] * u1[1] + q[2] * u1[2]);
        u = (ang / (2 * Math.PI) + 1) % 1;
        break;
      }
      case 'boite': {
        // Pavé MOBILE : on ne mesure pas une distance, on teste l'APPARTENANCE
        // à un volume qui traverse le plateau une fois par cycle, le long de
        // l'axe. Un bloc de barres s'allume et se déplace, avec des bords francs.
        //
        // ⚠ La version précédente mesurait une distance de Tchebychev, ce qui
        // donnait des coques rectangulaires. Sur un rig PLAN — le cas courant —
        // toutes les barres partagent leur profondeur et leur hauteur, si bien
        // que la distance se réduisait à |dx| : la boîte redevenait la sphère à
        // un facteur près et les deux formes ne se distinguaient plus à l'œil.
        // Le pavé, lui, ne ressemble à aucune autre forme, même sur une ligne.
        const trav = ((((tf % 1) + 1) % 1) - 0.5) * ext;
        const q = Math.max(
          Math.abs(p[0] - (src[0] + a[0] * trav)) / demiPave[0],
          Math.abs(p[1] - (src[1] + a[1] * trav)) / demiPave[1],
          Math.abs(p[2] - (src[2] + a[2] * trav)) / demiPave[2]);
        // Netteté : à 100 les bords sont francs ; en deçà le pavé garde un
        // cœur plein et s'estompe vers l'extérieur.
        const coeur = duty / 100;
        out.set(f.id, q <= coeur ? 1 : (q >= 1 ? 0 : 1 - (q - coeur) / (1 - coeur)));
        continue;
      }
      case 'bruit': {
        // Le bruit rend DÉJÀ une valeur : il ne traverse pas la forme d'onde,
        // sinon on obtiendrait de la bouillie. `width` règle la finesse du grain.
        //
        // ⚠ Le grain est normalisé sur la plus grande cote du plateau, pas sur
        // `ext` : `ext` dépend de l'axe, si bien que changer l'azimut changeait la
        // taille des taches de 20 % sans qu'aucun réglage visible ne l'explique.
        //
        // Et la dérive suit maintenant l'AXE, au lieu de descendre toujours selon
        // Z : un feu qui descend, ce n'est pas un feu. Le motif avance d'un grain
        // par cycle dans la direction de l'axe.
        const k = 1 / grainBruit;
        const gf = tf * grainBruit;
        out.set(f.id, etaler(bruit3((p[0] + a[0] * gf) * k,
                                    (p[1] + a[1] * gf) * k,
                                    (p[2] + a[2] * gf) * k)));
        continue;
      }
      default: {   // plan / balayage
        u = ((p[0] - cx) * a[0] + (p[1] - cy) * a[1] + (p[2] - cz) * a[2]) / ext + 0.5;
        break;
      }
    }
    // Le cylindre compte en TOURS entiers (voir plus haut) ; les autres formes
    // divisent par la longueur d'onde.
    const cyclique = forme === 'cylindre';
    // Miroir : exactement ce que fait la vague — replier la projection autour
    // d'un axe (`x = |x - axe|`). Le motif part alors de l'axe et s'écarte des
    // deux côtés à la fois. Sur une sphère ça donne une coque à mi-distance,
    // sur un cylindre deux faisceaux symétriques.
    //
    // ⚠ Il n'y a qu'UN repli, parce qu'un champ ne produit qu'une grandeur : le
    // « miroir ↕ » de la vague replie la seconde coordonnée, qui n'existe pas
    // ici. L'interface le masque donc pour ce moteur, plutôt que d'afficher une
    // case sans effet.
    if (L.mirrorH) u = Math.abs(u - (L.axisX ?? 0.5));
    const d = (((tf - (cyclique ? u * tours : u / wl)) % 1) + 1) % 1;
    let v;
    if (duty >= 100) {
      // Chemin d'origine, laissé intact au bit près : c'est lui que le test de
      // non-régression compare à la vague, et la netteté par défaut vaut 100.
      if (L.waveform === 'triangle') v = 1 - 2 * Math.min(d, 1 - d);
      else if (L.waveform === 'square') v = d < 0.5 ? 1 : 0;
      else v = (1 + Math.cos(2 * Math.PI * d)) / 2;
    } else {
      // Netteté : le motif n'occupe plus qu'une part de sa longueur d'onde, et
      // le reste est noir. `dd` est la distance à la crête, de 0 à 0,5.
      const dd = Math.min(d, 1 - d);
      const demi = duty / 200;
      if (dd >= demi) v = 0;
      else {
        const q = dd / demi;      // 0 sur la crête, 1 au bord de la bande
        v = L.waveform === 'square' ? 1
          : L.waveform === 'triangle' ? 1 - q
          : (1 + Math.cos(Math.PI * q)) / 2;
      }
    }
    out.set(f.id, v);
  }
  return out;
}

// Couleurs
function hexToRgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
  if (!m) return [1, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
/**
 * Couleur d'une couche pour une valeur de 0 à 1.
 *
 * Deux couleurs seulement, c'était la limite la plus visible du moteur : tout
 * dégradé devait passer par le mélange des deux extrêmes. Impossible de faire un
 * feu — noir, rouge sombre, orange, jaune, blanc — ni une rampe froide à trois
 * teintes. La spéc en faisait « l'écart visuel principal avec les consoles
 * classiques ».
 *
 * `palette` prend le dessus dès qu'elle a au moins deux arrêts. Sans elle, on
 * retombe exactement sur colorA → colorB : aucun projet existant ne bouge.
 */
function mixColor(L, v, f) {
  // D'où vient la position dans la palette ? Par défaut du motif (la valeur
  // calculée). Mais la brancher sur la PROFONDEUR ou la HAUTEUR est ce qui fait
  // lire un volume par la couleur : chaud près, froid loin. L'œil juge la
  // distance autant par la teinte que par l'intensité — c'est la seconde moitié
  // du depth-cue, et ça ne coûte qu'une substitution.
  const src = L.palSrc || 'motif';
  if (src !== 'motif' && f && f.p3) {
    const sc = state.scene;
    v = src === 'prof' ? Math.min(1, Math.max(0, (f.p3[1] + sc.d / 2) / Math.max(0.1, sc.d)))
                       : Math.min(1, Math.max(0, f.p3[2] / Math.max(0.1, sc.h)));
  }
  const pal = Array.isArray(L.palette) && L.palette.length >= 2 ? L.palette : null;
  if (!pal) {
    const a = hexToRgb(L.colorA), b = hexToRgb(L.colorB);
    return [a[0] + (b[0] - a[0]) * v, a[1] + (b[1] - a[1]) * v, a[2] + (b[2] - a[2]) * v];
  }
  const t = Math.max(0, Math.min(1, v)) * (pal.length - 1);
  const i = Math.min(pal.length - 2, Math.floor(t));
  const k = t - i;
  const a = hexToRgb(pal[i]), b = hexToRgb(pal[i + 1]);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** Palettes prêtes à l'emploi — celles qu'on refait à la main sinon. */
const PALETTES = {
  feu:     ['#000000', '#4a0a00', '#c43a00', '#ff8c00', '#ffd966', '#ffffff'],
  glace:   ['#000814', '#003566', '#0077b6', '#48cae4', '#ade8f4'],
  couche:  ['#12005e', '#6a00a8', '#c9184a', '#ff7b00', '#ffd400'],
  foret:   ['#03110a', '#0b3d20', '#2d6a4f', '#74c69d', '#d8f3dc'],
  // Chaud près, froid loin : à brancher sur la profondeur pour que l'œil lise
  // la distance par la couleur autant que par l'intensité.
  distance: ['#ffb703', '#fb8500', '#8ecae6', '#219ebc', '#023047'],
};

// Courbe de gradateur : les LED DMX ne réagissent pas linéairement. « Carrée »
// donne des bas de fondu bien plus fins, « racine » remonte les niveaux bas.
const DIMMERS = {
  linear: v => v,
  square: v => v * v,
  sqrt: v => Math.sqrt(v),
};

// Envoi (avec cache anti-spam + keep-alive 1 s)
const lastLum = new Map(), lastRGB = new Map();
let lastForceAll = 0;
const runtime = { levels: [], colors: [] }; // pour la préview web

function q255(v) { return Math.round(Math.max(0, Math.min(1, v)) * 255) / 255; }
function sendLum(f, v, force) {
  // Sans adresse, il n'y a rien à piloter. Avant l'audit de la 2.0.0, une
  // fixture sans adresse envoyait `/luminosity` — un message à la racine de
  // MadMapper, adressé à personne en particulier.
  if (!f.address) return;
  const q = q255(v);
  if (lastLum.get(f.id) !== q || force) {
    oscSend(`${f.address}/${state.global.param}`, [{ type: 'f', value: q }]);
    lastLum.set(f.id, q);
  }
}
function sendRGB(f, c, force) {
  if (!f.address) return;
  const q = c.map(q255);
  const last = lastRGB.get(f.id);
  if (!last || last[0] !== q[0] || last[1] !== q[1] || last[2] !== q[2] || force) {
    oscSend(`${f.address}/color/red`, [{ type: 'f', value: q[0] }]);
    oscSend(`${f.address}/color/green`, [{ type: 'f', value: q[1] }]);
    oscSend(`${f.address}/color/blue`, [{ type: 'f', value: q[2] }]);
    lastRGB.set(f.id, q);
  }
}

/**
 * Quelles barres cette couche pilote-t-elle ?
 *  - `groupId` posé  → les barres du groupe (lien vivant : éditer le groupe
 *    met à jour toutes les couches qui le suivent) ;
 *  - sinon `bars`    → sélection manuelle ;
 *  - sinon           → toutes les barres actives.
 * Un groupe disparu ou vidé ramène la couche sur toutes les barres : mieux
 * vaut une couche qui éclaire trop qu'une couche muette sans explication.
 */
function resolveBars(L, enabled) {
  if (L.groupId) {
    const g = state.groups.find(x => x.id === L.groupId);
    if (g && g.bars.length) {
      const dans = enabled.filter(f => g.bars.includes(f.id));
      if (dans.length) return dans;
    }
    return enabled;
  }
  return Array.isArray(L.bars) ? enabled.filter(f => L.bars.includes(f.id)) : enabled;
}

/** Calcule le mix d'un jeu de couches : intensité (HTP) et couleur par fixture.
 *  Isolé pour pouvoir évaluer DEUX scènes dans le même tick pendant un fondu. */
/**
 * Modes de fusion entre couches — l'équivalent des « Mix modes » de Madrix.
 *
 * Cascade ne savait faire que du HTP (le plus fort gagne). C'est le réflexe des
 * consoles lumière, et c'est juste pour empiler des chases — mais ça interdit
 * tout ce qui fait la richesse d'un compositeur : masquer une couche par une
 * autre, additionner deux nappes, creuser un trou dans un fond.
 *
 * `htp` reste le défaut : tous les projets existants gardent leur rendu.
 *
 * ⚠ L'ordre des couches compte pour tous les modes SAUF htp, add et mul, qui
 * sont commutatifs. C'est écrit dans l'interface, parce qu'un mode où l'ordre
 * compte sans qu'on le sache est une source d'incompréhension sans fin.
 */
const FUSIONS = {
  htp:    (a, b) => Math.max(a, b),          // le plus fort gagne (défaut, v1)
  add:    (a, b) => Math.min(1, a + b),      // les nappes s'additionnent
  mul:    (a, b) => a * b,                   // b masque a : le noir de b creuse
  screen: (a, b) => 1 - (1 - a) * (1 - b),   // éclaircit sans jamais brûler
  min:    (a, b) => Math.min(a, b),          // ne garde que l'intersection
  sub:    (a, b) => Math.max(0, a - b),      // b creuse un trou dans a
  remp:   (a, b) => b,                       // la dernière couche remplace
};

/**
 * Perspective atmosphérique — ce qui fait VRAIMENT ressortir la profondeur.
 *
 * L'œil lit la profondeur d'abord par l'atténuation : ce qui est loin est plus
 * sombre et moins contrasté. C'est ce que Smode appelle le depth-cue et ce que
 * tout moteur 3D fait avec du brouillard. Sur un plateau, deux barres identiques
 * à cinq mètres l'une derrière l'autre se lisent comme une seule surface si
 * elles sortent au même niveau — et le volume disparaît.
 *
 * `prof` est la force, en pourcentage : à 100, la barre du lointain est éteinte.
 * On travaille sur la profondeur NORMALISÉE par la cote du plateau, pas sur des
 * mètres absolus : le réglage garde son sens quand on change de salle.
 */
function attenuationProfondeur(f, force, scene) {
  if (!force) return 1;
  const d = Math.max(0.1, scene.d);
  const p = f.p3 ? f.p3[1] : 0;
  // Y est centré sur zéro : -d/2 = face, +d/2 = lointain.
  const u = Math.min(1, Math.max(0, (p + d / 2) / d));
  return 1 - (force / 100) * u;
}

/**
 * Poids d'une couche selon le crossfader.
 *
 * L'outil de conduite de Madrix, et la différence entre DÉCLENCHER et JOUER :
 * un rappel de preset est un saut, un crossfader se tient à la main. On range
 * les couches en deux jeux, et le fader passe de l'un à l'autre.
 *
 * Une couche sans jeu (`deck: null`) vaut toujours 1 : c'est le défaut, donc
 * aucun projet existant ne change de rendu.
 */
function poidsDeck(L) {
  if (L.deck !== 'a' && L.deck !== 'b') return 1;
  const x = Math.max(0, Math.min(1, fini(globalEff('xfade'), 0)));
  return L.deck === 'a' ? 1 - x : x;
}

function computeMix(layers, fixtures, now, store) {
  const enabled = fixtures.filter(f => f.enabled !== false);
  const parId = new Map(enabled.map(f => [f.id, f]));
  const lum = new Map(), col = new Map();
  let anyInt = false, anyCol = false;
  for (const L0 of layers) {
    if (!L0.enabled) continue;
    // La couche vue par le moteur est la couche MODULÉE. `L0` reste intacte.
    const L = appliquerLFO(L0, now, store);
    const poids = poidsDeck(L);
    // À poids nul la couche n'a AUCUN effet — pas même un masque noir. C'est ce
    // que donne aussi la formule ci-dessous, mais autant ne pas calculer.
    if (poids === 0) continue;
    const list = resolveBars(L, enabled);
    if (!list.length) continue;
    const vals = L.engine === 'field' ? fieldValues(L, list, now, store)
      : L.engine === 'wave' ? waveValues(L, list, now, store)
      : stepValues(L, list, now, store);
    const flr = Math.max(0, Math.min(1, L.floor || 0));
    for (const [id, v0] of vals) {
      let v = Math.max(0, Math.min(1, v0));
      if (L.invert) v = 1 - v;
      // Niveau bas : le chase court AU-DESSUS d'un fond allumé, au lieu de
      // partir du noir (usage classique en spectacle).
      if (flr > 0) v = flr + (1 - flr) * v;
      v *= (typeof L.level === 'number' ? L.level : 1);
      // Perspective atmosphérique, appliquée APRÈS le niveau de couche : c'est
      // une propriété de l'espace, pas du motif.
      if (L.prof) v *= attenuationProfondeur(parId.get(id) || {}, L.prof, state.scene);
      const fusion = FUSIONS[L.blend] || FUSIONS.htp;
      // Le poids du crossfader s'applique SUR LE RÉSULTAT DE LA FUSION, pas sur
      // la valeur : `fond + poids × (fusion − fond)`. C'est la seule forme
      // correcte pour les sept modes à la fois. Sur la valeur, une couche en
      // multiplication tombée à zéro deviendrait un masque NOIR et éteindrait
      // tout ce qui est dessous — l'inverse de ce qu'on demande à un fader qu'on
      // baisse. Ici, à poids nul, le fond ressort intact quel que soit le mode.
      const doser = (fond, apres) => fond + poids * (apres - fond);
      if (L.target === 'color') {
        anyCol = true;
        const c = mixColor(L, v, parId.get(id));
        const cur = col.get(id);
        col.set(id, cur
          ? [doser(cur[0], fusion(cur[0], c[0])), doser(cur[1], fusion(cur[1], c[1])),
             doser(cur[2], fusion(cur[2], c[2]))]
          : [c[0] * poids, c[1] * poids, c[2] * poids]);
      } else {
        anyInt = true;
        // ⚠ `lum.has(id)` et pas `|| 0` : pour `mul` et `min`, un fond absent
        // vaut 1 (rien ne masque), pas 0 — sinon la première couche en mode
        // multiplicatif s'annulerait elle-même et on croirait à une panne.
        lum.set(id, lum.has(id) ? doser(lum.get(id), fusion(lum.get(id), v)) : v * poids);
      }
    }
  }
  return { lum, col, anyInt, anyCol };
}
/** Niveau d'une fixture dans un mix, avant master et courbe.
 *  Couches couleur seules : l'intensité est tenue à fond pour voir la couleur. */
/**
 * Intensité à envoyer pour une barre, une fois toutes les couches mélangées.
 *
 * ⚠ Le `mix.col.has(id)` n'est pas décoratif. Une couche « couleur » ne pilote
 * pas l'intensité : il faut bien ouvrir le gradateur pour qu'on voie sa teinte.
 * Mais l'ouvrir pour TOUTES les barres — ce que faisait `mix.anyCol ? 1 : 0` —
 * allumait à pleine intensité celles que la couche ne pilote même pas.
 * Mesuré sur une couche couleur limitée à deux barres sur six : les quatre
 * autres sortaient à 1. Sur scène, c'est un plein feu involontaire.
 * Défaut présent depuis la v1.
 */
/**
 * Niveau d'une fixture dans un mix, avant master et courbe.
 *
 * ⚠ La décision se prend PAR BARRE, jamais globalement. La version précédente
 * testait `mix.anyInt` — vrai dès qu'une couche d'intensité existait N'IMPORTE
 * OÙ — puis lisait `lum.get(id) || 0`. Conséquence mesurée : un wash de couleur
 * sur les contres s'éteignait d'un coup dès qu'on ajoutait un chase sur les
 * barres du sol. Les contres n'étaient dans aucune couche d'intensité, donc
 * absents de `lum`, donc noirs — alors qu'une couche couleur les pilotait.
 */
function mixLevel(mix, id) {
  if (mix.lum.has(id)) return mix.lum.get(id);
  // Pilotée seulement en couleur : on tient l'intensité à fond, sinon la
  // couleur ne se verrait pas. C'est la règle v1, appliquée barre par barre.
  return mix.col.has(id) ? 1 : 0;
}

function tick() {
  const now = Date.now();
  // À l'arrêt, Cascade RELÂCHE le contrôle : plus aucun message OSC n'est envoyé.
  // Les fixtures gardent la dernière valeur reçue (pas de noir).
  // Seul BLACKOUT force explicitement l'extinction.
  if (!state.global.running) {
    runtime.levels = state.fixtures.map(f => lastLum.get(f.id) || 0);
    runtime.colors = state.fixtures.map(() => null);
    return;
  }
  // Le modulateur global d'abord : tout ce qui suit lit des réglages qu'il
  // peut piloter. Après le retour anticipé de l'arrêt, donc il ne tourne pas
  // dans le vide et STOP relâche vraiment tout.
  calculerModGlobal(now);
  const live = computeMix(state.layers, state.fixtures, now, engines);

  // Fondu entre presets : la scène sortante continue de tourner et décroît
  // pendant que la nouvelle monte. Mélange linéaire — c'est ce qu'attend un
  // opérateur lumière d'un crossfade.
  let sortante = null, t = 1;
  if (fade) {
    t = fade.dur > 0 ? (now - fade.start) / fade.dur : 1;
    if (t >= 1) { fade = null; t = 1; }
    else sortante = computeMix(fade.layers, fade.fixtures, now, fade.engines);
  }

  const force = now - lastForceAll > 1000;
  if (force) lastForceAll = now;
  const m = globalEff('master');
  const dim = DIMMERS[state.global.dimmer] || DIMMERS.linear;
  runtime.levels = []; runtime.colors = [];
  for (const f of state.fixtures) {
    let v = mixLevel(live, f.id);
    let c = live.col.get(f.id) || null;
    if (sortante) {
      const vo = mixLevel(sortante, f.id);
      v = vo + (v - vo) * t;
      const co = sortante.col.get(f.id);
      // Les deux côtés ont une couleur : on interpole. Un seul : il garde la
      // main (sinon la barre virerait vers une teinte qui n'existe nulle part).
      if (c && co) c = [0, 1, 2].map(k => co[k] + (c[k] - co[k]) * t);
      else if (co) c = co;
    }
    v = dim(v * m);
    sendLum(f, v, force);
    if (c) sendRGB(f, c, force);
    runtime.levels.push(lastLum.get(f.id) || 0);
    runtime.colors.push(c ? c.map(x => Math.round(x * 255)) : null);
  }
}
setInterval(() => { try { tick(); } catch (e) { console.error('[cascade] erreur moteur :', e.message); } }, 25);
sendSock.on('error', (e) => console.error('[cascade] envoi OSC :', e.message));

/** Les caches sont indexés par id de fixture : après un changement de scéno,
 *  les ids disparus resteraient en mémoire pour toujours. */
function pruneCaches() {
  const alive = new Set(state.fixtures.map(f => f.id));
  for (const map of [lastLum, lastRGB]) {
    for (const id of map.keys()) if (!alive.has(id)) map.delete(id);
  }
  for (const e of engines.values()) {
    for (const map of [e.triggers, e.lastEnv, e.gain]) {
      for (const id of map.keys()) if (!alive.has(id)) map.delete(id);
    }
  }
}

/** Vide le cache anti-spam : le prochain tick réaffirme TOUTES les valeurs.
 *  Indispensable quand la cible change (sinon MadMapper ne reçoit jamais la
 *  valeur courante sur le nouveau paramètre) et au démarrage d'un show. */
function forceResend() { lastLum.clear(); lastRGB.clear(); }

function startChase() {
  engines.clear();
  cancelFade();
  forceResend();
  state.global.running = true;
}
function stopChase() { state.global.running = false; engines.clear(); cancelFade(); }
function blackout() {
  stopChase();
  for (const f of state.fixtures) {
    oscSend(`${f.address}/${state.global.param}`, [{ type: 'f', value: 0 }]);
    lastLum.set(f.id, 0);
  }
}

// ---------------------------------------------------------------------------
// Tap tempo (par couche)
// ---------------------------------------------------------------------------
const tapsByLayer = new Map();
function tap(layerId) {
  const L = state.layers.find(l => l.id === layerId) || state.layers[0];
  if (!L) return 0;
  if (link.active) return L.stepMs; // Link pilote le tempo : le tap est neutralisé
  const now = Date.now();
  let taps = tapsByLayer.get(L.id) || [];
  if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
  taps.push(now);
  if (taps.length > 8) taps.shift();
  tapsByLayer.set(L.id, taps);
  if (taps.length >= 2) {
    const intervals = taps.slice(1).map((t, i) => t - taps[i]);
    L.stepMs = Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length);
    saveConfig();
  }
  return L.stepMs;
}

// ---------------------------------------------------------------------------
// Serveur HTTP + API
// ---------------------------------------------------------------------------
const MAX_BODY = 4e6; // un projet avec 128 fixtures + 16 presets tient largement
function readBody(req) {
  return new Promise((resolve) => {
    let data = '', done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    req.on('data', c => {
      data += c;
      if (data.length > MAX_BODY) { data = ''; req.destroy(); finish({}); }
    });
    req.on('end', () => { try { finish(JSON.parse(data || '{}')); } catch (e) { finish({}); } });
    // Sans ces deux gardes, une requête coupée laissait la promesse en suspens
    // pour toujours (handler bloqué, socket jamais refermée).
    req.on('error', () => finish({}));
    req.on('aborted', () => finish({}));
  });
}
function json(res, obj, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/' || url === '/index.html') {
    fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, buf) => {
      if (err) { res.writeHead(500); return res.end('public/index.html introuvable'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buf);
    });
    return;
  }

  // Sert à repérer qu'une autre instance de Cascade tient déjà le port.
  if (url === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ app: APP_NAME, version: VERSION }));
  }

  if (url === '/api/export') {
    const { running, ...global } = state.global;
    dirtySinceExport = false; lastExportAt = Date.now();
    // Nom de fichier tiré du projet (ASCII sûr pour l'en-tête HTTP).
    const safeName = (state.projectName || 'projet').normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 40) || 'projet';
    res.writeHead(200, { 'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${safeName}.json"` });
    return res.end(JSON.stringify({
      app: 'cascade', version: 3, date: new Date().toISOString(),
      projectName: state.projectName,
      fixtures: state.fixtures, groups: state.groups,
      // ⚠ `scene` et `vues` DOIVENT voyager : la scène porte les cotes du
      // plateau dont toute la 3D dérive, les vues portent les noms des dossiers
      // MadMapper. Leur absence de l'export était invisible parce que
      // `/api/new` ne les réinitialisait pas — un test passait donc pour de
      // mauvaises raisons.
      scene: state.scene, vues: state.vues,
      layers: state.layers, global, presets: state.presets,
    }, null, 2));
  }

  if (url === '/api/state') {
    lastUiPollAt = Date.now(); // une interface est ouverte (voir arrêt automatique)
    return json(res, {
      app: APP_NAME, version: VERSION, net: lanUrls(),
      settings: state.settings, scene: state.scene, vues: state.vues,
      fixtures: state.fixtures, groups: state.groups,
      layers: state.layers, global: state.global,
      presets: presetNames(),
      midiMap: state.midiMap,
      link: { active: link.active, connected: link.connected, bpm: link.bpm, peers: link.peers,
              error: link.error,
              // Synchro de phase : `phase` = position dans la mesure (0-1),
              // `locked` = la grille est fraîche et exploitable.
              phaseOn: !!state.settings.linkPhase, quantum: state.settings.linkQuantum || 4,
              locked: !!linkGrid(Date.now()), phase: linkPhase() },
      mm: { alive: mmAlive(), socketOk: mm.socketOk, error: mm.error,
            host: state.settings.mmHost, port: state.settings.mmPort },
      // Progression du fondu entre presets (0-1), pour l'afficher en direct
      fade: fade ? Math.min(1, (Date.now() - fade.start) / fade.dur) : null,
      project: { name: state.projectName, dirty: dirtySinceExport, lastExportAt },
      levels: runtime.levels, colors: runtime.colors,
    });
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    switch (url) {
      case '/api/layer': {
        const L = state.layers.find(l => l.id === body.id);
        if (!L) return json(res, { ok: false });
        Object.assign(L, sanitizeLayerSet(body.set));
        saveConfig();
        return json(res, { ok: true, layer: L });
      }
      case '/api/layers': {
        if (body.action === 'add' && state.layers.length < MAX_LAYERS) {
          state.layers.push(defaultLayer());
        } else if (body.action === 'remove' && state.layers.length > 1) {
          state.layers = state.layers.filter(l => l.id !== body.id);
          engines.delete(body.id);
        }
        saveConfig();
        return json(res, { ok: true, layers: state.layers });
      }
      case '/api/global': {
        const oldParam = state.global.param;
        Object.assign(state.global, sanitizeGlobal(body));
        if (state.global.param !== oldParam) forceResend();
        saveConfig();
        return json(res, { ok: true, global: state.global });
      }
      case '/api/preset': {
        const i = Math.max(0, Math.min(PRESET_SLOTS - 1, body.slot | 0));
        if (body.action === 'save') state.presets[i] = savePreset(i, body.name);
        else if (body.action === 'recall') recallPreset(i, body.fadeMs);
        else if (body.action === 'clear') state.presets[i] = null;
        else if (body.action === 'rename' && state.presets[i]) {
          const n = String(body.name || '').trim().slice(0, 16);
          state.presets[i].name = n || 'P' + (i + 1);
        }
        saveConfig();
        return json(res, { ok: true, presets: presetNames(), layers: state.layers, fixtures: state.fixtures });
      }
      case '/api/scene': {
        // Redimensionner le plateau ne DÉPLACE rien : les barres gardent leurs
        // mètres, seule leur projection 2D change. C'est le comportement voulu.
        if (body.scene) {
          state.scene = sanitizeScene(body.scene);
          for (const f of state.fixtures) derive2D(f);
          saveConfig();
        }
        return json(res, { ok: true, scene: state.scene, fixtures: state.fixtures });
      }
      case '/api/fixture3d': {
        // Déplacement de barres dans l'espace, en mètres. Une seule barre
        // (`id`) ou un lot (`fixtures`) — le lot sert à défaire un déplacement
        // d'un coup, sans état intermédiaire visible dans la vue.
        const lot = Array.isArray(body.fixtures) ? body.fixtures.slice(0, MAX_FIXTURES)
          : [{ id: body.id, p3: body.p3, dir3: body.dir3,
               len3: 'len3' in body ? body.len3 : undefined,
               ...('inverse' in body ? { inverse: body.inverse } : {}) }];
        const touchees = [];
        for (const item of lot) {
          if (!item || typeof item !== 'object') continue;
          const f = state.fixtures.find(x => x.id === item.id);
          if (!f) continue;
          const p = Array.isArray(item.p3) && item.p3.length === 3 ? item.p3 : f.p3;
          const d = Array.isArray(item.dir3) && item.dir3.length === 3 ? item.dir3 : f.dir3;
          set3D(f, p, d, item.len3 === undefined ? f.len3 : item.len3);
          if ('inverse' in item) f.inverse = !!item.inverse;
          touchees.push(f);
        }
        if (!touchees.length) return json(res, { ok: false });
        saveConfig();
        return json(res, { ok: true, fixture: touchees[0], fixtures: touchees });
      }
      case '/api/demo': {
        // Presets de DÉMONSTRATION du champ 3D.
        //
        // Sans eux, basculer sur « Champ 3D » ne change rien à l'écran : le
        // réglage par défaut (plan, azimut 0) rend exactement la vague « G › D »,
        // et un projet v1 migré a toutes ses barres à la même profondeur. Le
        // régisseur voit cinq nouveaux réglages apparaître et la lumière ne
        // bouger d'un iota — la pire première impression possible.
        //
        // ⚠ Ils REMPLACENT les couches courantes : c'est destructif, donc
        // l'interface demande confirmation, et rien n'est envoyé sans clic.
        const sc = state.scene;
        const demos = [
          { name: 'Profondeur', engine: 'field', field: 'plan', axAz: 90, axEl: 0,
            width: 6, duty: 45, stepMs: 900, mode: 'fade', level: 1,
            colorA: '#ff6a00', colorB: '#ffd400' },
          { name: 'Comète', engine: 'field', field: 'sphere', axAz: 0, axEl: 0,
            srcX: 0, srcY: sc.d / 2, srcZ: sc.h / 2, course: Math.max(4, sc.w),
            width: 8, duty: 22, stepMs: 1400, mode: 'fade', level: 1 },
          { name: 'Phare', engine: 'field', field: 'cylindre', axAz: 0, axEl: 90,
            srcX: 0, srcY: 0, srcZ: sc.h / 2, width: 2, duty: 30,
            stepMs: 2200, mode: 'fade', level: 0.9 },
          { name: 'Feu', engine: 'field', field: 'bruit', axAz: 0, axEl: 90,
            width: 2, stepMs: 2600, mode: 'fade', level: 1,
            target: 'color', colorA: '#3a0a00', colorB: '#ffb300' },
        ];
        stopChase();
        state.layers = demos.map((d, i) => {
          const L = defaultLayer(d.name);
          Object.assign(L, sanitizeLayerSet({ ...d, enabled: i === 0 }));
          L.name = d.name;
          return L;
        });
        layerSeq = state.layers.length + 1;
        engines.clear();
        saveConfig();
        console.log('[cascade] presets de démonstration du champ 3D chargés');
        return json(res, { ok: true, layers: state.layers,
          noms: state.layers.map(l => l.name) });
      }
      case '/api/vues': {
        // Créer, renommer, supprimer une vue. Rien n'est envoyé à MadMapper ici.
        if (body.action === 'add' && state.vues.length < MAX_VUES) {
          state.vues = sanitizeVues([...state.vues, {
            name: body.name, dossier: body.dossier, manuelle: body.manuelle,
            projection: body.projection, axAz: body.axAz, axEl: body.axEl }]);
        } else if (body.action === 'remove') {
          state.vues = state.vues.filter(v => v.id !== String(body.id || ''));
          if (state.global.vueActive === body.id) state.global.vueActive = null;
        } else if (body.action === 'set') {
          state.vues = sanitizeVues(state.vues.map(v =>
            v.id === String(body.id || '') ? { ...v, ...(body.set || {}), id: v.id } : v));
        } else if (Array.isArray(body.vues)) {
          state.vues = sanitizeVues(body.vues);
        }
        saveConfig();
        return json(res, { ok: true, vues: state.vues });
      }
      case '/api/vue': {
        // Bascule. `id` null ou inconnu = tout éteindre.
        const r = activerVue(body.id == null ? null : String(body.id),
          body.fadeMs == null ? state.global.presetFade : body.fadeMs);
        return json(res, { ok: true, vueActive: state.global.vueActive, ...r });
      }
      case '/api/vuecheck': {
        // Les dossiers déclarés existent-ils vraiment dans MadMapper ?
        // Lecture seule : rien n'est écrit. C'est le voyant qui évite la panne
        // fantôme « la vue ne pilote rien parce que le nom ne correspond pas ».
        const trouves = await listerDossiers(2000);
        const etat = state.vues.map(v => ({
          id: v.id, name: v.name, dossier: v.dossier,
          existe: v.dossier ? trouves.includes(v.dossier) : false,
        }));
        return json(res, { ok: true, vues: etat, trouves,
          repond: trouves.length > 0 || mmAlive() });
      }
      case '/api/coupure': {
        // COUPURE GÉNÉRALE — le noir de secours du régime texture.
        //
        // Quand une texture joue dans MadMapper, Cascade ne pilote que le
        // `luminosity` des barres qu'il connaît : il ne peut couper que
        // celles-là. `master_dmx_level` coupe TOUT, y compris les fixtures que
        // Cascade n'a jamais vues. Mesuré sur MadMapper 6.0.9 : à 0, les 240
        // canaux tombent à zéro ; à 0,5, tout est à 127 — c'est linéaire, donc
        // utilisable en fondu.
        //
        // ⚠ Délibérément SÉPARÉ de BLACKOUT. La règle n°4 du projet définit
        // précisément ce que font STOP et BLACKOUT ; les faire grossir en
        // douce serait le meilleur moyen de casser la confiance qu'un régisseur
        // met dans ces deux boutons. Et surtout : ceci touche un réglage GLOBAL
        // de MadMapper, qui affecte des projecteurs dont Cascade n'est pas
        // responsable. Ça se déclenche à la main, et ça se voit.
        //
        // ⚠ Ne pas confondre avec `/master/freeze_dmx_output`, qui n'est PAS un
        // noir : il arrête l'émission, donc les projecteurs gardent leur
        // dernière valeur. Mesuré : plus aucune trame en 1,2 s.
        const on = !!body.on;
        oscSend('/master/master_dmx_level', [{ type: 'f', value: on ? 0 : 1 }]);
        state.global.coupure = on;
        saveConfig();
        console.log('[cascade] coupure générale MadMapper : ' + (on ? 'ENGAGÉE' : 'levée'));
        return json(res, { ok: true, coupure: on });
      }
      case '/api/geometrie': {
        // Renvoie la disposition vers MadMapper. JAMAIS automatique : c'est
        // une écriture dans le projet de l'utilisateur, elle se déclenche
        // uniquement sur un clic explicite. Le reste du temps, Cascade ne
        // touche qu'aux niveaux et aux couleurs.
        //
        // Vérifié sur MadMapper 6.0.9, le 2026-07-26 : `output/x`, `output/y`
        // et `output/rot` sont écrivables en OSC et prennent la valeur exacte.
        //
        // ⚠ MAIS x et y sont en PIXELS de la composition, pas en 0..1. Envoyer
        // 0,7 place la barre à sept dixièmes de pixel du bord — c'est-à-dire
        // dans le coin. La conversion passe donc par la résolution de sortie,
        // qui est un réglage : l'API OSC de MadMapper ne permet pas de la
        // demander. `rot` est en degrés, dans le même sens que celui lu à
        // l'import — aucun signe à retourner.
        //
        // On n'envoie ni `width` ni `height` : ce sont les dimensions de la
        // barre dans MadMapper, pas sa place. Les toucher reviendrait à
        // redimensionner le mapping du régisseur sous prétexte de le déplacer.
        const { outW, outH } = state.settings;
        const envoyees = [];
        for (const f of state.fixtures) {
          if (!f.enabled) continue;
          oscSend(`${f.address}/output/x`, [{ type: 'f', value: Math.round(f.x * outW) }]);
          oscSend(`${f.address}/output/y`, [{ type: 'f', value: Math.round(f.y * outH) }]);
          oscSend(`${f.address}/output/rot`, [{ type: 'f', value: rot360(f.rot) }]);
          envoyees.push(f.name);
        }
        console.log('[cascade] disposition envoyée à MadMapper : '
          + envoyees.length + ' barre(s)');
        return json(res, { ok: true, count: envoyees.length, names: envoyees });
      }
      case '/api/groups': {
        const gid = String(body.id || '');
        if (body.action === 'add' && state.groups.length < MAX_GROUPS) {
          state.groups.push({
            id: 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1e4),
            name: String(body.name || '').trim().slice(0, 20) || 'Groupe ' + (state.groups.length + 1),
            bars: Array.isArray(body.bars) ? [...new Set(body.bars.map(String))].slice(0, MAX_FIXTURES) : [],
          });
        } else if (body.action === 'remove') {
          state.groups = state.groups.filter(g => g.id !== gid);
          // Les couches qui suivaient ce groupe repassent sur toutes les barres
          for (const L of state.layers) if (L.groupId === gid) L.groupId = null;
        } else {
          const g = state.groups.find(x => x.id === gid);
          if (g) {
            if (body.action === 'rename') g.name = String(body.name || '').trim().slice(0, 20) || g.name;
            else if (body.action === 'set' && Array.isArray(body.bars)) {
              g.bars = [...new Set(body.bars.map(String))].slice(0, MAX_FIXTURES);
            }
          }
        }
        saveConfig();
        return json(res, { ok: true, groups: state.groups, layers: state.layers });
      }
      case '/api/resync': {
        resync(body.id);
        return json(res, { ok: true });
      }
      case '/api/link': {
        // `phase` et `quantum` se règlent sans toucher à l'activation de Link.
        if ('phase' in body) { state.settings.linkPhase = !!body.phase; saveConfig(); }
        if ('quantum' in body) {
          state.settings.linkQuantum = Math.round(cnum(body.quantum, 1, 16, 4));
          saveConfig();
        }
        if ('enabled' in body) setLinkActive(!!body.enabled);
        return json(res, { ok: true, link: {
          active: link.active, connected: link.connected, bpm: link.bpm, peers: link.peers,
          error: link.error, phaseOn: !!state.settings.linkPhase,
          quantum: state.settings.linkQuantum || 4, locked: !!linkGrid(Date.now()) } });
      }
      case '/api/quit': {
        // Bouton ⏻ de l'interface : indispensable en mode « app » (pas de terminal à fermer).
        json(res, { ok: true });
        console.log('[cascade] arrêt demandé depuis l’interface.');
        setTimeout(() => { flushConfig(); killCarabiner(); process.exit(0); }, 300);
        return;
      }
      case '/api/project': {
        // Nom du projet (utilisé pour l'export et le dialogue Quitter)
        const n = String(body.name || '').trim().slice(0, 40);
        if (n) { state.projectName = n; saveConfig(); }
        return json(res, { ok: true, name: state.projectName });
      }
      case '/api/import': {
        if (!body || !Array.isArray(body.layers) || !body.layers.length) {
          return json(res, { ok: false, error: 'format invalide' });
        }
        stopChase();
        state.layers = body.layers.slice(0, MAX_LAYERS).map(sanitizeLayer);
        if (body.scene) state.scene = sanitizeScene(body.scene);
        if (Array.isArray(body.fixtures)) state.fixtures = sanitizeFixtures(body.fixtures);
        if (Array.isArray(body.groups)) state.groups = sanitizeGroups(body.groups);
        if (Array.isArray(body.vues)) state.vues = sanitizeVues(body.vues);
        if (body.global) Object.assign(state.global, sanitizeGlobal(body.global));
        if (Array.isArray(body.presets)) state.presets = sanitizePresets(body.presets);
        pruneCaches();
        layerSeq = state.layers.length + 1;
        if (typeof body.projectName === 'string' && body.projectName.trim()) {
          state.projectName = body.projectName.trim().slice(0, 40);
        }
        saveConfig();
        dirtySinceExport = false; // l'état vient d'un fichier : rien à ré-exporter
        return json(res, { ok: true });
      }
      case '/api/new': {
        stopChase();
        state.layers = [defaultLayer('Chaser 1')];
        layerSeq = 2;
        state.presets = Array(PRESET_SLOTS).fill(null);
        if (!body.keepFixtures) { state.fixtures = []; state.groups = []; pruneCaches(); }
        // Les vues portent les noms des dossiers d'un AUTRE spectacle : les
        // garder ferait pointer Cascade sur des dossiers qui n'existent pas.
        state.vues = [];
        state.global.vueActive = null;
        // Un projet neuf ne doit pas hériter d'automatismes du précédent : un
        // modulateur global qui continuerait de faire bouger le crossfader sur
        // une scéno vierge, c'est un réglage fantôme qu'on cherche longtemps.
        state.global.modGlobal = null;
        state.global.xfade = 0;
        stopFonduVue();
        state.projectName = 'Sans titre';
        saveConfig();
        dirtySinceExport = false; // projet vierge : rien à exporter encore
        return json(res, { ok: true });
      }
      case '/api/start': startChase(); return json(res, { ok: true });
      case '/api/stop': stopChase(); return json(res, { ok: true });
      case '/api/blackout': blackout(); return json(res, { ok: true });
      case '/api/tap': return json(res, { ok: true, stepMs: tap(body.id) });
      case '/api/fixtures': {
        if (Array.isArray(body.fixtures)) {
          state.fixtures = sanitizeFixtures(body.fixtures);
          pruneCaches();
          saveConfig();
        }
        return json(res, { ok: true, fixtures: state.fixtures });
      }
      case '/api/discover': {
        const found = await discover();
        return json(res, { ok: true, found });
      }
      case '/api/trouverport': {
        // Balayage des ports d'entrée plausibles de MadMapper. Lecture seule :
        // `/getControls` ne modifie rien.
        const essais = await chercherMadMapper(
          Math.round(cnum(body.parPortMs, 60, 2000, 500)));
        const gagnants = essais.filter(e => e.reponses > 0).map(e => e.port);
        return json(res, { ok: true, essais, ports: gagnants,
          feedbackPort: state.settings.feedbackPort, actuel: state.settings.mmPort });
      }
      case '/api/layout': {
        const layout = [];
        for (const f of state.fixtures) layout.push(await readGeometry(f));
        return json(res, { ok: true, layout });
      }
      case '/api/inspect': {
        const f = state.fixtures[body.index];
        if (!f) return json(res, { ok: false, controls: [] });
        const controls = await inspect(f.address);
        return json(res, { ok: true, fixture: f, controls });
      }
      case '/api/test': {
        const f = state.fixtures[body.index];
        if (f) {
          oscSend(`${f.address}/${state.global.param}`, [{ type: 'f', value: 1 }]);
          setTimeout(() => oscSend(`${f.address}/${state.global.param}`, [{ type: 'f', value: 0 }]), 400);
        }
        return json(res, { ok: !!f });
      }
      case '/api/midimap': {
        if (body.map && typeof body.map === 'object') { state.midiMap = sanitizeMidiMap(body.map); saveConfig(); }
        return json(res, { ok: true, midiMap: state.midiMap });
      }
      case '/api/settings': {
        const old = state.settings.feedbackPort;
        const oldIn = state.settings.oscInPort;
        const httpPort = state.settings.httpPort; // ne se change pas à chaud
        state.settings = sanitizeSettings({ ...state.settings, ...body, httpPort });
        if (state.settings.feedbackPort !== old) openFeedbackSocket();
        if (state.settings.oscInPort !== oldIn) openOscInSocket();
        saveConfig();
        return json(res, { ok: true, settings: state.settings });
      }
    }
  }
  res.writeHead(404); res.end('Not found');
});

// ---------------------------------------------------------------------------
loadConfig();
// Surcharges d'environnement (tests, lancements automatisés, multi-instances).
for (const [env, key] of [['CASCADE_PORT', 'httpPort'], ['CASCADE_OSCIN', 'oscInPort'],
                          ['CASCADE_FEEDBACK', 'feedbackPort'], ['CASCADE_MMPORT', 'mmPort']]) {
  if (process.env[env]) state.settings[key] = Math.round(cnum(process.env[env], 1, 65535, state.settings[key]));
}
if (process.env.CASCADE_MMHOST) state.settings.mmHost = String(process.env.CASCADE_MMHOST).slice(0, 64);
openFeedbackSocket();
openOscInSocket();
if (state.settings.linkEnabled) setLinkActive(true); // Link était actif à la dernière session

// Port HTTP occupé (double lancement, autre app…) → on essaie les suivants.
// Adresses LAN pour connecter une tablette / un téléphone
let actualPort = state.settings.httpPort;
function lanUrls() {
  const out = [];
  try {
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
      for (const i of ifs[name] || []) {
        if (i.family === 'IPv4' && !i.internal) out.push('http://' + i.address + ':' + actualPort);
      }
    }
  } catch (e) {}
  return out;
}

/** Cherche un navigateur Chromium (Chrome/Edge/Brave) pour le mode « app » :
 *  fenêtre dédiée sans barre d'adresse ni onglets — l'interface ressemble à
 *  un vrai logiciel. À défaut : navigateur par défaut (onglet classique). */
function findChromish() {
  const tryPaths = (cands) => {
    for (const c of cands) { try { if (c && fs.existsSync(c)) return c; } catch (e) {} }
    return null;
  };
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const lad = process.env['LocalAppData'] || '';
    return tryPaths([
      pf + '\\Google\\Chrome\\Application\\chrome.exe',
      pf86 + '\\Google\\Chrome\\Application\\chrome.exe',
      lad && lad + '\\Google\\Chrome\\Application\\chrome.exe',
      pf86 + '\\Microsoft\\Edge\\Application\\msedge.exe',
      pf + '\\Microsoft\\Edge\\Application\\msedge.exe',
      pf + '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    ]);
  }
  if (process.platform === 'darwin') {
    return tryPaths([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]);
  }
  return null;
}

function openBrowser(port) {
  if (NO_BROWSER) return;
  const url = 'http://localhost:' + port;
  const app = findChromish();
  if (app) {
    try {
      spawn(app, ['--app=' + url, '--window-size=1480,980'], { stdio: 'ignore', detached: true }).unref();
      return;
    } catch (e) { /* on retombe sur le navigateur par défaut */ }
  }
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
            : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

/** Le port est-il tenu par une autre instance de Cascade (et non une autre app) ? */
function probeCascade(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/ping', timeout: 900 }, (res) => {
      let d = '';
      res.on('data', c => { d += c; if (d.length > 2048) req.destroy(); });
      res.on('end', () => { try { resolve(JSON.parse(d).app === APP_NAME); } catch (e) { resolve(false); } });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// Une seule instance à la fois : si Cascade tourne déjà, on ouvre sa fenêtre et on quitte.
if (process.env.CASCADE_PORT) {
  state.settings.httpPort = Math.round(cnum(process.env.CASCADE_PORT, 1, 65535, state.settings.httpPort));
}
let tryPort = state.settings.httpPort;
server.on('error', async (e) => {
  if (e.code !== 'EADDRINUSE') { console.error('[cascade] serveur HTTP impossible :', e.message); return; }
  if (await probeCascade(tryPort)) {
    console.log('');
    console.log('  Cascade est déjà lancé (port ' + tryPort + ').');
    console.log('  Ouverture de la fenêtre existante — cette copie se ferme.');
    console.log('');
    openBrowser(tryPort);
    setTimeout(() => process.exit(0), 600);
    return;
  }
  if (tryPort - state.settings.httpPort < 10) {
    console.warn('[cascade] port ' + tryPort + ' occupé par une autre application, essai sur ' + (tryPort + 1) + '…');
    tryPort++;
    server.listen(tryPort);
  } else {
    console.error('[cascade] aucun port libre entre ' + state.settings.httpPort + ' et ' + tryPort + '.');
  }
});
server.on('listening', () => {
  const port = server.address().port;
  actualPort = port;
  const lans = lanUrls();
  console.log('');
  console.log('  ┌──────────────────────────────────────────────────┐');
  console.log('  │  ' + 'CASCADE — séquenceur LED pour MadMapper'.padEnd(48) + '│');
  console.log('  │  ' + ('v' + VERSION + '   ' + SIGNATURE).padEnd(48) + '│');
  console.log('  │  Interface : http://localhost:' + String(port).padEnd(19) + '│');
  console.log('  │  OSC → MadMapper ' + (state.settings.mmHost + ':' + state.settings.mmPort).padEnd(32) + '│');
  console.log('  │  OSC entrant : port ' + String(state.settings.oscInPort).padEnd(29) + '│');
  console.log('  └──────────────────────────────────────────────────┘');
  if (lans.length) console.log('  Tablette / téléphone (même Wi-Fi) : ' + lans.join('  ou  '));
  console.log('');
  openBrowser(port);
});
server.listen(tryPort);
