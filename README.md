# TankLog

Lokale Web-App fuer Fahrzeugverwaltung, Tankvorgaenge, Wartung, Kosten und optionalen NAS-Sync.

## Backend fuer Schritt 1

Fuer den produktiven Mehrbenutzer-Betrieb gibt es jetzt ein separates Backend unter `backend/`. Das Seed unterstuetzt eine oder mehrere Garagen und ordnet Benutzer eindeutig je Garage zu.

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
  -d '{"username":"ich","password":"Test1234!"}'
```

### Seed-Daten

Beim ersten Start werden automatisch angelegt (idempotent):

- Garage: `Haushalt`
- User 1: `ich` / `Test1234!`
- User 2: `partner` / `Test1234!`

Optional kannst du mehrere Garagen auf einmal seeden:

```env
SEED_GARAGES=[{"name":"Haushalt","users":["ich","partner"],"password":"Haushalt123!"},{"name":"Firma","users":["chef","flotte"],"password":"Firma123!"}]
SEED_PASSWORD=Test1234!
```

Hinweise:

- `SEED_GARAGES` hat Vorrang vor `SEED_GARAGE_NAME`, `SEED_USER1_EMAIL`, `SEED_USER2_EMAIL`.
- Ein Benutzername darf in `SEED_GARAGES` nur einmal vorkommen.
- Benutzernamen werden im Seed auf Kleinbuchstaben normalisiert.
- Optionales `password` pro Garage überschreibt `SEED_PASSWORD` für alle Benutzer dieser Garage.

### API-Endpunkte

- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/logout`
- `GET /api/fuel-prices/insight` (Preisradar, optional)
- `GET /api/fuel-prices/stations/search` (Tankstellen suchen)
- `GET|PUT /api/fuel-prices/stations/preferences` (Lieblingstankstellen je Garage)
- `GET|POST /api/vehicles`
- `GET|PUT|DELETE /api/vehicles/:id`
- `GET|POST /api/refuels`
- `GET|PUT|DELETE /api/refuels/:id`
- `GET|POST /api/maintenance`
- `GET|PUT|DELETE /api/maintenance/:id`
- `GET|POST /api/costs`
- `GET|PUT|DELETE /api/costs/:id`

### Kostenloses Preisradar

Das Home-Widget kann aktuelle Tankpreise abrufen, mit dem 30-Tage-Verlauf vergleichen und "jetzt guenstig" markieren.
Es nutzt eine lokale JSON-Historie unter `/data`, also ohne Zusatzkosten.

Konfiguration in `.env`:

```env
FUEL_PRICE_PROVIDER=tankerkoenig
TANKERKOENIG_API_KEY=<dein_kostenloser_api_key>
TANKERKOENIG_STATION_IDS=<id1>,<id2>
TANKERKOENIG_STATION_IDS_BY_GARAGE={"Moorgarage":["id1","id2"],"FehnGarage":["id3","id4"]}
FUEL_PRICE_CHEAP_THRESHOLD_PCT=5
FUEL_PRICE_CACHE_MINUTES=60
FUEL_PRICE_BACKGROUND_SNAPSHOTS=false
```

Wenn API-Key oder Stationsliste fehlen, bleibt das Widget deaktiviert und zeigt einen Hinweis.
`FUEL_PRICE_CACHE_MINUTES` steuert, wie selten externe Abrufe passieren (mindestens 5 Minuten, Standard 60).
Eine `id` ist immer eine einzelne Tankstelle (keine Gruppe).
Mit `TANKERKOENIG_STATION_IDS_BY_GARAGE` kann jede Garage ihre eigene Stationsliste haben.
Im UI koennen je Garage eigene Lieblingstankstellen gewaehlt werden; diese haben Vorrang vor den Defaults aus `.env`.
Das Preisradar bietet Scope-Umschaltung (Favoriten vs. gesamte Garagen-Gegend), startet standardmaessig mit Favoriten.
Die API-Abfrage an `prices.php` wird automatisch auf maximal 10 Stations-IDs pro Request aufgeteilt.
`FUEL_PRICE_BACKGROUND_SNAPSHOTS` ist standardmaessig `false`, damit ohne Nutzeraktion keine dauerhaften Hintergrundabrufe laufen.
Externe Abrufe werden zusaetzlich begrenzt: ohne `force` wird nur neu abgefragt, wenn der letzte Messpunkt mindestens 60 Minuten alt ist.
Analyse zeigt 30 Tage oder 6 Monate als Tagesdurchschnitt sowie 7 Tage stündlich (aus vorhandenen Messpunkten).
Warnungs- und Radar-Einstellungen (z. B. Verbrauchsgrenze, Erinnerungstage, E5/E10 fuer Benzin) werden pro Garage serverseitig gespeichert.
Eine versteckte Kartenansicht (Einstellungen → Preisradar-Karte) zeigt eine aktuelle Preis-Uebersicht fuer die Garagen-Gegend.

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
