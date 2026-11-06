// 数据库结构（与根目录 schema.sql 保持一致）
// 用于 /setup 页面一键初始化，逐条执行以避免 D1 单语句限制。
export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '博主',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    excerpt TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    cover TEXT NOT NULL DEFAULT '',
    category_id INTEGER,
    status TEXT NOT NULL DEFAULT 'draft',
    views INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    published_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_posts_status ON posts (status, published_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_category ON posts (category_id)`,
  `CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE
  )`,
  `CREATE TABLE IF NOT EXISTS post_tags (
    post_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (post_id, tag_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags (tag_id)`,
  `CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    author TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    location TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_status ON comments (status, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];
