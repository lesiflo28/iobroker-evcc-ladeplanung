/**
 * Ladeplanung E-Auto mit Zielort -> evcc-Ladeplan im günstigen Nachttarif
 * Version 2.0 – 2026-10-16
 *
 * Projekt: https://github.com/lesiflo28/iobroker-evcc-ladeplanung
 *
 * Funktion:
 *  - Zielort eingeben (Adresse, Ort oder "lat,lon"), in der Karte antippen oder aus Favoriten /
 *    letzten Zielen wählen.
 *  - Startort wählbar (Eingabe, Favorit, letzte Ziele oder Karte); leer = Zuhause
 *    (Koordinaten aus den ioBroker-Systemeinstellungen).
 *  - Favoritenliste (Ziel merken / löschen) und Liste der letzten Ziele.
 *  - Ort-Suche über OpenStreetMap/Nominatim, Straßen-Strecke über OSRM – kostenlos, ohne API-Key.
 *    Optional mit Rückfahrt (Schalter "Hin & zurück").
 *  - Ziel-SoC = Fahrbedarf (Strecke x Ø-Verbrauch) + Mindest-SoC (Schieberegler in der Visualisierung,
 *    Standard CFG.MIN_SOC = 10 %). Das Auto fällt damit nach der Fahrt nicht unter den Mindest-SoC.
 *  - Reicht der aktuelle SoC, wird kein Plan angelegt.
 *  - Sonst wird in evcc ein Fahrzeug-Plan "Ziel-SoC bis 06:00" angelegt (evcc-REST-API).
 *    evcc legt die Ladung selbst in die günstigsten Zeitfenster seines Tarifs.
 *  - Der Plan wird erst ab 16:00 an evcc übergeben, damit ein gleich günstiges Mittagsfenster
 *    (z. B. 12–16 Uhr) nicht genutzt wird -> es wird nachts geladen.
 *  - Schalter aus = Plan in evcc löschen. Nach 06:00 endet der Plan automatisch.
 *  - Alle Datenpunkte legt das Skript beim ersten Start selbst an (unter CFG.BASE).
 *
 * Änderungen 1.8:
 *  - Der Puffer ist jetzt der Mindest-SoC: so viel % sollen nach der Fahrt mindestens übrig bleiben.
 *    Einstellbar per Schieberegler (Datenpunkt Puffer_Prozent), Standardwert CFG.MIN_SOC.
 *  - Ladeziel wird auf volle 5 % aufgerundet (CFG.ROUND_STEP).
 *
 * Änderungen 1.9:
 *  - Autobahn-Anteil der Route wird berücksichtigt: OSRM liefert je Abschnitt, ob er Autobahn ist
 *    (bzw. schnell befahren wird). Für diese Kilometer wird mit dem gelernten Verbrauch x
 *    CFG.HIGHWAY_FACTOR gerechnet, für den Rest mit dem gelernten Verbrauch.
 *  - Neuer Datenpunkt Autobahn_km (einfache Strecke); Verbrauch_kWh100km zeigt jetzt den
 *    für diese Fahrt berechneten Mischverbrauch.
 *
 * Änderungen 2.0 – faire Nutzung der kostenlosen Dienste Nominatim und OSRM:
 *  - Eigene Kennung (User-Agent) mit Kontaktadresse: bitte CFG.CONTACT eintragen.
 *  - Nominatim und OSRM: Anfragen strikt nacheinander, höchstens 1 pro Sekunde je Dienst.
 *  - Suche erst nach fertiger Eingabe: Start/Ziel werden erst CFG.INPUT_DELAY_MS nach der
 *    letzten Änderung gesucht, nicht bei jedem Tastendruck. Kürzere Eingaben als
 *    CFG.MIN_INPUT_LEN werden nicht gesucht.
 *  - Cache für Orte und Routen (Datenpunkte Cache_Orte_JSON / Cache_Routen_JSON): Zuhause,
 *    Favoriten und schon gesuchte Ziele lösen keine neue Anfrage aus.
 *  - Meldet ein Dienst HTTP 429/403 (zu viele Anfragen / gesperrt), fragt das Skript ihn
 *    CFG.BLOCK_PAUSE_MIN Minuten lang nicht mehr an (Strecke dann per Luftlinie geschätzt).
 *  - Wer viel abfragt: NOMINATIM_URL / OSRM_URL auf einen eigenen Server umstellen.
 *
 * Voraussetzungen: JavaScript-Adapter, evcc mit Tarif, ioBroker.evcc-Adapter, Internetzugang.
 * Kartendaten: © OpenStreetMap-Mitwirkende (ODbL), Suche: Nominatim, Routen: OSRM.
 * Lizenz: MIT – Nutzung auf eigene Gefahr.
 */

const http = require('http');
const https = require('https');

// ===================== KONFIGURATION =====================
const CFG = {
    // ---- ANPASSEN ----
    EVCC_URL: 'http://192.168.1.10:7070',   // Adresse der evcc-Weboberfläche (IP/Port anpassen)
    EVCC_INSTANCE: 'evcc.0',                 // Instanz des ioBroker.evcc-Adapters
    LOADPOINT: 1,                            // Ladepunkt-Nummer in evcc (1 = erster)
    VEHICLE_FALLBACK: '',                    // evcc-Fahrzeugname (z. B. "db:1" oder "mein_auto"), nur nötig,
                                             // wenn das Auto beim Anlegen des Plans nicht am Ladepunkt erkannt ist
    CAPACITY_KWH: 60,                        // nutzbare Akkukapazität in kWh
    CHARGE_KW: 11,                           // Ladeleistung der Wallbox (nur für die Schätzung)
    MIN_SOC: 10,                             // Mindest-SoC in %: darunter soll das Auto nach der Fahrt nicht fallen.
                                             // Standardwert für den Schieberegler (Datenpunkt Puffer_Prozent);
                                             // gilt auch, wenn der Datenpunkt leer/ungültig ist
    ROUND_STEP: 5,                           // Ladeziel immer auf volle 5 % aufrunden (1 = auf ganze %)
    HIGHWAY_FACTOR: 1.4,                     // Autobahn-Verbrauch = gelernter Ø-Verbrauch x Faktor
                                             // (Richtwert für ca. 120–130 km/h; 1 = Autobahn nicht gesondert rechnen)
    BASE: '0_userdata.0.Ladeplanung.',       // hier werden die Datenpunkte angelegt
    CONSUMPTION_DPS: [                       // optional: Datenpunkte mit Ø-Verbrauch in kWh/100 km (erster gültiger zählt),
                                             // z. B. '0_userdata.0.Auto.Verbrauch_kWh100km'. Leer = DEFAULT_CONSUMPTION
    ],
    SOC_FALLBACK_DP: '',                     // optional: SoC-Datenpunkt des Fahrzeug-Adapters, wenn nicht angesteckt,
                                             // z. B. 'skoda-public-api.0.<FIN>.charging.status.battery.stateOfChargeInPercent'
    CONTACT: '',                             // deine E-Mail-Adresse: wird im User-Agent und an Nominatim mitgeschickt,
                                             // damit dich der Betreiber bei Problemen erreichen kann, statt zu sperren
    // ---- ab hier meist unverändert ----
    CHARGE_EFF: 0.9,                    // nur für die Schätzung, falls die evcc-Vorschau nicht klappt
    PLAN_END_HOUR: 6,                   // Plan fertig um 06:00 (Ende Nacht-Niedrigtarif)
    NIGHT_START_HOUR: 2,                // Beginn Nacht-Niedrigtarif (nur für Hinweis im Status)
    SEND_FROM_HOUR: 16,                 // Plan erst ab 16:00 an evcc übergeben (Mittagstarif ausschließen)
    DEFAULT_CONSUMPTION: 18,            // kWh/100 km, falls kein gelernter Wert vorhanden
    MIN_CONSUMPTION: 12,                // Plausibilitätsgrenzen für den gelernten Wert
    MAX_CONSUMPTION: 30,
    HIGHWAY_SPEED_KMH: 85,              // Abschnitte mit Ø-Routengeschwindigkeit ab hier zählen auch als Autobahn
                                        // (z. B. autobahnähnliche Bundesstraßen); 0 = nur echte Autobahnen
    RAISE_LIMIT: true,                  // Ladelimit in evcc anheben, wenn Ziel-SoC darüber liegt (danach zurück)
    // --- Routing
    HOME: null,                         // null = Koordinaten aus system.config, sonst z. B. { lat: 51.16, lon: 10.45 }
    NOMINATIM_URL: 'https://nominatim.openstreetmap.org/search',
    NOMINATIM_REVERSE_URL: 'https://nominatim.openstreetmap.org/reverse',
    OSRM_URL: 'https://router.project-osrm.org/route/v1/driving',
    USER_AGENT: 'ioBroker-Ladeplanung/2.0',   // Kennung des Skripts (Pflicht bei Nominatim, kein Node-Standard)
    MIN_REQUEST_GAP_MS: 1100,           // Mindestabstand zwischen zwei Anfragen je Dienst (max. 1 pro Sekunde)
    BLOCK_PAUSE_MIN: 60,                // nach HTTP 429/403 so lange keine Anfragen an diesen Dienst
    INPUT_DELAY_MS: 2500,               // erst so lange nach der letzten Eingabe suchen (kein Suchen beim Tippen)
    MIN_INPUT_LEN: 3,                   // kürzere Eingaben werden nicht gesucht
    GEO_CACHE_MAX: 100,                 // Anzahl gemerkter Orte
    ROUTE_CACHE_MAX: 20,                // Anzahl gemerkter Routen
    ROUTE_CACHE_DAYS: 30,               // Routen danach neu berechnen (Baustellen, neue Straßen)
    FALLBACK_FACTOR: 1.3,               // Luftlinie x Faktor, falls OSRM nicht erreichbar
    MAX_RECENT: 10,                     // Anzahl der gemerkten letzten Ziele
};

const BASE = CFG.BASE;
const EV = CFG.EVCC_INSTANCE;
const DP = {
    zielort:     BASE + 'Zielort',
    startort:    BASE + 'Startort',            // leer = Zuhause
    startAdr:    BASE + 'Start_Adresse',
    startLat:    BASE + 'Start_Lat',
    startLon:    BASE + 'Start_Lon',
    startSel:    BASE + 'Auswahl_Start_JSON',  // Zuhause + Favoriten + letzte Ziele für die Start-Auswahl
    favJson:     BASE + 'Favoriten_JSON',      // [{value, label}] – zugleich Auswahlliste für die Visualisierung
    lastJson:    BASE + 'Letzte_Ziele_JSON',   // [{value, label}] – zugleich Auswahlliste für die Visualisierung
    favName:     BASE + 'Favorit_Name',        // optionaler Name beim Merken
    favAktion:   BASE + 'Favorit_Aktion',      // "merken" | "loeschen"
    rueck:       BASE + 'Hin_und_zurueck',
    adresse:     BASE + 'Ziel_Adresse',
    fahrzeit:    BASE + 'Fahrzeit',
    zielLat:     BASE + 'Ziel_Lat',
    zielLon:     BASE + 'Ziel_Lon',
    routeJson:   BASE + 'Route_JSON',          // [[lat,lon],…] für die Karte
    km:          BASE + 'Strecke_km',         // einfache Strecke, vom Skript berechnet
    autobahnKm:  BASE + 'Autobahn_km',        // davon Autobahn (einfache Strecke)
    minSoc:     BASE + 'Puffer_Prozent',     // Mindest-SoC nach der Fahrt (Schieberegler)
    aktiv:      BASE + 'Aktiv',
    status:      BASE + 'Status',
    zielSoc:     BASE + 'Ziel_SoC',
    bedarf:      BASE + 'Bedarf_kWh',
    dauer:       BASE + 'Ladedauer_h',
    planzeit:    BASE + 'Planzeit',
    fenster:     BASE + 'Ladefenster',
    verbrauch:   BASE + 'Verbrauch_kWh100km',
    gesendet:    BASE + 'Plan_an_evcc',
    limitVorher: BASE + 'Limit_vorher',
    homeLat:     BASE + 'Home_Lat',
    homeLon:     BASE + 'Home_Lon',
    geoCache:    BASE + 'Cache_Orte_JSON',     // intern: gefundene Orte
    routeCache:  BASE + 'Cache_Routen_JSON',   // intern: berechnete Routen
};

/** Datenpunkt-Definitionen – werden beim ersten Start angelegt */
const DP_DEFS = [
    [DP.zielort,     '',    { name: 'Zielort (Adresse, Ort oder lat,lon)', type: 'string', role: 'text', write: true }],
    [DP.startort,    '',    { name: 'Startort (leer = Zuhause)', type: 'string', role: 'text', write: true }],
    [DP.startAdr,    'Zuhause', { name: 'Gefundene Startadresse', type: 'string', role: 'text', write: false }],
    [DP.startLat,    0,     { name: 'Start Breitengrad', type: 'number', role: 'value.gps.latitude', write: false }],
    [DP.startLon,    0,     { name: 'Start Längengrad', type: 'number', role: 'value.gps.longitude', write: false }],
    [DP.startSel,    '[]',  { name: 'Auswahlliste Start', type: 'string', role: 'json', write: false }],
    [DP.favJson,     '[]',  { name: 'Favoriten [{value,label}]', type: 'string', role: 'json', write: false }],
    [DP.lastJson,    '[]',  { name: 'Letzte Ziele [{value,label}]', type: 'string', role: 'json', write: false }],
    [DP.favName,     '',    { name: 'Name für neuen Favoriten (optional)', type: 'string', role: 'text', write: true }],
    [DP.favAktion,   '',    { name: 'Favoriten-Aktion (merken/loeschen)', type: 'string', role: 'text', write: true }],
    [DP.rueck,       true,  { name: 'Rückfahrt einrechnen', type: 'boolean', role: 'switch', write: true }],
    [DP.minSoc,      CFG.MIN_SOC, { name: 'Mindest-SoC nach der Fahrt', type: 'number', role: 'level', unit: '%', min: 0, max: 30, write: true }],
    [DP.aktiv,       false, { name: 'Ladeplan aktiv', type: 'boolean', role: 'switch', write: true }],
    [DP.adresse,     '-',   { name: 'Gefundene Zieladresse', type: 'string', role: 'text', write: false }],
    [DP.fahrzeit,    '-',   { name: 'Fahrzeit einfach', type: 'string', role: 'text', write: false }],
    [DP.km,          0,     { name: 'Strecke einfach', type: 'number', role: 'value.distance', unit: 'km', write: false }],
    [DP.autobahnKm,  0,     { name: 'Davon Autobahn (einfach)', type: 'number', role: 'value.distance', unit: 'km', write: false }],
    [DP.zielLat,     0,     { name: 'Ziel Breitengrad', type: 'number', role: 'value.gps.latitude', write: false }],
    [DP.zielLon,     0,     { name: 'Ziel Längengrad', type: 'number', role: 'value.gps.longitude', write: false }],
    [DP.routeJson,   '[]',  { name: 'Routenverlauf [[lat,lon],…]', type: 'string', role: 'json', write: false }],
    [DP.homeLat,     0,     { name: 'Zuhause Breitengrad', type: 'number', role: 'value.gps.latitude', write: false }],
    [DP.homeLon,     0,     { name: 'Zuhause Längengrad', type: 'number', role: 'value.gps.longitude', write: false }],
    [DP.status,      '-',   { name: 'Status', type: 'string', role: 'text', write: false }],
    [DP.zielSoc,     0,     { name: 'Ziel-SoC inkl. Mindest-SoC', type: 'number', role: 'value', unit: '%', write: false }],
    [DP.bedarf,      0,     { name: 'Nachzuladende Energie', type: 'number', role: 'value.energy', unit: 'kWh', write: false }],
    [DP.dauer,       0,     { name: 'Geschätzte Ladedauer', type: 'number', role: 'value', unit: 'h', write: false }],
    [DP.planzeit,    '-',   { name: 'Plan fertig bis', type: 'string', role: 'text', write: false }],
    [DP.fenster,     '-',   { name: 'Von evcc geplantes Ladefenster', type: 'string', role: 'text', write: false }],
    [DP.verbrauch,   0,     { name: 'Verwendeter Verbrauch', type: 'number', role: 'value', unit: 'kWh/100km', write: false }],
    [DP.gesendet,    false, { name: 'Plan an evcc übergeben', type: 'boolean', role: 'indicator', write: false }],
    [DP.geoCache,    '{}',  { name: 'intern: Cache gefundener Orte', type: 'string', role: 'json', write: false }],
    [DP.routeCache,  '{}',  { name: 'intern: Cache berechneter Routen', type: 'string', role: 'json', write: false }],
    [DP.limitVorher, -1,    { name: 'intern: Ladelimit vor Anhebung (-1 = nicht angehoben)', type: 'number', role: 'value', write: false }],
];

const SRC = {
    consumption:   CFG.CONSUMPTION_DPS.filter(Boolean),
    evccSoc:       `${EV}.loadpoint.${CFG.LOADPOINT}.status.vehicleSoc`,
    evccConnected: `${EV}.loadpoint.${CFG.LOADPOINT}.status.connected`,
    evccVehicle:   `${EV}.loadpoint.${CFG.LOADPOINT}.status.vehicleName`,
    lpLimit:       `${EV}.loadpoint.${CFG.LOADPOINT}.control.limitSoc`,
    socFallback:   CFG.SOC_FALLBACK_DP || '',
};

// ===================== HILFSFUNKTIONEN =====================
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const pad = n => String(n).padStart(2, '0');
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtPlan = d => `${WD[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}. ${hhmm(d)}`;
const rfc3339 = d => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

function val(id, def) {
    if (!existsState(id)) return def;
    const s = getState(id);
    return (s && s.val !== null && s.val !== undefined) ? s.val : def;
}
function num(id, def) {
    const v = parseFloat(val(id, def));
    return isNaN(v) ? def : v;
}
function setIfChanged(id, v) {
    const s = getState(id);
    if (!s || s.val !== v) setState(id, v, true);
}

/** URL zerlegen – ohne die Klasse URL, die im Skript-Sandbox des JavaScript-Adapters fehlt */
function parseUrl(url) {
    const m = String(url).match(/^(https?):\/\/([^/:?#]+)(?::(\d+))?([^?#]*)(\?[^#]*)?/i);
    if (!m) throw new Error(`Ungültige URL: ${url}`);
    const https_ = m[1].toLowerCase() === 'https';
    return {
        https: https_,
        hostname: m[2],
        port: m[3] ? parseInt(m[3], 10) : (https_ ? 443 : 80),
        pathname: m[4] || '/',
        search: m[5] || '',
    };
}

/** HTTP-Aufruf an evcc (GET/POST/DELETE) */
function evcc(method, path) {
    return new Promise((resolve, reject) => {
        const u = parseUrl(CFG.EVCC_URL + path);
        const req = http.request({
            hostname: u.hostname,
            port: u.port,
            path: u.pathname + u.search,
            method,
            timeout: 10000,
            headers: { 'Content-Length': 0 },
        }, res => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    let j = {};
                    try { j = body ? JSON.parse(body) : {}; } catch (e) { j = { raw: body }; }
                    resolve(j && j.result !== undefined ? j.result : j);
                } else {
                    reject(new Error(`evcc ${method} ${u.pathname} -> HTTP ${res.statusCode} ${body.slice(0, 200)}`));
                }
            });
        });
        req.on('timeout', () => req.destroy(new Error('Timeout')));
        req.on('error', reject);
        req.end();
    });
}

/** Fahrzeugname für den URL-Pfad (Doppelpunkt wie bei "db:1" bleibt erhalten) */
function vehPath(name) {
    return encodeURIComponent(name).replace(/%3A/gi, ':');
}

function vehicleName() {
    return String(val(SRC.evccVehicle, '') || '') || CFG.VEHICLE_FALLBACK || '';
}

/** Aktueller SoC: evcc wenn angesteckt, sonst optionaler Fallback-Datenpunkt */
function currentSoc() {
    const connected = !!val(SRC.evccConnected, false);
    const evccSoc = num(SRC.evccSoc, 0);
    if (connected && evccSoc > 0) return { soc: evccSoc, src: 'evcc' };
    const fb = SRC.socFallback ? num(SRC.socFallback, 0) : 0;
    if (fb > 0) return { soc: fb, src: 'Fallback' };
    return { soc: evccSoc, src: 'evcc' };
}

/** Verbrauch kWh/100 km (Akku-seitig, gelernt) */
function consumption() {
    for (const id of SRC.consumption) {
        const v = num(id, 0);
        if (v >= CFG.MIN_CONSUMPTION && v <= CFG.MAX_CONSUMPTION) return v;
    }
    return CFG.DEFAULT_CONSUMPTION;
}

/** Mindest-SoC in %: Schieberegler, sonst CFG.MIN_SOC */
function minSoc() {
    const v = num(DP.minSoc, CFG.MIN_SOC);
    return Math.max(0, Math.min(100, v));
}

/** Nächster Zielzeitpunkt 06:00 */
function nextPlanTime(now = new Date()) {
    const d = new Date(now);
    d.setHours(CFG.PLAN_END_HOUR, 0, 0, 0);
    if (now >= d) d.setDate(d.getDate() + 1);
    return d;
}

/** Darf jetzt an evcc übergeben werden? (16:00 bis 06:00) */
function sendAllowed(now = new Date()) {
    const h = now.getHours();
    return h >= CFG.SEND_FROM_HOUR || h < CFG.PLAN_END_HOUR;
}

/** Effektives Ladelimit in evcc (0 am Ladepunkt = Fahrzeuglimit) */
function effectiveLimit(veh) {
    const lp = num(SRC.lpLimit, 0);
    if (lp > 0) return lp;
    const vl = num(`${EV}.vehicle.${veh}.limitSoc`, 0);
    return vl > 0 ? vl : 100;
}

// ===================== ROUTING (Zielort -> km) =====================
/** Kennung für Nominatim/OSRM, z. B. "ioBroker-Ladeplanung/2.0 (ioBroker-Skript; Kontakt: name@example.org)" */
function userAgent() {
    const c = String(CFG.CONTACT || '').trim();
    return `${CFG.USER_AGENT} (ioBroker-Skript${c ? '; Kontakt: ' + c : ''})`;
}

function httpsJson(url) {
    return new Promise((resolve, reject) => {
        const u = parseUrl(url);
        const req = (u.https ? https : http).get({
            hostname: u.hostname,
            port: u.port,
            path: u.pathname + u.search,
            headers: { 'User-Agent': userAgent(), 'Accept': 'application/json', 'Accept-Language': 'de' },
            timeout: 15000,
        }, res => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    const err = new Error(`HTTP ${res.statusCode} von ${u.hostname}`);
                    err.status = res.statusCode;
                    return reject(err);
                }
                try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Ungültige Antwort von ' + u.hostname)); }
            });
        });
        req.on('timeout', () => req.destroy(new Error('Timeout')));
        req.on('error', reject);
    });
}

function homeCoords() {
    if (CFG.HOME) return CFG.HOME;
    const sys = getObject('system.config');
    const lat = parseFloat(sys && sys.common && sys.common.latitude);
    const lon = parseFloat(sys && sys.common && sys.common.longitude);
    if (isNaN(lat) || isNaN(lon)) throw new Error('Heimatkoordinaten fehlen (system.config)');
    return { lat, lon };
}

function haversineKm(a, b) {
    const R = 6371, r = x => x * Math.PI / 180;
    const dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

function fmtDuration(sec) {
    const m = Math.round(sec / 60);
    return m >= 60 ? `${Math.floor(m / 60)} h ${pad(m % 60)} min` : `${m} min`;
}

/**
 * Kostenlose Dienste (Nominatim, OSRM) fair nutzen: Anfragen je Dienst strikt nacheinander,
 * höchstens 1 pro Sekunde. Nach HTTP 429/403 wird der Dienst eine Weile gar nicht angefragt.
 */
const services = {};
function fairRequest(service, url) {
    const s = services[service] || (services[service] = { chain: Promise.resolve(), last: 0, pausedUntil: 0 });
    const p = s.chain.then(async () => {
        if (Date.now() < s.pausedUntil) {
            throw new Error(`${service} pausiert bis ${hhmm(new Date(s.pausedUntil))} (zu viele Anfragen)`);
        }
        const wait = s.last + CFG.MIN_REQUEST_GAP_MS - Date.now();
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        s.last = Date.now();
        try {
            return await httpsJson(url);
        } catch (e) {
            if (e.status === 429 || e.status === 403) {
                s.pausedUntil = Date.now() + CFG.BLOCK_PAUSE_MIN * 60000;
                log(`Ladeplanung: ${service} meldet HTTP ${e.status} – keine Anfragen bis ${hhmm(new Date(s.pausedUntil))}. ` +
                    'Bitte CFG.CONTACT / CFG.USER_AGENT prüfen und seltener abfragen.', 'warn');
            }
            throw e;
        } finally {
            s.last = Date.now();   // Abstand ab Ende der Anfrage zählen
        }
    });
    s.chain = p.catch(() => {});
    return p;
}
function nominatim(url) {
    const c = String(CFG.CONTACT || '').trim();
    return fairRequest('Nominatim', c.includes('@') ? `${url}&email=${encodeURIComponent(c)}` : url);
}
const osrm = url => fairRequest('OSRM', url);

/** Einfacher Cache in einem Datenpunkt: { key: { t: Zeitstempel, v: Wert } }, älteste fliegen zuerst raus */
function readCache(id) {
    try {
        const o = JSON.parse(val(id, '{}') || '{}');
        return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch (e) { return {}; }
}
function cacheGet(id, key, maxAgeMs = 0) {
    const e = readCache(id)[key];
    if (!e || !e.v) return null;
    if (maxAgeMs > 0 && Date.now() - (e.t || 0) > maxAgeMs) return null;
    return e.v;
}
function cachePut(id, key, value, max) {
    const c = readCache(id);
    delete c[key];
    c[key] = { t: Date.now(), v: value };
    const keys = Object.keys(c);
    for (let i = 0; i < keys.length - max; i++) delete c[keys[i]];
    setState(id, JSON.stringify(c), true);
}
const cacheText = t => String(t).trim().toLowerCase().replace(/\s+/g, ' ');

/** Kurzer Name für Listen, z. B. "Hauptbahnhof, Hamburg" */
function shortLabel(r, fallback) {
    const a = (r && r.address) || {};
    const city = a.city || a.town || a.village || a.municipality || a.county || '';
    const first = (r && r.name) || [a.road, a.house_number].filter(Boolean).join(' ') ||
                  String((r && r.display_name) || '').split(',')[0].trim();
    let label = first && city && first !== city ? `${first}, ${city}` : (first || city || fallback || '');
    if (label.length > 60) label = label.slice(0, 57) + '…';
    return label || fallback || '?';
}

/** Ort -> Koordinaten (Nominatim) oder direkt "lat,lon" */
async function geocode(text) {
    const m = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) {
        // Koordinaten (z. B. aus der Karte): Adresse per Rückwärtssuche ermitteln, nur für die Anzeige
        const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
        const key = `r:${lat.toFixed(5)},${lon.toFixed(5)}`;
        const hit = cacheGet(DP.geoCache, key);
        if (hit) return hit;
        let name = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
        let label = name;
        let found = false;
        try {
            const r = await nominatim(`${CFG.NOMINATIM_REVERSE_URL}?format=jsonv2&zoom=17&addressdetails=1&lat=${lat}&lon=${lon}`);
            if (r && r.display_name) { name = r.display_name; label = shortLabel(r, label); found = true; }
        } catch (e) {
            log(`Ladeplanung: Rückwärtssuche fehlgeschlagen (${e.message})`, 'info');
        }
        const res = { lat, lon, name, label };
        if (found) cachePut(DP.geoCache, key, res, CFG.GEO_CACHE_MAX);
        return res;
    }
    if (text.trim().length < CFG.MIN_INPUT_LEN) throw new Error(`Eingabe "${text.trim()}" zu kurz`);
    const key = 'q:' + cacheText(text);
    const hit = cacheGet(DP.geoCache, key);
    if (hit) return hit;
    const url = `${CFG.NOMINATIM_URL}?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(text)}`;
    const r = await nominatim(url);
    if (!Array.isArray(r) || !r.length) throw new Error(`Ort "${text}" nicht gefunden`);
    const res = { lat: parseFloat(r[0].lat), lon: parseFloat(r[0].lon), name: r[0].display_name, label: shortLabel(r[0], text) };
    cachePut(DP.geoCache, key, res, CFG.GEO_CACHE_MAX);
    return res;
}

/** Autobahn-Meter einer OSRM-Route: Abschnitt mit Klasse "motorway" oder hoher Ø-Geschwindigkeit */
function highwayMeters(rt) {
    let m = 0;
    for (const leg of rt.legs || []) {
        for (const st of leg.steps || []) {
            const ix = Array.isArray(st.intersections) ? st.intersections : [];
            const cls = ix.length && Array.isArray(ix[0].classes) ? ix[0].classes : [];
            const kmh = st.duration > 0 ? st.distance / st.duration * 3.6 : 0;
            const fast = CFG.HIGHWAY_SPEED_KMH > 0 && kmh >= CFG.HIGHWAY_SPEED_KMH;
            if (cls.includes('motorway') || fast) m += st.distance || 0;
        }
    }
    return m;
}

/** Straßen-Strecke Start -> Ziel (OSRM), Fallback Luftlinie x Faktor */
async function route(from, to) {
    const f4 = x => Number(x).toFixed(4);   // ca. 10 m Genauigkeit reicht für den Cache
    const key = `w:${f4(from.lat)},${f4(from.lon)};${f4(to.lat)},${f4(to.lon)};${CFG.HIGHWAY_SPEED_KMH}`;
    const hit = cacheGet(DP.routeCache, key, CFG.ROUTE_CACHE_DAYS * 86400000);
    if (hit) return hit;
    try {
        const url = `${CFG.OSRM_URL}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=simplified&geometries=geojson&alternatives=false&steps=true`;
        const r = await osrm(url);
        if (r.code !== 'Ok' || !r.routes || !r.routes.length) throw new Error(r.message || r.code || 'keine Route');
        const rt = r.routes[0];
        const g = rt.geometry;
        const line = (g && Array.isArray(g.coordinates))
            ? g.coordinates.map(c => [Math.round(c[1] * 1e5) / 1e5, Math.round(c[0] * 1e5) / 1e5])
            : [[from.lat, from.lon], [to.lat, to.lon]];
        const km = rt.distance / 1000;
        const hwKm = Math.min(km, highwayMeters(rt) / 1000);
        const res = { km, hwKm, sec: rt.duration, exact: true, line };
        cachePut(DP.routeCache, key, res, CFG.ROUTE_CACHE_MAX);
        return res;
    } catch (e) {
        log(`Ladeplanung: Routing fehlgeschlagen (${e.message}) – nutze Luftlinie x ${CFG.FALLBACK_FACTOR}`, 'warn');
        return { km: haversineKm(from, to) * CFG.FALLBACK_FACTOR, hwKm: 0, sec: 0, exact: false, line: [[from.lat, from.lon], [to.lat, to.lon]] };
    }
}

function clearDestination() {
    setState(DP.km, 0, true);
    setState(DP.autobahnKm, 0, true);
    setState(DP.adresse, '-', true);
    setState(DP.fahrzeit, '-', true);
    setState(DP.zielLat, 0, true);
    setState(DP.zielLon, 0, true);
    setState(DP.routeJson, '[]', true);
}

// ===================== STARTORT =====================
function startCoords() {
    const lat = num(DP.startLat, 0), lon = num(DP.startLon, 0);
    if (String(val(DP.startort, '') || '').trim() && lat && lon) return { lat, lon };
    return homeCoords();
}

async function resolveStart() {
    const text = String(val(DP.startort, '') || '').trim();
    try {
        if (!text) {
            const h = homeCoords();
            setState(DP.startAdr, 'Zuhause', true);
            setState(DP.startLat, h.lat, true);
            setState(DP.startLon, h.lon, true);
        } else {
            setState(DP.status, `Suche Startort "${text}" …`, true);
            const st = await geocode(text);
            setState(DP.startAdr, st.label, true);
            setState(DP.startLat, Math.round(st.lat * 1e5) / 1e5, true);
            setState(DP.startLon, Math.round(st.lon * 1e5) / 1e5, true);
            log(`Ladeplanung: Start "${text}" -> ${st.name}`);
        }
    } catch (e) {
        setState(DP.startAdr, `Fehler: ${e.message} – rechne ab Zuhause`, true);
        setState(DP.startLat, 0, true);
        setState(DP.startLon, 0, true);
        log(`Ladeplanung: Startort – ${e.message}`, 'warn');
    }
    if (String(val(DP.zielort, '') || '').trim()) await resolveDestination();
    else trigger(500);
}

// ===================== FAVORITEN / LETZTE ZIELE =====================
function readList(id) {
    try {
        const a = JSON.parse(val(id, '[]') || '[]');
        return Array.isArray(a) ? a.filter(e => e && typeof e.value === 'string' && e.value) : [];
    } catch (e) { return []; }
}
const sameValue = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** Auswahlliste für den Start: Zuhause, Favoriten, letzte Ziele (ohne Doppelte) */
function writeStartSelection() {
    const sel = [{ value: '', label: 'Zuhause' }];
    for (const e of readList(DP.favJson).concat(readList(DP.lastJson))) {
        if (!sel.some(x => sameValue(x.value, e.value))) sel.push({ value: e.value, label: e.label });
    }
    setIfChanged(DP.startSel, JSON.stringify(sel));
}

function addRecent(value, label) {
    let last = readList(DP.lastJson).filter(e => !sameValue(e.value, value));
    last.unshift({ value, label });
    last = last.slice(0, CFG.MAX_RECENT);
    setState(DP.lastJson, JSON.stringify(last), true);
    writeStartSelection();
}

function labelFor(value) {
    const hit = readList(DP.lastJson).find(e => sameValue(e.value, value)) ||
                readList(DP.favJson).find(e => sameValue(e.value, value));
    if (hit) return hit.label;
    const adr = String(val(DP.adresse, '') || '');
    return adr && adr !== '-' ? adr.split(',').slice(0, 2).join(',').trim() : value;
}

function favoriteAction(action) {
    const ziel = String(val(DP.zielort, '') || '').trim();
    const name = String(val(DP.favName, '') || '').trim();
    let fav = readList(DP.favJson);
    let msg;
    if (action === 'merken') {
        if (!ziel) {
            msg = 'Favorit: erst ein Ziel eingeben';
        } else {
            const label = name || labelFor(ziel);
            const i = fav.findIndex(f => sameValue(f.value, ziel));
            if (i >= 0) fav[i].label = label; else fav.push({ value: ziel, label });
            msg = `Favorit gespeichert: ${label}`;
        }
    } else if (action === 'loeschen') {
        const before = fav.length;
        fav = fav.filter(f => !(sameValue(f.value, ziel) || (name && sameValue(f.label, name))));
        msg = fav.length < before ? 'Favorit gelöscht' : 'Aktuelles Ziel ist kein Favorit';
    } else {
        return;
    }
    fav.sort((a, b) => a.label.localeCompare(b.label, 'de'));
    setState(DP.favJson, JSON.stringify(fav), true);
    setState(DP.favName, '', true);
    writeStartSelection();
    setState(DP.status, msg, true);
    log(`Ladeplanung: ${msg}`);
    trigger(4000);   // danach wieder den normalen Status anzeigen
}

// ===================== ZIELORT =====================
async function resolveDestination() {
    const text = String(val(DP.zielort, '') || '').trim();
    if (!text) {
        clearDestination();
        trigger(200);
        return;
    }
    setState(DP.status, `Suche Route nach "${text}" …`, true);
    try {
        const from = startCoords();
        const dest = await geocode(text);
        const r = await route(from, dest);
        const km = Math.round(r.km);
        const hwKm = Math.min(km, Math.round(r.hwKm));
        setState(DP.km, km, true);
        setState(DP.autobahnKm, hwKm, true);
        setState(DP.adresse, dest.name.length > 120 ? dest.name.slice(0, 117) + '…' : dest.name, true);
        setState(DP.fahrzeit, r.exact ? fmtDuration(r.sec) : 'unbekannt (Luftlinie geschätzt)', true);
        setState(DP.zielLat, Math.round(dest.lat * 1e5) / 1e5, true);
        setState(DP.zielLon, Math.round(dest.lon * 1e5) / 1e5, true);
        setState(DP.routeJson, JSON.stringify(r.line), true);
        addRecent(text, dest.label);
        log(`Ladeplanung: Ziel "${text}" -> ${dest.name} – ${km} km einfach, davon ${hwKm} km Autobahn${r.exact ? ', ' + fmtDuration(r.sec) : ' (geschätzt)'}`);
    } catch (e) {
        clearDestination();
        setState(DP.status, `Fehler: ${e.message}`, true);
        log(`Ladeplanung: ${e.message}`, 'warn');
        return;
    }
    trigger(200);
}

// ===================== KERNLOGIK =====================
let sent = null;          // { soc, time } zuletzt an evcc gesendet
let busy = false;
let again = false;
let debounceTimer = null;

function trigger(delay = 1500) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { debounceTimer = null; evaluate(); }, delay);
}

async function evaluate() {
    if (busy) { again = true; return; }
    busy = true;
    try {
        await doEvaluate();
    } catch (e) {
        log(`Ladeplanung: ${e.message}`, 'warn');
        setIfChanged(DP.status, `Fehler: ${e.message.slice(0, 120)}`);
    } finally {
        busy = false;
        if (again) { again = false; trigger(500); }
    }
}

async function doEvaluate() {
    const now = new Date();
    const aktiv = !!val(DP.aktiv, false);
    const rueck = !!val(DP.rueck, true);
    const factor = rueck ? 2 : 1;
    const km = Math.max(0, num(DP.km, 0)) * factor;            // gesamte Strecke für die Berechnung
    const hwKm = Math.min(km, Math.max(0, num(DP.autobahnKm, 0)) * factor);
    const minPct = minSoc();
    const baseCons = consumption();
    const hwCons = baseCons * Math.max(1, CFG.HIGHWAY_FACTOR || 1);
    // Mischverbrauch für diese Fahrt: Autobahn-km mit erhöhtem, Rest mit gelerntem Verbrauch
    const tripKwh = (hwKm * hwCons + (km - hwKm) * baseCons) / 100;
    const cons = km > 0 ? Math.round(tripKwh / km * 1000) / 10 : baseCons;
    const { soc, src } = currentSoc();
    const planTime = nextPlanTime(now);
    const veh = vehicleName();

    // --- Berechnung (immer, damit die Anzeige schon vor dem Einschalten etwas zeigt)
    // Ziel-SoC = Fahrbedarf + Mindest-SoC -> nach der Fahrt bleiben mindestens minPct % im Akku
    const tripSoc = tripKwh / CFG.CAPACITY_KWH * 100;
    const step = CFG.ROUND_STEP > 0 ? CFG.ROUND_STEP : 1;   // auf volle ROUND_STEP-% aufrunden
    const target = Math.min(100, Math.ceil((tripSoc + minPct) / step) * step);
    const needKwh = Math.max(0, (target - soc) / 100 * CFG.CAPACITY_KWH);
    const estH = needKwh / (CFG.CHARGE_KW * CFG.CHARGE_EFF);

    setIfChanged(DP.verbrauch, Math.round(cons * 10) / 10);
    setIfChanged(DP.zielSoc, km > 0 ? target : 0);
    setIfChanged(DP.bedarf, Math.round(needKwh * 10) / 10);
    setIfChanged(DP.planzeit, fmtPlan(planTime));

    // --- Schalter aus -> Plan entfernen
    if (!aktiv) {
        await removePlan(veh);
        setIfChanged(DP.dauer, Math.round(estH * 10) / 10);
        setIfChanged(DP.fenster, '-');
        setIfChanged(DP.status, km > 0
            ? `Aus – Ziel wäre ${target} % (aktuell ${Math.round(soc)} %)`
            : 'Aus');
        return;
    }

    if (km <= 0) {
        await removePlan(veh);
        setIfChanged(DP.status, 'Bitte Zielort eingeben');
        setIfChanged(DP.fenster, '-');
        setIfChanged(DP.dauer, 0);
        return;
    }

    // --- SoC reicht schon
    if (soc >= target) {
        await removePlan(veh);
        setIfChanged(DP.dauer, 0);
        setIfChanged(DP.fenster, '-');
        setIfChanged(DP.status, `Kein Laden nötig – SoC ${Math.round(soc)} % ≥ Ziel ${target} %`);
        return;
    }

    // --- Vor 16 Uhr nur vormerken
    if (!sendAllowed(now)) {
        await removePlan(veh);
        setIfChanged(DP.dauer, Math.round(estH * 10) / 10);
        setIfChanged(DP.fenster, `ca. ${Math.round(estH * 10) / 10} h vor ${hhmm(planTime)}`);
        setIfChanged(DP.status, `Vorgemerkt: ${target} % bis ${fmtPlan(planTime)} – Übergabe an evcc um ${pad(CFG.SEND_FROM_HOUR)}:00`);
        return;
    }

    // --- Ladelimit ggf. anheben
    if (CFG.RAISE_LIMIT) await ensureLimit(veh, target);

    // --- Plan an evcc (nur wenn neu oder geändert)
    const timeStr = rfc3339(planTime);
    if (!veh) throw new Error('Kein Fahrzeug am Ladepunkt erkannt – in der Konfiguration VEHICLE_FALLBACK setzen');
    if (!sent || sent.soc !== target || sent.time !== timeStr || !val(DP.gesendet, false)) {
        await evcc('POST', `/api/vehicles/${vehPath(veh)}/plan/soc/${target}/${timeStr}`);
        sent = { soc: target, time: timeStr, veh };
        setState(DP.gesendet, true, true);
        log(`Ladeplanung: Plan an evcc – ${veh} ${target} % bis ${fmtPlan(planTime)} (SoC ${Math.round(soc)} % via ${src}, ${km} km${rueck ? ' hin & zurück' : ''}, davon ${hwKm} km Autobahn, Ø ${cons} kWh/100km, Mindest-SoC ${minPct} %)`);
    }

    // --- Vorschau aus evcc: Ladefenster/Dauer
    let fensterTxt = '-';
    let dauerH = estH;
    let hinweis = '';
    try {
        const p = await evcc('GET', `/api/loadpoints/${CFG.LOADPOINT}/plan/static/preview/soc/${target}/${timeStr}`);
        if (p && Array.isArray(p.plan) && p.plan.length) {
            const start = new Date(p.plan[0].start);
            const end = new Date(p.plan[p.plan.length - 1].end);
            fensterTxt = `${hhmm(start)}–${hhmm(end)}`;
            if (p.duration) dauerH = p.duration / 3600;
            const nightStart = new Date(planTime);
            nightStart.setHours(CFG.NIGHT_START_HOUR, 0, 0, 0);
            if (start < nightStart) hinweis = ' ⚠ Beginn vor Niedrigtarif';
        }
    } catch (e) {
        log(`Ladeplanung: Vorschau nicht möglich (${e.message})`, 'info');
        fensterTxt = `ca. ${Math.round(estH * 10) / 10} h vor ${hhmm(planTime)}`;
    }

    setIfChanged(DP.dauer, Math.round(dauerH * 10) / 10);
    setIfChanged(DP.fenster, fensterTxt);
    setIfChanged(DP.status, `Plan aktiv: ${target} % bis ${fmtPlan(planTime)}${hinweis}`);
}

async function removePlan(veh) {
    const delVeh = (sent && sent.veh) || veh;
    if (val(DP.gesendet, false) && delVeh) {
        try {
            await evcc('DELETE', `/api/vehicles/${vehPath(delVeh)}/plan/soc`);
            log('Ladeplanung: Plan in evcc gelöscht');
        } catch (e) {
            log(`Ladeplanung: Löschen fehlgeschlagen (${e.message})`, 'warn');
        }
        setState(DP.gesendet, false, true);
    }
    sent = null;
    restoreLimit();
}

async function ensureLimit(veh, target) {
    const eff = effectiveLimit(veh);
    if (target <= eff) return;
    if (num(DP.limitVorher, -1) < 0) setState(DP.limitVorher, num(SRC.lpLimit, 0), true);
    setState(SRC.lpLimit, target, false);
    log(`Ladeplanung: Ladelimit von ${eff} % auf ${target} % angehoben`);
}

function restoreLimit() {
    const prev = num(DP.limitVorher, -1);
    if (prev < 0) return;
    setState(SRC.lpLimit, prev, false);
    setState(DP.limitVorher, -1, true);
    log(`Ladeplanung: Ladelimit zurückgesetzt auf ${prev === 0 ? 'Fahrzeuglimit' : prev + ' %'}`);
}

// ===================== TRIGGER =====================
// Start-/Zielort eingegeben -> erst nach fertiger Eingabe suchen, nicht bei jedem Tastendruck.
// Jede neue Änderung startet die Wartezeit neu; Start und Ziel werden nacheinander gesucht.
let inputTimer = null;
let routingBusy = false;
let routingAgain = false;
const pendingInput = { start: false, ziel: false };

function onInput(kind, value) {
    pendingInput[kind] = true;
    const text = String(value || '').trim();
    // Leer (= Zuhause/Ziel löschen) oder bekannter Eintrag aus Favoriten/letzten Zielen -> sofort
    const known = !text || readList(DP.favJson).concat(readList(DP.lastJson)).some(e => sameValue(e.value, text));
    if (inputTimer) clearTimeout(inputTimer);
    inputTimer = setTimeout(() => { inputTimer = null; runRouting(); }, known ? 300 : CFG.INPUT_DELAY_MS);
}

async function runRouting() {
    if (routingBusy) { routingAgain = true; return; }
    routingBusy = true;
    const doStart = pendingInput.start, doZiel = pendingInput.ziel;
    pendingInput.start = pendingInput.ziel = false;
    try {
        if (doStart) await resolveStart();            // rechnet bei vorhandenem Ziel auch die Route neu
        else if (doZiel) await resolveDestination();
    } catch (e) {
        log(`Ladeplanung: ${e.message}`, 'warn');
    } finally {
        routingBusy = false;
        if (routingAgain || pendingInput.start || pendingInput.ziel) { routingAgain = false; runRouting(); }
    }
}

on({ id: DP.zielort, change: 'any', ack: false }, obj => onInput('ziel', obj.state.val));
on({ id: DP.startort, change: 'any', ack: false }, obj => onInput('start', obj.state.val));

// Favorit merken / löschen (Taste in der Visualisierung schreibt "merken" bzw. "loeschen")
on({ id: DP.favAktion, change: 'any', ack: false }, obj => {
    const a = String(obj.state.val || '').toLowerCase();
    setState(DP.favAktion, '', true);
    favoriteAction(a === 'löschen' ? 'loeschen' : a);
});

on({ id: [DP.aktiv, DP.rueck, DP.minSoc], change: 'any' }, obj => {
    if (obj.state.ack && obj.id !== DP.aktiv) return; // eigene Schreibvorgänge ignorieren
    trigger(obj.id === DP.aktiv ? 200 : 1500);
});

// SoC / Verbrauch / Fahrzeug ändern sich -> neu rechnen (Plan wird nur bei Änderung neu gesendet)
on({ id: [SRC.evccSoc, SRC.socFallback, SRC.evccConnected, SRC.evccVehicle, ...SRC.consumption].filter(Boolean), change: 'ne' }, () => trigger(5000));

// 16:00 – vorgemerkten Plan an evcc übergeben
schedule(`1 ${CFG.SEND_FROM_HOUR} * * *`, () => trigger(100));

// 06:05 – Plan abgelaufen -> Schalter zurücksetzen
schedule(`5 ${CFG.PLAN_END_HOUR} * * *`, () => {
    if (!val(DP.aktiv, false)) return;
    const { soc } = currentSoc();
    setState(DP.aktiv, false, true);
    trigger(100);
    setTimeout(() => setState(DP.status, `Plan beendet – SoC ${Math.round(soc)} %`, true), 3000);
    log(`Ladeplanung: Plan abgelaufen, SoC ${Math.round(soc)} %`);
});

// ===================== START =====================
async function init() {
    // Datenpunkte anlegen (nur wenn sie noch fehlen)
    const hwNeu = !existsObject(DP.autobahnKm);   // Update von < 1.9: Route einmal neu berechnen
    for (const [id, def, common] of DP_DEFS) {
        if (!existsObject(id)) await createStateAsync(id, def, Object.assign({ read: true }, common));
    }
    // Heimatkoordinaten für die Karte bereitstellen
    try {
        const h = homeCoords();
        setState(DP.homeLat, h.lat, true);
        setState(DP.homeLon, h.lon, true);
    } catch (e) {
        log(`Ladeplanung: ${e.message} – bitte in den ioBroker-Systemeinstellungen den Standort setzen`, 'warn');
    }
    writeStartSelection();
    if (!String(CFG.CONTACT || '').trim()) {
        log('Ladeplanung: Tipp – in CFG.CONTACT eine E-Mail-Adresse eintragen (Kontakt für Nominatim/OSRM)', 'info');
    }
    // Startort auflösen (leer = Zuhause), falls noch keine Koordinaten vorhanden
    if (!num(DP.startLat, 0)) {
        await resolveStart();          // berechnet bei vorhandenem Ziel auch die Route
    } else if (String(val(DP.zielort, '') || '').trim() && (hwNeu || num(DP.km, 0) <= 0 || !num(DP.zielLat, 0))) {
        // Zielort vorhanden, aber noch keine Strecke / kein Autobahn-Anteil -> Route jetzt berechnen
        await resolveDestination();
    }
    trigger(2000);
    log(`Ladeplanung: Skript gestartet (Mindest-SoC ${minSoc()} %)`);
}
init().catch(e => log(`Ladeplanung: Start fehlgeschlagen – ${e.message}`, 'error'));