# 智能任务管理系统（Node.js + Supabase）

后端 Node.js / Express，通过 `@supabase/supabase-js` 走 Supabase REST API 读写 `tasks` 表；前端原生 HTML/CSS/JS，无需构建工具，界面不依赖任何后端字段命名。

## 功能

- 输入框 + 优先级下拉（高 / 中 / 低）添加任务，支持回车提交
- 列表展示标题、优先级标签、创建时间、完成状态
- 每条任务带「标记完成 / 标记未完成」切换按钮与「删除」按钮（删除需二次确认）
- 按优先级筛选（全部 / 高 / 中 / 低），各筛选项显示数量
- 按创建时间倒序，已完成任务标题加删除线
- 顶部进度条 + 统计（共 N 条 · 已完成 M 条）
- 未配置 Supabase 时进入「演示模式」（内存存储，便于先看界面）

## 目录结构

```
task-manager/
├── server.js              # Express + Supabase REST 访问层
├── package.json
├── .env.example           # 环境变量模板
├── supabase/
│   ├── schema.sql         # 建表（id bigint 自增 / priority 中文）
│   └── policies.sql       # RLS 授权（写入报 42501 时执行）
└── public/
    ├── index.html
    ├── style.css
    └── app.js
```

## 数据库表结构

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `bigint` | 自增主键（identity） |
| `title` | `text` | 任务内容 |
| `priority` | `text` | `高` / `中` / `低`，默认 `中` |
| `completed` | `boolean` | 默认 `false` |
| `created_at` | `timestamptz` | 默认 `now()` |

索引：`created_at desc`、`priority`。

### 前后端字段约定

数据库里 `priority` 存中文，前端沿用 `high / medium / low`，由 `server.js` 统一转译：

| 前端 / API | 数据库 |
| --- | --- |
| `high` | `高` |
| `medium` | `中` |
| `low` | `低` |

`id` 是 bigint，接口返回时统一转成字符串（`String(row.id)`），避免 JS 大整数精度问题，前端无需改动。
读取时若遇到历史英文值（`high` 等）会自动兼容。

## 启动

### 演示模式（不接数据库）

```bash
npm install
npm start        # http://localhost:3000
```

### 接入 Supabase

1. **建表**：全新项目在 SQL Editor 执行 `supabase/schema.sql`；表已存在则跳过。
2. **授权**：执行 `supabase/policies.sql`。
   若写入报 `42501 new row violates row-level security policy`，就是没授权（RLS 开启但没有策略）。
3. **配置**：复制 `.env.example` 为 `.env`，填入：

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=sb_publishable_xxx      # 需要 policies.sql 授权
# SUPABASE_KEY=sb_secret_xxx         # 或者用 secret key（绕过 RLS，仅服务端）
PORT=3000
```

4. 启动：

```bash
npm start
```

浏览器打开 http://localhost:3000 ，右上角显示绿色「Supabase 已连接」即生效。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 运行模式：`supabase` / `demo` |
| GET | `/api/tasks` | 倒序列表，支持 `?priority=high\|medium\|low`、`?status=active\|completed` |
| POST | `/api/tasks` | `{ "title": "...", "priority": "high" }` |
| PATCH | `/api/tasks/:id` | `{ "completed": true }` |
| DELETE | `/api/tasks/:id` | 删除 |

```bash
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"复习软件体系结构","priority":"high"}'
```

## 常见问题

- **`401 Secret API key required`（访问 `/rest/v1/` 根路径）**：OpenAPI 根路径只对 secret key 开放，应用本身走 `/rest/v1/tasks`，不受影响。
- **写入报 `42501 ... row-level security policy`**：执行 `supabase/policies.sql`，或改用 secret key。
- **写入报 `23514 ... check constraint`**：`priority` 只允许 `高 / 中 / 低`，检查是否传了英文值（本项目后端会自动转中文）。
- **页面显示「演示模式」**：`.env` 未被读到（文件名、位置、是否重启服务）。
- **`PGRST205 relation "tasks" does not exist`**：表没建，执行 `schema.sql`。

## 生产环境建议

- secret key 只放服务端 `.env`，不要进前端、不要提交仓库。
- `policies.sql` 里的策略是「anon 全放开」，适合单用户 Demo；正式上线应加 `user_id` 字段并用 `auth.uid() = user_id` 的策略，配合 Supabase Auth 登录。
- 部署到 Railway / Render / Vercel 时把 `SUPABASE_URL`、`SUPABASE_KEY` 配成环境变量。
