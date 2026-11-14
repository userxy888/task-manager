/**
 * 智能任务管理系统 · 后端服务
 * Node.js + Express + Supabase
 *
 * 说明：
 *  - 配置了 SUPABASE_URL / SUPABASE_KEY 时，数据写入 Supabase 云端表 tasks；
 *  - 未配置时自动进入「演示模式」，数据保存在服务进程内存中，方便先跑起来看效果。
 */

require('dotenv').config();

const path = require('path');
const express = require('express');

const PORT = Number(process.env.PORT) || 3000;
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = (
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  ''
).trim();
const PRIORITIES = ['high', 'medium', 'low'];

/**
 * 数据库里 priority 存中文（'高' / '中' / '低'），
 * 前端沿用原来的 high / medium / low，由后端统一转译，
 * 这样界面与交互完全不用改。
 */
const TO_DB_PRIORITY = { high: '高', medium: '中', low: '低' };
const TO_API_PRIORITY = {
  高: 'high',
  中: 'medium',
  低: 'low',
  // 兼容历史数据里可能存在的英文值
  high: 'high',
  medium: 'medium',
  low: 'low',
};

/** 统一把数据库行转换成前端使用的结构（id 转字符串，priority 转英文枚举） */
function normalizeRow(row) {
  return {
    id: String(row.id),
    title: row.title,
    priority: TO_API_PRIORITY[row.priority] || 'medium',
    completed: Boolean(row.completed),
    created_at: row.created_at,
  };
}

const TASK_COLUMNS = 'id, title, priority, completed, created_at';

/* ---------------------------- 数据库连接 ---------------------------- */

const hasSupabaseConfig =
  /^https?:\/\//.test(SUPABASE_URL) && SUPABASE_KEY.length > 0;

let supabase = null;
if (hasSupabaseConfig) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/* ---------------------------- 演示模式内存存储 ---------------------------- */

const demo = { seq: 0, tasks: [] };

// 演示模式预置几条示例任务，方便第一次打开就能看到完整界面效果
[
  { title: '完成软件体系结构课程作业', priority: 'high', completed: false },
  { title: '刷 30 道王道数据结构选择题', priority: 'medium', completed: false },
  { title: '整理本周英语单词笔记', priority: 'low', completed: true },
  { title: '给项目写一份 README 说明', priority: 'medium', completed: false },
].forEach((item, index) => {
  demo.tasks.push({
    id: `demo-${++demo.seq}`,
    title: item.title,
    priority: item.priority,
    completed: item.completed,
    created_at: new Date(Date.now() - index * 36e5).toISOString(), // 每条间隔 1 小时
  });
});

function sortByCreatedAtDesc(list) {
  return list
    .slice()
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
}

/* ---------------------------- 数据访问层 ---------------------------- */

const store = {
  async list({ priority, status }) {
    if (supabase) {
      let query = supabase.from('tasks').select(TASK_COLUMNS);

      if (priority) query = query.eq('priority', TO_DB_PRIORITY[priority]);
      if (status === 'completed') query = query.eq('completed', true);
      if (status === 'active') query = query.eq('completed', false);

      const { data, error } = await query.order('created_at', {
        ascending: false,
      });
      if (error) throw error;
      return (data || []).map(normalizeRow);
    }

    let list = demo.tasks;
    if (priority) list = list.filter((t) => t.priority === priority);
    if (status === 'completed') list = list.filter((t) => t.completed);
    if (status === 'active') list = list.filter((t) => !t.completed);
    return sortByCreatedAtDesc(list);
  },

  async create({ title, priority }) {
    if (supabase) {
      const { data, error } = await supabase
        .from('tasks')
        .insert({ title, priority: TO_DB_PRIORITY[priority] })
        .select(TASK_COLUMNS)
        .single();
      if (error) throw error;
      return normalizeRow(data);
    }

    const task = {
      id: `demo-${++demo.seq}`,
      title,
      priority,
      completed: false,
      created_at: new Date().toISOString(),
    };
    demo.tasks.push(task);
    return task;
  },

  async setCompleted(id, completed) {
    if (supabase) {
      const { data, error } = await supabase
        .from('tasks')
        .update({ completed })
        .eq('id', id)
        .select(TASK_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      return data ? normalizeRow(data) : null;
    }

    const task = demo.tasks.find((t) => t.id === id);
    if (!task) return null;
    task.completed = completed;
    return task;
  },

  async remove(id) {
    if (supabase) {
      const { error, count } = await supabase
        .from('tasks')
        .delete({ count: 'exact' })
        .eq('id', id);
      if (error) throw error;
      return (count || 0) > 0;
    }

    const index = demo.tasks.findIndex((t) => t.id === id);
    if (index === -1) return false;
    demo.tasks.splice(index, 1);
    return true;
  },
};

/* ---------------------------- HTTP 服务 ---------------------------- */

const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// 健康检查 / 运行模式
app.get('/api/health', (req, res) => {
  res.json({ ok: true, mode: supabase ? 'supabase' : 'demo' });
});

// 查询任务列表（支持 ?priority=high|medium|low 与 ?status=active|completed）
app.get(
  '/api/tasks',
  wrap(async (req, res) => {
    const priority = (req.query.priority || '').trim();
    const status = (req.query.status || '').trim();

    if (priority && !PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: '优先级参数不合法' });
    }
    if (status && !['active', 'completed'].includes(status)) {
      return res.status(400).json({ error: '状态参数不合法' });
    }

    const tasks = await store.list({ priority: priority || null, status });
    res.json({ mode: supabase ? 'supabase' : 'demo', count: tasks.length, tasks });
  })
);

// 新建任务
app.post(
  '/api/tasks',
  wrap(async (req, res) => {
    const rawTitle = req.body && req.body.title;
    const rawPriority = req.body && req.body.priority;

    if (typeof rawTitle !== 'string') {
      return res.status(400).json({ error: '任务内容不能为空' });
    }
    const title = rawTitle.trim();
    if (!title) return res.status(400).json({ error: '任务内容不能为空' });
    if (title.length > 200) {
      return res.status(400).json({ error: '任务内容最多 200 个字符' });
    }

    const priority = rawPriority || 'medium';
    if (!PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: '优先级参数不合法' });
    }

    const task = await store.create({ title, priority });
    res.status(201).json({ task });
  })
);

// 切换完成状态
app.patch(
  '/api/tasks/:id',
  wrap(async (req, res) => {
    const { completed } = req.body || {};
    if (typeof completed !== 'boolean') {
      return res.status(400).json({ error: 'completed 必须是布尔值' });
    }

    const task = await store.setCompleted(req.params.id, completed);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    res.json({ task });
  })
);

// 删除任务
app.delete(
  '/api/tasks/:id',
  wrap(async (req, res) => {
    const removed = await store.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: '任务不存在' });
    res.json({ ok: true });
  })
);

// 统一错误处理
app.use((err, req, res, next) => {
  console.error('[api error]', err && err.message ? err.message : err);
  let message =
    err && err.message ? `数据操作失败：${err.message}` : '服务器内部错误';
  if (err && err.code === '42501') {
    message += '（tasks 表启用了 RLS 且未给 anon 角色授权，请执行 supabase/policies.sql）';
  }
  res.status(500).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`\n  智能任务管理系统已启动：http://localhost:${PORT}`);
  console.log(
    `  数据存储：${supabase ? 'Supabase 云端' : '演示模式（服务内存，重启后清空）'}\n`
  );
});
