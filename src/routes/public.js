// 前台路由：首页、文章、分类、标签、搜索、归档、关于、RSS、站点地图

import {
  getCategoryBySlug,
  getPostBySlug,
  getTagBySlug,
  getTagsForPosts,
  getTagsOfPost,
  listAllPublishedBrief,
  listApprovedComments,
  listCategoriesWithCount,
  listPosts,
  listTagsWithCount,
  bumpViews,
  run,
} from "../lib/db.js";
import { renderMarkdown } from "../lib/markdown.js";
import { resolveLocation } from "../lib/geo.js";
import { esc, formatDate, formatDateTime, htmlResponse, redirect, toInt } from "../lib/utils.js";
import { emptyState, flash, layout, pagination, postCard, sectionTitle } from "../views/layout.js";

const MSG = {
  ok: ["评论已发布，谢谢你的留言。", "ok"],
  review: ["评论已提交，审核通过后会展示出来。", "ok"],
  closed: ["该文章的评论已关闭。", "err"],
  invalid: ["请填写昵称和评论内容。", "err"],
  slow: ["提交太频繁了，请稍后再试。", "err"],
};

function msgFromUrl(url) {
  const key = url.searchParams.get("msg");
  return MSG[key] ? flash(MSG[key][0], MSG[key][1]) : "";
}

/* ───────────────────────── 首页 ───────────────────────── */

async function home(ctx) {
  const { env, url, settings } = ctx;
  const page = toInt(ctx.params.page || url.searchParams.get("page"), 1);
  const { posts, pageInfo } = await listPosts(env, {
    status: "published",
    page,
    pageSize: Number(settings.page_size),
  });
  const tagMap = await getTagsForPosts(env, posts.map((p) => p.id));

  const list = posts.length
    ? posts.map((p) => postCard(p, tagMap.get(p.id) || [])).join("")
    : emptyState("还没有发布任何文章。");

  const heroApi = String(settings.hero_image_api || "").trim();
  const heroApiJs = JSON.stringify(heroApi).replace(/</g, "\\u003c");
  const heroMedia = heroApi
    ? `<img class="hero-bg" id="hero-bg" alt="" aria-hidden="true" referrerpolicy="no-referrer" decoding="async" />
      <div class="hero-shade"></div>`
    : "";
  const heroScript = heroApi
    ? `<script>
      (function () {
        var banner = document.getElementById("hero-banner");
        var img = document.getElementById("hero-bg");
        if (!banner || !img) return;
        img.onerror = function () { banner.classList.add("is-fallback"); };
        // 每次刷新都请求一次：附加时间戳，避免命中浏览器缓存
        var api = ${heroApiJs};
        img.src = api + (api.indexOf("?") > -1 ? "&" : "?") + "_=" + Date.now();
      })();
    </script>`
    : "";

  const body = `<section class="hero-banner" id="hero-banner">
      ${heroMedia}
      <div class="hero-content">
        <h1 class="hero-title">${esc(settings.site_name)}</h1>
        <p class="hero-desc">${esc(settings.site_desc)}</p>
      </div>
    </section>
    ${msgFromUrl(url)}
    <div class="post-list">${list}</div>
    ${pagination(pageInfo, (p) => (p === 1 ? "/" : `/page/${p}`))}
    ${heroScript}`;

  return htmlResponse(layout({ site: settings, title: "", body, active: "home", user: ctx.user }));
}

/* ───────────────────────── 文章详情 ───────────────────────── */

async function postDetail(ctx) {
  const { env, params, settings, url } = ctx;
  let post = await getPostBySlug(env, params.slug);
  // 已登录作者可以预览未发布的草稿
  if (!post && ctx.user) post = await getPostBySlug(env, params.slug, true);
  if (!post) return notFound(ctx);

  await bumpViews(env, post.id);
  const tags = await getTagsOfPost(env, post.id);
  const comments = settings.comments_enabled === "1" ? await listApprovedComments(env, post.id) : [];
  const date = formatDate(post.published_at || post.created_at);

  const commentHtml =
    settings.comments_enabled === "1"
      ? `<section class="comments" id="comments">
          <h2 class="comments-title">评论 <span class="count">${comments.length}</span></h2>
          ${
            comments.length
              ? `<ul class="comment-list">${comments
                  .map(
                    (c) => `<li class="comment">
                      <div class="comment-head">
                        <span class="comment-name">
                          <span class="comment-author">${esc(c.author)}</span>
                          ${c.location ? `<span class="comment-loc">${esc(c.location)}</span>` : ""}
                        </span>
                        <time>${esc(formatDateTime(c.created_at))}</time>
                      </div>
                      <div class="comment-body">${esc(c.content).replace(/\n/g, "<br />")}</div>
                    </li>`
                  )
                  .join("")}</ul>`
              : '<p class="muted">还没有评论，来说两句吧。</p>'
          }
          <form class="comment-form" method="post" action="/post/${encodeURIComponent(post.slug)}/comment">
            <h3>发表评论</h3>
            <div class="form-row">
              <label>昵称<input type="text" name="author" required maxlength="30" placeholder="你的名字" /></label>
              <label>邮箱（可选，不公开）<input type="email" name="email" maxlength="80" placeholder="you@example.com" /></label>
            </div>
            <label>内容<textarea name="content" rows="4" required maxlength="2000" placeholder="想说的话…"></textarea></label>
            <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true" />
            <button type="submit" class="btn primary">提交评论</button>
          </form>
        </section>`
      : `<p class="muted comments-closed">评论功能已关闭。</p>`;

  const body = `<article class="post-single">
      <header class="post-header">
        <div class="post-meta">
          <time datetime="${esc(date)}">${esc(date)}</time>
          ${post.category_name ? `<span class="dot">·</span><a href="/category/${encodeURIComponent(post.category_slug)}">${esc(post.category_name)}</a>` : ""}
          <span class="dot">·</span><span>${Number(post.views) + 1} 次阅读</span>
          ${post.status === "draft" ? '<span class="badge draft">草稿预览</span>' : ""}
        </div>
        <h1 class="post-title">${esc(post.title)}</h1>
        ${
          tags.length
            ? `<div class="tag-row">${tags
                .map((t) => `<a class="tag" href="/tag/${encodeURIComponent(t.slug)}">#${esc(t.name)}</a>`)
                .join("")}</div>`
            : ""
        }
      </header>
      ${post.cover ? `<img class="post-cover" src="${esc(post.cover)}" alt="${esc(post.title)}" loading="lazy" />` : ""}
      <div class="post-content">${renderMarkdown(post.content)}</div>
    </article>
    ${msgFromUrl(url)}
    ${commentHtml}
    <p class="back-home"><a href="/">← 返回首页</a></p>`;

  return htmlResponse(
    layout({
      site: settings,
      title: post.title,
      description: post.excerpt || post.title,
      body,
      user: ctx.user,
      canonicalPath: `/post/${post.slug}`,
    })
  );
}

/* ───────────────────────── 评论提交 ───────────────────────── */

async function submitComment(ctx) {
  const { env, params, request, settings } = ctx;
  const back = `/post/${encodeURIComponent(params.slug)}`;
  const post = await getPostBySlug(env, params.slug);
  if (!post) return notFound(ctx);
  if (settings.comments_enabled !== "1") return redirect(`${back}?msg=closed#comments`);

  const form = await request.formData().catch(() => null);
  if (!form) return redirect(`${back}?msg=invalid#comments`);

  // 蜜罐字段：正常用户看不见，机器人会填
  if ((form.get("website") || "").trim()) return redirect(`${back}?msg=ok#comments`);

  const author = String(form.get("author") || "").trim().slice(0, 30);
  const email = String(form.get("email") || "").trim().slice(0, 80);
  const content = String(form.get("content") || "").trim().slice(0, 2000);
  if (!author || !content) return redirect(`${back}?msg=invalid#comments`);

  // 简易频控：同一文章 30 秒内最多 3 条
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM comments WHERE post_id = ? AND created_at > ?"
  )
    .bind(post.id, Date.now() - 30_000)
    .first();
  if ((recent?.n || 0) >= 3) return redirect(`${back}?msg=slow#comments`);

  const status = settings.comments_need_review === "1" ? "pending" : "approved";
  await run(
    env,
    "INSERT INTO comments (post_id, author, email, content, status, location, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    post.id,
    author,
    email,
    content,
    status,
    resolveLocation(request),
    Date.now()
  );

  return redirect(`${back}?msg=${status === "approved" ? "ok" : "review"}#comments`);
}

/* ───────────────────────── 分类 / 标签 / 搜索 ───────────────────────── */

async function categoryPage(ctx) {
  const { env, params, settings } = ctx;
  const category = await getCategoryBySlug(env, String(params.slug).toLowerCase());
  if (!category) return notFound(ctx);
  const page = toInt(params.page, 1);
  const { posts, total, pageInfo } = await listPosts(env, {
    status: "published",
    page,
    pageSize: Number(settings.page_size),
    categorySlug: category.slug,
  });
  const tagMap = await getTagsForPosts(env, posts.map((p) => p.id));

  const body = `${sectionTitle(`分类：${category.name}`, `${total} 篇文章`)}
    <div class="post-list">${
      posts.length ? posts.map((p) => postCard(p, tagMap.get(p.id) || [])).join("") : emptyState("该分类下暂无文章。")
    }</div>
    ${pagination(pageInfo, (p) =>
      p === 1 ? `/category/${encodeURIComponent(category.slug)}` : `/category/${encodeURIComponent(category.slug)}/page/${p}`
    )}`;

  return htmlResponse(
    layout({ site: settings, title: `分类：${category.name}`, body, user: ctx.user })
  );
}

async function tagPage(ctx) {
  const { env, params, settings } = ctx;
  const tag = await getTagBySlug(env, String(params.slug).toLowerCase());
  if (!tag) return notFound(ctx);
  const page = toInt(params.page, 1);
  const { posts, total, pageInfo } = await listPosts(env, {
    status: "published",
    page,
    pageSize: Number(settings.page_size),
    tagSlug: tag.slug,
  });
  const tagMap = await getTagsForPosts(env, posts.map((p) => p.id));

  const body = `${sectionTitle(`标签：${tag.name}`, `${total} 篇文章`)}
    <div class="post-list">${
      posts.length ? posts.map((p) => postCard(p, tagMap.get(p.id) || [])).join("") : emptyState("该标签下暂无文章。")
    }</div>
    ${pagination(pageInfo, (p) =>
      p === 1 ? `/tag/${encodeURIComponent(tag.slug)}` : `/tag/${encodeURIComponent(tag.slug)}/page/${p}`
    )}`;

  return htmlResponse(layout({ site: settings, title: `标签：${tag.name}`, body, user: ctx.user }));
}

async function searchPage(ctx) {
  const { env, url, settings } = ctx;
  const q = (url.searchParams.get("q") || "").trim().slice(0, 60);
  const page = toInt(url.searchParams.get("page"), 1);

  if (!q) {
    const body = `${sectionTitle("搜索")}
      <form class="search-page-form" action="/search" method="get">
        <input type="search" name="q" placeholder="输入关键词，回车搜索" autofocus />
        <button class="btn primary" type="submit">搜索</button>
      </form>`;
    return htmlResponse(layout({ site: settings, title: "搜索", body, user: ctx.user }));
  }

  const { posts, total, pageInfo } = await listPosts(env, {
    status: "published",
    page,
    pageSize: Number(settings.page_size),
    search: q,
  });
  const tagMap = await getTagsForPosts(env, posts.map((p) => p.id));

  const body = `${sectionTitle(`搜索：${q}`, `找到 ${total} 条结果`)}
    <form class="search-page-form" action="/search" method="get">
      <input type="search" name="q" value="${esc(q)}" placeholder="输入关键词" />
      <button class="btn primary" type="submit">搜索</button>
    </form>
    <div class="post-list">${
      posts.length ? posts.map((p) => postCard(p, tagMap.get(p.id) || [])).join("") : emptyState("没有找到相关文章，换个关键词试试。")
    }</div>
    ${pagination(pageInfo, (p) =>
      p === 1 ? `/search?q=${encodeURIComponent(q)}` : `/search?q=${encodeURIComponent(q)}&page=${p}`
    )}`;

  return htmlResponse(
    layout({ site: settings, title: `搜索：${q}`, body, user: ctx.user, noIndex: true })
  );
}

/* ───────────────────────── 归档 / 关于 ───────────────────────── */

async function archivePage(ctx) {
  const { env, settings } = ctx;
  const posts = await listAllPublishedBrief(env);
  const groups = new Map();
  for (const p of posts) {
    const year = formatDate(p.published_at || p.created_at).slice(0, 4);
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(p);
  }

  const body = `${sectionTitle("归档", `共 ${posts.length} 篇`)}
    ${
      posts.length
        ? [...groups.entries()]
            .map(
              ([year, items]) => `<section class="archive-year">
                <h2>${esc(year)}<span class="count">${items.length}</span></h2>
                <ul class="archive-list">
                  ${items
                    .map(
                      (p) => `<li>
                        <time>${esc(formatDate(p.published_at || p.created_at).slice(5))}</time>
                        <a href="/post/${encodeURIComponent(p.slug)}">${esc(p.title)}</a>
                      </li>`
                    )
                    .join("")}
                </ul>
              </section>`
            )
            .join("")
        : emptyState("还没有发布任何文章。")
    }`;

  return htmlResponse(layout({ site: settings, title: "归档", body, active: "archive", user: ctx.user }));
}

async function aboutPage(ctx) {
  const { settings } = ctx;
  const body = `${sectionTitle("关于")}
    <div class="post-content about-content">${renderMarkdown(settings.about)}</div>`;
  return htmlResponse(layout({ site: settings, title: "关于", body, active: "about", user: ctx.user }));
}

/* ───────────────────────── RSS / Sitemap ───────────────────────── */

function xmlEscape(str) {
  return String(str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[c]);
}

async function rss(ctx) {
  const { env, url, settings } = ctx;
  const { posts } = await listPosts(env, { status: "published", page: 1, pageSize: 20 });
  const items = posts
    .map(
      (p) => `    <item>
      <title>${xmlEscape(p.title)}</title>
      <link>${url.origin}/post/${encodeURIComponent(p.slug)}</link>
      <guid isPermaLink="true">${url.origin}/post/${encodeURIComponent(p.slug)}</guid>
      <pubDate>${new Date(p.published_at || p.created_at).toUTCString()}</pubDate>
      <description>${xmlEscape(p.excerpt || "")}</description>
    </item>`
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${xmlEscape(settings.site_name)}</title>
    <link>${url.origin}/</link>
    <description>${xmlEscape(settings.site_desc)}</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=600",
    },
  });
}

async function sitemap(ctx) {
  const { env, url } = ctx;
  const posts = await listAllPublishedBrief(env);
  const categories = await listCategoriesWithCount(env);
  const tags = await listTagsWithCount(env);

  const urls = [
    { loc: `${url.origin}/`, priority: "1.0" },
    { loc: `${url.origin}/archive`, priority: "0.6" },
    { loc: `${url.origin}/about`, priority: "0.5" },
    ...categories
      .filter((c) => c.count > 0)
      .map((c) => ({ loc: `${url.origin}/category/${encodeURIComponent(c.slug)}`, priority: "0.6" })),
    ...tags
      .filter((t) => t.count > 0)
      .map((t) => ({ loc: `${url.origin}/tag/${encodeURIComponent(t.slug)}`, priority: "0.5" })),
    ...posts.map((p) => ({
      loc: `${url.origin}/post/${encodeURIComponent(p.slug)}`,
      lastmod: formatDate(p.published_at || p.created_at),
      priority: "0.8",
    })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}<priority>${u.priority}</priority></url>`
  )
  .join("\n")}
</urlset>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=600" },
  });
}

/* ───────────────────────── 404 ───────────────────────── */

export async function notFound(ctx) {
  const body = `<div class="empty-state not-found">
      <h1>404</h1>
      <p>你访问的页面不存在，也许已经被移走了。</p>
      <p><a class="btn primary" href="/">回到首页</a></p>
    </div>`;
  return htmlResponse(layout({ site: ctx.settings, title: "页面不存在", body, user: ctx.user, noIndex: true }), 404);
}

export const publicRoutes = [
  ["GET", "/", home],
  ["GET", "/page/:page", home],
  ["GET", "/post/:slug", postDetail],
  ["POST", "/post/:slug/comment", submitComment],
  ["GET", "/category/:slug", categoryPage],
  ["GET", "/category/:slug/page/:page", categoryPage],
  ["GET", "/tag/:slug", tagPage],
  ["GET", "/tag/:slug/page/:page", tagPage],
  ["GET", "/search", searchPage],
  ["GET", "/archive", archivePage],
  ["GET", "/about", aboutPage],
  ["GET", "/rss.xml", rss],
  ["GET", "/sitemap.xml", sitemap],
];
