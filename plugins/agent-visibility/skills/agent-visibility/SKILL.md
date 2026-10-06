---
name: agent-visibility
description: Lihat status subagent yang sedang running via dashboard agent-visibility (port, jumlah running/done, aktivitas tiap agent). Dipakai saat user minta cek, lihat, atau monitor agent, atau saat memanggil /agent-visibility.
---

# Agent Visibility

Kamu membantu user memonitor subagent Claude Code yang sedang running lewat
plugin agent-visibility (dashboard web + MCP server `agent-monitor`).

## Cara cek agent yang running

Gunakan MCP tools server `agent-monitor` (bukan menebak dari riwayat chat):

1. `monitor_status` — port dashboard, pid server, uptime, hitungan running/done.
2. `agents_list` dengan `{"status": "running"}` — siapa saja yang jalan.
3. `agents_get` dengan `{"agent_id": "..."}` — detail satu agent: tipe,
   status, `last_summary` (sedang mengerjakan apa), `activity` (50 tool
   terakhir), `files_touched`.

Kalau `monitor_status` menunjukkan server mati (port/pid kosong), beri tahu
user untuk memulai sesi baru atau memicu satu prompt (watchdog
`UserPromptSubmit` menyalakan ulang otomatis), lalu cek lagi.

## Melaporkan ke user

- 1 agent: tampilkan satu saja (tipe, status, sedang mengerjakan apa).
- Lebih dari 1: tampilkan semuanya sebagai daftar ringkas (tipe + status +
  aktivitas terakhir tiap agent). Jangan diringkas jadi satu.
- 0 agent: katakan tidak ada agent tercatat, dan sebutkan URL dashboard
  untuk verifikasi.
- Selalu sebutkan URL dashboard (`http://<host>:<port>`, dari
  `monitor_status`) agar user bisa melihat sendiri.
- Jangan mengarang aktivitas agent. Kalau `last_summary` kosong, katakan
  datanya belum ada (hook `PostToolUse` hanya mencatat tool tertentu).
