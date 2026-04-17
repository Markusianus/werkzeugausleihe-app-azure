# OPERATIONS.md

## Zweck
Operative Sicht auf ToolHub: URLs, Prüfungen, typische Verifikation und Betriebsnotizen.

## Betriebsmodell
ToolHub besteht aus getrenntem Backend und Frontend.

- Backend: API / Datenbanklogik
- Frontend: UI / statische Auslieferung mit kleinem Host

## Lokale Schnellchecks
### Backend lokal
- Healthcheck: `http://localhost:3000/api/health`

### Frontend lokal
- Frontend lokal starten und API-Anbindung prüfen

## Umgebungsvariablen (Azure App Service)

| Variable | Staging | Prod | Zweck |
|---|---|---|---|
| `IS_STAGING_INSTANZ` | `true` | _(nicht gesetzt)_ | Steuert Staging-Banner im Frontend |
| `TEAMS_AUSLEIHEN_WEBHOOK_URL` | _(gesetzt)_ | _(gesetzt)_ | Teams-Benachrichtigung bei neuer Ausleihe |

Wenn `IS_STAGING_INSTANZ=true`, ruft das Frontend `/api/config` ab und zeigt einen lila Banner oben in der App an: **„DEV — Dies ist die Testumgebung"**.  
In Produktion ist die Variable nicht gesetzt → Banner bleibt unsichtbar.

## Cloud-/Staging-Prinzipien
- Staging-Deploys erfolgen per `scripts/deploy-staging.sh`
- Das Skript lädt standardmäßig `.local/staging.env`; Shell-Variablen bleiben als Override möglich
- Region-spezifische Azure-Hosts sind als funktionierende Ziel-URLs zu bevorzugen
- Kurze generische `*.azurewebsites.net`-Namen waren in der Vergangenheit nicht immer zuverlässig

## Verifikation nach Deploy
Nicht nur HTTP-Status prüfen, sondern zusätzlich fachliche Marker.

Beispiele für fachliche Marker:
- UI lädt vollständig
- Dashboard-Kacheln / Stats sichtbar
- Bearbeiten-Flow speichert Status korrekt
- QR-/`?tool=`-Deep-Link öffnet die Detailansicht
- relevante Admin-Funktionen reagieren wie erwartet

## Bekannte operative Lektionen
- Ein technisch erfolgreicher Deploy ist nicht automatisch ein inhaltlich richtiger Staging-Stand
- Vor jedem Deploy muss der gewünschte Integrationsstand bewusst hergestellt werden
- Backend kann nach Deploy ggf. einen zusätzlichen Blick auf Health / Neustart brauchen
- Bei ToolHub ist der Begriff **Admin** fachlich mehrdeutig; in UI-/Fehlertexten soll für App-Berechtigungen möglichst **Tool-Admin** verwendet werden, um Verwechslungen mit System-/Betriebsadmin zu vermeiden
- Beim Dateiimport sind kopierbare, feldgenaue Fehlermeldungen im Dialog wertvoller als Browser-Alert-Popups
- Import-Vorabvalidierung sollte möglichst nah an der Server-Validierung liegen, damit Nutzer Fehler früh und verständlich sehen

## Orchestrierung / längere Läufe
Wenn mehrere Issues oder delegierte Teilaufgaben koordiniert werden, ist `.local/orchestrator-state.md` der primäre lokale Zustandsanker.
