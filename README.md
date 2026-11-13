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

Home Assistant lädt Custom-Ressourcen derzeit parallel und wartet nur fünf
Sekunden auf eine Strategy. Der kleine Sofort-Loader registriert sich vor dem
eigentlichen Dashboard-Code und erneut, falls Home Assistants Registry-Polyfill
eine sehr frühe Registrierung ersetzt. Trifft der bekannte Frontend-Timeout
trotzdem ein, sind höchstens zwei automatische Wiederholungen erlaubt; eine
Reload-Schleife ist ausgeschlossen.

Der berechtigungsgefilterte Backend-Lesezugriff für die erste Strategy-Erzeugung
hat ein Zeitlimit von 1,5 Sekunden. Bei Timeout werden ausschließlich explizite
Lovelace-Werte oder der letzte erfolgreich bereinigte Browserwert verwendet.

Aktive Meldungen öffnen kategoriebasierte Detail-Popups. NINA zeigt dort die
vollständige Beschreibung und Handlungsempfehlung. Abfallmeldungen zeigen einen bereinigten,
eindeutigen Namen und den nächsten passenden Termin. Satzförmige Zustände wie
„Restmüll wird abgeholt.“ werden dabei mit „Restmüll“ zusammengeführt. Meldungen
erscheinen nur innerhalb des konfigurierbaren
Vorlaufs und binden passende `calendar.*`-Entitäten darunter als kompakten
Bubble-Card-Kalender mit bis zu sechs Terminen der kommenden 45 Tage ein.
Abholrhythmen werden ausschließlich in Waste Collection Schedule konfiguriert;
das Dashboard filtert sie nicht erneut. Der Kalender wird bevorzugt über die
Integration des ausgewählten Abfallsensors zugeordnet, sodass auch neutral
benannte Kalender zuverlässig im Pop-up erscheinen.
Mehrzeilige Sensorzustände wie „Restmüll und Biomüll werden morgen abgeholt“
werden sowohl auf der Dashboard-Karte als auch in Persistent Notification und
Live Activity als gemeinsame Abholung dargestellt.
Sensoren der [Home Assistant Parcel Integrations](https://ha-parcel-integrations.github.io/)
werden automatisch erkannt. Wenn der Parcel Aggregator installiert ist, nutzt
das Dashboard bevorzugt `sensor.parcel_aggregator_incoming_parcels`; andernfalls
werden die Carrier-Sensoren mit demselben `parcels`-Vertrag verwendet. Der
Bereich **Pakete** zeigt aktive Sendungen mit Absender, Zusteller, deutschem
Status, Lieferfenster und Tracking-Link. Ein vorhandener
`calendar.parcel_aggregator_deliveries` wird als Bubble-Card-Kalender ergänzt.
Zugestellte Sendungen verschwinden automatisch.
Bis zu vier unabhängige Meldungen erscheinen als getrennte, einzeln lesbare
Live Activities; weitere Meldungen werden kompakt gezählt und bleiben im
gemeinsamen Meldungsdialog vollständig sichtbar.
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

## Migration und Benachrichtigungen

Vorhandene 17 Helfer werden idempotent gelesen und niemals gelöscht. Das Backend
wertet Meldungen selbst aus und pflegt unter einer festen Kennung genau eine
zusammengefasste Persistent Notification, solange Meldungen aktiv sind. Sie wird
bei Änderungen aktualisiert und nach vollständiger Entwarnung entfernt.

Optionale nicht mobile Notify-Dienste erhalten ebenfalls nur eine
Sammelmeldung. Für `notify.mobile_app_*` pflegt die Integration bis zu vier
getrennte Warnungs-Live-Activities mit kategoriespezifischen Icons und Farben.
Messwertänderungen wie ein neuer CO₂-Wert aktualisieren dabei dieselbe Live
Activity still und sofort; die stabile Meldungsidentität verhindert unnötige
Neustarts. Der Kopf benennt die Kategorie kompakt, etwa
**Homeassistant – CO₂**, **Homeassistant – Abfall** oder
**Homeassistant – Paket**. Paket-Aktivitäten wechseln Symbol und Akzentfarbe
passend zu Unterwegs, In Zustellung, Abholbereit, Rücksendung oder Problem.
Zusätzlich zeigen sie den vierstufigen Versandfortschritt als echten
systemgerenderten Fortschrittsbalken. Derselbe Status erscheint im
Paket-Pop-up als farbiger Bubble-Card-Balken.
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

Zusätzlich können aktive Media Player eigene stille Live Activities erhalten.
Sie zeigen **Homeassistant – Playername** als Titel sowie Medientitel, Interpret
und Album als Inhalt mit einem passenden Medien-Icon,
aktualisieren Titelwechsel ohne zusätzliche Push-Mitteilung und verschwinden
beim Pausieren oder Stoppen. Verwendet werden die sichtbaren bzw. im Bereich
„Medien“ ausgewählten Entitäten; gruppierte Player werden zusammengefasst und
maximal drei gleichzeitig angezeigt. Die Funktion lässt sich unter
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
Live Activities zeigen Programm, Restzeit und – sofern die Integration ihn
bereitstellt – einen Fortschrittsbalken. Versteckte technische Statushelfer
dürfen dafür ausgewertet werden, deaktivierte Entitäten nicht. Fortschrittswerte
werden in Zehnerschritten gebündelt, damit minütliche Sensorupdates das
iPhone-Push-Limit nicht erneut ausschöpfen. Bei „Fertig“, „Bereit“ oder „Aus“
endet die Activity automatisch. Die Funktion lässt sich unter
**Meldungen → Laufende Haushaltsgeräte** deaktivieren; ein Antippen öffnet den
zugehörigen Raumbereich.

Der Meldungsdialog bietet die Aktionen **30 Min. stumm** und **Bis Änderung
stumm**. Die erste blendet die Live Activity dieses Smartphones für 30 Minuten
aus und stellt den dann aktuellen Stand anschließend erneut dar, die zweite
unterdrückt ausschließlich den aktuellen Meldungssatz. Neue oder geänderte
Meldungen durchbrechen diese letzte Stummschaltung. Dashboard, Persistent
Notification und Live Activity verwenden dieselbe vom Backend ausgewertete
Meldungsliste.

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

Siehe [INSTALLATION.md](INSTALLATION.md).

> Das öffentliche Quell- und HACS-Repository liegt unter
> `https://github.com/kosmynin/hass-dashboard`.
