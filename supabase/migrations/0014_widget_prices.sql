-- أسعار الليلة الفعلية لأداة الحجوزات: الأقل والأعلى وسط الأسبوع والويكند
-- يُطبَّق مرة واحدة على مشروع Supabase (SQL Editor) — بعد الهجرة 0007
--
-- تعيد تواريخ ومبالغ الحجوزات ذات المبلغ (آخر 6 أشهر وما بعدها) — بلا أسماء ولا
-- أرقام — لمن يقدّم رمز تصدير التقويم الصحيح، كما في ical_bookings. الخادم يحسب
-- سعر الليلة لكل حجز ويصنّفه (وسط أسبوع / ويكند) ويستخرج الأقل والأعلى.
-- الحجوزات المستوردة من المنصات بلا مبلغ (0) لا تدخل في الحساب.

create or replace function public.widget_prices(p_token text)
returns table (checkin text, checkout text, total numeric)
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
    select left(b.checkin::text, 10), left(b.checkout::text, 10), b.total::numeric
    from public.bookings b
    where b.status not in ('cancelled', 'blocked')
      and coalesce(b.total, 0) > 0
      and left(b.checkin::text, 10) >= to_char(current_date - 180, 'YYYY-MM-DD')
    order by 1;
end $$;

revoke all on function public.widget_prices(text) from public;
grant execute on function public.widget_prices(text) to anon, authenticated;
