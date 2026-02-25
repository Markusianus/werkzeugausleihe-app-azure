# 🔨 ToolHub - Azure Edition

**Enterprise-ready Werkzeugausleihe mit PostgreSQL Backend**

Version 4.0 - Cloud Edition

---

## 📁 Projektstruktur

```
werkzeugausleihe-app-azure/
├── backend/                    # Node.js + Express API
│   ├── server.js              # Hauptserver mit API-Endpunkten
│   ├── init-db.js             # Datenbank-Initialisierung
│   ├── package.json           # Dependencies
│   ├── .env.example           # Umgebungsvariablen-Vorlage
│   ├── .gitignore
│   └── web.config             # Azure Deployment Config
│
├── frontend/                   # Static HTML/CSS/JS
│   ├── index.html             # UI (ohne sql.js!)
│   ├── app.js                 # API-Integration
│   └── config.js              # API-Konfiguration
│
├── AZURE_DEPLOYMENT.md        # 🚀 Komplette Deployment-Anleitung
├── QUICKSTART.md              # ⚡ 5-Minuten Schnellstart
└── README.md                  # Diese Datei
```

---

## 🎯 Was ist neu?

### Vorher (Original v4.0)
- ❌ SQLite im Browser (sql.js)
- ❌ localStorage (nur lokal)
- ❌ Single-User
- ❌ Keine zentrale Datenbank

### Jetzt (Azure Edition)
- ✅ PostgreSQL auf Azure
- ✅ REST API (Node.js + Express)
- ✅ Multi-User ready
- ✅ Zentrale Datenbank
- ✅ Skalierbar
- ✅ Production-ready
- ✅ Foto-Upload (Base64)
- ✅ CSV-Export

---

## 🚀 Quick Start

### 1. Backend lokal testen

```bash
cd backend/
npm install
cp .env.example .env
# .env mit deinen Azure PostgreSQL Credentials ausfüllen
npm run init-db
npm start
```

→ API läuft auf [http://localhost:3000](http://localhost:3000/api/health)

### 2. Frontend öffnen

```bash
cd ../frontend/
python3 -m http.server 8080
```

→ Frontend: [http://localhost:8080](http://localhost:8080)

### 3. Auf Azure deployen

Folge der Anleitung in **[AZURE_DEPLOYMENT.md](AZURE_DEPLOYMENT.md)**

---

## 🔌 API-Endpunkte

### Health & Stats
```
GET  /api/health                # Health Check
GET  /api/stats                 # Dashboard-Statistiken
```

### Werkzeuge
```
GET    /api/werkzeuge           # Alle Werkzeuge (optional: ?kategorie=...&search=...)
GET    /api/werkzeuge/:id       # Einzelnes Werkzeug
POST   /api/werkzeuge           # Neues Werkzeug erstellen
PUT    /api/werkzeuge/:id       # Werkzeug aktualisieren
DELETE /api/werkzeuge/:id       # Werkzeug löschen
```

### Ausleihen
```
GET    /api/ausleihen           # Alle Ausleihen (optional: ?status=...)
GET    /api/ausleihen/:id       # Einzelne Ausleihe
POST   /api/ausleihen           # Neue Reservierung
PATCH  /api/ausleihen/:id/ausgeben   # Ausgeben
PATCH  /api/ausleihen/:id/rueckgabe  # Rückgabe
DELETE /api/ausleihen/:id       # Ausleihe löschen
```

### Schäden
```
GET    /api/schaeden            # Alle Schäden (optional: ?status=...)
POST   /api/schaeden            # Schaden melden
PATCH  /api/schaeden/:id/beheben  # Schaden beheben
DELETE /api/schaeden/:id        # Schaden löschen
```

### Export
```
GET /api/export/werkzeuge       # CSV-Export
```

---

## 📊 Datenbank-Schema

### werkzeuge
Alle Werkzeuge mit Status & Kategorien

**Felder:** name, icon, beschreibung, inventarnummer, zustand, foto, status, kategorie, lagerplatz

**Status:** verfuegbar, reserviert, ausgeliehen, defekt, reinigung, reparatur

### ausleihen
Reservierungen & Ausleihen

**Felder:** werkzeug_id, mitarbeiter_name, datum_von, datum_bis, status, ...

**Status:** reserviert → ausgeliehen → zurueckgegeben

### schaeden
Schadensmeldungen

**Felder:** werkzeug_id, mitarbeiter_name, beschreibung, foto, status

**Status:** offen → behoben

---

## ✨ Features

### **Mitarbeiter:**
- 📦 Werkzeug-Katalog mit Suche & Kategorien
- 🛒 Warenkorb-System
- 📅 Zeitraum-Auswahl
- 🔧 Schadensmeldung mit Foto

### **Admin:**
- 📊 Dashboard mit Live-Statistiken
- ➕ Werkzeuge verwalten
- 🏷️ Kategorien (Elektro, Hand, Garten, Mess, Sicherheit, etc.)
- 📱 QR-Code-Generator
- 📄 CSV-Import/Export
- ✅ Reservierungen bestätigen & ausgeben
- ↩️ Rückgaben dokumentieren
- 🔧 Schadensmeldungen verwalten
- ⚠️ Überfälligkeits-Tracking

---

## 🔒 Sicherheit

### Aktuell (MVP)
- SSL/TLS für DB-Verbindung
- HTTPS für Web Apps (Azure Standard)
- Firewall-Regeln für DB
- Admin-Passwort (Basic Auth)

### TODO für Production
- [ ] JWT-Authentifizierung
- [ ] Benutzer-Rollen (Admin, Mitarbeiter, Gast)
- [ ] Input-Validierung (joi)
- [ ] Rate Limiting
- [ ] SQL Injection Protection (✅ parametrisierte Queries)
- [ ] CSRF Protection
- [ ] Audit Logging
- [ ] File-Upload Limits & Validierung

---

## 💰 Kosten

**Test-Setup:**
- PostgreSQL B1ms: ~10 EUR/Monat
- Web App F1 (Free): 0 EUR
- **Total: ~10 EUR/Monat**

**Production-Setup:**
- PostgreSQL D2s_v3: ~80 EUR/Monat
- Web App B1: ~12 EUR/Monat
- **Total: ~92 EUR/Monat**

---

## 🛠 Development

### Lokale Entwicklung

**Backend:**
```bash
cd backend/
npm install
npm run dev  # Mit nodemon (auto-reload)
```

**Frontend:**
```bash
cd frontend/
python3 -m http.server 8080
```

### Testing

```bash
# Health Check
curl http://localhost:3000/api/health

# Neues Werkzeug
curl -X POST http://localhost:3000/api/werkzeuge \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Testgerät",
    "inventarnummer": "TEST-001",
    "kategorie": "Test",
    "icon": "🔧"
  }'

# Alle Werkzeuge
curl http://localhost:3000/api/werkzeuge
```

---

## 🎯 Roadmap

### Phase 1: MVP ✅
- Backend API
- PostgreSQL Migration
- Azure Deployment
- Basis-Features

### Phase 2: Production 🚧
- [ ] JWT-Authentifizierung
- [ ] Benutzer-Verwaltung
- [ ] E-Mail-Benachrichtigungen
- [ ] Push-Notifications (Überfälligkeit)
- [ ] Wartungsintervalle
- [ ] Mehrfach-Werkzeuge (Bestand)

### Phase 3: Enterprise 🔮
- [ ] LDAP/AD Integration
- [ ] Barcode-Scanner
- [ ] Mobile App (React Native)
- [ ] Kalenderansicht
- [ ] PDF-Export (QR-Etiketten)
- [ ] Dark Mode
- [ ] Multi-Tenant

---

## 📞 Support

**Fragen?** → Morpheus fragen! 💊

---

## 📄 Lizenz

MIT License - frei nutzbar!

---

**Version:** 4.0.0 (Azure Edition)  
**Letzte Aktualisierung:** Februar 2026  
**Status:** Ready for Deployment 🚀

**Entwickelt mit ❤️ und AI 💊**
