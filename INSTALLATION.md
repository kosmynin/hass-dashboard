# Installation und Diagnose

## Repository-Voraussetzung

HACS-Repository:
`https://github.com/kosmynin/hass-dashboard`

Dieses öffentliche Repository in HACS als benutzerdefiniertes Repository vom
Typ **Integration** eintragen. Quellcode, Releases und Fehlerberichte werden
vollständig über GitHub verwaltet. Der Codeowner ist `@kosmynin`.

HACS installiert ausschließlich `custom_components/smartphone_dashboard`, daher liegen alle Laufzeitdateien einschließlich Frontend innerhalb dieses Ordners. Nach Updates Home Assistant neu starten und den Browser hart neu laden.

Der statische Pfad nutzt `hass.http.async_register_static_paths`. Die Integration
injiziert automatisch einen versionsabhängigen Pfad nach dem Muster
`/smartphone-dashboard/v22.0.13/smartphone-dashboard-loader.js`. Entferne alle
manuellen `/smartphone-dashboard/...`- und `/local/...`-Ressourcen, damit keine
alte Datei zuerst das Custom Element registriert.

Bei einem kalten Browserstart kann Home Assistants festes Fünf-Sekunden-Limit
für Custom-Strategies vor dem Ressourcen-Loader ablaufen. Der Loader erkennt
genau diesen Fehler und lädt die betroffene Seite einmal automatisch neu; ein
Session-Marker verhindert Endlosschleifen.

Die primäre Strategy-Konfiguration lautet:

```yaml
strategy:
  type: custom:smartphone-dashboard
  backend_key: default
```

`backend_key: default` kennzeichnet das eine Dashboard, dessen Einstellungen
für die globalen Benachrichtigungen maßgeblich sind. Weitere Dashboards erhalten
einen eigenen stabilen Schlüssel oder verwenden ihren Dashboard-Pfad.

Globale HTTP-, Extra-JS- und WebSocket-Registrierungen besitzen in Home
Assistant keinen Config-Entry-Unregister-Lebenszyklus. Beim Entfernen der
Integration stoppt der Entry sofort Hintergrundtasks; für das vollständige
Entfernen der globalen Frontendregistrierung ist ein Neustart erforderlich.

Diagnose in den Browser-WebSocket-Werkzeugen: `smartphone_dashboard/config/get`. `migration.legacy_helpers_found` sollte bei installierter Paket-Kompatibilität 17 ergeben. Der Import ist wiederholbar und löscht nichts.
Die Admin-WebSocket-Antwort kann lokale Entity-IDs und Meldungseinstellungen
enthalten und ist deshalb als sensible Diagnoseinformation zu behandeln.

## Dashboard-Schlüssel und Benachrichtigungen

Konfigurationen werden getrennt nach `backend_key` gespeichert; ohne expliziten
Schlüssel wird der bereinigte Dashboard-Pfad verwendet. Für das Dashboard, das
die globalen Benachrichtigungsregeln verwaltet, `backend_key: default` setzen.
Der einmalige Import der 17 Helfer befüllt genau diesen Schlüssel. Danach ist
der importierte Snapshot maßgeblich, auch wenn die alten Helfer später fehlen;
sie werden weder fortlaufend darübergelegt noch gelöscht. Andere Dashboard-
Schlüssel bleiben vollständig isoliert.
