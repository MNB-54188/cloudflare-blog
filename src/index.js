// 入口：路由分发 + 全局错误处理
// 同一份代码既可作为 Cloudflare Worker 直接部署，
// 也可通过 functions/[[path]].js 挂到 Cloudflare Pages Functions。

import { adminRoutes } from "./routes/admin.js";
import { publicRoutes, notFound } from "./routes/public.js";
import { getCurrentUser } from "./lib/auth.js";
import { getSettings } from "./lib/db.js";
import { htmlResponse, redirect } from "./lib/utils.js";

function compile(routes) {
  return routes.map(([method, pattern, handler]) => {
    const keys = [];
    const body = pattern.replace(/\/:([A-Za-z0-9_]+)/g, (_m, key) => {
      keys.push(key);
      return "/([^/]+)";
    });
    return { method, regex: new RegExp(`^${body}/?$`), keys, handler };
  });
}

const ROUTES = compile([...adminRoutes, ...publicRoutes]);

// 轻量迁移：旧库补上后续新增的列（表未建时不报错，交给 /setup 处理）
let migrationPromise = null;
function ensureMigrations(env) {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      const statements = ["ALTER TABLE comments ADD COLUMN location TEXT NOT NULL DEFAULT ''"];
      for (const sql of statements) {
        try {
          await env.DB.prepare(sql).run();
        } catch {
          /* 列已存在或表尚未创建 */
        }
      }
    })();
  }
  return migrationPromise;
}

function match(method, pathname) {
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const m = pathname.match(route.regex);
    if (!m) continue;
    const params = {};
    route.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(m[index + 1] || "");
    });
    return { handler: route.handler, params };
  }
  return null;
}

function errorPage(message) {
  return htmlResponse(
    `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>服务异常</title><link rel="stylesheet" href="/style.css" /></head>
<body><main class="container main"><div class="empty-state not-found">
<h1>500</h1><p>页面渲染出错，请稍后重试。</p>
<pre class="error-detail">${String(message).replace(/[<>&]/g, "")}</pre>
<p><a class="btn primary" href="/">回到首页</a></p></div></main></body></html>`,
    500
  );
}

async function handle(request, env, executionCtx) {
  const url = new URL(request.url);
  const method = request.method === "HEAD" ? "GET" : request.method;

  try {
    const matched = match(method, url.pathname);
    await ensureMigrations(env);
    const settings = await getSettings(env);
    const user = await getCurrentUser(request, env);

    const ctx = {
      request,
      env,
      url,
      params: matched?.params || {},
      settings,
      user,
      executionCtx,
    };

    if (!matched) return await notFound(ctx);
    return await matched.handler(ctx);
  } catch (err) {
    const message = String(err?.message || err);

    // 数据库尚未初始化 → 引导到 /setup
    if (/no such table|no such column|no such index/i.test(message)) {
      if (url.pathname === "/setup") {
        return errorPage("数据表创建失败，请确认已在 Cloudflare 绑定 D1 数据库（变量名 DB）。");
      }
      return redirect("/setup");
    }

    console.error("[blog] unhandled error:", err);
    return errorPage(message);
  }
}

export default { fetch: handle };
export { handle };
