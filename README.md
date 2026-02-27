# TankLog 🚗⛽

**Lokale Web-App für Paare / Haushalte** — Fahrzeugverwaltung, Tankvorgänge, Wartung, Kosten.

---

## Schnellstart (lokal, sofort nutzbar)

```bash
# In den Projektordner wechseln:
cd tanklog

# Option 1: Python 3 (meist vorinstalliert)
python3 -m http.server 8080

# Option 2: Python 2
python -m SimpleHTTPServer 8080

# Option 3: Node.js
npx serve .

# Dann im Browser öffnen:
# http://localhost:8080
```

---

## NAS / CouchDB Sync (für 2 Personen)

### Schritt 1: CouchDB auf NAS starten (Docker)

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

### Schritt 2: Datenbank + CORS einrichten

Im Browser öffnen: `http://NAS-IP:5984/_utils`

1. **Datenbank anlegen:** Name `tanklog`
2. **CORS aktivieren:**
   - Admin > Config > CORS
   - Enable CORS, Origins: `*` (oder deine spezifische IP)

Oder per curl:
```bash
# DB anlegen
curl -X PUT http://admin:deinPasswort@NAS-IP:5984/tanklog

# CORS aktivieren
curl -X PUT http://admin:deinPasswort@NAS-IP:5984/_node/nonode@nohost/_config/cors/origins \
  -H "Content-Type: application/json" -d '"*"'
curl -X PUT http://admin:deinPasswort@NAS-IP:5984/_node/nonode@nohost/_config/cors/credentials \
  -H "Content-Type: application/json" -d '"true"'
curl -X PUT http://admin:deinPasswort@NAS-IP:5984/_node/nonode@nohost/_config/cors/methods \
  -H "Content-Type: application/json" -d '"GET, PUT, POST, HEAD, DELETE"'
curl -X PUT http://admin:deinPasswort@NAS-IP:5984/_node/nonode@nohost/_config/cors/headers \
  -H "Content-Type: application/json" -d '"accept, authorization, content-type, origin, referer"'
```

### Schritt 3: In der App verbinden

- Tab **Sync** → CouchDB URL: `http://192.168.1.100:5984/tanklog`
- Benutzer + Passwort eintragen → **Verbinden**
- Status zeigt "Verbunden — Live-Sync aktiv"

**Beide Personen** tragen dieselbe URL ein → Daten synchronisieren sich automatisch!

---

## Funktionen

### 🚗 Garage
- Mehrere Fahrzeuge anlegen
- Felder: Name, Marke, Modell, Baujahr, Kennzeichen, VIN, Motorcode, Reifengröße, Öl-Spezifikation

### ⛽ Tanklog
- Datum, km-Stand, Liter, Euro
- Automatisch: €/L, gefahrene km, L/100km, Kosten/100km
- Warnung bei unrealistischen Werten
- "Nicht vollgetankt" Checkbox → Eintrag aus Statistik ausschließen
- Bearbeiten / Löschen mit Konsistenz-Neuberechnung

### 🔧 Wartung
- TÜV, Ölwechsel, Inspektion, Reifenwechsel, Sonstiges
- Fälligkeitsdatum + km-Fälligkeit
- Erinnerung X Tage/km vorher
- **ICS Export** für Kalender (iPhone, Android, Outlook)
- Dashboard zeigt bald fällige Wartungen

### 💰 Kosten
- Versicherung, Steuer, Reparatur, Werkstatt, Reinigung, …
- Auswertung nach Kategorie mit Balkendiagramm

### 📊 Analyse
- Zeitraum: Gesamt / 12 / 6 / 3 Monate
- Charts: Verbrauch, Kraftstoffpreis, monatliche Kosten
- Statistiken: Ø Verbrauch (gesamt + letzte 5), Ø €/L, Kosten/100km

### 🔄 Sync / Backup
- **CouchDB Live-Sync** (NAS) — automatisch, offline-first
- **JSON Export/Import** — vollständiges Backup mit Merge/Replace
- **CSV Import** — Google Sheets Export (deutsch, Dezimalkomma)

---

## CSV Import Format

```csv
datum,kmstand,liter,euro,notiz
06.02.2016,42888,"45,21","53,3",
13.02.2016,43278,"28,86","32,29",Shell A7
```

Unterstützt: `,` `;` `\t` als Trennzeichen, `dd.mm.yyyy` und `yyyy-mm-dd`, Dezimalkomma.

---

## Datenspeicherung

- **Lokal:** PouchDB → IndexedDB im Browser
- **Sync:** PouchDB ↔ CouchDB (NAS), live mit auto-retry
- **Konfliktlösung:** last-write-wins per `updatedAt` Timestamp
- **Offline-first:** App funktioniert ohne NAS, synct sobald erreichbar

---

## Tech Stack

| Bibliothek | Version | Zweck |
|-----------|---------|-------|
| PouchDB | 8.0.1 | Lokale DB + Sync |
| Chart.js | 4.4.0 | Charts |
| Google Fonts | — | Syne + JetBrains Mono + Mulish |

Keine Build-Tools, kein Node.js nötig — pure HTML/CSS/JS.
