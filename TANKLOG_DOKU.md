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

#### OCR-Pipeline im Detail

1. Bild laden
2. Bild vorverarbeiten
3. OCR-Text mit Tesseract.js erzeugen
4. OCR-Text normalisieren
5. Felder per Heuristik extrahieren
6. Werte gegeneinander pruefen
7. Fehlende Werte berechnen
8. Ergebnis mit Status und Alternativen anzeigen
9. Manuelle Korrekturen erneut gegenpruefen

#### Bildverarbeitung

Vor der Erkennung wird das Belegbild fuer mobile Browser optimiert:

- Groessenbegrenzung auf eine handhabbare Aufloesung
- Graustufen
- Kontrastanhebung
- leichte Schaerfung
- optional perspektivische Entzerrung nach manuellem Zuschnitt
- manuelle Rotation um 90 Grad bei seitlich fotografierten Belegen

Der Zuschnitt kann ueber interaktive Eckpunkte angepasst werden. Danach wird ein entzerrtes Canvas erzeugt und darauf die OCR ausgefuehrt.

#### Text-Normalisierung

Vor dem eigentlichen Parsing wird OCR-Rohtext bereinigt:

- Zeilenumbrueche und doppelte Leerzeichen werden vereinheitlicht
- `EURO` wird zu `EUR`
- getrennte Dezimalwerte wie `84 30 EUR` werden zu `84,30 EUR`
- Preisangaben wie `1 439 EUR/l` werden zu `1.439 EUR/l`
- das haeufige OCR-Problem `l` -> `1` wird heuristisch korrigiert, z. B. `50,00 1` -> `50,00 l`

Diese Normalisierung ist entscheidend, weil die spaetere Erkennung stark auf typische Tankbeleg-Muster ausgelegt ist.

#### Extrahierte Felder

Das OCR versucht folgende Felder zu erkennen:

- `date`
- `liters`
- `totalCost`
- `pricePerLiter`

Intern traegt jedes Feld zusaetzlich:

- Rohwert (`raw`)
- Confidence (`conf`)
- Quelle (`source`)
- Kontextstaerke (`contextStrength`)
- Status (`safe`, `uncertain`, `derived`, `conflicting`, `missing`)
- optionale Alternativen (`_alts`)

#### Datumserkennung

Die Datumserkennung sucht nach Formaten wie:

- `dd.mm.yy`
- `dd.mm.yyyy`
- `dd/mm/yyyy`
- `dd-mm-yyyy`

Wichtig:

- Es wird nicht mehr blind der erste Treffer genommen, sondern der erste plausible Treffer.
- Jahre ausserhalb des Bereichs `1950` bis `aktuelles Jahr + 1` werden verworfen.
- Offensichtliche Belegnummern wie `01/03/5891` sollen dadurch nicht als Datum durchgehen.

#### Betragserkennung

Die Erkennung des Gesamtbetrags arbeitet mehrstufig:

1. Direkte Treffer ueber Schluesselwoerter:
   - `Gesamtbetrag`
   - `Bruttobetrag`
   - `Summe`
   - `Total`
   - `zu zahlen`
   - `Zahlbetrag`
2. Suche im Umfeld solcher Schluesselwoerter
3. Allgemeine Geld-Kandidaten mit Ranking

Fuer allgemeine Kandidaten wird der Kontext bewertet:

- positive Signale:
  - `Gesamtbetrag`
  - `Brutto`
  - typische Produktzeilen
- negative Signale:
  - `gegeben in`
  - `Rueckgeld`
  - `bar`
  - `cash`
  - `Karte`
  - `EC`
  - `Visa`

Dadurch soll ein Zahlungsbetrag wie `100,00 EUR gegeben` nicht als eigentlicher Rechnungsbetrag gewinnen.

Wenn ein bereits erkannter Betrag spaeter nicht zu Liter und EUR/L passt, kann er erneut gerankt und ersetzt werden.

#### EUR/L-Erkennung

`pricePerLiter` wird bevorzugt ueber klare Label erkannt:

- `1,439 EUR/l`
- `1.439 EUR/l`
- `EUR/l: 1,439`

Zusatzlogik:

- Zahl in der Naehe von `Preis/L`, `Literpreis`, `Kraftstoffpreis`
- schwache Fallbacks fuer isolierte Zahlen
- Normalisierung von `1719` -> `1.719`
- Normalisierung von `1,71` -> `1.710`

Schutzmechanismen:

- Jahreszahlen wie `2014` sollen nicht als `2,014 EUR/L` fehlinterpretiert werden.
- Historische oder ungewoehnlich niedrige Kraftstoffpreise werden trotzdem toleriert, z. B. LPG-Belege mit `0,729 EUR/L`.

#### Liter-Erkennung

Die Liter-Erkennung laeuft in mehreren Schritten:

1. Direkte Einheit:
   - `49,04 l`
   - `47,39 L`
2. OCR-Fallback fuer `l` als `1`:
   - `50,00 1`
3. Label-basierte Suche:
   - `Menge`
   - `Liter`
   - `Volumen`
   - `Kraftstoffmenge`
   - `getankt`
4. Suche im Kraftstoff-Kontext:
   - `Diesel`
   - `Super`
   - `E10`
   - `Benzin`
5. Strukturparser fuer typische Produktzeilen
6. Brute-Force-Fallback, wenn nur Betrag vorhanden ist

Der Strukturparser versucht bei typischen Zeilen wie:

```text
*Zp 03 50,00 l 1,439 EUR/l
```

den kleineren plausiblen Grosswert als Liter und den groesseren als Betrag zu lesen.

Beim Brute-Force-Fallback werden unplausible Kandidaten verworfen. Prozentwerte wie `17,00%` sollen dabei nicht als Liter interpretiert werden.

#### Plausibilitaetsbereiche

Die OCR arbeitet mit groben Bereichsgrenzen:

- Liter:
  - `safe`: `5..120`
  - `warn`: `2..200`
- Gesamtbetrag:
  - `safe`: `5..300`
  - `warn`: `2..500`
- EUR/L:
  - `safe`: ca. `0.600..2.500`
  - `warn`: ca. `0.450..3.200`

Diese Bereiche beeinflussen:

- Statusanzeige
- Ableitungen
- Verwerfen unrealistischer Werte

#### Konsistenzpruefung und Ableitung

Die zentrale Logik liegt in `_validateFinalize(result)`.

Dabei werden `totalCost`, `liters` und `pricePerLiter` gegeneinander gerechnet:

- `Betrag ~= Liter * EUR/L`

Wenn alle drei Felder vorhanden sind:

- wird die Abweichung aller drei Kombinationen verglichen
- der groesste Ausreisser wird als wahrscheinlich falscher Wert behandelt
- dieser kann durch einen berechneten Wert ersetzt werden

Wenn nur zwei von drei Feldern vorhanden sind:

- aus `Betrag + EUR/L` wird `Liter`
- aus `Betrag + Liter` wird `EUR/L`
- aus `Liter + EUR/L` wird `Betrag`

Ableitungen werden nicht blind uebernommen. Beruecksichtigt werden:

- Confidence
- Kontextstaerke
- Plausibilitaetsbereich
- ob ein Wert nur aus einem sehr schwachen OCR-Fallback stammt

Der Status pro Feld ist danach:

- `safe`
- `uncertain`
- `derived`
- `conflicting`
- `missing`

#### Ergebnisanzeige

Das OCR-Ergebnis wird in einer separaten Vorschau angezeigt:

- Datum
- Liter
- Betrag
- EUR/L

Zu jedem Feld gibt es:

- einen Statushinweis
- farbliche Kennzeichnung
- optional Alternativen als klickbare Vorschlaege

Wenn mehrere plausible Kandidaten existieren, zeigt die UI kleine Buttons unter dem Feld. Ein Klick uebernimmt den Alternativwert.

#### Manuelle Korrektur

Die OCR-Vorschau ist editierbar. Aenderungen in folgenden Feldern loesen sofort eine neue Konsistenzrechnung aus:

- Datum
- Liter
- Betrag
- EUR/L

Das bedeutet:

- Wenn der Nutzer einen Wert aendert, werden die anderen Felder erneut geprueft.
- Wenn danach zwei von drei Werten vorhanden sind, kann der dritte automatisch berechnet werden.

Manuelle Werte werden intern als `source = manual` behandelt und mit hoher Confidence erneut in die Validierung gegeben.

#### Markiermodus auf dem Beleg

Unterhalb des OCR-Ergebnisses gibt es einen Bereich zum direkten Markieren eines Werts auf dem Belegbild.

Unterstuetzte Felder:

- Datum
- Betrag
- Liter
- EUR/L
- km-Stand

Ablauf:

1. Feld waehlen
2. Rechteck um die relevante Zahl ziehen
3. Nur dieser Bildausschnitt wird erneut ge-OCR-t
4. Der erkannte Wert wird ins passende Feld geschrieben
5. Danach wird sofort die gesamte OCR-Konsistenzlogik erneut ausgefuehrt

So kann eine manuelle Markierung dazu fuehren, dass ein anderer fehlender Wert direkt automatisch korrekt berechnet wird.

#### Typische Fehlerquellen

Die OCR ist stark heuristisch und kann an folgenden Punkten scheitern:

- `l` wird als `1` erkannt
- `0` und `O` werden verwechselt
- Zahlen stehen ohne klares Label
- mehrere Geldwerte konkurrieren auf demselben Beleg
- alte Belege haben ungewoehnliche Waehrungen oder Preisniveaus
- abgeschnittene oder unscharfe Bildbereiche stoeren die Texterkennung

In solchen Faellen sind besonders wichtig:

- sauberer Zuschnitt
- Markiermodus
- manuelle Korrektur in der OCR-Vorschau

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
