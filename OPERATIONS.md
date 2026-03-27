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

## Orchestrierung / längere Läufe
Wenn mehrere Issues oder delegierte Teilaufgaben koordiniert werden, ist `.local/orchestrator-state.md` der primäre lokale Zustandsanker.
