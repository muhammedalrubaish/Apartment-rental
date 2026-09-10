-- الأدوار التشغيلية في جدول جهات الاتصال (public.contacts)
-- يُطبَّق مرة واحدة على مشروع Supabase (SQL Editor أو supabase db push)
--
-- الخلفية: عمود source كان يحمل مصدر الزبون فقط (manual / direct / gathern / airbnb / site_chat).
-- أصبح يحمل أيضاً أدوار إدارة الإشغال داخل العمارة:
--   cleaning_lead     مسؤول النظافة
--   cleaning_staff    موظف نظافة
--   building_office   مكتب العمارة (شركة ديار رؤي العقارية)
--   building_worker   عامل المبنى
--   host              مضيف بالعمارة
--
-- لا حاجة لعمود جديد؛ العمود نصّي. هذا الملف فقط يرفع أي قيد CHECK قديم
-- كان يحصر القيم المسموحة في مصادر الزبائن، وإلا فُشل إدخال الأدوار الجديدة.

do $$
declare
  con record;
begin
  for con in
    select conname
    from pg_constraint
    where conrelid = 'public.contacts'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%source%'
  loop
    execute format('alter table public.contacts drop constraint %I', con.conname);
    raise notice 'أُزيل القيد %I من عمود source', con.conname;
  end loop;
end $$;

comment on column public.contacts.source is
  'مصدر الزبون (manual/direct/gathern/airbnb/site_chat) أو الدور التشغيلي (cleaning_lead/cleaning_staff/building_office/building_worker/host)';

-- فرز أسرع عند تصفية جهات الاتصال التشغيلية
create index if not exists contacts_source_idx on public.contacts (source);
