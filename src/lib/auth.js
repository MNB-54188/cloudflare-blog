// 密码哈希与登录会话（基于 Web Crypto，无第三方依赖）

import { parseCookies, randomHex, serializeCookie } from "./utils.js";

const enc = new TextEncoder();

/** PBKDF2 迭代次数：免费版 Worker 有 CPU 时间限制，2 万次是兼顾安全与性能的取值 */
const PBKDF2_ITERATIONS = 20000;

export const SESSION_COOKIE = "blog_session";
const SESSION_TTL_DAYS = 7;

export function toB64Url(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64Url(str) {
  const normalized = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(normalized);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2(password, saltBytes) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256
  );
  return toB64Url(bits);
}

/** 生成 盐 + 哈希 */
export async function createPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return { salt: toB64Url(salt), password_hash: hash };
}

/** 校验密码（恒定时间比较） */
export async function verifyPassword(password, saltB64, expectedHash) {
  try {
    const actual = await pbkdf2(password, fromB64Url(saltB64));
    if (actual.length !== expectedHash.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return toB64Url(sig);
}

let cachedSecret = null;

/** 会话密钥：优先环境变量，其次 D1 settings，最后自动生成并落库（全程零配置） */
export async function getSessionSecret(env) {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (cachedSecret) return cachedSecret;

  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'session_secret'").first();
    if (row?.value) {
      cachedSecret = row.value;
      return row.value;
    }
  } catch {
    /* 表尚未创建，走下面的生成逻辑 */
  }

  const generated = randomHex(32);
  try {
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('session_secret', ?) ON CONFLICT(key) DO NOTHING"
    )
      .bind(generated)
      .run();
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'session_secret'").first();
    cachedSecret = row?.value || generated;
  } catch {
    cachedSecret = generated;
  }
  return cachedSecret;
}

/** 生成登录 Cookie */
export async function buildSessionCookie(env, userId) {
  const secret = await getSessionSecret(env);
  const exp = Date.now() + SESSION_TTL_DAYS * 86400 * 1000;
  const payload = `${userId}.${exp}`;
  const sig = await hmac(secret, payload);
  return serializeCookie(SESSION_COOKIE, `${payload}.${sig}`, {
    maxAge: SESSION_TTL_DAYS * 86400,
  });
}

/** 清除登录 Cookie */
export function clearSessionCookie() {
  return serializeCookie(SESSION_COOKIE, "", { maxAge: 0 });
}

/** 解析并校验会话，返回 { uid } 或 null */
export async function readSession(request, env) {
  const token = parseCookies(request.headers.get("Cookie") || "")[SESSION_COOKIE];
  if (!token) return null;
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  const [uid, exp, sig] = parts;
  if (!uid || !exp || !sig) return null;
  if (Number(exp) < Date.now()) return null;
  try {
    const secret = await getSessionSecret(env);
    const expected = await hmac(secret, `${uid}.${exp}`);
    if (expected !== sig) return null;
    return { uid: Number(uid) };
  } catch {
    return null;
  }
}

/** 取当前登录用户（含资料），未登录返回 null */
export async function getCurrentUser(request, env) {
  const session = await readSession(request, env);
  if (!session) return null;
  try {
    const user = await env.DB.prepare(
      "SELECT id, username, display_name FROM users WHERE id = ?"
    )
      .bind(session.uid)
      .first();
    return user || null;
  } catch {
    return null;
  }
}

/** 是否已有管理员账号 */
export async function hasAnyUser(env) {
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
    return (row?.n || 0) > 0;
  } catch {
    return false;
  }
}
