# Smartphone Dashboard

Ein gemeinsames HACS-Custom-Integration-Paket für das deutsche Smartphone-Dashboard: Backend, Config Flow und Dashboard-Strategy werden zusammen installiert und aktualisiert.

## Installation

1. `https://github.com/kosmynin/hass-dashboard` in HACS als benutzerdefiniertes
   Repository vom Typ **Integration** hinzufügen und installieren.
2. Home Assistant neu starten.
3. Unter **Einstellungen → Geräte & Dienste → Integration hinzufügen** „Smartphone Dashboard“ wählen.
4. Unter **Einstellungen → Dashboards → Ressourcen** alle manuellen Einträge für
   `smartphone-dashboard-loader.js` entfernen. Die Integration registriert den
   versionsabhängigen Modulpfad im Storage-Modus automatisch als Lovelace-
   Ressource und aktualisiert ihn bei neuen Versionen.
5. Home Assistant neu starten, Browserdaten aktualisieren und das primäre
   Dashboard mit `strategy: {type: custom:smartphone-dashboard, backend_key: default}`
   anlegen. Dieses Dashboard ist für die globalen Benachrichtigungen maßgeblich.

Das Frontend wird über einen versionsabhängigen statischen HTTP-Pfad ausgeliefert
und von der Integration automatisch registriert. Der Versionsanteil liegt im Pfad
statt nur im Query-Parameter, damit Proxy-, Service-Worker- und Browser-Caches
bei einem Update garantiert eine neue URL sehen. Alte manuelle Lovelace-
Ressourcen müssen entfernt werden, damit sie nicht vor der Integration laden.

HACS installiert veröffentlichte Versionen aus dem Release-Asset
`smartphone_dashboard.zip`. Das ZIP enthält direkt den Inhalt der Integration;
der bewegliche `main`-Branch wird in der Versionsauswahl bewusst ausgeblendet.

Entitäten, deren Home-Assistant-Schalter **Sichtbar** deaktiviert ist, werden in
keinem automatisch erzeugten Bereich, Pop-up, Schnellzugriff oder Meldefilter
angezeigt. Änderungen dieser Einstellung werden ohne Dashboard-Neukonfiguration
übernommen.

Der Loader registriert die Strategy sofort und lädt den Dashboard-Code parallel.
Wird Home Assistants Custom-Element-Registry beim Start ausgetauscht, trägt der
Loader Strategy und zugehörige Komponenten in der aktiven Registry ein. Die
Integration hält genau eine eigene Lovelace-Ressource auf dem aktuellen Pfad.

Der berechtigungsgefilterte Backend-Lesezugriff hat ein Zeitlimit von 1,5 Sekunden,
mit vorhandener Browserkopie 300 Millisekunden. Bei Timeout verwendet die
Strategy die Browserkopie und explizite Lovelace-Werte.

Aktive Meldungen öffnen kategoriebasierte Detail-Popups. NINA zeigt dort die
vollständige Beschreibung und Handlungsempfehlung. Abfallmeldungen zeigen einen bereinigten,
eindeutigen Namen und den nächsten passenden Termin. Satzförmige Zustände wie
„Restmüll wird abgeholt.“ werden dabei mit „Restmüll“ zusammengeführt. Meldungen
erscheinen nur innerhalb des konfigurierbaren
Vorlaufs. Im Abfall-Pop-up stehen darunter bis zu sechs Abholtermine der
kommenden 45 Tage. Liefert der Kalender keine Termine, werden die datierten
Abholungen des Abfallsensors verwendet.
Abholrhythmen werden ausschließlich in Waste Collection Schedule konfiguriert;
das Dashboard filtert sie nicht erneut. Der Kalender wird bevorzugt über die
Integration des ausgewählten Abfallsensors zugeordnet, sodass auch neutral
benannte Kalender zuverlässig im Pop-up erscheinen.
Mehrzeilige Sensorzustände wie „Restmüll und Biomüll werden morgen abgeholt“
werden sowohl auf der Dashboard-Karte als auch in Persistent Notification und
Live Activity als gemeinsame Abholung dargestellt.
Sensoren der [Home Assistant Parcel Integrations](https://ha-parcel-integrations.github.io/)
werden automatisch erkannt. Carrier-Sensoren und Parcel Aggregator können
gemeinsam verwendet werden. Unter **Meldungen** und in der Live Activity steht
höchstens die nächste relevante Sendung. Abholbereite, in Zustellung befindliche
und problematische Sendungen haben Vorrang. Danach entscheidet der früheste
Liefertermin. Das **Paket-Pop-up** zeigt alle aktiven Sendungen mit Inhalt oder
Absender, Zusteller, Status, Lieferfenster und Tracking-Link. Mehrfach erfasste
Trackingnummern werden zusammengeführt. Der
Fortschrittsbalken sitzt im Paket-Pop-up und in der Live Activity. Die
Liefertermine aus dem Paketkalender zeigen den verfügbaren Inhalt, sonst
Absender oder Zusteller. Lieferfenster aus Paket-Sensoren ergänzen den Kalender.
Zugestellte Sendungen verschwinden automatisch.
Auf dem Sperrbildschirm ist Platz für bis zu drei Meldungs-Aktivitäten. NINA
und USV werden zuerst berücksichtigt. Sind mehr Meldungen aktiv, führt die
letzte Aktivität als Sammelhinweis zum gemeinsamen Meldungsdialog.
Batteriemeldungen bleiben neutral; ausschließlich ihr Symbol wird unterhalb des
Grenzwerts orange und bei höchstens dessen Hälfte rot dargestellt.
Batteriespannungen in Volt oder Millivolt werden grundsätzlich nicht als
niedriger Batteriestand in den Meldungen geführt.
Dashboard, Persistent Notification und optionale Push-Mitteilungen verwenden
dieselben Aktivierungs-, Grenzwert- und Sichtbarkeitsregeln. Ausgeblendete
Entitäten werden ignoriert; nur Batteriesensoren und technische Statushelfer
laufender Haushaltsgeräte bleiben absichtlich auswertbar. Batteriesensoren
lassen sich weiterhin über die Batterie-Ausnahmen ausschließen.

Im Sicherheits-Pop-up stehen Alarm-Panels vor Kameras und Schlössern. Die
Master-Alarmanlage wird anhand ihres Namens erkannt oder in den Einstellungen
explizit gewählt; ihr Zustand und ihre Detailsteuerung sind direkt über den
Kopfbereich erreichbar. Ausgeblendete Kameras und Kameras erkannter
3D-Drucker werden dort nicht angezeigt.

Entitätsbezogene Meldungen verwenden, soweit Home Assistant eine Zuordnung
kennt, das kompakte Format **Bereich · Entität: Wert**. Der Gerätename wird
dabei nicht zusätzlich wiederholt; ohne Bereich bleibt der Entitätsname als
Fallback erhalten.
Mehrere gleichzeitig von `sensor.ups_status` gelieferte APC-Statusflags werden
als getrennte Meldungen ausgewertet: `ONLINE` bleibt neutral, während etwa
`REPLACEBATT`, `NOBATT`, `ONBATT` oder `LOWBATT` jeweils eine eigene deutsche
USV-Meldung erzeugen.

## Reolink-Türklingel

1. Im primären Dashboard unter **Benachrichtigungen & Synchronisierung** die
   **Reolink-Türklingel** einschalten. Unter **Handys für die Türklingel** die
   gewünschten Companion-Handys auswählen. Bei leerer Auswahl gelten die
   allgemeinen mobilen Push-Empfänger.
2. Auf jedem Handy Mitteilungen mit Ton für Home Assistant erlauben. Am iPhone
   zusätzlich **Zeitkritische Mitteilungen** erlauben, wenn die Klingel während
   eines Fokus durchkommen soll. Ein Tastendruck löst pro Handy eine Mitteilung
   aus. Tippen öffnet das Livebild der zugehörigen Kamera. Die Klingeltaste erkennt das
   Dashboard am **Besucher**-Sensor der Reolink-Integration, auch nach einer
   Umbenennung. [Reolink-Sensoren in Home Assistant](https://www.home-assistant.io/integrations/reolink/#binary-sensors)
3. Für Gegensprechen in Home Assistant ab **2026.11** unter **Einstellungen →
   System → Labs** die Zwei-Wege-Audio-Vorschau aktivieren und in den Optionen
   der Reolink-Integration **RTSP** wählen. Im Livebild **Sprechen starten**
   antippen und den Mikrofonzugriff erlauben. Das Modell muss Gegensprechen
   unterstützen und der Stream über WebRTC laufen. Im Browser HTTPS verwenden.
   Die iOS-Companion-App ab 2026.10.3 unterstützt auch lokales HTTP.
   [Reolink-Einstellungen](https://www.home-assistant.io/integrations/reolink/#two-way-audio) · [Kamera und Mikrofon](https://www.home-assistant.io/integrations/camera/#talking-through-a-camera)

Für einen Anruf mit **Annehmen** auf dem iPhone-Sperrbildschirm auf jedem
iPhone in der **Reolink-App → Türklingel → Einstellungen → Push-Mitteilungen**
die Option **Incoming call from Doorbell** aktivieren. Wer diesen Anruf nutzt,
kann den Dashboard-Klingelton ausgeschaltet lassen. Die Reolink-App ermöglicht
das Gegensprechen auch bei der **Video Doorbell (Battery)**, für die Home
Assistant diese Funktion als nicht verfügbar aufführt.
[Türklingelanruf einrichten](https://support.reolink.com/articles/30334226363161-How-to-Call-Reolink-Doorbell/) · [Modellunterstützung](https://works-with.home-assistant.io/certified-products/)

## Energie

**Weitere Bereiche → Energie** übernimmt die Quellen aus
den Home-Assistant-Energie-Einstellungen. **Jetzt** zeigt von oben nach unten
die Home Flow Card, den nativen **Aktuellen Leistungsfluss** und die einzelnen
**PV-Eingänge**. Die Tageswerte für PV-Eingänge kommen aus den Recorder-Statistiken.

Für die Hausgrafik installiere die
[Home Flow Card](https://cards.flixlix.com/home-flow-card/installation) über den
Home-Assistant-Marketplace (ab 2026.11) oder HACS.
Die Strategy erkennt die Karte automatisch und verwendet sie unter **Jetzt**.
Bei mehreren PV-Eingängen desselben Geräts kann ein erkannter PV-Gesamtsensor
den Wert für die Hausgrafik liefern. Unter **Weitere Bereiche → Energie** lässt sich
der Leistungssensor für **PV-Gesamtleistung für die Hausgrafik** auch auswählen.
Die Auswahl ändert keine Quellen im Home-Assistant-Energie-Dashboard.
Ein bewusst ausgewählter Sensor kann als Messquelle für die Hausgrafik dienen,
auch wenn seine Entität in Home Assistant ausgeblendet ist.
Fehlende oder getrennte Messquellen lassen die übrigen Quellen der Hausgrafik
sichtbar. Der native Leistungsfluss zeigt die im Energie-Dashboard erfassten
Quellen zusätzlich.
Unter **Weitere Bereiche → Energie** lässt sich die **Akku-Richtung in der
Hausgrafik umkehren**, falls der Leistungssensor Laden und Entladen mit
umgekehrtem Vorzeichen meldet.

**Heute** zeigt die native Energieverteilung einschließlich konfigurierter
Wasser- und Gaszähler. Darunter zeigt der **Energiefluss heute** die Wege der
Energie in kWh. Anschließend folgen die PV-Erträge je Eingang.

Vorhandene Einzelsensoren der
EcoFlow STREAM Ultra erscheinen auch dann als PV-Eingänge, wenn sie in Home
Assistant ausgeblendet sind. Über **Zusätzliche PV-Module (Leistung)** kannst
du weitere Sensoren ergänzen. Aktiviere die
[Ertragszähler je PV-Eingang](https://github.com/shuette42/ecoflow-energy-ha/blob/main/documentation/entities/stream.md#sensors---energy-dashboard)
in Home Assistant, wenn deine EcoFlow-Integration sie bereitstellt. Jeder
Eingang zeigt den gemessenen Ertrag der dort angeschlossenen Module.

Über **Energie-Dashboard öffnen** gelangst du zur vollständigen Auswertung.
In den Strategy-Einstellungen lässt sich der Bereich ausblenden.

## Migration und Benachrichtigungen

Vorhandene 17 Helfer werden idempotent gelesen und niemals gelöscht. Das Backend
wertet Meldungen selbst aus und pflegt unter einer festen Kennung genau eine
zusammengefasste Persistent Notification, solange Meldungen aktiv sind. Sie wird
bei Änderungen aktualisiert und nach vollständiger Entwarnung entfernt.

Optionale nicht mobile Notify-Dienste erhalten ebenfalls nur eine
Sammelmeldung. Für `notify.mobile_app_*` pflegt die Integration bis zu drei
getrennte Warnungs-Live-Activities mit kategoriespezifischen Icons und Farben.
Messwertänderungen wie ein neuer CO₂-Wert aktualisieren dabei dieselbe Live
Activity still und gebündelt; die stabile Meldungsidentität verhindert unnötige
Neustarts. Auch der erstmalige Start normaler Warnungs-, Medien-, Paket- und
Geräteaktivitäten setzt explizit keinen Systemton. Nur eine neu auftretende
NINA- oder USV-Lage darf einmal hörbar und zeitkritisch auf sich aufmerksam
machen; weitere Meldungen derselben Auswertung bleiben leise. Der Kopf benennt
die Kategorie kompakt, etwa
**CO₂**, **Abfall** oder **Paket**. Paket-Aktivitäten wechseln Symbol und Akzentfarbe
passend zu Unterwegs, In Zustellung, Abholbereit, Rücksendung oder Problem.
Zusätzlich zeigen sie den vierstufigen Versandfortschritt als echten
systemgerenderten Fortschrittsbalken. Derselbe Status erscheint im
Paket-Pop-up als Fortschrittsbalken unterhalb des Status.
Sie öffnen beim Antippen direkt das passende Detail-Pop-up für Batterien,
Kontakte, CO₂, Abfall, Pakete, USV, Frost oder NINA; zusammengefasste Restmeldungen
öffnen den gemeinsamen Meldungsdialog. Der `sd_popup`-Fallback stellt den
Absprung auch dann wieder her, wenn die Companion-App das URL-Fragment beim
Kaltstart entfernt. Bei Entwarnung werden die Live Activities beendet.
Eine zuvor von älteren Versionen erzeugte normale Sammelmitteilung wird beim
nächsten Lauf entfernt. Wegen der iOS-Laufzeitgrenze
wird eine weiterhin benötigte Live Activity nach sieben Stunden kontrolliert
erneuert. Voraussetzung sind iOS 17.2 oder neuer, Home Assistant 2026.7 oder
neuer und aktivierte Live Activities in der Companion App.

Unter **Entwicklerwerkzeuge → Aktionen** sendet
`smartphone_dashboard.send_test_designs` wahlweise alle Meldungsdesigns, nur
die Paketstufen, das Mediendesign oder vier Haushaltsgerätedesigns als echte Live Activities. Ohne
expliziten Empfänger werden die Dashboard-Empfänger verwendet.
`smartphone_dashboard.clear_test_designs` beendet anschließend alle so
erzeugten Test-Aktivitäten wieder. Die Gruppe **Alle Designs** sollte wegen des
iOS-Push-to-start-Budgets nur gezielt zur visuellen Prüfung verwendet werden.
Die Vorschau ist vollständig lautlos und pro Empfänger auf einen Start alle zwei
Minuten begrenzt.

Zusätzlich können aktive Media Player eigene stille Live Activities erhalten.
Sie zeigen den **Playernamen** als Titel sowie Medientitel, Interpret
und Album als Inhalt mit einem passenden Medien-Icon,
aktualisieren Titelwechsel ohne zusätzliche Push-Mitteilung und verschwinden
beim Pausieren oder Stoppen. Verwendet werden die sichtbaren bzw. im Bereich
„Medien“ ausgewählten Entitäten; gruppierte Player werden zusammengefasst und
der erste aktive Player als eine Fernbedienung angezeigt. Die Funktion lässt sich unter
**Meldungen → Aktive Medien** deaktivieren. Ein Antippen öffnet das Medien-Pop-up
und stellt den zugehörigen Player als Bubble-Card-Fernbedienung an die erste
Position. Dort stehen die vom Player unterstützten Funktionen wie Wiedergabe,
Titelsprung und Lautstärke bereit. Direkte Aktionsschaltflächen innerhalb einer
generischen Home-Assistant-Live-Activity werden von der Companion-Payload nicht
angeboten. Der Absprung enthält zusätzlich zum Fragment einen stabilen
`sd_popup`-Parameter; dadurch öffnet der Loader das Medien-Pop-up auch dann,
wenn die Companion-App beim Kaltstart den Fragmentteil der URL verwirft.

Laufende Programme von **Spülmaschine, Waschmaschine, Trockner und Backofen**
werden automatisch über ihre Geräte- und Entitätszuordnung erkannt. Ihre stillen
Live Activities zeigen Programm, Restzeit und einen Fortschrittsbalken. Fehlt
ein direkter Prozentwert, wird der Fortschritt aus Laufzeit, Programmdauer oder
der während des aktuellen Programms beobachteten Restzeit abgeleitet. Versteckte technische Statushelfer
dürfen dafür ausgewertet werden, deaktivierte Entitäten nicht. Fortschrittswerte
werden in Zehnerschritten gebündelt, damit minütliche Sensorupdates das
iPhone-Push-Limit nicht erneut ausschöpfen. Gleichzeitig werden höchstens zwei
laufende Geräte auf dem Sperrbildschirm gezeigt. Bei „Fertig“, „Bereit“ oder „Aus“
endet die Activity automatisch. Die Funktion lässt sich unter
**Meldungen → Laufende Haushaltsgeräte** deaktivieren; ein Antippen öffnet den
zugehörigen Raumbereich.

Wer einen Meldungsdialog über die Live Activity öffnet, kann die Aktivitäten
dieses Geräts **30 Minuten pausieren** oder **Bis zur Änderung pausieren**.
Die zweite Aktion gilt für die aktuelle Kombination von Meldungen. Dashboard,
Persistent Notification und Live Activities verwenden dieselbe
Backend-Auswertung. Die Dashboard-Verbindung erhält nur Meldungen aus
Entitäten, für die der angemeldete Benutzer Leserechte besitzt.

Die alte Paketautomation muss deaktiviert werden, um
Doppelversand zu vermeiden; die mitgelieferte YAML dient nur noch der
Legacy-Migration und ist keine Laufzeitvoraussetzung.
Die Datei `smartphone_dashboard_legacy_reference.yaml` ist ausdrücklich eine
inaktive Referenz und darf nicht als aktive Automation eingebunden werden.

Die vorhandene Lovelace-Konfiguration bleibt beim ersten Laden maßgeblich und
wird niemals still durch Backend-Daten überschrieben. Das Backend speichert
Änderungen je Dashboard-Schlüssel revisioniert; Konflikte und Fehler bleiben im
Editor sichtbar. Als Schlüssel dient `backend_key` in der Strategy-Konfiguration
oder ersatzweise der stabile Dashboard-Pfad.

Das Dashboard mit den globalen Benachrichtigungseinstellungen verwendet
`backend_key: default`; dort wird auch der einmalige, nicht destruktive Import
der 17 bisherigen Helfer abgelegt.

Siehe [INSTALLATION.md](INSTALLATION.md) und [Versionshinweise und Audit](CHANGELOG.md).

> Das öffentliche Quell- und HACS-Repository liegt unter
> `https://github.com/kosmynin/hass-dashboard`.
