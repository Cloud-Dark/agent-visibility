# Installation

> Status: Final
> Last updated: 2026-10-06

## Contents

- [Prerequisites](#prerequisites)
- [Install from GitHub marketplace](#install-from-github-marketplace)
- [Verify](#verify)
- [LAN access](#lan-access)
- [Update](#update)
- [Uninstall](#uninstall)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- Node.js 18 or newer.
- Claude Code with plugin support and a new session to activate `SessionStart` hooks.
- No mandatory npm dependencies. REST, SSE, and webhooks run on plain Node.js. socket.io works after running `npm install` in `plugins/agent-monitoring/` (its `package.json` declares `socket.io ^4.8.1`).

## Install from GitHub marketplace

Run once in PowerShell:

```powershell
# 1. Register the marketplace from GitHub (once)
claude plugin marketplace add Cloud-Dark/agent-visibility

# 2. Install the plugin
claude plugin install agent-monitoring@agentmonitoring
```

Then start a new Claude Code session. The `SessionStart` hook starts the server automatically and the terminal prints one line:

```text
agent-monitor: dashboard at http://127.0.0.1:9761
```

Open that URL in a browser. Nothing needs to be started by hand. If the port is taken by another application, the server moves to 9762, 9763, and so on, and the printed URL shows the actual port.

## Verify

1. Open the dashboard URL from the terminal. Agent cards, connection pills, live stream, recent events, and webhooks sections should render.
2. Check the health endpoint:

```powershell
Invoke-RestMethod http://127.0.0.1:9761/__health
```

It returns `monitor` equal to `claude-agent-monitor` with the port, host, and pid.

3. List agents (empty before any subagent runs):

```powershell
Invoke-RestMethod http://127.0.0.1:9761/api/agents
```

4. Optional synthetic check without spawning a real agent:

```powershell
$env:AGENT_MONITOR_PORT='9761'
Start-Process node -ArgumentList 'plugins\agent-monitoring\server.js' -WindowStyle Hidden
Start-Sleep 3
1..5 | % { (@{agent_id="test-agent-$_"; agent_type="Explore"} | ConvertTo-Json -Compress) | node 'plugins\agent-monitoring\hooks\record.js' start }
Invoke-RestMethod http://127.0.0.1:9761/api/agents | % agents | ft agent_id, agent_type, status
```

5. Confirm the runtime files exist under `%TEMP%/claude-agent-monitor/`: `state.json`, `server.json`, and `monitor.log`.

## LAN access

The default bind is localhost only. To open the dashboard from another device on the same network:

```powershell
# stored for all later sessions
claude plugin configure agent-monitoring@agentmonitoring
```

Or set the environment variable:

```powershell
$env:AGENT_MONITOR_HOST = "0.0.0.0"
```

For a single run: `node server.js --host 0.0.0.0`. The dashboard header then shows a Network URL with the LAN IP. Do not use `0.0.0.0` on a public or untrusted network because there is no authentication.

## Update

```powershell
claude plugin update agent-monitoring@agentmonitoring
```

Then start a new session so the updated hooks take effect.

## Uninstall

_TBD_. No uninstall steps are stated in the files read. Removing the plugin registration and deleting the runtime directory `%TEMP%/claude-agent-monitor/` clears local state, but the exact supported removal command is not defined in source.

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| Dashboard does not load | Check `%TEMP%/claude-agent-monitor/monitor.log`. Start a new session so `SessionStart` runs; the next prompt also retriggers the watchdog. |
| Port 9761 is used by another app | The server moves up automatically (9762 and above). Use the URL printed in the terminal. |
| Agents are not recorded | The `SubagentStart` hook needs a new session after install or update. |
| Activity is empty | `PostToolUse` records only the matched tool set, and the main session without an agent id is not tracked. |
| socket.io reports not installed | Run `npm install` in `plugins/agent-monitoring/`. |
| Old data piles up | Delete `%TEMP%/claude-agent-monitor/state.json` or the whole runtime folder. |
