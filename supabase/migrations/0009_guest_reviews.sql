-- تقييمات الضيوف: نموذج في أسفل الصفحة الرئيسية (الاسم الثنائي + نجوم 1–5 + تعليق اختياري)
-- يُطبَّق مرة واحدة على مشروع Supabase (SQL Editor أو supabase db push)
--
-- الحماية:
--  • الزائر لا يكتب في الجدول مباشرة؛ الإضافة عبر دالة submit_review التي تتحقق
--    من المدخلات وتحدّ من الإغراق (سقف للتقييمات المعلّقة في الساعة).
--  • كل تقييم جديد يُحفظ «بانتظار الموافقة» ولا يظهر للزوار حتى يعتمده المالك
--    من لوحة التحكم — يمنع التقييمات الوهمية أو المسيئة من الظهور فوراً.
--  • الزائر يقرأ المعتمَد فقط، والمالك (مستخدم مسجّل) يقرأ ويعتمد ويحذف الكل.

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 5 and 60),
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 500),
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.reviews is 'تقييمات الضيوف — تظهر في الموقع بعد اعتماد المالك';

create index if not exists reviews_approved_created_idx on public.reviews (approved, created_at desc);

alter table public.reviews enable row level security;

-- الزوار: المعتمَد فقط
create policy public_read_approved_reviews on public.reviews
  for select to anon using (approved);

-- المالك: قراءة الكل واعتماد وحذف
create policy owner_read_reviews on public.reviews
  for select to authenticated using (true);

create policy owner_update_reviews on public.reviews
  for update to authenticated using (true) with check (true);

create policy owner_delete_reviews on public.reviews
  for delete to authenticated using (true);

-- إضافة تقييم من الزائر — لا سياسة insert لدور anon، فهذه الدالة هي الطريق الوحيد
create or replace function public.submit_review(p_name text, p_rating int, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  -- الاسم الثنائي: كلمتان على الأقل، كل منهما حرفان فأكثر
  if v_name !~ '^\S{2,}( \S{2,})+$' or char_length(v_name) > 60 then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'invalid rating' using errcode = '22023';
  end if;
  if v_comment is not null and char_length(v_comment) > 500 then
    raise exception 'comment too long' using errcode = '22023';
  end if;
  -- حد الإغراق: 20 تقييماً معلّقاً في الساعة لكل الموقع، ولا تكرار للاسم نفسه خلال يوم
  if (select count(*) from public.reviews where not approved and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'too many reviews' using errcode = '54000';
  end if;
  if exists (select 1 from public.reviews where lower(name) = lower(v_name) and created_at > now() - interval '1 day') then
    raise exception 'duplicate review' using errcode = '23505';
  end if;

  insert into public.reviews (name, rating, comment) values (v_name, p_rating, v_comment);
end $$;

revoke all on function public.submit_review(text, int, text) from public;
grant execute on function public.submit_review(text, int, text) to anon, authenticated;
