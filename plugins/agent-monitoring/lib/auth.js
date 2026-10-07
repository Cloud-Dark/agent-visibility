"use strict";
// Secrets for the monitor server, kept in <stateDir>/auth.json (mode 600).
// Created on first server start; env vars override each value:
//   password      AGENT_MONITOR_PASSWORD      dashboard login (humans)
//   api_token     AGENT_MONITOR_TOKEN         full REST API for other apps
//   client_token  AGENT_MONITOR_CLIENT_TOKEN  Claude Code clients: ingest only
//   secret        (file only)                 HMAC key for login cookies
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { stateDir, ensureDir } = require("./store");

const COOKIE = "am_auth";
const COOKIE_DAYS = 30;

const authFile = () => path.join(stateDir(), "auth.json");
const rand = (n) => crypto.randomBytes(n).toString("base64url");

function readFile() {
  try {
    return JSON.parse(fs.readFileSync(authFile(), "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

// Server side: load or create the secrets file.
function loadOrCreate() {
  let a = readFile();
  if (!a || !a.secret || !a.client_token || !a.api_token || !a.password) {
    a = {
      password: (a && a.password) || rand(9),
      api_token: (a && a.api_token) || rand(24),
      client_token: (a && a.client_token) || rand(24),
      secret: (a && a.secret) || rand(32),
      created_at: (a && a.created_at) || new Date().toISOString(),
    };
    ensureDir();
    fs.writeFileSync(authFile(), JSON.stringify(a, null, 2), { encoding: "utf8", mode: 0o600 });
  }
  return effective(a);
}

// Client side (hooks, MCP server): read only, never create.
function readLocal() {
  const a = readFile() || {};
  return effective(a);
}

function effective(a) {
  return {
    password: process.env.AGENT_MONITOR_PASSWORD || a.password || "",
    api_token: process.env.AGENT_MONITOR_TOKEN || a.api_token || "",
    client_token: process.env.AGENT_MONITOR_CLIENT_TOKEN || a.client_token || "",
    secret: a.secret || "",
    file: authFile(),
  };
}

function safeEqual(given, expected) {
  if (typeof given !== "string" || !given || !expected) return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// Cookie = "<expiry>.<hmac>". The HMAC covers the password hash, so
// changing the password logs every browser out.
function sign(auth, exp) {
  const pw = crypto.createHash("sha256").update(auth.password).digest("hex");
  return crypto.createHmac("sha256", auth.secret).update(`dash.${exp}.${pw}`).digest("base64url");
}

function makeCookie(auth, secure) {
  const exp = Date.now() + COOKIE_DAYS * 864e5;
  const value = `${exp}.${sign(auth, exp)}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_DAYS * 86400}${secure ? "; Secure" : ""}`;
}

const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function cookieValid(auth, header) {
  const v = parseCookies(header)[COOKIE];
  if (!v) return false;
  const dot = v.indexOf(".");
  const exp = Number(v.slice(0, dot));
  if (!exp || exp < Date.now()) return false;
  return safeEqual(v.slice(dot + 1), sign(auth, exp));
}

function bearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

module.exports = { loadOrCreate, readLocal, safeEqual, makeCookie, clearCookie, cookieValid, bearer, authFile };
