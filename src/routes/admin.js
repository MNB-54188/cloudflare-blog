// 后台路由：初始化、登录、文章管理、评论审核、分类标签、站点设置

import {
  countComments,
  getPostById,
  getSettings,
  getStats,
  getTagsOfPost,
  listCategoriesWithCount,
  listComments,
  listPosts,
  listTagsWithCount,
  one,
  run,
  saveSettings,
  syncPostTags,
  uniqueSlug,
} from "../lib/db.js";
import {
  buildSessionCookie,
  clearSessionCookie,
  createPassword,
  getCurrentUser,
  hasAnyUser,
  verifyPassword,
} from "../lib/auth.js";
import { SCHEMA_STATEMENTS } from "../schema.js";
import { renderMarkdown } from "../lib/markdown.js";
import {
  esc,
  formatDateTime,
  htmlResponse,
  jsonResponse,
  parseTagList,
  plainText,
  readForm,
  redirect,
  sameOrigin,
  slugify,
  toInt,
  truncate,
} from "../lib/utils.js";
import {
  adminLayout,
  adminPager,
  loginPage,
  postRows,
  statCard,
  statusBadge,
} from "../views/admin.js";

const NOTICES = {
  saved: ["已保存。", "ok"],
  deleted: ["已删除。", "ok"],
  updated: ["操作已完成。", "ok"],
  welcome: ["初始化完成，欢迎使用。", "ok"],
  password: ["密码已更新，请使用新密码重新登录。", "ok"],
  err: ["操作失败，请检查填写内容。", "err"],
};

function noticeHtml(url) {
  const key = url.searchParams.get("msg");
  const item = NOTICES[key];
  if (!item) return "";
  return `<div class="flash flash-${item[1]}">${esc(item[0])}</div>`;
}

/* ───────────────────────── 鉴权包装 ───────────────────────── */

function requireAuth(handler) {
  return async (ctx) => {
    if (!ctx.user) {
      if (ctx.url.pathname.startsWith("/admin/api/")) {
        return jsonResponse({ ok: false, error: "未登录" }, 401);
      }
      return redirect("/admin/login");
    }
    return handler(ctx);
  };
}

function requireAuthPost(handler) {
  return requireAuth(async (ctx) => {
    if (!sameOrigin(ctx.request, ctx.url)) {
      return htmlResponse("请求来源校验失败，请刷新页面重试。", 403);
    }
    return handler(ctx);
  });
}

async function renderAdmin(ctx, opts) {
  const pendingComments = await countComments(ctx.env, "pending");
  return htmlResponse(
    adminLayout({
      site: ctx.settings,
      user: ctx.user,
      pendingComments,
      ...opts,
    })
  );
}

/* ───────────────────────── 初始化 ───────────────────────── */

async function setupPage(ctx) {
  if (await hasAnyUser(ctx.env)) return redirect("/admin/login?msg=setup_done");
  return htmlResponse(
    loginPage({
      site: ctx.settings,
      setupMode: true,
      tokenRequired: Boolean(ctx.env.SETUP_TOKEN),
    })
  );
}

async function setupSubmit(ctx) {
  const { env, request, url } = ctx;
  if (!sameOrigin(request, url)) return htmlResponse("请求来源校验失败。", 403);
  if (await hasAnyUser(env)) return redirect("/admin/login");

  const form = await readForm(request);
  const tokenRequired = Boolean(env.SETUP_TOKEN);
  const fail = (error) =>
    htmlResponse(
      loginPage({ site: ctx.settings, setupMode: true, tokenRequired, error }),
      400
    );

  if (tokenRequired && String(form.setup_token || "") !== env.SETUP_TOKEN) {
    return fail("初始化口令不正确。");
  }

  const username = String(form.username || "").trim();
  const password = String(form.password || "");
  if (!/^[A-Za-z0-9_.-]{3,20}$/.test(username)) return fail("用户名需为 3-20 位字母、数字或 _ . -");
  if (password.length < 6) return fail("密码至少 6 位。");
  if (password !== String(form.password2 || "")) return fail("两次输入的密码不一致。");

  try {
    for (const statement of SCHEMA_STATEMENTS) {
      await env.DB.prepare(statement).run();
    }
  } catch (err) {
    return fail(`建表失败：${err.message || err}`);
  }

  const { salt, password_hash } = await createPassword(password);
  const now = Date.now();
  const inserted = await run(
    env,
    "INSERT INTO users (username, password_hash, salt, display_name, created_at) VALUES (?, ?, ?, ?, ?)",
    username,
    password_hash,
    salt,
    username,
    now
  );
  const userId = inserted?.meta?.last_row_id;

  await saveSettings(env, {
    site_name: env.SITE_NAME || "墨记",
    site_desc: "把想说的话，慢慢写下来。",
    site_footer: `© ${new Date().getFullYear()} · 用 Cloudflare Workers 驱动`,
  });

  // 默认分类
  await run(
    env,
    "INSERT OR IGNORE INTO categories (name, slug, description, created_at) VALUES (?, ?, ?, ?)",
    "随笔",
    "essay",
    "想到哪写到哪",
    now
  );

  // 欢迎文章，方便立刻看到效果
  const welcome = `## 欢迎使用你的新博客

这是一篇示例文章，你可以在后台修改或删除它。

### 现在可以做什么

1. 打开 \`/admin\` 进入后台，点击「文章 → 写文章」
2. 在「站点设置」里修改站点名称、简介和关于页面
3. 把这篇示例文章删掉，开始写你自己的第一篇

### 支持 Markdown

正文支持 **粗体**、*斜体*、\`行内代码\`、[链接](https://developers.cloudflare.com) 等常见语法，也支持代码块：

\`\`\`js
export default {
  async fetch(request, env) {
    return new Response("Hello, Cloudflare!");
  },
};
\`\`\`

> 数据保存在 Cloudflare D1 中，全球边缘节点读取，免费额度足够个人博客长期使用。

祝写作愉快。`;
  await run(
    env,
    `INSERT INTO posts (title, slug, excerpt, content, cover, category_id, status, views, created_at, updated_at, published_at)
     VALUES (?, ?, ?, ?, '', (SELECT id FROM categories WHERE slug = 'essay'), 'published', 0, ?, ?, ?)`,
    "开始写第一篇文章",
    "hello-world",
    "这是一篇示例文章，介绍博客的基本用法，可以在后台自由修改或删除。",
    welcome,
    now,
    now,
    now
  );

  const cookie = await buildSessionCookie(env, userId);
  return redirect("/admin?msg=welcome", { "Set-Cookie": cookie });
}

/* ───────────────────────── 登录 / 退出 ───────────────────────── */

async function loginPageHandler(ctx) {
  if (ctx.user) return redirect("/admin");
  let needsSetup = false;
  try {
    needsSetup = !(await hasAnyUser(ctx.env));
  } catch {
    needsSetup = true;
  }
  if (needsSetup) return redirect("/setup");
  return htmlResponse(loginPage({ site: ctx.settings }));
}

async function loginSubmit(ctx) {
  const { env, request, url } = ctx;
  if (!sameOrigin(request, url)) return htmlResponse("请求来源校验失败。", 403);

  const form = await readForm(request);
  const username = String(form.username || "").trim();
  const password = String(form.password || "");

  let user = null;
  try {
    user = await one(env, "SELECT * FROM users WHERE username = ?", username);
  } catch {
    return redirect("/setup");
  }

  const ok = user ? await verifyPassword(password, user.salt, user.password_hash) : false;
  if (!ok) {
    return htmlResponse(loginPage({ site: ctx.settings, error: "用户名或密码不正确。" }), 401);
  }

  const cookie = await buildSessionCookie(env, user.id);
  return redirect("/admin", { "Set-Cookie": cookie });
}

async function logout(ctx) {
  return redirect("/admin/login", { "Set-Cookie": clearSessionCookie() });
}

/* ───────────────────────── 概览 ───────────────────────── */

async function dashboard(ctx) {
  const { env, url } = ctx;
  const stats = await getStats(env);
  const { posts } = await listPosts(env, { status: null, page: 1, pageSize: 5 });
  const recentComments = await listComments(env, null, 5);

  const body = `${noticeHtml(url)}
    <div class="stat-grid">
      ${statCard("已发布", stats.published, "篇文章", "/admin/posts?status=published")}
      ${statCard("草稿", stats.drafts, "篇待完成", "/admin/posts?status=draft")}
      ${statCard("待审评论", stats.pendingComments, "条等待处理", "/admin/comments?status=pending")}
      ${statCard("总阅读", stats.views, "次浏览")}
    </div>

    <div class="panel-grid">
      <section class="panel">
        <div class="panel-head">
          <h2>最近文章</h2>
          <a class="btn ghost sm" href="/admin/posts/new">写文章</a>
        </div>
        <table class="table compact">
          <tbody>
            ${
              posts.length
                ? posts
                    .map(
                      (p) => `<tr>
                        <td class="cell-title"><a href="/admin/posts/${p.id}/edit">${esc(p.title)}</a></td>
                        <td>${statusBadge(p.status)}</td>
                        <td class="cell-muted">${esc(formatDateTime(p.updated_at))}</td>
                      </tr>`
                    )
                    .join("")
                : '<tr><td class="table-empty">还没有文章</td></tr>'
            }
          </tbody>
        </table>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>最新评论</h2>
          <a class="btn ghost sm" href="/admin/comments">全部</a>
        </div>
        <ul class="comment-mini">
          ${
            recentComments.length
              ? recentComments
                  .map(
                    (c) => `<li>
                      <div class="mini-head"><strong>${esc(c.author)}</strong> ${statusBadge(c.status)}</div>
                      <p class="mini-body">${esc(c.content.slice(0, 60))}</p>
                      <div class="mini-meta">${esc(c.post_title || "（文章已删除）")}</div>
                    </li>`
                  )
                  .join("")
              : '<li class="table-empty">还没有评论</li>'
          }
        </ul>
      </section>
    </div>`;

  return renderAdmin(ctx, { title: "概览", active: "dashboard", body });
}

/* ───────────────────────── 文章列表 ───────────────────────── */

async function postList(ctx) {
  const { env, url } = ctx;
  const status = url.searchParams.get("status") || "all";
  const page = toInt(url.searchParams.get("page"), 1);
  const filter = status === "published" || status === "draft" ? status : null;
  const { posts, pageInfo } = await listPosts(env, { status: filter, page, pageSize: 20 });

  const tabs = [
    ["all", "全部"],
    ["published", "已发布"],
    ["draft", "草稿"],
  ]
    .map(
      ([key, label]) =>
        `<a class="tab ${status === key ? "is-active" : ""}" href="/admin/posts?status=${key}">${label}</a>`
    )
    .join("");

  const body = `${noticeHtml(url)}
    <div class="list-toolbar">
      <div class="tabs">${tabs}</div>
      <a class="btn primary" href="/admin/posts/new">写文章</a>
    </div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>标题</th><th>状态</th><th>分类</th><th>时间</th><th class="th-actions">操作</th></tr></thead>
        <tbody>${postRows(posts)}</tbody>
      </table>
    </div>
    ${adminPager(pageInfo, `/admin/posts?status=${status}`)}`;

  return renderAdmin(ctx, { title: "文章", active: "posts", body, wide: true });
}

/* ───────────────────────── 文章编辑器 ───────────────────────── */

async function editorPage(ctx, { post = null, values = null, error = "" }) {
  const { env, url } = ctx;
  const categories = await listCategoriesWithCount(env);
  const existingTags = post ? (await getTagsOfPost(env, post.id)).map((t) => t.name).join(", ") : "";

  const v = values || {
    title: post?.title || "",
    slug: post?.slug || "",
    excerpt: post?.excerpt || "",
    cover: post?.cover || "",
    category_id: post?.category_id ? String(post.category_id) : "",
    tags: existingTags,
    content: post?.content || "",
    status: post?.status || "draft",
  };

  const categoryOptions = categories
    .map(
      (c) =>
        `<option value="${c.id}" ${String(v.category_id) === String(c.id) ? "selected" : ""}>${esc(c.name)}</option>`
    )
    .join("");

  const body = `${error ? `<div class="flash flash-err">${esc(error)}</div>` : noticeHtml(url)}
    <form method="post" action="/admin/posts/save" class="editor-form">
      <input type="hidden" name="id" value="${post ? post.id : ""}" />
      <div class="editor-grid">
        <div class="editor-main">
          <input class="title-input" name="title" placeholder="文章标题" value="${esc(v.title)}" required maxlength="120" />
          <div class="slug-row">
            <span class="slug-prefix">/post/</span>
            <input class="slug-input" name="slug" placeholder="url-slug（留空则按标题生成）" value="${esc(v.slug)}" maxlength="80" />
          </div>
          <div class="editor-toolbar">
            <button type="button" class="tool" data-b="**" data-a="**" title="粗体">B</button>
            <button type="button" class="tool" data-b="*" data-a="*" title="斜体"><em>I</em></button>
            <button type="button" class="tool" data-b="## " data-a="" title="小标题">H2</button>
            <button type="button" class="tool" data-b="> " data-a="" title="引用">❝</button>
            <button type="button" class="tool" data-b="&#96;" data-a="&#96;" title="行内代码">&lt;/&gt;</button>
            <button type="button" class="tool" data-b="[" data-a="](https://)" title="链接">🔗</button>
            <span class="toolbar-spacer"></span>
            <button type="button" class="tool" id="toggle-preview">预览</button>
            <span class="word-count" id="word-count"></span>
          </div>
          <textarea name="content" id="content" class="content-editor" rows="22" placeholder="用 Markdown 写点什么…">${esc(
            v.content
          )}</textarea>
          <div id="preview" class="preview-pane post-content" hidden></div>
        </div>

        <aside class="editor-side">
          <section class="side-card">
            <h3>发布</h3>
            <label class="radio"><input type="radio" name="status" value="published" ${
              v.status === "published" ? "checked" : ""
            } /> 已发布</label>
            <label class="radio"><input type="radio" name="status" value="draft" ${
              v.status === "draft" ? "checked" : ""
            } /> 保存为草稿</label>
            <button class="btn primary block" type="submit">保存文章</button>
            ${
              post
                ? `<a class="btn ghost block" href="/post/${encodeURIComponent(post.slug)}" target="_blank" rel="noopener">在站点查看</a>`
                : ""
            }
            <a class="btn ghost block" href="/admin/posts">返回列表</a>
          </section>

          <section class="side-card">
            <h3>分类</h3>
            <select name="category_id">
              <option value="">未分类</option>
              ${categoryOptions}
            </select>
          </section>

          <section class="side-card">
            <h3>标签</h3>
            <input name="tags" value="${esc(v.tags)}" placeholder="用逗号分隔，如：随笔, Cloudflare" />
            <p class="hint">不存在的标签会自动创建。</p>
          </section>

          <section class="side-card">
            <h3>摘要</h3>
            <textarea name="excerpt" rows="3" placeholder="列表页展示的简介，留空自动截取正文">${esc(
              v.excerpt
            )}</textarea>
          </section>

          <section class="side-card">
            <h3>封面图</h3>
            <input name="cover" value="${esc(v.cover)}" placeholder="https://…（可选）" />
          </section>
        </aside>
      </div>
    </form>

    <script>
      (function () {
        var ta = document.getElementById("content");
        var preview = document.getElementById("preview");
        var toggle = document.getElementById("toggle-preview");
        var countEl = document.getElementById("word-count");

        function updateCount() {
          var n = ta.value.replace(/\\s/g, "").length;
          countEl.textContent = n + " 字";
        }
        updateCount();
        ta.addEventListener("input", updateCount);

        document.querySelectorAll(".tool[data-b]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var s = ta.selectionStart, e = ta.selectionEnd;
            var before = btn.dataset.b, after = btn.dataset.a;
            ta.value = ta.value.slice(0, s) + before + ta.value.slice(s, e) + after + ta.value.slice(e);
            ta.focus();
            ta.selectionStart = s + before.length;
            ta.selectionEnd = e + before.length;
            updateCount();
          });
        });

        toggle.addEventListener("click", async function () {
          if (preview.hidden) {
            toggle.textContent = "编辑";
            preview.hidden = false;
            ta.hidden = true;
            try {
              var res = await fetch("/admin/api/preview", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: ta.value }),
              });
              var data = await res.json();
              preview.innerHTML = data.html || "<p>预览失败</p>";
            } catch (err) {
              preview.textContent = "预览失败：" + err.message;
            }
          } else {
            toggle.textContent = "预览";
            preview.hidden = true;
            ta.hidden = false;
            ta.focus();
          }
        });
      })();
    </script>`;

  return renderAdmin(ctx, { title: post ? "编辑文章" : "写文章", active: "posts", body, wide: true });
}

async function newPostPage(ctx) {
  return editorPage(ctx, {});
}

async function editPostPage(ctx) {
  const post = await getPostById(ctx.env, toInt(ctx.params.id, 0));
  if (!post) return redirect("/admin/posts?msg=err");
  return editorPage(ctx, { post });
}

async function savePost(ctx) {
  const { env, request, url } = ctx;
  if (!sameOrigin(request, url)) return htmlResponse("请求来源校验失败。", 403);

  const form = await readForm(request);
  const id = toInt(form.id, 0);
  const title = String(form.title || "").trim();
  const content = String(form.content || "");
  const status = form.status === "published" ? "published" : "draft";
  const excerpt = String(form.excerpt || "").trim() || truncate(plainText(content), 100);
  const cover = String(form.cover || "").trim();
  const categoryId = form.category_id ? toInt(form.category_id, 0) || null : null;
  const tags = parseTagList(form.tags);
  const now = Date.now();

  const values = {
    title,
    slug: String(form.slug || "").trim(),
    excerpt,
    cover,
    category_id: categoryId ? String(categoryId) : "",
    tags: tags.join(", "),
    content,
    status,
  };

  if (!title) {
    const post = id ? await getPostById(env, id) : null;
    return editorPage(ctx, { post, values, error: "标题不能为空。" });
  }

  const desiredSlug = slugify(values.slug || title);
  const slug = await uniqueSlug(env, desiredSlug, id);

  try {
    if (id) {
      const existing = await getPostById(env, id);
      if (!existing) return redirect("/admin/posts?msg=err");
      const publishedAt = existing.published_at || (status === "published" ? now : null);
      await run(
        env,
        `UPDATE posts SET title = ?, slug = ?, excerpt = ?, content = ?, cover = ?, category_id = ?,
                          status = ?, updated_at = ?, published_at = ? WHERE id = ?`,
        title,
        slug,
        excerpt,
        content,
        cover,
        categoryId,
        status,
        now,
        publishedAt,
        id
      );
      await syncPostTags(env, id, tags);
      return redirect(`/admin/posts/${id}/edit?msg=saved`);
    }

    const result = await run(
      env,
      `INSERT INTO posts (title, slug, excerpt, content, cover, category_id, status, views, created_at, updated_at, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      title,
      slug,
      excerpt,
      content,
      cover,
      categoryId,
      status,
      now,
      now,
      status === "published" ? now : null
    );
    const newId = result?.meta?.last_row_id;
    if (newId) await syncPostTags(env, newId, tags);
    return redirect(`/admin/posts/${newId}/edit?msg=saved`);
  } catch (err) {
    return editorPage(ctx, { post: id ? await getPostById(env, id) : null, values, error: `保存失败：${err.message || err}` });
  }
}

async function deletePost(ctx) {
  const { env, url } = ctx;
  if (!sameOrigin(ctx.request, url)) return htmlResponse("请求来源校验失败。", 403);
  const id = toInt(ctx.params.id, 0);
  if (!id) return redirect("/admin/posts?msg=err");
  await run(env, "DELETE FROM post_tags WHERE post_id = ?", id);
  await run(env, "DELETE FROM comments WHERE post_id = ?", id);
  await run(env, "DELETE FROM posts WHERE id = ?", id);
  return redirect("/admin/posts?msg=deleted");
}

/* ───────────────────────── 评论管理 ───────────────────────── */

async function commentList(ctx) {
  const { env, url } = ctx;
  const status = url.searchParams.get("status") || "pending";
  const filter = ["pending", "approved", "spam"].includes(status) ? status : null;
  const comments = await listComments(env, filter, 200);
  const pending = await countComments(env, "pending");

  const tabs = [
    ["pending", `待审核${pending ? ` (${pending})` : ""}`],
    ["approved", "已通过"],
    ["spam", "垃圾"],
    ["all", "全部"],
  ]
    .map(
      ([key, label]) =>
        `<a class="tab ${status === key ? "is-active" : ""}" href="/admin/comments?status=${key}">${label}</a>`
    )
    .join("");

  const rows = comments.length
    ? comments
        .map(
          (c) => `<tr>
            <td class="cell-comment">
              <div class="mini-head"><strong>${esc(c.author)}</strong>${
                c.location ? ` <span class="badge loc">${esc(c.location)}</span>` : ""
              } ${
                c.email ? `<span class="cell-muted">${esc(c.email)}</span>` : ""
              }</div>
              <p class="comment-text">${esc(c.content)}</p>
              <div class="cell-sub">${
                c.post_slug
                  ? `<a href="/post/${encodeURIComponent(c.post_slug)}" target="_blank" rel="noopener">${esc(c.post_title)}</a>`
                  : "（文章已删除）"
              } · ${esc(formatDateTime(c.created_at))}</div>
            </td>
            <td>${statusBadge(c.status)}</td>
            <td class="cell-actions">
              ${c.status !== "approved" ? `<form method="post" action="/admin/comments/${c.id}/action"><input type="hidden" name="action" value="approve" /><button class="btn ghost sm">通过</button></form>` : ""}
              ${c.status !== "pending" ? `<form method="post" action="/admin/comments/${c.id}/action"><input type="hidden" name="action" value="pending" /><button class="btn ghost sm">待审</button></form>` : ""}
              ${c.status !== "spam" ? `<form method="post" action="/admin/comments/${c.id}/action"><input type="hidden" name="action" value="spam" /><button class="btn ghost sm">垃圾</button></form>` : ""}
              <form method="post" action="/admin/comments/${c.id}/action" onsubmit="return confirm('确定删除这条评论？')"><input type="hidden" name="action" value="delete" /><button class="btn danger sm">删除</button></form>
            </td>
          </tr>`
        )
        .join("")
    : '<tr><td colspan="3" class="table-empty">没有评论</td></tr>';

  const body = `${noticeHtml(url)}
    <div class="list-toolbar"><div class="tabs">${tabs}</div></div>
    <div class="table-wrap">
      <table class="table"><thead><tr><th>评论</th><th>状态</th><th class="th-actions">操作</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;

  return renderAdmin(ctx, { title: "评论", active: "comments", body, wide: true });
}

async function commentAction(ctx) {
  const { env, request, url } = ctx;
  if (!sameOrigin(request, url)) return htmlResponse("请求来源校验失败。", 403);
  const id = toInt(ctx.params.id, 0);
  const form = await readForm(request);
  const action = form.action;

  if (id) {
    if (action === "delete") {
      await run(env, "DELETE FROM comments WHERE id = ?", id);
    } else if (["approve", "pending", "spam"].includes(action)) {
      const status = action === "approve" ? "approved" : action;
      await run(env, "UPDATE comments SET status = ? WHERE id = ?", status, id);
    }
  }
  return redirect(`${url.searchParams.get("back") || "/admin/comments"}?msg=updated`);
}

/* ───────────────────────── 分类与标签 ───────────────────────── */

async function taxonomyPage(ctx) {
  const { env, url } = ctx;
  const categories = await listCategoriesWithCount(env);
  const tags = await listTagsWithCount(env);

  const body = `${noticeHtml(url)}
    <div class="panel-grid two">
      <section class="panel">
        <div class="panel-head"><h2>分类</h2></div>
        <table class="table compact">
          <thead><tr><th>名称</th><th>别名</th><th>文章数</th><th></th></tr></thead>
          <tbody>
            ${
              categories.length
                ? categories
                    .map(
                      (c) => `<tr>
                        <td>${esc(c.name)}</td>
                        <td class="cell-muted">${esc(c.slug)}</td>
                        <td>${c.count}</td>
                        <td class="cell-actions"><form method="post" action="/admin/categories/${c.id}/delete" onsubmit="return confirm('删除分类？该分类下的文章会变成未分类。')"><button class="btn danger sm">删除</button></form></td>
                      </tr>`
                    )
                    .join("")
                : '<tr><td colspan="4" class="table-empty">还没有分类</td></tr>'
            }
          </tbody>
        </table>
        <form method="post" action="/admin/categories/new" class="inline-form">
          <input name="name" placeholder="新分类名称" required maxlength="20" />
          <input name="slug" placeholder="别名（可留空）" maxlength="40" />
          <button class="btn primary sm" type="submit">添加分类</button>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>标签</h2><span class="cell-muted">${tags.length} 个</span></div>
        <div class="tag-manage">
          ${
            tags.length
              ? tags
                  .map(
                    (t) => `<form method="post" action="/admin/tags/${t.id}/delete" class="tag-chip">
                      <span>#${esc(t.name)} <em>${t.count}</em></span>
                      <button type="submit" title="删除标签">×</button>
                    </form>`
                  )
                  .join("")
              : '<p class="table-empty">还没有标签，写文章时添加即可自动创建。</p>'
          }
        </div>
      </section>
    </div>`;

  return renderAdmin(ctx, { title: "分类与标签", active: "taxonomy", body });
}

async function createCategory(ctx) {
  const { env, request, url } = ctx;
  if (!sameOrigin(request, url)) return htmlResponse("请求来源校验失败。", 403);
  const form = await readForm(request);
  const name = String(form.name || "").trim().slice(0, 20);
  if (!name) return redirect("/admin/taxonomy?msg=err");
  const slug = slugify(String(form.slug || "").trim() || name);
  try {
    await run(
      env,
      "INSERT INTO categories (name, slug, description, created_at) VALUES (?, ?, '', ?)",
      name,
      slug,
      Date.now()
    );
  } catch {
    return redirect("/admin/taxonomy?msg=err");
  }
  return redirect("/admin/taxonomy?msg=saved");
}

async function deleteCategory(ctx) {
  const { env, url } = ctx;
  if (!sameOrigin(ctx.request, url)) return htmlResponse("请求来源校验失败。", 403);
  const id = toInt(ctx.params.id, 0);
  if (id) {
    await run(env, "UPDATE posts SET category_id = NULL WHERE category_id = ?", id);
    await run(env, "DELETE FROM categories WHERE id = ?", id);
  }
  return redirect("/admin/taxonomy?msg=deleted");
}

async function deleteTag(ctx) {
  const { env, url } = ctx;
  if (!sameOrigin(ctx.request, url)) return htmlResponse("请求来源校验失败。", 403);
  const id = toInt(ctx.params.id, 0);
  if (id) {
    await run(env, "DELETE FROM post_tags WHERE tag_id = ?", id);
    await run(env, "DELETE FROM tags WHERE id = ?", id);
  }
  return redirect("/admin/taxonomy?msg=deleted");
}

/* ───────────────────────── 站点设置 ───────────────────────── */

async function settingsPage(ctx) {
  const { env, url } = ctx;
  const s = await getSettings(env);

  const body = `${noticeHtml(url)}
    <form method="post" action="/admin/settings" class="settings-form">
      <section class="panel">
        <div class="panel-head"><h2>基本信息</h2></div>
        <label>站点名称<input name="site_name" value="${esc(s.site_name)}" maxlength="30" required /></label>
        <label>站点简介<input name="site_desc" value="${esc(s.site_desc)}" maxlength="80" /></label>
        <label>页脚文字<input name="site_footer" value="${esc(s.site_footer)}" maxlength="80" /></label>
        <label>每页文章数<input name="page_size" type="number" min="1" max="50" value="${esc(s.page_size)}" /></label>
        <label>首页背景图 API
          <input name="hero_image_api" value="${esc(s.hero_image_api)}" placeholder="留空则不显示背景图" />
          <span class="hint">每次刷新随机取一张图；留空则使用纯色渐变背景。</span>
        </label>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>评论</h2></div>
        <label class="switch">
          <input type="checkbox" name="comments_enabled" value="1" ${s.comments_enabled === "1" ? "checked" : ""} />
          <span>开启评论功能</span>
        </label>
        <label class="switch">
          <input type="checkbox" name="comments_need_review" value="1" ${s.comments_need_review === "1" ? "checked" : ""} />
          <span>新评论需要审核后才展示（不勾选则提交即公开）</span>
        </label>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>关于页面</h2></div>
        <label>内容（支持 Markdown）
          <textarea name="about" rows="8">${esc(s.about)}</textarea>
        </label>
      </section>

      <button class="btn primary" type="submit">保存设置</button>
    </form>

    <section class="panel">
      <div class="panel-head"><h2>修改密码</h2></div>
      <form method="post" action="/admin/password" class="inline-form">
        <input name="current" type="password" placeholder="当前密码" required autocomplete="current-password" />
        <input name="next" type="password" placeholder="新密码（至少 6 位）" required autocomplete="new-password" />
        <input name="next2" type="password" placeholder="确认新密码" required autocomplete="new-password" />
        <button class="btn primary sm" type="submit">更新密码</button>
      </form>
    </section>`;

  return renderAdmin(ctx, { title: "站点设置", active: "settings", body });
}

async function saveSettingsAction(ctx) {
  const { env, request, url } = ctx;
  if (!sameOrigin(request, url)) return htmlResponse("请求来源校验失败。", 403);
  const form = await readForm(request);

  await saveSettings(env, {
    site_name: String(form.site_name || "").trim().slice(0, 30) || "墨记",
    site_desc: String(form.site_desc || "").trim().slice(0, 80),
    site_footer: String(form.site_footer || "").trim().slice(0, 80),
    page_size: String(Math.min(Math.max(toInt(form.page_size, 8), 1), 50)),
    comments_enabled: form.comments_enabled === "1" ? "1" : "0",
    comments_need_review: form.comments_need_review === "1" ? "1" : "0",
    hero_image_api: String(form.hero_image_api || "").trim().slice(0, 200),
    about: String(form.about ?? ""),
  });

  return redirect("/admin/settings?msg=saved");
}

async function changePassword(ctx) {
  const { env, request, url } = ctx;
  if (!sameOrigin(request, url)) return htmlResponse("请求来源校验失败。", 403);
  const form = await readForm(request);
  const current = String(form.current || "");
  const next = String(form.next || "");

  if (next.length < 6 || next !== String(form.next2 || "")) {
    return redirect("/admin/settings?msg=err");
  }

  const user = await one(env, "SELECT * FROM users WHERE id = ?", ctx.user.id);
  if (!user || !(await verifyPassword(current, user.salt, user.password_hash))) {
    return redirect("/admin/settings?msg=err");
  }

  const { salt, password_hash } = await createPassword(next);
  await run(env, "UPDATE users SET password_hash = ?, salt = ? WHERE id = ?", password_hash, salt, user.id);

  return redirect("/admin/login?msg=password", { "Set-Cookie": clearSessionCookie() });
}

/* ───────────────────────── 预览接口 ───────────────────────── */

async function previewApi(ctx) {
  let payload = {};
  try {
    payload = await ctx.request.json();
  } catch {
    payload = {};
  }
  return jsonResponse({ ok: true, html: renderMarkdown(String(payload.content || "")) });
}

/* ───────────────────────── 路由表 ───────────────────────── */

export const adminRoutes = [
  ["GET", "/setup", setupPage],
  ["POST", "/setup", setupSubmit],
  ["GET", "/admin/login", loginPageHandler],
  ["POST", "/admin/login", loginSubmit],
  ["POST", "/admin/logout", logout],

  ["GET", "/admin", requireAuth(dashboard)],
  ["GET", "/admin/posts", requireAuth(postList)],
  ["GET", "/admin/posts/new", requireAuth(newPostPage)],
  ["GET", "/admin/posts/:id/edit", requireAuth(editPostPage)],
  ["POST", "/admin/posts/save", requireAuthPost(savePost)],
  ["POST", "/admin/posts/:id/delete", requireAuthPost(deletePost)],

  ["GET", "/admin/comments", requireAuth(commentList)],
  ["POST", "/admin/comments/:id/action", requireAuthPost(commentAction)],

  ["GET", "/admin/taxonomy", requireAuth(taxonomyPage)],
  ["POST", "/admin/categories/new", requireAuthPost(createCategory)],
  ["POST", "/admin/categories/:id/delete", requireAuthPost(deleteCategory)],
  ["POST", "/admin/tags/:id/delete", requireAuthPost(deleteTag)],

  ["GET", "/admin/settings", requireAuth(settingsPage)],
  ["POST", "/admin/settings", requireAuthPost(saveSettingsAction)],
  ["POST", "/admin/password", requireAuthPost(changePassword)],

  ["POST", "/admin/api/preview", requireAuth(previewApi)],
];
