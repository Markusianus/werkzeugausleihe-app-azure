# PROJECT_CONTEXT.md

## Projekt
- Name: ToolHub / werkzeugausleihe-app-azure
- Repository: `Markusianus/werkzeugausleihe-app-azure`
- Kanonischer lokaler Pfad: `/data/.openclaw/workspace/repos/werkzeugausleihe-app-azure`

## Zweck
ToolHub ist eine Werkzeugverwaltung für ein Unternehmen mit Fokus auf Ausleihe, Rückgabe, Statusverwaltung und administrativer Pflege. Das Projekt läuft aktuell in einer frühen Phase und wird bis auf Weiteres als **Dev-/Staging-Projekt**, nicht als echte Produktion, behandelt.

## Aktuelle Einordnung
- Branch-Strategie ab 2026-03-24:
  - `staged` = kanonischer Staging-Branch; soll immer exakt den Stand spiegeln, der auf die Dev-/Staging-App deployed ist
  - `master` = produktionsnaher Hauptbranch / Übergangszustand
  - issue-/themenspezifische Arbeitsbranches = Ort für Implementierung
- Arbeitsentscheidung:
  - **Staging nicht über GitHub Actions deployen**
  - Deploy-Ziel der Dev-/Staging-App ist der Branch **`staged`**
  - Änderungen werden auf dedizierten Issue-Branches erarbeitet, nach Abschluss in `staged` gemerged und von dort deployed
  - GitHub Actions bleiben für echte produktive Updates reserviert
- Die allgemeine projektübergreifende Prozessregel steht in:
  - `/data/.openclaw/workspace/SOFTWARE_PROJECTS.md`

## Produkt-/Fachkontext
Kernbereiche des Projekts:
- Werkzeugstammdaten
- Ausleihen / Rückgaben
- Schadens- und Statusverwaltung
- Admin-Funktionen
- optionale E-Mail-Benachrichtigungen
- perspektivisch weitere Features aus GitHub-Issues

## Bekannte Prozesslektion
Ein früherer Versuch, mehrere offene Issues in einem größeren delegierten Lauf abarbeiten zu lassen, war nicht sauber nachvollziehbar. Deshalb gilt für ToolHub ab jetzt verbindlich:
- Multi-Issue-Arbeit nur mit persistentem Orchestrator-Zustand
- Standard-Datei dafür: `.local/orchestrator-state.md`
- Session-IDs nur ergänzend, nicht als alleinige Referenz

## Aktueller sinnvoller Arbeitsmodus
Bei neuer Arbeit an ToolHub zuerst:
1. GitHub-/Repo-Stand prüfen
2. offene PRs / offene Issues prüfen
3. lokale Projektdateien lesen
4. `.local/orchestrator-state.md` prüfen oder anlegen, wenn mehrere Arbeitspakete koordiniert werden
5. erst dann delegieren / implementieren / deployen
