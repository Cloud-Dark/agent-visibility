# Code Standard
> Status: Final
> Last updated: 2026-10-06

Node.js style used in this repo (server core, hooks, MCP server).

## Checklist

- [ ] Add `'use strict'` at the top of every JS file
- [ ] Keep server core dependency free (only socket.io is optional)
- [ ] Never let a hook throw or block the session
- [ ] Use plain CommonJS (`require`) and Node.js builtins
- [ ] Handle port conflicts with the existing fallback rule

## Style

- Target Node.js 18 or newer.
- CommonJS only: `require` and `module.exports`.
- Start each file with `'use strict';`.
- Two space indent, semicolons, double quotes preferred.
- Small functions with one job (record, broadcast, store, route).
- Log to `%TEMP%/claude-agent-monitor/monitor.log`, not to stdout, except the one line startup message.

## Server core

- `server.js`, `mcp-server.js`, and `lib/store.js` must run with plain Node.js and no install step.
- socket.io is the only exception and must stay optional with a graceful fallback message.
- REST routes return JSON with proper status codes.
- SSE endpoint sends `: ping` heartbeat every 15 seconds.

## Hooks (never block a session)

- Hook scripts (`ensure-server.js`, `record.js`, `activity.js`) must exit fast with code 0.
- Wrap all hook logic in try/catch and swallow errors after logging.
- `UserPromptSubmit` watchdog runs quiet (no terminal output).
- Server reuse rule: reuse a healthy server, restart only when the pid file points to a dead process.
- `PostToolUse` records only the matched tools listed in `hooks.json`.

## Paths and state

- Runtime files live under `%TEMP%/claude-agent-monitor/` and are never committed.
- Read shared state through `lib/store.js`, never with ad hoc file parsing.
