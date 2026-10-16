# ioBroker Ladeplanung – E-Auto nach Zielort laden

> „Dieser Text/Beitrag wurde mit Hilfe von KI erzeugt“

ioBroker-Skript (JavaScript-Adapter), das aus einem Fahrtziel einen Ladeplan für [evcc](https://evcc.io) macht.
Ziel eingeben, das Skript berechnet die Strecke und den nötigen Akkustand. Dann legt es in evcc einen Plan an, der im günstigen Nachttarif lädt.

Die Idee dahinter: Nachts wird nur so viel geladen, wie die Fahrt am nächsten Tag braucht. Den Rest füllt tagsüber die PV-Anlage.

## Funktionen

- **Zielort** als Adresse, Ort oder `lat,lon` eingeben, in einer Karte antippen oder aus Favoriten/letzten Zielen wählen
- **Startort** wählbar, leer = Zuhause (Standort aus den ioBroker-Systemeinstellungen)
- Strecke und Fahrzeit über **OpenStreetMap** (Nominatim + OSRM): kostenlos, ohne API-Key
- Optional **Hin- und Rückfahrt**
- **Autobahn-Anteil** wird mit höherem Verbrauch gerechnet (`HIGHWAY_FACTOR`)
- **Ziel-SoC = Fahrbedarf + Mindest-SoC**: Das Auto fällt nach der Fahrt nicht unter den Mindest-SoC (per Schieberegler einstellbar)
- Reicht der aktuelle SoC, wird **kein Plan** angelegt
- Plan „Ziel-SoC bis 06:00“ geht erst **ab 16:00** an evcc, damit kein gleich günstiges Mittagsfenster genutzt wird
- Ladelimit in evcc wird bei Bedarf angehoben und danach zurückgesetzt
- **Favoriten** und Liste der **letzten Ziele** (JSON, direkt als Auswahlliste nutzbar)
- Alle Datenpunkte legt das Skript beim ersten Start selbst an

## Voraussetzungen

- ioBroker mit **JavaScript-Adapter**
- **evcc** mit einem (dynamischen oder zeitvariablen) Tarif
- **ioBroker.evcc-Adapter** (liefert SoC, Fahrzeug und Ladelimit des Ladepunkts)
- Internetzugang von ioBroker aus
- Standort (Breiten-/Längengrad) in den ioBroker-Systemeinstellungen

## Installation

1. Im JavaScript-Adapter ein neues JavaScript-Skript anlegen und den Inhalt von [`Ladeplanung.js`](Ladeplanung.js) einfügen.
2. Den Block `---- ANPASSEN ----` in `CFG` ausfüllen (siehe unten).
3. Skript starten. Die Datenpunkte werden unter `CFG.BASE` angelegt (Standard: `0_userdata.0.Ladeplanung.`).
4. In der Visualisierung (VIS, Aura, …) Eingabefelder, Schalter und Anzeigen auf diese Datenpunkte legen.

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

Weitere Werte (Tarifzeiten, Plausibilitätsgrenzen, Cache-Größen) stehen kommentiert im Abschnitt `ab hier meist unverändert`.

## Datenpunkte (Auswahl)

| Datenpunkt | Richtung | Inhalt |
|---|---|---|
| `Zielort` | Eingabe | Adresse, Ort oder `lat,lon` |
| `Startort` | Eingabe | leer = Zuhause |
| `Hin_und_zurueck` | Schalter | Rückfahrt einrechnen |
| `Puffer_Prozent` | Schieberegler | Mindest-SoC nach der Fahrt (0–30 %) |
| `Aktiv` | Schalter | Ladeplan an evcc übergeben / löschen |
| `Favorit_Name`, `Favorit_Aktion` | Eingabe | Favorit merken (`merken`) oder löschen (`loeschen`) |
| `Favoriten_JSON`, `Letzte_Ziele_JSON`, `Auswahl_Start_JSON` | Anzeige | Auswahllisten `[{value, label}]` |
| `Status` | Anzeige | Klartext-Status |
| `Ziel_Adresse`, `Strecke_km`, `Autobahn_km`, `Fahrzeit` | Anzeige | Ergebnis der Routensuche |
| `Ziel_SoC`, `Bedarf_kWh`, `Ladedauer_h`, `Ladefenster`, `Planzeit` | Anzeige | Ergebnis der Ladeplanung |
| `Route_JSON`, `Ziel_Lat/Lon`, `Start_Lat/Lon`, `Home_Lat/Lon` | Anzeige | für eine Kartendarstellung |

## Faire Nutzung von Nominatim und OSRM

Das Skript nutzt die **öffentlichen, kostenlosen Server** von OpenStreetMap/Nominatim und den OSRM-Demo-Server. Beide haben Nutzungsregeln. Wer dagegen verstößt, wird gesperrt:

- [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/): höchstens 1 Anfrage pro Sekunde, eigener User-Agent, keine Suche während der Eingabe (Autocomplete)
- [OSRM Demo-Server](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server): nur für geringe Nutzung

Das Skript hält sich daran:

- eigener User-Agent `ioBroker-Ladeplanung/2.0 (…; Kontakt: CONTACT)`
- höchstens 1 Anfrage pro Sekunde je Dienst, Anfragen strikt nacheinander
- Suche erst **2,5 s nach der letzten Eingabe** (`INPUT_DELAY_MS`), nicht bei jedem Tastendruck; Eingaben unter 3 Zeichen werden ignoriert
- **Cache** für Orte (100) und Routen (20, 30 Tage) in den Datenpunkten `Cache_Orte_JSON` / `Cache_Routen_JSON`
- bei HTTP 429/403 eine Stunde Pause für den betroffenen Dienst (Strecke dann per Luftlinie geschätzt)

**Bitte `CONTACT` ausfüllen** und die Drosselung nicht ausbauen. Wer viele Abfragen braucht, betreibt besser einen eigenen Nominatim-/OSRM-Server (z. B. per Docker) und trägt ihn in `NOMINATIM_URL` / `OSRM_URL` ein.

## Ablauf

1. Ziel eingeben → Route und Ziel-SoC werden berechnet und angezeigt.
2. Schalter `Aktiv` ein → vor 16:00 wird der Plan nur vorgemerkt, ab 16:00 geht er an evcc.
3. evcc lädt bis 06:00 in den günstigsten Stunden seines Tarifs.
4. Um 06:05 schaltet das Skript `Aktiv` wieder aus. Schalter aus = Plan in evcc löschen.

## Changelog

- **2.0** – faire Nutzung von Nominatim/OSRM: Kontakt im User-Agent, Drosselung für beide Dienste, Suche erst nach fertiger Eingabe, Cache, Pause bei 429/403
- **1.9** – Autobahn-Anteil der Route mit eigenem Verbrauchsfaktor
- **1.8** – Mindest-SoC statt Puffer, Ladeziel auf volle 5 % gerundet

## Lizenz und Daten

MIT, siehe [LICENSE](LICENSE). Nutzung auf eigene Gefahr.

Kartendaten © [OpenStreetMap-Mitwirkende](https://www.openstreetmap.org/copyright) (ODbL). Suche über [Nominatim](https://nominatim.org), Routen über [OSRM](https://project-osrm.org).
