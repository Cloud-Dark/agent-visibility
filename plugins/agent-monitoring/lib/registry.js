"use strict";
// In-memory registry of Claude Code sessions (clients) and their
// subagents. The server is the only writer: hooks POST events to
// /api/ingest and this module applies them in order, so a late tool
// event can no longer overwrite an agent's "done" status.
// Persisted to state.json (debounced) so a restart keeps history.
const { loadState, saveState, pushEvent } = require("./store");

const STALE_MS = 2 * 60 * 1000; // running agent with no tool call: idle
const SESSION_GONE_MS = 30 * 60 * 1000; // no event from a session: offline
const MAX_ACTIVITY = 50;
const MAX_FILES = 30;
const MAX_SESSIONS = 200;

let state = loadState();
if (!state.sessions || typeof state.sessions !== "object") state.sessions = {};
let dirty = false;
let saveTimer = null;

function persist() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!dirty) return;
    dirty = false;
    try {
      saveState(state);
    } catch {}
  }, 250);
}

function flush() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (dirty) {
    dirty = false;
    saveState(state);
  }
}

const get = () => state;

const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : null);
const ID_RE = /^[A-Za-z0-9_.:-]{1,120}$/;

// Apply one ingest event. Returns broadcast payloads for the caller.
function apply(ev, meta) {
  const out = [];
  const now = new Date().toISOString();
  const sid = typeof ev.session_id === "string" && ID_RE.test(ev.session_id) ? ev.session_id : null;
  const kind = ev.kind;

  let session = null;
  if (sid) {
    session = state.sessions[sid] || {
      session_id: sid,
      first_seen: now,
      status: "ready",
      prompts: 0,
    };
    session.host = str(ev.host, 80) || session.host || null;
    session.client_ip = meta.ip || session.client_ip || null;
    session.cwd = str(ev.cwd, 300) || session.cwd || null;
    session.pid = Number.isInteger(ev.pid) ? ev.pid : session.pid || null;
    session.last_seen = now;
    if (ev.name) session.name = str(ev.name, 80);
    if (kind === "session-start") {
      session.status = "ready";
      session.started_at = session.started_at || now;
    } else if (kind === "session-end") {
      session.status = "ended";
      session.ended_at = now;
    } else if (kind === "prompt") {
      session.status = "busy";
      session.prompts = (session.prompts || 0) + 1;
      session.last_prompt = str(ev.prompt, 300);
      session.last_prompt_at = now;
    } else if (!ev.agent_id && session.status !== "ended") {
      session.status = "busy";
    }
    const isNew = !state.sessions[sid];
    state.sessions[sid] = session;
    out.push({ event: isNew ? "session.new" : "session.update", session });
  }

  const aid = typeof ev.agent_id === "string" && ID_RE.test(ev.agent_id) ? ev.agent_id : null;
  if (aid && (kind === "subagent-start" || kind === "subagent-stop" || kind === "tool")) {
    const prev = state.agents[aid] || { agent_id: aid };
    const a = { ...prev };
    a.session_id = sid || a.session_id || null;
    a.host = (session && session.host) || a.host || null;
    a.agent_type = str(ev.agent_type, 80) || a.agent_type || null;
    if (ev.transcript && !a.transcript) a.transcript = str(ev.transcript, 500);

    if (kind === "subagent-start") {
      a.status = "running";
      a.started_at = a.started_at || now;
      a.stopped_at = null;
      pushEvent(state, "spawn", a);
      out.push({ event: "agent.spawn", ts: now, agent: a });
    } else if (kind === "subagent-stop") {
      a.status = "done";
      a.stale = false;
      a.started_at = a.started_at || now;
      a.stopped_at = now;
      pushEvent(state, "stop", a);
      out.push({ event: "agent.stop", ts: now, agent: a });
    } else {
      // tool: never resurrects a finished agent
      if (!a.status) a.status = "running";
      a.started_at = a.started_at || now;
      const summary = str(ev.summary, 300) || str(ev.tool, 60) || "tool";
      const activity = Array.isArray(a.activity) ? a.activity.slice() : [];
      activity.push({ ts: now, tool: str(ev.tool, 60) || "unknown", summary });
      while (activity.length > MAX_ACTIVITY) activity.shift();
      a.activity = activity;
      const file = str(ev.file, 500);
      if (file) {
        const files = Array.isArray(a.files_touched) ? a.files_touched.slice() : [];
        if (!files.includes(file)) files.push(file);
        while (files.length > MAX_FILES) files.shift();
        a.files_touched = files;
      }
      a.last_activity_at = now;
      a.last_summary = summary;
      if (a.status === "running") a.stale = false;
      out.push({ event: "agent.activity", ts: now, agent_id: aid, summary });
    }
    state.agents[aid] = a;
  }
  trimSessions();
  persist();
  return out;
}

function trimSessions() {
  const list = Object.values(state.sessions);
  if (list.length <= MAX_SESSIONS) return;
  list.sort((a, b) => String(a.last_seen).localeCompare(String(b.last_seen)));
  for (const s of list.slice(0, list.length - MAX_SESSIONS)) delete state.sessions[s.session_id];
}

// Periodic upkeep: idle agents, idle/offline sessions. Returns payloads.
function tick() {
  const out = [];
  const now = Date.now();
  let changed = false;
  for (const a of Object.values(state.agents)) {
    if (a.status === "running" && !a.stale) {
      const ref = Date.parse(a.last_activity_at || a.started_at || 0);
      if (ref && now - ref > STALE_MS) {
        a.stale = true;
        changed = true;
        out.push({ event: "agent.idle", agent_id: a.agent_id });
      }
    } else if (a.status !== "running" && a.stale) {
      a.stale = false;
      changed = true;
    }
  }
  for (const s of Object.values(state.sessions)) {
    const seen = Date.parse(s.last_seen || 0);
    if (s.status === "busy" && now - seen > STALE_MS) {
      s.status = "ready"; // finished its turn, waiting for the next prompt
      changed = true;
      out.push({ event: "session.update", session: s });
    } else if ((s.status === "ready" || s.status === "busy") && now - seen > SESSION_GONE_MS) {
      s.status = "offline";
      changed = true;
      out.push({ event: "session.update", session: s });
    }
  }
  if (changed) persist();
  return out;
}

function sessionAgents(sid) {
  return Object.values(state.agents).filter((a) => a.session_id === sid);
}

function setName(agentId, name) {
  state.names = state.names || {};
  if (name) state.names[agentId] = name;
  else delete state.names[agentId];
  persist();
}

function setTransports(t) {
  state.transports = t;
  persist();
}

function setWebhooks(w) {
  state.webhooks = w;
  persist();
}

function forgetSession(sid) {
  delete state.sessions[sid];
  persist();
}

module.exports = { touch: persist, get, apply, tick, flush, sessionAgents, setName, setTransports, setWebhooks, forgetSession, ID_RE };
