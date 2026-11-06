// 前台布局与可复用组件

import { esc, formatDate } from "../lib/utils.js";

export function layout({
  site,
  title,
  description = "",
  body,
  user = null,
  active = "",
  canonicalPath = "/",
  noIndex = false,
}) {
  const pageTitle = title ? `${title} · ${site.site_name}` : `${site.site_name} · ${site.site_desc}`;
  const desc = description || site.site_desc;
  const brandMark = (site.site_name || "博").trim().slice(0, 1);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(pageTitle)}</title>
  <meta name="description" content="${esc(desc)}" />
  ${noIndex ? '<meta name="robots" content="noindex" />' : ""}
  <link rel="canonical" href="${esc(canonicalPath)}" />
  <link rel="stylesheet" href="/style.css" />
  <link rel="alternate" type="application/rss+xml" title="${esc(site.site_name)}" href="/rss.xml" />
  <meta property="og:title" content="${esc(pageTitle)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:type" content="website" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
</head>
<body>
  <a class="skip-link" href="#main">跳到正文</a>
  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="/">
        <span class="brand-mark">${esc(brandMark)}</span>
        <span class="brand-text">
          <strong>${esc(site.site_name)}</strong>
          <small>${esc(site.site_desc)}</small>
        </span>
      </a>
      <nav class="site-nav">
        <a href="/" class="${active === "home" ? "is-active" : ""}">首页</a>
        <a href="/archive" class="${active === "archive" ? "is-active" : ""}">归档</a>
        <a href="/about" class="${active === "about" ? "is-active" : ""}">关于</a>
        ${user ? `<a href="/admin" class="nav-admin">后台</a>` : `<a href="/admin/login" class="nav-admin">登录</a>`}
      </nav>
    </div>
  </header>

  <main id="main" class="container main">
    ${body}
  </main>

  <footer class="site-footer">
    <div class="container footer-inner">
      <p>${esc(site.site_footer || "")}</p>
      <p class="footer-links">
        <a href="/rss.xml">RSS</a>
        <span>·</span>
        <a href="/sitemap.xml">站点地图</a>
        ${user ? '<span>·</span><a href="/admin">管理后台</a>' : ""}
      </p>
    </div>
  </footer>
</body>
</html>`;
}

export function flash(message, type = "ok") {
  if (!message) return "";
  return `<div class="flash flash-${esc(type)}">${esc(message)}</div>`;
}

export function postCard(post, tags = []) {
  const date = formatDate(post.published_at || post.created_at);
  return `<article class="card">
    <div class="card-head">
      <h2 class="card-title"><a href="/post/${encodeURIComponent(post.slug)}">${esc(post.title)}</a></h2>
      <div class="card-meta">
        <time datetime="${esc(date)}">${esc(date)}</time>
        ${post.category_name ? `<span class="dot">·</span><a class="meta-link" href="/category/${encodeURIComponent(post.category_slug)}">${esc(post.category_name)}</a>` : ""}
        <span class="dot">·</span><span>${Number(post.views) || 0} 次阅读</span>
      </div>
    </div>
    ${post.excerpt ? `<p class="card-excerpt">${esc(post.excerpt)}</p>` : ""}
    ${
      tags.length
        ? `<div class="tag-row">${tags
            .map((t) => `<a class="tag" href="/tag/${encodeURIComponent(t.slug)}">#${esc(t.name)}</a>`)
            .join("")}</div>`
        : ""
    }
  </article>`;
}

function pageWindow(current, total) {
  const pages = [];
  const push = (n) => pages.includes(n) || pages.push(n);
  push(1);
  for (let i = current - 2; i <= current + 2; i++) {
    if (i > 1 && i < total) push(i);
  }
  if (total > 1) push(total);
  pages.sort((a, b) => a - b);

  const withGaps = [];
  pages.forEach((n, idx) => {
    if (idx > 0 && n - pages[idx - 1] > 1) withGaps.push("…");
    withGaps.push(n);
  });
  return withGaps;
}

/** urlFor(page) 返回该页的链接 */
export function pagination(pageInfo, urlFor) {
  if (!pageInfo || pageInfo.totalPages <= 1) return "";
  const items = pageWindow(pageInfo.page, pageInfo.totalPages).map((item) =>
    item === "…"
      ? '<span class="page-gap">…</span>'
      : `<a class="page-num ${item === pageInfo.page ? "is-current" : ""}" href="${esc(urlFor(item))}">${item}</a>`
  );
  return `<nav class="pagination" aria-label="分页">
    ${pageInfo.hasPrev ? `<a class="page-nav" href="${esc(urlFor(pageInfo.page - 1))}">上一页</a>` : '<span class="page-nav is-disabled">上一页</span>'}
    ${items.join("")}
    ${pageInfo.hasNext ? `<a class="page-nav" href="${esc(urlFor(pageInfo.page + 1))}">下一页</a>` : '<span class="page-nav is-disabled">下一页</span>'}
  </nav>`;
}

export function emptyState(text = "这里还什么都没有。") {
  return `<div class="empty-state"><p>${esc(text)}</p></div>`;
}

export function sectionTitle(title, extra = "") {
  return `<div class="section-title"><h1>${esc(title)}</h1>${extra ? `<span class="section-sub">${esc(extra)}</span>` : ""}</div>`;
}
