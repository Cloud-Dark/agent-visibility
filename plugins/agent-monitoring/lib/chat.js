"use strict";
// Prompt API: run Claude Code prompts from the dashboard or other apps.
// Each prompt is one headless `claude -p` run. Passing a session_id
// resumes that conversation, so callers keep context across prompts.
// Run output (stream-json) is broadcast as chat.* events (SSE/socket.io)
// and the finished run is POSTed to registered webhooks.
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const fs = require("fs");
const { loadState, saveState, fireWebhooks } = require("./store");

const MAX_MESSAGES = 100;
const MAX_RUNS = 50;
const MAX_CONCURRENT = Number(process.env.AGENT_MONITOR_MAX_RUNS || 3) || 3;
// Headless runs have no terminal for permission prompts. Instead every
// prompt goes to approval-mcp.js, which asks the dashboard (Approve /
// Reject buttons). YOLO mode auto-allows everything. Base mode can be
// overridden with AGENT_MONITOR_CHAT_MODE (default: "default").
const PERMISSION_MODE = process.env.AGENT_MONITOR_CHAT_MODE || "default";
const APPROVAL_TOOL = "mcp__agentmon_approval__approve";
const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
const approvals = new Map(); // id -> approval
const approvalWaiters = new Map(); // id -> [resolve]
let yolo = false;
let approvalEmit = () => {};
const DEFAULT_CWD = process.env.AGENT_MONITOR_CWD || process.cwd();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const runs = new Map(); // run_id -> run (plain data, safe to serialize)
const procs = new Map(); // run_id -> child process
const waiters = new Map(); // run_id -> [resolve]

function httpError(code, message) {
  const e = new Error(message);
  e.status = code;
  return e;
}

// ---- dashboard conversation (persisted in state.json) ----
function chatState() {
  const c = loadState().chat || {};
  return {
    session_id: c.session_id || null,
    cwd: c.cwd || DEFAULT_CWD,
    messages: Array.isArray(c.messages) ? c.messages : [],
  };
}

function saveChat(patch) {
  const s = loadState();
  const c = { ...chatState(), ...patch };
  if (c.messages.length > MAX_MESSAGES) c.messages = c.messages.slice(-MAX_MESSAGES);
  s.chat = c;
  saveState(s);
  return c;
}

function addChatMessage(role, text) {
  const c = chatState();
  c.messages.push({ ts: new Date().toISOString(), role, text });
  saveChat({ messages: c.messages });
}

function running() {
  return [...runs.values()].filter((r) => r.status === "running");
}

function status() {
  return {
    ...chatState(),
    busy: running().some((r) => r.source === "dashboard"),
    permission_mode: PERMISSION_MODE,
    yolo,
  };
}

function reset() {
  for (const r of running()) if (r.source === "dashboard") cancel(r.run_id);
  return saveChat({ session_id: null, messages: [] });
}

function toolLine(block) {
  const i = block.input || {};
  const arg = i.file_path || i.command || i.pattern || i.url || i.description || "";
  return `${block.name}${arg ? " " + String(arg).slice(0, 120) : ""}`;
}

function trimRuns() {
  const done = [...runs.values()].filter((r) => r.status !== "running");
  for (const r of done.slice(0, Math.max(0, runs.size - MAX_RUNS))) runs.delete(r.run_id);
}

// Start one prompt run. Returns the run object immediately.
function startRun({ text, session_id, cwd, source = "api" }, emit) {
  if (session_id && !UUID_RE.test(session_id)) throw httpError(400, "session_id must be a UUID");
  const dir = cwd || DEFAULT_CWD;
  let isDir = false;
  try {
    isDir = fs.statSync(dir).isDirectory();
  } catch {}
  if (!isDir) throw httpError(400, `cwd is not a directory: ${dir}`);
  const active = running();
  if (active.length >= MAX_CONCURRENT) throw httpError(429, `max ${MAX_CONCURRENT} prompts running, try again later`);
  if (session_id && active.some((r) => r.session_id === session_id)) {
    throw httpError(409, "a prompt is still running in this session");
  }

  const run = {
    run_id: crypto.randomUUID(),
    source,
    status: "running",
    prompt: text,
    session_id: session_id || null,
    cwd: dir,
    permission_mode: PERMISSION_MODE,
    started_at: new Date().toISOString(),
    finished_at: null,
    result: null,
    error: null,
    cost_usd: null,
    messages: [],
  };
  runs.set(run.run_id, run);
  trimRuns();

  const out = (event, data) => emit({ event, run_id: run.run_id, source, session_id: run.session_id, ...data });
  const record = (role, t) => {
    run.messages.push({ ts: new Date().toISOString(), role, text: t });
    if (source === "dashboard") addChatMessage(role, t);
  };
  record("user", text);
  out("chat.user", { text });

  approvalEmit = emit;
  const mcpFile = path.join(os.tmpdir(), "claude-agent-monitor", "approval-mcp.json");
  writeMcpConfig(mcpFile);
  const args = [
    "-p", "--output-format", "stream-json", "--verbose",
    "--permission-mode", PERMISSION_MODE,
    "--mcp-config", mcpFile,
    "--permission-prompt-tool", APPROVAL_TOOL,
  ];
  if (session_id) args.push("--resume", session_id);
  // Prompt goes through stdin, so user text is never parsed by a shell.
  // shell:true is needed on Windows to run claude.cmd; args are fixed or validated.
  const child = spawn("claude", args, {
    cwd: dir,
    shell: process.platform === "win32",
    windowsHide: true,
    env: { ...process.env, AGENT_MONITOR_RUN_ID: run.run_id, AGENT_MONITOR_PORT: String(process.env.AGENT_MONITOR_PORT || 9761) },
  });
  procs.set(run.run_id, child);
  child.stdin.on("error", () => {});
  child.stdin.end(text);

  let buf = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) handleLine(line);
    }
  });
  child.stderr.on("data", (d) => (stderr += d));
  child.on("error", (err) => finish(`failed to start claude: ${err.message}`));
  child.on("close", (code) => {
    if (run.status === "cancelled") return finish(null);
    finish(code === 0 && !run.error ? null : run.error || stderr.trim() || `claude exited with code ${code}`);
  });

  function handleLine(line) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    if (ev.session_id && UUID_RE.test(ev.session_id) && ev.session_id !== run.session_id) {
      run.session_id = ev.session_id;
      if (source === "dashboard") saveChat({ session_id: ev.session_id });
    }
    if (ev.type === "assistant" && ev.message && Array.isArray(ev.message.content)) {
      for (const b of ev.message.content) {
        if (b.type === "text" && b.text) {
          record("assistant", b.text);
          out("chat.assistant", { text: b.text });
        } else if (b.type === "tool_use") {
          const t = toolLine(b);
          record("tool", t);
          out("chat.tool", { text: t });
        }
      }
    } else if (ev.type === "result") {
      run.result = typeof ev.result === "string" ? ev.result : null;
      run.cost_usd = typeof ev.total_cost_usd === "number" ? ev.total_cost_usd : null;
      if (ev.is_error) run.error = run.result || "claude reported an error";
    }
  }

  function finish(error) {
    if (!procs.has(run.run_id)) return;
    procs.delete(run.run_id);
    for (const a of approvals.values()) {
      if (a.run_id === run.run_id && a.status === "pending") resolveApproval(a.id, "denied", "run ended");
    }
    if (run.status === "running") run.status = error ? "error" : "done";
    run.finished_at = new Date().toISOString();
    if (error) {
      run.error = String(error).slice(0, 2000);
      record("error", run.error);
      out("chat.error", { text: run.error });
    }
    out("chat.done", { status: run.status, result: run.result, cost_usd: run.cost_usd });
    const s = loadState();
    fireWebhooks(s.webhooks, { event: "prompt.done", ts: run.finished_at, run }, s.transports ? s.transports.webhook !== false : true);
    for (const resolve of waiters.get(run.run_id) || []) resolve(run);
    waiters.delete(run.run_id);
  }

  return run;
}

// Wait until a run finishes, or until timeoutMs passes (returns it still running).
function waitFor(runId, timeoutMs) {
  const run = runs.get(runId);
  if (!run || run.status !== "running") return Promise.resolve(run || null);
  return new Promise((resolve) => {
    const list = waiters.get(runId) || [];
    const t = setTimeout(() => resolve(run), timeoutMs);
    list.push((r) => {
      clearTimeout(t);
      resolve(r);
    });
    waiters.set(runId, list);
  });
}

function cancel(runId) {
  const run = runs.get(runId);
  const child = procs.get(runId);
  if (!run || !child) return run || null;
  run.status = "cancelled";
  // shell:true on Windows wraps claude in cmd.exe; kill the whole tree.
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    child.kill("SIGTERM");
  }
  return run;
}

function writeMcpConfig(file) {
  const cfg = {
    mcpServers: {
      agentmon_approval: { command: process.execPath, args: [path.join(__dirname, "..", "approval-mcp.js")] },
    },
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg), "utf8");
}

// ---- approvals (Approve / Reject / YOLO) ----
function summarizeInput(input) {
  const i = input || {};
  const v = i.command || i.file_path || i.url || i.pattern || i.description || "";
  return String(v || JSON.stringify(i)).slice(0, 500);
}

function createApproval({ run_id, tool_name, input, tool_use_id }) {
  const run = runs.get(run_id);
  if (!run || run.status !== "running") throw httpError(404, "unknown or finished run_id");
  const a = {
    id: crypto.randomUUID(),
    run_id,
    source: run.source,
    tool_name: String(tool_name || "unknown"),
    input: input || {},
    summary: summarizeInput(input),
    tool_use_id: tool_use_id || null,
    status: "pending",
    message: null,
    created_at: new Date().toISOString(),
    decided_at: null,
  };
  approvals.set(a.id, a);
  if (yolo) {
    a.status = "allowed";
    a.message = "auto-approved (YOLO)";
    a.decided_at = a.created_at;
    approvalEmit({ event: "approval.auto", approval: a });
    return a;
  }
  approvalEmit({ event: "approval.pending", approval: a });
  setTimeout(() => {
    if (a.status === "pending") resolveApproval(a.id, "denied", "approval timed out");
  }, APPROVAL_TIMEOUT_MS);
  return a;
}

function resolveApproval(id, status, message) {
  const a = approvals.get(id);
  if (!a) throw httpError(404, "unknown approval id");
  if (a.status !== "pending") return a;
  a.status = status;
  a.message = message || null;
  a.decided_at = new Date().toISOString();
  approvalEmit({ event: "approval.resolved", approval: a });
  for (const r of approvalWaiters.get(id) || []) r(a);
  approvalWaiters.delete(id);
  if (approvals.size > 200) {
    for (const x of [...approvals.values()]) {
      if (x.status !== "pending" && approvals.size > 200) approvals.delete(x.id);
    }
  }
  return a;
}

function waitApproval(id, timeoutMs) {
  const a = approvals.get(id);
  if (!a || a.status !== "pending") return Promise.resolve(a || null);
  return new Promise((resolve) => {
    const list = approvalWaiters.get(id) || [];
    const t = setTimeout(() => resolve(a), timeoutMs);
    list.push((x) => {
      clearTimeout(t);
      resolve(x);
    });
    approvalWaiters.set(id, list);
  });
}

const listApprovals = (status) =>
  [...approvals.values()].filter((a) => !status || a.status === status).reverse();

function setYolo(on, emit) {
  yolo = !!on;
  if (emit) approvalEmit = emit;
  if (yolo) for (const a of listApprovals("pending")) resolveApproval(a.id, "allowed", "auto-approved (YOLO)");
  approvalEmit({ event: "yolo", yolo });
  return { yolo };
}

const getYolo = () => yolo;

function sendDashboard(text, emit) {
  const c = chatState();
  return startRun({ text, session_id: c.session_id, cwd: c.cwd, source: "dashboard" }, emit);
}

const getRun = (id) => runs.get(id) || null;
const listRuns = () =>
  [...runs.values()].reverse().map(({ messages, ...r }) => ({ ...r, message_count: messages.length }));

module.exports = {
  status, reset, sendDashboard, startRun, waitFor, cancel, getRun, listRuns, PERMISSION_MODE,
  createApproval, resolveApproval, waitApproval, listApprovals, setYolo, getYolo,
};
