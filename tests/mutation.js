/**
 * TEST DE MUTATION — « est-ce que nos tests protègent vraiment quelque chose ? »
 *
 * Ce n'est pas un test au sens de `npm test` : c'est un outil à lancer à la main
 * (`node tests/mutation.js`). Il casse le code EXPRÈS, un cassage à la fois,
 * relance la suite concernée, et vérifie qu'elle tombe. Un test qui reste vert
 * alors que le code est cassé ne protège rien — et on croit être couvert.
 *
 * Ce que ça a trouvé la première fois : la suite était AVEUGLE à quatre
 * cassages réels (forme d'onde triangle, décalage de phase du champ, inversion,
 * et retour à l'étalement du bruit qui avait été rejeté pour saturation). Quatre
 * tests ont été ajoutés, et ce fichier a servi à prouver qu'ils attrapent
 * désormais chaque cassage.
 *
 * Ça a aussi corrigé une accusation : « les assertions de bornes sont des
 * tautologies » était FAUX — faire rendre 5 au champ fait tomber onze tests.
 *
 * ⚠ Le fichier source est sauvegardé en mémoire et restauré dans un `finally`.
 * La dernière ligne affichée confirme que `server.js` est bien revenu à
 * l'identique : si ce n'est pas le cas, ne rien commiter et vérifier avec git.
 *
 * ⚠ Les motifs de remplacement doivent tenir sur UNE ligne. Le fichier est en
 * fins de ligne Windows, donc un motif multi-ligne écrit avec des 
 ne matche
 * jamais — piège qui a coûté trois essais.
 */
const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const SRC = path.join(RACINE, 'server.js');

const MUTATIONS = require('./mutations-liste.js');

const original = fs.readFileSync(SRC, 'utf8');
const resultats = [];
try {
  for (const m of MUTATIONS) {
    if (!original.includes(m.de)) { resultats.push([m.nom, 'MOTIF ABSENT']); console.log('  ??  ' + m.nom + ' -> motif absent'); continue; }
    const i = m.remplaceDerniere ? original.lastIndexOf(m.de) : original.indexOf(m.de);
    fs.writeFileSync(SRC, original.slice(0, i) + m.vers + original.slice(i + m.de.length));
    let sortie = '', code = 0;
    try {
      sortie = execFileSync(process.execPath, ['--test', m.cible],
        { cwd: RACINE, encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { code = 1; sortie = String(e.stdout || '') + String(e.stderr || ''); }
    const f = /fail (\d+)/.exec(sortie);
    const verdict = code ? 'DETECTEE (' + (f ? f[1] : '?') + ' test(s) en echec)' : 'NON DETECTEE';
    resultats.push([m.nom, verdict]);
    console.log((code ? '  vu  ' : '  !!  ') + m.nom + ' -> ' + verdict);
  }
} finally {
  fs.writeFileSync(SRC, original);
  console.log('');
  console.log('server.js restaure : ' + (fs.readFileSync(SRC, 'utf8') === original ? 'identique' : 'DIVERGENT'));
}
console.log('');
console.log('=== bilan ===');
for (const [n, r] of resultats) console.log('  ' + (r.startsWith('DETECTEE') ? '[vu]     ' : '[AVEUGLE]') + ' ' + n);
