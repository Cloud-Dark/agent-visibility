"use strict";
// Local monitor server: dashboard + JSON API + webhook management
// + selectable transports: webhook (outbound POST), SSE stream
// (GET /api/stream), socket.io (if dependency installed).
// Port from AGENT_MONITOR_PORT.
const http = require("http");
const {
  DEFAULT_PORT,
  DEFAULT_HOST,
  DEFAULT_TRANSPORTS,
  loadState,
  saveState,
  loadServerInfo,
} = require("./lib/store");

const MONITOR_ID = "claude-agent-monitor";
const PORT = Number(process.env.AGENT_MONITOR_PORT || DEFAULT_PORT);
// Bind address: 127.0.0.1 (default, local only) or 0.0.0.0 (LAN, like `npm run dev -- --host`).
// Override with AGENT_MONITOR_HOST env or: node server.js --host 0.0.0.0
const HOST = process.argv.includes("--host")
  ? process.argv[process.argv.indexOf("--host") + 1] || DEFAULT_HOST
  : DEFAULT_HOST;
const BOOT_AT = new Date().toISOString();

function send(res, code, contentType, body) {
  res.writeHead(code, { "Content-Type": contentType });
  res.end(body);
}

const json = (res, code, obj) =>
  send(res, code, "application/json; charset=utf-8", JSON.stringify(obj));

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

// LAN IPs for the "Network" URL display (like `npm run dev`).
function lanIps() {
  try {
    const nets = require("os").networkInterfaces();
    const out = [];
    for (const list of Object.values(nets)) {
      for (const n of list || []) {
        if (n.family === "IPv4" && !n.internal) out.push(n.address);
      }
    }
    return out;
  } catch {
    return [];
  }
}

// ---- live broadcast plumbing (SSE clients + socket.io) ----
const sseClients = new Set();
let io = null;
let lastEventCount = loadState().events.length;

function broadcast(payload) {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(line);
    } catch {
      sseClients.delete(res);
    }
  }
  if (io) io.emit("agent-event", payload);
}

// Poll state file for new events (record.js writes it) and broadcast.
// Also mark agents stale (no activity >2 min while status=running).
setInterval(() => {
  try {
    const s = loadState();
    if (s.transports && s.transports.sse === false && s.transports.socketio === false) {
      lastEventCount = s.events.length;
      return;
    }
    if (s.events.length > lastEventCount) {
      const fresh = s.events.slice(lastEventCount);
      lastEventCount = s.events.length;
      for (const ev of fresh) {
        const agent = s.agents[ev.agent_id] || null;
        broadcast({ event: ev.type === "spawn" ? "agent.spawn" : "agent.stop", ts: ev.ts, agent });
      }
    } else if (s.events.length < lastEventCount) {
      lastEventCount = s.events.length; // state was reset
    }
    // Aliveness: running agent with no activity for >2 min => stale.
    // (PostToolUse hook only fires in sessions where it runs; without it
    // the agent simply keeps its last known state.)
    let touched = false;
    const nowMs = Date.now();
    for (const a of Object.values(s.agents)) {
      if (a.status === "running" && !a.stale) {
        const ref = a.last_activity_at || a.started_at;
        if (ref && nowMs - Date.parse(ref) > 2 * 60 * 1000) {
          a.stale = true;
          touched = true;
        }
      } else if (a.status !== "running" && a.stale) {
        a.stale = false;
        touched = true;
      }
    }
    if (touched) saveState(s);
  } catch {
    // ignore transient read errors
  }
}, 1000);

const DASHBOARD = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Claude Agent Monitor</title>
<style>
:root{color-scheme:light dark}
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0 auto;max-width:960px;padding:24px;background:Canvas;color:CanvasText}
h1{font-size:22px;margin:0 0 4px}.sub{opacity:.65;font-size:13px;margin-bottom:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.card{border:1px solid GrayText;border-radius:10px;padding:12px 14px}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px}
.running{background:#22c55e}.done{background:#6b7280}
.mono{font-family:ui-monospace,Consolas,monospace;font-size:12px;word-break:break-all}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:20px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid GrayText}
form{margin-top:20px;display:flex;gap:8px}
input{flex:1;padding:8px;border-radius:8px;border:1px solid GrayText}
button{padding:8px 14px;border-radius:8px;border:1px solid GrayText;cursor:pointer}
#err{color:#ef4444;font-size:13px}
.pills{display:flex;gap:8px;margin:12px 0;flex-wrap:wrap}
.pill{border:1px solid GrayText;border-radius:20px;padding:6px 12px;font-size:13px;cursor:pointer;background:none;color:inherit}
.pill.on{background:#22c55e;color:#fff;border-color:#22c55e}
#streambox{border:1px solid GrayText;border-radius:10px;padding:10px;height:140px;overflow:auto;font-size:12px}
</style></head><body>
<h1>&#129302; Claude Agent Monitor</h1>
<div class="sub" id="meta">loading…</div>
<h2>Connection</h2>
<div class="pills" id="transports"></div>
<div class="mono" style="margin-bottom:8px">SSE: <span id="sse">/api/stream</span> · socket.io: <span id="sio">n/a</span></div>
<h2>Agents (<span id="count">0</span>)</h2>
<div class="grid" id="agents"></div>
<h2>Live stream</h2>
<div id="streambox" class="mono"></div>
<h2>Recent events</h2>
<table><thead><tr><th>Time</th><th>Event</th><th>Agent</th></tr></thead>
<tbody id="events"></tbody></table>
<h2>Webhooks</h2>
<div id="hooks" class="mono"></div>
<form id="addhook"><input id="url" placeholder="https://example.com/hook" required>
<button type="submit">Add webhook</button></form>
<div id="err"></div>
<script>
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let transports={};
function pill(name,label){
 const b=document.createElement('button');b.className='pill'+(transports[name]?' on':'');b.textContent=label+(transports[name]?' ✓':' ✕');
 b.onclick=async()=>{transports[name]=!transports[name];
  await fetch('/api/transports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(transports)});
  load();};return b;}
async function load(){
 try{
  const [a,e,t]=await Promise.all([(await fetch('/api/agents')).json(),(await fetch('/api/events?limit=30')).json(),(await fetch('/api/transports')).json()]);
  transports=t.transports;
  $('meta').textContent='host '+a.server.host+' · port '+a.server.port+' · up since '+a.server.started_at+' · updated '+a.server.state_updated_at+((a.server.lan_ips||[]).map(ip=>' · Network: http://'+ip+':'+a.server.port).join(''));
  $('count').textContent=a.agents.length;
  const tp=$('transports');tp.innerHTML='';
  tp.append(pill('webhook','webhook'),pill('sse','SSE stream'),pill('socketio','socket.io'));
  $('sio').textContent=a.server.socketio?'enabled':'not installed';
  $('agents').innerHTML=a.agents.map(x=>
   \`<div class="card"><span class="dot \${x.status}"></span><b>\${x.agent_type||'agent'}</b> · \${x.status}<br><span class="mono">\${x.agent_id}</span><br><span class="mono">start: \${x.started_at||'-'}<br>stop: \${x.stopped_at||'-'}</span>\${x.last_summary?'<br><b>doing:</b> <span class="mono">'+esc(x.last_summary)+'</span>':''}\${x.files_touched&&x.files_touched.length?'<br><span class="mono">files: '+x.files_touched.slice(-3).map(esc).join(', ')+(x.files_touched.length>3?' (+'+(x.files_touched.length-3)+' more)':'')+'</span>':''}\${x.activity&&x.activity.length?'<details><summary class="mono">activity ('+x.activity.length+')</summary>'+x.activity.slice(-10).reverse().map(a=>'<div class="mono">'+a.ts.slice(11,19)+' · '+esc(a.tool)+' — '+esc(a.summary)+'</div>').join('')+'</details>':''}</div>\`).join('')||'<p>No agents recorded yet.</p>';
  $('events').innerHTML=e.events.map(ev=>\`<tr><td class="mono">\${ev.ts}</td><td>\${ev.type}</td><td class="mono">\${ev.agent_id}</td></tr>\`).join('');
  $('hooks').textContent=(a.webhooks||[]).join('\\n')||'(none)';
  $('err').textContent='';
 }catch(err){$('err').textContent='fetch failed: '+err.message;}
}
$('addhook').onsubmit=async ev=>{ev.preventDefault();
 const r=await fetch('/api/webhooks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:$('url').value})});
 if(r.ok){$('url').value='';load();}else{$('err').textContent='invalid webhook url';}};
load();setInterval(load,3000);
try{
 const es=new EventSource('/api/stream');
 es.onmessage=ev=>{const d=document.createElement('div');d.textContent=new Date().toLocaleTimeString()+' '+ev.data;$('streambox').prepend(d);};
 es.onerror=()=>{};
}catch(e){}
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://127.0.0.1");
    const s = loadState();
    const info = loadServerInfo() || {};

    if (req.method === "GET" && u.pathname === "/__health") {
      return json(res, 200, { monitor: MONITOR_ID, port: PORT, host: HOST, pid: process.pid, started_at: info.started_at || BOOT_AT });
    }
    if (req.method === "GET" && u.pathname === "/") {
      return send(res, 200, "text/html; charset=utf-8", DASHBOARD);
    }
    if (req.method === "GET" && u.pathname === "/api/agents") {
      const agents = Object.values(s.agents).sort((a, b) =>
        String(b.started_at || "").localeCompare(String(a.started_at || ""))
      );
      return json(res, 200, {
        server: {
          port: PORT,
          host: HOST,
          lan_ips: HOST === "0.0.0.0" ? lanIps() : [],
          pid: process.pid,
          started_at: info.started_at || BOOT_AT,
          state_updated_at: s.updated_at,
          socketio: !!io,
          transports: s.transports,
        },
        webhooks: s.webhooks,
        transports: s.transports,
        agents,
      });
    }
    if (req.method === "GET" && u.pathname === "/api/events") {
      const limit = Math.min(Number(u.searchParams.get("limit") || "50"), 200);
      return json(res, 200, { events: s.events.slice(-limit).reverse() });
    }
    if (req.method === "GET" && u.pathname === "/api/transports") {
      return json(res, 200, { transports: s.transports || DEFAULT_TRANSPORTS });
    }
    if (req.method === "POST" && u.pathname === "/api/transports") {
      const body = await readBody(req);
      const next = { ...(s.transports || DEFAULT_TRANSPORTS) };
      for (const k of ["webhook", "sse", "socketio"]) {
        if (typeof body[k] === "boolean") next[k] = body[k];
      }
      s.transports = next;
      saveState(s);
      return json(res, 200, { transports: next });
    }
    // SSE live stream
    if (req.method === "GET" && u.pathname === "/api/stream") {
      if (s.transports && s.transports.sse === false) {
        return json(res, 403, { error: "sse transport disabled" });
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ event: "connected", ts: new Date().toISOString() })}\n\n`);
      sseClients.add(res);
      const hb = setInterval(() => {
        try {
          res.write(": ping\n\n");
        } catch {
          clearInterval(hb);
        }
      }, 15000);
      req.on("close", () => {
        clearInterval(hb);
        sseClients.delete(res);
      });
      return;
    }
    if (req.method === "GET" && u.pathname === "/api/webhooks") {
      return json(res, 200, { webhooks: s.webhooks });
    }
    if (req.method === "POST" && u.pathname === "/api/webhooks") {
      const body = await readBody(req);
      if (!body.url || !/^https?:\/\//.test(body.url)) {
        return json(res, 400, { error: "url must start with http(s)://" });
      }
      if (!s.webhooks.includes(body.url)) {
        s.webhooks.push(body.url);
        saveState(s);
      }
      return json(res, 200, { webhooks: s.webhooks });
    }
    if (req.method === "DELETE" && u.pathname === "/api/webhooks") {
      const body = await readBody(req);
      s.webhooks = s.webhooks.filter((w) => w !== body.url);
      saveState(s);
      return json(res, 200, { webhooks: s.webhooks });
    }
    return json(res, 404, { error: "not found" });
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  // Optional socket.io — only if installed (npm i socket.io).
  try {
    const { Server } = require("socket.io");
    io = new Server(server, { cors: { origin: "*" } });
    io.on("connection", (socket) => {
      socket.emit("hello", { monitor: MONITOR_ID, ts: new Date().toISOString() });
    });
  } catch {
    io = null; // dependency not installed — REST + SSE still work
  }
});
