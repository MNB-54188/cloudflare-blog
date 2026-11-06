// 后台管理界面布局与组件

import { esc, formatDateTime } from "../lib/utils.js";

const NAV = [
  { key: "dashboard", href: "/admin", label: "概览", icon: "◈" },
  { key: "posts", href: "/admin/posts", label: "文章", icon: "✎" },
  { key: "comments", href: "/admin/comments", label: "评论", icon: "❝" },
  { key: "taxonomy", href: "/admin/taxonomy", label: "分类与标签", icon: "❖" },
  { key: "settings", href: "/admin/settings", label: "站点设置", icon: "⚙" },
];

export function adminLayout({
  site,
  user,
  title,
  active = "dashboard",
  body,
  pendingComments = 0,
  wide = false,
}) {
  const nav = NAV.map(
    (item) => `<a href="${item.href}" class="admin-nav-item ${active === item.key ? "is-active" : ""}">
      <span class="nav-icon">${item.icon}</span><span>${item.label}</span>
      ${item.key === "comments" && pendingComments > 0 ? `<span class="nav-badge">${pendingComments}</span>` : ""}
    </a>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${esc(title)} · 后台 · ${esc(site.site_name)}</title>
  <link rel="stylesheet" href="/style.css" />
  <link rel="stylesheet" href="/admin.css" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
</head>
<body class="admin-body">
  <div class="admin-shell">
    <aside class="admin-side">
      <a class="admin-brand" href="/admin">
        <span class="brand-mark">${esc((site.site_name || "博").slice(0, 1))}</span>
        <span><strong>${esc(site.site_name)}</strong><small>管理后台</small></span>
      </a>
      <nav class="admin-nav">${nav}</nav>
      <div class="admin-side-foot">
        <a href="/" target="_blank" rel="noopener">查看站点 ↗</a>
      </div>
    </aside>
    <div class="admin-main">
      <header class="admin-topbar">
        <h1 class="admin-title">${esc(title)}</h1>
        <div class="admin-user">
          <span class="who">${esc(user?.display_name || user?.username || "")}</span>
          <form method="post" action="/admin/logout"><button class="btn ghost sm" type="submit">退出</button></form>
        </div>
      </header>
      <div class="admin-content ${wide ? "is-wide" : ""}">${body}</div>
    </div>
  </div>
</body>
</html>`;
}

export function statCard(label, value, hint = "", href = "") {
  const inner = `<div class="stat-value">${esc(value)}</div>
    <div class="stat-label">${esc(label)}</div>
    ${hint ? `<div class="stat-hint">${esc(hint)}</div>` : ""}`;
  return href
    ? `<a class="stat-card" href="${esc(href)}">${inner}</a>`
    : `<div class="stat-card">${inner}</div>`;
}

export function statusBadge(status) {
  const map = {
    published: ["已发布", "ok"],
    draft: ["草稿", "warn"],
    pending: ["待审核", "warn"],
    approved: ["已通过", "ok"],
    spam: ["垃圾", "err"],
  };
  const [label, tone] = map[status] || [status, ""];
  return `<span class="badge ${tone}">${esc(label)}</span>`;
}

export function postRows(posts) {
  if (!posts.length) {
    return `<tr><td colspan="5" class="table-empty">还没有文章，<a href="/admin/posts/new">写第一篇</a>。</td></tr>`;
  }
  return posts
    .map(
      (p) => `<tr>
        <td class="cell-title">
          <a href="/admin/posts/${p.id}/edit">${esc(p.title)}</a>
          <div class="cell-sub">/post/${esc(p.slug)}</div>
        </td>
        <td>${statusBadge(p.status)}</td>
        <td class="cell-muted">${p.category_name ? esc(p.category_name) : "—"}</td>
        <td class="cell-muted">${esc(formatDateTime(p.published_at || p.updated_at))}</td>
        <td class="cell-actions">
          <a class="btn ghost sm" href="/admin/posts/${p.id}/edit">编辑</a>
          <a class="btn ghost sm" href="/post/${encodeURIComponent(p.slug)}" target="_blank" rel="noopener">预览</a>
          <form method="post" action="/admin/posts/${p.id}/delete" onsubmit="return confirm('确定删除这篇文章？此操作不可恢复。')">
            <button class="btn danger sm" type="submit">删除</button>
          </form>
        </td>
      </tr>`
    )
    .join("");
}

export function adminPager(pageInfo, baseUrl) {
  if (!pageInfo || pageInfo.totalPages <= 1) return "";
  const build = (p) => {
    const u = new URL(baseUrl, "https://x");
    u.searchParams.set("page", String(p));
    return u.pathname + u.search;
  };
  return `<div class="admin-pager">
    ${pageInfo.hasPrev ? `<a class="btn ghost sm" href="${esc(build(pageInfo.page - 1))}">上一页</a>` : ""}
    <span class="pager-info">第 ${pageInfo.page} / ${pageInfo.totalPages} 页 · 共 ${pageInfo.total} 条</span>
    ${pageInfo.hasNext ? `<a class="btn ghost sm" href="${esc(build(pageInfo.page + 1))}">下一页</a>` : ""}
  </div>`;
}

export function loginPage({ site, error = "", setupMode = false, needsSetup = false, tokenRequired = false }) {
  const action = setupMode ? "/setup" : "/admin/login";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${setupMode ? "初始化博客" : "登录"} · ${esc(site.site_name)}</title>
  <link rel="stylesheet" href="/style.css" />
  <link rel="stylesheet" href="/admin.css" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
</head>
<body class="auth-body">
  <div class="auth-card">
    <div class="auth-brand">
      <span class="brand-mark">${esc((site.site_name || "博").slice(0, 1))}</span>
      <div>
        <strong>${esc(site.site_name)}</strong>
        <small>${setupMode ? "第一次使用，先创建管理员账号" : "登录后进入管理后台"}</small>
      </div>
    </div>
    ${error ? `<div class="flash flash-err">${esc(error)}</div>` : ""}
    ${needsSetup ? `<div class="flash flash-warn">数据库还没有初始化，请先<a href="/setup">完成初始化</a>。</div>` : ""}
    <form method="post" action="${action}" class="auth-form">
      <label>用户名<input name="username" required autocomplete="username" placeholder="admin" /></label>
      <label>密码<input name="password" type="password" required autocomplete="${setupMode ? "new-password" : "current-password"}" placeholder="至少 6 位" /></label>
      ${setupMode ? `<label>确认密码<input name="password2" type="password" required autocomplete="new-password" placeholder="再输一次" /></label>` : ""}
      ${setupMode && tokenRequired ? `<label>初始化口令<input name="setup_token" required placeholder="部署时配置的 SETUP_TOKEN" /></label>` : ""}
      <button class="btn primary block" type="submit">${setupMode ? "创建账号并完成初始化" : "登录"}</button>
    </form>
    <p class="auth-foot"><a href="/">← 回到博客首页</a></p>
  </div>
</body>
</html>`;
}
