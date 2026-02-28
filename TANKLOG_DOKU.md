# TankLog - Dokumentation

Stand: Codebasis vom 28.02.2026

## Ueberblick

TankLog ist eine lokale, offline-first Web-App fuer private Fahrzeugverwaltung. Die App speichert Daten im Browser per PouchDB und kann optional mit einer CouchDB auf dem NAS synchronisiert werden.

Abgedeckte Bereiche:

- Garage mit mehreren Fahrzeugen
- Tanklog mit Verbrauchsberechnung
- OCR fuer Tankzettel
- Wartung und Termine
- Sonstige Kosten
- Analyse und Charts
- JSON-Backup, CSV-Import und CouchDB-Sync

## Projektstruktur

```text
index.html   UI-Shell, Views und Overlays
style.css    Styling
app.js       UI-Logik und Event-Handling
db.js        PouchDB-Zugriff und Persistenz
calc.js      Berechnungen, CSV-Parser, ICS-Generator
sync.js      CouchDB-Sync
ocr.js       OCR-Workflow und Parser
vehicles.js  Fahrzeugdatenbank fuer Vorauswahl
```

## Starten

Ein HTTP-Server ist erforderlich:

```bash
python -m http.server 8080
```

Danach `http://localhost:8080` im Browser oeffnen.

Hinweis:

- `file://` funktioniert nicht sauber mit PouchDB und den CDN-Abhaengigkeiten.
- Fuer den ersten OCR-Lauf muss Tesseract.js inkl. Sprachdaten vom CDN geladen werden.

## Datenhaltung

### Lokal

- Datenbank: `tanklog`
- Backend: IndexedDB via PouchDB
- Dokumenttypen:
  - `vehicle`
  - `fuel`
  - `maintenance`
  - `cost`
  - `settings`

### Sync

- Optionaler Live-Sync mit CouchDB
- Sync-Konfiguration wird in `localStorage` unter `tanklog_sync_config` gespeichert
- Statuswerte in der App: `offline`, `connecting`, `online`, `syncing`, `error`

### Import-Konflikte

Beim JSON-Import und internen Bulk-Imports gewinnt bei `merge` die neuere Version ueber `updatedAt`.

## Funktionen im Detail

### Garage

Die Garage verwaltet mehrere Fahrzeuge. Ein Fahrzeug kann manuell angelegt oder ueber die integrierte Fahrzeugdatenbank vorbereitet werden.

Gespeicherte Felder:

- Name
- Kraftstoffart
- Marke
- Modell
- Baujahr
- Variante
- Kennzeichen
- Motorcode
- Reifengroesse
- Oelspezifikation
- VIN
- Notizen

Die Fahrzeugdatenbank in `vehicles.js` bietet eine kaskadierende Auswahl:

1. Marke
2. Modell
3. Generation
4. Variante

Beim Uebernehmen werden bekannte Felder automatisch vorbelegt.

### Tanklog

Ein Tankeintrag speichert:

- Datum
- km-Stand
- Liter
- Gesamtpreis
- Notiz
- `partialFill` fuer Teilfuellungen

Aus den Rohdaten werden in `calc.js` berechnet:

- Preis pro Liter
- Gefahrene Kilometer seit dem letzten passenden Eintrag
- Verbrauch in L/100 km
- Kosten pro 100 km

Validierungen:

- Liter und Betrag muessen groesser als 0 sein
- km-Stand darf nicht unter dem bisher hoechsten km-Stand liegen
- Auffaellige Werte erzeugen Warnungen, z. B. sehr hoher Verbrauch oder unrealistischer EUR/L-Preis

Teilfuellungen bleiben gespeichert, werden aber bei Verbrauchsdurchschnitten nicht als regulaere Vollbetankung gewertet.

### OCR fuer Tankzettel

Das OCR-Modul in `ocr.js` arbeitet komplett lokal im Browser.

Ablauf:

1. Foto ueber Kamera oder Galerie waehlen
2. Bild wird lagekorrigiert
3. Optionaler Zuschnitt mit interaktiven Eckpunkten
4. Perspektivische Entzerrung fuer schraeg fotografierte Belege
5. Vorverarbeitung mit Graustufen, Kontrastanhebung und Schaerfung
6. OCR mit Tesseract.js
7. Heuristischer Parser extrahiert Datum, Liter, Gesamtbetrag und optional EUR/L
8. Werte werden in das Tankformular uebernommen

Die Erkennung markiert unsichere Felder sichtbar, damit sie vor dem Speichern kontrolliert werden koennen.

### Wartung

Wartungseintraege enthalten:

- Titel
- Durchgefuehrt am
- km-Stand
- Kosten
- Faellig am
- Faellig bei km
- Erinnerung in Tagen
- Erinnerung in km
- Notiz

Verfuegbare Aktionen:

- Erstellen
- Bearbeiten
- Loeschen
- Einzelnen Termin als ICS exportieren
- Alle Termine mit Faelligkeitsdatum gesammelt als ICS exportieren

Das Home-Dashboard zeigt anstehende oder ueberfaellige Wartungen anhand des eingestellten Erinnerungszeitraums.

### Kosten

Neben Kraftstoff lassen sich weitere Kosten erfassen.

Kategorien:

- Versicherung
- Steuer
- Reparatur
- Teile
- Werkstatt
- Reinigung
- Zubehoer
- Sonstiges

Jeder Eintrag kann Datum, Betrag, km-Stand und Notiz enthalten.

### Analyse

Die Analyse arbeitet fahrzeugbezogen.

Verfuegbare Zeitraeume:

- Gesamt
- 12 Monate
- 6 Monate
- 3 Monate

Angezeigt werden:

- Durchschnittsverbrauch
- Durchschnittsverbrauch der letzten 5 gueltigen Betankungen
- Durchschnittlicher Kraftstoffpreis
- Kosten pro 100 km
- Gesamtkosten
- Gesamtstrecke

Charts:

- Verbrauch ueber Zeit
- Kraftstoffpreis ueber Zeit
- Monatliche Kosten

Zusatzlich gibt es eine Kostenaufteilung nach Kategorien.

## Import und Export

### JSON-Backup

Export:

- Exportiert alle Dokumente
- Dateiname: `tanklog_backup_YYYY-MM-DD.json`
- Format:

```json
{
  "app": "tanklog",
  "version": 2,
  "exported": "2026-02-28T00:00:00.000Z",
  "docs": []
}
```

Import:

- Unterstuetzt sowohl das obige Objektformat als auch ein reines Dokument-Array
- `OK` im Dialog = `merge`
- `Abbrechen` im Dialog = `replace`

### CSV-Import

Der CSV-Import erwartet pro Zeile:

```text
datum,kmstand,liter,euro,notiz
```

Unterstuetzt:

- Trennzeichen `,`, `;`, Tab
- Datumsformate `dd.mm.yyyy`, `dd-mm-yyyy`, `yyyy-mm-dd`
- Dezimalpunkt und Dezimalkomma
- Header-Erkennung in der ersten Zeile

Beim Import werden ungueltige Zeilen gesammelt und im Ergebnis-Overlay mit Grund angezeigt.

## Einstellungen

In den Einstellungen sind aktuell konfigurierbar:

- Verbrauchs-Warnschwelle (`warnConsumption`, Standard: `25`)
- Erinnerungszeitraum fuer Wartungen (`remindDays`, Standard: `14`)

Die Einstellungen werden als eigenes Dokument mit `_id = "settings"` gespeichert.

## CouchDB-Setup

Minimaler Ablauf:

1. CouchDB starten
2. Datenbank `tanklog` anlegen
3. CORS aktivieren
4. In TankLog URL, Benutzer und Passwort eintragen
5. `Verbinden` in der Sync-Ansicht klicken

Beispiel:

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

Typische URL:

```text
http://192.168.1.100:5984/tanklog
```

## Technische Hinweise

- Es gibt aktuell keinen Service Worker und kein Web-App-Manifest.
- Die App ist mobil optimiert und kann ueber Browser-Funktionen auf dem Homescreen abgelegt werden.
- Abhaengigkeiten werden direkt per CDN geladen:
  - PouchDB 8.0.1
  - Chart.js 4.4.0
  - Tesseract.js 5.x

## Troubleshooting

### Leere Seite oder Fehler beim Start

- App ueber HTTP-Server starten
- Browser-Konsole pruefen
- Sicherstellen, dass die CDN-Skripte geladen werden konnten

### OCR erkennt schlecht

- Erstes Laden der OCR-Engine benoetigt Netzwerk
- Beleg moeglichst gerade und gut beleuchtet fotografieren
- Bei schraegen Fotos den Zuschnitt und die Entzerrung nutzen

### Sync verbindet nicht

- URL auf die Datenbank pruefen, nicht nur auf den Server
- CORS in CouchDB aktivieren
- Benutzername und Passwort pruefen
- Erreichbarkeit von Port 5984 pruefen

### Daten fehlen lokal

- IndexedDB kann durch Browserbereinigung geloescht werden
- Regelmaessig JSON-Backups exportieren
- Optional CouchDB-Sync als zweites Backup nutzen
