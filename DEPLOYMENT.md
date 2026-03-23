# DEPLOYMENT.md

## Zweck
Diese Datei bündelt die projektspezifischen Deploy-Regeln für ToolHub.

## Grundsatz
ToolHub wird aktuell als **Dev-/Staging-Projekt** behandelt. Staging und Produktion sind bewusst getrennt.

## Staging
### Standardweg
Staging wird **nicht** über GitHub Actions für `develop` deployed.

Stattdessen ist der Standardweg:

```bash
scripts/deploy-staging.sh backend|frontend|all
```

### Voraussetzungen
Die nötigen Azure-Local-Git-Zugangsdaten liegen projektlokal unter `.local/` und dürfen nicht versioniert werden.

Benötigte Variablen sind u. a.:
- `AZURE_STAGING_BACKEND_GIT_URL`
- `AZURE_STAGING_BACKEND_GIT_USERNAME`
- `AZURE_STAGING_BACKEND_GIT_PASSWORD`
- `AZURE_STAGING_FRONTEND_GIT_URL`
- `AZURE_STAGING_FRONTEND_GIT_USERNAME`
- `AZURE_STAGING_FRONTEND_GIT_PASSWORD`

### Pflicht vor jedem Staging-Deploy
1. aktiven Branch prüfen
2. bewusst benennen, welcher Stage-Stand deployed werden soll
3. prüfen, ob alle erwarteten Fixes im Stage-Stand enthalten sind
4. Arbeitsverzeichnis auf Nachvollziehbarkeit prüfen
5. Deploy-Skript ausführen
6. Healthchecks prüfen
7. fachliche Marker prüfen
8. Ergebnis dokumentieren

### Wichtige Regel
Nie aus einem zufälligen Arbeitsbranch deployen. Frühere Staging-Fixes dürfen nicht versehentlich überschrieben werden.

## Produktion
Produktive Deployments sollen nur aus dem produktiven Branch erfolgen und nur über GitHub Actions.

Für ToolHub gilt aktuell historisch:
- `master` ist noch der produktionsnahe Hauptbranch
- langfristiges Zielmodell bleibt ein klarer `production`-Branch

## Verweise
- Allgemeiner Prozess: `/data/.openclaw/workspace/SOFTWARE_PROJECTS.md`
- Azure-Details: `AZURE_DEPLOYMENT.md`
- Staging-Skript: `scripts/deploy-staging.sh`
