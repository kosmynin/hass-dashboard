# Version 23.2.0

- **Energie → Jetzt** zeigt die Home Flow Card, den nativen Leistungsfluss und danach die einzelnen PV-Eingänge. Fehlende Messquellen blenden die Hausgrafik nicht mehr vollständig aus. Die PV-Liste zeigt auch ausgeblendete Eingänge des Wechselrichters. Weitere Module lassen sich im Dashboard-Editor ergänzen.
- Die optionale Reolink-Türklingel meldet Tastendrücke mit Ton auf den ausgewählten Companion-Handys. Antippen öffnet das Livebild mit der Gegensprechfunktion, sofern das Modell und die Home-Assistant-Konfiguration sie unterstützen.

# Version 23.1.9

- Ein manuell gewählter PV-Gesamtsensor bleibt auch bei ausgeblendeter Entität als Quelle der Hausgrafik verfügbar.
- Quellen mit reinen Tageswerten blockieren die Live-Hausgrafik nicht mehr. Die Strategy wertet auch separat konfigurierte Lade- und Entladesensoren des Speichers aus und benennt Fehler beim Laden der Home Flow Card genauer.

# Version 23.1.8

- Die Hausgrafik zeigt die gemessene PV-Gesamtleistung bei mehreren PV-Eingängen. Ein passender Sensor wird automatisch erkannt oder lässt sich im Dashboard-Editor unter **Weitere Bereiche → Energie** auswählen. Die Einzelwerte bleiben in der PV-Liste.
- **Heute** verwendet die native Energiebilanz in kWh, damit reine Leistungskarten wie Home Flow Card v0.3.2 keine Tagesenergiewerte als Leistung darstellen.

# Version 23.1.7

- Das Energie-Pop-up zeigt die Home Flow Card auch dann, wenn ihr Modul erst nach dem Öffnen geladen wird. Falls es weiterhin die native Karte verwendet, zeigt es den Grund an.
- Eine PV-Quelle mit Tageszähler und ohne Leistungssensor blendet den Live-Stromfluss für Netz und Akku nicht mehr aus. Das Pop-up erkennt auch übersetzte PV-Eingänge und behält die gemessene PV-Gesamtleistung, wenn für die einzelnen Eingänge nur Ertragszähler verfügbar sind.

# Version 23.1.6

- Unter **Räume** prüft der Dashboard-Editor unbekannte Bereichs-IDs und kann ihre gespeicherten Verweise entfernen.
- Die Live-Verbraucherliste unterstützt weitere Leistungseinheiten und erklärt, wenn eingerichtete Sensoren für die Liste ausgeblendet sind oder ihre Einheit fehlt. Die Home Flow Card kann den Hausverbrauch aus den Quellen berechnen, wenn für das Haus nur ein Energiezähler konfiguriert ist.

# Version 23.1.5

- Das Energie-Pop-up wechselt zwischen Live-Leistung und Tagesertrag. Es zeigt die drei größten Verbraucher, PV-Eingänge und den Akkufluss. Wenn die Home Flow Card geladen ist und zu den konfigurierten Quellen passt, zeigt sie den Stromfluss als Hausgrafik.
- Ein Haushaltsgerät erhält eine Live Activity, wenn es über mehrere Home-Assistant-Geräteeinträge erkannt wird. Überzählige gespeicherte Aktivitäten werden beendet.

# Version 23.1.4

- In den Raumeinstellungen lässt sich die Namensanzeige pro Entität wählen. Die Voreinstellung für kurze Namen greift auch bei Leuchten.

# Version 23.1.3

- Schalter in Raum-Pop-ups zeigen standardmäßig den Entitätsnamen. Unter **Räume** lässt sich **Gerätenamen bei Schaltern ausblenden** ausschalten.

# Version 23.1.2

- Das Energie-Pop-up zeigt zusätzlich zur runden Tagesübersicht den aktuellen Leistungsfluss mit der momentanen Hausleistung. Die native Live-Karte übernimmt die Leistungssensoren aus den Energie-Einstellungen.
- Liefertermine zeigen den Paketinhalt, sonst Absender oder Zusteller. Das Abfall-Pop-up lädt die kommenden Abholungen aus dem Kalender oder den Abfallsensoren.

# Version 23.1.1

- Das Energie-Pop-up verwendet die native Karte **Energieverteilung** als Hauptansicht. Konfigurierte Wasser- und Gaszähler erscheinen direkt in der Karte. Die Kacheln darunter zeigen verfügbare Live-Messwerte und den Ladestand.

# Version 23.1.0

- Unter **Weitere Bereiche → Energie** öffnet sich eine kompakte Übersicht mit Hausverbrauch, PV-Leistung und Ladezustand der Speicher. Der Live-Stromfluss und die Energiebilanz verwenden die Quellen des eingebauten Energie-Dashboards.
- Das Energie-Pop-up lädt seine Karten beim Öffnen. Ohne konfigurierte Leistungssensoren zeigt es die Energiebilanz und verlinkt das eingebaute Dashboard.

# Version 23.0.1

- Lange Paketnamen halten sich an die Breite der Meldungsspalte. In der Vorschau stehen Status und Liefertermin vor dem Produktnamen. Das Paket-Pop-up zeigt den vollständigen Namen.

# Version 23.0.0

## Dashboard und Bedienung

- Bubble Card bestimmt Form, Abstände und Farben ihrer Grundfläche. Meldungen, Schnellaktionen, Räume und weitere Bereiche verwenden dieselben Abschnittstrenner. Personen erscheinen ohne Überschrift.
- Räume, Meldungen, Medien, Pakete, Sicherheit, Bambu Lab und System verwenden dieselbe Pop-up-Konfiguration. Sie nutzt den Performance-Modus aus [Bubble Card 3.3](https://github.com/Clooos/Bubble-Card/blob/v3.3.0/README.md#pop-up-options). Geöffnete Pop-ups erhalten aktuelle Entitätsdaten. Geschlossene Inhalte bekommen keine laufenden Zustandsupdates.
- Raumicon schaltet das Hauptlicht, die Kartenfläche öffnet den Raum. Lichtslider bleiben dimmbaren Leuchten vorbehalten. Sensoren behalten ihre zweispaltige Anordnung und verwenden den Entitätsnamen.
- In den Einstellungen lassen sich Startseite, Räume, Personen und Schnellaktionen per Pfeiltaste am Eintrag oder per Drag-and-drop sortieren. Raum-Checkboxen sammeln mehrere Änderungen im selben Bearbeitungsvorgang. Der Fokus bleibt nach einer Sortierung am verschobenen Eintrag.
- Die Meldung zeigt auch bei mehreren Paketquellen nur die nächste Sendung. Das Paket-Pop-up listet alle aktiven Sendungen mit Lieferfenster, Fortschritt und Tracking-Link. Doppelte Trackingnummern erscheinen nur einmal.
- Detaildialoge zeigen die Pausenaktionen nur beim Einstieg von einer Meldungs-Live-Activity. Zustandsupdates reißen den Fokus dort nicht aus den Bedienelementen.

## Befunde aus der technischen Prüfung

| Bereich | Befund und Korrektur |
| --- | --- |
| Start und Updates | Der Loader hat Konstruktoren bestehender Komponenten überschrieben und nach englischem Fehlertext im gerenderten DOM gesucht. Die Registrierung trägt fehlende Komponenten jetzt direkt ein. Doppelte lokale Ressourcen der Integration werden zusammengeführt. |
| Einstellungen | Ein späterer Raum-Checkbox-Klick konnte frühere Änderungen aus einem veralteten Ausgangswert überschreiben. Änderungen nutzen jetzt den aktuellen Entwurf. Die Revision im Backend wird erst nach einem erfolgreichen Speichervorgang weitergeschaltet. |
| Pakete | Das Backend wählt eine Sendung für Meldungen und Live Activities. Das Pop-up nutzt die Versanddaten für eine vollständige, sortierte Liste aktiver Sendungen. Produktnamen werden auch aus strukturierten Amazon-Artikeln gelesen. Versteckte Quellen werden bei der Anreicherung übersprungen. |
| Warntexte | Beschreibungen und Handlungsempfehlungen von NINA werden als Text ausgegeben und bleiben im Detaildialog vollständig lesbar. |
| Live Activities | Änderungen an der Meldungsliste haben bisher den ganzen Satz ersetzt. Jede aktive Meldung behält jetzt ihren Tag, solange sie sichtbar bleibt. NINA und USV bekommen Vorrang, damit eine hörbare Warnung einen sichtbaren Eintrag hat. Die [Companion-App](https://companion.home-assistant.io/docs/notifications/live-activities/) verwendet denselben Tag für stille Updates. Alte Tags werden beim Wechsel auf das neue Schema aufgeräumt. |
| Zustandsabgleich | Dashboard und Benachrichtigungen erhalten dieselbe Auswertung aus dem Backend. Das deckt auch kombinierte USV-Flags und mehrzeilige Abfallsensoren ab. Eine gemeinsame WebSocket-Subscription aktualisiert die Meldungslisten und prüft die Leserechte auf die Quelldaten. |

Die vorhandenen Strategy-Schlüssel, Dashboard-Optionen und die Speicherstruktur werden weiterverwendet. Das Update kann bestehende Warnungs-Live-Activities einmal mit den neuen Tags neu aufbauen.

## Abnahme in Home Assistant

Für die Freigabe auf einer Testinstanz sind die Ansichten in beiden Themes, die Bedienung in der iOS-Companion-App und die installierten Custom Cards zu prüfen. Die automatisierten Tests prüfen die erzeugten Konfigurationen und die Logik.

- Kaltstart und erneutes Öffnen eines Raums mit Sensorgraphen und eines Sicherheits-Pop-ups mit Kamera
- Mehrere Raum-Entitäten nacheinander auswählen, sortieren, speichern und erneut öffnen
- NINA-Warntext, USV mit mehreren Flags, Abfallkalender und Tracking-Link einer Sendung öffnen
- Zwei Meldungen mit unterschiedlichen Kategorien erzeugen. Einen Messwert ändern, eine Meldung hinzufügen und eine entfernen. Tags, Titel, Ton und Absprung auf dem iPhone prüfen
- Medien-Fernbedienung und Fortschritt eines laufenden Haushaltsgeräts prüfen
