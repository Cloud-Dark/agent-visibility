"use strict";
// Pixel office view: every agent is a little worker who walks to the room
// that matches what it is doing right now. All art is drawn with
// fillRect on a 320x200 canvas (no image files), scaled up crisp.
//   coding lab : Read/Edit/Write/Grep/Glob/Task/TodoWrite (think, code)
//   deploy room: Bash (build, test, git, deploy)
//   studio     : WebFetch/WebSearch, media/content files
//   lounge     : finished, stale, or no recent activity (idle)
(function () {
  const W = 320, H = 200;
  const ACTIVE_MS = 45 * 1000; // newer than this = working, older = idle

  const C = {
    floorA: "#e9d8b4", floorB: "#e2cfa6", wall: "#5b4a6b", wallTop: "#7a6690", line: "#3b2f47",
    wood: "#9c6b3f", woodDark: "#6e4626", metal: "#8792a2", metalDark: "#4d5563",
    screen: "#1f2a44", glow: "#7ee787", glowB: "#79c0ff", red: "#ff7b72", amber: "#f2cc60",
    plant: "#3fa34d", plantDark: "#2a7236", pot: "#b5603c", white: "#f5f5f5",
    rugLounge: "#c78bb8", rugStudio: "#e8a33d", cup: "#ffffff", tea: "#7cc576", coffee: "#6b3e26",
    skin: ["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffdbac"],
    shirt: ["#e5534b", "#4493f8", "#3fb950", "#d29922", "#a371f7", "#db61a2", "#2bb5c2", "#f0883e"],
    hair: ["#2d1b0e", "#6b3e26", "#e3c16f", "#111111", "#b55239", "#5a5a5a"],
  };

  // Rooms: x,y,w,h in canvas pixels; "spots" are where workers stand.
  const ROOMS = {
    coding: { name: "CODING LAB", sub: "think · code", x: 4, y: 22, w: 154, h: 84, color: "#4493f8" },
    deploy: { name: "DEPLOY ROOM", sub: "bash · build · ship", x: 162, y: 22, w: 154, h: 84, color: "#3fb950" },
    lounge: { name: "LOUNGE", sub: "idle · coffee · tea", x: 4, y: 110, w: 154, h: 86, color: "#db61a2" },
    studio: { name: "STUDIO", sub: "web · content", x: 162, y: 110, w: 154, h: 86, color: "#f0883e" },
  };
  // Seats/standing spots per room (relative to room origin).
  const SPOTS = {
    coding: [[22, 52], [52, 52], [82, 52], [112, 52], [37, 72], [67, 72], [97, 72], [127, 72]],
    deploy: [[24, 54], [54, 54], [84, 54], [114, 54], [40, 74], [70, 74], [100, 74], [130, 74]],
    lounge: [[40, 50], [70, 50], [40, 72], [70, 72], [112, 44], [126, 60], [112, 76], [20, 62]],
    studio: [[30, 56], [60, 60], [94, 56], [124, 60], [44, 76], [78, 78], [112, 78], [136, 40]],
  };

  const canvas = document.getElementById("pixel");
  if (!canvas) return;
  const SCALE = 4;
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const tip = document.getElementById("pixeltip");

  const workers = new Map(); // agent_id -> worker
  let agents = [];
  let frame = 0;
  let hover = null;

  const r = (x, y, w, h, c) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  };

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  // ---- classify what an agent is doing ----
  function lastTool(a) {
    const act = a.activity || [];
    return act.length ? act[act.length - 1] : null;
  }

  function zoneFor(a) {
    if (a.status !== "running" || a.stale) return "lounge";
    const ref = Date.parse(a.last_activity_at || a.started_at || 0);
    if (!ref || Date.now() - ref > ACTIVE_MS) return a.last_activity_at ? "lounge" : "coding";
    const t = lastTool(a);
    if (!t) return "coding";
    const tool = t.tool || "";
    const sum = String(t.summary || "").toLowerCase();
    if (tool === "Bash" || tool === "PowerShell") return "deploy";
    if (tool === "WebFetch" || tool === "WebSearch") return "studio";
    if (/\.(png|jpe?g|gif|svg|webp|mp4|mov|mp3|wav|psd|fig)\b/.test(sum)) return "studio";
    if (/\b(video|thumbnail|caption|podcast|content|post|blog|social)\b/.test(sum)) return "studio";
    return "coding";
  }

  function moodFor(a, zone) {
    if (a.status !== "running") return "done";
    if (a.stale) return "stale";
    if (zone === "lounge") return "idle";
    return "working";
  }

  // ---- worker state ----
  function syncWorkers() {
    const seen = new Set();
    const taken = { coding: 0, deploy: 0, lounge: 0, studio: 0 };
    // Running first so they get the best seats.
    const ordered = [...agents].sort((a, b) => (a.status === "running" ? -1 : 1) - (b.status === "running" ? -1 : 1));
    for (const a of ordered.slice(0, 32)) {
      seen.add(a.agent_id);
      const zone = zoneFor(a);
      const spots = SPOTS[zone];
      const idx = taken[zone]++;
      const room = ROOMS[zone];
      const [sx, sy] = spots[idx % spots.length];
      const lap = Math.floor(idx / spots.length);
      const tx = room.x + sx + lap * 6;
      const ty = room.y + sy - lap * 4;
      let w = workers.get(a.agent_id);
      const h = hash(a.agent_id);
      if (!w) {
        w = {
          id: a.agent_id,
          x: ROOMS.lounge.x + 76, y: ROOMS.lounge.y + 4,
          skin: C.skin[h % C.skin.length],
          shirt: C.shirt[(h >> 3) % C.shirt.length],
          hair: C.hair[(h >> 7) % C.hair.length],
          phase: h % 60,
        };
        workers.set(a.agent_id, w);
      }
      w.tx = tx;
      w.ty = ty;
      w.zone = zone;
      w.mood = moodFor(a, zone);
      w.agent = a;
    }
    for (const id of [...workers.keys()]) if (!seen.has(id)) workers.delete(id);
  }

  // Different room: walk down/up to the hallway, along it, then into the
  // target room. Same room: walk straight to the spot.
  const HALL_Y = 108;
  const roomOf = (x, y) => (y < HALL_Y ? "t" : "b") + (x < 160 ? "l" : "r");
  function step(w) {
    let gx = w.tx, gy = w.ty;
    if (roomOf(w.x, w.y) !== roomOf(w.tx, w.ty) && Math.abs(w.y - HALL_Y) > 0.5) {
      gx = w.x; gy = HALL_Y; // leg 1: to the hallway
    } else if (Math.abs(w.y - HALL_Y) <= 0.5 && Math.abs(w.x - w.tx) > 0.5) {
      gx = w.tx; gy = HALL_Y; // leg 2: along the hallway
    }
    const dx = gx - w.x, dy = gy - w.y;
    const d = Math.hypot(dx, dy);
    w.moving = d > 0.5 || gx !== w.tx || gy !== w.ty;
    if (d > 0.5) {
      w.x += (dx / d) * Math.min(0.9, d);
      w.y += (dy / d) * Math.min(0.9, d);
      if (Math.abs(dx) > 0.3) w.face = dx > 0 ? 1 : -1;
    } else {
      w.x = gx;
      w.y = gy;
    }
  }

  // ---- drawing: rooms and furniture ----
  function floor(room, rug) {
    for (let y = room.y; y < room.y + room.h; y += 8) {
      for (let x = room.x; x < room.x + room.w; x += 8) {
        r(x, y, 8, 8, ((x + y) / 8) % 2 ? C.floorA : C.floorB);
      }
    }
    r(room.x, room.y, room.w, 14, C.wall);
    r(room.x, room.y, room.w, 2, C.wallTop);
    r(room.x, room.y + 14, room.w, 1, C.line);
    if (rug) r(room.x + rug[0], room.y + rug[1], rug[2], rug[3], rug[4]);
  }

  function label(room) {
    r(room.x + 3, room.y + 3, 4, 8, room.color);
    ctx.textBaseline = "top";
    ctx.fillStyle = C.white;
    ctx.font = "bold 6px monospace";
    ctx.fillText(room.name, room.x + 10, room.y + 2);
    const nameW = ctx.measureText(room.name).width;
    ctx.fillStyle = "rgba(255,255,255,.6)";
    ctx.font = "4px monospace";
    ctx.fillText(room.sub, room.x + 14 + nameW, room.y + 3.5);
  }

  function plant(x, y) {
    r(x + 1, y + 8, 6, 5, C.pot);
    r(x, y + 7, 8, 2, "#8a4a2e");
    r(x + 2, y, 4, 8, C.plant);
    r(x, y + 2, 3, 4, C.plantDark);
    r(x + 5, y + 1, 3, 4, C.plantDark);
  }

  function desk(x, y, lit, col) {
    r(x, y + 6, 20, 4, C.wood);
    r(x, y + 10, 2, 5, C.woodDark);
    r(x + 18, y + 10, 2, 5, C.woodDark);
    r(x + 5, y - 3, 10, 8, C.metalDark);
    r(x + 6, y - 2, 8, 6, lit ? C.screen : "#2b2b2b");
    if (lit && frame % 30 < 22) {
      r(x + 7, y - 1, 4, 1, col);
      r(x + 7, y + 1, 6, 1, col);
      r(x + 7, y + 3, 3, 1, col);
    }
    r(x + 9, y + 5, 2, 1, C.metalDark);
  }

  function drawCoding() {
    const R = ROOMS.coding;
    floor(R);
    label(R);
    // whiteboard with diagram
    r(R.x + 104, R.y + 17, 44, 20, C.white);
    r(R.x + 104, R.y + 17, 44, 1, C.metal);
    r(R.x + 108, R.y + 22, 8, 5, C.glowB);
    r(R.x + 126, R.y + 22, 8, 5, C.red);
    r(R.x + 116, R.y + 24, 10, 1, C.line);
    r(R.x + 117, R.y + 30, 12, 4, C.glow);
    // bookshelf
    r(R.x + 6, R.y + 16, 18, 20, C.woodDark);
    for (let i = 0; i < 3; i++) {
      r(R.x + 7, R.y + 18 + i * 6, 16, 4, ["#e5534b", "#4493f8", "#d29922"][i]);
      r(R.x + 7, R.y + 22 + i * 6, 16, 1, C.wood);
    }
    const busy = countIn("coding");
    SPOTS.coding.slice(0, 4).forEach(([sx, sy], i) => desk(R.x + sx - 10, R.y + sy - 16, i < busy, C.glowB));
    plant(R.x + 140, R.y + 66);
  }

  function serverRack(x, y, on) {
    r(x, y, 14, 30, C.metalDark);
    r(x + 1, y + 1, 12, 28, "#2a2f3a");
    for (let i = 0; i < 5; i++) {
      r(x + 2, y + 3 + i * 5, 10, 3, "#39404d");
      const blink = on && (frame + i * 7 + x) % 20 < 10;
      r(x + 9, y + 4 + i * 5, 2, 1, blink ? C.glow : "#245c2c");
      r(x + 3, y + 4 + i * 5, 1, 1, on && (frame + i * 3) % 14 < 7 ? C.amber : "#5c4a1a");
    }
  }

  function drawDeploy() {
    const R = ROOMS.deploy;
    floor(R);
    label(R);
    const on = countIn("deploy") > 0;
    for (let i = 0; i < 4; i++) serverRack(R.x + 92 + i * 15, R.y + 17, true);
    // big status monitor
    r(R.x + 8, R.y + 17, 40, 22, C.metalDark);
    r(R.x + 10, R.y + 19, 36, 18, C.screen);
    const bars = [6, 10, 4, 12, 8, 11];
    bars.forEach((b, i) => {
      const hh = on ? ((b + frame / 6 + i * 3) % 12) + 2 : 2;
      r(R.x + 13 + i * 5, R.y + 35 - hh, 3, hh, on ? C.glow : "#245c2c");
    });
    // pipeline lights: build / test / ship
    ["BUILD", "TEST", "SHIP"].forEach((t, i) => {
      const lit = on && Math.floor(frame / 20) % 3 >= i;
      r(R.x + 54, R.y + 19 + i * 7, 4, 4, lit ? C.glow : "#3a3a3a");
      ctx.fillStyle = "rgba(255,255,255,.75)";
      ctx.font = "5px monospace";
      ctx.fillText(t, R.x + 60, R.y + 19 + i * 7);
    });
    const busy = countIn("deploy");
    SPOTS.deploy.slice(0, 4).forEach(([sx, sy], i) => desk(R.x + sx - 10, R.y + sy - 16, i < busy, C.glow));
    // cables
    r(R.x + 90, R.y + 47, 60, 1, C.line);
    r(R.x + 150, R.y + 47, 1, 30, C.line);
  }

  function steam(x, y) {
    const t = frame % 40;
    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.fillRect(x + (t < 20 ? 0 : 1), y - (t % 20) / 4, 1, 2);
    ctx.fillRect(x + 2 + (t < 20 ? 1 : 0), y - 1 - ((t + 10) % 20) / 4, 1, 2);
  }

  function drawLounge() {
    const R = ROOMS.lounge;
    floor(R, [8, 28, 90, 52, C.rugLounge]);
    label(R);
    // round table + cups
    const tx = R.x + 55, ty = R.y + 58;
    r(tx - 10, ty - 4, 20, 8, C.wood);
    r(tx - 8, ty - 6, 16, 2, C.wood);
    r(tx - 8, ty + 4, 16, 2, C.woodDark);
    r(tx - 1, ty + 6, 2, 4, C.woodDark);
    r(tx - 6, ty - 5, 3, 3, C.cup);
    r(tx - 5, ty - 4, 1, 1, C.coffee);
    r(tx + 3, ty - 5, 3, 3, C.cup);
    r(tx + 4, ty - 4, 1, 1, C.tea);
    steam(tx - 5, ty - 7);
    steam(tx + 4, ty - 7);
    // sofa
    r(R.x + 104, R.y + 30, 40, 8, "#7d4e9e");
    r(R.x + 104, R.y + 38, 40, 6, "#9b6bbf");
    r(R.x + 102, R.y + 32, 4, 12, "#6a3d8a");
    r(R.x + 142, R.y + 32, 4, 12, "#6a3d8a");
    // coffee machine + tea counter on the wall
    r(R.x + 8, R.y + 17, 46, 10, C.woodDark);
    r(R.x + 10, R.y + 12, 10, 12, C.metalDark);
    r(R.x + 12, R.y + 14, 6, 3, C.red);
    r(R.x + 13, R.y + 20, 4, 3, C.cup);
    ctx.fillStyle = C.white;
    ctx.font = "5px monospace";
    ctx.fillText("COFFEE", R.x + 22, R.y + 18);
    r(R.x + 44, R.y + 14, 6, 8, "#d0e8d0");
    r(R.x + 45, R.y + 12, 4, 2, C.tea);
    steam(R.x + 14, R.y + 11);
    plant(R.x + 140, R.y + 70);
    plant(R.x + 4, R.y + 70);
  }

  function drawStudio() {
    const R = ROOMS.studio;
    floor(R, [20, 34, 120, 46, C.rugStudio]);
    label(R);
    // ON AIR sign
    const live = countIn("studio") > 0;
    r(R.x + 110, R.y + 3, 30, 8, live && frame % 40 < 28 ? C.red : "#5a2a2a");
    ctx.fillStyle = C.white;
    ctx.font = "bold 5px monospace";
    ctx.fillText("ON AIR", R.x + 114, R.y + 5);
    // green screen
    r(R.x + 50, R.y + 16, 50, 22, "#2ea043");
    r(R.x + 50, R.y + 16, 50, 1, "#1a6b2b");
    // camera on tripod
    const cx = R.x + 74, cy = R.y + 54;
    r(cx, cy, 10, 6, "#222");
    r(cx + 10, cy + 1, 3, 4, "#444");
    r(cx + 2, cy + 1, 2, 2, live && frame % 20 < 10 ? C.red : "#550000");
    r(cx + 4, cy + 6, 1, 10, C.metal);
    r(cx + 1, cy + 15, 7, 1, C.metal);
    // ring light
    r(R.x + 20, R.y + 22, 12, 12, C.amber);
    r(R.x + 23, R.y + 25, 6, 6, R.color && "#fff3c4");
    r(R.x + 25, R.y + 34, 2, 14, C.metal);
    // mic
    r(R.x + 120, R.y + 30, 4, 6, "#333");
    r(R.x + 121, R.y + 36, 2, 12, C.metal);
    // edit desk
    desk(R.x + 118, R.y + 58, live, C.amber);
    plant(R.x + 4, R.y + 74);
  }

  // ---- drawing: workers ----
  function countIn(zone) {
    let n = 0;
    for (const w of workers.values()) if (w.zone === zone && !w.moving && w.mood === "working") n++;
    return n;
  }

  function worker(w) {
    const x = Math.round(w.x) - 4, y = Math.round(w.y) - 14;
    const bob = w.moving ? (Math.floor((frame + w.phase) / 6) % 2) : 0;
    const typing = !w.moving && w.mood === "working";
    const sleepy = w.mood === "idle" || w.mood === "stale" || w.mood === "done";
    // shadow
    ctx.fillStyle = "rgba(0,0,0,.18)";
    ctx.fillRect(x, y + 14, 8, 2);
    // legs
    const step = w.moving ? Math.floor((frame + w.phase) / 5) % 2 : 0;
    r(x + 1 + step, y + 11, 2, 3, "#2d3748");
    r(x + 5 - step, y + 11, 2, 3, "#2d3748");
    // body
    r(x, y + 6 - bob, 8, 6, w.shirt);
    // arms
    const armY = typing && (frame + w.phase) % 8 < 4 ? 7 : 8;
    r(x - 1, y + armY - bob, 1, 3, w.skin);
    r(x + 8, y + armY - bob, 1, 3, w.skin);
    // head
    r(x + 1, y - bob, 6, 6, w.skin);
    r(x + 1, y - bob, 6, 2, w.hair);
    r(x + (w.face === -1 ? 1 : 5), y + 2 - bob, 1, 1, w.hair);
    // eyes
    if (sleepy && !w.moving) {
      r(x + 2, y + 3 - bob, 1, 1, C.line);
      r(x + 5, y + 3 - bob, 1, 1, C.line);
    } else {
      r(x + 2, y + 2 - bob, 1, 2, C.line);
      r(x + 5, y + 2 - bob, 1, 2, C.line);
    }
    // status bubble
    if (!w.moving) bubble(w, x, y - bob);
    if (hover === w) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 2.5, y - 2.5, 13, 19);
    }
  }

  function bubble(w, x, y) {
    const by = y - 9 - (Math.floor((frame + w.phase) / 15) % 2);
    if (w.mood === "working") {
      r(x - 1, by, 10, 7, C.white);
      r(x + 2, by + 7, 2, 1, C.white);
      if (w.zone === "coding") {
        // thinking dots
        const n = Math.floor((frame + w.phase) / 10) % 4;
        for (let i = 0; i < 3; i++) r(x + 1 + i * 3, by + 3, 1, 1, i < n ? C.line : "#bbb");
      } else if (w.zone === "deploy") {
        r(x + 1, by + 2, 1, 1, C.line);
        r(x + 2, by + 3, 1, 1, C.line);
        r(x + 1, by + 4, 1, 1, C.line);
        r(x + 4, by + 4, 3, 1, frame % 20 < 10 ? C.line : C.white);
      } else if (w.zone === "studio") {
        r(x + 2, by + 2, 5, 3, C.red);
        r(x + 3, by + 3, 1, 1, C.white);
      }
    } else if (w.mood === "done") {
      r(x, by, 8, 7, C.glow);
      r(x + 2, by + 3, 1, 1, C.line);
      r(x + 3, by + 4, 1, 1, C.line);
      r(x + 4, by + 3, 1, 1, C.line);
      r(x + 5, by + 2, 1, 1, C.line);
    } else {
      // zzz
      ctx.fillStyle = w.mood === "stale" ? C.amber : "#9fb3c8";
      ctx.font = "bold 6px monospace";
      const t = Math.floor((frame + w.phase) / 20) % 3;
      ctx.fillText("z", x + 6 + t, by + 2 - t);
      if (t > 0) ctx.fillText("z", x + 2, by + 4);
    }
  }

  function hud() {
    const counts = { working: 0, idle: 0, done: 0 };
    for (const w of workers.values()) {
      if (w.mood === "working") counts.working++;
      else if (w.mood === "done") counts.done++;
      else counts.idle++;
    }
    r(0, 0, W, 18, "#1b1626");
    r(0, 18, W, 1, C.line);
    ctx.font = "bold 7px monospace";
    ctx.textBaseline = "top";
    ctx.fillStyle = C.white;
    ctx.fillText("AGENT OFFICE", 6, 6);
    const items = [["WORK", counts.working, C.glowB], ["IDLE", counts.idle, C.amber], ["DONE", counts.done, C.glow]];
    let x = 120;
    for (const [t, n, c] of items) {
      r(x, 6, 5, 5, c);
      ctx.fillStyle = C.white;
      ctx.fillText(`${t} ${n}`, x + 8, 6);
      x += 62;
    }
    if (!workers.size) {
      ctx.fillStyle = "rgba(255,255,255,.8)";
      ctx.font = "6px monospace";
      ctx.fillText("no agents yet: ask Claude to spawn some subagents", 52, 150);
    }
  }

  function drawWalls() {
    // hallway cross between the rooms
    r(158, 19, 4, H - 19, "#cbb894");
    r(0, 106, W, 4, "#cbb894");
    r(0, 19, 4, H, C.line);
    r(W - 4, 19, 4, H, C.line);
    r(0, H - 4, W, 4, C.line);
  }

  function render() {
    frame++;
    r(0, 0, W, H, "#cbb894");
    drawCoding();
    drawDeploy();
    drawLounge();
    drawStudio();
    drawWalls();
    for (const w of workers.values()) step(w);
    // depth sort: lower on screen draws later
    [...workers.values()].sort((a, b) => a.y - b.y).forEach(worker);
    hud();
    requestAnimationFrame(render);
  }

  // ---- interaction ----
  function pick(ev) {
    const rect = canvas.getBoundingClientRect();
    const mx = ((ev.clientX - rect.left) / rect.width) * W;
    const my = ((ev.clientY - rect.top) / rect.height) * H;
    let best = null;
    for (const w of workers.values()) {
      if (mx >= w.x - 6 && mx <= w.x + 6 && my >= w.y - 18 && my <= w.y + 3) best = w;
    }
    return best;
  }

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MOOD = { working: "working", idle: "idle", stale: "idle (no activity > 2 min)", done: "done" };

  function showTip(w, ev) {
    if (!tip) return;
    if (!w) {
      tip.style.display = "none";
      return;
    }
    const a = w.agent;
    const recent = (a.activity || []).slice(-4).reverse()
      .map((x) => `<div>${esc(String(x.ts).slice(11, 19))} ${esc(x.tool)} ${esc(String(x.summary || "").slice(0, 70))}</div>`).join("");
    tip.innerHTML = `<b>${esc(a.agent_type || "agent")}</b> · ${esc(MOOD[w.mood] || w.mood)} · ${esc(ROOMS[w.zone].name)}` +
      `<div class="mono">${esc(a.agent_id)}</div>` +
      (a.last_summary ? `<div>doing: ${esc(a.last_summary)}</div>` : "") +
      (recent ? `<div class="mono" style="margin-top:4px;opacity:.8">${recent}</div>` : "");
    const box = canvas.parentElement.getBoundingClientRect();
    tip.style.display = "block";
    tip.style.left = Math.min(ev.clientX - box.left + 12, box.width - 280) + "px";
    tip.style.top = ev.clientY - box.top + 12 + "px";
  }

  canvas.addEventListener("mousemove", (ev) => {
    hover = pick(ev);
    canvas.style.cursor = hover ? "pointer" : "default";
    showTip(hover, ev);
  });
  canvas.addEventListener("mouseleave", () => {
    hover = null;
    showTip(null);
  });

  window.pixelOffice = {
    update(list) {
      agents = Array.isArray(list) ? list : [];
      syncWorkers();
    },
  };
  requestAnimationFrame(render);
})();
