#!/bin/bash
# restart.sh - startet die TankLog-Anwendung mit docker compose

set -e

cd "$(dirname "$0")"

# Build-Meta aus neuester Datei erzeugen (für In-App Build-Check)
if [ -x "scripts/update-build-meta.sh" ]; then
  ./scripts/update-build-meta.sh
fi

# Stoppe alte Services falls vorhanden
if [ -d "html" ] && [ -f "html/docker-compose.yml" ]; then
  echo "Stoppe alte Services aus html/..."
  (cd html && docker compose down) || true
fi

# Stoppe alle html- Container manuell falls noch vorhanden
for container in $(docker ps -a --filter "name=html-" --format "{{.Names}}"); do
  echo "Stoppe Container: $container"
  docker rm -f "$container" || true
done

echo "Stoppe aktuelle Services falls laufend..."
docker compose down || true

echo "Starte TankLog-Dienste mit docker compose..."
docker compose up --build -d

echo ""
echo "TankLog läuft auf:"
echo "  App: http://chelvm01.lanicornia.de:8181"
echo "  (Backend-API wird über Port 8181 proxied)"
echo ""
echo "Zum Stoppen: docker compose down"
echo "Logs anzeigen: docker compose logs -f"
