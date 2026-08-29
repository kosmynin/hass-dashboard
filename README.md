# Smartphone Dashboard

Ein gemeinsames HACS-Custom-Integration-Paket für das deutsche Smartphone-Dashboard: Backend, Config Flow und Dashboard-Strategy werden zusammen installiert und aktualisiert.

## Installation

1. `https://github.com/kosmynin/hass-dashboard` in HACS als benutzerdefiniertes
   Repository vom Typ **Integration** hinzufügen und installieren.
2. Home Assistant neu starten.
3. Unter **Einstellungen → Geräte & Dienste → Integration hinzufügen** „Smartphone Dashboard“ wählen.
4. Unter **Einstellungen → Dashboards → Ressourcen** verbindlich das Modul
   `/smartphone-dashboard/smartphone-dashboard-loader.js?v=22.0.1` eintragen.
5. Eine alte `/local/smartphone-dashboard-loader.js`-Resource entfernen, damit
   nicht zwei Versionen konkurrieren.
6. Home Assistant neu starten, Browserdaten aktualisieren und das primäre
   Dashboard mit `strategy: {type: custom:smartphone-dashboard, backend_key: default}`
   anlegen. Dieses Dashboard ist für die globalen Benachrichtigungen maßgeblich.

Das Frontend wird über einen offiziellen statischen HTTP-Pfad ausgeliefert. Die
Integration injiziert den Loader zusätzlich als Komfortfunktion; wegen des
bekannten Cold-load-Rennens bei Custom-Strategies ist die Resource-Eintragung
oben trotzdem verbindlich. Bei YAML-Lovelace dieselbe URL unter
`lovelace.resources` eintragen.

Der berechtigungsgefilterte Backend-Lesezugriff für die erste Strategy-Erzeugung
hat ein Zeitlimit von 1,5 Sekunden. Bei Timeout werden ausschließlich explizite
Lovelace-Werte oder der letzte erfolgreich bereinigte Browserwert verwendet.

## Migration und Benachrichtigungen

Vorhandene 17 Helfer werden idempotent gelesen und niemals gelöscht. Das Backend
wertet Meldungen selbst aus, dedupliziert Fingerprints und versendet seriell an
die konfigurierten Notify-Dienste. Die alte Paketautomation muss deaktiviert
werden, um Doppelversand zu vermeiden; die mitgelieferte YAML dient nur noch der
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
