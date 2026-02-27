# TankLog — Vollständige Dokumentation

**Version 2.0 · Offline-first PWA · PouchDB + CouchDB Sync**

---

## Inhaltsverzeichnis

1. [Überblick](#überblick)
2. [Schnellstart](#schnellstart)
3. [Projektstruktur](#projektstruktur)
4. [Funktionen im Detail](#funktionen-im-detail)
   - [Garage & Fahrzeugverwaltung](#garage--fahrzeugverwaltung)
   - [Tanklog](#tanklog)
   - [OCR — Tankzettel scannen](#ocr--tankzettel-scannen)
   - [Wartung & Service](#wartung--service)
   - [Kosten](#kosten)
   - [Analyse & Charts](#analyse--charts)
   - [CSV Import](#csv-import)
   - [JSON Backup](#json-backup)
5. [Sync-Architektur](#sync-architektur)
6. [NAS/CouchDB Setup](#nascouchdb-setup)
7. [OCR — Technische Details](#ocr--technische-details)
8. [Fahrzeugdatenbank](#fahrzeugdatenbank)
9. [Datenmodell](#datenmodell)
10. [Konfiguration & Einstellungen](#konfiguration--einstellungen)
11. [Troubleshooting](#troubleshooting)

---

## Überblick

TankLog ist eine **kostenfreie, offline-first Web-App** für Paare und Haushalte zur gemeinsamen Verwaltung mehrerer Fahrzeuge.

### Kernprinzipien

| Prinzip | Umsetzung |
|---------|-----------|
| **0 € laufende Kosten** | Kein Cloud-Zwang, kein Abo |
| **Offline-first** | PouchDB → funktioniert ohne NAS |
| **Gemeinsame Daten** | PouchDB ↔ CouchDB auf eigenem NAS |
| **Privatsphäre** | OCR läuft 100% lokal im Browser |
| **Kein Build-Tool** | Pure HTML/CSS/JS, `python -m http.server` reicht |

### Was TankLog kann

- Mehrere Fahrzeuge verwalten (Golf, BMW, Transporter…)
- Tankvorgänge mit automatischer Verbrauchsberechnung
- **Tankzettel-OCR** — Foto knipsen, Werte werden automatisch ausgefüllt
- Wartungen mit ICS-Export für Kalender-Erinnerungen
- Sonstige Kosten (Versicherung, TÜV, Reparaturen)
- Auswertungs-Charts mit Zeitraumfilter
- Live-Sync zwischen zwei Geräten über CouchDB auf dem NAS

---

## Schnellstart

### Lokal (sofort, ohne NAS)

```bash
# Ordner entpacken/klonen
cd tanklog/

# Option A: Python 3
python3 -m http.server 8080

# Option B: Python 2
python -m SimpleHTTPServer 8080

# Option C: Node.js
npx serve .
# oder
npx http-server -p 8080

# Im Browser öffnen:
open http://localhost:8080
```

> **Hinweis:** Die App muss über einen HTTP-Server laufen (nicht `file://...`), da PouchDB und Tesseract.js einen HTTP-Kontext benötigen.

### Als PWA installieren (optional)

In Chrome/Safari: `⋮ Menü → Zum Startbildschirm hinzufügen`

Die App läuft dann wie eine native App und funktioniert offline.

---

## Projektstruktur

```
tanklog/
├── index.html       — App-Shell, alle Views & Overlays
├── style.css        — Design-System (Industrial Dark Theme)
├── app.js           — Haupt-Controller, alle UI-Logik
├── db.js            — PouchDB-Wrapper, alle DB-Operationen
├── calc.js          — Berechnungen, CSV-Parser, ICS-Generator
├── sync.js          — CouchDB Live-Sync Management
├── ocr.js           — Tesseract.js OCR, Heuristik-Parser
├── vehicles.js      — Fahrzeugdatenbank (VW/BMW/Mercedes/Audi…)
└── TANKLOG_DOKU.md  — Diese Dokumentation
```

### Abhängigkeiten (alle via CDN, kein npm)

| Bibliothek | Version | Zweck | Größe |
|-----------|---------|-------|-------|
| PouchDB | 8.0.1 | Lokale DB + Sync | ~145 KB |
| Chart.js | 4.4.0 | Charts | ~200 KB |
| Tesseract.js | 5.x | OCR Engine | ~2 MB + Sprachmodell |
| Google Fonts | — | Syne + JetBrains Mono | ~50 KB |

> Tesseract lädt das Deutsche Sprachmodell (~10 MB) beim ersten OCR-Scan automatisch vom CDN und cached es im Browser.

---

## Funktionen im Detail

### Garage & Fahrzeugverwaltung

#### Fahrzeug anlegen — Fahrzeugdatenbank

Beim Anlegen eines neuen Fahrzeugs erscheint ein **kaskadierende Auswahl** aus der eingebauten Fahrzeugdatenbank:

```
Marke → Modell → Generation → Motorvariante
          ↓
    Felder werden automatisch ausgefüllt:
    - Motorcode (z.B. CAYC)
    - Kraftstoffart (Benzin/Diesel/Hybrid)
    - Öl-Spezifikation (z.B. 5W-30)
    - Reifengröße(n) zur Auswahl
    - PS-Zahl
    - Baujahr (aus Generation)
```

**Unterstützte Marken:** VW (Golf IV–VIII, Polo, Passat, Tiguan), Audi (A3, A4, A6), BMW (1er, 3er, 5er), Mercedes (A-, C-, E-Klasse), Skoda (Octavia, Superb), SEAT (Ibiza, Leon), Opel (Astra, Corsa), Ford (Focus, Fiesta), Toyota, Renault, Peugeot, Citroën, Kia, Hyundai

#### Kennzeichen-Visualisierung

- Eingabe des Kennzeichens → sofortige Live-Vorschau als realistisches deutsches Kennzeichen
- In der Garage werden alle Fahrzeuge mit Mini-Kennzeichen-Kacheln angezeigt
- Ohne Kennzeichen: Platzhalterkachel

#### Gespeicherte Fahrzeugfelder

**Pflicht:** Name, Kraftstoffart

**Optional:** Marke, Modell, Baujahr, Variante, Kennzeichen, VIN, Motorcode, Reifengröße, Öl-Spezifikation, Notizen

---

### Tanklog

#### Neuen Tankvorgang erfassen

1. Tab `+` (Tanken) öffnen
2. Wahlweise: **Foto scannen** (OCR) oder manuell eingeben
3. Felder: Datum, km-Stand, Liter, Gesamt-€, Notiz
4. Checkbox: „Nicht vollgetankt" → Eintrag wird aus Verbrauchsstatistik ausgeschlossen

#### Automatische Berechnungen

```
€/Liter         = Gesamt€ / Liter
Gefahrene km    = km-Stand aktuell − km-Stand vorheriger Eintrag
L/100km         = Liter / Gefahrene km × 100
Kosten/100km    = Gesamt€ / Gefahrene km × 100
```

#### Validierungen & Warnungen

| Prüfung | Reaktion |
|---------|----------|
| km-Stand < vorheriger | **Fehler** — Speichern blockiert |
| Liter = 0 oder leer | **Fehler** |
| Betrag = 0 oder leer | **Fehler** |
| Liter > 200 | **Warnung** |
| €/Liter < 0,50 oder > 4,00 | **Warnung** |
| L/100km > Grenzwert (Standard: 25) | **Warnung** in Liste + Home |

#### Eintrag bearbeiten

Tap auf einen Eintrag in der Liste → Edit-Overlay → Werte ändern → Speichern

Die App berechnet alle Folgewerte (gefahrene km, L/100km) nach jeder Änderung neu, da sie aus den gespeicherten Rohdaten (km-Stand, Liter, €) abgeleitet werden.

---

### OCR — Tankzettel scannen

#### Workflow

```
1. Tab "+" → "Tankzettel fotografieren" antippen
2. Kamera öffnet sich (oder Foto aus Galerie wählen)
3. Tesseract.js erkennt Text lokal im Browser
   - Kein Netzwerk-Upload, vollständig privat
   - Deutsches Sprachmodell (deu)
4. Heuristischer Parser extrahiert Werte:
   - Datum, Liter, Gesamtbetrag, €/Liter
5. Formular zeigt erkannte Werte mit Unsicherheits-Markierung
6. Nutzer prüft/korrigiert → "Übernehmen"
7. Formular ist vorausgefüllt → km-Stand ergänzen → Speichern
```

#### Confidence-Anzeige

Felder mit Konfidenz < 70% werden **orange umrandet** mit Hinweis `⚠ Unsicher — bitte prüfen`.

#### Erkannte Muster (Deutsche Tankzettel)

| Feld | Erkannte Muster |
|------|----------------|
| Datum | `Datum: 15.03.2024`, `dd.mm.yyyy`, ISO-Format |
| Liter | `45,21 L`, `Menge: 32,45`, `Liter: 50,10` |
| Betrag | `Gesamt: 67,30 €`, `Summe 45,20`, `€ 53,30` |
| €/Liter | `1,479 €/l`, `Kraftstoffpreis: 1,699` |

#### Technische Details → [OCR — Technische Details](#ocr--technische-details)

---

### Wartung & Service

#### Wartungseintrag anlegen

- **Titel:** TÜV, Ölwechsel, Inspektion, Reifenwechsel, Sonstiges (oder freier Text)
- **Durchgeführt am** + km-Stand
- **Kosten** (optional)
- **Fällig am** Datum (optional)
- **Fällig bei km** (optional)
- **Erinnerung:** X Tage vor Fälligkeit
- **Notiz**

#### ICS-Export für Kalender

Button **📅 ICS** im Wartungs-Formular → lädt `.ics`-Datei herunter → importieren in:
- iPhone Kalender
- Google Calendar
- Outlook
- Thunderbird

Die ICS-Datei enthält automatisch eine Erinnerung X Tage vor dem Fälligkeitsdatum (falls konfiguriert).

**ICS für alle fälligen Wartungen:** Im Sync-Tab → `ICS für alle fälligen Wartungen` (zukünftiges Feature).

#### Dashboard-Anzeige

Das Home-Dashboard zeigt alle Wartungen, die innerhalb der nächsten `remindDays × 3` Tage fällig werden:
- 🟠 Bald fällig (≤ remindDays Tage)
- 🔴 Überfällig (Datum überschritten)

---

### Kosten

#### Kategorien

`Versicherung · Steuer · Reparatur · Teile · Werkstatt · Reinigung · Zubehör · Sonstiges`

#### Auswertung in Charts

Im Analyse-Tab:
- **Balkendiagramm** Kosten nach Kategorie mit Prozentanteilen
- **Monatliches Kostendiagramm** (Kraftstoff + Sonstiges zusammen)
- Zeitraumfilter: Gesamt / 12 / 6 / 3 Monate

---

### Analyse & Charts

| Statistik | Beschreibung |
|-----------|-------------|
| Ø Verbrauch | Durchschnitt L/100km (nur Vollbetankungen) |
| Ø Verbrauch letzte 5 | Trend der letzten 5 Vollbetankungen |
| Ø €/Liter | Durchschnittlicher Kraftstoffpreis |
| Kosten/100km | Durchschnitt Kraftstoffkosten pro 100 km |
| Gesamtkosten Kraftstoff | Summe aller Tankkosten |
| Gesamtstrecke | Summe aller gefahrenen km (aus Odometer-Differenzen) |

**Charts:**
- L/100km über Zeit (Liniendiagramm)
- €/L über Zeit (Liniendiagramm)
- Kosten €/Monat (Balkendiagramm, Kraftstoff + sonstige)

**Zeitraum-Filter:** Gesamt / 12 Monate / 6 Monate / 3 Monate

---

### CSV Import

#### Format (Google Sheets Export)

```csv
datum,kmstand,liter,euro,notiz
06.02.2016,42888,"45,21","53,3",
13.02.2016,43278,"28,86","32,29",Shell A7
15.03.2016,43750,50.10,65.40,Autobahn
```

#### Unterstützte Varianten

| Feature | Details |
|---------|---------|
| **Trennzeichen** | `,` (Sheets), `;`, Tabulator |
| **Dezimalformat** | `45,21` (Komma) und `45.21` (Punkt) |
| **Datumsformat** | `dd.mm.yyyy` und `yyyy-mm-dd` |
| **Anführungszeichen** | Felder in `"…"` werden korrekt geparst |
| **Erste Zeile** | Wird als Header erkannt und übersprungen |

#### Import-Ergebnis

Nach dem Import zeigt ein Overlay:
- `✓ X importiert`
- `⚠ Y übersprungen` — mit Zeile und Grund für jede übersprungene Zeile (z.B. `Datum ungültig: "abc"`)

---

### JSON Backup

#### Export

`Sync → Backup exportieren` → lädt `tanklog_backup_DATUM.json` herunter

Enthält: alle Fahrzeuge + Tankungen + Wartungen + Kosten + Einstellungen

#### Import

`Sync → Backup importieren`

Beim Import erscheint ein Dialog:
- **Merge** (Standard, `OK`): Neuere Einträge gewinnen bei Konflikten (per `updatedAt` Timestamp)
- **Ersetzen** (`Abbrechen`): Alle lokalen Daten werden zuerst gelöscht

---

## Sync-Architektur

### Überblick

```
Gerät A (Partner 1)          NAS / CouchDB           Gerät B (Partner 2)
┌──────────────────┐    ┌──────────────────────┐    ┌──────────────────┐
│  PouchDB lokal   │◄──►│  CouchDB "tanklog"   │◄──►│  PouchDB lokal   │
│  (IndexedDB)     │    │  (Docker auf NAS)    │    │  (IndexedDB)     │
└──────────────────┘    └──────────────────────┘    └──────────────────┘
      live sync                                           live sync
      retry: true                                         retry: true
```

### Eigenschaften

| Eigenschaft | Details |
|-------------|---------|
| **Offline-first** | App funktioniert ohne NAS-Verbindung |
| **Live-Sync** | Änderungen werden sofort übertragen (wenn online) |
| **Auto-Retry** | Reconnect bei Verbindungsabbruch |
| **Konflikte** | Last-write-wins per `updatedAt` Timestamp |
| **Dokument-IDs** | Eindeutige UUIDs → keine ID-Kollisionen |

### Sync-Status-Anzeige

Die farbige Leiste unter dem Header zeigt:

| Farbe | Status |
|-------|--------|
| 🔴 Rot | Offline — nur lokale Daten |
| 🟡 Gelb/blinkend | Verbinde mit NAS |
| 🟢 Grün | Verbunden — Live-Sync aktiv |
| 🔵 Blau | Synchronisiert gerade |
| 🔴 Rot + Text | Sync-Fehler (retry läuft) |

---

## NAS/CouchDB Setup

### Schritt 1: CouchDB per Docker starten

```bash
docker run -d \
  --name couchdb \
  --restart unless-stopped \
  -p 5984:5984 \
  -e COUCHDB_USER=admin \
  -e COUCHDB_PASSWORD=DeinPasswort \
  -v /volume1/docker/couchdb:/opt/couchdb/data \
  couchdb:3
```

**Synology NAS:** Stattdessen Container Manager verwenden:
1. Container Manager → Projekt → Neu
2. docker-compose.yml:

```yaml
version: '3'
services:
  couchdb:
    image: couchdb:3
    restart: unless-stopped
    ports:
      - "5984:5984"
    environment:
      COUCHDB_USER: admin
      COUCHDB_PASSWORD: DeinPasswort
    volumes:
      - /volume1/docker/couchdb:/opt/couchdb/data
```

### Schritt 2: Datenbank erstellen + CORS konfigurieren

**Via Fauxton (Browser-UI):** `http://NAS-IP:5984/_utils`

1. → Databases → Create Database → Name: `tanklog`
2. → Admin → Configuration → CORS → Enable

**Via curl (schneller):**

```bash
NAS=192.168.1.100  # Deine NAS-IP
USER=admin
PASS=DeinPasswort

# Datenbank anlegen
curl -X PUT http://$USER:$PASS@$NAS:5984/tanklog

# CORS aktivieren
curl -X PUT http://$USER:$PASS@$NAS:5984/_node/nonode@nohost/_config/cors/origins \
  -H "Content-Type: application/json" -d '"*"'

curl -X PUT http://$USER:$PASS@$NAS:5984/_node/nonode@nohost/_config/cors/credentials \
  -H "Content-Type: application/json" -d '"true"'

curl -X PUT http://$USER:$PASS@$NAS:5984/_node/nonode@nohost/_config/cors/methods \
  -H "Content-Type: application/json" -d '"GET, PUT, POST, HEAD, DELETE"'

curl -X PUT http://$USER:$PASS@$NAS:5984/_node/nonode@nohost/_config/cors/headers \
  -H "Content-Type: application/json" -d '"accept, authorization, content-type, origin, referer"'
```

### Schritt 3: In der App verbinden

`Tab Sync → CouchDB URL eintragen → Verbinden`

```
URL:      http://192.168.1.100:5984/tanklog
Benutzer: admin
Passwort: DeinPasswort
```

### Schritt 4: Partner verbindet sich

Der Partner gibt dieselbe URL/Credentials ein → beide sehen ab sofort dieselben Daten.

### HTTPS (empfohlen für Zugriff von außerhalb)

Mit einem Reverse Proxy (nginx, Caddy, Traefik) TLS hinzufügen:

```nginx
server {
    listen 443 ssl;
    server_name tanklog.dein-nas.de;
    
    ssl_certificate /etc/ssl/cert.pem;
    ssl_certificate_key /etc/ssl/key.pem;
    
    location / {
        proxy_pass http://127.0.0.1:5984;
        proxy_set_header Host $host;
        add_header 'Access-Control-Allow-Origin' '*';
    }
}
```

---

## OCR — Technische Details

### Tesseract.js v5

- **Engine:** LSTM-basierter OCR-Kern (Tesseract 4.x)
- **Sprache:** Deutsch (`deu`) — erkennt Umlaute, Dezimalkommas
- **Verarbeitung:** Vollständig im Browser-Thread (Web Worker)
- **Erstmaliger Download:** ~10 MB Sprachmodell (wird im Browser gecacht)
- **Datenschutz:** Kein Byte verlässt den Browser

### Parser-Logik (`ocr.js` → `parse()`)

#### Datum

1. **Hoch (90%):** `Datum: 15.03.2024`, `Belegdatum`, `Kassendatum` + Datum
2. **Mittel (65%):** Erstes plausibles Datum im Text (≤ heute, ≥ 1990)
3. Sanity-Check: Datum in Vergangenheit, kein Ablaufdatum

#### Liter

1. **Hoch (92%):** `Menge: 45,21 L`, `Liter: 32,45`
2. **Mittel (78%):** Zahl gefolgt von `L` oder `Liter`
3. Plausibilitätsbereich: 1–200 L (sonst Konfidenz ↓)

#### Gesamtbetrag

1. **Hoch (92%):** `Gesamt: 67,30 €`, `Summe`, `Betrag`, `zu zahlen`
2. **Mittel (60%):** Größter Euro-Betrag im Text
3. Sanity-Check: 2–500 €

#### €/Liter

1. **Hoch (92%):** `1,479 €/l`, `Kraftstoffpreis: 1,699`
2. **Mittel (80%):** Zahl mit 3–4 Nachkommastellen vor `/L`
3. **Abgeleitet (50%):** `Betrag / Liter` (wenn beide bekannt)
4. Sanity-Check: 0,50–4,00 €/L

### Bekannte Einschränkungen

- Schlechte Beleuchtung, Unschärfe oder stark zerknitterte Zettel senken die Erkennungsrate
- Tankstellen mit ungewöhnlichem Layout (z.B. keine Labels) → geringere Konfidenz
- Großdruckquittungen (Thermopapier hochglanz, stark verblasst) → Vorverarbeitung hilft

### Verbesserungstipps

- Foto bei guter Beleuchtung, flach auf Tisch legen
- Zettel glatt halten
- Nahaufnahme, sodass Text den Großteil des Bildes ausfüllt

---

## Fahrzeugdatenbank

### Enthaltene Fahrzeuge (`vehicles.js`)

| Marke | Modelle | Generationen |
|-------|---------|--------------|
| Volkswagen | Golf, Polo, Passat, Tiguan, Touareg | IV–VIII, je 4–12 Varianten |
| Audi | A3, A4, A6 | B7/B8/B9, 8P/8V, C7 |
| BMW | 1er, 3er, 5er | E87/F20, E90/F30/G20, F10 |
| Mercedes-Benz | A-, C-, E-Klasse | W176/W177, W204/W205, W212 |
| Skoda | Octavia, Superb | II/III, III |
| SEAT | Ibiza, Leon | 6J, III (5F) |
| Opel | Astra, Corsa | J, E |
| Ford | Focus, Fiesta | III, VII |
| Toyota | Yaris, Corolla | III, E21 |
| Renault | Clio, Mégane | IV, IV |
| Peugeot | 208, 308 | I, II |
| Citroën | C3 | III |
| Kia | Ceed, Sportage | III, IV |
| Hyundai | i30 | III |

### Datenbankstruktur

```javascript
VehicleDB.brands['Volkswagen'].models['Golf']['Golf VI (5K) 2008–2013'] = [
  {
    name: '1.6 TDI 105 PS',   // Anzeigename
    code: 'CAYC',              // Motorcode
    fuel: 'Diesel',            // Kraftstoffart
    oil:  '5W-30',             // Öl-Spezifikation
    power: 105,                // PS
    tires: ['195/65 R15', '205/55 R16']  // Reifengrößen zur Auswahl
  },
  ...
]
```

### Erweiterung

Neue Fahrzeuge können in `vehicles.js` nach dem gleichen Muster ergänzt werden:

```javascript
'Mein Hersteller': {
  models: {
    'Mein Modell': {
      'Generation XY 2020–': [
        { name: '2.0 TDI 150 PS', code: 'XYZ123', fuel: 'Diesel',
          oil: '5W-30', power: 150, tires: ['225/55 R17'] }
      ]
    }
  }
}
```

---

## Datenmodell

### PouchDB Dokument-Typen

#### Fahrzeug (`type: "vehicle"`)

```json
{
  "_id": "vehicle_abc123",
  "type": "vehicle",
  "name": "Golf",
  "make": "Volkswagen",
  "model": "Golf",
  "year": 2012,
  "variant": "Golf VI (5K)",
  "plate": "MÜN-AB 123",
  "fuelType": "Diesel",
  "engineCode": "CAYC",
  "tireSize": "205/55 R16",
  "oilSpec": "5W-30",
  "vin": "WVWZZZ1JZ3W386752",
  "notes": "",
  "createdAt": 1700000000000,
  "updatedAt": 1700000000000
}
```

#### Tankvorgang (`type: "fuel"`)

```json
{
  "_id": "fuel_vehicle_abc123_2024-03-15_xyz",
  "type": "fuel",
  "vehicleId": "vehicle_abc123",
  "date": "2024-03-15",
  "odometer": 85420,
  "liters": 45.21,
  "totalCost": 67.30,
  "partialFill": false,
  "note": "Shell A7",
  "createdAt": 1700000000000,
  "updatedAt": 1700000000000
}
```

**Abgeleitete Felder** (nicht gespeichert, werden bei Anzeige berechnet):
`pricePerLiter`, `drivenKm`, `consumption`, `costPer100km`

#### Wartung (`type: "maintenance"`)

```json
{
  "_id": "maint_vehicle_abc123_xyz",
  "type": "maintenance",
  "vehicleId": "vehicle_abc123",
  "title": "TÜV",
  "date": "2024-01-10",
  "odometer": 82000,
  "cost": 89.50,
  "dueDate": "2026-01-10",
  "dueKm": 120000,
  "reminderDaysBefore": 30,
  "reminderKmBefore": 1000,
  "note": "DEKRA Niederlassung Mitte"
}
```

#### Kosten (`type: "cost"`)

```json
{
  "_id": "cost_vehicle_abc123_2024-01-15_xyz",
  "type": "cost",
  "vehicleId": "vehicle_abc123",
  "date": "2024-01-15",
  "amount": 245.00,
  "category": "Versicherung",
  "odometer": null,
  "note": "Halbjahreszahlung"
}
```

---

## Konfiguration & Einstellungen

`Zahnrad-Icon oben rechts → Einstellungen`

| Einstellung | Standard | Beschreibung |
|-------------|----------|--------------|
| Verbrauch-Warnung | 25 L/100km | Warnung wenn überschritten |
| Wartungs-Erinnerung | 14 Tage | Vorlauf für Dashboard-Warnung |

Einstellungen werden als PouchDB-Dokument `_id: "settings"` gespeichert und bei aktivem Sync auch auf dem NAS synchronisiert.

---

## Troubleshooting

### App startet nicht / leere Seite

- Über HTTP-Server starten (`python3 -m http.server`), nicht via `file://`
- Browser-Konsole öffnen (F12) → Fehlermeldungen prüfen
- Moderne Browser erforderlich (Chrome 80+, Firefox 75+, Safari 14+)

### OCR erkennt nichts

- Tesseract.js lädt das Sprachmodell beim ersten Scan (~10 MB) → Internetverbindung nötig
- Fortschrittsbalken zeigt `Lade OCR-Engine (einmalig ~10MB)` → warten
- Nach erstem Laden: funktioniert offline (Browser-Cache)
- Foto-Qualität verbessern: gute Beleuchtung, Zettel glatt, nah dran

### CouchDB Sync schlägt fehl

```
✗ CORS-Fehler
→ CORS in CouchDB aktivieren (siehe NAS Setup, Schritt 2)
→ Browser-Konsole: "Access-Control-Allow-Origin" fehlt?

✗ 401 Unauthorized  
→ Benutzer/Passwort falsch
→ CouchDB-Datenbank existiert? (http://NAS:5984/_utils)

✗ Verbindung abgelehnt
→ Port 5984 in NAS-Firewall freigeben
→ NAS-IP korrekt? (ping NAS-IP im Terminal testen)
```

### Daten verschwunden nach Browser-Update

PouchDB speichert in IndexedDB. Bei bestimmten Browser-Updates oder `Browserdaten löschen` kann IndexedDB geleert werden.

**Vorbeugung:**
- Regelmäßig JSON-Backup exportieren (Sync-Tab)
- NAS-Sync aktivieren → NAS ist das Backup

### CSV Import schlägt für bestimmte Zeilen fehl

Häufige Ursachen:
- Datum im falschen Format (`2016/02/06` statt `06.02.2016` oder `2016-02-06`)
- Liter/Euro-Wert leer oder Text statt Zahl
- Zeile hat weniger als 4 Felder
- Sonderzeichen in Notizen (z.B. Komma ohne Anführungszeichen bei `,`-Delimiter)

Import-Ergebnis-Dialog zeigt Zeile und konkreten Grund.

---

## Lizenz & Datenschutz

- **Keine Daten verlassen das Gerät** (außer an den eigenen NAS)
- **OCR:** Vollständig lokal (Tesseract.js im Browser)
- **Keine Telemetrie, keine Werbung, keine Accounts**
- **Quellcode:** Vollständig offen, keine Minifizierung

---

*TankLog — Gebaut für den eigenen Haushalt, ohne laufende Kosten.*
