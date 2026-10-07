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
- 🖧 **Server pusat** — semua Claude Code-mu (di laptop ini atau mesin lain)
  melapor ke satu dashboard: buka 10 Claude Code, muncul 10 sesi `ready`;
  begitu satu sesi men-spawn agent, agent-agentnya ikut muncul
- 🔐 **Login** — dashboard memakai password, API memakai token, dan hook
  Claude Code memakai client token yang hanya boleh melapor
- 🔎 **Detail per agent** — "agent ini mengerjakan apa": tool terakhir, 50
  aktivitas terakhir, file yang disentuh, penanda stale
- 🚀 **Auto-start** — server nyala otomatis saat Claude Code berjalan
  (hook `SessionStart` + `UserPromptSubmit` sebagai watchdog), mati? prompt
  berikutnya menyalakannya lagi
- 🔁 **Aturan port cerdas** — port dipakai monitor yang sehat → dipakai
  ulang; dipakai aplikasi lain atau tidak menjawab → otomatis naik
  (9762, 9763, …), tanpa membunuh proses apa pun
- 🌐 **Bind fleksibel** — default `127.0.0.1` (lokal saja), set `0.0.0.0`
  agar bisa diakses se-jaringan seperti `npm run dev -- --host`
- 🤖 **MCP server** — 10 tools agar Claude-nya sendiri bisa ditanya
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

`GET /` membutuhkan login (lihat [Login dan keamanan](#-login-dan-keamanan)). Isi halamannya:

| Bagian | Isi |
|--------|-----|
| **Claude Code sessions (N online)** | Satu kartu per Claude Code yang terhubung: nama sesi, host, folder, status `ready` / `busy` / `offline`, jumlah agent yang sedang jalan, dan prompt terakhir. Sesi offline bisa dihapus dengan tombol *forget* |
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
| Lounge | mesin kopi, teh, meja bundar, sofa | agent masih jalan tapi idle (server menandainya stale setelah 2 menit tanpa tool call) |

Agent yang sudah selesai keluar lewat pintu di bawah lorong, jadi kantor hanya berisi agent yang masih jalan. Centang **show finished agents** untuk menampilkan agent yang sudah selesai juga.

**Klik karakter** (atau kartu di mode Text) untuk membuka panel detail. Isinya: tugas lengkap yang diberikan saat agent di-spawn, setiap tool call beserta hasilnya, pesan agent, dan hasil akhir. Data ini dibaca dari transcript subagent milik Claude Code (`<session>/subagents/agent-<id>.jsonl`). Di panel itu juga ada kolom **nama**: nama yang kamu isi tersimpan di `state.json` dan muncul di atas kepala karakter. Kalau belum diberi nama, yang dipakai adalah `description` dari Agent tool, lalu tipe agent.

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
curl -N -H "Authorization: Bearer <api_token>" http://127.0.0.1:9761/api/stream
```

Setiap event tiba sebagai:

```text
data: {"event":"agent.spawn","ts":"...","agent":{...}}

data: {"event":"agent.stop","ts":"...","agent":{...}}

data: {"event":"session.update","session":{"session_id":"...","status":"busy",...}}
```

Event lain: `session.new`, `agent.activity`, `agent.idle`, `agent.renamed`, `chat.*`, `approval.*`, `yolo`.

Ada heartbeat `: ping` tiap 15 detik agar koneksi idle tidak diputus proxy.
Di browser cukup `new EventSource('/api/stream')` (dipakai dashboard).
Mengembalikan `403` bila transport `sse` dimatikan.

### 3. socket.io

Server mengaktifkan socket.io otomatis bila dependency terinstal
(sudah ada di `package.json` — `npm install` sekali di folder plugin).
Client (socket.io v4):

```js
const { io } = require("socket.io-client");
const s = io("http://127.0.0.1:9761", { auth: { token: "<api_token>" } });
s.on("hello", (m) => console.log("connected", m));
s.on("agent-event", (e) => console.log(e.event, e.agent.agent_id));
```

---

## 🔐 Login dan keamanan

Waktu pertama kali jalan, server membuat `auth.json` di folder state (`%TEMP%/claude-agent-monitor/` di Windows, `/tmp/claude-agent-monitor/` di Linux/macOS). Isinya empat rahasia acak:

| Kunci | Env pengganti | Dipakai oleh | Boleh apa |
|-------|---------------|--------------|-----------|
| `password` | `AGENT_MONITOR_PASSWORD` | kamu, di halaman `/login` | semua fitur dashboard |
| `api_token` | `AGENT_MONITOR_TOKEN` | aplikasi lain dan MCP tools (`Authorization: Bearer …`) | semua REST API |
| `client_token` | `AGENT_MONITOR_CLIENT_TOKEN` | hook Claude Code di mesin mana pun | hanya `POST /api/ingest` (melapor sesi, prompt, agent, tool) |
| `secret` | (hanya di file) | server | menandatangani cookie login |

Lihat password-mu:

```powershell
Get-Content "$env:TEMP\claude-agent-monitor\auth.json"
```

Aturan yang berlaku untuk semua endpoint selain `/__health` dan `/login`:

- **Tidak ada lagi pengecualian localhost.** Request dari 127.0.0.1 juga harus login atau membawa token.
- Cookie login bersifat `HttpOnly` dan `SameSite=Strict`, berlaku 30 hari. Mengganti password otomatis mengeluarkan semua browser.
- Request dari browser dengan `Origin` situs lain ditolak (403), dan body POST harus `application/json` (selain itu 415). Akibatnya halaman web lain tidak bisa menyalakan YOLO atau mengirim prompt.
- Login gagal 5 kali dari IP yang sama akan diblokir sementara, mulai 1 menit dan naik bertahap sampai 15 menit.
- Setiap prompt run mendapat secret sendiri. `approval-mcp.js` hanya bisa membuat dan memantau approval miliknya sendiri. Run tidak bisa menyetujui approval atau menyalakan YOLO, dan `AGENT_MONITOR_TOKEN`/`PASSWORD` tidak diwariskan ke run.
- Kartu approval menampilkan **seluruh** input tool (misalnya isi file pada Write/Edit), bukan hanya path-nya.
- Folder kerja prompt dibatasi oleh `AGENT_MONITOR_CWD_ROOTS`.

Kalau server dibuka lewat HTTPS (misalnya di balik reverse proxy), set `AGENT_MONITOR_SECURE_COOKIE=1`. Kalau dashboard dibuka dari origin lain (domain proxy), tambahkan origin itu ke `AGENT_MONITOR_ORIGINS`.

---

## 🖧 Mode server pusat: banyak Claude Code, satu dashboard

Server ini bisa jadi pusat untuk semua Claude Code-mu, baik di laptop yang sama maupun di mesin lain. Setiap Claude Code yang memasang plugin ini menjadi **client**:

- Saat dibuka, sesinya muncul sebagai kartu **ready**. Buka 10 Claude Code, maka akan ada 10 kartu ready.
- Saat kamu mengirim prompt, kartunya berubah jadi **busy** dan menampilkan prompt terakhir.
- Saat sesi itu men-spawn subagent, agent-agent tersebut muncul di dashboard dan pixel office, lengkap dengan host dan sesi asalnya.
- Kalau sudah 30 menit tanpa event, statusnya jadi **offline**.

### 1. Jalankan server di mesin pusat

```bash
git clone https://github.com/Cloud-Dark/agent-visibility
cd agent-visibility/plugins/agent-monitoring
npm install                      # opsional, untuk socket.io
AGENT_MONITOR_HOST=0.0.0.0 node server.js
cat /tmp/claude-agent-monitor/auth.json   # catat password dan client_token
```

### 2. Arahkan setiap Claude Code ke server itu

Di setiap mesin client, pasang plugin seperti biasa, lalu set dua env sebelum membuka Claude Code:

```powershell
$env:AGENT_MONITOR_URL = "http://192.168.1.10:9761"     # alamat server pusat
$env:AGENT_MONITOR_CLIENT_TOKEN = "<client_token dari auth.json server>"
claude
```

Dengan `AGENT_MONITOR_URL` diset, plugin **tidak** menyalakan server lokal. Hook hanya melapor ke server pusat. MCP tools (`agents_list`, `sessions_list`, dan lainnya) juga membaca dari server pusat, dengan syarat `AGENT_MONITOR_TOKEN` diisi `api_token` server.

Tanpa `AGENT_MONITOR_URL`, semuanya berjalan seperti sebelumnya: server lokal di `127.0.0.1:9761`, dan semua Claude Code di laptop ini otomatis melapor ke sana.

> ⚠️ Lalu lintas client ke server berupa HTTP biasa. Di jaringan yang tidak kamu percayai, pasang server di balik HTTPS (reverse proxy), lalu pakai `https://…` di `AGENT_MONITOR_URL` dan `AGENT_MONITOR_SECURE_COOKIE=1`.

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

> ⚠️ `0.0.0.0` membuka server ke jaringan lokalmu. Dashboard tetap butuh login dan API tetap butuh token, tapi koneksinya HTTP biasa. Untuk jaringan publik, pakai HTTPS di depannya.

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

Aplikasi lain memakai `api_token` dari `auth.json` (atau `AGENT_MONITOR_TOKEN`) sebagai header `Authorization: Bearer <token>`, termasuk dari localhost. Dashboard memakai login password. Detailnya ada di [Login dan keamanan](#-login-dan-keamanan).

| Env | Default | Fungsi |
|-----|---------|--------|
| `AGENT_MONITOR_TOKEN` | `api_token` di auth.json | Token REST API untuk aplikasi lain dan MCP tools |
| `AGENT_MONITOR_PASSWORD` | `password` di auth.json | Password login dashboard |
| `AGENT_MONITOR_CLIENT_TOKEN` | `client_token` di auth.json | Token hook Claude Code untuk `/api/ingest` |
| `AGENT_MONITOR_URL` | kosong (server lokal) | Alamat server pusat; kalau diset, plugin hanya menjadi client |
| `AGENT_MONITOR_CWD_ROOTS` | `AGENT_MONITOR_CWD` | Folder yang boleh dipakai sebagai `cwd` prompt (pisahkan dengan `;` di Windows, `:` di Linux/macOS) |
| `AGENT_MONITOR_ORIGINS` | kosong | Origin browser tambahan yang diizinkan, dipisah koma |
| `AGENT_MONITOR_SECURE_COOKIE` | kosong | `1` untuk menambah flag `Secure` pada cookie (pakai di balik HTTPS) |
| `AGENT_MONITOR_CWD` | folder server | Folder kerja default untuk run |
| `AGENT_MONITOR_CHAT_MODE` | `default` | `--permission-mode` untuk run |
| `AGENT_MONITOR_MAX_RUNS` | `3` | Maksimal run yang berjalan bersamaan |

---

## 📡 REST API

Semua endpoint kecuali `/__health`, `/login`, dan `/api/login` membutuhkan cookie login atau `Authorization: Bearer <api_token>`. Body POST/PUT/DELETE harus `application/json`.

| Method & path | Fungsi |
|---------------|--------|
| `GET /` | Dashboard (redirect ke `/login` kalau belum login) |
| `GET /login`, `POST /api/login`, `POST /api/logout` | Login dan logout `{"password":"…"}` |
| `POST /api/ingest` | **Client token.** Event dari hook Claude Code: `session-start`, `prompt`, `subagent-start`, `subagent-stop`, `tool`, `session-end` |
| `GET /api/sessions` | Daftar Claude Code yang terhubung |
| `DELETE /api/sessions/<id>` | Hapus sesi dari daftar |
| `GET /__health` | `{"monitor":"claude-agent-monitor","port":9761,"host":"…","pid":…}` — dipakai deteksi "port milik siapa" |
| `GET /api/agents` | Daftar agent (terbaru dulu) + `sessions` + `server` (port, host, lan_ips, pid, uptime, socketio, transports) + webhooks + transports |
| `GET /api/agents/<id>` | Detail satu agent: tugas, timeline tool + hasil, hasil akhir |
| `PUT /api/agents/<id>/name` | `{"name":"Budi"}` — beri nama agent (kosong = reset) |
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
| `sessions_list` | Claude Code yang terhubung: host, folder, status, agent yang jalan |
| `monitor_status` | URL server, port, pid, uptime, sesi online, hitungan running/done, jumlah webhook |
| `events_recent {limit?}` | Event terakhir |
| `webhook_add/list/remove` | Kelola webhook |
| `transports_get/set` | Lihat/ubah koneksi aktif |

Contoh: *"agent apa saja yang running?"* → Claude memanggil `agents_list
{status:"running"}`. MCP server memanggil REST API server (lokal atau `AGENT_MONITOR_URL`) dengan `api_token`, jadi isinya sama dengan dashboard.

---

## ⚙️ Cara kerja

```text
Claude Code (mesin mana pun, satu atau banyak)
 ├─ SessionStart ──▶ ensure-server.js ──▶ server.js lokal (kalau AGENT_MONITOR_URL kosong)
 │                └▶ report.js session-start ─┐
 ├─ UserPromptSubmit ──▶ report.js prompt ─────┤
 ├─ SubagentStart / SubagentStop ──▶ report.js ┤  POST /api/ingest  (client token)
 ├─ PostToolUse ──▶ report.js tool ────────────┤
 └─ SessionEnd ──▶ report.js session-end ──────┘
                                               ▼
                              server.js: registry di memori (satu-satunya penulis)
                               ├─ state.json (disimpan berkala)
                               ├─ broadcast SSE / socket.io / webhook
                               └─ dashboard, REST API, MCP tools (login / api token)
```

Sejak v0.6.0 hook tidak lagi menulis `state.json` langsung. Semua event dikirim ke server dan diproses berurutan. Karena itu event tool yang datang terlambat tidak bisa lagi mengubah agent yang sudah `done` kembali menjadi `running`, dan event paralel tidak saling menimpa.

File runtime (tidak di-commit) ada di `%TEMP%/claude-agent-monitor/`:
- `state.json`: agent, sesi, event, webhook, transports
- `server.json`: pid, port, host
- `auth.json`: password dan token
- `monitor.log`: log yang dirotasi pada 100 KB. Lihat file ini kalau server bermasalah.

### Kenapa "Claude nyala tapi server mati"?

Dulu `ensure-server.js` me-restart server **setiap** prompt (SessionStart +
UserPromptSubmit), sehingga proses yang baru dicek sering membunuh proses
yang baru dinyalakan → flapping. Sekarang: server yang sehat **dipakai
ulang** (reuse), restart hanya bila pid file menunjuk proses yang sudah
mati. `UserPromptSubmit` berjalan `--quiet` (hanya tulis log, tidak
mencetak ke terminal) dan pesan dashboard hanya muncul sekali saat sesi
dimulai.

`ensure-server.js` juga tidak lagi membunuh proses berdasarkan pid lama. Setelah reboot, pid itu bisa milik program lain. Port yang menjawab lambat dianggap terpakai, bukan kosong. Pada `UserPromptSubmit` (`--quiet`), hanya port yang tersimpan yang dicek, jadi prompt tidak pernah tertahan oleh pemindaian port.

---

## 🧪 Test manual (tanpa spawn agent asli)

```powershell
node plugins\agent-monitoring\hooks\ensure-server.js
1..5 | % { (@{session_id="11111111-2222-3333-4444-555555555555"; agent_id="test-agent-$_"; agent_type="Explore"} | ConvertTo-Json -Compress) | node plugins\agent-monitoring\hooks\report.js subagent-start }
$tok = (Get-Content "$env:TEMP\claude-agent-monitor\auth.json" | ConvertFrom-Json).api_token
(Invoke-RestMethod http://127.0.0.1:9761/api/agents -Headers @{Authorization="Bearer $tok"}).agents | ft agent_id, agent_type, status
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
   ├─ mcp-server.js                         ← 10 MCP tools (stdio), lewat REST API
   ├─ approval-mcp.js                       ← permission-prompt tool: Approve/Reject/YOLO dari dashboard (pakai run secret)
   ├─ hooks/
   │  ├─ hooks.json                         ← SessionStart, UserPromptSubmit, SubagentStart/Stop, PostToolUse, SessionEnd
   │  ├─ ensure-server.js                   ← auto-start server lokal + aturan port (dilewati kalau AGENT_MONITOR_URL diset)
   │  └─ report.js                          ← kirim event hook ke POST /api/ingest
   ├─ lib/
   │  ├─ store.js                          ← path state, state.json, webhook POST, stdin JSON
   │  ├─ registry.js                       ← sesi + agent di memori, satu-satunya penulis state
   │  ├─ auth.js                           ← auth.json, password, token, cookie login
   │  ├─ client.js                         ← HTTP client untuk hook dan MCP (lokal atau server pusat)
   │  ├─ summarize.js                      ← ringkasan satu baris per tool call
   │  ├─ chat.js                           ← Prompt API: run claude -p, approvals, YOLO
   │  └─ agentinfo.js                      ← baca transcript subagent untuk panel detail
   └─ public/
      ├─ index.html                        ← dashboard
      ├─ login.html                        ← halaman login
      └─ pixel.js                          ← tampilan Pixel office (canvas 2D)
```

---

## 🔧 Troubleshooting

| Gejala | Penyebab & solusi |
|--------|-------------------|
| Dashboard tidak bisa dibuka | Cek `%TEMP%/claude-agent-monitor/monitor.log`; pastikan sesi Claude baru dimulai (SessionStart). Prompt berikutnya menyalakan ulang via watchdog |
| Port 9761 dipakai app lain | Otomatis pindah 9762+ — lihat URL di terminal saat sesi mulai |
| Agent tidak tercatat | Hook `SubagentStart` butuh sesi baru setelah install/update plugin |
| `activity` kosong | Hook `PostToolUse` hanya mencatat tool Read/Write/Edit/Bash/PowerShell/Glob/Grep/Task/Agent/TodoWrite/WebFetch/WebSearch. Tool di sesi utama membuat sesinya `busy`, tapi tidak membuat agent |
| socket.io "not installed" | `npm install` di `plugins/agent-monitoring/` |
| Lupa password dashboard | Lihat `auth.json` di folder state, atau set `AGENT_MONITOR_PASSWORD` lalu restart server |
| Client di mesin lain tidak muncul | Cek `AGENT_MONITOR_URL` bisa diakses dari mesin itu dan `AGENT_MONITOR_CLIENT_TOKEN` sama dengan `client_token` server. Pesan `reporting to …` atau `not reachable` muncul di awal sesi |
| MCP tools `rejected the API token` | Untuk server pusat, set `AGENT_MONITOR_TOKEN` ke `api_token` server |
| Data lama menumpuk | Hapus `%TEMP%/claude-agent-monitor/state.json` (atau seluruh foldernya) |

---

## 📄 Lisensi

MIT — bebas pakai, ubah, dan bagikan.
