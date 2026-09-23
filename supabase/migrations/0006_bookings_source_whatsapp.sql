-- مصدر الحجز «واتساب» في جدول الحجوزات (public.bookings)
-- يُطبَّق مرة واحدة على مشروع Supabase (SQL Editor أو supabase db push)
--
-- الخلفية: أُضيف خيار «واتساب» (whatsapp) إلى مصادر الحجز في نموذج الحجز الجديد
-- وإلى مصادر جهات الاتصال. العمود نصّي فلا حاجة لعمود جديد؛ هذا الملف فقط يرفع
-- أي قيد CHECK قديم كان يحصر القيم المسموحة، وإلا فُشل حفظ حجز عبر واتساب.

do $$
declare
  con record;
begin
  for con in
    select conname
    from pg_constraint
    where conrelid = 'public.bookings'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%source%'
  loop
    execute format('alter table public.bookings drop constraint %I', con.conname);
    raise notice 'أُزيل القيد %I من عمود source', con.conname;
  end loop;
end $$;

comment on column public.bookings.source is
  'مصدر الحجز: direct / whatsapp / gathern / airbnb / manual / block / ical';
