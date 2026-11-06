# 部署指南

这份文档把部署拆成三条路径，任选一条即可。三条路径最终得到的是同一个博客。

| 路径 | 适合谁 | 需要命令行 | 用时 |
| --- | --- | --- | --- |
| A. 网页操作 → Workers | 不想装任何工具 | 否 | 约 10 分钟 |
| B. 命令行 → Workers | 想一条命令上线 | 是 | 约 3 分钟 |
| C. 网页操作 → Pages | 已有 Pages 项目习惯 | 否 | 约 10 分钟 |

开始之前只需要一个 [Cloudflare 账号](https://dash.cloudflare.com/sign-up)（免费注册）。

---

## 路径 A：全程网页操作，部署到 Workers

### A1. 创建 D1 数据库

1. 登录 Cloudflare Dashboard
2. 左侧菜单找到 **Storage & Databases → D1 SQL Database**
3. 点击 **Create database**，Database name 填 `blog-db`，点击创建
4. 创建完成后页面上会有一串 **Database ID**（形如 `a1b2c3d4-5678-90ab-cdef-1234567890ab`），复制它

> 这一步不需要执行任何 SQL，博客在首次访问时会自动建表。

### A2. 把代码放到 GitHub

1. 在 GitHub 新建一个仓库（Private 也可以）
2. 把本项目所有文件推上去。注意保留目录结构：`src/`、`functions/`、`public/`、`wrangler.toml` 都在仓库根目录
3. 打开 `wrangler.toml`，把 `database_id = "REPLACE_WITH_YOUR_DATABASE_ID"` 换成 A1 复制的那串 ID，提交

> 这条路径用的是 Cloudflare 的 Git 集成构建，构建环境读不到本地未提交的文件，所以 ID 必须写进仓库里的 `wrangler.toml`。
> 用命令行部署的话则不必，把 ID 放在 `wrangler.local.toml` 即可（见路径 B）。

```toml
[[d1_databases]]
binding = "DB"                 # 这个变量名不能改
database_name = "blog-db"
database_id = "a1b2c3d4-5678-90ab-cdef-1234567890ab"
```

### A3. 创建 Worker 并连接仓库

1. Dashboard → **Workers & Pages** → **Create application**
2. 选择 **Workers** 标签页 → **Import a repository**（首次使用需要授权 GitHub）
3. 选中刚才的仓库
4. 构建设置：
   - **Build command**：留空
   - **Deploy command**：保持默认 `npx wrangler deploy`
5. 点击 **Deploy**，等待 1～2 分钟

### A4. 确认 D1 绑定

部署成功后进入该 Worker → **Settings → Bindings**，应该能看到：

```
D1 database    DB    blog-db
```

如果为空，说明 `wrangler.toml` 里的 `database_id` 没填对，改好后重新部署一次即可。

### A5. 完成初始化

1. 打开 `https://<你的项目名>.<你的子域>.workers.dev/setup`
2. 填写用户名和密码（用户名 3～20 位字母数字，密码至少 6 位）
3. 提交后会：
   - 自动创建全部数据表
   - 创建管理员账号
   - 写入默认站点设置
   - 生成一篇示例文章
4. 自动登录并进入后台

到这里就结束了。首页地址是 `https://<你的项目名>.<你的子域>.workers.dev/`。

---

## 路径 B：命令行部署

需要本机已安装 Node.js 18 或更高版本。

```bash
# 1. 进入项目目录，安装开发依赖（只有 wrangler）
npm install

# 2. 登录 Cloudflare（会打开浏览器授权）
npx wrangler login

# 3. 创建 D1 数据库，输出里会有 database_id
npx wrangler d1 create blog-db

# 4. 复制一份本地配置并填入 database_id（这个文件不会提交到 Git）
cp wrangler.toml wrangler.local.toml

# 5. 部署
npm run deploy:local
```

部署成功后会打印出访问地址。打开 `<地址>/setup` 完成初始化。

后续更新代码后，再执行一次 `npm run deploy` 即可。

### 本地开发

```bash
npm install
npm run dev          # 默认 http://localhost:8787
```

本地数据库文件保存在 `.wrangler/state/` 下，和线上数据完全隔离。
第一次打开 `http://localhost:8787` 会自动跳转到 `/setup`，在那里创建本地管理员即可。

如果需要用命令行建表（例如导入到已有数据库）：

```bash
npm run db:init:local     # 本地
npm run db:init           # 线上
```

---

## 路径 C：部署到 Cloudflare Pages

Pages 与 Workers 用的是同一份源码，区别只在于入口文件：
Workers 走 `src/index.js`，Pages 走 `functions/[[path]].js`（它会转发到同一个处理函数）。

### C1. 建 Pages 项目

1. Dashboard → **Workers & Pages** → **Create application** → **Pages** 标签
2. **Connect to Git**，选择仓库
3. 构建设置：

| 项目 | 填写 |
| --- | --- |
| Framework preset | None |
| Build command | 留空 |
| Build output directory | `public` |

4. **Save and Deploy**

> `functions/` 目录会被 Pages 自动识别（它在项目根目录，与输出目录无关），不需要额外配置。

### C2. 绑定 D1

1. 进入 Pages 项目 → **Settings → Functions → D1 database bindings**
2. 点击 **Add binding**
   - Variable name：`DB`（必须一模一样）
   - D1 database：选择 `blog-db`
3. 保存后回到 **Deployments**，对最新一次部署点 **Retry deployment**（重新部署才能让绑定生效）

### C3. 初始化

访问 `https://<项目名>.pages.dev/setup`，流程与路径 A5 相同。

### 用命令行发布 Pages

```bash
npx wrangler pages deploy public --project-name my-blog
```

如果提示 `wrangler.toml` 与 Pages 配置冲突，把根目录的 `wrangler.toml` 临时改名为 `wrangler.workers.toml` 再执行（Pages 用不到它）。

---

## 绑定自定义域名

**Workers**：项目 → **Settings → Domains & Routes → Add custom domain**，输入域名后按提示添加 CNAME。
**Pages**：项目 → **Custom domains → Set up a custom domain**。

域名需要已经托管在 Cloudflare（NS 指向 Cloudflare），这样证书会自动签发，无需手动配置 HTTPS。

> 强烈建议绑定自定义域名后再正式使用：`*.workers.dev` 与 `*.pages.dev` 在国内部分网络环境下访问不稳定。

---

## 环境变量

全部是可选项，不配置也能正常运行。

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `DB` | D1 绑定 | 必填，变量名必须是 `DB` |
| `SITE_NAME` | Variables | 首次初始化时作为站点名；之后以后台设置为准 |
| `SETUP_TOKEN` | Variables / Secret | 初始化口令。**公开仓库或公开域名时建议设置**，否则别人可能抢在你之前访问 `/setup` 创建管理员 |
| `SESSION_SECRET` | Secret | 登录 Cookie 的签名密钥。不设置时会自动生成一个随机值并存进 D1 的 `settings` 表 |

在 Dashboard 设置变量的位置：项目 → **Settings → Variables and Secrets**。
本地开发写在 `.dev.vars` 文件里：

```ini
SITE_NAME="墨记"
SETUP_TOKEN="一串你自己编的随机字符"
```

---

## 部署后的检查清单

逐条对照，全部通过就说明一切正常：

- [ ] 打开首页，能看到文章列表（初始时有 1 篇示例文章）
- [ ] 首页顶部背景图正常显示，刷新两次会换成不同的图片
- [ ] 点击文章标题，正文的标题、列表、代码块、表格都正常渲染
- [ ] 顶部「登录」→ 输入账号密码，能进入 `/admin`
- [ ] 后台「文章 → 写文章」，保存后前台立刻能看到
- [ ] 把文章状态改成「草稿」再保存，前台列表里消失，但登录状态下仍可通过链接预览
- [ ] 在文章页底部提交一条评论，刷新后立刻出现在评论区，后台「评论」里状态为「已通过」
- [ ] 后台「站点设置」勾选「新评论需要审核后才展示」后再提交一条，这次会进入「待审核」，点「通过」后才显示
- [ ] 点「通过」后刷新文章页，评论出现，作者名右侧显示地区（如「中国 · 上海」）
- [ ] `/search?q=关键词` 能搜到文章
- [ ] `/rss.xml` 与 `/sitemap.xml` 返回 XML 而不是报错
- [ ] 后台「站点设置」改名后，前台标题同步变化

---

## 常见问题排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 首页一直 302 跳到 `/setup` | 数据表还没建 | 打开 `/setup` 完成初始化 |
| `/setup` 提交后报「建表失败」 | D1 没绑定或绑定名不是 `DB` | 检查 `wrangler.toml` 的 `binding` 与 Dashboard 的绑定名 |
| 部署时报 `Couldn't find a D1 DB with the name or binding 'DB'` | `database_id` 还是占位符 | 换成 `wrangler d1 create` 输出的真实 ID |
| 页面 500，提示 `no such table` | 同上，未初始化 | 访问 `/setup` |
| 登录成功但立刻又跳回登录页 | 访问的是 `http://` 或域名不匹配 | 用 `https://` 访问；确认 Cookie 未被浏览器拦截 |
| 样式丢失（纯 HTML） | `public/` 没有随项目上传 | 确认仓库里有 `public/style.css`，且路径为根目录 |
| Pages 上 `/admin` 404 | `functions/` 目录没上传 | 确认仓库根目录有 `functions/[[path]].js` |
| 评论提交后提示「提交太频繁」 | 30 秒内同一文章超过 3 条 | 等待片刻再试；确属误判可调整 `src/routes/public.js` 里的阈值 |
| 忘记管理员密码 | — | 在 D1 控制台执行 `DELETE FROM users;`，再访问 `/setup` 重建 |

查看实时日志：

```bash
npx wrangler tail
```

---

## 数据备份与迁移

导出线上数据（SQL 文本，可直接重新导入）：

```bash
npx wrangler d1 export blog-db --remote --output backup-2026-11-06.sql
```

导入到另一个 D1：

```bash
npx wrangler d1 execute blog-db-new --remote --file=./backup-2026-11-06.sql
```

---

## 免费额度参考

| 资源 | 免费额度 | 对个人博客意味着 |
| --- | --- | --- |
| Workers 请求 | 10 万次/天 | 日均几百访问完全够用 |
| Workers CPU | 10 毫秒/请求 | 页面渲染 + 一次登录哈希均在限额内 |
| D1 存储 | 5 GB | 约十万篇文章 |
| D1 读 | 500 万行/天 | 远超个人博客需求 |
| 静态资源 | 不限请求数 | CSS、图片不占用函数额度 |

超出免费额度后需要开通 Workers Paid（$5/月起），个人博客基本用不到。
