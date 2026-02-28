# TankLog

Lokale Web-App fuer Fahrzeugverwaltung, Tankvorgaenge, Wartung, Kosten und optionalen NAS-Sync.

## Schnellstart

Die App braucht einen HTTP-Server. `file://` reicht nicht.

```bash
# im Projektordner
python -m http.server 8080

# alternativ
npx serve .
```

Danach im Browser oeffnen: `http://localhost:8080`

## Funktionen

- Mehrere Fahrzeuge mit Garage und Fahrzeugauswahl
- Tankeintraege mit automatischer Berechnung von EUR/L, gefahrenen km, L/100 km und Kosten/100 km
- Teilfuellungen markieren, damit sie die Verbrauchsstatistik nicht verfaelschen
- OCR fuer Tankzettel direkt im Browser mit Tesseract.js
- Wartungen mit Faelligkeit, Erinnerungen und ICS-Export
- Kostenverwaltung mit Kategorien
- Analyse-Ansicht mit Kennzahlen und Charts
- JSON-Backup Export/Import
- CSV-Import fuer bestehende Tankdaten
- Optionaler Live-Sync per PouchDB <-> CouchDB

## Sync mit CouchDB

1. CouchDB starten, z. B. per Docker:

```bash
docker run -d \
  --name couchdb \
  --restart unless-stopped \
  -p 5984:5984 \
  -e COUCHDB_USER=admin \
  -e COUCHDB_PASSWORD=deinPasswort \
  -v /volume1/docker/couchdb:/opt/couchdb/data \
  couchdb:3
```

2. Datenbank `tanklog` anlegen.
3. CORS in CouchDB aktivieren.
4. In TankLog unter `Sync / Backup` URL, Benutzer und Passwort eintragen.

Beispiel-URL: `http://192.168.1.100:5984/tanklog`

## CSV-Import

Beispiel:

```csv
datum,kmstand,liter,euro,notiz
06.02.2016,42888,"45,21","53,30",
13.02.2016,43278,"28,86","32,29",Shell A7
```

Unterstuetzt werden `,`, `;` und Tab als Trennzeichen sowie `dd.mm.yyyy` und `yyyy-mm-dd`.

## Datenspeicherung

- Lokal: PouchDB in IndexedDB
- Sync: optional via CouchDB
- Konfliktbehandlung beim Import: neuere `updatedAt`-Werte gewinnen
- Offline-first: lokale Nutzung funktioniert ohne NAS

## Tech-Stack

- PouchDB 8.0.1
- Chart.js 4.4.0
- Tesseract.js 5.x
- HTML, CSS, Vanilla JavaScript ohne Build-Tool

## Hinweis

Die App ist mobil optimiert und laesst sich auf dem Homescreen ablegen, nutzt aktuell aber keinen Service Worker und kein Web-App-Manifest.
