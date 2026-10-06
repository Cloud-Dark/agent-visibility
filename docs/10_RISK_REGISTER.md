# Risk Register
> Status: Final
> Last updated: 2026-10-06

Risks for plugin agent-monitoring v0.2.0.

| Risk | Likelihood | Impact | Mitigation | Owner |
|------|------------|--------|------------|-------|
| Port conflicts with other local apps on 9761 | Medium | Low | Automatic fallback to 9762 and above, health check detects owner via GET /__health, terminal prints actual URL | Maintainer |
| LAN exposure without auth when bound to 0.0.0.0 | Medium | High | Default stays 127.0.0.1, README warns against untrusted networks, planned auth token for LAN mode | Maintainer |
| state.json growth from agents and events | Medium | Low | Cap activity at 50 items per agent, event query limit max 200, manual cleanup documented in troubleshooting | Maintainer |
| Hook data limits for PostToolUse payloads | Low | Medium | Record compact tool summaries only, skip main session calls without agent_id, ignore transient read errors | Maintainer |
| socket.io dependency issues | Low | Low | Optional dependency pattern with try/catch, REST plus SSE plus webhook work with plain Node.js, npm install documented | Maintainer |
