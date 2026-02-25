# 🚀 ToolHub Azure Deployment Guide

Vollständige Anleitung zur Bereitstellung von ToolHub auf Azure mit PostgreSQL.

---

## 📋 Voraussetzungen

- Azure-Konto (Free Tier funktioniert für Tests)
- Azure CLI installiert ([Download](https://docs.microsoft.com/cli/azure/install-azure-cli))
- Node.js 18+ lokal installiert
- Git installiert

---

## 1️⃣ Azure PostgreSQL Datenbank erstellen

### Option A: Azure Portal (GUI)

1. **Portal öffnen:** [portal.azure.com](https://portal.azure.com)

2. **Ressource erstellen:**
   - Suche nach "Azure Database for PostgreSQL flexible server"
   - Klick auf "Erstellen"

3. **Grundlagen konfigurieren:**
   - **Abonnement:** Dein Azure-Abonnement
   - **Ressourcengruppe:** Neue erstellen (z.B. `rg-toolhub`)
   - **Servername:** `toolhub-db` (muss global eindeutig sein)
   - **Region:** West Europe (oder deine Region)
   - **PostgreSQL-Version:** 15 (oder neuer)
   - **Compute + Speicher:** 
     - **Für Tests:** Burstable, B1ms (1 vCore, 2 GiB RAM)
     - **Für Produktion:** General Purpose, D2s_v3 (2 vCore, 8 GiB RAM)
   - **Admin-Benutzername:** `toolhubadmin`
   - **Passwort:** Starkes Passwort (merken!)

4. **Netzwerk konfigurieren:**
   - **Konnektivitätsmethode:** Öffentlicher Zugriff
   - **Firewallregeln:** 
     - ✅ "Azure-Dienste Zugriff auf diesen Server erlauben" aktivieren
     - Optional: Deine lokale IP für Testing hinzufügen

5. **Überprüfen + Erstellen** → Warten (ca. 5-10 Minuten)

6. **Connection String notieren:**
   ```
   Host: toolhub-db.postgres.database.azure.com
   Port: 5432
   Database: postgres (Standard, wir erstellen später "toolhub")
   User: toolhubadmin
   Password: [dein-passwort]
   ```

### Option B: Azure CLI

```bash
# Einloggen
az login

# Ressourcengruppe erstellen
az group create --name rg-toolhub --location westeurope

# PostgreSQL Flexible Server erstellen
az postgres flexible-server create \
  --resource-group rg-toolhub \
  --name toolhub-db \
  --location westeurope \
  --admin-user toolhubadmin \
  --admin-password "DeinStarkesPasswort123!" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --version 15 \
  --storage-size 32 \
  --public-access 0.0.0.0

# Datenbank erstellen
az postgres flexible-server db create \
  --resource-group rg-toolhub \
  --server-name toolhub-db \
  --database-name toolhub
```

---

## 2️⃣ Datenbank initialisieren

### Lokal mit init-db.js

1. **Backend-Verzeichnis wechseln:**
   ```bash
   cd backend/
   ```

2. **Dependencies installieren:**
   ```bash
   npm install
   ```

3. **`.env` erstellen** (von `.env.example` kopieren):
   ```bash
   cp .env.example .env
   ```

4. **`.env` ausfüllen:**
   ```env
   DB_HOST=toolhub-db.postgres.database.azure.com
   DB_PORT=5432
   DB_NAME=toolhub
   DB_USER=toolhubadmin
   DB_PASSWORD=DeinStarkesPasswort123!
   DB_SSL=true
   PORT=3000
   NODE_ENV=development
   FRONTEND_URL=http://localhost:8080
   ```

5. **Datenbank initialisieren:**
   ```bash
   npm run init-db
   ```

   Du solltest sehen:
   ```
   🚀 Initialisiere Datenbank...
   ✅ Tabelle "requests" erstellt
   ✅ Tabelle "options" erstellt
   ✅ Tabelle "bookings" erstellt
   ✅ Indexes erstellt
   🎉 Datenbank erfolgreich initialisiert!
   ```

6. **Backend lokal testen:**
   ```bash
   npm start
   ```

   Öffne: [http://localhost:3000/api/health](http://localhost:3000/api/health)

---

## 3️⃣ Backend auf Azure Web App deployen

### Option A: Azure Portal + Git Deployment

1. **Web App erstellen:**
   - Portal → "App Services" → "+ Erstellen"
   - **Ressourcengruppe:** `rg-toolhub`
   - **Name:** `toolhub-backend` (muss global eindeutig sein)
   - **Veröffentlichen:** Code
   - **Runtime-Stack:** Node 18 LTS
   - **Betriebssystem:** Linux
   - **Region:** West Europe
   - **App Service-Plan:** 
     - Neu erstellen: `toolhub-plan`
     - **Für Tests:** F1 (Free) oder B1 (Basic)
     - **Für Produktion:** P1V2 (Premium)

2. **Bereitstellung konfigurieren:**
   - **Deployment Center** → **Quelle:** Lokales Git
   - Git-Befehle werden angezeigt

3. **Umgebungsvariablen setzen:**
   - **Konfiguration** → **Anwendungseinstellungen** → "+ Neue Anwendungseinstellung"
   
   Füge alle Variablen aus `.env` hinzu:
   ```
   DB_HOST = toolhub-db.postgres.database.azure.com
   DB_PORT = 5432
   DB_NAME = toolhub
   DB_USER = toolhubadmin
   DB_PASSWORD = DeinStarkesPasswort123!
   DB_SSL = true
   NODE_ENV = production
   FRONTEND_URL = https://toolhub-frontend.azurewebsites.net
   ```

4. **Git-Deployment:**
   ```bash
   # Git initialisieren (falls noch nicht)
   cd backend/
   git init
   git add .
   git commit -m "Initial commit"

   # Azure Remote hinzufügen (URL aus Portal kopieren)
   git remote add azure https://toolhub-backend.scm.azurewebsites.net:443/toolhub-backend.git

   # Deployen
   git push azure master
   ```

5. **Logs prüfen:**
   - Portal → Web App → **Log Stream**

6. **Testen:**
   ```bash
   curl https://toolhub-backend.azurewebsites.net/api/health
   ```

### Option B: Azure CLI Deployment

```bash
# Web App erstellen
az webapp up \
  --resource-group rg-toolhub \
  --name toolhub-backend \
  --runtime "NODE:18-lts" \
  --sku B1 \
  --location westeurope

# Umgebungsvariablen setzen
az webapp config appsettings set \
  --resource-group rg-toolhub \
  --name toolhub-backend \
  --settings \
    DB_HOST=toolhub-db.postgres.database.azure.com \
    DB_PORT=5432 \
    DB_NAME=toolhub \
    DB_USER=toolhubadmin \
    DB_PASSWORD="DeinStarkesPasswort123!" \
    DB_SSL=true \
    NODE_ENV=production \
    FRONTEND_URL=https://toolhub-frontend.azurewebsites.net

# Deployment
cd backend/
zip -r deploy.zip .
az webapp deployment source config-zip \
  --resource-group rg-toolhub \
  --name toolhub-backend \
  --src deploy.zip
```

---

## 4️⃣ Frontend anpassen & deployen

### Frontend für API vorbereiten

Das Frontend muss angepasst werden, um die API zu nutzen statt sql.js.

1. **Neue Frontend-Version** liegt in `/frontend/index.html`
   - Alle sql.js Aufrufe wurden durch `fetch()`-API-Calls ersetzt
   - API-URL wird aus `window.API_URL` gelesen

2. **Konfigurationsdatei erstellen:**

   ```bash
   cd frontend/
   ```

   Erstelle `config.js`:
   ```javascript
   // API Konfiguration
   window.API_URL = 'https://toolhub-backend.azurewebsites.net/api';
   ```

3. **index.html aktualisieren** (erste Zeilen):
   ```html
   <head>
       <meta charset="UTF-8">
       <meta name="viewport" content="width=device-width, initial-scale=1.0">
       <title>ToolHub</title>
       <script src="config.js"></script>
       <!-- sql.js wurde entfernt! -->
       ...
   </head>
   ```

### Frontend auf Azure Static Web Apps deployen

#### Option A: Azure Static Web Apps (empfohlen für reine Frontend-Apps)

```bash
# Static Web App erstellen
az staticwebapp create \
  --name toolhub-frontend \
  --resource-group rg-toolhub \
  --location westeurope

# GitHub Actions Deployment (oder manuell via Azure Portal)
# Siehe: https://docs.microsoft.com/azure/static-web-apps/
```

#### Option B: Separate Azure Web App (einfacher für diesen Guide)

```bash
# Web App für Frontend
az webapp up \
  --resource-group rg-toolhub \
  --name toolhub-frontend \
  --runtime "NODE:18-lts" \
  --sku F1 \
  --location westeurope

# Frontend-Dateien hochladen
cd frontend/
zip -r frontend.zip .
az webapp deployment source config-zip \
  --resource-group rg-toolhub \
  --name toolhub-frontend \
  --src frontend.zip
```

---

## 5️⃣ CORS konfigurieren

Falls CORS-Fehler auftreten:

### Backend: CORS in server.js

Zeile 25 in `server.js`:
```javascript
app.use(cors({
  origin: ['https://toolhub-frontend.azurewebsites.net', 'http://localhost:8080']
}));
```

### Azure Portal

1. Web App → **CORS**
2. **Zulässige Ursprünge:** `https://toolhub-frontend.azurewebsites.net`
3. Speichern

---

## 6️⃣ Testen & Monitoring

### Health Check

```bash
curl https://toolhub-backend.azurewebsites.net/api/health
# Erwartete Antwort: {"status":"ok","timestamp":"..."}
```

### Frontend öffnen

```bash
https://toolhub-frontend.azurewebsites.net
```

### Logs überwachen

```bash
# Backend Logs
az webapp log tail \
  --resource-group rg-toolhub \
  --name toolhub-backend
```

### Application Insights (optional, aber empfohlen)

1. Portal → Web App → **Application Insights** → Aktivieren
2. Automatisches Monitoring von:
   - API-Performance
   - Fehlerrate
   - Datenbankabfragen

---

## 7️⃣ Kosten-Übersicht (ungefähr)

### Free Tier (Testing)
- PostgreSQL Flexible Server B1ms: ~10 EUR/Monat
- Web App F1 (Free): 0 EUR
- **Gesamt: ~10 EUR/Monat**

### Production Setup (kleine Firma)
- PostgreSQL Flexible Server D2s_v3: ~80 EUR/Monat
- Web App B1 (Basic): ~12 EUR/Monat
- **Gesamt: ~92 EUR/Monat**

### Optimierungstipps

1. **Auto-Scaling deaktivieren** wenn nicht nötig
2. **Stop/Start Skripte** für Dev-Umgebungen (nachts ausschalten)
3. **Reserved Instances** für Production (Jahrescommitment = Rabatt)

---

## 🔒 Sicherheits-Checkliste

- [ ] Starke Passwörter für DB-Admin
- [ ] Firewall-Regeln auf notwendige IPs beschränken
- [ ] SSL/TLS für DB-Verbindungen aktiviert (`DB_SSL=true`)
- [ ] HTTPS für Web Apps (automatisch von Azure)
- [ ] `.env` Dateien nicht in Git committen
- [ ] Application Insights für Anomalie-Erkennung
- [ ] Regelmäßige DB-Backups (Azure macht automatisch 7 Tage)

---

## 🛠 Troubleshooting

### Verbindung zur DB schlägt fehl

1. **Firewall prüfen:**
   ```bash
   az postgres flexible-server firewall-rule list \
     --resource-group rg-toolhub \
     --name toolhub-db
   ```

2. **Azure Services erlauben:**
   ```bash
   az postgres flexible-server firewall-rule create \
     --resource-group rg-toolhub \
     --name toolhub-db \
     --rule-name AllowAzure \
     --start-ip-address 0.0.0.0 \
     --end-ip-address 0.0.0.0
   ```

### Web App startet nicht

1. **Logs ansehen:**
   ```bash
   az webapp log tail --resource-group rg-toolhub --name toolhub-backend
   ```

2. **Node-Version prüfen:**
   - Portal → **Konfiguration** → **Allgemeine Einstellungen** → Node-Version = 18

3. **Start-Befehl prüfen:**
   - Portal → **Konfiguration** → **Allgemeine Einstellungen**
   - Startbefehl: `npm start`

### CORS-Fehler

- **Backend:** `cors` Middleware richtig konfiguriert?
- **Azure:** CORS-Einstellungen im Portal setzen

---

## 📚 Weitere Ressourcen

- [Azure PostgreSQL Flexible Server Docs](https://docs.microsoft.com/azure/postgresql/flexible-server/)
- [Azure App Service Node.js Guide](https://docs.microsoft.com/azure/app-service/quickstart-nodejs)
- [Azure CLI Referenz](https://docs.microsoft.com/cli/azure/)

---

## 🎉 Fertig!

Du hast jetzt:
- ✅ PostgreSQL Datenbank auf Azure
- ✅ Backend API deployed
- ✅ Frontend deployed
- ✅ Alles miteinander verbunden

**Nächste Schritte:**
1. Custom Domain konfigurieren (optional)
2. CI/CD mit GitHub Actions einrichten
3. Production-Monitoring aktivieren

---

**Entwickelt von:** Chris @ Februar 2026  
**Support:** Bei Fragen → Morpheus fragen! 💊
