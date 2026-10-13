-- إصلاح تذبذب حجوزات المنصات: «إلغاء» ثم «حجز جديد» لنفس التواريخ كل 15 دقيقة
-- يُطبَّق مرة واحدة على مشروع Supabase (SQL Editor) — بعد الهجرة 0010
--
-- السبب: بعض المنصات (جاذر إن) تولّد معرّف الحدث (UID) من جديد مع كل طلب للتقويم.
-- فكانت ical_sync_apply لا تجد الحجز بمعرّفه في كل مزامنة، فتتناوب حالتان:
--   مزامنة 1: الحدث بمعرّف جديد يتقاطع مع الحجز القائم → يُتجاهل، والحجز القائم
--             اختفى معرّفه من التقويم → يُلغى  (إشعار «إلغاء حجز»)
--   مزامنة 2: لا حجز قائم في تلك الأيام → يُدرج حجز جديد (إشعار «حجز جديد»)
-- ومع كل دورة يبقى صف ملغى إضافي في جدول الحجوزات.
--
-- الإصلاح: إن لم يُعثر على الحدث بمعرّفه، نبحث عن حجز قائم من نفس رابط المنصة
-- بنفس تاريخي الوصول والمغادرة ونعتبره الحدث ذاته، فنحدّث معرّفه فقط.
-- المنصات ذات المعرّف الثابت (Airbnb) لا تتأثر: تُطابَق بالمعرّف أولاً كما كانت.

create or replace function public.ical_sync_apply(p_key text, p_feed_id text, p_events jsonb, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.ical_feeds;
  ev jsonb;
  v_uid text; v_ci text; v_co text; v_guest text;
  v_label text;
  v_prop text;
  v_id text;
  v_uids text[] := '{}';
  v_added int := 0; v_updated int := 0; v_removed int := 0;
  v_result jsonb;
begin
  perform public.ical_sync_check(p_key);

  select * into f from public.ical_feeds where id = p_feed_id;
  if not found then
    raise exception 'unknown feed' using errcode = '22023';
  end if;

  -- تعذّر الجلب: سجّل الخطأ فقط — لا نُلغي حجوزات بسبب انقطاع مؤقت
  if p_error is not null then
    update public.ical_feeds set last_sync = now(), last_error = left(p_error, 200) where id = p_feed_id;
    return jsonb_build_object('error', p_error);
  end if;

  v_label := case f.platform when 'airbnb' then 'Airbnb' when 'gathern' then 'جاذر إن' else f.name end;
  -- العقار الأكثر استخداماً في الحجوزات الحالية (بنفس نوع العمود مهما كان)
  select b.property_id::text into v_prop
  from public.bookings b group by b.property_id order by count(*) desc limit 1;
  v_prop := coalesce(v_prop, 'p1');

  for ev in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    v_uid := nullif(btrim(ev->>'uid'), '');
    v_ci := left(ev->>'checkin', 10);
    v_co := left(ev->>'checkout', 10);
    v_guest := btrim(coalesce(ev->>'guest', ''));

    continue when v_ci !~ '^\d{4}-\d{2}-\d{2}$' or v_co !~ '^\d{4}-\d{2}-\d{2}$' or v_co <= v_ci;
    -- «Not available» في Airbnb حجب مستورد من تقاويم أخرى (منها تقويمنا) وليس حجزاً
    continue when v_guest ~* '(not available|unavailable|غير متاح)';
    -- أحداث صدّرناها نحن ثم أعادتها المنصة إلينا
    continue when v_uid ilike '%@rhsa7905';

    if v_uid is not null then
      v_uids := v_uids || v_uid;
    end if;

    if v_guest = '' or v_guest ~* '^(reserved|booked|محجوز)$' then
      v_guest := 'ضيف ' || v_label;
    end if;
    v_guest := regexp_replace(v_guest, '^محجوز\s*—\s*', '');

    -- حدث معروف مسبقاً: حدّث تواريخه وأعد تفعيله إن أُلغي سابقاً
    v_id := null;
    if v_uid is not null then
      select b.id::text into v_id from public.bookings b where b.ical_uid = v_uid limit 1;
    end if;

    -- معرّف لم نره من قبل: قد تكون المنصة غيّرت معرّف نفس الحجز (جاذر إن تفعل ذلك).
    -- حجز قائم من نفس الرابط بنفس التواريخ ولم يُطابَق بحدث آخر في هذه المزامنة
    -- = نفس الحجز → ننقل إليه المعرّف الجديد فلا يُلغى ولا يتكرر.
    if v_id is null and v_uid is not null then
      select b.id::text into v_id
      from public.bookings b
      where b.ical_feed_id = p_feed_id
        and b.status <> 'cancelled'
        and left(b.checkin::text, 10) = v_ci
        and left(b.checkout::text, 10) = v_co
        and (b.ical_uid is null or not (b.ical_uid = any(v_uids)))
      order by b.id
      limit 1;
      if v_id is not null then
        update public.bookings b set ical_uid = v_uid where b.id::text = v_id;
        continue;
      end if;
    end if;

    if v_id is not null then
      update public.bookings b
      set checkin = r.checkin, checkout = r.checkout, status = 'confirmed', ical_feed_id = p_feed_id
      from jsonb_populate_record(null::public.bookings,
             jsonb_build_object('checkin', v_ci, 'checkout', v_co)) r
      where b.id::text = v_id
        and (left(b.checkin::text, 10) <> v_ci or left(b.checkout::text, 10) <> v_co
             or b.status <> 'confirmed' or b.ical_feed_id is distinct from p_feed_id);
      if found then v_updated := v_updated + 1; end if;
      continue;
    end if;

    -- حدث جديد يتقاطع مع حجز قائم: تجاهله (يمنع التكرار والارتداد بين المنصات)
    continue when exists (
      select 1 from public.bookings b
      where b.status <> 'cancelled'
        and v_ci < left(b.checkout::text, 10) and v_co > left(b.checkin::text, 10)
    );

    -- jsonb_populate_record يحوّل القيم لأنواع أعمدة الجدول الفعلية (date/text، uuid/text)
    insert into public.bookings (property_id, guest, phone, source, checkin, checkout,
                                 total, status, note, commission, ical_uid, ical_feed_id)
    select r.property_id, r.guest, r.phone, r.source, r.checkin, r.checkout,
           r.total, r.status, r.note, r.commission, r.ical_uid, r.ical_feed_id
    from jsonb_populate_record(null::public.bookings, jsonb_build_object(
      'property_id', v_prop, 'guest', left(v_guest, 80), 'phone', '', 'source', f.platform,
      'checkin', v_ci, 'checkout', v_co, 'total', 0, 'status', 'confirmed',
      'note', 'مستورد تلقائياً من ' || f.name || coalesce(' • UID: ' || v_uid, ''),
      'commission', 0, 'ical_uid', v_uid, 'ical_feed_id', p_feed_id)) r;
    v_added := v_added + 1;
  end loop;

  -- حجز قادم اختفى من تقويم المنصة = أُلغي هناك → يُلغى هنا فتعود أيامه متاحة.
  -- تقويم فارغ تماماً يُتجاهل احتياطاً: عطل مؤقت في المنصة أرجح من إلغاء كل الحجوزات،
  -- وإبقاء يوم محجوزاً خطأً أهون من حجز مزدوج.
  if coalesce(jsonb_array_length(p_events), 0) > 0 then
  update public.bookings b
  set status = 'cancelled'
  where b.ical_feed_id = p_feed_id
    and b.ical_uid is not null
    and b.status <> 'cancelled'
    and not (b.ical_uid = any(v_uids))
    and left(b.checkout::text, 10) >= to_char(current_date, 'YYYY-MM-DD');
  get diagnostics v_removed = row_count;
  end if;

  v_result := jsonb_build_object('added', v_added, 'updated', v_updated, 'removed', v_removed,
                                 'events', jsonb_array_length(coalesce(p_events, '[]'::jsonb)));
  update public.ical_feeds
  set last_sync = now(), last_error = null, last_result = v_result
  where id = p_feed_id;

  return v_result;
end $$;

revoke all on function public.ical_sync_apply(text, text, jsonb, text) from public;
grant execute on function public.ical_sync_apply(text, text, jsonb, text) to anon, authenticated;
