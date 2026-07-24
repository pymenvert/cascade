#!/usr/bin/env node
/**
 * Construit les exécutables portables de Cascade — Windows, macOS (Intel et
 * Apple Silicon) et Linux — à partir de ce dossier.
 *
 *   node build.js            → les 4 plateformes
 *   node build.js win        → une seule (win | mac | mac-arm | linux)
 *
 * Aucune dépendance n'est ajoutée au projet : l'outil d'empaquetage est
 * appelé à la volée par `npx`. Il télécharge la première fois ~250 Mo de
 * binaires Node officiels (cache dans ~/.pkg-cache), ensuite c'est instantané.
 *
 * Bytecode désactivé : le compiler obligerait à EXÉCUTER le binaire de la
 * plateforme cible, impossible depuis une seule machine. Le code est de toute
 * façon publié en MIT — rien à cacher.
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'build');
const VERSION = require('./package.json').version;
const NODE_TAG = 'node22';

const TARGETS = {
  win:     { pkg: `${NODE_TAG}-win-x64`,     out: `Cascade-${VERSION}-windows-x64.exe` },
  mac:     { pkg: `${NODE_TAG}-macos-x64`,   out: `Cascade-${VERSION}-macos-intel` },
  'mac-arm': { pkg: `${NODE_TAG}-macos-arm64`, out: `Cascade-${VERSION}-macos-apple-silicon` },
  linux:   { pkg: `${NODE_TAG}-linux-x64`,   out: `Cascade-${VERSION}-linux-x64` },
};

const asked = process.argv.slice(2).filter(a => !a.startsWith('-'));
const todo = asked.length ? asked : Object.keys(TARGETS);
for (const t of todo) {
  if (!TARGETS[t]) {
    console.error(`Cible inconnue : ${t}. Attendu : ${Object.keys(TARGETS).join(', ')}`);
    process.exit(1);
  }
}

fs.mkdirSync(OUT, { recursive: true });

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
let ok = 0, ko = [];

for (const key of todo) {
  const { pkg, out } = TARGETS[key];
  const dest = path.join(OUT, out);
  process.stdout.write(`\n▸ ${out}\n`);
  try { fs.rmSync(dest, { force: true }); } catch (e) {}

  const r = spawnSync(npx, ['--yes', '@yao-pkg/pkg@6', '.',
    '--targets', pkg, '--no-bytecode', '--public', '--public-packages', '*',
    '--output', dest], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });

  const size = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
  if (r.status !== 0 || size < 10 * 1024 * 1024) {
    ko.push(`${out} (${r.status !== 0 ? 'code ' + r.status : Math.round(size / 1024) + ' Ko — trop petit'})`);
    continue;
  }
  if (!key.startsWith('win')) { try { fs.chmodSync(dest, 0o755); } catch (e) {} }
  console.log(`  ✔ ${(size / 1048576).toFixed(0)} Mo`);
  ok++;
}

console.log(`\n${ok}/${todo.length} exécutable(s) dans ${OUT}`);
if (ko.length) {
  console.error('Échecs :\n  - ' + ko.join('\n  - '));
  process.exit(1);
}
console.log(`
Rappels :
  • macOS — les binaires ne sont ni signés ni notarisés. Au premier lancement :
    xattr -cr <fichier> && chmod +x <fichier>
  • Ableton Link a besoin de Carabiner dans un sous-dossier runtime/ à côté de
    l'exécutable (les lanceurs .bat/.command le téléchargent). Sans lui, tout
    le reste de Cascade fonctionne : seul le bouton Link reste inactif.
  • La configuration est écrite à côté de l'exécutable (cascade-config.json).
`);
