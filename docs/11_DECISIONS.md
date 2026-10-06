# Architecture Decision Records - Agent Monitoring Plugin

> Status: Final
> Last updated: 2026-10-06

## Contents

- [ADR-01 Port 9761](#adr-01-port-9761)
- [ADR-02 File-based state over database](#adr-02-file-based-state-over-database)
- [ADR-03 Reuse healthy server](#adr-03-reuse-healthy-server)
- [ADR-04 BOM strip](#adr-04-bom-strip)
- [ADR-05 GitHub marketplace over folder](#adr-05-github-marketplace-over-folder)

## ADR-01 Port 9761

Date: 2026-10-06

Context: An early port value of 97612 appeared in discussion. TCP ports cap at 65535, so 97612 is invalid.

Decision: Use 9761 as the default port, with automatic fallback to 9762, 9763, and further when occupied.

Consequences: Health checks, dashboard URLs, and AGENT_MONITOR_PORT all center on 9761. Ownership detection via /__health distinguishes our monitor from other apps.

## ADR-02 File-based state over database

Date: 2026-10-06

Context: Hooks, server, and MCP tools need shared mutable state with no mandatory dependencies.

Decision: Store runtime state in JSON files under the temp directory claude-agent-monitor: state.json for agents, events, webhooks, and transports; server.json for pid, port, host; monitor.log for startup lines.

Consequences: No database setup or driver. State writes go through a .tmp file plus rename. Events cap at 200, per-agent activity at 50, files touched at 30. Retention beyond these caps is _TBD_.

## ADR-03 Reuse healthy server

Date: 2026-10-06

Context: ensure-server.js runs on SessionStart and on every UserPromptSubmit as watchdog. Restarting on every prompt caused flapping, where a new check killed a just started process.

Decision: Reuse a healthy server. Restart only when the pid file points at a dead process. Run the watchdog in --quiet mode so it only writes monitor.log, and print the dashboard line once at session start.

Consequences: Stable daemon across prompts. Stale pid files still trigger a same-port restart. Orphaned healthy servers without pid files are adopted.

## ADR-04 BOM strip

Date: 2026-10-06

Context: PowerShell pipes can prepend a byte order mark to hook stdin, which breaks JSON.parse.

Decision: Strip a leading BOM in lib/store.js readStdinJson before parsing. On parse failure, resolve to an empty or raw object, and hook entry points exit 0 so hooks never block the agent.

Consequences: Hooks work under PowerShell and POSIX shells without extra configuration.

## ADR-05 GitHub marketplace over folder

Date: 2026-10-06

Context: Users need a repeatable install and update path for the plugin.

Decision: Distribute through the GitHub marketplace Cloud-Dark/agent-visibility and install with claude plugin install agent-monitoring@agentmonitoring, instead of copying plugin folders manually.

Consequences: One time marketplace registration with claude plugin marketplace add Cloud-Dark/agent-visibility. Updates run through claude plugin update agent-monitoring@agentmonitoring followed by a new session.
