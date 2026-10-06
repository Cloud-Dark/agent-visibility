# Developer Setup - Agent Monitoring Plugin

> Status: Final
> Last updated: 2026-10-06

## Contents

- [1. Prerequisites](#1-prerequisites)
- [2. Clone](#2-clone)
- [3. Install optional socket.io](#3-install-optional-socketio)
- [4. Manual server run](#4-manual-server-run)
- [5. Manual hook tests](#5-manual-hook-tests)
- [6. Validation](#6-validation)

## 1. Prerequisites

- Node.js 18 or higher.
- PowerShell on Windows (commands below use PowerShell syntax).
- A Claude Code session for hook-driven runs; manual runs below work without one.

## 2. Clone

```powershell
git clone https://github.com/Cloud-Dark/agent-visibility.git
cd agent-visibility
```

Plugin code lives in plugins/agent-monitoring.

## 3. Install optional socket.io

REST, SSE, and webhook paths need no dependencies. Only socket.io needs an install:

```powershell
cd plugins/agent-monitoring
npm install
```

## 4. Manual server run

```powershell
$env:AGENT_MONITOR_PORT = '9761'
Start-Process node -ArgumentList 'plugins\agent-monitoring\server.js' -WindowStyle Hidden
Start-Sleep 3
Invoke-RestMethod http://127.0.0.1:9761/__health
```

For LAN access during development:

```powershell
node plugins/agent-monitoring/server.js --host 0.0.0.0
```

Runtime files land in %TEMP%/claude-agent-monitor: state.json, server.json, monitor.log.

## 5. Manual hook tests

Record spawn and stop without spawning real agents (PowerShell):

```powershell
$env:AGENT_MONITOR_PORT = '9761'
1..5 | % { (@{agent_id="test-agent-$_"; agent_type="Explore"} | ConvertTo-Json -Compress) | node 'plugins\agent-monitoring\hooks\record.js' start }
Invoke-RestMethod http://127.0.0.1:9761/api/agents | % agents | ft agent_id, agent_type, status
```

Test the activity hook with piped PostToolUse style JSON:

```powershell
(@{agent_id="test-agent-1"; tool_name="Read"; tool_input=@{file_path="server.js"}} | ConvertTo-Json -Compress -Depth 5) | node 'plugins\agent-monitoring\hooks\activity.js'
```

Test the server watchdog in quiet mode:

```powershell
node 'plugins\agent-monitoring\hooks\ensure-server.js' --quiet
```

## 6. Validation

Syntax check each JS file:

```powershell
node --check plugins/agent-monitoring/server.js
node --check plugins/agent-monitoring/mcp-server.js
node --check plugins/agent-monitoring/hooks/ensure-server.js
node --check plugins/agent-monitoring/hooks/record.js
node --check plugins/agent-monitoring/hooks/activity.js
node --check plugins/agent-monitoring/lib/store.js
```

Validate plugin manifests:

```powershell
claude plugin validate plugins/agent-monitoring
```

To reset local runtime data during development, delete %TEMP%/claude-agent-monitor/state.json or the whole folder.
