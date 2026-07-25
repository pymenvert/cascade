#!/usr/bin/env node
/**
 * Recopie les sources dans `dist/` — le dossier distribuable.
 *
 *   node sync-dist.js          met dist/ à jour
 *   node sync-dist.js --check  ne modifie rien, sort en erreur si dist/ diverge
 *
 * `dist/` est une copie autonome que l'on envoie telle quelle. Elle DOIT rester
 * identique aux sources : livrer un dist/ obsolète, c'est livrer une version
 * qui n'a pas été testée. La forme `--check` est appelée par la suite de tests
 * pour que l'oubli soit impossible.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

/** Fichiers copiés à l'identique depuis la racine vers dist/. */
const COPIES = [
  'server.js',
  'public/index.html',
  'Cascade - PC.bat',
  'Cascade - Mac.command',
  'Cascade - Manuel.pdf',
];

const check = process.argv.includes('--check');
const lus = (p) => { try { return fs.readFileSync(p); } catch (e) { return null; } };

const divergents = [];
for (const rel of COPIES) {
  const src = path.join(ROOT, rel);
  const dst = path.join(DIST, rel);
  const a = lus(src);
  if (!a) { divergents.push(`${rel} : source introuvable`); continue; }
  const b = lus(dst);
  if (b && a.equals(b)) continue;

  if (check) {
    divergents.push(b ? `${rel} : dist/ diffère de la source` : `${rel} : absent de dist/`);
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    console.log('  copié  ' + rel);
  }
}

// La version doit être la même partout : c'est ce que verra l'utilisateur.
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const distPkgPath = path.join(DIST, 'package.json');
const distPkg = JSON.parse(fs.readFileSync(distPkgPath, 'utf8'));
if (distPkg.version !== pkg.version) {
  if (check) divergents.push(`package.json : version ${distPkg.version} dans dist/, ${pkg.version} à la racine`);
  else {
    distPkg.version = pkg.version;
    fs.writeFileSync(distPkgPath, JSON.stringify(distPkg, null, 2) + '\n');
    console.log('  version de dist/package.json alignée sur ' + pkg.version);
  }
}

if (check) {
  if (divergents.length) {
    console.error('dist/ n’est pas à jour :');
    for (const d of divergents) console.error('  - ' + d);
    console.error('\n  → lance `npm run sync-dist`');
    process.exit(1);
  }
  console.log('dist/ est synchrone avec les sources.');
} else {
  console.log(divergents.length ? divergents.join('\n') : 'dist/ est à jour.');
}
