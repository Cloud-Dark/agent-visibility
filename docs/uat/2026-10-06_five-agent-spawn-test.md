# UAT: Five Agent Spawn Test
> Status: Final
> Last updated: 2026-10-06

Manual user acceptance test for plugin agent-monitoring v0.2.0, run without spawning real subagents. Result: PASS.

## Scenario Table

| Step | Action | Expected | Actual | Result |
|------|--------|----------|--------|--------|
| 1 | Start server: run `node plugins/agent-monitoring/server.js` on port 9761, wait 3 seconds | Server up, dashboard reachable at http://127.0.0.1:9761 | Dashboard reachable | PASS |
| 2 | Record 5 starts: pipe agent_id test-agent-1 through test-agent-5 with type Explore into `hooks/record.js start` | 5 spawn events in state | 5 spawn events recorded | PASS |
| 3 | Query API: `GET /api/agents` | 5 agents with status running | 5 running cards returned | PASS |
| 4 | Check transports: `GET /api/transports` | All three transports on | webhook, SSE, socket.io on | PASS |
| 5 | Check socket.io flag in API response | socket.io true after npm install | socket.io true | PASS |
| 6 | Open dashboard and SSE stream | 5 running cards, live stream receives spawn events | 5 running cards, SSE verified | PASS |

## Notes

* LAN bind verified separately with `--host 0.0.0.0` showing Network URL.
* Cleanup after test: delete test entries from `%TEMP%/claude-agent-monitor/state.json`.
