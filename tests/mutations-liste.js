'use strict';
/**
 * La LISTE des cassages volontaires, isolée pour que deux outils s'en servent :
 *
 *  - `tests/mutation.js`, qui casse le code exprès et vérifie que la suite tombe ;
 *  - un test de `tests/interface.test.js`, qui vérifie que le code source
 *    contient bien la forme SAINE de chacun de ces endroits.
 *
 * Ce second usage n'est pas théorique : le 28/07/2026, un commit est parti avec
 * un mutant resté en place (`const src = 'motif'`), ce qui désactivait en
 * silence la palette spatiale. La suite restait verte — le mutant tue une
 * fonction, pas un test — et rien ne le signalait. Le garde-fou ferme ce trou.
 *
 * ⚠ Les motifs doivent tenir sur UNE ligne : le fichier source est en fins de
 * ligne Windows, donc un motif multi-ligne écrit avec des 
 ne matche jamais.
 */

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
    nom: 'le crossfader ne fait plus rien (poids toujours 1)',
    cible: 'tests/crossfader.test.js',
    de: "  return L.deck === 'a' ? 1 - x : x;",
    vers: '  return 1;',
  },
  {
    nom: 'le poids du fader s applique sur la VALEUR, pas sur la fusion',
    cible: 'tests/crossfader.test.js',
    de: '      const doser = (fond, apres) => fond + poids * (apres - fond);',
    vers: '      const doser = (fond, apres) => apres * poids;',
  },
  {
    nom: 'le modulateur est ignore par le mixage',
    cible: 'tests/modulateur.test.js',
    de: '    const L = appliquerLFO(L0, now, store);',
    vers: '    const L = L0;',
  },
  {
    nom: 'le modulateur court-circuite les bornes du reglage',
    cible: 'tests/modulateur.test.js',
    de: '  return { ...L, ...sanitizeLayerSet({ [m.param]: brut }) };',
    vers: '  return { ...L, [m.param]: brut };',
  },
  {
    nom: 'le modulateur cale sur le tempo retombe sur les millisecondes',
    cible: 'tests/modulateur.test.js',
    de: '  const periode = m.sync ? Math.max(100, m.cycles * periodeCouche(L))',
    vers: '  const periode = false ? Math.max(100, m.cycles * periodeCouche(L))',
  },
  {
    // La forme EXACTE d'avant le correctif du 28/07 : un wash de couleur
    // s'éteignait dès qu'un chase d'intensité démarrait sur d'autres barres.
    nom: 'le niveau se decide globalement, plus barre par barre (defaut v1)',
    cible: 'tests/regressions.test.js',
    de: '  if (mix.lum.has(id)) return mix.lum.get(id);',
    vers: '  if (mix.anyInt) return mix.lum.get(id) || 0;',
  },
  {
    nom: 'le modulateur global n atteint plus le crossfader',
    cible: 'tests/modulateur.test.js',
    de: "  const x = Math.max(0, Math.min(1, fini(globalEff('xfade'), 0)));",
    vers: "  const x = Math.max(0, Math.min(1, fini(state.global.xfade, 0)));",
  },
  {
    nom: 'l adresse d une fixture n est plus nettoyee (octet nul, slash absent)',
    cible: 'tests/adresses.test.js',
    de: "      address: adresseOsc(f && f.address),",
    vers: "      address: String((f && f.address) || '').slice(0, 200),",
  },
  {
    nom: 'une fixture sans adresse envoie a nouveau a la racine',
    cible: 'tests/adresses.test.js',
    // ⚠ Motif sur UNE ligne : un motif multi-ligne ne matche pas selon les
    // fins de ligne du fichier. `indexOf` prend la première occurrence,
    // celle de `sendLum` — c'est celle que le test mesure.
    de: '  if (!f.address) return;',
    vers: '  if (false) return;',
  },
  {
    nom: 'normalisation par l etendue de l axe remplacee par une constante',
    cible: 'tests/champ3d.test.js',
    de: "  const ext = Math.max(0.1, Math.abs(a[0]) * sc.w + Math.abs(a[1]) * sc.d + Math.abs(a[2]) * sc.h);",
    vers: "  const ext = 10;",
  },
];

module.exports = MUTATIONS;
