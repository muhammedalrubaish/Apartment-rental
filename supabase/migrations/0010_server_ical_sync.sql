-- مزامنة تقاويم المنصات (جاذر إن / Airbnb) من الخادم كل 15 دقيقة — دون فتح لوحة التحكم
-- يُطبَّق مرة واحدة على مشروع Supabase (SQL Editor)
--
-- الخلفية: كانت روابط المنصات محفوظة في متصفح المالك فقط، والمزامنة تجري عند فتح
-- لوحة التحكم. فحجزٌ جديد في Airbnb لا يصل للموقع حتى يفتح المالك اللوحة، فيبقى
-- اليوم «متاحاً» في الصفحة الرئيسية.
--
-- الحل:
--  1) جدول ical_feeds يحفظ روابط المنصات في القاعدة (للمالك فقط).
--  2) مفتاح مزامنة سري (ical_sync_key) لا يقرؤه إلا المالك والمهمة المجدولة.
--  3) دالتان security definer تعملان فقط بالمفتاح الصحيح:
--       ical_sync_feeds  → روابط المنصات
--       ical_sync_apply  → تطبيق أحداث التقويم على جدول الحجوزات (إضافة/تحديث/إلغاء)
--  4) مهمة pg_cron كل 15 دقيقة تستدعي /api/ical-sync في Vercel بالمفتاح،
--     فيجلب الخادم التقاويم ويحللها ثم يستدعي ical_sync_apply.
--  لا مفتاح خدمة سري في Vercel: المفتاح العام (anon) + المفتاح السري يكفيان.

-- ── 1. ربط الحجز المستورد بحدثه في المنصة ─────────────────────────────
-- عمود العمولة من الهجرة 0004 — يُضمن هنا لأن الإدراج أدناه يعتمد عليه
alter table public.bookings add column if not exists commission numeric not null default 0;
alter table public.bookings add column if not exists ical_uid text;
alter table public.bookings add column if not exists ical_feed_id text;

comment on column public.bookings.ical_uid is 'معرّف الحدث (UID) في تقويم المنصة — للحجوزات المستوردة فقط';
comment on column public.bookings.ical_feed_id is 'رابط المنصة الذي استُورد منه الحجز (ical_feeds.id)';

-- الحجوزات المستوردة سابقاً من المتصفح تحمل الـ UID داخل الملاحظة
update public.bookings
set ical_uid = btrim(substring(note from 'UID: (.*)$'))
where ical_uid is null and note ~ 'UID: ';

create index if not exists bookings_ical_uid_idx on public.bookings (ical_uid) where ical_uid is not null;

-- ── 2. روابط المنصات ─────────────────────────────────────────────────
create table if not exists public.ical_feeds (
  id text primary key,
  name text not null,
  platform text not null default 'ical',
  url text not null default '',
  last_sync timestamptz,
  last_error text,
  last_result jsonb,
  created_at timestamptz not null default now()
);

comment on table public.ical_feeds is 'روابط تقاويم المنصات (iCal) — تُزامَن من الخادم كل 15 دقيقة';

alter table public.ical_feeds enable row level security;

drop policy if exists owner_all_ical_feeds on public.ical_feeds;
create policy owner_all_ical_feeds on public.ical_feeds
  for all to authenticated using (true) with check (true);

-- ── 3. مفتاح المزامنة السري ──────────────────────────────────────────
create table if not exists public.ical_sync_key (
  id smallint primary key default 1 check (id = 1),
  key text not null
);

alter table public.ical_sync_key enable row level security;

drop policy if exists owner_read_ical_sync_key on public.ical_sync_key;
create policy owner_read_ical_sync_key on public.ical_sync_key
  for select to authenticated using (true);

insert into public.ical_sync_key (id, key)
values (1, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (id) do nothing;

create or replace function public.ical_sync_check(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_key is null or length(p_key) < 32
     or not exists (select 1 from public.ical_sync_key k where k.key = p_key) then
    raise exception 'invalid sync key' using errcode = '28000';
  end if;
end $$;

revoke all on function public.ical_sync_check(text) from public;

-- روابط المنصات المربوطة
create or replace function public.ical_sync_feeds(p_key text)
returns table (id text, name text, platform text, url text)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ical_sync_check(p_key);
  return query
    select f.id, f.name, f.platform, f.url
    from public.ical_feeds f
    where f.url like 'https://%'
    order by f.created_at;
end $$;

revoke all on function public.ical_sync_feeds(text) from public;
grant execute on function public.ical_sync_feeds(text) to anon, authenticated;

-- تطبيق أحداث تقويم منصة على جدول الحجوزات
--  p_events: [{ "uid", "checkin":"YYYY-MM-DD", "checkout":"YYYY-MM-DD", "guest" }]
--  p_error : نص الخطأ إن تعذّر جلب التقويم (يُسجَّل ولا يُلغى أي حجز)
create or replace function public.ical_sync_apply(p_key text, p_feed_id text, p_events jsonb, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.ical_feeds;
  ev jsonb;
  v_uid text; v_ci text; v_co text; v_guest text;
  v_label text;
  v_prop text;
  v_id text;
  v_uids text[] := '{}';
  v_added int := 0; v_updated int := 0; v_removed int := 0;
  v_result jsonb;
begin
  perform public.ical_sync_check(p_key);

  select * into f from public.ical_feeds where id = p_feed_id;
  if not found then
    raise exception 'unknown feed' using errcode = '22023';
  end if;

  -- تعذّر الجلب: سجّل الخطأ فقط — لا نُلغي حجوزات بسبب انقطاع مؤقت
  if p_error is not null then
    update public.ical_feeds set last_sync = now(), last_error = left(p_error, 200) where id = p_feed_id;
    return jsonb_build_object('error', p_error);
  end if;

  v_label := case f.platform when 'airbnb' then 'Airbnb' when 'gathern' then 'جاذر إن' else f.name end;
  -- العقار الأكثر استخداماً في الحجوزات الحالية (بنفس نوع العمود مهما كان)
  select b.property_id::text into v_prop
  from public.bookings b group by b.property_id order by count(*) desc limit 1;
  v_prop := coalesce(v_prop, 'p1');

  for ev in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    v_uid := nullif(btrim(ev->>'uid'), '');
    v_ci := left(ev->>'checkin', 10);
    v_co := left(ev->>'checkout', 10);
    v_guest := btrim(coalesce(ev->>'guest', ''));

    continue when v_ci !~ '^\d{4}-\d{2}-\d{2}$' or v_co !~ '^\d{4}-\d{2}-\d{2}$' or v_co <= v_ci;
    -- «Not available» في Airbnb حجب مستورد من تقاويم أخرى (منها تقويمنا) وليس حجزاً
    continue when v_guest ~* '(not available|unavailable|غير متاح)';
    -- أحداث صدّرناها نحن ثم أعادتها المنصة إلينا
    continue when v_uid ilike '%@rhsa7905';

    if v_uid is not null then
      v_uids := v_uids || v_uid;
    end if;

    if v_guest = '' or v_guest ~* '^(reserved|booked|محجوز)$' then
      v_guest := 'ضيف ' || v_label;
    end if;
    v_guest := regexp_replace(v_guest, '^محجوز\s*—\s*', '');

    -- حدث معروف مسبقاً: حدّث تواريخه وأعد تفعيله إن أُلغي سابقاً
    v_id := null;
    if v_uid is not null then
      select b.id::text into v_id from public.bookings b where b.ical_uid = v_uid limit 1;
    end if;

    if v_id is not null then
      update public.bookings b
      set checkin = r.checkin, checkout = r.checkout, status = 'confirmed', ical_feed_id = p_feed_id
      from jsonb_populate_record(null::public.bookings,
             jsonb_build_object('checkin', v_ci, 'checkout', v_co)) r
      where b.id::text = v_id
        and (left(b.checkin::text, 10) <> v_ci or left(b.checkout::text, 10) <> v_co
             or b.status <> 'confirmed' or b.ical_feed_id is distinct from p_feed_id);
      if found then v_updated := v_updated + 1; end if;
      continue;
    end if;

    -- حدث جديد يتقاطع مع حجز قائم: تجاهله (يمنع التكرار والارتداد بين المنصات)
    continue when exists (
      select 1 from public.bookings b
      where b.status <> 'cancelled'
        and v_ci < left(b.checkout::text, 10) and v_co > left(b.checkin::text, 10)
    );

    -- jsonb_populate_record يحوّل القيم لأنواع أعمدة الجدول الفعلية (date/text، uuid/text)
    insert into public.bookings (property_id, guest, phone, source, checkin, checkout,
                                 total, status, note, commission, ical_uid, ical_feed_id)
    select r.property_id, r.guest, r.phone, r.source, r.checkin, r.checkout,
           r.total, r.status, r.note, r.commission, r.ical_uid, r.ical_feed_id
    from jsonb_populate_record(null::public.bookings, jsonb_build_object(
      'property_id', v_prop, 'guest', left(v_guest, 80), 'phone', '', 'source', f.platform,
      'checkin', v_ci, 'checkout', v_co, 'total', 0, 'status', 'confirmed',
      'note', 'مستورد تلقائياً من ' || f.name || coalesce(' • UID: ' || v_uid, ''),
      'commission', 0, 'ical_uid', v_uid, 'ical_feed_id', p_feed_id)) r;
    v_added := v_added + 1;
  end loop;

  -- حجز قادم اختفى من تقويم المنصة = أُلغي هناك → يُلغى هنا فتعود أيامه متاحة.
  -- تقويم فارغ تماماً يُتجاهل احتياطاً: عطل مؤقت في المنصة أرجح من إلغاء كل الحجوزات،
  -- وإبقاء يوم محجوزاً خطأً أهون من حجز مزدوج.
  if coalesce(jsonb_array_length(p_events), 0) > 0 then
  update public.bookings b
  set status = 'cancelled'
  where b.ical_feed_id = p_feed_id
    and b.ical_uid is not null
    and b.status <> 'cancelled'
    and not (b.ical_uid = any(v_uids))
    and left(b.checkout::text, 10) >= to_char(current_date, 'YYYY-MM-DD');
  get diagnostics v_removed = row_count;
  end if;

  v_result := jsonb_build_object('added', v_added, 'updated', v_updated, 'removed', v_removed,
                                 'events', jsonb_array_length(coalesce(p_events, '[]'::jsonb)));
  update public.ical_feeds
  set last_sync = now(), last_error = null, last_result = v_result
  where id = p_feed_id;

  return v_result;
end $$;

revoke all on function public.ical_sync_apply(text, text, jsonb, text) from public;
grant execute on function public.ical_sync_apply(text, text, jsonb, text) to anon, authenticated;

-- ── 4. المهمة المجدولة: كل 15 دقيقة ──────────────────────────────────
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname = 'rentapa-ical-sync';

select cron.schedule(
  'rentapa-ical-sync',
  '*/15 * * * *',
  $cron$
    select net.http_get(
      url := 'https://rentapa.vercel.app/api/ical-sync?key=' || (select key from public.ical_sync_key where id = 1),
      timeout_milliseconds := 30000
    );
  $cron$
);
