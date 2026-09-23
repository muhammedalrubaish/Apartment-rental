-- رمز تصدير التقويم (iCal) لربط جاذر إن وAirbnb بموقعنا
-- يُطبَّق مرة واحدة على مشروع Supabase (SQL Editor أو supabase db push)
--
-- الخلفية: منصات الحجز تقرأ رابط iCal عاماً بلا تسجيل دخول، بينما جدول الحجوزات
-- محمي بسياسات RLS للمالك فقط. الحل: رمز سري يُحفظ هنا ولا يقرؤه إلا المالك،
-- ودالة security definer تُعيد الحجوزات فقط لمن يقدّم الرمز الصحيح. بذلك تعمل
-- نقطة الخادم /api/calendar بمفتاح anon العام دون أي مفتاح خدمة سري في Vercel.

create table if not exists public.ical_tokens (
  id smallint primary key default 1 check (id = 1),   -- صف واحد فقط
  token text not null,
  created_at timestamptz not null default now()
);

comment on table public.ical_tokens is 'رمز رابط تصدير التقويم iCal — صف واحد، يقرؤه ويجدّده المالك فقط';

alter table public.ical_tokens enable row level security;

-- المالك المسجّل دخوله فقط؛ لا سياسة لدور anon فالرمز غير متاح للزوار
create policy owner_read_ical_tokens on public.ical_tokens
  for select to authenticated using (true);

create policy owner_insert_ical_tokens on public.ical_tokens
  for insert to authenticated with check (true);

create policy owner_update_ical_tokens on public.ical_tokens
  for update to authenticated using (true) with check (true);

-- الحجوزات لمن يحمل الرمز الصحيح — بلا أرقام جوال ولا مبالغ
create or replace function public.ical_bookings(p_token text)
returns table (id text, guest text, checkin text, checkout text, status text, source text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token is null or length(p_token) < 16
     or not exists (select 1 from public.ical_tokens t where t.token = p_token) then
    raise exception 'invalid ical token' using errcode = '28000';
  end if;

  return query
    -- تحويل صريح إلى نص حتى لا يعتمد على نوع الأعمدة الفعلي (uuid/text، date/text)
    select b.id::text, b.guest::text, b.checkin::text, b.checkout::text, b.status::text, b.source::text
    from public.bookings b
    where b.status <> 'cancelled'
    order by b.checkin;
end $$;

revoke all on function public.ical_bookings(text) from public;
grant execute on function public.ical_bookings(text) to anon, authenticated;
