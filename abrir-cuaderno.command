#!/bin/bash
# Abre el cuaderno en el navegador.
# Intenta servirlo en local (almacenamiento fiable en cualquier navegador);
# si no puede, abre el archivo directamente.

cd "$(dirname "$0")" || exit 1
PORT=8765
FILE="index.html"
URL="http://127.0.0.1:$PORT/$FILE"

if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Ya hay un servidor en el puerto $PORT."
  open "$URL"
  exit 0
fi

python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SRV=$!

for i in 1 2 3 4 5 6; do
  sleep 0.5
  if curl -s --max-time 1 -o /dev/null "http://127.0.0.1:$PORT/$FILE"; then
    echo "Cuaderno de hipertrofia"
    echo "───────────────────────"
    echo "Abriendo $URL"
    echo
    echo "Deja esta ventana abierta mientras lo usas."
    echo "Tus datos se guardan en este navegador. Para cerrar: Ctrl+C."
    trap 'kill $SRV 2>/dev/null' EXIT INT TERM
    open "$URL"
    wait $SRV
    exit 0
  fi
done

kill $SRV 2>/dev/null
echo "No se pudo levantar el servidor local."
echo "Abriendo el archivo directamente (mejor en Chrome o Edge)."
open "$FILE"
