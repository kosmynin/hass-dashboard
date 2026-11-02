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
vollständige Beschreibung und Handlungsempfehlung. Für jede automatisch
erkannte Abfallart lässt sich getrennt eine wöchentliche, zweiwöchentliche oder
vierwöchentliche Leerung auswählen. Die Einstellungsseite ergänzt die aktuell
sichtbaren Sensordaten um alle Abfallarten, die in den kommenden zwölf Monaten
im Abfallkalender vorkommen. Dadurch sind auch Papier, Biomüll und weitere, erst
später anstehende Leerungen sofort konfigurierbar. Abfallmeldungen zeigen einen bereinigten,
eindeutigen Namen und den nächsten passenden Termin. Satzförmige Zustände wie
„Restmüll wird abgeholt.“ werden dabei mit „Restmüll“ zusammengeführt. Meldungen
erscheinen nur innerhalb des konfigurierbaren
Vorlaufs und binden passende `calendar.*`-Entitäten darunter als kompakten
Bubble-Card-Kalender mit bis zu sechs Terminen der kommenden 45 Tage ein.
Batteriemeldungen bleiben neutral; ausschließlich ihr Symbol wird unterhalb des
Grenzwerts orange und bei höchstens dessen Hälfte rot dargestellt.
Batteriespannungen in Volt oder Millivolt werden grundsätzlich nicht als
niedriger Batteriestand in den Meldungen geführt.
Dashboard, Persistent Notification und optionale Push-Mitteilungen verwenden
dieselben Aktivierungs-, Grenzwert- und Sichtbarkeitsregeln. Ausgeblendete
Entitäten werden ignoriert; nur Batteriesensoren bleiben absichtlich sichtbar,
solange sie nicht in den Batterie-Ausnahmen stehen.

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
Sammelmeldung. Für `notify.mobile_app_*` pflegt die Integration ausschließlich
eine Live Activity mit
eigener Kennung. Sie zeigt auf iPhone-Sperrbildschirm und Dynamic Island die
beiden wichtigsten Meldungen sowie die Gesamtzahl, öffnet beim Antippen den
gemeinsamen Meldungsdialog im Handy-Dashboard und wird bei Entwarnung beendet.
Eine zuvor von älteren Versionen erzeugte normale Sammelmitteilung wird beim
nächsten Lauf entfernt. Wegen der iOS-Laufzeitgrenze
wird eine weiterhin benötigte Live Activity nach sieben Stunden kontrolliert
erneuert. Voraussetzung sind iOS 17.2 oder neuer, Home Assistant 2026.7 oder
neuer und aktivierte Live Activities in der Companion App.

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
