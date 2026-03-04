# TankLog

Lokale Web-App fuer Fahrzeugverwaltung, Tankvorgaenge, Wartung, Kosten und optionalen NAS-Sync.

## Backend fuer Schritt 1

Fuer den produktiven Mehrbenutzer-Betrieb gibt es jetzt ein separates Backend unter `backend/`. Es fuehrt genau zwei Benutzer in einer gemeinsamen Garage zusammen und bleibt fuer spaetere Mehr-Garagen-Logik sauber erweiterbar.

### Architektur

- Backend: Node.js + Express + Prisma
- Datenbank: PostgreSQL
- Passwort-Hashing: bcrypt mit Cost-Factor 12
- Auth: JWT mit Ablaufzeit und serverseitigem Logout ueber `tokenVersion`

Warum JWT statt Session:

- Das aktuelle Frontend ist statisch und separat vom Backend auslieferbar, daher ist ein stateless API-Token fuer Schritt 1 einfacher zu deployen.
- Logout ist trotzdem serverseitig wirksam: Beim Logout wird `tokenVersion` am User erhoeht, alte Tokens werden dadurch sofort ungueltig.
- Diese Basis ist spaeter auch fuer weitere Clients oder ein separates Frontend nutzbar.

### Datenmodell

- `garages`: Team/Haushalt
- `users`: immer genau einer Garage zugeordnet
- `vehicles`, `refuels`, `maintenance`, `costs`: alle enthalten `garageId`
- Jede API-Route filtert serverseitig mit `garageId` des eingeloggten Users

### Fuel-Type Werte

Das Backend akzeptiert:

- `PETROL` / `Benzin`
- `DIESEL` / `Diesel`
- `HYBRID_PETROL` / `Hybrid (Benzin)`
- `HYBRID_DIESEL` / `Hybrid (Diesel)`
- `ELECTRIC` / `Elektro`
- `LPG`
- `CNG`
- `OTHER` / `Sonstiges`

### Deployment auf der Linux-VM

1. Konfiguration anlegen:

```bash
cp .env.example .env
```

2. Container starten:

```bash
docker compose up -d --build
```

Der App-Container fuehrt beim Start automatisch Migrationen und das idempotente Seed aus.

Danach reichen normale Neustarts mit:

```bash
docker compose up -d
```

Optional kannst du Migration und Seed auch explizit ausfuehren:

```bash
docker compose exec app npx prisma migrate deploy
docker compose exec app npm run db:seed
```

3. Health-Check:

```bash
curl http://localhost:3000/health
```

4. Login testen:

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ich@example.com","password":"Test1234!"}'
```

### Seed-Daten

Beim ersten Start werden automatisch angelegt:

- Garage: `Haushalt`
- User 1: `ich@example.com` / `Test1234!`
- User 2: `partner@example.com` / `Test1234!`

### API-Endpunkte

- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/logout`
- `GET|POST /api/vehicles`
- `GET|PUT|DELETE /api/vehicles/:id`
- `GET|POST /api/refuels`
- `GET|PUT|DELETE /api/refuels/:id`
- `GET|POST /api/maintenance`
- `GET|PUT|DELETE /api/maintenance/:id`
- `GET|POST /api/costs`
- `GET|PUT|DELETE /api/costs/:id`

Das bestehende Frontend ist damit noch nicht verbunden. Schritt 1 liefert bewusst erst die saubere Serverbasis.

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
