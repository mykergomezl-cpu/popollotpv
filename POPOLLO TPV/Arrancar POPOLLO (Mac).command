#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Falta Node.js. Descárgalo (versión LTS) en https://nodejs.org y vuelve a abrir este archivo."; read -p "Pulsa Intro para cerrar"; exit 1
fi
(sleep 2; open "http://localhost:8080") &
node --no-warnings server.js
