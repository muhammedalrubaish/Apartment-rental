-- السماح بجهات اتصال بلا رقم جوال (public.contacts)
-- يُطبَّق مرة واحدة على مشروع Supabase (SQL Editor أو supabase db push)
--
-- المشكلة: عمود phone عليه قيد تفرّد وقيمته الافتراضية نص فارغ ''.
-- فأول جهة اتصال بلا رقم تُدخل بنجاح، والثانية تُرفض بالخطأ 23505 لأن '' = ''.
-- هذا يمنع تسجيل مضيفين أو موظفي نظافة لم نأخذ أرقامهم بعد.
--
-- الحل: قيد تفرّد جزئي يتحقق من الأرقام الحقيقية فقط ويتجاهل النص الفارغ.

do $$
declare
  con record;
  idx record;
begin
  -- قيود التفرّد على عمود phone
  for con in
    select conname
    from pg_constraint
    where conrelid = 'public.contacts'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%(phone)%'
  loop
    execute format('alter table public.contacts drop constraint %I', con.conname);
    raise notice 'أُزيل قيد التفرّد % من عمود phone', con.conname;
  end loop;

  -- فهارس تفرّد مستقلة (غير مرتبطة بقيد) على عمود phone
  for idx in
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'contacts'
      and indexdef ilike '%unique%'
      and indexdef ilike '%(phone)%'
      and indexname <> 'contacts_phone_present_uniq'
  loop
    execute format('drop index if exists public.%I', idx.indexname);
    raise notice 'أُزيل فهرس التفرّد % من عمود phone', idx.indexname;
  end loop;
end $$;

-- التفرّد يبقى محفوظاً للأرقام الفعلية: لا يمكن تسجيل جوال واحد مرتين
create unique index if not exists contacts_phone_present_uniq
  on public.contacts (phone)
  where phone is not null and phone <> '';

comment on column public.contacts.phone is
  'جوال جهة الاتصال — اختياري؛ التفرّد مطبَّق على الأرقام الفعلية فقط (contacts_phone_present_uniq)';
