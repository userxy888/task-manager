-- ============================================================
-- Row Level Security 授权脚本
-- 场景：tasks 表已存在，但写入时报 42501
--       "new row violates row-level security policy for table tasks"
-- 用法：Supabase 控制台 → SQL Editor → 粘贴执行 → Run
-- ============================================================

alter table public.tasks enable row level security;

-- 方式 A（推荐用于当前这个单用户小应用）：
-- 允许 anon（publishable key）对 tasks 表读写。
drop policy if exists "tasks_anon_read"  on public.tasks;
drop policy if exists "tasks_anon_write" on public.tasks;

create policy "tasks_anon_read"
  on public.tasks for select
  to anon, authenticated
  using (true);

create policy "tasks_anon_write"
  on public.tasks for insert
  to anon, authenticated
  with check (true);

create policy "tasks_anon_update"
  on public.tasks for update
  to anon, authenticated
  using (true)
  with check (true);

create policy "tasks_anon_delete"
  on public.tasks for delete
  to anon, authenticated
  using (true);

-- 方式 B（更安全，仅当你之后接入了 Supabase Auth 登录时使用）：
-- 1) 给表加 user_id：alter table public.tasks add column user_id uuid references auth.users(id);
-- 2) 把上面策略里的 using (true) / with check (true) 换成 auth.uid() = user_id；
-- 3) 前端写入时带上当前登录用户的 user_id。

-- 执行完可用下面语句自检（应返回 4 条策略）：
-- select policyname, cmd, roles from pg_policies where tablename = 'tasks';
