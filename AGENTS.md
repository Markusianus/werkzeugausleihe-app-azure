# AGENTS.md

## Zweck
Dieses Dokument ist der **erste Einstiegspunkt** für autonome Agenten, die dieses Repository betreiben, warten oder erweitern.

## Projektüberblick
- Name: `werkzeugausleihe-app-azure`
- Domäne: Werkzeugausleihe (Reservierung, Ausleihe, Rückgabe, Schäden)
- Architektur:
  - `backend/`: Node.js + Express REST API + PostgreSQL
  - `frontend/`: Statische Web-App mit kleinem Express-Server
- Deployment-Ziel: Azure App Service (Backend und Frontend separat)

## Wichtige Verzeichnisse
- `backend/server.js` – Haupt-API mit allen Endpunkten
- `backend/init-db.js` – Initialisiert DB-Schema/Seed
- `backend/package.json` – Backend-Skripte/Dependencies
- `frontend/index.html` – UI
- `frontend/main.js` – Frontend-Logik
- `frontend/config.js` – API-Endpoint-Konfiguration
- `frontend/server.js` – Statischer Host für Frontend
- `AZURE_DEPLOYMENT.md` – Azure-Deploymentablauf
- `QUICKSTART.md` – Lokaler Schnellstart

## Laufzeitanforderungen
- Backend: Node.js `>=18.x`
- Frontend (laut `frontend/package.json`): Node.js `24.x`
- Datenbank: PostgreSQL (Azure Database for PostgreSQL)

## Lokaler Start (Standard)
1. Backend:
   - `cd backend`
   - `npm install`
   - `.env` konfigurieren (auf Basis `.env.example`)
   - `npm run init-db`
   - `npm start`
2. Frontend:
   - `cd frontend`
   - `npm install`
   - `npm start` (oder statischer Server laut Doku)

## API-Flächen (Kern)
- Health/Stats: `/api/health`, `/api/stats`
- Werkzeuge: `/api/werkzeuge`
- Ausleihen: `/api/ausleihen`
- Schäden: `/api/schaeden`
- Export: `/api/export/werkzeuge`

## Betriebs-/Änderungsregeln für Agenten
1. **Sicherheitsprinzip**: Keine Secrets in Code/Commits. Nur über Environment-Variablen.
2. **Minimale Änderungen**: Kleine, klar abgegrenzte Commits bevorzugen.
3. **Rückwärtskompatibilität**: API-Verhalten nur mit Begründung ändern.
4. **Vor Deploy validieren**:
   - Backend startet ohne Crash
   - Healthcheck `/api/health` antwortet
   - DB-Verbindung funktioniert
5. **Logs zuerst lesen** bei Fehlern (App Service + API-Logs).
6. **Keine destruktiven DB-Änderungen** ohne Backup-/Migrationsplan.

## Bekannte operative Hinweise
- Es existieren separate Git-Pushes für `backend` und `frontend` Richtung Azure Remote.
- `node init-db.js` wurde bereits genutzt; erneutes Ausführen kann Daten beeinflussen (je nach Implementierung).
- Bei `az webapp log tail` kann Exit Code `1` auftreten; Konfiguration/Authentifizierung prüfen.

## Empfohlener First-Run-Plan für neue Agenten
1. `README.md`, `QUICKSTART.md`, `AZURE_DEPLOYMENT.md` lesen.
2. `backend/server.js` und `backend/init-db.js` analysieren.
3. Konfiguration in `frontend/config.js` prüfen (API-Basis-URL).
4. Lokal Healthcheck validieren.
5. Erst danach Änderungen durchführen.

## Definition of Done (für Agentenaufgaben)
- Änderung implementiert
- Relevante Pfade lokal getestet
- Keine offensichtlichen Laufzeitfehler
- Dokumentation bei Verhaltensänderung angepasst

## Kontaktpunkt im Code
Wenn unklar, beginne mit:
- `backend/server.js` (Geschäftslogik/API)
- `frontend/main.js` (Client-Interaktionen)
