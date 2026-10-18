# ioBroker Ladeplanung – E-Auto nach Zielort laden

> „Dieser Text/Beitrag wurde mit Hilfe von KI erzeugt“

ioBroker-Skript (JavaScript-Adapter), das aus einem Fahrtziel einen Ladeplan für [evcc](https://evcc.io) macht.
Ziel und Abfahrt eingeben, das Skript berechnet die Strecke und den nötigen Akkustand. Dann legt es in evcc einen Plan an, der im günstigen Nachttarif lädt.

Die Idee dahinter: Nachts wird nur so viel geladen, wie die nächste Fahrt braucht. Den Rest füllt tagsüber die PV-Anlage.

Ab Version 2.2 gibt es dazu einen fertigen **Aura-Tab**, der die Planung nach Zielort und die Ladeplanung von evcc in einer Ansicht zusammenfasst – aufgebaut wie der evcc-Dialog „Ladeplanung“.

## Funktionen

### Planung nach Zielort

- **Zielort** als Adresse, Ort oder `lat,lon` eingeben, in einer Karte antippen oder aus Favoriten/letzten Zielen wählen
- **Startort** wählbar, leer = Zuhause (Standort aus den ioBroker-Systemeinstellungen)
- Strecke und Fahrzeit über **OpenStreetMap** (Nominatim + OSRM): kostenlos, ohne API-Key
- Optional **Hin- und Rückfahrt**
- **Autobahn-Anteil** wird mit höherem Verbrauch gerechnet (`HIGHWAY_FACTOR`)
- **Ziel-SoC = Fahrbedarf + Mindest-SoC**: Das Auto fällt nach der Fahrt nicht unter den Mindest-SoC (einstellbar)
- Reicht der aktuelle SoC, wird **kein Plan** angelegt
- **Abfahrt frei wählbar** (Tag und Uhrzeit), ohne Auswahl der nächste Morgen um 06:00
- Der Plan geht erst **ab 16:00 am Tag vor der Abfahrt** an evcc, damit kein gleich günstiges Mittagsfenster genutzt wird
- Ladelimit in evcc wird bei Bedarf angehoben und danach zurückgesetzt
- Nach der Abfahrt endet der Plan automatisch
- **Favoriten** und Liste der **letzten Ziele** (JSON, direkt als Auswahlliste nutzbar)

### evcc-Ladeplanung (ab 2.1)

- **Einzelplan #1** umschaltbar zwischen **„nach Zielort“** (Ladeziel wird berechnet) und **„Ladeziel %“** (Ziel von Hand wie in evcc). Beim Umschalten wird ein aktiver Plan übernommen.
- **Wiederholende Pläne** anzeigen, ändern, hinzufügen und löschen (Wochentage, Uhrzeit, Ladeziel, aktiv)
- **Strategie**: günstigst oder durchgehend, dazu „vor der Abfahrt am Stück laden“
- **Nächster Plan** mit Ladedauer, Ladeleistung und Ø-Energiepreis
- **Preisgrafik** der nächsten 24 Stunden in 15-Minuten-Schritten mit den geplanten Ladezeiten
- Ein Plan, der direkt in der evcc-Oberfläche gesetzt wurde, wird erkannt und angezeigt
- Alles läuft über die evcc-REST-API; das Skript schreibt die Daten nach `Plan_Ansicht_JSON` und nimmt Änderungen über `Plan_Befehl` entgegen

Alle Datenpunkte legt das Skript beim ersten Start selbst an.

## Voraussetzungen

- ioBroker mit **JavaScript-Adapter**
- **evcc** mit einem (dynamischen oder zeitvariablen) Tarif; die REST-API muss im lokalen Netz ohne Passwort erreichbar sein
- **ioBroker.evcc-Adapter** (liefert SoC, Fahrzeug und Ladelimit des Ladepunkts)
- Internetzugang von ioBroker aus
- Standort (Breiten-/Längengrad) in den ioBroker-Systemeinstellungen
- Für den fertigen Tab: **ioBroker.aura** (getestet mit 0.83.3). Die Datenpunkte lassen sich auch mit VIS, Jarvis o. ä. nutzen.

Getestet mit JavaScript-Adapter 10.1.3, evcc 0.317.2, evcc-Adapter 0.2.8.

## Installation

1. Im JavaScript-Adapter ein neues JavaScript-Skript anlegen und den Inhalt von [`Ladeplanung.js`](Ladeplanung.js) einfügen.
2. Den Block `---- ANPASSEN ----` in `CFG` ausfüllen (siehe unten), mindestens `EVCC_URL`, `CAPACITY_KWH` und `CONTACT`.
3. Skript starten. Die Datenpunkte werden unter `CFG.BASE` angelegt (Standard: `0_userdata.0.Ladeplanung.`). Im Log steht „Ladeplanung: Skript gestartet“.
4. **Aura:** [`Ladeplanung_Aura_Tab.json`](Ladeplanung_Aura_Tab.json) im Aura-Editor als Tab importieren. Wer einen anderen `BASE`-Pfad oder eine andere evcc-Instanz nutzt, ersetzt vorher `0_userdata.0.Ladeplanung.` bzw. `evcc.0.` per Suchen/Ersetzen in der Datei.
5. **Optional Popup:** Für die Planansicht auf anderen Tabs eine Popup-Ansicht mit einem Widget „Spiegel“ (Mirror) anlegen und als Ziel das Widget `w-lp-plan` wählen.

**Update von 2.0:** Skript ersetzen (eigene Werte aus `CFG` übernehmen) und neu starten – neue Datenpunkte werden automatisch angelegt. Danach den Aura-Tab neu importieren.

## Der Aura-Tab

- **Links** die Planansicht: Plan #1 mit Umschalter „nach Zielort / Ladeziel %“, Abfahrt, berechnetem Ladeziel, Strecke, „Hin & zurück“, Mindest-SoC und Status; darunter wiederholende Pläne, Strategie, nächster Plan und Preisgrafik.
- **Rechts** die Eingaben für den Ort: Zielort, Favoriten, letzte Ziele, Start-Auswahl, Merken/Löschen, Karte zum Antippen, Startort als Freitext und Favorit-Name.
- Auf dem Handy stehen beide Spalten untereinander.

## Konfiguration

| Einstellung | Bedeutung |
|---|---|
| `EVCC_URL` | Adresse der evcc-Weboberfläche, z. B. `http://192.168.1.10:7070` |
| `EVCC_INSTANCE` | Instanz des evcc-Adapters, meist `evcc.0` |
| `LOADPOINT` | Ladepunkt-Nummer in evcc (1 = erster) |
| `VEHICLE_FALLBACK` | evcc-Fahrzeugname (z. B. `db:1`). Nur nötig, wenn das Auto beim Anlegen des Plans nicht am Ladepunkt erkannt ist |
| `CAPACITY_KWH` | nutzbare Akkukapazität in kWh |
| `CHARGE_KW` | Ladeleistung der Wallbox (nur für die Schätzung) |
| `MIN_SOC` | Standard-Mindest-SoC nach der Fahrt in % |
| `ROUND_STEP` | Ladeziel auf volle x % aufrunden |
| `HIGHWAY_FACTOR` | Autobahn-Verbrauch = Ø-Verbrauch × Faktor (1 = aus) |
| `BASE` | Ordner für die Datenpunkte |
| `CONSUMPTION_DPS` | optional: Datenpunkte mit gelerntem Ø-Verbrauch in kWh/100 km. Leer = `DEFAULT_CONSUMPTION` |
| `SOC_FALLBACK_DP` | optional: SoC aus dem Fahrzeug-Adapter, wenn das Auto nicht angesteckt ist |
| `CONTACT` | **bitte eintragen:** deine E-Mail-Adresse für Nominatim/OSRM (siehe unten) |
| `PLAN_END_HOUR` | Standard-Abfahrt am nächsten Morgen, wenn keine Abfahrt gewählt ist (6 = 06:00) |
| `SEND_FROM_HOUR` | ab dieser Uhrzeit am Tag vor der Abfahrt geht der Plan an evcc (16) |
| `PLAN_VIEW` | Planübersicht für die Visualisierung erzeugen (`true`) |
| `PLAN_VIEW_POLL_SEC` | so oft Pläne und Tarif aus evcc holen (60 s) |
| `PLAN_CHART_HOURS` | Zeitraum der Preisgrafik (24 h) |
| `PLAN_TZ` | Zeitzone für wiederholende Pläne (`Europe/Berlin`) |

Weitere Werte (Tarifzeiten, Plausibilitätsgrenzen, Cache-Größen) stehen kommentiert im Abschnitt `ab hier meist unverändert`.

## Datenpunkte (Auswahl)

| Datenpunkt | Richtung | Inhalt |
|---|---|---|
| `Zielort` | Eingabe | Adresse, Ort oder `lat,lon` |
| `Startort` | Eingabe | leer = Zuhause |
| `Abfahrt` | Eingabe | Abfahrt als ISO-Zeit, leer = nächster Morgen |
| `Plan1_Modus` | Eingabe | `ziel` = Ladeziel nach Zielort, `soc` = Ladeziel von Hand |
| `Hin_und_zurueck` | Schalter | Rückfahrt einrechnen |
| `Puffer_Prozent` | Schieberegler | Mindest-SoC nach der Fahrt (0–30 %) |
| `Aktiv` | Schalter | Zielort-Plan an evcc übergeben / löschen |
| `Favorit_Name`, `Favorit_Aktion` | Eingabe | Favorit merken (`merken`) oder löschen (`loeschen`) |
| `Favoriten_JSON`, `Letzte_Ziele_JSON`, `Auswahl_Start_JSON` | Anzeige | Auswahllisten `[{value, label}]` |
| `Plan_Ansicht_JSON` | Anzeige | evcc-Pläne, Strategie, nächster Plan, Tarif und Zielort-Daten für die Planansicht |
| `Plan_Befehl` | Eingabe (JSON) | Befehle an das Skript, siehe unten |
| `Status` | Anzeige | Klartext-Status |
| `Ziel_Adresse`, `Strecke_km`, `Autobahn_km`, `Fahrzeit` | Anzeige | Ergebnis der Routensuche |
| `Ziel_SoC`, `Bedarf_kWh`, `Ladedauer_h`, `Ladefenster`, `Planzeit` | Anzeige | Ergebnis der Ladeplanung |
| `Route_JSON`, `Ziel_Lat/Lon`, `Start_Lat/Lon`, `Home_Lat/Lon` | Anzeige | für eine Kartendarstellung |

### Befehle über `Plan_Befehl`

Wer eine eigene Oberfläche baut, schreibt JSON in `Plan_Befehl` (ohne ack):

| Befehl | Wirkung |
|---|---|
| `{"cmd":"single","soc":50,"time":"2026-10-19T05:30:00+02:00"}` | Einzelplan #1 von Hand setzen |
| `{"cmd":"single_off"}` | Einzelplan #1 löschen |
| `{"cmd":"repeating","plans":[{"weekdays":[1],"time":"05:30","soc":80,"active":true,"tz":"Europe/Berlin"}]}` | alle wiederholenden Pläne setzen |
| `{"cmd":"strategy","continuous":false,"precondition":0}` | Strategie setzen (`precondition` in Sekunden) |
| `{"cmd":"mode","mode":"ziel"}` bzw. `"soc"` | Modus von Plan #1 wechseln |
| `{"cmd":"trip","active":true,"time":"…"}` | Zielort-Plan schalten / Abfahrt setzen (`"time":""` = automatisch) |
| `{"cmd":"refresh"}` | Planübersicht sofort neu holen |

## Faire Nutzung von Nominatim und OSRM

Das Skript nutzt die **öffentlichen, kostenlosen Server** von OpenStreetMap/Nominatim und den OSRM-Demo-Server. Beide haben Nutzungsregeln. Wer dagegen verstößt, wird gesperrt:

- [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/): höchstens 1 Anfrage pro Sekunde, eigener User-Agent, keine Suche während der Eingabe (Autocomplete)
- [OSRM Demo-Server](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server): nur für geringe Nutzung

Das Skript hält sich daran:

- eigener User-Agent `ioBroker-Ladeplanung/2.2 (…; Kontakt: CONTACT)`
- höchstens 1 Anfrage pro Sekunde je Dienst, Anfragen strikt nacheinander
- Suche erst **2,5 s nach der letzten Eingabe** (`INPUT_DELAY_MS`), nicht bei jedem Tastendruck; Eingaben unter 3 Zeichen werden ignoriert
- **Cache** für Orte (100) und Routen (20, 30 Tage) in den Datenpunkten `Cache_Orte_JSON` / `Cache_Routen_JSON`
- bei HTTP 429/403 eine Stunde Pause für den betroffenen Dienst (Strecke dann per Luftlinie geschätzt)

**Bitte `CONTACT` ausfüllen** und die Drosselung nicht ausbauen. Wer viele Abfragen braucht, betreibt besser einen eigenen Nominatim-/OSRM-Server (z. B. per Docker) und trägt ihn in `NOMINATIM_URL` / `OSRM_URL` ein.

## Ablauf

1. Ziel eingeben → Route und Ziel-SoC werden berechnet und angezeigt.
2. Abfahrt wählen (oder automatisch: nächster Morgen 06:00) und Plan #1 bzw. `Aktiv` einschalten.
3. Vor 16:00 am Tag vor der Abfahrt wird der Plan nur vorgemerkt, danach geht er an evcc.
4. evcc lädt bis zur Abfahrt in den günstigsten Stunden seines Tarifs.
5. Nach der Abfahrt schaltet das Skript den Plan wieder aus. Schalter aus = Plan in evcc löschen.

## Hinweise

- evcc kennt pro Fahrzeug nur **einen** Einzelplan (#1). Zielort-Planung und Ladeziel von Hand teilen sich diesen Plan, deshalb der Umschalter. Wiederholende Pläne bleiben davon unberührt.
- Passt die nötige Energie nicht ins Nachtfenster, beginnt evcc früher; der Status zeigt dann „⚠ Beginn vor Niedrigtarif“.
- Gerechnet wird mit einem Durchschnittsverbrauch. Bei Kälte oder Anhänger den Mindest-SoC erhöhen.
- Das Skript greift in die Ladesteuerung ein. Bitte die ersten Male in evcc prüfen, ob der Plan wie erwartet angelegt wird.

## Changelog

- **2.2** – Planung nach Zielort und evcc-Pläne in einer Ansicht: Plan #1 umschaltbar „nach Zielort“ / „Ladeziel %“, Abfahrt frei wählbar (Übergabe an evcc ab 16 Uhr am Vortag), Plan endet nach der Abfahrt, neuer Aura-Tab
- **2.1** – evcc-Planübersicht: Einzelplan, wiederholende Pläne, Strategie, nächster Plan mit Ladedauer und Preis, Preisgrafik; Änderungen gehen per REST-API an evcc
- **2.0** – faire Nutzung von Nominatim/OSRM: Kontakt im User-Agent, Drosselung für beide Dienste, Suche erst nach fertiger Eingabe, Cache, Pause bei 429/403
- **1.9** – Autobahn-Anteil der Route mit eigenem Verbrauchsfaktor
- **1.8** – Mindest-SoC statt Puffer, Ladeziel auf volle 5 % gerundet

## Lizenz und Daten

MIT, siehe [LICENSE](LICENSE). Nutzung auf eigene Gefahr.

Kartendaten © [OpenStreetMap-Mitwirkende](https://www.openstreetmap.org/copyright) (ODbL). Suche über [Nominatim](https://nominatim.org), Routen über [OSRM](https://project-osrm.org).
