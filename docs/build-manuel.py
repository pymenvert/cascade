# -*- coding: utf-8 -*-
"""
Génère « Cascade - Manuel.pdf » (manuel utilisateur).
Usage :  python3 build-manuel.py [dossier_sortie]
Dépendances : reportlab + polices DejaVu (paquet fonts-dejavu).
ATTENTION aux caractères : les polices utilisées n'ont ni les exposants/indices
Unicode, ni les symboles ⏻ (U+23FB), ⧉ (U+29C9), ⚠ (U+26A0), ✔ (U+2714) — ils
sortiraient en carrés vides. Écrire les mots (« bouton Quitter », « Attention : »).
Sont sûrs : → ← ↑ ↓ • — – × ÷ ° − « » “ ” …
"""
import sys, os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, HRFlowable, PageBreak,
                                Preformatted, KeepTogether)
from reportlab.lib.styles import ParagraphStyle

VERSION = "2.0"
ORANGE = HexColor("#E8890B")
DARK = HexColor("#33333B")
GREY = HexColor("#6A6A74")
LIGHT = HexColor("#F2F3F7")
BORD = HexColor("#D8DAE2")

# Polices : DejaVu si présentes (Linux, macOS via Homebrew), sinon les polices
# système Windows, sinon celles fournies avec reportlab. Le manuel se génère
# ainsi sur n'importe quelle machine sans rien installer de plus.
import os, glob


def _families():
    """Jeux de 4 fichiers (normal, gras, italique, chasse fixe), par ordre de préférence."""
    dejavu_dirs = [
        "/usr/share/fonts/truetype/dejavu/",
        "/usr/local/share/fonts/dejavu/",
        "/opt/homebrew/share/fonts/",
        "/Library/Fonts/",
    ]
    for d in dejavu_dirs:
        f = [d + n for n in ("DejaVuSans.ttf", "DejaVuSans-Bold.ttf",
                             "DejaVuSans-Oblique.ttf", "DejaVuSansMono.ttf")]
        if all(os.path.exists(x) for x in f):
            yield f
    win = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
    for quatuor in (("segoeui.ttf", "segoeuib.ttf", "segoeuii.ttf", "consola.ttf"),
                    ("arial.ttf", "arialbd.ttf", "ariali.ttf", "cour.ttf")):
        f = [os.path.join(win, n) for n in quatuor]
        if all(os.path.exists(x) for x in f):
            yield f
    import reportlab
    rl = os.path.join(os.path.dirname(reportlab.__file__), "fonts")
    f = [os.path.join(rl, n) for n in ("Vera.ttf", "VeraBd.ttf", "VeraIt.ttf", "VeraMono.ttf")]
    if all(os.path.exists(x) for x in f):
        yield f


for _f in _families():
    try:
        pdfmetrics.registerFont(TTFont("DV", _f[0]))
        pdfmetrics.registerFont(TTFont("DV-B", _f[1]))
        pdfmetrics.registerFont(TTFont("DV-O", _f[2]))
        pdfmetrics.registerFont(TTFont("DV-M", _f[3]))
        print("Polices :", os.path.basename(_f[0]))
        break
    except Exception as e:
        continue
else:
    raise SystemExit("Aucune police utilisable trouvée (DejaVu, polices Windows, ou reportlab).")

S = {
    "h1": ParagraphStyle("h1", fontName="DV-B", fontSize=17, textColor=DARK,
                         spaceBefore=16, spaceAfter=8, leading=21),
    "h2": ParagraphStyle("h2", fontName="DV-B", fontSize=12.5, textColor=ORANGE,
                         spaceBefore=11, spaceAfter=5, leading=16),
    "p": ParagraphStyle("p", fontName="DV", fontSize=10, textColor=DARK,
                        leading=14.5, spaceAfter=6),
    "li": ParagraphStyle("li", fontName="DV", fontSize=10, textColor=DARK,
                         leading=14.5, spaceAfter=3, leftIndent=14, bulletIndent=4),
    "note": ParagraphStyle("note", fontName="DV-O", fontSize=9, textColor=GREY,
                           leading=13, spaceAfter=6),
    "code": ParagraphStyle("code", fontName="DV-M", fontSize=8.5, textColor=DARK,
                           leading=13, backColor=LIGHT, borderColor=BORD,
                           borderWidth=0.7, borderPadding=7, spaceAfter=8),
    "tc": ParagraphStyle("tc", fontName="DV", fontSize=9.3, textColor=DARK, leading=13),
    "tch": ParagraphStyle("tch", fontName="DV-B", fontSize=9.3, textColor=DARK, leading=13),
    "title": ParagraphStyle("title", fontName="DV-B", fontSize=30, textColor=DARK,
                            alignment=TA_CENTER, leading=36),
    "subtitle": ParagraphStyle("subtitle", fontName="DV-B", fontSize=16, textColor=ORANGE,
                               alignment=TA_CENTER, leading=22),
    "center": ParagraphStyle("center", fontName="DV", fontSize=11.5, textColor=DARK,
                             alignment=TA_CENTER, leading=16),
    "sig": ParagraphStyle("sig", fontName="DV-B", fontSize=11.5, textColor=ORANGE,
                          alignment=TA_CENTER, leading=16),
}

def h1(t): return Paragraph(t, S["h1"])
def h2(t): return Paragraph(t, S["h2"])
def p(t): return Paragraph(t, S["p"])
def note(t): return Paragraph(t, S["note"])
def li(t): return Paragraph(t, S["li"], bulletText="•")
def code(t): return Preformatted(t, S["code"])
def rule(w=90):
    return HRFlowable(width=w * mm, thickness=1.6, color=ORANGE, spaceBefore=4,
                      spaceAfter=4, hAlign="CENTER")

def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("DV", 7.5)
    canvas.setFillColor(GREY)
    canvas.drawString(20 * mm, 12 * mm,
                      "Cascade v%s — Pierre-Yves Mansour · Collectif WSK" % VERSION)
    canvas.drawRightString(190 * mm, 12 * mm, str(canvas.getPageNumber()))
    canvas.restoreState()

out_dir = sys.argv[1] if len(sys.argv) > 1 else "."
out = os.path.join(out_dir, "Cascade - Manuel.pdf")
doc = BaseDocTemplate(out, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm,
                      topMargin=18 * mm, bottomMargin=20 * mm,
                      title="Cascade — manuel", author="Pierre-Yves Mansour — Collectif WSK")
doc.addPageTemplates([PageTemplate(id="page", frames=[
    Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")],
    onPage=footer)])

E = []

# ── Page de titre ────────────────────────────────────────────────────────────
E += [Spacer(1, 62 * mm),
      Paragraph("CASCADE", S["title"]),
      Spacer(1, 3 * mm),
      Paragraph("séquenceur LED pour MadMapper", S["subtitle"]),
      Spacer(1, 12 * mm),
      Paragraph("Séquenceur LED multi-couches — chases, vagues, couleur,<br/>"
                "presets, Ableton Link, contrôle MIDI et OSC", S["center"]),
      Spacer(1, 28 * mm),
      rule(),
      Spacer(1, 4 * mm),
      Paragraph("Version %s" % VERSION, S["center"]),
      Spacer(1, 2 * mm),
      Paragraph("Pierre-Yves Mansour — Collectif WSK", S["sig"]),
      PageBreak()]

# ── 1. Présentation ──────────────────────────────────────────────────────────
E += [h1("1. Présentation"),
      p("Cascade pilote l'intensité et la couleur de vos fixtures DMX (barres LED, projecteurs) "
        "directement dans MadMapper, via OSC. Vous créez des chases configurables — direction, "
        "miroirs, courbes, tempo — depuis une page web utilisable sur l'ordinateur, une tablette "
        "ou un iPad du même réseau."),
      p("L'application est adaptative : à chaque nouveau setup, un scan récupère les fixtures du "
        "projet MadMapper, et l'import de géométrie les place automatiquement (position, rotation) "
        "dans la vue spatiale. Jusqu'à 8 séquenceurs (« couches ») tournent en parallèle, mixés "
        "entre eux. Le tempo peut suivre la musique en direct via Ableton Link (Pulse, Ableton Live…)."),

# ── 2. Installation ──────────────────────────────────────────────────────────
      h1("2. Installation"),
      h2("2.0 — L'exécutable autonome (le plus simple)"),
      p("Cascade existe aussi en un seul fichier, sans rien à installer : Cascade-windows-x64.exe, "
        "Cascade-macos-apple-silicon, Cascade-macos-intel ou Cascade-linux-x64. Posez-le où vous "
        "voulez et double-cliquez : le moteur est déjà dedans. La configuration s'écrit dans un "
        "fichier cascade-config.json À CÔTÉ de l'exécutable — mettez le tout sur une clé USB et "
        "votre régie vous suit de salle en salle."),
      li("Sur Mac et Linux, la première fois, dans un Terminal ouvert sur le dossier : "
         "xattr -cr <nom du fichier> puis chmod +x <nom du fichier>. Les binaires ne sont pas "
         "signés ; sans cela, macOS annonce à tort un « fichier endommagé »."),
      li("Seule différence avec les lanceurs : Ableton Link demande le module Carabiner dans un "
         "sous-dossier runtime/ à côté de l'exécutable. Sans lui, tout le reste fonctionne "
         "normalement ; seul le bouton Link reste inactif."),
      note("Les lanceurs .bat et .command décrits ci-dessous restent parfaitement valables — ils "
           "installent Carabiner automatiquement. Choisissez l'un OU l'autre."),
      h2("2.1 — Windows (PC)"),
      li("Double-cliquer sur « Cascade - PC.bat »."),
      li("Au tout premier lancement, une fenêtre d'installation s'affiche : le moteur "
         "(Node.js portable, ~30 Mo) et le module Ableton Link (~2 Mo) se téléchargent "
         "dans le dossier runtime/. C'est la seule fois où une fenêtre noire apparaît."),
      li("Ensuite, Cascade se lance comme un vrai logiciel : aucune fenêtre de serveur, "
         "l'interface s'ouvre dans sa propre fenêtre (sans barre d'adresse)."),
      li("Si Windows demande une autorisation pare-feu : cocher réseaux privés (nécessaire "
         "pour l'iPad et pour l'OSC)."),
      h2("2.2 — Mac"),
      li("Double-cliquer sur « Cascade - Mac.command »."),
      li("Premier lancement : clic droit sur le fichier → Ouvrir (Gatekeeper), une seule fois."),
      li("Si le fichier refuse de s'exécuter après un transfert : dans le Terminal, "
         "chmod +x \"Cascade - Mac.command\" (voir aussi le LISEZ-MOI)."),
      li("Le moteur portable se télécharge de la même façon au premier lancement (Intel et "
         "Apple Silicon). La fenêtre Terminal se referme ensuite toute seule."),
      h2("2.3 — Quitter Cascade"),
      li("Bouton Quitter (symbole d'alimentation, en haut à droite) : un dialogue confirme, rappelle l'état "
         "de sauvegarde et propose d'exporter le projet."),
      li("Ou fermer simplement la fenêtre : le serveur s'arrête tout seul quelques secondes après."),
      li("Exception volontaire : si les chasers TOURNENT, fermer la fenêtre ne coupe pas le "
         "show — Cascade continue en arrière-plan, et relancer le lanceur rouvre la fenêtre."),
      h2("2.4 — Réglages MadMapper (une seule fois)"),
      li("Dans MadMapper : Préférences → OSC → activer l'entrée OSC (port 8000) et le feedback "
         "(port 9000)."),
      li("Si MadMapper tourne sur une autre machine : mettre son adresse IP dans l'app (bouton "
         "réglages en haut à droite)."),
      li("Le paramètre d'intensité par défaut est luminosity (fixtures DMX). Pour des surfaces "
         "vidéo, mettre opacity dans les réglages. En cas de doute : bouton Diagnostic."),
      h2("2.5 — iPad / tablette / téléphone"),
      li("Le plus rapide : cliquer le bouton QR en haut de l'interface et scanner le code avec "
         "l'appareil photo de l'iPad. C'est tout."),
      li("Sinon : ouvrir Safari (ou Chrome) et taper http://IP-de-l'ordinateur:3333 (l'IP "
         "s'affiche en haut de l'interface, ex. 192.168.1.20)."),
      li("Astuce : Partager → Sur l'écran d'accueil transforme la page en app plein écran."),
      li("Tout est tactile : glisser les barres, double-taper pour pivoter ou réinitialiser un réglage."),
      li("L'iPad et l'ordinateur doivent être sur le même réseau Wi-Fi. Le MIDI, lui, se branche "
         "sur l'ordinateur (Chrome/Edge), pas sur l'iPad. Tant qu'un iPad est connecté, fermer "
         "la fenêtre de l'ordinateur n'arrête pas Cascade."),

# ── 3. Premiers pas ──────────────────────────────────────────────────────────
      h1("3. Premiers pas"),
      li("Scanner (panneau Fixtures) : récupère automatiquement les fixtures du projet "
         "MadMapper ouvert."),
      li("Importer depuis MadMapper (vue spatiale) : lit la position et la rotation réelles de "
         "chaque barre et reproduit la scéno dans la vue."),
      li("Ordre = position G→D : cale l'ordre du chase sur le placement physique."),
      li("Le bouton éclair à côté d'une fixture la flashe sur scène pour l'identifier."),
      li("Tant qu'aucune barre n'est configurée, Cascade affiche ces étapes directement "
         "dans l'interface, avec un témoin qui dit si MadMapper répond déjà."),
      li("START — et c'est parti. STOP relâche le contrôle (MadMapper garde le dernier état) ; "
         "BLACKOUT éteint. La préview et la vue spatiale montrent le rendu en temps réel."),
      note("Si rien ne bouge sur scène : bouton Diagnostic (panneau Fixtures). Il interroge "
           "MadMapper, liste les contrôles réels de la fixture et corrige automatiquement le "
           "nom du paramètre d'intensité."),
      h2("3.1 — Le voyant MadMapper"),
      p("En haut de l'interface, à côté du titre, une pastille indique en permanence si "
        "MadMapper répond. Verte : la liaison est établie, tout va bien. Rouge « MadMapper ? » : "
        "Cascade envoie ses messages mais personne ne répond — survolez la pastille, l'infobulle "
        "liste quoi vérifier (application lancée, ports OSC des préférences, adresse IP). "
        "Prenez le réflexe de la regarder avant chaque service : c'est trente secondes gagnées "
        "sur la cause la plus fréquente de « rien ne s'allume »."),
      note("Les messages OSC partent « à l'aveugle » (UDP, sans accusé de réception) : sans ce "
           "voyant, une adresse ou un port erroné ne produit aucune erreur visible."),
      h2("3.2 — Connecter un iPad en dix secondes"),
      p("Cliquez le bouton QR en haut de l'interface : un QR code apparaît. Scannez-le avec "
        "l'appareil photo de l'iPad ou du téléphone, connecté au MÊME Wi-Fi que l'ordinateur — "
        "l'interface s'ouvre dans son navigateur. Si l'ordinateur a plusieurs cartes réseau, "
        "de petits boutons permettent de choisir l'adresse."),
      h2("3.3 — Le code d'accès (facultatif)"),
      p("Sans code, toute personne sur le même réseau peut piloter le show. En festival ou en "
        "salle partagée, posez-en un : bouton Réglages, champ « Code d'accès à 4 chiffres ». "
        "Laissez le champ vide et enregistrez pour le retirer."),
      li("Il protège l'accès DEPUIS LE RÉSEAU : iPad, téléphone, Wi-Fi de la salle. "
         "Un appareil qui arrive sans le code voit l'interface, mais elle lui demande les "
         "4 chiffres avant de lui donner la main."),
      li("Il n'est JAMAIS demandé sur la machine où tourne Cascade. C'est voulu : il y a "
         "toujours une voie pour le retirer, on ne peut pas s'enfermer dehors."),
      li("Cinq essais ratés bloquent l'appareil une minute — et un plafond général arrête "
         "aussi quelqu'un qui essaierait depuis plusieurs appareils à la fois. Quatre chiffres, "
         "c'est dix mille combinaisons : sans ces deux limites, elles se passeraient en revue "
         "en quelques secondes."),
      li("Changer ou retirer le code déconnecte les appareils déjà entrés : c'est la façon de "
         "reprendre la main si une tablette a été prêtée."),
      note("L'OSC et le MIDI ne sont PAS concernés : ils passent par un câble ou une console "
           "posée sur le réseau de production, c'est un autre domaine de confiance, et les "
           "fermer casserait les installations existantes. Le code protège la page web, pas "
           "les entrées de régie."),
      note("Le code est enregistré haché, jamais en clair, et ne quitte jamais l'ordinateur. "
           "Mais il ne protège pas contre quelqu'un qui a le fichier de configuration lui-même "
           "(ou la clé USB) : c'est le même niveau de confiance que la machine. Un projet "
           "exporté, lui, ne contient pas le code — le partager ne le divulgue pas."),

# ── 4. Les couches ───────────────────────────────────────────────────────────
      h1("4. Les couches (multi-chasers)"),
      p("Les pastilles en haut du panneau central listent les couches : la case active/désactive, "
        "cliquer le nom édite la couche, double-cliquer la renomme, + en ajoute (max 8), − supprime "
        "la couche sélectionnée. Chaque couche est un séquenceur complet et indépendant ; les "
        "couches d'intensité sont mixées « la plus lumineuse gagne » (HTP)."),
      h2("4.1 — Moteur"),
      li("Pas à pas : chase classique — les barres se déclenchent pas après pas."),
      li("Vague : onde continue (sinus, triangle ou carré) qui glisse sur les positions réelles "
         "des barres. « Pas par cycle » règle la durée d'un cycle, « Largeur de vague » "
         "l'étalement de l'onde."),
      li("Champ 3D : l'effet devient une fonction de la position de chaque barre DANS LE VOLUME "
         "— plan incliné, sphère, cylindre, pavé, bruit. Tout le chapitre 7 lui est consacré."),
      h2("4.2 — Cible"),
      li("Intensité : la couche pilote la luminosité des barres."),
      li("Couleur : un dégradé entre deux couleurs (A → B) voyage sur les barres via les canaux "
         "RGB. S'il n'y a que des couches couleur, l'intensité est maintenue au master pour "
         "rester visible."),
      li("Palette : au lieu de deux couleurs, un dégradé à plusieurs arrêts — Feu, Glace, "
         "Coucher de soleil, Forêt, Distance. Deux couleurs ne peuvent pas faire un feu "
         "(noir → rouge → orange → jaune → blanc) : il faut passer par des teintes du milieu. "
         "Voir aussi § 8.2, où la palette se branche sur la profondeur."),
      h2("4.3 — Patterns"),
      li("Pas à pas : G›D, D›G, ping-pong, aléatoire, pair/impair, tous (tous = pulse global "
         "avec un fade)."),
      li("Vague : G›D, D›G, H›B, B›H, pulse (respiration commune) et radial (onde circulaire "
         "depuis le point des axes)."),
      h2("4.4 — Miroirs et axes"),
      p("Les miroirs se superposent à n'importe quel pattern. Miroir G/D reflète autour d'un axe "
        "vertical, Miroir H/B autour d'un axe horizontal ; les deux ensemble donnent une symétrie "
        "centrale. Chaque axe se déplace au curseur et s'affiche en pointillés dans la vue "
        "spatiale. Les reflets sont calculés sur les positions réelles et strictement simultanés ; "
        "une barre posée sur l'axe est réintégrée dans le cycle."),
      h2("4.5 — Réglages fins"),
      li("Barres par pas : taille des blocs qui s'allument ensemble (ex. 2 = paires synchrones)."),
      li("Tenue (traîne) : nombre de pas pendant lesquels une barre reste allumée — avec un "
         "fade out long (jusqu'à 400 %), effet comète."),
      li("ON/OFF ou Opacité + courbe : sec, ou fondu avec courbe (linéaire, ease, expo) et "
         "fade in/out."),
      li("Niveau couche : dose le mix. Inverser : ombre qui balaye au lieu de lumière."),
      li("Niveau bas : au lieu de tomber au noir, les barres « éteintes » restent à ce niveau. "
         "Le chase court alors AU-DESSUS d'un fond allumé — un classique en spectacle : la scène "
         "reste habitée entre deux pas."),
      li("Barres pilotées : le menu choisit ce que la couche éclaire — toutes les barres, "
         "un groupe (voir 4.7), ou une sélection manuelle. En sélection manuelle, cliquer "
         "les barres dans la vue spatiale (les exclues passent en pointillés)."),

      h2("4.6 — Groupes de barres"),
      p("Un groupe nomme un ensemble de barres : « sol », « contres », « portique ». Ils se "
        "gèrent dans le panneau Fixtures : « + Groupe » pour en créer un, clic sur un groupe "
        "pour choisir ses barres dans la vue spatiale (elles se cerclent d'orange), "
        "double-clic pour le renommer, la croix pour le supprimer. Seize groupes au maximum."),
      p("L'intérêt vient du lien : une couche qui SUIT un groupe se met à jour toute seule "
        "quand le groupe change. Vous déplacez trois barres du sol vers le portique, vous "
        "corrigez le groupe une fois, et tous les chasers concernés suivent — au lieu de "
        "reprendre chaque couche une par une."),
      li("Les groupes appartiennent à la scéno, pas au look : ils voyagent avec le fichier "
         "projet, mais ne sont PAS mémorisés dans les presets. Rappeler un preset ne touche "
         "jamais à vos groupes."),
      li("Un groupe vidé, ou supprimé, ramène les couches qui le suivaient sur toutes les "
         "barres : mieux vaut éclairer trop que rester dans le noir sans comprendre pourquoi."),

      h2("4.7 — Les replis : ce qui ne sert qu\'au montage"),
      p("Le panneau d\'une couche porte une trentaine de réglages, dont beaucoup ne se touchent "
        "qu\'une fois, au montage. Trois REPLIS les rangent pour que la première lecture reste "
        "lisible : « Symétries » (les deux miroirs et leurs axes), « Mélange et espace » "
        "(fusion, profondeur, décalage réparti, jeu du crossfader) et « Groove et découpe » "
        "(section suivante)."),
      li("Chaque repli porte une PASTILLE orange qui compte et nomme ce qui n\'est pas à sa "
         "valeur neutre. Un miroir ou une fusion oubliés derrière un repli fermé deviendraient "
         "sinon un mystère : la pastille garantit qu\'un réglage caché ne l\'est jamais "
         "silencieusement."),
      li("Un repli s\'ouvre tout seul quand vous ARRIVEZ sur une couche qui a des réglages "
         "actifs — et seulement à ce moment-là. Si vous le refermez, il reste fermé : sans "
         "cette règle, il se rouvrirait à chaque rafraîchissement et on ne pourrait jamais le "
         "ranger."),
      h2("4.8 — Groove et découpe"),
      p("Ces réglages viennent des consoles lumière : ils transforment un chase correct en "
        "chase qui a du caractère. Tous sont neutres par défaut — vous ne les subissez pas. "
        "Ils sont regroupés sous un repli « Groove et découpe » pour ne pas encombrer la "
        "première lecture ; une pastille orange sur ce repli indique combien de réglages y "
        "sont actifs, et le repli s'ouvre tout seul quand vous arrivez sur une couche qui "
        "en utilise."),
      li("Décalage (phase), 0 à 360° : décale le départ de la couche dans son cycle. Deux couches "
         "réglées à l'identique mais déphasées de 180° se répondent au lieu de se superposer. "
         "C'est LE réglage pour faire dialoguer deux rangées de barres."),
      li("Swing, −75 à +75 % : retarde un pas sur deux, comme le shuffle d'une boîte à rythmes. "
         "Un peu de swing positif donne un balancement ; du négatif, une urgence nerveuse."),
      li("Blocs, 1 à 8 : découpe les barres en tronçons qui jouent le motif EN MÊME TEMPS. "
         "Avec 2 blocs, le chase part des deux moitiés de scène simultanément ; avec 4, la scène "
         "se met à pulser par quartiers. À ne pas confondre avec « Barres par pas » qui, lui, "
         "épaissit chaque pas."),
      li("Scintillement, 0 à 100 % : chaque allumage tire son intensité au hasard. Un réglage bas "
         "(15-25 %) fait respirer un chase trop mécanique ; au maximum, on obtient une guirlande."),
      li("Une fois (one-shot) : le motif joue UN cycle complet puis se tait, jusqu'au prochain GO. "
         "Pour les accents ponctuels : un balayage sur un coup de caisse claire, puis plus rien. "
         "Le bouton GO à côté relance le cycle immédiatement (aussi en OSC et en MIDI)."),

# ── 5. Tempo et vitesse ──────────────────────────────────────────────────────
      h1("5. Tempo et vitesse"),
      li("Temps / pas : durée d'un pas (30 ms à 2 s) de la couche sélectionnée."),
      li("TAP (ou barre espace) : taper en rythme cale le tempo. ÷2 / ×2 : croches, rondes…"),
      li("RESYNC (ou touche R) : relance tous les chasers ensemble — à cliquer sur le temps fort."),
      li("Vitesse couche : multiplicateur ×0.1 à ×4 sans perdre le tempo de base."),
      li("Vitesse globale : multiplie toutes les couches — accélère tout le show d'un geste."),
      li("Master : dimmer général de sortie."),
      li("Courbe dimmer : les LED DMX ne répondent pas linéairement à la consigne. « Carrée » "
         "affine considérablement le bas des fondus (les niveaux faibles deviennent exploitables) ; "
         "« Racine » fait l'inverse et remonte les niveaux bas. À régler une fois par installation, "
         "en observant vos vraies barres."),
      li("Double-clic / double-tap sur la ligne d'un réglage : retour à la valeur par défaut."),
      li("Les changements de tempo en cours de lecture ne cassent jamais le rythme (phase "
         "préservée)."),
      h2("5.1 — Ableton Link : suivre Pulse, Ableton Live…"),
      p("Le bouton « ABLETON LINK » (sous le TAP) fait rejoindre à Cascade la session Ableton "
        "Link du réseau : le BPM de la session pilote alors le temps/pas de TOUTES les couches, "
        "en direct (1 beat = 1 pas). C'est la solution pour rester calé sur la musique avec "
        "Pulse (Hybrid Constructs), Ableton Live, Traktor et toute application compatible Link."),
      li("Chaque couche garde sa « Vitesse » (×0.5 = blanches, ×2 = croches…) : les divisions "
         "rythmiques se règlent par couche."),
      li("Pendant que Link est actif, TAP, ÷2, ×2 et le curseur Temps/pas sont neutralisés ; "
         "le statut affiche le BPM et le nombre d'appareils de la session."),
      li("Re-cliquer sur le bouton = retour au tempo manuel. L'état Link est mémorisé au "
         "redémarrage, et pilotable en OSC : /cascade/link 0-1."),
      li("RESYNC reste utile pour recaler le départ des chasers sur le temps fort — mais "
         "avec la synchro de phase (ci-dessous), le calage est permanent."),

      h2("5.2 — Synchro de phase : jouer SUR les temps"),
      p("Suivre le tempo ne suffit pas. Deux appareils peuvent tourner exactement au même BPM "
        "et rester décalés l'un de l'autre toute la soirée : ils ont le bon rythme, mais pas au "
        "bon moment. C'est ce que corrige la case « Phase », active par défaut : chaque pas est "
        "calé sur un beat de la session Link, et le premier pas du motif tombe sur un temps fort."),
      li("Le calage est recalculé en permanence à partir de la position réelle sur la grille "
         "Link : il ne dérive pas, même après plusieurs heures de spectacle."),
      li("La rangée de points sous le bouton est le témoin de mesure : un point par temps, le "
         "premier étant le temps fort. Il bat avec la musique — un coup d'œil suffit pour voir "
         "si Cascade est bien accroché. Le menu « Mesure » règle le nombre de temps (4 par "
         "défaut, 3 pour une valse, etc.)."),
      li("La mention « calé sur la grille » confirme que la liaison est exploitable. "
         "« en attente de la grille » signifie que Carabiner n'a pas encore donné de position."),
      li("Décocher « Phase » revient au comportement d'avant : le bon tempo, mais un départ "
         "libre. Pilotable en OSC : /cascade/linkphase 0-1."),
      note("Le premier allumage part au moment où vous appuyez sur START, pas au beat suivant : "
           "un show doit démarrer quand on le demande. La grille reprend la main dès le pas "
           "d'après."),
      note("Techniquement, Link passe par Carabiner, un petit module officiel téléchargé par le "
           "lanceur au premier démarrage. S'il manque (message dans le panneau), relancer "
           "simplement le lanceur Cascade avec une connexion internet."),

# ── 6. Vue spatiale ──────────────────────────────────────────────────────────
      h1("6. La scène : placer les barres dans l'espace"),
      p("Cascade a deux pages, en haut à gauche : CONDUITE (la régie) et SCÈNE (la scénographie "
        "en trois dimensions). La 3D est la vérité ; le plan de la page Conduite en est la vue "
        "de face. Déplacer une barre dans l'une la déplace dans l'autre."),
      h2("6.1 — Le repère, en mètres"),
      p("X va de jardin à cour, Y donne la profondeur (le public est du côté des Y négatifs), "
        "Z la hauteur. L'origine est au centre du plateau, au sol : la convention des plans de "
        "feu. Renseignez les dimensions réelles de votre plateau dans le panneau Scène — tous "
        "les réglages de profondeur s'y rapportent, et c'est ce qui leur permet de garder leur "
        "sens quand vous changez de salle."),
      note("Un projet fait en 1.x est migré sans bouger d'un pixel : Cascade déduit une "
           "position 3D de chaque barre à partir de son placement 2D."),
      h2("6.2 — À la souris"),
      li("Glisser une barre la déplace au sol (magnétisme 5 cm)."),
      li("Maj + glisser la fait monter ou descendre — c'est ainsi qu'on accroche un contre."),
      li("Alt + glisser l'oriente (magnétisme 5°)."),
      li("Glisser le vide fait tourner la caméra ; la molette approche et éloigne."),
      li("Ctrl+Z défait le dernier geste. Les boutons Face / Dessus / Côté / 3-4 cadrent d'un "
         "clic ; les trois premières sont orthographiques, sans perspective, pour que la vue "
         "de face coïncide exactement avec la page Conduite."),
      h2("6.3 — Les outils de placement"),
      li("Importer depuis MadMapper : positions, rotations et tailles réelles, automatiquement."),
      li("Ligne / Colonne : alignements rapides. Miroir H / V : retourne toute la disposition."),
      li("Ordre = G→D / H→B, ou « ordre = axe 3D » : le chase suit alors la géométrie réelle "
         "du plateau au lieu de l'ordre de la liste."),
      li("Le numéro sur chaque barre = sa position dans l'ordre du chase ; les barres s'allument "
         "en temps réel, couleur comprise, pendant le spectacle."),
      li("« Inverser la LED » : à cocher pour une barre câblée à l'envers. Sans ça, un dégradé "
         "part dans le mauvais sens sur une barre sur deux — et ça ne se voit qu'en salle."),
      h2("6.4 — Renvoyer la disposition vers MadMapper"),
      p("Un bouton, avec confirmation, et rien d'autre. Déplacer une barre dans Cascade n'envoie "
        "aucune géométrie à MadMapper : le placement des surfaces est le travail du régisseur, "
        "on ne l'écrase pas dans son dos. Le renvoi est une opération de montage, pas de "
        "conduite."),
      PageBreak(),

# ── 7. Le champ 3D ───────────────────────────────────────────────────────────
      h1("7. Le moteur « Champ 3D »"),
      p("Un chase classique demande « quelle barre s'allume maintenant ? ». Le champ 3D pose une "
        "autre question : « quelle est la valeur de cet effet, ici, dans le volume ? ». Chaque "
        "barre lit la valeur du champ à l'endroit où elle se trouve réellement. Deux barres au "
        "même endroit sortent pareil ; deux barres éloignées sortent différemment, sans qu'on "
        "ait rien à programmer barre par barre."),
      p("Ce que le champ produit n'est qu'une grandeur, qui traverse ensuite EXACTEMENT la même "
        "chaîne que les autres moteurs : forme d'onde, niveau bas, niveau de couche, couleur, "
        "mixage HTP, master, courbe de gradateur, Ableton Link. Un plan orienté sur l'axe X "
        "rend d'ailleurs les mêmes valeurs qu'une vague « G › D » — c'est une généralisation, "
        "pas un second logiciel."),
      h2("7.1 — Les cinq formes"),
      li("Plan : une nappe qui balaie le volume, sur l'axe que vous choisissez (azimut et "
         "élévation). C'est la forme à essayer en premier ; sur l'axe de la profondeur, elle "
         "traverse la scène du public vers le fond."),
      li("Sphère : une onde qui part d'un point et grandit. Le point se règle, et « Centrer la "
         "source » le remet au milieu du plateau."),
      li("Cylindre : le phare. L'onde tourne autour d'un axe — un balayage circulaire."),
      li("Pavé : des coquilles rectangulaires emboîtées autour de la source. Plus anguleux que "
         "la sphère, il épouse mieux une scéno en cadre."),
      li("Bruit 3D : des taches organiques qui dérivent dans le volume. « Grain » règle leur "
         "taille, et le mouvement suit l'axe choisi."),
      h2("7.2 — Netteté et course"),
      li("Netteté (5 à 100 %) : quelle part de la longueur d'onde le motif occupe. À 100 % il "
         "remplit tout, et la moitié du plateau reste allumée en permanence. Serrez-la à 15 % "
         "et vous obtenez une lame fine qui traverse — c'est ce qui rend une comète possible."),
      li("Course : la source se déplace le long de l'axe au lieu de rester fixe. Sphère + course "
         "+ netteté serrée = une comète qui traverse le plateau."),
      h2("7.3 — Le repère dans la vue 3D"),
      p("Quand une couche « champ » est sélectionnée, la scène affiche l'axe en flèche, la "
        "source en croix, et sa course en trait épais. Un réglage abstrait devient un objet "
        "qu'on voit bouger : c'est le moyen le plus rapide de comprendre ce qu'on règle."),
      h2("7.4 — Les quatre démos"),
      p("Le bouton Démo installe en un clic une configuration complète : Profondeur, Comète, "
        "Phare, Feu. Avec les réglages d'usine, un champ rend presque exactement une vague, et "
        "on peut croire que rien ne marche. Les démos existent pour montrer ce que le moteur "
        "sait faire avant de commencer à le régler soi-même."),
      PageBreak(),

# ── 8. La profondeur ─────────────────────────────────────────────────────────
      h1("8. Faire ressortir la profondeur"),
      p("Le champ 3D place les effets dans l'espace, mais l'espace ne se VOIT pas pour autant : "
        "deux barres à cinq mètres l'une derrière l'autre, éclairées au même niveau, se lisent "
        "comme une seule surface. Ce chapitre réunit les quatre réglages qui font apparaître le "
        "volume. Ils se combinent, et c'est ensemble qu'ils sont convaincants."),
      h2("8.1 — Perspective atmosphérique"),
      p("Curseur « Profondeur », de 0 à 100 % par couche : les barres du lointain sortent plus "
        "sombres. C'est ce que fait l'air dans un vrai théâtre, et le brouillard dans un moteur "
        "3D. L'atténuation est calculée sur la cote du plateau que vous avez renseignée, donc "
        "le réglage garde son sens dans une autre salle. C'est le réglage à essayer en premier."),
      h2("8.2 — La palette suit la profondeur"),
      p("Avec une palette, un second réglage décide d'où vient la couleur de chaque barre : du "
        "MOTIF (l'animation, comme avant), de la PROFONDEUR, ou de la HAUTEUR. Branchée sur la "
        "profondeur, la couleur ne dépend plus que de la distance au public : chaud devant, "
        "froid derrière, et ça ne bouge pas quand le motif tourne."),
      note("C'est la seconde moitié du même mécanisme : la perspective agit sur l'intensité, "
           "la palette sur la teinte. L'œil se sert des deux pour juger une distance, et les "
           "avoir ensemble change franchement la lecture d'un volume. La palette « Distance » "
           "est faite pour ça."),
      h2("8.3 — Les modes de fusion"),
      p("Jusqu'ici les couches se mixaient toujours en HTP — la plus lumineuse gagne. C'est le "
        "réflexe des consoles, parfait pour empiler des chases, mais ça interdit de MÉLANGER. "
        "Sept modes sont désormais disponibles par couche :"),
      li("HTP (défaut) : la plus lumineuse gagne. Aucun projet existant ne change de rendu."),
      li("Multiplication : la couche devient un MASQUE. Un plan en profondeur posé en "
         "multiplication au-dessus d'une nappe ne laisse passer la lumière que dans la tranche "
         "que le plan éclaire. C'est la façon la plus directe de sculpter une profondeur."),
      li("Addition : deux nappes s'additionnent sans s'écraser — superpositions denses."),
      li("Soustraction : une couche creuse un trou dans une autre — un vide qui traverse."),
      li("Écran, Minimum, Remplacement : pour les cas particuliers."),
      note("Sauf pour HTP, addition et multiplication, l'ORDRE des couches compte : la couche "
           "du bas est le fond, celles du dessus s'y appliquent. L'infobulle le rappelle."),
      h2("8.4 — Le crossfader A / B"),
      p("Chaque couche se range dans le jeu A, le jeu B, ou nulle part — « Toujours », le "
        "défaut, une couche qui joue quoi qu'il arrive. Le crossfader du panneau Global passe "
        "de A à B. On prépare une ambiance sur le jeu inactif pendant que l'autre joue, puis "
        "on passe de l'une à l'autre en tenant le fader."),
      note("C'est la différence entre DÉCLENCHER et JOUER : un rappel de preset est un saut, "
           "un crossfader se tient à la main. Une console peut le tenir à votre place — "
           "adresse OSC /chaser/xfade, de 0 à 1."),
      p("Baisser le fader retire vraiment la couche : une couche en multiplication n'agit plus "
        "du tout, elle ne devient pas un masque noir qui éteindrait le reste."),
      h2("8.5 — Le décalage réparti"),
      p("« Décalage » décale toute la couche. « Décalage réparti » étale en plus un décalage de "
        "la PREMIÈRE barre à la DERNIÈRE : 360° = un cycle complet réparti sur la sélection. Des "
        "barres symétriques cessent de bouger à l'unisson. Combiné à « ordre = axe 3D », la "
        "vague traverse la scéno selon un axe réel, avec un seul réglage."),
      h2("8.6 — Le modulateur : faire respirer un réglage"),
      p("Chaque couche a un modulateur. On lui désigne UN réglage — niveau, largeur, "
        "vitesse, netteté, course, profondeur, décalage — et il le fait aller et venir "
        "tout seul entre deux bornes, en boucle. Quatre formes : sinus (respiration), "
        "triangle, rampe, créneau. La période va de un dixième de seconde à deux minutes."),
      note("Il ne modifie JAMAIS le réglage affiché : il se superpose. Le curseur reste là "
           "où vous l'avez laissé, et couper le modulateur vous rend la main immédiatement — "
           "sans redémarrer quoi que ce soit. C'est aussi pourquoi un projet enregistré "
           "pendant qu'un modulateur tourne garde VOS valeurs, pas celles de l'instant."),
      p("Les bornes s'écrivent dans l'unité du réglage visé — pour cent, degrés, "
        "multiplicateur. Une valeur hors plage est ramenée dans la plage, exactement comme "
        "si vous l'aviez saisie à la main : le modulateur ne peut rien casser."),
      li("Caler sur le tempo : la période devient un multiple du cycle de la couche "
         "au lieu d'une durée en secondes. Elle suit alors le tap tempo, la vitesse "
         "globale et Ableton Link toute seule — le modulateur ne dérive plus contre la "
         "musique quand on change de morceau."),
      li("Netteté qui respire lentement : le motif s'épaissit et s'affine, la scène « inspire »."),
      li("Course en rampe : la source repart du début à chaque tour — un balayage régulier."),
      li("Profondeur en sinus très lent : le lointain apparaît et disparaît, la scène "
         "gagne et perd son volume."),
      h2("8.7 — Le modulateur global"),
      p("Le même mécanisme, dans le panneau Global, sur trois réglages : le crossfader, "
        "le master, ou la vitesse globale. Sur le crossfader, la scène passe d'un jeu à "
        "l'autre toute seule — elle respire entre deux ambiances sans que personne ne "
        "tienne le fader. Calé sur le tempo, il prend le cycle de la première couche : "
        "il n'y a pas de tempo global dans Cascade, chaque couche a le sien."),
      note("Attention sur le Master : mettre 0 comme borne basse fait passer le show par "
           "le noir à chaque tour. C'est un effet légitime, donc ce n'est pas interdit — "
           "mais ça se choisit."),
      h2("8.8 — Le suiveur audio : faire respirer la lumière avec le son"),
      p("Le micro devient une SOURCE de modulateur, à côté de l\'oscillateur. On l\'active dans "
        "le panneau Global, repli « Suiveur audio », puis on choisit « Micro » comme Source sur "
        "le modulateur d\'une couche ou sur le modulateur global. Tout ce qu\'un modulateur "
        "pilotait, le son le pilote alors : niveau, largeur, netteté, profondeur, crossfader, "
        "master."),
      note("⚠ Il lit une ÉNERGIE, pas un tempo. Il fait respirer la lumière avec la musique ; "
           "il ne détecte pas les battements et ne cale pas le chase sur le rythme. Pour caler "
           "le tempo, c\'est le tap tempo ou Ableton Link."),
      note("⚠ Le micro n\'est lisible que sur la MACHINE OÙ TOURNE CASCADE. Les navigateurs "
           "interdisent l\'accès au micro depuis une adresse réseau : depuis un iPad, tout le "
           "reste fonctionne, mais pas l\'écoute. C\'est la même limite que le MIDI, qui "
           "n\'existe que sur Chrome et Edge."),
      li("Bande : grave suit la grosse caisse et la basse, aigu les cymbales et les voix, "
         "« tout le spectre » l\'énergie générale. Le grave est le plus musical pour de la "
         "lumière — c\'est lui qui porte la pulsation."),
      li("Seuil : une porte de bruit. En dessous, le son est considéré comme du silence. "
         "C\'est ce qui ignore la clim, le public et le souffle de la salle."),
      li("Gain : à monter si la lumière bouge à peine, à baisser si elle sature en permanence. "
         "Le vu-mètre montre exactement ce que Cascade entend, après tous les réglages."),
      li("Attaque et relâchement : l\'attaque décide de la vivacité sur un coup, le "
         "relâchement de la respiration. Relâchement court = ça hachure ; long = ça reste "
         "allumé. C\'est le réglage qui donne le caractère."),
      note("Sécurité : si le son cesse d\'arriver — onglet fermé, micro débranché, machine en "
           "veille — le réglage que VOUS aviez posé reprend la main en douceur. Il ne reste "
           "jamais figé sur la dernière valeur entendue, et ne tombe jamais au noir."),
      h2("8.9 — Une recette qui marche"),
      li("Une couche « champ / plan » sur l'axe de la profondeur, netteté 20 %, en fond."),
      li("Profondeur à 60 % : le lointain s'efface."),
      li("Palette Distance branchée sur la profondeur : le fond devient froid."),
      li("Une seconde couche en multiplication, forme sphère, course activée : une bulle "
         "claire circule et ne révèle la texture que là où elle passe."),
      PageBreak(),

# ── 9. Les vues ──────────────────────────────────────────────────────────────
      h1("9. Les vues : choisir l'axe de projection"),
      p("MadMapper ignore la troisième dimension. Une barre joue ce qu'elle lit À L'ENDROIT OÙ "
        "ELLE EST POSÉE dans la composition. Donc « projeter la texture sur l'axe de mon "
        "choix » revient à une seule question : où chaque barre va-t-elle lire ? Il n'y a pas "
        "d'autre levier — c'est mesuré, pas supposé."),
      h2("9.1 — Comment ça marche"),
      p("Chaque barre physique existe en plusieurs copies dans le projet MadMapper, TOUTES À LA "
        "MÊME ADRESSE DMX, chacune placée selon une projection différente : une pour la vue de "
        "face, une pour la vue de dessus, une pour le côté. Les copies d'une même vue vivent "
        "dans un DOSSIER portant le nom de la vue. Basculer d'un axe à l'autre, c'est allumer "
        "un dossier et éteindre les autres — un seul message, et rien ne se déplace pendant le "
        "spectacle."),
      note("Deux barres à la même adresse ne perturbent NI le DMX NI votre contrôleur : "
           "MadMapper résout le conflit avant d'émettre, et ce qui sort de la carte réseau est "
           "un univers Art-Net parfaitement ordinaire. Un PixLite, un BSP ou n'importe quel "
           "nœud reçoit ses 512 octets sans jamais savoir qu'il y a eu des copies en amont."),
      h2("9.2 — Créer et conduire les vues"),
      li("« Créer les surfaces » calcule où chaque barre doit aller pour une projection donnée "
         "et vous donne la liste à reproduire dans MadMapper — c'est un travail de montage, "
         "qu'on fait une fois."),
      li("« Ranger » recalcule le placement d'une vue existante."),
      li("En conduite, un bouton par vue. Le fondu est réglable : le dossier sortant baisse "
         "pendant que l'entrant monte."),
      li("Un voyant dit si le dossier existe vraiment côté MadMapper. Après un redémarrage, "
         "Cascade avoue qu'il ne sait pas quelle vue est active plutôt que de deviner."),
      li("La case « à moi » protège une vue que vous avez dessinée vous-même — la vue "
         "« dépliée », par exemple. Cascade ne la recalculera jamais."),
      h2("9.3 — Les deux pièges"),
      li("Une barre posée HORS de toute zone de composition joue du noir, sans que rien ne le "
         "signale. C'est la panne fantôme la plus probable : si une vue reste éteinte, c'est "
         "la première chose à vérifier."),
      li("Le nombre de fixtures est multiplié par le nombre de vues — 24 barres × 3 vues = 72 "
         "fixtures dans le projet. Nommez vos dossiers proprement dès le début."),
      h2("9.4 — La coupure de secours"),
      p("Quand une texture joue, BLACKOUT ne suffit pas : il met à zéro ce que Cascade pilote, "
        "mais la texture continue d'alimenter les barres par d'autres chemins. La COUPURE met "
        "la sortie DMX de MadMapper elle-même à zéro. C'est la seule voie qui coupe vraiment."),
      note("Elle est volontairement séparée de BLACKOUT, et un bandeau rouge impossible à "
           "manquer reste affiché tant qu'elle est active — pour qu'on ne cherche jamais "
           "pourquoi « plus rien ne s'allume »."),

# ── 7. Presets et projets ────────────────────────────────────────────────────
      h1("10. Presets, projets et sauvegarde"),
      li("Presets (1-16), GRILLE en haut : photographient toutes les couches. Sauver puis clic "
         "sur un pavé = mémorise ; clic simple = rappel instantané en live. La grille tient sur "
         "deux rangées de huit sur un ordinateur, quatre sur quatre sur une tablette — les "
         "pavés ne bougent donc pas de place quand on redimensionne la fenêtre, ce qui compte "
         "quand on vise une case dans le noir."),
      li("Chaque pavé porte une BANDE DE COULEUR : une case par barre que le preset pilote, "
         "teintée comme la couche qui la pilote. ⚠ C\'est une COUVERTURE, pas une image du "
         "motif — un chase n\'allume qu\'une barre à la fois, une photo serait presque vide. "
         "Elle répond à « qu\'est-ce que ce preset va allumer ? », pas à « à quoi il ressemble »."),
      li("Le pavé orange est le dernier preset rappelé — celui qui joue. Pendant un fondu, on "
         "voit en même temps celui d\'où l\'on vient."),
      li("Un pavé au bord en POINTILLÉ ne pilote plus aucune barre : son groupe a été vidé, ou "
         "les barres qu\'il visait ont disparu. Le rappeler ne donnerait rien. C\'est "
         "l\'information la plus utile de la grille, et c\'est pour ça qu\'elle est montrée "
         "au lieu d\'être masquée."),
      li("Fondu entre presets (panneau Vitesse, réglage « Fondu presets ») : à 0 le rappel "
         "est sec. Au-delà, la scène sortante CONTINUE DE JOUER et décroît pendant que la "
         "nouvelle monte — les deux chases tournent en parallèle, ce n'est pas un passage par "
         "le noir. Un filet orange sous la rangée de presets montre où en est le fondu. "
         "STOP et BLACKOUT l'interrompent immédiatement."),
      li("Nommez-les : à l'enregistrement, Cascade demande un nom (laisser vide garde le "
         "numéro), et un double-clic sur un slot le renomme. En conduite, on cherche "
         "« Refrain » beaucoup plus vite que « P7 ». Le numéro reste affiché en petit — c'est "
         "lui qui compte pour le MIDI et l'OSC."),
      li("Tout est sauvegardé en continu et automatiquement (avec copie de secours) : en cas de "
         "coupure ou en quittant, on retrouve son état exact au relancement. La dernière "
         "modification est garantie écrite avant chaque fermeture."),
      li("Projet (bouton dossier) : Sauvegarder exporte tout (fixtures, couches, presets, "
         "réglages) dans un fichier .json nommé ; Charger le restaure ; Nouveau réinitialise en "
         "proposant de garder la scéno. Faites-vous une bibliothèque par salle ou par spectacle."),
      li("Le nom du projet est mémorisé et embarqué dans le fichier : il est proposé par défaut "
         "au prochain export."),
      li("En quittant (bouton Quitter), si des réglages ont changé depuis le dernier export, Cascade "
         "le signale et propose « Exporter puis quitter » avec le nom de votre choix. Rien "
         "n'est perdu dans tous les cas : c'est une commodité pour tenir sa bibliothèque à jour."),

# ── 8. MIDI / OSC ────────────────────────────────────────────────────────────
      h1("11. Contrôle MIDI et OSC"),
      h2("11.1 — MIDI (bouton clavier, en haut)"),
      p("Sur Chrome ou Edge, avec le contrôleur branché sur l'ordinateur : cliquer Learn sur une "
        "cible puis bouger un potard ou appuyer une touche. Le mapping est enregistré "
        "définitivement. Cibles : master, vitesses, start/stop/blackout, tap, temps/pas, niveau, "
        "pattern, miroirs, couche on/off et les 16 presets. Les cibles « couche sél. » suivent "
        "la couche en cours d'édition."),
      h2("11.2 — OSC entrant (TouchOSC, console, QLab…)"),
      p("Envoyer sur le port 7000 (réglable) de la machine où tourne l'app. Valeurs normalisées "
        "0-1 ; pour les vitesses, 0.5 = ×1. Les nouveaux réglages de chase sont pilotables de "
        "la même façon : /cascade/presetfade règle le fondu entre presets (0 à 10 s), et "
        "par couche : floor (niveau bas), phase, swing (0.5 = pas de swing), blocks, "
        "sparkle, oneshot, et go pour relancer un cycle."),
      code("/cascade/start /cascade/stop /cascade/blackout /cascade/tap /cascade/resync\n"
           "/cascade/master 0-1  /cascade/speed 0-1 (0.5 = x1)\n"
           "/cascade/link 0-1 (Ableton Link off/on)\n"
           "/cascade/preset/1 ... /cascade/preset/16\n"
           "/cascade/layer/1/level | stepms | speed | pattern | enable\n"
           "/cascade/layer/1/mirrorh | mirrorv | invert | width | group | tap"),
      PageBreak()]

# ── 9. Dépannage ─────────────────────────────────────────────────────────────
E.append(h1("12. Dépannage"))
rows = [
    ["Problème", "Solution"],
    ["Rien ne bouge dans MadMapper",
     "Bouton Diagnostic : il liste les contrôles réels et propose le bon paramètre "
     "(luminosity pour les fixtures DMX, opacity pour les surfaces). Vérifier aussi l'IP et "
     "le port OSC dans les réglages, et que l'entrée OSC est activée dans MadMapper."],
    ["Le scan ne trouve rien",
     "Préférences MadMapper → OSC : entrée 8000 et feedback 9000 activés. Sinon, clic droit "
     "sur l'opacité d'une fixture dans MadMapper → copier l'adresse OSC → bouton « + Manuel »."],
    ["L'iPad ne se connecte pas",
     "Même réseau Wi-Fi, IP correcte, et pare-feu Windows : autoriser Node.js sur les "
     "réseaux privés."],
    ["« Port occupé » au lancement",
     "L'app bascule automatiquement sur le port suivant (3334, 3335…) — l'adresse exacte "
     "s'affiche en haut de l'interface. Souvent : deux lancements simultanés."],
    ["LINK reste sur « connexion… » ou affiche « module absent »",
     "Le module Link (Carabiner) n'est pas installé : relancer le lanceur Cascade avec une "
     "connexion internet (téléchargement ~2 Mo, une seule fois). Vérifier aussi que Pulse ou "
     "Live a bien Link activé, sur le même réseau."],
    ["LINK affiche un BPM mais « en attente »",
     "Cascade est seul dans la session Link : lancer Pulse/Live sur le même réseau (et même "
     "Wi-Fi), Link activé. Le nombre d'appareils s'affiche à côté du BPM."],
    ["La fenêtre s'est fermée mais Cascade tourne encore",
     "C'est voulu : les chasers tournaient (le show n'est jamais coupé). Relancer le lanceur "
     "rouvre la fenêtre ; STOP puis Quitter (ou fermer) arrête tout."],
    ["Config corrompue / coupure de courant",
     "Une copie de secours (.bak) est restaurée automatiquement au démarrage."],
    ["Le MIDI ne répond pas",
     "Utiliser Chrome ou Edge sur l'ordinateur où le contrôleur est branché (Safari et "
     "l'iPad ne gèrent pas le Web MIDI). Vérifier le mapping dans le dialogue MIDI."],
    ["Mac : « fichier non ouvrable »",
     "Clic droit → Ouvrir la première fois. Si besoin : chmod +x sur le .command. "
     "Pour l'exécutable autonome : xattr -cr <fichier> puis chmod +x <fichier>."],
    ["La pastille MadMapper reste rouge",
     "MadMapper est-il lancé, avec un projet ouvert ? Préférences → OSC : entrée 8000 ET "
     "feedback 9000 activés, et les mêmes valeurs dans les réglages de Cascade. Si Cascade "
     "et MadMapper sont sur deux machines, vérifier l'adresse IP et le pare-feu. "
     "Note : si vos barres s'allument correctement, tout va bien — seul le retour manque."],
    ["Un réglage de chase semble sans effet",
     "Vérifier que la couche sélectionnée (pastille surlignée) est bien celle qui pilote ces "
     "barres, et qu'elle est active. Swing, Blocs, Scintillement et Une fois ne concernent "
     "que le moteur Pas à pas : ils disparaissent en mode Vague."],
    ["Le chase ne repart pas en mode « Une fois »",
     "C'est le principe : un seul cycle, puis silence. Appuyer sur GO (ou envoyer "
     "/cascade/layer/N/go) pour relancer."],
]
tdata = [[Paragraph(r[0], S["tch" if i == 0 else "tc"]),
          Paragraph(r[1], S["tch" if i == 0 else "tc"])] for i, r in enumerate(rows)]
t = Table(tdata, colWidths=[47 * mm, 123 * mm])
t.setStyle(TableStyle([
    ("GRID", (0, 0), (-1, -1), 0.6, BORD),
    ("BACKGROUND", (0, 0), (-1, 0), LIGHT),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
]))
E.append(t)

# ── 10. Notes techniques ─────────────────────────────────────────────────────
E += [h1("13. Raccourcis clavier et gestes"),
      p("Le bouton « ? » en haut de l'interface (ou la touche ? ou H) affiche cette liste "
        "à tout moment. Les raccourcis sont ignorés pendant une saisie de texte et lorsqu'une "
        "fenêtre de dialogue est ouverte."),
      li("S : démarrer ou arrêter les chasers. B : blackout immédiat."),
      li("Espace : tap tempo sur la couche sélectionnée."),
      li("R : resync — relance tous les chasers ensemble, à taper sur le temps fort."),
      li("G : GO — relance le cycle de la couche sélectionnée (mode « une fois »)."),
      li("1 à 8 : sélectionner une couche."),
      li("Double-clic sur une ligne de réglage : retour à la valeur par défaut."),
      li("Double-clic sur un nom de couche : renommer. Sur un preset : renommer. "
         "Sur une barre de la vue spatiale : la faire pivoter."),
      li("Glisser une barre dans la vue spatiale : la déplacer."),
      note("Sur iPad, un double-tap remplace partout le double-clic."),

      h1("14. Notes techniques"),
      li("Aucune installation système : le moteur Node.js portable et le module Link vivent "
         "dans le dossier de l'app."),
      li("Le dossier est autonome : copier le dossier = installer l'app ailleurs."),
      li("Sortie OSC ~40 images/s vers MadMapper, uniquement quand les valeurs changent."),
      li("Fonctionne hors ligne (après le premier lancement) ; Ableton Link fonctionne en "
         "réseau local, sans internet. Aucun compte, aucune donnée envoyée."),
      li("Une erreur interne n'arrête jamais le serveur : le show continue."),
      li("Fermer la dernière fenêtre arrête le serveur au bout de quelques secondes — sauf "
         "show en cours ou contrôle OSC actif. La configuration est toujours écrite sur le "
         "disque avant l'arrêt."),
      li("Une seule instance tourne à la fois : relancer Cascade rouvre la fenêtre existante."),
      li("Licence MIT — code ouvert, réutilisable et modifiable."),
      Spacer(1, 16 * mm),
      rule(),
      Spacer(1, 3 * mm),
      Paragraph("Cascade — version %s" % VERSION, S["center"]),
      Spacer(1, 2 * mm),
      Paragraph("Pierre-Yves Mansour — Collectif WSK", S["sig"])]

def _controle_glyphes(flowables, fichiers):
    """Un glyphe absent de la police sort en CARRÉ VIDE, et ça ne se voit qu'une
    fois le PDF sous les yeux — souvent après l'avoir envoyé. On refuse donc de
    générer un manuel dont un caractère ne serait pas dessinable.

    Le piège est réel : les symboles ⏻ ⧉ ⚠ ✔ et les exposants Unicode manquent
    de Segoe UI comme de DejaVu. Les repérer ici évite de relire treize pages."""
    from reportlab.pdfbase.ttfonts import TTFontFile
    textes = []
    def _ramasser(f):
        for attr in ("text", "_text"):
            t = getattr(f, attr, None)
            if isinstance(t, str):
                textes.append(t)
        for attr in ("lines", "_cellvalues", "_content"):
            sous = getattr(f, attr, None)
            if isinstance(sous, (list, tuple)):
                for x in sous:
                    if isinstance(x, str):
                        textes.append(x)
                    elif isinstance(x, (list, tuple)):
                        for y in x:
                            (_ramasser(y) if hasattr(y, "__dict__") else
                             textes.append(y) if isinstance(y, str) else None)
                    elif hasattr(x, "__dict__"):
                        _ramasser(x)
    for f in flowables:
        _ramasser(f)
    chars = {c for t in textes for c in t if ord(c) > 127}
    fautifs = {}
    for chemin in fichiers:
        try:
            cmap = set(TTFontFile(chemin).charToGlyph.keys())
        except Exception:
            continue
        for c in chars:
            if ord(c) not in cmap:
                fautifs.setdefault(c, []).append(os.path.basename(chemin))
    if fautifs:
        # ⚠ La console Windows est en cp1252 : imprimer le caractère fautif ferait
        # planter le rapport sur une UnicodeEncodeError, juste au moment où on a
        # besoin de le lire. On n'imprime donc que des codepoints et un extrait
        # débarrassé de tout non-ASCII.
        def _sur(t):
            return "".join(ch if ord(ch) < 128 else "." for ch in t)
        print("ATTENTION - caracteres absents de la police (ils sortiraient en carre vide) :")
        for c, ou in sorted(fautifs.items(), key=lambda kv: ord(kv[0])):
            extrait = next((t for t in textes if c in t), "")
            i = extrait.index(c)
            print("  U+%04X absent de %s : ...%s[ICI]%s..."
                  % (ord(c), ", ".join(ou), _sur(extrait[max(0, i - 30):i]),
                     _sur(extrait[i + 1:i + 30])))
        raise SystemExit("Manuel NON généré : corrigez ces caractères d'abord.")
    print("Glyphes : %d caractères non-ASCII, tous dessinables." % len(chars))


_controle_glyphes(E, _f)
doc.build(E)
print("OK :", out)
