# Blueprint: agent-monitoring
> Status: Final
> Last updated: 2026-10-06

## What the Plugin Is

Plugin agent-monitoring v0.2.0 tracks running Claude Code subagents through a local web dashboard, a JSON API, three selectable transports, and MCP tools that let Claude report on its own agents. The server auto starts on every session and records spawn, activity, and stop events into shared state.

## Repo Map

* `README.md`: user facing docs, install, API, troubleshooting
* `plugins/agent-monitoring/server.js`: dashboard plus REST plus SSE plus socket.io
* `plugins/agent-monitoring/mcp-server.js`: 9 MCP tools over stdio
* `plugins/agent-monitoring/hooks/`: `hooks.json`, `ensure-server.js`, `record.js`, `activity.js`
* `plugins/agent-monitoring/lib/store.js`: state.json persistence, webhook POST, server info
* `.claude-plugin/marketplace.json`: GitHub marketplace manifest
* `docs/`: numbered docs plus plans, specs, and UAT records

## How Pieces Connect

Claude Code hooks drive the server. SessionStart and UserPromptSubmit run `ensure-server.js`, which starts `server.js` as a detached daemon with smart port fallback. SubagentStart and SubagentStop run `record.js`, which writes spawn and stop events to `state.json` and triggers webhook POST plus SSE and socket.io broadcast. PostToolUse runs `activity.js`, which appends compact tool summaries per agent with a 50 item cap. Dashboard, REST, SSE, socket.io, and MCP all read the same `state.json`.

## Pointer to Numbered Docs

* `docs/08_ROADMAP.md`: release history and planned work
* `docs/10_RISK_REGISTER.md`: risks and mitigations
* `docs/plans/2026-10-06-github-marketplace-migration.md`: marketplace migration record
* `docs/specs/2026-10-06-transport-selection-design.md`: transport design
* `docs/specs/2026-10-06-per-agent-activity-checklist.md`: activity checklist
* `docs/uat/2026-10-06_five-agent-spawn-test.md`: five agent spawn UAT
