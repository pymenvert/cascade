#!/usr/bin/env node
/**
 * Extrait du CHANGELOG la section d'une version, pour la description de release.
 *
 *   node tools/notes-version.js 2.0.0      → écrit la section sur la sortie
 *   node tools/notes-version.js v2.0.0     → le « v » est toléré
 *
 * Sert au workflow de release : la description publiée sur GitHub est ainsi
 * TOUJOURS celle du CHANGELOG, jamais un texte recopié à côté qui finirait par
 * diverger. Zéro dépendance, comme le reste du projet.
 *
 * Sort en erreur si la section est introuvable — mieux vaut une release qui
 * échoue qu'une release publiée avec une description vide.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const brut = process.argv[2];
if (!brut) {
  console.error('usage : node tools/notes-version.js <version>');
  process.exit(2);
}
const version = brut.replace(/^v/, '');

const chemin = path.join(__dirname, '..', 'CHANGELOG.md');
const texte = fs.readFileSync(chemin, 'utf8');

// Les titres ont la forme « ## [2.0.0] — 2026-07-28 ». On prend tout jusqu'au
// titre de même niveau suivant.
const lignes = texte.split(/\r?\n/);
const estTitre = (l) => /^##\s+\[/.test(l);
const debut = lignes.findIndex(l => estTitre(l) && l.includes('[' + version + ']'));
if (debut === -1) {
  console.error('Section introuvable dans CHANGELOG.md pour la version ' + version);
  console.error('Titres disponibles :');
  for (const l of lignes.filter(estTitre)) console.error('  ' + l);
  process.exit(1);
}
let fin = lignes.length;
for (let i = debut + 1; i < lignes.length; i++) {
  if (estTitre(lignes[i])) { fin = i; break; }
}

const corps = lignes.slice(debut + 1, fin).join('\n').trim();
if (!corps) {
  console.error('La section ' + version + ' est vide.');
  process.exit(1);
}
process.stdout.write(corps + '\n');
