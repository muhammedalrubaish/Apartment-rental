-- ملخص الحجوزات الصباحي: إشعار يومي لجوال المالك الساعة 8 صباحاً بتوقيت الرياض
-- يُطبَّق مرة واحدة على مشروع Supabase (SQL Editor) — بعد الهجرات 0007 و0010 و0011
--
-- مهمة pg_cron تستدعي /api/upcoming?digest=1 كل يوم الساعة 05:00 UTC (= 08:00 الرياض).
-- رمز تصدير التقويم (ical_tokens) يُمرَّر في الرابط لقراءة الحجوزات، ومفتاح المزامنة
-- السري في ترويسة X-Sync-Key لإرسال الإشعار — لا يظهر في سجلات الروابط.
-- بلا وصول/مغادرة اليوم أو غداً ولا ضيف مقيم لا يُرسل شيء (لا إزعاج يومي فارغ).

select cron.unschedule(jobid) from cron.job where jobname = 'rentapa-daily-digest';

select cron.schedule(
  'rentapa-daily-digest',
  '0 5 * * *',
  $cron$
    select net.http_get(
      url := 'https://rentapa.vercel.app/api/upcoming?digest=1&token=' || (select token from public.ical_tokens where id = 1),
      headers := jsonb_build_object('X-Sync-Key', (select key from public.ical_sync_key where id = 1)),
      timeout_milliseconds := 30000
    );
  $cron$
);
