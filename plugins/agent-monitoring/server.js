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
const chat = require("./lib/chat");
// Prompt endpoints run tools on this machine. Allowed from loopback
// without a token; other hosts need AGENT_MONITOR_TOKEN, sent as
// "Authorization: Bearer <token>" or "X-Monitor-Token: <token>".
const CHAT_TOKEN = process.env.AGENT_MONITOR_TOKEN || "";
function tokenMatches(given) {
  if (!CHAT_TOKEN || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(CHAT_TOKEN);
  return a.length === b.length && require("crypto").timingSafeEqual(a, b);
}
function chatAllowed(req) {
  const ip = req.socket.remoteAddress || "";
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return true;
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return tokenMatches(bearer) || tokenMatches(req.headers["x-monitor-token"]);
}
const FORBIDDEN = { error: "prompt API is localhost-only; set AGENT_MONITOR_TOKEN and send Authorization: Bearer <token>" };

function promptText(body) {
  const text = typeof body.prompt === "string" ? body.prompt : typeof body.text === "string" ? body.text : "";
  if (!text.trim()) return { error: "prompt is required" };
  if (text.length > 20000) return { error: "prompt too long (max 20000 chars)" };
  return { text: text.trim() };
}

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
#chatlog{border:1px solid GrayText;border-radius:10px;padding:10px;height:320px;overflow:auto;font-size:13px;display:flex;flex-direction:column;gap:6px}
.msg{padding:6px 10px;border-radius:8px;white-space:pre-wrap;word-break:break-word;max-width:90%}
.msg.user{align-self:flex-end;background:#2563eb;color:#fff}
.msg.assistant{align-self:flex-start;border:1px solid GrayText}
.msg.tool{align-self:flex-start;opacity:.7;font-family:ui-monospace,Consolas,monospace;font-size:12px}
.msg.error{align-self:flex-start;color:#ef4444;font-family:ui-monospace,Consolas,monospace;font-size:12px}
#chatform{margin-top:8px}
#approvals{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.appr{border:2px solid #f59e0b;border-radius:10px;padding:10px 12px;font-size:13px}
.appr .cmd{font-family:ui-monospace,Consolas,monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;background:rgba(127,127,127,.12);padding:6px 8px;border-radius:6px;margin:6px 0}
.appr button{margin-right:6px}.ok{background:#16a34a;color:#fff;border-color:#16a34a}.no{background:#dc2626;color:#fff;border-color:#dc2626}
#yolo.on{background:#dc2626;color:#fff;border-color:#dc2626}
#chatmeta{font-size:12px;opacity:.65;margin-top:6px}
#streambox{border:1px solid GrayText;border-radius:10px;padding:10px;height:140px;overflow:auto;font-size:12px}
.views{display:flex;gap:6px;margin:10px 0 4px}
.views button.on{background:#4493f8;color:#fff;border-color:#4493f8}
#pixelwrap{position:relative;display:none;margin-top:8px}
#pixel{width:100%;image-rendering:pixelated;image-rendering:crisp-edges;border:2px solid #3b2f47;border-radius:6px;background:#cbb894;display:block}
#pixeltip{position:absolute;display:none;max-width:270px;background:#1b1626;color:#f5f5f5;border:1px solid #7a6690;border-radius:6px;padding:8px 10px;font-size:12px;pointer-events:none;z-index:5}
.legend{font-size:12px;opacity:.7;margin-top:6px}
body.pixel-mode #agents{display:none}body.pixel-mode #pixelwrap{display:block}
</style></head><body>
<h1>&#129302; Claude Agent Monitor</h1>
<div class="sub" id="meta">loading…</div>
<h2>Prompt Claude Code</h2>
<div id="chatlog"></div>
<form id="chatform"><input id="prompt" placeholder="Tulis prompt, Enter untuk kirim" autocomplete="off" required>
<button type="submit" id="sendbtn">Send</button><button type="button" id="newchat">New chat</button><button type="button" id="yolo" title="Auto-approve every tool call">YOLO: off</button></form>
<div id="approvals"></div>
<div id="chatmeta"></div>
<h2>Connection</h2>
<div class="pills" id="transports"></div>
<div class="mono" style="margin-bottom:8px">SSE: <span id="sse">/api/stream</span> · socket.io: <span id="sio">n/a</span></div>
<h2>Agents (<span id="count">0</span>)</h2>
<div class="views"><button type="button" id="v-text">Text</button><button type="button" id="v-pixel">Pixel office</button></div>
<div class="grid" id="agents"></div>
<div id="pixelwrap"><canvas id="pixel" width="320" height="200"></canvas><div id="pixeltip"></div>
<div class="legend">Coding Lab: read/edit/think · Deploy Room: bash/build · Studio: web/content · Lounge: idle/done. Hover a worker for details.</div></div>
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
  if(window.pixelOffice)window.pixelOffice.update(a.agents);
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
const tokenParam=new URLSearchParams(location.search).get('token')||'';
const chatHeaders={'Content-Type':'application/json','X-Monitor-Token':tokenParam};
function addMsg(role,text){const d=document.createElement('div');d.className='msg '+role;d.textContent=text;$('chatlog').append(d);$('chatlog').scrollTop=$('chatlog').scrollHeight;}
function setBusy(b){$('sendbtn').disabled=b;$('sendbtn').textContent=b?'Running…':'Send';}
async function loadChat(){
 try{const r=await fetch('/api/chat',{headers:chatHeaders});const c=await r.json();
  if(!r.ok){$('chatmeta').textContent=c.error;$('prompt').disabled=true;return;}
  $('chatlog').innerHTML='';c.messages.forEach(m=>addMsg(m.role,m.text));setBusy(c.busy);
  $('chatmeta').textContent='cwd: '+c.cwd+' · mode: '+c.permission_mode+' · session: '+(c.session_id||'(new)');renderYolo(c.yolo);
 }catch(e){$('chatmeta').textContent='chat unavailable: '+e.message;}
}
$('chatform').onsubmit=async ev=>{ev.preventDefault();const text=$('prompt').value.trim();if(!text)return;
 setBusy(true);const r=await fetch('/api/chat',{method:'POST',headers:chatHeaders,body:JSON.stringify({text})});
 if(r.ok){$('prompt').value='';}else{const e=await r.json();addMsg('error',e.error);setBusy(false);}};
$('newchat').onclick=async()=>{await fetch('/api/chat',{method:'DELETE',headers:chatHeaders});loadChat();};
loadChat();
function renderYolo(on){const b=$('yolo');b.classList.toggle('on',on);b.textContent='YOLO: '+(on?'ON':'off');}
$('yolo').onclick=async()=>{const on=!$('yolo').classList.contains('on');
 if(on&&!confirm('YOLO mode: semua tool (Bash, git, edit file, dll) langsung diizinkan tanpa tanya. Lanjut?'))return;
 const r=await (await fetch('/api/yolo',{method:'POST',headers:chatHeaders,body:JSON.stringify({yolo:on})})).json();renderYolo(r.yolo);};
function apprCard(a){
 if(document.getElementById('ap-'+a.id))return;
 const d=document.createElement('div');d.className='appr';d.id='ap-'+a.id;
 d.innerHTML='<b>Izin diminta:</b> '+esc(a.tool_name)+(a.source!=='dashboard'?' <span class="mono">(api run '+esc(String(a.run_id).slice(0,8))+')</span>':'')+'<div class="cmd">'+esc(a.summary)+'</div>';
 const ok=document.createElement('button');ok.className='ok';ok.textContent='Approve';
 const no=document.createElement('button');no.className='no';no.textContent='Reject';
 const decide=async(v)=>{ok.disabled=no.disabled=true;await fetch('/api/approvals/'+a.id,{method:'POST',headers:chatHeaders,body:JSON.stringify({decision:v})});};
 ok.onclick=()=>decide('allow');no.onclick=()=>decide('deny');
 d.append(ok,no);$('approvals').append(d);}
function apprDone(a){const d=document.getElementById('ap-'+a.id);if(d)d.remove();
 if(a.source==='dashboard')addMsg(a.status==='allowed'?'tool':'error',(a.status==='allowed'?'✓ approved: ':'✕ rejected: ')+a.tool_name+' '+a.summary.slice(0,120));}
async function loadApprovals(){try{const r=await (await fetch('/api/approvals?status=pending',{headers:chatHeaders})).json();
 $('approvals').innerHTML='';(r.approvals||[]).forEach(apprCard);renderYolo(r.yolo);}catch(e){}}
loadApprovals();
async function loadChatMeta(){try{const c=await (await fetch('/api/chat',{headers:chatHeaders})).json();$('chatmeta').textContent='cwd: '+c.cwd+' · mode: '+c.permission_mode+' · session: '+(c.session_id||'(new)');}catch(e){}}
function setView(v){document.body.classList.toggle('pixel-mode',v==='pixel');$('v-text').classList.toggle('on',v!=='pixel');$('v-pixel').classList.toggle('on',v==='pixel');try{localStorage.setItem('agentmon-view',v);}catch(e){}}
$('v-text').onclick=()=>setView('text');$('v-pixel').onclick=()=>setView('pixel');
let savedView='pixel';try{savedView=localStorage.getItem('agentmon-view')||'pixel';}catch(e){}
setView(savedView);
load();setInterval(load,3000);
try{
 const es=new EventSource('/api/stream');
 es.onmessage=ev=>{let p={};try{p=JSON.parse(ev.data);}catch(e){}
  if(p.event==='approval.pending'){apprCard(p.approval);return;}
  if(p.event==='approval.resolved'){apprDone(p.approval);return;}
  if(p.event==='approval.auto'){if(p.approval.source==='dashboard')addMsg('tool','⚡ YOLO: '+p.approval.tool_name+' '+p.approval.summary.slice(0,120));return;}
  if(p.event==='yolo'){renderYolo(p.yolo);return;}
  if(p.event&&p.event.startsWith('chat.')){
   if(p.source!=='dashboard'){const d=document.createElement('div');d.textContent=new Date().toLocaleTimeString()+' [api '+String(p.run_id).slice(0,8)+'] '+p.event+(p.text?' '+p.text.slice(0,120):'');$('streambox').prepend(d);return;}
   if(p.event==='chat.user')addMsg('user',p.text);
   else if(p.event==='chat.assistant')addMsg('assistant',p.text);
   else if(p.event==='chat.tool')addMsg('tool','→ '+p.text);
   else if(p.event==='chat.error')addMsg('error',p.text);
   else if(p.event==='chat.done'){setBusy(false);loadChatMeta();}
   return;}
  const d=document.createElement('div');d.textContent=new Date().toLocaleTimeString()+' '+ev.data;$('streambox').prepend(d);};
 es.onerror=()=>{};
}catch(e){}
</script><script src="/pixel.js"></script></body></html>`;

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
    if (req.method === "GET" && u.pathname === "/pixel.js") {
      return send(res, 200, "text/javascript; charset=utf-8", require("fs").readFileSync(require("path").join(__dirname, "public", "pixel.js")));
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
    // Dashboard chat box: one conversation kept in state.json.
    if (u.pathname === "/api/chat") {
      if (!chatAllowed(req)) return json(res, 403, FORBIDDEN);
      if (req.method === "GET") return json(res, 200, chat.status());
      if (req.method === "DELETE") return json(res, 200, chat.reset());
      if (req.method === "POST") {
        const p = promptText(await readBody(req));
        if (p.error) return json(res, 400, p);
        try {
          const run = chat.sendDashboard(p.text, broadcast);
          return json(res, 202, { run_id: run.run_id });
        } catch (e) {
          return json(res, e.status || 500, { error: e.message });
        }
      }
    }
    // Permission approvals. approval-mcp.js (spawned by claude, on
    // loopback) creates them; dashboard/API users approve or reject.
    if (u.pathname === "/api/yolo") {
      if (!chatAllowed(req)) return json(res, 403, FORBIDDEN);
      if (req.method === "GET") return json(res, 200, { yolo: chat.getYolo() });
      if (req.method === "POST") {
        const body = await readBody(req);
        return json(res, 200, chat.setYolo(body.yolo === true, broadcast));
      }
    }
    if (u.pathname === "/api/approvals" || u.pathname.startsWith("/api/approvals/")) {
      if (!chatAllowed(req)) return json(res, 403, FORBIDDEN);
      const id = u.pathname.split("/")[3] || "";
      if (!id && req.method === "GET") {
        return json(res, 200, { yolo: chat.getYolo(), approvals: chat.listApprovals(u.searchParams.get("status") || undefined) });
      }
      try {
        if (!id && req.method === "POST") {
          return json(res, 201, chat.createApproval(await readBody(req)));
        }
        if (id && req.method === "GET") {
          const waitMs = Math.min(Number(u.searchParams.get("wait_ms")) || 0, 60000);
          const a = await chat.waitApproval(id, waitMs);
          return a ? json(res, 200, a) : json(res, 404, { error: "unknown approval id" });
        }
        if (id && req.method === "POST") {
          const body = await readBody(req);
          if (body.decision !== "allow" && body.decision !== "deny") {
            return json(res, 400, { error: 'decision must be "allow" or "deny"' });
          }
          const msg = typeof body.message === "string" ? body.message.slice(0, 500) : null;
          return json(res, 200, chat.resolveApproval(id, body.decision === "allow" ? "allowed" : "denied", msg || (body.decision === "deny" ? "Rejected from agent-monitor dashboard" : null)));
        }
      } catch (e) {
        return json(res, e.status || 500, { error: e.message });
      }
      return json(res, 405, { error: "method not allowed" });
    }
    // Prompt API for other apps. POST runs a prompt; pass session_id to
    // continue a conversation, wait=true to get the answer in the response.
    if (u.pathname === "/api/prompts" || u.pathname.startsWith("/api/prompts/")) {
      if (!chatAllowed(req)) return json(res, 403, FORBIDDEN);
      const runId = u.pathname.split("/")[3] || "";
      if (req.method === "GET" && !runId) return json(res, 200, { runs: chat.listRuns() });
      if (req.method === "POST" && !runId) {
        const body = await readBody(req);
        const p = promptText(body);
        if (p.error) return json(res, 400, p);
        let run;
        try {
          run = chat.startRun({ text: p.text, session_id: body.session_id, cwd: body.cwd }, broadcast);
        } catch (e) {
          return json(res, e.status || 500, { error: e.message });
        }
        const wait = body.wait === true || u.searchParams.get("wait") === "true";
        if (!wait) return json(res, 202, run);
        const timeoutMs = Math.min(Number(body.timeout_ms) || 300000, 600000);
        const done = await chat.waitFor(run.run_id, timeoutMs);
        return json(res, done.status === "running" ? 202 : 200, done);
      }
      if (runId) {
        const run = chat.getRun(runId);
        if (!run) return json(res, 404, { error: "unknown run_id (runs live in memory, max 50)" });
        if (req.method === "GET") {
          const waitMs = Math.min(Number(u.searchParams.get("wait_ms")) || 0, 600000);
          return json(res, 200, waitMs ? await chat.waitFor(runId, waitMs) : run);
        }
        if (req.method === "DELETE") return json(res, 200, chat.cancel(runId));
      }
      return json(res, 405, { error: "method not allowed" });
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
