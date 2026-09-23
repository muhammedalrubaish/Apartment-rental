-- إشعارات الجوال (Web Push) للمالك: رسالة جديدة من ضيف، وحجوزات/أعطال مزامنة المنصات
-- يُطبَّق مرة واحدة على مشروع Supabase (SQL Editor) — بعد الهجرة 0010
--
-- المكونات:
--  1) push_subscriptions: أجهزة المالك المشتركة في الإشعارات (يسجّلها من لوحة التحكم).
--  2) push_vapid: مفتاحا توقيع الإشعارات. يولّدهما الخادم (/api/push-notify) عند أول
--     استخدام ويحفظهما هنا؛ المفتاح الخاص لا يُقرأ إلا عبر دالة تشترط مفتاح المزامنة
--     السري (ical_sync_key)، فلا يمر بالمستودع ولا بالمتصفح.
--  3) دوال security definer بمفتاح المزامنة: قائمة الأجهزة، حذف جهاز منتهٍ، المفاتيح،
--     وحالة روابط المنصات (لإرسال إشعار العطل مرة واحدة لا كل 15 دقيقة).
--  4) مشغّل (trigger) على جدول messages: كل رسالة من زائر تُرسل طلباً إلى
--     /api/push-notify عبر pg_net فيصل إشعار فوري للجوال.

-- ── 1. أجهزة المالك ─────────────────────────────────────────────────
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  device text,
  created_at timestamptz not null default now()
);

comment on table public.push_subscriptions is 'أجهزة المالك المشتركة في إشعارات الجوال (Web Push)';

alter table public.push_subscriptions enable row level security;

drop policy if exists owner_all_push_subscriptions on public.push_subscriptions;
create policy owner_all_push_subscriptions on public.push_subscriptions
  for all to authenticated using (true) with check (true);

-- ── 2. مفاتيح التوقيع — بلا أي سياسة: لا يقرؤها أحد إلا الدوال أدناه ──────
create table if not exists public.push_vapid (
  id smallint primary key default 1 check (id = 1),
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);

alter table public.push_vapid enable row level security;

-- ── 3. الدوال (تشترط مفتاح المزامنة السري من الهجرة 0010) ─────────────
create or replace function public.push_targets(p_key text)
returns table (endpoint text, p256dh text, auth text)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ical_sync_check(p_key);
  return query select s.endpoint, s.p256dh, s.auth from public.push_subscriptions s;
end $$;

-- جهاز ألغى الاشتراك أو انتهى (رد 404/410 من خدمة الإشعارات)
create or replace function public.push_forget(p_key text, p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ical_sync_check(p_key);
  delete from public.push_subscriptions where endpoint = p_endpoint;
end $$;

create or replace function public.push_vapid_get(p_key text)
returns table (public_key text, private_key text)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ical_sync_check(p_key);
  return query select v.public_key, v.private_key from public.push_vapid v where v.id = 1;
end $$;

-- يحفظ المفتاحين مرة واحدة فقط؛ الاستدعاءات اللاحقة لا تغيّر شيئاً
create or replace function public.push_vapid_init(p_key text, p_public text, p_private text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ical_sync_check(p_key);
  if length(coalesce(p_public, '')) < 60 or length(coalesce(p_private, '')) < 40 then
    raise exception 'invalid vapid keys' using errcode = '22023';
  end if;
  insert into public.push_vapid (id, public_key, private_key) values (1, p_public, p_private)
  on conflict (id) do nothing;
end $$;

-- حالة روابط المنصات قبل المزامنة — لإشعار العطل عند حدوثه أول مرة وإشعار عودته
create or replace function public.ical_feed_status(p_key text)
returns table (id text, last_error text)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ical_sync_check(p_key);
  return query select f.id, f.last_error from public.ical_feeds f;
end $$;

revoke all on function public.push_targets(text) from public;
revoke all on function public.push_forget(text, text) from public;
revoke all on function public.push_vapid_get(text) from public;
revoke all on function public.push_vapid_init(text, text, text) from public;
revoke all on function public.ical_feed_status(text) from public;
grant execute on function public.push_targets(text) to anon, authenticated;
grant execute on function public.push_forget(text, text) to anon, authenticated;
grant execute on function public.push_vapid_get(text) to anon, authenticated;
grant execute on function public.push_vapid_init(text, text, text) to anon, authenticated;
grant execute on function public.ical_feed_status(text) to anon, authenticated;

-- ── 4. إشعار فوري عند رسالة زائر ─────────────────────────────────────
create or replace function public.notify_owner_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_key text;
begin
  if new.sender is distinct from 'visitor' then
    return new;
  end if;

  -- أي خطأ هنا يجب ألا يمنع حفظ رسالة الضيف
  begin
    select key into v_key from public.ical_sync_key where id = 1;
    select c.visitor_name into v_name from public.conversations c where c.id = new.conversation_id;

    perform net.http_post(
      url := 'https://rentapa.vercel.app/api/push-notify',
      body := jsonb_build_object(
        'title', '💬 رسالة من ' || coalesce(nullif(btrim(v_name), ''), 'زائر'),
        'body', left(coalesce(new.body, ''), 160),
        'url', '/admin#messages',
        'tag', 'msg-' || new.conversation_id::text
      ),
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Sync-Key', v_key),
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'push notify failed: %', sqlerrm;
  end;

  return new;
end $$;

drop trigger if exists trg_notify_owner_new_message on public.messages;
create trigger trg_notify_owner_new_message
  after insert on public.messages
  for each row execute function public.notify_owner_new_message();
