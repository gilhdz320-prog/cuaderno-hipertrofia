#!/bin/bash
# Genera cuaderno-bloque.pdf desde la pestaña "El bloque".
set -euo pipefail
cd "$(dirname "$0")/.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [ ! -x "$CHROME" ]; then
  CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
fi
if [ -z "$CHROME" ] || [ ! -x "$CHROME" ]; then
  echo "Necesito Chrome o Chromium para generar el PDF." >&2
  exit 1
fi

"$CHROME" --headless=new --disable-gpu --no-sandbox --no-pdf-header-footer \
  --virtual-time-budget=5000 \
  --print-to-pdf="$PWD/cuaderno-bloque.pdf" "file://$PWD/index.html#bloque" 2>/dev/null

echo "cuaderno-bloque.pdf"
