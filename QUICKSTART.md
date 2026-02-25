# ⚡ ToolHub - Quick Start

## 5-Minuten Test

### 1. Backend starten

```bash
cd backend/
npm install
cp .env.example .env
# .env bearbeiten (siehe unten)
npm run init-db
npm start
```

### 2. Frontend öffnen

```bash
cd ../frontend/
python3 -m http.server 8080
```

→ Öffne: http://localhost:8080

### 3. Testen

**Mitarbeiter-Modus:**
1. Werkzeug in Warenkorb
2. Name + Zeitraum eingeben
3. Reservieren

**Admin-Modus:**
1. Klick "Admin"
2. Passwort: `admin123`
3. Dashboard sehen
4. Reservierung ausgeben

---

## .env Konfiguration

```env
DB_HOST=localhost  # Oder Azure: your-server.postgres.database.azure.com
DB_PORT=5432
DB_NAME=toolhub
DB_USER=postgres
DB_PASSWORD=your-password
DB_SSL=false  # true für Azure
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:8080
```

---

## Azure Deployment

Siehe **[AZURE_DEPLOYMENT.md](AZURE_DEPLOYMENT.md)** für Details!

**Kurzversion:**
1. PostgreSQL auf Azure erstellen
2. Backend deployen (Git Push)
3. Frontend deployen (Static Web App)
4. Fertig! 🎉

---

## Demo-Daten

Nach `npm run init-db` sind 8 Demo-Werkzeuge vorhanden:
- Bohrmaschine
- Hammer
- Stichsäge
- Schraubenzieher-Set
- Zollstock
- Akkuschrauber
- Wasserwaage
- Schutzbrille

---

## Troubleshooting

### Backend startet nicht
- PostgreSQL läuft? (`pg_isready`)
- `.env` richtig konfiguriert?

### Frontend lädt nicht
- `config.js`: `API_URL` korrekt?
- CORS-Fehler? → Backend `server.js` Zeile 23 prüfen

### Keine Daten sichtbar
- Browser Console öffnen (F12)
- API-Fehler checken

---

**Viel Erfolg! 🚀**
