/* ============================================================
   智能任务管理 · 前端逻辑
   ============================================================ */

const PRIORITY_LABEL = {
  high: '高优先级',
  medium: '中优先级',
  low: '低优先级',
};

const CHECK_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.6l5 5 10-10.2" ' +
  'stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>';

const TRASH_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9.5 7V5.2h5v1.8M7 7l.7 11.3h8.6L17 7" ' +
  'stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>';

const EMPTY_SVG =
  '<svg viewBox="0 0 64 64" aria-hidden="true">' +
  '<rect x="10" y="8" width="44" height="48" rx="8" fill="none" stroke="currentColor" stroke-width="2.2"/>' +
  '<path d="M20 22h24M20 32h24M20 42h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
  '</svg>';

const el = {
  addForm: document.getElementById('addForm'),
  titleInput: document.getElementById('titleInput'),
  prioritySelect: document.getElementById('prioritySelect'),
  addBtn: document.getElementById('addBtn'),
  formError: document.getElementById('formError'),
  filters: document.getElementById('filters'),
  taskList: document.getElementById('taskList'),
  summary: document.getElementById('summary'),
  progressFill: document.getElementById('progressFill'),
  modeChip: document.getElementById('modeChip'),
  modeText: document.getElementById('modeText'),
  toast: document.getElementById('toast'),
};

const state = {
  tasks: [],
  filter: readSavedFilter(),
  pending: new Set(),
  loaded: false,
};

/* ---------------------------- 工具函数 ---------------------------- */

function readSavedFilter() {
  try {
    const saved = localStorage.getItem('taskflow.filter');
    return ['', 'high', 'medium', 'low'].includes(saved) ? saved : '';
  } catch (_) {
    return '';
  }
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((todayStart - dayStart) / 864e5);
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  if (diffDays === 0) return `今天 ${hm}`;
  if (diffDays === 1) return `昨天 ${hm}`;
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${hm}`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }

  if (!res.ok) {
    throw new Error((data && data.error) || `请求失败（HTTP ${res.status}）`);
  }
  return data || {};
}

let toastTimer = null;
function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.classList.remove('is-visible');
  }, 2400);
}

function showError(message) {
  el.formError.textContent = message;
  el.formError.hidden = false;
}

function clearError() {
  el.formError.hidden = true;
  el.formError.textContent = '';
}

function setMode(mode) {
  const isDemo = mode !== 'supabase';
  el.modeChip.classList.toggle('is-demo', isDemo);
  el.modeText.textContent = isDemo ? '演示模式 · 内存存储' : 'Supabase 已连接';
  el.modeChip.title = isDemo
    ? '未检测到 Supabase 配置，数据仅保存在服务内存中'
    : '数据已连接 Supabase 云端数据库';
}

/* ---------------------------- 数据加载 ---------------------------- */

function renderLoading() {
  el.taskList.innerHTML = '';
  for (let i = 0; i < 3; i += 1) {
    const li = document.createElement('li');
    li.className = 'skeleton';
    el.taskList.appendChild(li);
  }
}

async function loadTasks() {
  if (!state.loaded) renderLoading();
  try {
    const data = await api('/api/tasks');
    state.tasks = Array.isArray(data.tasks) ? data.tasks : [];
    state.loaded = true;
    setMode(data.mode);
    render();
  } catch (err) {
    state.loaded = true;
    state.tasks = [];
    el.taskList.innerHTML = '';
    renderEmpty('数据加载失败', err.message || '请确认后端服务已启动');
    el.summary.textContent = '共 0 条 · 已完成 0 条';
    el.progressFill.style.width = '0%';
  }
}

/* ---------------------------- 渲染 ---------------------------- */

function render() {
  const total = state.tasks.length;
  const done = state.tasks.filter((t) => t.completed).length;

  el.summary.textContent = `共 ${total} 条 · 已完成 ${done} 条`;
  el.progressFill.style.width = total ? `${(done / total) * 100}%` : '0%';

  // 各优先级数量（基于全部任务）
  const counts = { all: total, high: 0, medium: 0, low: 0 };
  state.tasks.forEach((t) => {
    if (counts[t.priority] !== undefined) counts[t.priority] += 1;
  });
  el.filters.querySelectorAll('[data-count]').forEach((node) => {
    node.textContent = String(counts[node.dataset.count] || 0);
  });

  // 筛选按钮状态
  el.filters.querySelectorAll('.filter').forEach((btn) => {
    const active = btn.dataset.priority === state.filter;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  });

  const visible = state.filter
    ? state.tasks.filter((t) => t.priority === state.filter)
    : state.tasks;

  el.taskList.innerHTML = '';

  if (!visible.length) {
    renderEmpty(
      state.filter ? '当前筛选下暂无任务' : '还没有任务',
      state.filter ? '换个优先级看看，或添加一条新任务' : '在上方输入内容，开始安排今天的事'
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  visible.forEach((task, index) => {
    const item = createTaskItem(task, index);
    fragment.appendChild(item);
  });
  el.taskList.appendChild(fragment);
}

function renderEmpty(title, hint) {
  const wrap = document.createElement('li');
  wrap.className = 'empty';

  const icon = document.createElement('div');
  icon.innerHTML = EMPTY_SVG;

  const main = document.createElement('p');
  main.textContent = title;

  const sub = document.createElement('span');
  sub.textContent = hint;

  wrap.append(icon, main, sub);
  el.taskList.appendChild(wrap);
}

function createTaskItem(task, index) {
  const li = document.createElement('li');
  li.className = 'task' + (task.completed ? ' is-completed' : '');
  li.dataset.id = task.id;
  li.dataset.priority = task.priority;
  li.style.animationDelay = `${Math.min(index * 24, 180)}ms`;

  // 勾选圆钮（快速切换）
  const check = document.createElement('button');
  check.type = 'button';
  check.className = 'check';
  check.innerHTML = CHECK_SVG;
  check.setAttribute(
    'aria-label',
    task.completed ? '标记为未完成' : '标记为已完成'
  );
  check.title = task.completed ? '点击标记为未完成' : '点击标记为已完成';
  check.addEventListener('click', () => toggleTask(task));

  // 主体
  const body = document.createElement('div');
  body.className = 'task-body';

  const title = document.createElement('p');
  title.className = 'task-title';
  title.textContent = task.title;
  title.title = task.title;

  const meta = document.createElement('div');
  meta.className = 'task-meta';

  const badge = document.createElement('span');
  badge.className = `badge ${task.priority}`;
  badge.textContent = PRIORITY_LABEL[task.priority] || '中优先级';

  const time = document.createElement('span');
  time.className = 'task-time';
  time.textContent = formatTime(task.created_at);

  meta.append(badge, time);
  body.append(title, meta);

  // 操作区
  const actions = document.createElement('div');
  actions.className = 'task-actions';

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'btn-toggle';
  toggleBtn.textContent = task.completed ? '标记未完成' : '标记完成';
  toggleBtn.addEventListener('click', () => toggleTask(task));

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn-delete';
  deleteBtn.innerHTML = TRASH_SVG;
  const deleteLabel = document.createElement('span');
  deleteLabel.textContent = '删除';
  deleteBtn.appendChild(deleteLabel);
  deleteBtn.title = '删除这条任务';

  let confirmTimer = null;
  deleteBtn.addEventListener('click', () => {
    if (!deleteBtn.classList.contains('is-confirming')) {
      deleteBtn.classList.add('is-confirming');
      deleteLabel.textContent = '确认删除';
      confirmTimer = setTimeout(() => {
        if (!deleteBtn.isConnected) return;
        deleteBtn.classList.remove('is-confirming');
        deleteLabel.textContent = '删除';
      }, 3000);
      return;
    }
    clearTimeout(confirmTimer);
    deleteTask(task);
  });

  actions.append(toggleBtn, deleteBtn);
  li.append(check, body, actions);
  return li;
}

/* ---------------------------- 交互操作 ---------------------------- */

async function toggleTask(task) {
  if (state.pending.has(task.id)) return;
  state.pending.add(task.id);

  try {
    const data = await api(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ completed: !task.completed }),
    });

    const index = state.tasks.findIndex((t) => t.id === task.id);
    if (index > -1) state.tasks[index] = data.task;
    render();
  } catch (err) {
    toast(`操作失败：${err.message}`);
  } finally {
    state.pending.delete(task.id);
  }
}

async function deleteTask(task) {
  if (state.pending.has(task.id)) return;
  state.pending.add(task.id);

  try {
    await api(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE' });
    state.tasks = state.tasks.filter((t) => t.id !== task.id);
    render();
    toast('已删除任务');
  } catch (err) {
    toast(`删除失败：${err.message}`);
  } finally {
    state.pending.delete(task.id);
  }
}

function setFilter(priority) {
  state.filter = priority;
  try {
    localStorage.setItem('taskflow.filter', priority);
  } catch (_) {
    /* 忽略隐私模式下的存储限制 */
  }
  render();
}

el.filters.addEventListener('click', (event) => {
  const btn = event.target.closest('.filter');
  if (!btn) return;
  setFilter(btn.dataset.priority || '');
});

el.addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = el.titleInput.value.trim();

  if (!title) {
    showError('任务内容不能为空');
    el.titleInput.focus();
    return;
  }
  if (title.length > 200) {
    showError('任务内容最多 200 个字符');
    return;
  }

  clearError();
  el.addBtn.disabled = true;

  try {
    const data = await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title, priority: el.prioritySelect.value }),
    });

    state.tasks.unshift(data.task);
    el.titleInput.value = '';
    el.titleInput.focus();

    // 若当前筛选与新增任务优先级不同，自动切回「全部」以免任务"消失"
    if (state.filter && state.filter !== data.task.priority) {
      setFilter('');
    } else {
      render();
    }

    toast('已添加任务');
  } catch (err) {
    showError(err.message);
  } finally {
    el.addBtn.disabled = false;
  }
});

el.titleInput.addEventListener('input', () => {
  if (!el.formError.hidden) clearError();
});

/* ---------------------------- 启动 ---------------------------- */

loadTasks();
