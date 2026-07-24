#!/bin/bash
# Cascade v1.2 — séquenceur LED pour MadMapper
# Pierre-Yves Mansour / Collectif WSK
# Lanceur Mac (double-clic dans le Finder).
# Installe le moteur si besoin (une seule fois), puis lance Cascade en
# arrière-plan et ferme cette fenêtre Terminal : l'interface s'ouvre dans
# sa propre fenêtre, comme un vrai logiciel. Pour quitter Cascade :
# bouton d'arrêt en haut à droite de l'interface.
cd "$(dirname "$0")"

if [ ! -f server.js ]; then
  echo "  ERREUR : server.js introuvable. Lance ce fichier depuis le dossier de l'application."
  read -r -p "  Appuie sur Entrée pour fermer." _
  exit 1
fi

# ── Moteur Node : déjà sur la machine, déjà téléchargé, ou à installer ──
NODE=""
if command -v node >/dev/null 2>&1; then
  NODE="node"
elif [ -x "runtime/bin/node" ]; then
  NODE="runtime/bin/node"
else
  echo ""
  echo "  Cascade — premier lancement : installation du moteur (une seule fois, ~45 Mo)..."
  echo ""
  V=v20.18.1
  case "$(uname -m)" in
    arm64) A=arm64 ;;   # Apple Silicon (M1/M2/M3/M4)
    *)     A=x64 ;;     # Intel
  esac
  curl -L --fail -o node_tmp.tar.gz "https://nodejs.org/dist/$V/node-$V-darwin-$A.tar.gz" || {
    echo "  ERREUR : téléchargement impossible. Vérifie ta connexion internet."
    read -r -p "  Appuie sur Entrée pour fermer." _
    exit 1
  }
  mkdir -p runtime
  tar -xzf node_tmp.tar.gz -C runtime --strip-components=1
  rm node_tmp.tar.gz
  NODE="runtime/bin/node"
  echo "  Moteur installé."
fi

# ── Module Ableton Link (Carabiner) : optionnel, ~2 Mo, une seule fois ──
if [ ! -x "runtime/carabiner" ]; then
  echo "  Installation du module Ableton Link (une seule fois, ~2 Mo)..."
  if curl -L --fail -sS -o cbn_tmp.dmg "https://github.com/Deep-Symmetry/carabiner/releases/download/v1.2.0/Carabiner_Mac.dmg" 2>/dev/null; then
    MNT="$(mktemp -d)"
    if hdiutil attach cbn_tmp.dmg -nobrowse -quiet -mountpoint "$MNT" 2>/dev/null; then
      mkdir -p runtime
      BIN="$(find "$MNT" -type f -name 'Carabiner*' -perm +111 2>/dev/null | head -1)"
      [ -z "$BIN" ] && BIN="$(find "$MNT" -type f -name 'Carabiner*' 2>/dev/null | head -1)"
      if [ -n "$BIN" ]; then
        cp "$BIN" runtime/carabiner && chmod +x runtime/carabiner
        xattr -cr runtime/carabiner 2>/dev/null
      fi
      hdiutil detach "$MNT" -quiet 2>/dev/null
    fi
    rm -f cbn_tmp.dmg
  fi
  [ -x "runtime/carabiner" ] || echo "  (Link indisponible pour l'instant — relance ce lanceur plus tard.)"
fi

# ── Lancement en arrière-plan : l'interface s'ouvre dans sa propre fenêtre ──
nohup "$NODE" server.js >/dev/null 2>&1 &
disown

# Ferme la fenêtre Terminal de ce lanceur (l'app, elle, reste ouverte).
(sleep 0.3; osascript -e 'tell application "Terminal" to close (every window whose name contains ".command")' >/dev/null 2>&1) &
exit 0
