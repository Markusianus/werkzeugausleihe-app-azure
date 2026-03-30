# STAGING_CHECKLIST.md

## Vor dem Deploy
- [ ] richtigen Projektpfad verwenden: `/data/.openclaw/workspace/repos/werkzeugausleihe-app-azure`
- [ ] aktuellen Branch prüfen
- [ ] geplanten Stage-Stand ausdrücklich benennen
- [ ] prüfen, ob alle erwarteten Fixes im Stage-Stand enthalten sind
- [ ] `git status` prüfen
- [ ] nötige `.local/`-Konfiguration vorhanden

## Deploy
- [ ] `scripts/deploy-staging.sh backend` / `frontend` / `all` passend ausführen

## Nach dem Deploy
- [ ] Backend-Healthcheck prüfen
- [ ] Frontend laden
- [ ] API-Anbindung prüfen
- [ ] fachliche Marker des konkreten Fixes prüfen
- [ ] Ergebnis dokumentieren

## Fachliche Marker (Beispiele)
- [ ] Dashboard-Statistiken sichtbar
- [ ] Bearbeiten-Flow speichert erwartete Felder
- [ ] QR-/Detailansicht funktioniert
- [ ] neue Statusoptionen korrekt sichtbar / speicherbar
- [ ] Tool-Admin-Begriffe in UI/Fehlertexten fachlich konsistent
- [ ] Dateiimport verlangt bei fehlender/abgelaufener Anmeldung verständlich eine Tool-Admin-Anmeldung
- [ ] Dateiimport zeigt Validierungsfehler im Dialog kopierbar und feldgenau an
- [ ] Upload-Hinweise im Import-Dialog sind strukturiert und verständlich
