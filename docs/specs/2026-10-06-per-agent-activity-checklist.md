# Spec: Per Agent Activity Checklist
> Status: Final
> Last updated: 2026-10-06

Checklist for the activity tracking feature in plugin agent-monitoring v0.2.0.

## Hook Wiring

* [x] PostToolUse hook registered in `hooks/hooks.json`
* [x] Matcher list covers Read, Write, Edit, Bash, Glob, Grep, Task, TodoWrite, WebFetch, WebSearch
* [x] Hook script is `hooks/activity.js`
* [x] Main session tool calls without agent_id are skipped

## Summary Formats Per Tool

* [x] Read: records file path read
* [x] Write and Edit: record file path written or edited
* [x] Bash: records command text
* [x] Glob and Grep: record search pattern
* [x] Task: records subagent description
* [x] TodoWrite and WebFetch and WebSearch: record compact input summary

## Storage Rules

* [x] Each activity entry has timestamp, tool name, and summary
* [x] Activity list capped at 50 items per agent, oldest dropped first
* [x] Files touched list updated alongside activity
* [x] Last summary shown as the doing line on the dashboard card

## Stale Rule

* [x] Running agent with no activity for more than 2 minutes is marked stale
* [x] Stale flag cleared when status changes to done
* [x] Dashboard shows warning marker on stale cards
