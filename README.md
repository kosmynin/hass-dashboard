# Smartphone Dashboard

Ein gemeinsames HACS-Custom-Integration-Paket für das deutsche Smartphone-Dashboard: Backend, Config Flow und Dashboard-Strategy werden zusammen installiert und aktualisiert.

## Installation

1. `https://github.com/kosmynin/hass-dashboard` in HACS als benutzerdefiniertes
   Repository vom Typ **Integration** hinzufügen und installieren.
2. Home Assistant neu starten.
3. Unter **Einstellungen → Geräte & Dienste → Integration hinzufügen** „Smartphone Dashboard“ wählen.
4. Unter **Einstellungen → Dashboards → Ressourcen** alle manuellen Einträge für
   `smartphone-dashboard-loader.js` entfernen. Die Integration registriert den
   versionsabhängigen Modulpfad automatisch.
5. Home Assistant neu starten, Browserdaten aktualisieren und das primäre
   Dashboard mit `strategy: {type: custom:smartphone-dashboard, backend_key: default}`
   anlegen. Dieses Dashboard ist für die globalen Benachrichtigungen maßgeblich.

Das Frontend wird über einen versionsabhängigen statischen HTTP-Pfad ausgeliefert
und von der Integration automatisch injiziert. Der Versionsanteil liegt im Pfad
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
Sekunden auf eine Strategy. Trifft dieser bekannte Frontend-Fehler trotz des
kleinen Sofort-Loaders ein, erkennt der Loader die zugehörige Fehlerkarte und lädt
die Dashboard-Seite genau einmal neu. Eine Session-Sperre verhindert
Reload-Schleifen.

Der berechtigungsgefilterte Backend-Lesezugriff für die erste Strategy-Erzeugung
hat ein Zeitlimit von 1,5 Sekunden. Bei Timeout werden ausschließlich explizite
Lovelace-Werte oder der letzte erfolgreich bereinigte Browserwert verwendet.

Aktive Meldungen öffnen kategoriebasierte Detail-Popups. NINA zeigt dort die
vollständige Beschreibung und Handlungsempfehlung; für Abfall werden passende
`calendar.*`-Entitäten automatisch erkannt und als Kalender eingebunden.

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
