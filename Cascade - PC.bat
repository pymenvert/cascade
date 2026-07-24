@echo off
rem  Cascade v1.2 - Sequenceur LED pour MadMapper - Collectif WSK
rem  Double-clic : installe le moteur si besoin (une seule fois, fenetre visible),
rem  puis relance Cascade SANS fenetre : l'interface s'ouvre comme un vrai logiciel.
rem  Pour quitter Cascade : bouton d'arret en haut a droite de l'interface.

if "%~1"=="run" goto :run

title Cascade - Sequenceur LED pour MadMapper - Collectif WSK
cd /d "%~dp0"

if not exist "server.js" (
  echo  ERREUR : server.js introuvable. Lance ce fichier depuis le dossier de l'application.
  pause
  exit /b 1
)

rem -- Moteur Node : deja sur la machine, deja telecharge, ou a installer --
set "NODE="
where node >nul 2>nul
if %errorlevel%==0 set "NODE=node"
if not defined NODE if exist "runtime\node.exe" set "NODE=runtime\node.exe"
if not defined NODE (
  echo.
  echo  Cascade - premier lancement : installation du moteur ^(une seule fois, ~30 Mo^)...
  echo.
  powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.18.1/node-v20.18.1-win-x64.zip' -OutFile 'node_tmp.zip'"
  if not exist node_tmp.zip (
    echo  ERREUR : telechargement impossible. Verifie ta connexion internet.
    pause
    exit /b 1
  )
  powershell -NoProfile -Command "Expand-Archive -Path 'node_tmp.zip' -DestinationPath '_nodetmp' -Force"
  move "_nodetmp\node-v20.18.1-win-x64" "runtime" >nul
  del node_tmp.zip
  rmdir "_nodetmp" 2>nul
  set "NODE=runtime\node.exe"
  echo  Moteur installe.
)

rem -- Module Ableton Link (Carabiner) : optionnel, ~2 Mo, une seule fois --
if not exist "runtime\carabiner.exe" (
  if not exist "runtime" mkdir "runtime"
  echo  Installation du module Ableton Link ^(une seule fois, ~2 Mo^)...
  powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/Deep-Symmetry/carabiner/releases/download/v1.2.0/Carabiner_Win_x64.zip' -OutFile 'cbn_tmp.zip'" 2>nul
  if exist cbn_tmp.zip (
    powershell -NoProfile -Command "Expand-Archive -Path 'cbn_tmp.zip' -DestinationPath '_cbntmp' -Force"
    for /r "_cbntmp" %%f in (*.exe) do move /y "%%f" "runtime\carabiner.exe" >nul
    del cbn_tmp.zip
    rmdir /s /q "_cbntmp" 2>nul
  )
  if not exist "runtime\carabiner.exe" echo  ^(Link indisponible pour l'instant - relance ce lanceur plus tard.^)
)

rem -- Relance de ce script en INVISIBLE : le serveur ouvre la fenetre de l'app --
set "VBS=%temp%\cascade_launch.vbs"
> "%VBS%" echo Set s = CreateObject("WScript.Shell")
>> "%VBS%" echo s.Run """%~f0"" run", 0, False
wscript //nologo "%VBS%"
exit /b 0

:run
rem -- Partie invisible : lance le serveur (qui ouvre la fenetre de l'app) --
cd /d "%~dp0"
set "NODE="
where node >nul 2>nul
if %errorlevel%==0 set "NODE=node"
if not defined NODE set "NODE=runtime\node.exe"
"%NODE%" server.js
exit /b 0
