// 数据访问层：所有 D1 查询集中在这里

import { paginate } from "./utils.js";

/** 取消 D1 不支持的值类型 */
function clean(args) {
  return args.map((v) => (v === undefined ? null : v));
}

export async function all(env, sql, ...args) {
  const stmt = env.DB.prepare(sql);
  const bound = args.length ? stmt.bind(...clean(args)) : stmt;
  const res = await bound.all();
  return res.results || [];
}

export async function one(env, sql, ...args) {
  const stmt = env.DB.prepare(sql);
  const bound = args.length ? stmt.bind(...clean(args)) : stmt;
  return (await bound.first()) || null;
}

export async function run(env, sql, ...args) {
  const stmt = env.DB.prepare(sql);
  const bound = args.length ? stmt.bind(...clean(args)) : stmt;
  return bound.run();
}

/* ───────────────────────── 站点设置 ───────────────────────── */

export const DEFAULT_SETTINGS = {
  site_name: "墨记",
  site_desc: "把想说的话，慢慢写下来。",
  site_footer: "用 Cloudflare Workers 驱动",
  page_size: "8",
  comments_enabled: "1",
  comments_need_review: "0",
  hero_image_api: "https://www.loliapi.com/acg/",
  about: "## 关于我\n\n这里还没有内容，登录后台 → 站点设置即可修改。",
};

export async function getSettings(env) {
  let rows = [];
  try {
    rows = await all(env, "SELECT key, value FROM settings");
  } catch {
    rows = [];
  }
  const map = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key === "session_secret") continue;
    map[row.key] = row.value;
  }
  if (env.SITE_NAME && !rows.some((r) => r.key === "site_name")) map.site_name = env.SITE_NAME;
  map.page_size = String(Math.min(Math.max(parseInt(map.page_size, 10) || 8, 1), 50));
  return map;
}

export async function saveSettings(env, patch) {
  const entries = Object.entries(patch).filter(([k]) => k !== "session_secret");
  for (const [key, value] of entries) {
    await run(
      env,
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      String(value ?? "")
    );
  }
}

/* ───────────────────────── 文章 ───────────────────────── */

const POST_SELECT = `
  SELECT p.id, p.title, p.slug, p.excerpt, p.content, p.cover, p.category_id,
         p.status, p.views, p.created_at, p.updated_at, p.published_at,
         c.name AS category_name, c.slug AS category_slug
  FROM posts p
  LEFT JOIN categories c ON c.id = p.category_id
`;

export async function listPosts(env, options = {}) {
  const {
    status = "published",
    page = 1,
    pageSize = 8,
    categorySlug = null,
    tagSlug = null,
    search = null,
  } = options;

  const where = [];
  const params = [];

  if (status) {
    where.push("p.status = ?");
    params.push(status);
  }
  if (categorySlug) {
    where.push("c.slug = ?");
    params.push(categorySlug);
  }
  if (tagSlug) {
    where.push(
      "p.id IN (SELECT pt.post_id FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE t.slug = ?)"
    );
    params.push(tagSlug);
  }
  if (search) {
    where.push("(p.title LIKE ? OR p.excerpt LIKE ? OR p.content LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const countRow = await one(
    env,
    `SELECT COUNT(*) AS n FROM posts p LEFT JOIN categories c ON c.id = p.category_id ${whereSql}`,
    ...params
  );
  const total = countRow?.n || 0;
  const pageInfo = paginate(total, pageSize, page);

  const rows = await all(
    env,
    `${POST_SELECT} ${whereSql}
     ORDER BY COALESCE(p.published_at, p.created_at) DESC
     LIMIT ? OFFSET ?`,
    ...params,
    pageInfo.limit,
    pageInfo.offset
  );

  return { posts: rows, total, pageInfo };
}

export async function getPostBySlug(env, slug, includeDraft = false) {
  const sql = includeDraft
    ? `${POST_SELECT} WHERE p.slug = ?`
    : `${POST_SELECT} WHERE p.slug = ? AND p.status = 'published'`;
  return one(env, sql, slug);
}

export async function getPostById(env, id) {
  return one(env, `${POST_SELECT} WHERE p.id = ?`, id);
}

export async function bumpViews(env, id) {
  try {
    await run(env, "UPDATE posts SET views = views + 1 WHERE id = ?", id);
  } catch {
    /* 浏览量失败不影响页面 */
  }
}

export async function uniqueSlug(env, desired, excludeId = 0) {
  let slug = desired;
  let n = 1;
  while (true) {
    const row = await one(env, "SELECT id FROM posts WHERE slug = ? AND id <> ?", slug, excludeId);
    if (!row) return slug;
    n += 1;
    slug = `${desired}-${n}`;
  }
}

/* ───────────────────────── 标签 ───────────────────────── */

export async function getTagsOfPost(env, postId) {
  return all(
    env,
    `SELECT t.id, t.name, t.slug FROM tags t
     JOIN post_tags pt ON pt.tag_id = t.id
     WHERE pt.post_id = ? ORDER BY t.name`,
    postId
  );
}

/** 批量取多篇文章的标签，返回 Map<postId, tag[]> */
export async function getTagsForPosts(env, postIds) {
  const map = new Map();
  if (!postIds.length) return map;
  const placeholders = postIds.map(() => "?").join(",");
  const rows = await all(
    env,
    `SELECT pt.post_id, t.id, t.name, t.slug FROM post_tags pt
     JOIN tags t ON t.id = pt.tag_id
     WHERE pt.post_id IN (${placeholders}) ORDER BY t.name`,
    ...postIds
  );
  for (const row of rows) {
    if (!map.has(row.post_id)) map.set(row.post_id, []);
    map.get(row.post_id).push({ id: row.id, name: row.name, slug: row.slug });
  }
  return map;
}

/** 同步文章标签：按名称列表创建/关联 */
export async function syncPostTags(env, postId, names) {
  await run(env, "DELETE FROM post_tags WHERE post_id = ?", postId);
  for (const name of names) {
    const slug = name
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "tag";
    let tag = await one(env, "SELECT id FROM tags WHERE name = ?", name);
    if (!tag) {
      try {
        await run(env, "INSERT INTO tags (name, slug) VALUES (?, ?)", name, slug);
      } catch {
        /* slug 冲突时补充随机后缀 */
        await run(env, "INSERT INTO tags (name, slug) VALUES (?, ?)", name, `${slug}-${Date.now() % 10000}`);
      }
      tag = await one(env, "SELECT id FROM tags WHERE name = ?", name);
    }
    if (tag) {
      await run(
        env,
        "INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)",
        postId,
        tag.id
      );
    }
  }
}

export async function listTagsWithCount(env) {
  return all(
    env,
    `SELECT t.id, t.name, t.slug, COUNT(pt.post_id) AS count
     FROM tags t
     LEFT JOIN post_tags pt ON pt.tag_id = t.id
     LEFT JOIN posts p ON p.id = pt.post_id AND p.status = 'published'
     GROUP BY t.id ORDER BY count DESC, t.name`
  );
}

/* ───────────────────────── 分类 ───────────────────────── */

export async function listCategoriesWithCount(env) {
  return all(
    env,
    `SELECT c.id, c.name, c.slug, c.description,
            (SELECT COUNT(*) FROM posts p WHERE p.category_id = c.id AND p.status = 'published') AS count
     FROM categories c ORDER BY c.id`
  );
}

export async function getCategoryBySlug(env, slug) {
  return one(env, "SELECT * FROM categories WHERE slug = ?", slug);
}

export async function getTagBySlug(env, slug) {
  return one(env, "SELECT * FROM tags WHERE slug = ?", slug);
}

/* ───────────────────────── 评论 ───────────────────────── */

export async function listApprovedComments(env, postId) {
  return all(
    env,
    "SELECT id, author, content, location, created_at FROM comments WHERE post_id = ? AND status = 'approved' ORDER BY created_at ASC",
    postId
  );
}

export async function listComments(env, status = null, limit = 100) {
  const where = status ? "WHERE cm.status = ?" : "";
  const params = status ? [status] : [];
  return all(
    env,
    `SELECT cm.*, p.title AS post_title, p.slug AS post_slug
     FROM comments cm LEFT JOIN posts p ON p.id = cm.post_id
     ${where} ORDER BY cm.created_at DESC LIMIT ?`,
    ...params,
    limit
  );
}

export async function countComments(env, status) {
  const row = await one(env, "SELECT COUNT(*) AS n FROM comments WHERE status = ?", status);
  return row?.n || 0;
}

/* ───────────────────────── 归档与统计 ───────────────────────── */

export async function listAllPublishedBrief(env) {
  return all(
    env,
    `SELECT id, title, slug, published_at, created_at FROM posts
     WHERE status = 'published' ORDER BY COALESCE(published_at, created_at) DESC`
  );
}

export async function getStats(env) {
  const [total, published, drafts, pendingComments, views] = await Promise.all([
    one(env, "SELECT COUNT(*) AS n FROM posts"),
    one(env, "SELECT COUNT(*) AS n FROM posts WHERE status = 'published'"),
    one(env, "SELECT COUNT(*) AS n FROM posts WHERE status = 'draft'"),
    one(env, "SELECT COUNT(*) AS n FROM comments WHERE status = 'pending'"),
    one(env, "SELECT COALESCE(SUM(views), 0) AS n FROM posts"),
  ]);
  return {
    total: total?.n || 0,
    published: published?.n || 0,
    drafts: drafts?.n || 0,
    pendingComments: pendingComments?.n || 0,
    views: views?.n || 0,
  };
}
