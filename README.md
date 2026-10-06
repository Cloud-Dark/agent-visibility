# 👀 agent-visibility

**Monitor subagent Claude Code yang sedang running — via dashboard web, webhook, SSE stream, atau socket.io.**

Spawn 5 agent berbeda? Semuanya muncul live di dashboard: siapa yang running,
tipe apa, sedang mengerjakan apa (tool terakhir, file yang disentuh, riwayat
aktivitas), plus event spawn/stop yang bisa di-forward ke webhook / SSE /
socket.io. Server nyala otomatis setiap Claude Code berjalan.

> Catatan port: `97612` tidak valid (port TCP maksimal `65535`), jadi port
> default plugin ini adalah **9761** dengan fallback otomatis.

---

## ✨ Fitur

- 📊 **Dashboard web live** — daftar agent (running/done/stale), tipe, waktu
  start-stop, aktivitas terakhir, file yang disentuh, riwayat tool per agent,
  event stream, auto-refresh 3 detik + SSE live
- 🔌 **3 koneksi yang bisa dipilih on/off** — webhook, SSE stream, socket.io
  (toggle di dashboard / API / MCP)
- 🔎 **Detail per agent** — "agent ini mengerjakan apa": tool terakhir, 50
  aktivitas terakhir, file yang disentuh, penanda stale
- 🚀 **Auto-start** — server nyala otomatis saat Claude Code berjalan
  (hook `SessionStart` + `UserPromptSubmit` sebagai watchdog), mati? prompt
  berikutnya menyalakannya lagi
- 🔁 **Aturan port cerdas** — port dipakai monitor lama → kill lalu naikkan
  yang baru di port yang sama; dipakai aplikasi lain → otomatis naik
  (9762, 9763, …)
- 🌐 **Bind fleksibel** — default `127.0.0.1` (lokal saja), set `0.0.0.0`
  agar bisa diakses se-jaringan seperti `npm run dev -- --host`
- 🤖 **MCP server** — 9 tools agar Claude-nya sendiri bisa ditanya
  "agent apa saja yang running?"
- 📦 **Tanpa dependency wajib** — REST + SSE + webhook jalan dengan Node.js
  polos; hanya socket.io yang butuh `npm install` (sudah termasuk)

---

## 🚀 Instalasi

Butuh: **Node.js ≥ 18**.

```powershell
# 1. Daftarkan marketplace dari GitHub (cukup sekali)
claude plugin marketplace add Cloud-Dark/agent-visibility

# 2. Install pluginnya
claude plugin install agent-monitoring@agentmonitoring
```

Mulai sesi Claude Code baru — hook `SessionStart` otomatis menyalakan server
dan terminal menampilkan:

```text
agent-monitor: dashboard at http://127.0.0.1:9761
```

Buka URL itu di browser. Selesai. Tidak ada yang perlu dijalankan manual.

> Update kode plugin? Jalankan `claude plugin update agent-monitoring@agentmonitoring`
> lalu mulai sesi baru.

---

## 🖥️ Dashboard

`GET /` — satu halaman berisi:

| Bagian | Isi |
|--------|-----|
| **Connection** | Pill toggle webhook / SSE stream / socket.io (klik untuk on/off), alamat SSE + status socket.io |
| **Agents (N)** | Kartu per agent: ● hijau running / abu done (⚠️ stale bila >2 mnt tanpa aktivitas), tipe, `agent_id`, start–stop, **doing** (tool terakhir), file yang disentuh, dropdown riwayat aktivitas |
| **Live stream** | Event spawn/stop realtime via SSE |
| **Recent events** | Tabel 30 event terakhir |
| **Webhooks** | Daftar URL + form tambah |

Meta di atas menampilkan host, port, uptime — plus **Network URL** (IP LAN)
saat bind `0.0.0.0`, ala `npm run dev`:

```text
host 0.0.0.0 · port 9761 · up since … · Network: http://192.168.1.10:9761
```

---

### 🎮 Pixel office

Bagian **Agents** di dashboard bisa ditampilkan dalam dua mode: **Text** (kartu biasa) atau **Pixel office** (default). Pixel office adalah kantor pixel art 2D, dan setiap agent menjadi karakter yang berjalan ke ruangan sesuai pekerjaannya saat itu:

| Ruangan | Isi | Agent masuk ke sini saat |
|---------|-----|--------------------------|
| Coding Lab | meja komputer, rak buku, whiteboard | tool terakhir Read, Edit, Write, Grep, Glob, Task, atau TodoWrite (berpikir, menulis kode) |
| Deploy Room | rak server, monitor status, lampu BUILD/TEST/SHIP | tool terakhir Bash atau PowerShell |
| Studio | green screen, kamera, ring light, lampu ON AIR | WebFetch, WebSearch, atau file media/konten |
| Lounge | mesin kopi, teh, meja bundar, sofa | agent selesai, stale, atau tidak ada aktivitas lebih dari 45 detik |

Gelembung di atas kepala menunjukkan status: titik-titik berarti sedang berpikir, prompt terminal berarti menjalankan perintah, ikon kamera berarti di studio, centang berarti selesai, dan zzz berarti idle. Arahkan kursor ke karakter untuk melihat tipe agent, ID, dan empat aktivitas terakhirnya. Semua gambar dibuat dengan canvas (`public/pixel.js`), tanpa file gambar. Pilihan mode disimpan di browser.

## 🔌 3 koneksi (pilih sesukamu)

Semua aktif secara default. Matikan/nnyalakan lewat pill di dashboard,
`POST /api/transports`, atau MCP `transports_set`. Cek status via
`GET /api/transports` / MCP `transports_get`.

### 1. Webhook (outbound POST)

Daftarkan URL → setiap agent spawn/stop di-POST sebagai JSON:

```json
{ "event": "agent.spawn", "ts": "2026-10-06T14:00:00.000Z", "agent": { "agent_id": "abc", "agent_type": "Explore", "status": "running" } }
```

```powershell
# tambah
Invoke-RestMethod -Method Post http://127.0.0.1:9761/api/webhooks `
  -ContentType 'application/json' -Body '{"url":"https://example.com/hook"}'
# hapus
Invoke-RestMethod -Method Delete http://127.0.0.1:9761/api/webhooks `
  -ContentType 'application/json' -Body '{"url":"https://example.com/hook"}'
```

Contoh receiver 10 baris (Node):

```js
require("http").createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c));
  req.on("end", () => { console.log("event:", b); res.end("ok"); });
}).listen(3001);
```

### 2. SSE stream (Server-Sent Events)

```powershell
curl -N http://127.0.0.1:9761/api/stream
```

Setiap event tiba sebagai:

```text
data: {"event":"agent.spawn","ts":"...","agent":{...}}

data: {"event":"agent.stop","ts":"...","agent":{...}}
```

Ada heartbeat `: ping` tiap 15 detik agar koneksi idle tidak diputus proxy.
Di browser cukup `new EventSource('/api/stream')` (dipakai dashboard).
Mengembalikan `403` bila transport `sse` dimatikan.

### 3. socket.io

Server mengaktifkan socket.io otomatis bila dependency terinstal
(sudah ada di `package.json` — `npm install` sekali di folder plugin).
Client (socket.io v4):

```js
const { io } = require("socket.io-client");
const s = io("http://127.0.0.1:9761");
s.on("hello", (m) => console.log("connected", m));
s.on("agent-event", (e) => console.log(e.event, e.agent.agent_id));
```

---

## 🌐 Bind address (akses se-jaringan)

Default hanya localhost. Agar bisa dibuka dari HP / laptop lain di jaringan
yang sama (seperti `npm run dev -- --host`):

```powershell
# sekali saja — tersimpan untuk semua sesi berikutnya
claude plugin configure agent-monitoring@agentmonitoring
# atau via env
$env:AGENT_MONITOR_HOST = "0.0.0.0"
```

| Nilai | Arti |
|-------|------|
| `127.0.0.1` (default) | Hanya di mesin ini |
| `0.0.0.0` | Semua interface → buka via IP LAN, mis. `http://192.168.1.10:9761` |
| `192.168.1.10` | Interface spesifik |

Manual sekali jalan: `node server.js --host 0.0.0.0`. Healthcheck ikut
melaporkan `host`, dan API menyertakan `lan_ips` saat bind `0.0.0.0`.

> ⚠️ `0.0.0.0` membuka dashboard ke jaringan lokalmu. Jangan pakai di
> jaringan publik/tidak terpercaya — tidak ada autentikasi.

Port via `AGENT_MONITOR_PORT` (default `9761`).

---

## 💬 Prompt API: kendalikan Claude Code dari aplikasi lain

Dashboard punya kotak **Prompt Claude Code**: ketik lalu tekan Enter. Aplikasi lain bisa melakukan hal yang sama lewat HTTP.

Setiap prompt menjalankan `claude -p` headless. Kirim `session_id` dari respons sebelumnya supaya percakapannya berlanjut. Ini sesi Claude Code **terpisah** yang dimiliki server monitor, bukan terminal yang sedang kamu pakai, karena Claude Code tidak menyediakan jalur resmi untuk mengirim prompt ke sesi interaktif yang sudah berjalan.

```bash
# kirim prompt lalu tunggu jawabannya
curl -X POST http://127.0.0.1:9761/api/prompts \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Ringkas README.md","wait":true}'

# lanjutkan percakapan yang sama
curl -X POST http://127.0.0.1:9761/api/prompts \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Terjemahkan ke Inggris","session_id":"<session_id>","wait":true}'
```

Respons berisi `run_id`, `status` (`running`/`done`/`error`/`cancelled`), `result`, `session_id`, `cost_usd`, dan `messages` (teks dan tool yang dipakai).

Tanpa `wait`, server langsung membalas `202` beserta `run_id`. Hasilnya bisa diambil dengan tiga cara:
- `GET /api/prompts/<run_id>?wait_ms=60000` (long-poll)
- SSE `/api/stream`, event `chat.user` / `chat.assistant` / `chat.tool` / `chat.done`
- webhook yang menerima event `prompt.done`

Field opsional `cwd` menentukan folder kerja.

### ✅ Approve / Reject

Run headless tidak punya terminal untuk menampilkan dialog izin. Karena itu, setiap izin diteruskan ke dashboard lewat `--permission-prompt-tool` (`approval-mcp.js`). Contohnya Bash, git, atau tool lain yang belum ada di allowlist. Di dashboard muncul kartu kuning berisi tool dan perintahnya, dengan tombol **Approve** dan **Reject**. Aplikasi lain bisa memakai:

```bash
curl http://127.0.0.1:9761/api/approvals?status=pending
curl -X POST http://127.0.0.1:9761/api/approvals/<id> \
  -H "Content-Type: application/json" -d '{"decision":"allow"}'   # atau "deny"
```

Selama belum diputuskan, run menunggu. Setelah 10 menit tanpa keputusan, izin otomatis ditolak. Tool yang sudah ada di allowlist `settings.json` kamu tetap langsung jalan tanpa ditanya.

### ⚡ YOLO mode

Tombol **YOLO** di dashboard, atau `POST /api/yolo {"yolo":true}`, menyetujui semua permintaan izin secara otomatis, termasuk yang sedang menunggu. Kondisi default-nya mati, dan nilainya kembali mati setiap server restart. Nyalakan hanya kalau kamu percaya pada prompt yang dikirim, karena dalam mode ini Claude boleh menjalankan perintah apa pun di mesinmu.

### 🔒 Akses

Semua endpoint prompt, approval, dan YOLO hanya menerima request dari localhost. Untuk aplikasi di mesin lain, jalankan server dengan `AGENT_MONITOR_HOST=0.0.0.0` dan `AGENT_MONITOR_TOKEN=<rahasia>`, lalu kirim header `Authorization: Bearer <rahasia>`. Dashboard di LAN dibuka dengan `?token=<rahasia>`. Jangan buka port ini ke internet.

| Env | Default | Fungsi |
|-----|---------|--------|
| `AGENT_MONITOR_TOKEN` | kosong | Token untuk akses non-localhost |
| `AGENT_MONITOR_CWD` | folder server | Folder kerja default untuk run |
| `AGENT_MONITOR_CHAT_MODE` | `default` | `--permission-mode` untuk run |
| `AGENT_MONITOR_MAX_RUNS` | `3` | Maksimal run yang berjalan bersamaan |

---

## 📡 REST API

| Method & path | Fungsi |
|---------------|--------|
| `GET /` | Dashboard |
| `GET /__health` | `{"monitor":"claude-agent-monitor","port":9761,"host":"…","pid":…}` — dipakai deteksi "port milik siapa" |
| `GET /api/agents` | Daftar agent (terbaru dulu) + `server` (port, host, lan_ips, pid, uptime, socketio, transports) + webhooks + transports |
| `GET /api/events?limit=50` | Event spawn/stop terakhir (maks 200, terbaru dulu) |
| `GET /api/stream` | SSE live stream |
| `GET /api/transports` | Status on/off ketiga transport |
| `POST /api/transports` | `{"webhook":true,"sse":false,"socketio":true}` — pilih koneksi |
| `GET /api/webhooks` | Daftar webhook |
| `POST /api/webhooks` | `{"url":"https://…"}` — tambah |
| `DELETE /api/webhooks` | `{"url":"https://…"}` — hapus |
| `POST /api/prompts` | `{"prompt":"…","session_id"?,"cwd"?,"wait"?,"timeout_ms"?}` — jalankan prompt |
| `GET /api/prompts` | Daftar run (50 terakhir, disimpan di memori) |
| `GET /api/prompts/<run_id>?wait_ms=` | Detail run, bisa long-poll |
| `DELETE /api/prompts/<run_id>` | Batalkan run |
| `GET /api/approvals?status=pending` | Daftar permintaan izin |
| `POST /api/approvals/<id>` | `{"decision":"allow"\|"deny"}` |
| `GET/POST /api/yolo` | `{"yolo":true}` — auto-approve semua |
| `GET/POST/DELETE /api/chat` | Percakapan kotak chat di dashboard |

---

## 🤖 MCP tools (server `agent-monitor`)

| Tool | Fungsi |
|------|--------|
| `agents_list {status?}` | Daftar agent (`all`/`running`/`done`) |
| `agents_get {agent_id}` | Detail satu agent + aktivitas + file |
| `monitor_status` | Port, host, pid, uptime, hitungan running/done, jumlah webhook |
| `events_recent {limit?}` | Event terakhir |
| `webhook_add/list/remove` | Kelola webhook |
| `transports_get/set` | Lihat/ubah koneksi aktif |

Contoh: *"agent apa saja yang running?"* → Claude memanggil `agents_list
{status:"running"}`.

---

## ⚙️ Cara kerja

```text
Claude Code session
 ├─ SessionStart / UserPromptSubmit ──▶ ensure-server.js ──▶ server.js (daemon, detached)
 │                                         ├─ port milik monitor lama? kill → naikkan baru di port sama
 │                                         └─ port milik app lain? coba 9762, 9763, …
 ├─ SubagentStart ──▶ record.js start ──▶ state.json (+ webhook POST + broadcast SSE/socket.io)
 ├─ PostToolUse ──▶ activity.js ──▶ catat tool/summary/file per agent
 ├─ SubagentStop ──▶ record.js stop ──▶ status done (+ webhook POST + broadcast)
 └─ dashboard / REST / SSE / socket.io / MCP ◀── baca state.json yang sama
```

File runtime (tidak di-commit): `%TEMP%/claude-agent-monitor/` berisi
`state.json` (agent, event, webhook, transports), `server.json` (pid, port,
host), `monitor.log` (log rotasi 100 KB — lihat ini bila server bermasalah).

### Kenapa "Claude nyala tapi server mati"?

Dulu `ensure-server.js` me-restart server **setiap** prompt (SessionStart +
UserPromptSubmit), sehingga proses yang baru dicek sering membunuh proses
yang baru dinyalakan → flapping. Sekarang: server yang sehat **dipakai
ulang** (reuse), restart hanya bila pid file menunjuk proses yang sudah
mati. `UserPromptSubmit` berjalan `--quiet` (hanya tulis log, tidak
mencetak ke terminal) dan pesan dashboard hanya muncul sekali saat sesi
dimulai.

---

## 🧪 Test manual (tanpa spawn agent asli)

```powershell
$env:AGENT_MONITOR_PORT='9761'
Start-Process node -ArgumentList 'plugins\agent-monitoring\server.js' -WindowStyle Hidden
Start-Sleep 3
1..5 | % { (@{agent_id="test-agent-$_"; agent_type="Explore"} | ConvertTo-Json -Compress) | node 'plugins\agent-monitoring\hooks\record.js' start }
Invoke-RestMethod http://127.0.0.1:9761/api/agents | % agents | ft agent_id, agent_type, status
```

---

## 🗂️ Struktur repo

```text
agent-visibility/
├─ README.md                                ← kamu di sini
├─ .gitignore
├─ .claude-plugin/marketplace.json          ← manifest marketplace (GitHub: Cloud-Dark/agent-visibility)
└─ plugins/agent-monitoring/                ← plugin
   ├─ .claude-plugin/plugin.json
   ├─ .mcp.json                             ← MCP server agent-monitor
   ├─ package.json                          ← socket.io (opsional, sudah terinstal)
   ├─ server.js                             ← dashboard + REST + SSE + socket.io
   ├─ mcp-server.js                         ← 9 MCP tools (stdio)
   ├─ approval-mcp.js                       ← permission-prompt tool: Approve/Reject/YOLO dari dashboard
   ├─ hooks/
   │  ├─ hooks.json                         ← SessionStart, UserPromptSubmit, SubagentStart/Stop, PostToolUse
   │  ├─ ensure-server.js                   ← auto-start + aturan port + watchdog
   │  ├─ record.js                          ← catat spawn/stop
   │  └─ activity.js                        ← catat tool/file per agent
   └─ lib/
      ├─ store.js                          ← state.json, webhook POST, stdin JSON
      └─ chat.js                           ← Prompt API: run claude -p, approvals, YOLO
   └─ public/pixel.js                       ← tampilan Pixel office (canvas 2D)
```

---

## 🔧 Troubleshooting

| Gejala | Penyebab & solusi |
|--------|-------------------|
| Dashboard tidak bisa dibuka | Cek `%TEMP%/claude-agent-monitor/monitor.log`; pastikan sesi Claude baru dimulai (SessionStart). Prompt berikutnya menyalakan ulang via watchdog |
| Port 9761 dipakai app lain | Otomatis pindah 9762+ — lihat URL di terminal saat sesi mulai |
| Agent tidak tercatat | Hook `SubagentStart` butuh sesi baru setelah install/update plugin |
| `activity` kosong | Hook `PostToolUse` hanya mencatat tool Read/Write/Edit/Bash/Glob/Grep/Task/TodoWrite/WebFetch/WebSearch; sesi utama (tanpa agent_id) tidak dilacak |
| socket.io "not installed" | `npm install` di `plugins/agent-monitoring/` |
| Data lama menumpuk | Hapus `%TEMP%/claude-agent-monitor/state.json` (atau seluruh foldernya) |

---

## 📄 Lisensi

MIT — bebas pakai, ubah, dan bagikan.
