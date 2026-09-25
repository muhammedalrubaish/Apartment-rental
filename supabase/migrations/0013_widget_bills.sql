-- مواعيد الإنترنت والكهرباء لأداة الحجوزات (Scriptable) والملخص الصباحي
-- يُطبَّق مرة واحدة على مشروع Supabase (SQL Editor) — بعد الهجرة 0007
--
-- جدول المصاريف محمي بسياسات RLS للمالك المسجّل فقط، والأداة على الجوال لا تملك
-- جلسة دخول. هذه الدالة تعيد لكل فئة (إنترنت / كهرباء) أقرب فاتورة مستحقة، أو آخر
-- فاتورة إن لم توجد مستحقة (لتقدير الموعد القادم) — فقط لمن يقدّم رمز تصدير التقويم
-- الصحيح، كما في ical_bookings. بلا ملاحظات ولا بيانات أخرى.

create or replace function public.widget_bills(p_token text)
returns table (category text, due_date text, status text, amount numeric)
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
    select distinct on (e.category)
           e.category::text, e.due_date::text, e.status::text, e.amount
    from public.expenses e
    where e.category in ('إنترنت', 'كهرباء')
    -- المستحق أولاً (الأقرب موعداً)، وإلا آخر فاتورة مسددة
    order by e.category, (e.status = 'due') desc,
             case when e.status = 'due' then e.due_date end asc,
             e.due_date desc;
end $$;

revoke all on function public.widget_bills(text) from public;
grant execute on function public.widget_bills(text) to anon, authenticated;
