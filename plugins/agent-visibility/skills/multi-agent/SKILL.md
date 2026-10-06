---
name: multi-agent
description: Spawn beberapa subagent paralel sekaligus untuk tugas yang bisa dibagi (mis. tulis beberapa dokumen, riset beberapa topik). Setiap agent tercatat otomatis di dashboard agent-visibility. Dipakai saat user memanggil /agent-visibility:multi-agent atau minta spawn banyak agent sekaligus.
---

# Multi Agent Spawn

Kamu men-spawn beberapa subagent paralel memakai tool `Agent`, lalu hasilnya
bisa dipantau user di dashboard agent-visibility.

## Aturan spawn

1. Tanya dulu (atau simpulkan dari permintaan) dua hal: **berapa agent**
   (default 3, maksimal 5) dan **pembagian tugas tiap agent** (harus
   non-overlapping, satu agent satu file/topik).
2. Jalankan semua pemanggilan `Agent` dalam **satu blok pesan** (satu tool
   call per pesan, berurutan dalam satu turn) agar mereka jalan paralel.
   Beri tiap agent `description` 3-5 kata yang jelas (muncul sebagai nama di
   monitoring) dan prompt yang mandiri (baca file sendiri, tulis file
   sendiri, sebutkan path absolut).
3. Setiap agent wajib me-return daftar file yang ditulisnya. Jangan
   menduplikasi pekerjaan agent lain, dan jangan menulis ke file yang sama.
4. Setelah semua selesai: verifikasi (cek file ada, cek sintaks), laporkan
   ringkas per agent, lalu arahkan user ke dashboard agent-visibility untuk
   melihat aktivitasnya.

## Contoh

User: "/agent-visibility:multi-agent tulis 3 dokumen: charter, PRD, arsitektur"

Jalankan 3 tool `Agent` sekaligus dalam satu blok, masing-masing dengan
prompt mandiri dan path output absolut yang berbeda.
