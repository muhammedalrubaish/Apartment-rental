-- أسعار الليلة من القاعدة بدل apartments.json: تعديلها من أداة الجوال دون نشر كود
-- يُطبَّق مرة واحدة على مشروع Supabase (SQL Editor) — بعد الهجرة 0015
--
--   site_pricing      → سعر وسط الأسبوع وسعر الويكند (صف واحد)
--   price_overrides   → سعر خاص لفترة (ليالي مناسبة: كأس آسيا، معرض الكتاب…)
--   public_pricing()  → يقرؤها الموقع لحساب السعر (للجميع — أسعار معلنة أصلاً)
--   widget_set_prices / widget_set_event_price → التعديل بمفتاح الأداة (الهجرة 0015)
-- إن لم تُطبَّق الهجرة يبقى الموقع على أسعار apartments.json كما كان.

create table if not exists public.site_pricing (
  id smallint primary key default 1 check (id = 1),
  weekday_price numeric not null,
  weekend_price numeric not null,
  updated_at timestamptz not null default now()
);

insert into public.site_pricing (id, weekday_price, weekend_price)
values (1, 220, 280)
on conflict (id) do nothing;

create table if not exists public.price_overrides (
  id bigserial primary key,
  date_from date not null,
  date_to date not null,            -- آخر ليلة مشمولة (ليلة هذا اليوم)
  price numeric not null check (price > 0),
  label text,
  updated_at timestamptz not null default now(),
  unique (date_from, date_to),
  check (date_to >= date_from)
);

alter table public.site_pricing enable row level security;
alter table public.price_overrides enable row level security;

drop policy if exists owner_all_site_pricing on public.site_pricing;
create policy owner_all_site_pricing on public.site_pricing
  for all to authenticated using (true) with check (true);
drop policy if exists owner_all_price_overrides on public.price_overrides;
create policy owner_all_price_overrides on public.price_overrides
  for all to authenticated using (true) with check (true);

create or replace function public.public_pricing()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'weekday', p.weekday_price,
    'weekend', p.weekend_price,
    'overrides', coalesce((
      select jsonb_agg(jsonb_build_object('from', o.date_from::text, 'to', o.date_to::text,
                                          'price', o.price, 'label', o.label) order by o.date_from)
      from public.price_overrides o
      where o.date_to >= current_date - 1), '[]'::jsonb))
  from public.site_pricing p where p.id = 1
$$;

revoke all on function public.public_pricing() from public;
grant execute on function public.public_pricing() to anon, authenticated;

create or replace function public.widget_set_prices(p_key text, p_weekday numeric, p_weekend numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.widget_key_check(p_key);
  if p_weekday is null or p_weekend is null or p_weekday < 50 or p_weekend < 50
     or p_weekday > 5000 or p_weekend > 5000 then
    raise exception 'invalid price' using errcode = '22023';
  end if;
  update public.site_pricing
  set weekday_price = round(p_weekday), weekend_price = round(p_weekend), updated_at = now()
  where id = 1;
  return public.public_pricing();
end $$;

revoke all on function public.widget_set_prices(text, numeric, numeric) from public;
grant execute on function public.widget_set_prices(text, numeric, numeric) to anon, authenticated;

-- سعر خاص لفترة مناسبة. p_price فارغ أو صفر = إزالة السعر الخاص لهذه الفترة
create or replace function public.widget_set_event_price(
  p_key text, p_from text, p_to text, p_price numeric, p_label text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.widget_key_check(p_key);
  if p_from !~ '^\d{4}-\d{2}-\d{2}$' or p_to !~ '^\d{4}-\d{2}-\d{2}$'
     or p_to < p_from or p_to::date - p_from::date > 62 then
    raise exception 'invalid dates' using errcode = '22023';
  end if;

  if p_price is null or p_price <= 0 then
    delete from public.price_overrides where date_from = p_from::date and date_to = p_to::date;
  else
    if p_price < 50 or p_price > 10000 then
      raise exception 'invalid price' using errcode = '22023';
    end if;
    insert into public.price_overrides (date_from, date_to, price, label)
    values (p_from::date, p_to::date, round(p_price), left(p_label, 80))
    on conflict (date_from, date_to)
    do update set price = excluded.price, label = excluded.label, updated_at = now();
  end if;
  return public.public_pricing();
end $$;

revoke all on function public.widget_set_event_price(text, text, text, numeric, text) from public;
grant execute on function public.widget_set_event_price(text, text, text, numeric, text) to anon, authenticated;
