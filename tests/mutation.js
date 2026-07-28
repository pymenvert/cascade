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

const MUTATIONS = [
  {
    nom: 'les vues n eteignent plus les autres dossiers',
    cible: 'tests/vues.test.js',
    de: "    const vers = (cible && v.id === cible.id) ? 1 : 0;",
    vers: "    const vers = (cible && v.id === cible.id) ? 1 : 1;",
  },
  {
    nom: 'le fondu ne masque plus la vue sortante a la fin',
    cible: 'tests/vues.test.js',
    de: "      for (const p of fonduVue.plan) if (p.vers === 0) envoyerVue(p.dossier, 0, false);",
    vers: "      for (const p of fonduVue.plan) if (p.vers === 0) envoyerVue(p.dossier, 0, null);",
  },
  {
    nom: 'stopFonduVue neutralise : un fondu en cours n est plus interrompu',
    cible: 'tests/vues.test.js',
    de: 'function stopFonduVue() {',
    vers: 'function stopFonduVue() { return;',
  },
  {
    nom: 'Cascade touche aussi aux dossiers NON declares',
    cible: 'tests/vues.test.js',
    de: "    if (!v.dossier) continue;",
    vers: "    if (!v.dossier) { plan.push({ dossier: 'INCONNU', de: 1, vers: 0 }); continue; }",
  },
  {
    nom: 'l incertitude d une vue memorisee est effacee',
    cible: 'tests/vues.test.js',
    de: "  if ('vueActive' in g) o.vueIncertaine = !!g.vueActive;",
    vers: "  if ('vueActive' in g) o.vueIncertaine = false;",
  },
  {
    nom: 'l inversion de LED est ignoree',
    cible: 'tests/vues.test.js',
    de: "          if ('inverse' in item) f.inverse = !!item.inverse;",
    vers: "          if (false) f.inverse = !!item.inverse;",
  },
  {
    nom: 'le champ rend 5 au lieu de sa valeur (hors bornes)',
    cible: 'tests/champ3d.test.js',
    remplaceDerniere: true,
    de: '    out.set(f.id, v);',
    vers: '    out.set(f.id, 5);',
  },
  {
    nom: 'forme d onde TRIANGLE cassee (rend toujours 1)',
    cible: 'tests/champ3d.test.js',
    de: "    if (L.waveform === 'triangle') v = 1 - 2 * Math.min(d, 1 - d);",
    vers: "    if (L.waveform === 'triangle') v = 1;",
  },
  {
    nom: 'decalage de PHASE ignore par le champ',
    cible: 'tests/champ3d.test.js',
    remplaceDerniere: true,
    de: '  const t = phaseContinue(L, now, store).u + (L.phase || 0) / 360;',
    vers: '  const t = phaseContinue(L, now, store).u;',
  },
  {
    nom: 'INVERSION ignoree par le melange',
    cible: 'tests/champ3d.test.js',
    de: "      if (L.invert) v = 1 - v;",
    vers: "      if (false) v = 1 - v;",
  },
  {
    nom: 'etalement du bruit revenu a la version rejetee',
    cible: 'tests/champ3d.test.js',
    de: "const BRUIT_MOY = 0.5, BRUIT_EC = 0.1809;",
    vers: "const BRUIT_MOY = 0.5, BRUIT_EC = 0.11;",
  },
  {
    nom: 'la palette ignore la source spatiale (toujours le motif)',
    cible: 'tests/champ3d.test.js',
    de: "  const src = L.palSrc || 'motif';",
    vers: "  const src = 'motif';",
  },
  {
    nom: 'le decalage reparti est ignore (tout a l unisson)',
    cible: 'tests/champ3d.test.js',
    de: '  const etale = fini(L.spread, 0) / 360;',
    vers: '  const etale = 0;',
  },
  {
    nom: 'normalisation par l etendue de l axe remplacee par une constante',
    cible: 'tests/champ3d.test.js',
    de: "  const ext = Math.max(0.1, Math.abs(a[0]) * sc.w + Math.abs(a[1]) * sc.d + Math.abs(a[2]) * sc.h);",
    vers: "  const ext = 10;",
  },
];

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
