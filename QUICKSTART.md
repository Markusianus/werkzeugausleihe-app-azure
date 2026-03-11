# ⚡ ToolHub – Quick Start

## Lokaler 5-Minuten-Run
```bash
# Backend
cd backend && npm install && cp .env.example .env
npm run init-db && npm start  # Healthcheck: http://localhost:3000/api/health

# Frontend
cd frontend && npm install && npm start
```
Admin-Demo: Button „Admin“ → Passwort `admin123`.

## .env (Backend)
```env
DB_HOST=localhost  # Azure: <server>.postgres.database.azure.com
DB_PORT=5432
DB_NAME=toolhub
DB_USER=postgres
DB_PASSWORD=your-password
DB_SSL=false      # Azure meist true
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:8080
```

## Azure in Kürze
1. PostgreSQL (Azure Flexible Server) + DB anlegen
2. Backend-App-Service deployen, `DB_*` + `FRONTEND_URL` setzen
3. Frontend-App-Service deployen, `API_URL` setzen
4. Healthcheck + CORS testen
→ Details: `AZURE_DEPLOYMENT.md`

## Agenten-Hinweis
Erst `AGENTS.md`, danach optional `agent-onboarding.json` für Automatisierung lesen.

## Troubleshooting
- Backend startet nicht → DB erreichbar? `.env` korrekt?
- Frontend lädt nicht → `config.js`/`API_URL` prüfen, CORS checken
- Keine Daten → Browser-Konsole + API-Antworten prüfen

## Demo-Daten
`npm run init-db` legt Beispiel-Werkzeuge (Bohrmaschine, Hammer, …) an.
