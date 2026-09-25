-- حجز سريع وإكمال حجوزات المنصات من أداة الجوال (Scriptable) — دون فتح لوحة التحكم
-- يُطبَّق مرة واحدة على مشروع Supabase (SQL Editor) — بعد الهجرة 0010
--
-- الأداة لا تملك جلسة دخول، ورمز تصدير التقويم (ical_tokens) للقراءة فقط وتعرفه
-- المنصات نفسها (تستورد تقويمنا به)، فلا يصلح للكتابة. لذلك مفتاح كتابة منفصل:
--   widget_write_key  → يقرؤه المالك المسجّل فقط، ويُضمَّن في سكربت Scriptable
--   widget_dates_free → هل الأيام متاحة؟ (قبل طلب بيانات الضيف)
--   widget_quick_book → إضافة حجز (يرفض أي تقاطع مع حجز قائم)
--   widget_pending    → حجوزات المنصات الناقصة (اسم عام «ضيف Airbnb» أو بلا مبلغ)
--   widget_complete   → إكمال الاسم/الجوال/المبلغ/العمولة لحجز مستورد فقط
-- لتغيير المفتاح (إن تسرّب): احذف صفه ثم أعد تشغيل هذا الملف وانسخ السكربت من جديد.

alter table public.bookings add column if not exists commission numeric not null default 0;

create table if not exists public.widget_write_key (
  id smallint primary key default 1 check (id = 1),
  key text not null
);

alter table public.widget_write_key enable row level security;

drop policy if exists owner_read_widget_write_key on public.widget_write_key;
create policy owner_read_widget_write_key on public.widget_write_key
  for select to authenticated using (true);

insert into public.widget_write_key (id, key)
values (1, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (id) do nothing;

create or replace function public.widget_key_check(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_key is null or length(p_key) < 32
     or not exists (select 1 from public.widget_write_key k where k.key = p_key) then
    raise exception 'invalid widget key' using errcode = '28000';
  end if;
end $$;

revoke all on function public.widget_key_check(text) from public;

-- هل الفترة متاحة؟ (الخروج يوم دخول غيره مسموح)
create or replace function public.widget_dates_free(p_key text, p_checkin text, p_checkout text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.widget_key_check(p_key);
  return not exists (
    select 1 from public.bookings b
    where b.status <> 'cancelled'
      and p_checkin < left(b.checkout::text, 10) and p_checkout > left(b.checkin::text, 10)
  );
end $$;

revoke all on function public.widget_dates_free(text, text, text) from public;
grant execute on function public.widget_dates_free(text, text, text) to anon, authenticated;

create or replace function public.widget_quick_book(
  p_key text, p_source text, p_checkin text, p_checkout text,
  p_guest text default '', p_phone text default '', p_total numeric default 0, p_commission numeric default 0)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prop text;
  v_id text;
  v_source text := coalesce(nullif(btrim(p_source), ''), 'manual');
  v_status text := 'confirmed';
begin
  perform public.widget_key_check(p_key);

  if p_checkin !~ '^\d{4}-\d{2}-\d{2}$' or p_checkout !~ '^\d{4}-\d{2}-\d{2}$'
     or p_checkout <= p_checkin or p_checkout::date - p_checkin::date > 60 then
    raise exception 'invalid dates' using errcode = '22023';
  end if;
  if v_source not in ('direct', 'whatsapp', 'gathern', 'airbnb', 'manual', 'block') then
    raise exception 'invalid source' using errcode = '22023';
  end if;
  if v_source = 'block' then v_status := 'blocked'; end if;

  -- قفل الجدول لحظياً يمنع حجزين متزامنين لنفس الأيام
  lock table public.bookings in share row exclusive mode;
  if exists (
    select 1 from public.bookings b
    where b.status <> 'cancelled'
      and p_checkin < left(b.checkout::text, 10) and p_checkout > left(b.checkin::text, 10)
  ) then
    raise exception 'dates taken' using errcode = 'P0001';
  end if;

  -- العقار الأكثر استخداماً (كما في المزامنة) بنفس نوع العمود مهما كان
  select b.property_id::text into v_prop
  from public.bookings b group by b.property_id order by count(*) desc limit 1;
  v_prop := coalesce(v_prop, 'p1');

  insert into public.bookings (property_id, guest, phone, source, checkin, checkout,
                               total, status, note, commission)
  select r.property_id, r.guest, r.phone, r.source, r.checkin, r.checkout,
         r.total, r.status, r.note, r.commission
  from jsonb_populate_record(null::public.bookings, jsonb_build_object(
    'property_id', v_prop,
    'guest', left(coalesce(nullif(btrim(p_guest), ''), case when v_source = 'block' then 'حجب' else 'ضيف' end), 80),
    'phone', left(coalesce(btrim(p_phone), ''), 30),
    'source', v_source, 'checkin', p_checkin, 'checkout', p_checkout,
    'total', greatest(coalesce(p_total, 0), 0), 'status', v_status,
    'note', 'أُضيف من أداة الجوال',
    'commission', greatest(coalesce(p_commission, 0), 0))) r
  returning id::text into v_id;

  return v_id;
end $$;

revoke all on function public.widget_quick_book(text, text, text, text, text, text, numeric, numeric) from public;
grant execute on function public.widget_quick_book(text, text, text, text, text, text, numeric, numeric) to anon, authenticated;

-- حجوزات المنصات الناقصة: الجارية والقادمة، وما انتهى خلال 60 يوماً
create or replace function public.widget_pending(p_key text)
returns table (id text, source text, checkin text, checkout text, guest text, phone text, total numeric, commission numeric)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.widget_key_check(p_key);
  return query
    select b.id::text, b.source::text, left(b.checkin::text, 10), left(b.checkout::text, 10),
           b.guest::text, coalesce(b.phone, '')::text, coalesce(b.total, 0)::numeric, coalesce(b.commission, 0)::numeric
    from public.bookings b
    where b.status not in ('cancelled', 'blocked')
      and (b.source in ('gathern', 'airbnb', 'ical') or coalesce(b.note, '') like '%مستورد%')
      and (coalesce(b.total, 0) <= 0 or btrim(coalesce(b.guest, '')) = '' or b.guest ~ '^ضيف\s'
           or b.guest ~* '^(reserved|booked|محجوز|not available)$')
      and left(b.checkout::text, 10) >= to_char(current_date - 60, 'YYYY-MM-DD')
    order by (left(b.checkout::text, 10) < to_char(current_date, 'YYYY-MM-DD')), 3
    limit 20;
end $$;

revoke all on function public.widget_pending(text) from public;
grant execute on function public.widget_pending(text) to anon, authenticated;

-- الإكمال يخص الحجوزات المستوردة فقط، ولا يلمس التواريخ (المزامنة تتولاها).
-- قيمة فارغة (null) = اترك الحقل كما هو
create or replace function public.widget_complete(
  p_key text, p_id text, p_guest text default null, p_phone text default null,
  p_total numeric default null, p_commission numeric default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.widget_key_check(p_key);
  update public.bookings b set
    guest = coalesce(left(nullif(btrim(p_guest), ''), 80), b.guest),
    phone = coalesce(left(nullif(btrim(p_phone), ''), 30), b.phone),
    total = case when p_total is null or p_total < 0 then b.total else p_total end,
    commission = case when p_commission is null or p_commission < 0 then b.commission else p_commission end
  where b.id::text = p_id
    and b.status not in ('cancelled', 'blocked')
    and (b.source in ('gathern', 'airbnb', 'ical') or coalesce(b.note, '') like '%مستورد%');
  if not found then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  return true;
end $$;

revoke all on function public.widget_complete(text, text, text, text, numeric, numeric) from public;
grant execute on function public.widget_complete(text, text, text, text, numeric, numeric) to anon, authenticated;
