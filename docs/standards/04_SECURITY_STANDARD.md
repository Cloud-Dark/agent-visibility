# Security Standard
> Status: Final
> Last updated: 2026-10-06

Security rules for local bind, webhooks, and secrets.

## Checklist

- [ ] Default bind stays `127.0.0.1`
- [ ] Warn before using `0.0.0.0` on untrusted networks
- [ ] Validate every webhook URL before storing or posting
- [ ] Never log or commit secrets
- [ ] Keep runtime state out of git

## Bind address

- Default host is `127.0.0.1` (localhost only).
- `AGENT_MONITOR_HOST` or `--host` may set `0.0.0.0` or a specific LAN IP.
- `0.0.0.0` exposes the dashboard with no auth, so use it only on trusted LANs.
- Health and agent APIs must report the active host and `lan_ips` when bound to `0.0.0.0`.

## Webhook URL validation

- Accept only `http://` or `https://` URLs.
- Reject localhost bypass tricks, empty strings, and non URL input.
- Cap stored webhooks at a sane limit and dedupe identical URLs.
- POST with a short timeout and never retry in the request path.
- A failing webhook must not break recording or broadcasting.

## Secret handling

- No tokens, keys, or passwords in code, logs, or `state.json`.
- Config via env vars (`AGENT_MONITOR_HOST`, `AGENT_MONITOR_PORT`).
- Runtime dir `%TEMP%/claude-agent-monitor/` is gitignored.
- When reporting issues, redact URLs that contain credentials.

## Notes

- There is no auth layer in v0.2.0 by design for local use.
- Any future LAN or public exposure requires auth first.
