// 通用工具函数：转义、日期、slug、分页等

/** HTML 转义（所有动态内容输出前必须调用） */
export function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

const pad = (n) => String(n).padStart(2, "0");

/** 时间戳（毫秒）→ 东八区日期 2026-11-06 */
export function formatDate(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts) + 8 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 时间戳 → 2026-11-06 13:22 */
export function formatDateTime(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts) + 8 * 3600 * 1000);
  return `${formatDate(ts)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 相对时间：刚刚 / 3 分钟前 / 2 天前 */
export function relativeTime(ts) {
  if (!ts) return "";
  const diff = Date.now() - Number(ts);
  if (diff < 60e3) return "刚刚";
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`;
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)} 小时前`;
  if (diff < 30 * 86400e3) return `${Math.floor(diff / 86400e3)} 天前`;
  return formatDate(ts);
}

/** 生成 URL 别名：保留中文/字母/数字，其余转为连字符 */
export function slugify(input) {
  const base = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/['"’“”]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return base || `post-${Date.now().toString(36)}`;
}

/** 纯文本截断 */
export function truncate(text, len = 120) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > len ? `${s.slice(0, len)}…` : s;
}

/** 去掉 markdown / html 标记，用于摘要与 meta description */
export function plainText(input) {
  return String(input || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*\|.*\|\s*$/gm, " ") // 表格行
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*#{1,6}\s+(.+)$/gm, "$1。")
    .replace(/^\s*([-+*]|\d+\.)\s+/gm, "")
    .replace(/^\s*[-:|\s]+$/gm, " ")
    .replace(/[#>*_`~|]/g, " ")
    .replace(/([，。；：！？、])\s+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** 逗号 / 空格分隔的标签字符串 → 数组 */
export function parseTagList(input) {
  return String(input || "")
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .slice(0, 12);
}

/** 生成分页数据 */
export function paginate(total, pageSize, current) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, current), totalPages);
  return {
    page,
    totalPages,
    total,
    offset: (page - 1) * pageSize,
    limit: pageSize,
    hasPrev: page > 1,
    hasNext: page < totalPages,
  };
}

/** 安全取整数 */
export function toInt(value, fallback = 1) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** 生成随机十六进制字符串 */
export function randomHex(bytes = 16) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 从 Cookie 头解析键值对 */
export function parseCookies(header) {
  const out = {};
  String(header || "")
    .split(";")
    .forEach((part) => {
      const idx = part.indexOf("=");
      if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    });
  return out;
}

/** 构造 Set-Cookie 字符串 */
export function serializeCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path || "/"}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  parts.push(`SameSite=${opts.sameSite || "Lax"}`);
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  // Secure 在 localhost 上同样被浏览器接受，线上必须启用
  if (opts.secure !== false) parts.push("Secure");
  return parts.join("; ");
}

/** 302 跳转响应 */
export function redirect(location, extraHeaders = {}) {
  return new Response(null, {
    status: 302,
    headers: { Location: location, ...extraHeaders },
  });
}

/** HTML 响应 */
export function htmlResponse(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

/** JSON 响应 */
export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

/** 读取表单数据为普通对象 */
export async function readForm(request) {
  try {
    const form = await request.formData();
    const out = {};
    for (const [key, value] of form.entries()) {
      out[key] = typeof value === "string" ? value : "";
    }
    return out;
  } catch {
    return {};
  }
}

/** 简单 Origin 校验，缓解 CSRF */
export function sameOrigin(request, url) {
  const origin = request.headers.get("Origin");
  if (!origin) return true; // 部分浏览器/客户端不带 Origin，交给 SameSite Cookie 兜底
  try {
    return new URL(origin).host === url.host;
  } catch {
    return false;
  }
}
