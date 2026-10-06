# Plan: GitHub Marketplace Migration
> Status: Final
> Last updated: 2026-10-06

## Context

The plugin moved from a local folder install to distribution through a GitHub marketplace so users can install and update it with standard Claude Code plugin commands. Target repo: Cloud-Dark/agent-visibility. Plugin id: agent-monitoring@agentmonitoring. Version at migration: v0.2.0.

## Steps Done

1. Restructure repo into marketplace layout with `.claude-plugin/marketplace.json` at root and plugin code under `plugins/agent-monitoring/`.
2. Validate manifests: root `marketplace.json`, plugin `plugin.json`, hooks `hooks.json`, and `.mcp.json` for the agent-monitor MCP server.
3. Uninstall the old local folder based plugin from Claude Code.
4. Add the GitHub marketplace: `claude plugin marketplace add Cloud-Dark/agent-visibility`.
5. Reinstall from marketplace: `claude plugin install agent-monitoring@agentmonitoring`.
6. Start a new session and confirm SessionStart hook prints the dashboard URL.

## Files Touched

* `.claude-plugin/marketplace.json` (new manifest)
* `plugins/agent-monitoring/.claude-plugin/plugin.json`
* `plugins/agent-monitoring/.mcp.json`
* `plugins/agent-monitoring/hooks/hooks.json`
* `README.md` (install section updated to GitHub flow)
