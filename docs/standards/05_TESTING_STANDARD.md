# Testing Standard
> Status: Final
> Last updated: 2026-10-06

Manual test procedure. There is no automated suite yet.

## Checklist

- [ ] `node --check` passes on every changed JS file
- [ ] PowerShell spawn test records test agents
- [ ] REST, SSE, and socket.io checks pass
- [ ] Hook quiet mode verified (no extra terminal output)
- [ ] Results noted in the PR description

## 1. Syntax check

Run for each changed file:

```powershell
node --check plugins/agent-monitoring/server.js
node --check plugins/agent-monitoring/mcp-server.js
node --check plugins/agent-monitoring/hooks/ensure-server.js
node --check plugins/agent-monitoring/hooks/record.js
node --check plugins/agent-monitoring/hooks/activity.js
node --check plugins/agent-monitoring/lib/store.js
```

All must exit 0.

## 2. PowerShell spawn test

```powershell
$env:AGENT_MONITOR_PORT='9761'
Start-Process node -ArgumentList 'plugins\agent-monitoring\server.js' -WindowStyle Hidden
Start-Sleep 3
1..5 | % { (@{agent_id="test-agent-$_"; agent_type="Explore"} | ConvertTo-Json -Compress) | node 'plugins\agent-monitoring\hooks\record.js' start }
Invoke-RestMethod http://127.0.0.1:9761/api/agents | Select-Object -ExpandProperty agents | Format-Table agent_id, agent_type, status
```

Expected: 5 test agents listed as running.

## 3. Endpoint checks

```powershell
Invoke-RestMethod http://127.0.0.1:9761/__health
Invoke-RestMethod http://127.0.0.1:9761/api/transports
Invoke-RestMethod "http://127.0.0.1:9761/api/events?limit=5"
curl.exe -N http://127.0.0.1:9761/api/stream
```

Expected:

- Health returns monitor name, port, host, and pid.
- Transports show webhook, SSE, and socket.io status.
- SSE prints `data:` lines plus `: ping` heartbeats.

## 4. socket.io check (optional dependency)

```powershell
npm ls socket.io --prefix plugins/agent-monitoring
```

If installed, connect a v4 client and confirm `hello` and `agent-event` messages arrive.

## 5. Cleanup

Remove test state after testing:

```powershell
Remove-Item "$env:TEMP\claude-agent-monitor\state.json" -Force
```

## Notes

- No test framework and no build step in v0.2.0.
- If a change cannot be tested manually, say so in the PR.
