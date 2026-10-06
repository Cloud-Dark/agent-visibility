# Configuration Reference

> Status: Final
> Last updated: 2026-10-06

## Contents

- [Environment variables](#environment-variables)
- [CLI flags](#cli-flags)
- [state.json schema](#statejson-schema)
- [server.json schema](#serverjson-schema)
- [REST endpoints](#rest-endpoints)
- [MCP tools](#mcp-tools)
- [Hook matcher](#hook-matcher)

## Environment variables

| Variable | Default | Used by | Meaning |
|----------|---------|---------|---------|
| `AGENT_MONITOR_PORT` | `9761` | `lib/store.js`, `server.js` | Preferred port. `ensure-server.js` passes the resolved port through when spawning the server. Non numeric values fall back to 9761. |
| `AGENT_MONITOR_HOST` | `127.0.0.1` | `lib/store.js`, `ensure-server.js`, `server.js` | Bind address. `127.0.0.1` means local only, `0.0.0.0` means all interfaces with LAN IP display, or one specific interface address. |
| `TEMP` / `TMP` | OS temp dir | `lib/store.js` | Base directory for the `claude-agent-monitor` runtime folder. Falls back to `os.tmpdir()` when neither is set. |

## CLI flags

| Command | Flag | Meaning |
|---------|------|---------|
| `node hooks/ensure-server.js` | `--quiet` | Write only to `monitor.log`; print nothing to the terminal. Used by the `UserPromptSubmit` watchdog. |
| `node server.js` | `--host <addr>` | Override the bind address for one run. When the flag is present, the next argument is used, or the default host when missing. |

## state.json schema

Location: `<temp>/claude-agent-monitor/state.json`. Written atomically via temp file plus rename.

```json
{
  "agents": {
    "<agent_id>": {
      "agent_id": "abc",
      "agent_type": "Explore",
      "status": "running",
      "started_at": "2026-10-06T14:00:00.000Z",
      "stopped_at": null,
      "transcript": null,
      "model": null,
      "last_activity_at": "2026-10-06T14:01:00.000Z",
      "last_summary": "Read path/to/file",
      "stale": false,
      "activity": [{ "ts": "...", "tool": "Read", "summary": "Read path/to/file" }],
      "files_touched": ["path/to/file"]
    }
  },
  "events": [{ "ts": "...", "type": "spawn", "agent_id": "abc", "agent_type": "Explore" }],
  "webhooks": ["https://example.com/hook"],
  "transports": { "webhook": true, "sse": true, "socketio": true },
  "updated_at": "2026-10-06T14:01:00.000Z"
}
```

Notes from source:

- `status` is `running` or `done`. `stale` is a boolean set by the server poll.
- `events[].type` is `spawn` or `stop`. At most 200 events are kept.
- `activity` keeps at most 50 entries per agent; `files_touched` keeps at most 30 distinct paths per agent.
- Missing `agents`, `events`, or `webhooks` fields are defaulted on load; `transports` merges over all true defaults.
- `transcript` comes from hook fields `transcript_path` or `transcriptPath`; `model` from hook field `model`. Both may be null.

## server.json schema

Location: `<temp>/claude-agent-monitor/server.json`. Written by `ensure-server.js`.

```json
{
  "pid": 1234,
  "port": 9761,
  "host": "127.0.0.1",
  "started_at": "2026-10-06T14:00:00.000Z",
  "checked_at": "2026-10-06T14:05:00.000Z"
}
```

`checked_at` is written on the reuse path. `started_at` records when the entry was created or adopted.

## REST endpoints

Base URL defaults to `http://127.0.0.1:9761`.

| Method and path | Request | Response |
|-----------------|---------|----------|
| `GET /` | none | Dashboard HTML page |
| `GET /__health` | none | `{ monitor, port, host, pid, started_at }` with `monitor` equal to `claude-agent-monitor` |
| `GET /api/agents` | none | `{ server, webhooks, transports, agents }`. `server` holds `port`, `host`, `lan_ips`, `pid`, `started_at`, `state_updated_at`, `socketio`, `transports`. Agents are sorted newest start first. |
| `GET /api/events?limit=50` | `limit` default 50, max 200 | `{ events }` newest first |
| `GET /api/stream` | none | `text/event-stream`: a `connected` line, then one `data:` line per event, plus `: ping` every 15 seconds. Returns 403 when the `sse` transport is off. |
| `GET /api/transports` | none | `{ transports: { webhook, sse, socketio } }` |
| `POST /api/transports` | Any subset of `{ webhook, sse, socketio }` booleans | `{ transports }` with the merged flags |
| `GET /api/webhooks` | none | `{ webhooks }` |
| `POST /api/webhooks` | `{ url }` starting with `http://` or `https://` | `{ webhooks }`; 400 on invalid URL |
| `DELETE /api/webhooks` | `{ url }` | `{ webhooks }` after removal |

Socket.io (when installed): connect with a socket.io v4 client. Server emits `hello` with `{ monitor, ts }` on connect and `agent-event` with `{ event, ts, agent }` per new event.

## MCP tools

MCP server name: `agent-monitor`. Command: `node ${PLUGIN_ROOT}/mcp-server.js`. Protocol version: `2024-11-05`. Server info reports name `agent-monitor`, version `0.1.0`.

| Tool | Input | Output |
|------|-------|--------|
| `agents_list` | `{ status?: all \| running \| done }` | `{ agents, count }` |
| `agents_get` | `{ agent_id }` required | `{ agent }`; errors on unknown id |
| `monitor_status` | none | `{ port, pid, started_at, state_updated_at, running, done, webhooks }` |
| `events_recent` | `{ limit? }` default 20, max 200 | `{ events }` newest first |
| `webhook_add` | `{ url }` required, must start with `http(s)://` | `{ webhooks }` |
| `webhook_list` | none | `{ webhooks }` |
| `webhook_remove` | `{ url }` required | `{ webhooks }` |
| `transports_get` | none | `{ transports }` |
| `transports_set` | Any subset of `{ webhook, sse, socketio }` booleans | `{ transports }` |

That is 9 tools: `agents_list`, `agents_get`, `monitor_status`, `events_recent`, `webhook_add`, `webhook_list`, `webhook_remove`, `transports_get`, `transports_set`.

## Hook matcher

The `PostToolUse` hook in `hooks.json` matches these tools: `Read|Write|Edit|Bash|Glob|Grep|Task|TodoWrite|WebFetch|WebSearch`. `activity.js` additionally ignores `SendMessage` and `Artifact` tool names and ignores any payload without an agent id.
