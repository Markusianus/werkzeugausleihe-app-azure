# DATABASE_SEMANTICS.md — ToolHub Felddokumentation

> Erstellt: 2026-04-01  
> Quelle: Gespräch mit Fabian Schneider (fachlicher Stakeholder)  
> Zweck: Semantik der Datenbankfelder auf Basis realer Nutzung dokumentieren

---

## Werkzeug

### `name`
Freitext. Pflichtfeld. Eindeutiger menschenlesbarer Name des Werkzeugs.

### `inventarnummer`
Pflichtfeld. **Jedes Werkzeug hat eine individuelle Inventarnummer** — kein Werkzeug wird als Mengen-/Bestandseintrag verwaltet. Jedes physische Stück ist ein eigener Datensatz.

### `kategorie`
**Feste Auswahlliste** (seit 01.04.2026). Kein Freitext mehr.  
Gültige Werte:
- Akku-Werkzeug
- Beleuchtung
- Bohrmaschine
- Computer / Drucker
- Drehmomentschlüssel
- Endoskop / Kamera
- Erste Hilfe
- Feuerlöscher
- Funkgerät
- Gaswarnung
- Glasfaser
- Heizung
- Heißluftfön / Heißklebepistole
- Hubwagen / Hebehilfe
- Hydraulik
- Kabel / Verlängerungsleitung
- Ladegerät
- Leiter
- Löten
- Messgerät
- PSA / Schutzausrüstung
- Schleifgerät
- Schneidgerät / Säge
- Stanze
- Staubsauger / Absaugung
- Steckdosenleiste / Stromverteiler
- Trafo / Trenntransformator
- Werkzeugkoffer
- Zange
- Zubehör

> Hinweis: Bestehende Datensätze können noch alte Freitext-Werte enthalten (vor 01.04.2026 angelegt). Bei Bearbeitung sollte der neue Listenwert gewählt werden.

### `zustand`
Freitext. Optional. Wird vom Tool-Admin selbst eingeschätzt und eingetragen. Keine feste Werteliste — freie Beschreibung des aktuellen Zustands.

### `lagerplatz`
Freitext. Optional. Freie Beschreibung des Aufbewahrungsorts (z. B. Raum, Regal, Bezeichnung). Keine Normierung vorgesehen.

### `foto`
Kein Pflichtfeld im technischen Sinne, aber **fachlich erwartet** — wird nach und nach für alle Werkzeuge ergänzt. Kann nicht per CSV/Excel-Import hochgeladen werden, muss manuell im Formular gepflegt werden.

### `bestand_gesamt` / `bestand_defekt` / `bestand_in_wartung`
**Nicht relevant für diesen Betrieb.** Da jedes Werkzeug eine individuelle Inventarnummer hat, ist der Bestand immer 1. Diese Felder sind im Frontend ausgeblendet und werden nicht aktiv gepflegt.

### `status`
Auswahlfeld. Gültige Werte:
- `verfuegbar` — Werkzeug ist ausleihbar
- `reserviert` — reserviert, aber noch nicht abgeholt
- `ausgeliehen` — aktuell beim Ausleiher
- `defekt` — nicht einsatzfähig
- `reinigung` — wird gereinigt
- `reparatur` — wird repariert

### `wartungsintervall_tage` / `letzte_wartung_am` / `wartung_notiz`
Optional. Werden aktuell nicht aktiv genutzt — Wartungs-Dashboardkacheln sind ausgeblendet.

---

## Offene Punkte

- [ ] Datenmigration: Bestehende Werkzeuge mit alten Freitext-Kategorien auf neue Listenwerte mappen
- [ ] Foto-Ergänzung: Bestehende Einträge ohne Foto schrittweise nachpflegen
