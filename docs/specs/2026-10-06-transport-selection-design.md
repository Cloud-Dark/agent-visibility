# Spec: Transport Selection Design
> Status: Final
> Last updated: 2026-10-06

## Goal

Let the user pick which of the three outbound channels are active: webhook, SSE stream, and socket.io. All three are on by default.

## Design

Three independent boolean flags live in `state.json` under `transports`:

```json
{ "webhook": true, "sse": true, "socketio": true }
```

Behavior per flag:

* webhook false: spawn and stop events are still recorded locally but no outbound POST is sent.
* sse false: `GET /api/stream` returns 403 with `sse transport disabled`, and the server poll loop skips broadcast.
* socketio false: the socket.io server still accepts connections but no `agent-event` payloads are emitted.

The server poll loop in `server.js` checks state every second, picks up fresh events written by `hooks/record.js`, and broadcasts to SSE clients plus socket.io. When both sse and socketio are off it only advances the event cursor.

## API Schema

`GET /api/transports` returns:

```json
{ "transports": { "webhook": true, "sse": true, "socketio": true } }
```

`POST /api/transports` accepts any subset of boolean fields:

```json
{ "webhook": true, "sse": false, "socketio": true }
```

Unknown fields are ignored. Response echoes the merged transport object.

## MCP Tools

* `transports_get`: returns the current on/off status of the three transports.
* `transports_set`: accepts the same partial boolean object as `POST /api/transports` and persists it to state.

## Dashboard Pills

The Connection section shows three pill buttons: webhook, SSE stream, socket.io. Each pill shows a check mark when on and a cross when off. Clicking a pill flips that flag via `POST /api/transports` and reloads the dashboard. The SSE address and socket.io status line sit below the pills.
