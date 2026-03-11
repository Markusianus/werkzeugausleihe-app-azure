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
   - **Servername:** `db-toolhub` (muss global eindeutig sein)
   - **Region:** West Europe (oder deine Region)
   - **PostgreSQL-Version:** 15 (oder neuer)
   - **Compute + Speicher:** 
     - **Für Tests:** Burstable, B1ms (1 vCore, 2 GiB RAM)
     - **Für Produktion:** General Purpose, D2s_v3 (2 vCore, 8 GiB RAM)
   - **Admin-Benutzername:** `toolhub`
   - **Passwort:** Starkes Passwort (merken!)

4. **Netzwerk konfigurieren:**
   - **Konnektivitätsmethode:** Öffentlicher Zugriff
   - **Firewallregeln:** 
     - ✅ "Azure-Dienste Zugriff auf diesen Server erlauben" aktivieren
     - Optional: Deine lokale IP für Testing hinzufügen

5. **Überprüfen + Erstellen** → Warten (ca. 5-10 Minuten)

6. **Connection String notieren:**
   ```
   Host: db-toolhub.postgres.database.azure.com
   Port: 5432
   Database: postgres (Standard, wir erstellen später "db-toolhub")
   User: toolhub
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
  --name db-toolhub \
  --location westeurope \
  --admin-user toolhub \
  --admin-password "DeinStarkesPasswort123!" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --version 15 \
  --storage-size 32 \
  --public-access 0.0.0.0

# Datenbank erstellen
az postgres flexible-server db create \
  --resource-group rg-toolhub \
  --server-name db-toolhub \
  --database-name db-toolhub
## 2️⃣ Datenbank initialisieren

### WICHTIG: Datenbank muss vor der Initialisierung erstellt werden!

**Bevor du `npm run init-db` ausführst, musst du die Datenbank in Azure erstellen.** Das `init-db.js` Script verbindet sich mit der angegebenen Datenbank, erstellt aber nicht die Datenbank selbst.

#### Datenbank über Azure CLI erstellen:
```bash
az postgres flexible-server db create \
  --resource-group rg-toolhub \
  --server-name db-toolhub \
  --database-name toolhub
```

#### Oder über Azure Portal:
1. Portal → PostgreSQL Flexible Server → Dein Server (`db-toolhub`)
2. **Datenbanken** → **+ Datenbank hinzufügen**
3. **Datenbankname:** `toolhub`
4. **Erstellen**

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
   DB_HOST=db-toolhub.postgres.database.azure.com
   DB_PORT=5432
   DB_NAME=db-toolhub
   DB_USER=toolhub
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
   ✅ Tabelle "werkzeuge" erstellt
   ✅ Tabelle "ausleihen" erstellt
   ✅ Tabelle "schaeden" erstellt
   ✅ Indexes erstellt
   📦 Demo-Daten eingefügt
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
   DB_HOST = db-toolhub.postgres.database.azure.com
   DB_PORT = 5432
   DB_NAME = db-toolhub
   DB_USER = toolhub
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

   # Azure Remote hinzufügen (Git URL aus Portal kopieren)
   # WICHTIG: Verwende die GIT URL, nicht die FTPS URL!
   # Portal → Web App → Deployment Center → Local Git → Git Clone Uri
   # Beispiel: https://your-app-name.scm.azurewebsites.net:443/your-app-name.git

   git remote add azure https://toolhub-backend-b2apccbyf0gmcqap.scm.germanywestcentral-01.azurewebsites.net:443/toolhub-backend.git

   # Hinweis: Es gibt zwei Deployment-Optionen:
   # 1. Git Deployment (diese Anleitung) - verwendet Git Push
   # 2. FTPS Deployment - verwendet FTP Upload (andere URL)

   # Credentials setzen (einmalig erforderlich)
   # Portal → Web App → Deployment Center → Local Git
   # Klick auf "Generate Credentials" falls noch nicht vorhanden
   # Verwende: Username + Password aus dem Portal

   git push azure master
   ```

   **Wichtig:** Beim ersten `git push` wirst du nach Username und Password gefragt:
   - **Username:** Aus dem Azure Portal (Deployment Center → Local Git)
   - **Password:** Das generierte Deployment-Password (nicht dein Azure-Passwort!)

   **Credentials finden:**
   1. Azure Portal → Deine Web App → **Deployment Center**
   2. **Quelle:** Local Git
   3. **Lokale Git/FTPS-Anmeldeinformationen** → **Benutzerbereich**
   4. Hier findest du Username und kannst ein Password generieren

5. **Logs prüfen:**
   - Portal → Web App → **Log Stream**

6. **Testen:**
   ```bash
   # Verwende die vollständige URL deiner Web App (inkl. Region)
   curl https://[deine-app-name].[region].azurewebsites.net/api/health
   # Beispiel: curl https://toolhub-backend-b2apccbyf0gmcqap.germanywestcentral-01.azurewebsites.net/api/health
   ```

   **URL finden:**
   - Azure Portal → Web App → Übersicht → **URL** (vollständige URL mit Region)

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
    DB_HOST=db-toolhub.postgres.database.azure.com \
    DB_PORT=5432 \
    DB_NAME=toolhub \
    DB_USER=toolhub \
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

Das Frontend liest nur die URL der Backend‑API zur Laufzeit (z.B. `API_URL`). Sensible Werte wie Admin‑Passwörter oder Datenbank‑Zugangsdaten müssen ausschließlich in der Backend‑Web‑App als Anwendungseinstellungen gesetzt werden.

- Frontend: Setze in der Frontend‑Web‑App nur die öffentliche API‑URL.
   - Azure Portal → Deine Frontend Web App → **Konfiguration** → **Anwendungseinstellungen**
   - Beispiel:
      ```
      Name: API_URL
      Wert: https://toolhub-backend-b2apccbyf0gmcqap.germanywestcentral-01.azurewebsites.net/api
      ```

- Backend: Setze alle sensiblen Variablen (DB_*, ADMIN_PASSWORD, etc.) in der Backend‑Web‑App (siehe Abschnitt 3).

**Sicherheitshinweis:** Speichere Passwörter niemals im Frontend‑Code oder in statischen Dateien. Das Frontend darf nur nicht‑sensible Konfiguration (z.B. API Endpoints) erhalten; die Verifikation von Admin‑Rechten MUSS serverseitig erfolgen (z.B. `/api/admin/auth`).

### Frontend auf Azure Web App deployen

Wir verwenden für Frontend und Backend die gleichen Deploy‑Methoden, damit die Entwicklerführung einheitlich ist.

Option A — Portal (Lokales Git / Deployment Center)

1. Azure Portal → **App Services** → **+ Erstellen**.
2. Wähle Subscription, Resource Group `rg-toolhub`, Name `toolhub-frontend`, Runtime **Node 18 LTS**, OS **Linux**, Region **West Europe**, Plan (z.B. F1 für Test).
3. Nach Erstellen: Öffne **Deployment Center** → **Local Git** (oder Deployment Option deiner Wahl).
4. Kopiere die angezeigte Git‑URL (z. B. https://<app>.scm.azurewebsites.net/<app>.git).
5. Lokales Deployment (im `frontend/` Ordner):
    ```bash
    cd frontend/
    git init
    git add .
    git commit -m "Deploy frontend"
    git remote add azure <GIT_URL_AUS_PORTAL>
    git push azure master
    ```

Hinweis: Alternativ kannst du im Deployment Center auch ZIP/FTPS Upload wählen und die `frontend` Dateien als ZIP hochladen.

Option B — CLI (ZIP Deploy)

1. Erstelle die Web App via CLI (falls noch nicht vorhanden):
    ```bash
    az webapp up \
       --resource-group rg-toolhub \
       --name toolhub-frontend \
       --runtime "NODE:18-lts" \
       --sku F1 \
       --location westeurope
    ```
2. Packe die `frontend` Dateien und deploye per ZIP:
    ```bash
    cd frontend/
    zip -r ../frontend.zip .
    az webapp deployment source config-zip \
       --resource-group rg-toolhub \
       --name toolhub-frontend \
       --src ../frontend.zip
    ```

Nach Deploy: Setze `API_URL` in der Frontend App Settings (Portal → Konfiguration) oder per CLI:
```bash
az webapp config appsettings set \
   --resource-group rg-toolhub \
   --name toolhub-frontend \
   --settings API_URL=https://toolhub-backend-b2apccbyf0gmcqap.germanywestcentral-01.azurewebsites.net/api
```

Manuelles Redeploy / Troubleshooting
- Portal: App Service → **Deployment Center** → Logs / Redeploy
- CLI: Re-run ZIP deploy und prüfe `az webapp log tail` für Logs


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
     --name db-toolhub
   ```

2. **Azure Services erlauben:**
   ```bash
   az postgres flexible-server firewall-rule create \
     --resource-group rg-toolhub \
     --name db-toolhub \
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
