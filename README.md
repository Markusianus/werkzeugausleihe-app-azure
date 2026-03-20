# 🔨 ToolHub – Azure Edition

Werkzeugverwaltung mit Node.js/Express + PostgreSQL, optimiert für Azure App Services. (Stand: März 2026)

---

## Essentials
- Backend `backend/server.js`, Node.js ≥18, PostgreSQL 15+
- Frontend `frontend/`, Node.js 24, statisch + kleiner Express-Host
- Deployment: je ein App Service für Backend & Frontend
- Agent Einstieg: `AGENTS.md`, Automatisierung: `agent-onboarding.json`

## Repository
```text
backend/   API + DB-Skripte
frontend/  UI + API-Client
README.md  Überblick (diese Datei)
QUICKSTART.md  Lokaler Workflow
AZURE_DEPLOYMENT.md  Cloud-Anleitung
```

## Lokaler Workflow (Kurzform)
```bash
# Backend
cd backend && npm install && cp .env.example .env
npm run init-db && npm start  # Healthcheck: http://localhost:3000/api/health

# Frontend
cd frontend && npm install && npm start
```
Details und Demo-Szenarien stehen in `QUICKSTART.md`.

## API-Surface (Auszug)
```
GET /api/health | /api/stats
CRUD /api/werkzeuge
Ausleihen: /api/ausleihen, /:id/ausgeben, /:id/rueckgabe
Schäden: /api/schaeden, /:id/beheben
Export: /api/export/werkzeuge
```
Die vollständige Logik liegt in `backend/server.js`.

## Deployment in die Cloud
1. PostgreSQL Flexible Server + Datenbank provisionieren
2. Backend-App-Service deployen, `DB_*` + `FRONTEND_URL` setzen
3. Frontend-App-Service deployen, `API_URL` setzen
4. Healthcheck + CORS testen

Schritt-für-Schritt-Guide inkl. CLI-Befehlen: `AZURE_DEPLOYMENT.md`.

## Staging-Deploy während der Entwicklung
Staging läuft bewusst **nicht** mehr über GitHub Actions für den `develop`-Branch.
Stattdessen wird direkt per Azure Local Git deployed.

Dafür gibt es jetzt das Skript:

```bash
scripts/deploy-staging.sh backend|frontend|all
```

Benötigte Umgebungsvariablen:

```bash
AZURE_STAGING_BACKEND_GIT_URL
AZURE_STAGING_BACKEND_GIT_USERNAME
AZURE_STAGING_BACKEND_GIT_PASSWORD
AZURE_STAGING_FRONTEND_GIT_URL
AZURE_STAGING_FRONTEND_GIT_USERNAME
AZURE_STAGING_FRONTEND_GIT_PASSWORD
```

Typischer Ablauf nach einer Änderung:

```bash
# Nur Frontend geändert
scripts/deploy-staging.sh frontend

# Nur Backend geändert
scripts/deploy-staging.sh backend

# Beide Teile geändert
scripts/deploy-staging.sh all
```

Das Skript baut jeweils ein sauberes temporäres Deploy-Repo ohne `.git` und `node_modules`, pusht dieses direkt auf die Azure-Staging-Web-App und führt danach einfache Healthchecks aus.

## Tests & Monitoring
```bash
curl http://localhost:3000/api/health
curl https://<backend>.azurewebsites.net/api/health
```
Application Insights oder `az webapp log tail` für Runtime-Logs nutzen.

## Lizenz
MIT – Änderungen bitte mit Healthcheck, ohne Secrets im Repo.
