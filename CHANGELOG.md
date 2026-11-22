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
