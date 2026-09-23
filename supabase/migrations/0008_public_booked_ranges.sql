-- الأيام المحجوزة للزوار: تمنع إرسال طلب حجز على أيام غير متاحة من الصفحة الرئيسية
-- يُطبَّق مرة واحدة على مشروع Supabase (SQL Editor أو supabase db push)
--
-- الخلفية: جدول الحجوزات محمي بسياسات RLS للمالك فقط، والزائر لا يجب أن يرى
-- أسماء الضيوف ولا المبالغ. الحل: دالة security definer تُعيد تاريخَي الوصول
-- والمغادرة فقط لكل حجز/حجب قائم (يشمل ما استُورد من جاذر إن وAirbnb عبر iCal).

create or replace function public.public_booked_ranges()
returns table (checkin text, checkout text)
language sql
stable
security definer
set search_path = public
as $$
  -- تحويل صريح إلى نص حتى لا يعتمد على نوع الأعمدة الفعلي (date/text)
  select left(b.checkin::text, 10), left(b.checkout::text, 10)
  from public.bookings b
  where b.status <> 'cancelled'
    -- الحجوزات المنتهية لا تهم الزائر؛ يوم هامش لفرق التوقيت
    and left(b.checkout::text, 10) >= to_char(current_date - 1, 'YYYY-MM-DD')
  order by 1;
$$;

revoke all on function public.public_booked_ranges() from public;
grant execute on function public.public_booked_ranges() to anon, authenticated;
