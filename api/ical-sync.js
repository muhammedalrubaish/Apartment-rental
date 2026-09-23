// api/ical-sync.js — مزامنة تقاويم المنصات (جاذر إن / Airbnb) من الخادم
//
// GET /api/ical-sync?key=<مفتاح المزامنة>[&feed=<معرّف الرابط>]
// أو POST مع ترويسة X-Sync-Key (من لوحة التحكم)
//
// تستدعيه مهمة pg_cron في Supabase كل 15 دقيقة (الهجرة 0010)، وزر «مزامنة الآن»
// في لوحة التحكم. الخطوات لكل رابط منصة:
//   1) ical_sync_feeds(key)  → روابط المنصات المحفوظة في القاعدة
//   2) جلب ملف iCal من المنصة (https عامة فقط — حماية من SSRF)
//   3) تحليل الأحداث (تاريخ الوصول/المغادرة/UID/الاسم)
//   4) ical_sync_apply(key, feed, events) → إضافة/تحديث/إلغاء في جدول الحجوزات
// المفتاح يُتحقق منه داخل القاعدة؛ هنا المفتاح العام (anon) فقط، بلا مفتاح خدمة سري.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://divoyxodxkioxugrphby.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_qw9IiQ52_WFip-4gNX4lkA_CZA0VFzf';

// الإشعارات اختيارية: لو تعذّر تحميل مكتبتها تستمر المزامنة نفسها بلا توقف
let sendToOwner = null;
try { ({ sendToOwner } = require('./_push')); } catch (e) { console.error('[ical-sync] push unavailable', e.message); }

const MAX_BYTES = 2 * 1024 * 1024;   // 2MB تكفي لأي تقويم حجوزات
const FETCH_TIMEOUT = 8000;           // الروابط تُجلب بالتوازي، فتبقى المدة الكلية قصيرة

function isPrivateHost(host) {
    const h = host.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
        const [a, b] = h.split('.').map(Number);
        return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    }
    return h.includes(':');   // IPv6 حرفي — نرفضه احتياطاً
}

async function rpc(name, body) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    return { ok: r.ok, status: r.status, data };
}

/* تحليل iCal — نفس منطق لوحة التحكم: فك طي الأسطر ثم قراءة كل VEVENT */
function parseICS(text) {
    const out = [];
    const unfolded = text.replace(/\r?\n[ \t]/g, '');
    unfolded.split('BEGIN:VEVENT').slice(1).forEach((blk) => {
        const get = (key) => {
            const m = blk.match(new RegExp('^' + key + '[^:\\r\\n]*:(.*)$', 'm'));
            return m ? m[1].trim() : '';
        };
        const toIso = (v) => {
            const d = v.replace(/[^0-9]/g, '').slice(0, 8);
            return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '';
        };
        const checkin = toIso(get('DTSTART'));
        const checkout = toIso(get('DTEND'));
        if (!checkin || !checkout) return;
        out.push({
            uid: get('UID'),
            checkin,
            checkout,
            guest: get('SUMMARY').replace(/\\,/g, ',').replace(/\\;/g, ';').slice(0, 120),
        });
    });
    return out;
}

async function fetchFeed(url) {
    let target;
    try { target = new URL(url); } catch (e) { throw new Error('الرابط غير صالح'); }
    if (target.protocol !== 'https:' || isPrivateHost(target.hostname)) throw new Error('يجب أن يكون الرابط https عاماً');

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    try {
        const r = await fetch(target.toString(), {
            redirect: 'follow',
            signal: ctrl.signal,
            headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5', 'User-Agent': 'rentapa-ical-sync/1.0' },
        });
        if (!r.ok) throw new Error(`المنصة ردّت بخطأ ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > MAX_BYTES) throw new Error('ملف التقويم أكبر من المتوقع');
        const text = buf.toString('utf8');
        if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('الرابط لا يعيد ملف تقويم iCal');
        return text;
    } catch (e) {
        if (e.name === 'AbortError') throw new Error('المنصة لم تستجب في الوقت المحدد');
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

async function syncOne(key, feed) {
    try {
        const events = parseICS(await fetchFeed(feed.url));
        const r = await rpc('ical_sync_apply', { p_key: key, p_feed_id: feed.id, p_events: events, p_error: null });
        if (!r.ok) {
            console.error('[ical-sync] apply failed', feed.id, r.status, JSON.stringify(r.data).slice(0, 300));
            return { id: feed.id, name: feed.name, ok: false, error: 'تعذّر حفظ الحجوزات' };
        }
        return { id: feed.id, name: feed.name, ok: true, ...(r.data || {}) };
    } catch (e) {
        const error = e.message || 'تعذّرت المزامنة';
        console.error('[ical-sync] feed failed', feed.id, error);
        // سجّل الخطأ على الرابط دون إلغاء أي حجز
        await rpc('ical_sync_apply', { p_key: key, p_feed_id: feed.id, p_events: [], p_error: error }).catch(() => {});
        return { id: feed.id, name: feed.name, ok: false, error };
    }
}

/* ---- إشعار الجوال بعد المزامنة (الهجرة 0011) ----
   حجز جديد/ملغى بتواريخه (بالمقارنة بين الأيام المحجوزة قبل المزامنة وبعدها)،
   وتعطّل رابط منصة عند أول فشل فقط لا كل 15 دقيقة، ثم إشعار عند عودته. */
const fmtDay = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('ar-u-nu-latn', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const rangeKey = (b) => `${b.checkin}|${b.checkout}`;

async function bookedRanges() {
    const r = await rpc('public_booked_ranges', {});
    return r.ok && Array.isArray(r.data) ? r.data : null;
}

async function feedStatus(key) {
    const r = await rpc('ical_feed_status', { p_key: key });
    if (!r.ok || !Array.isArray(r.data)) return null;   // الهجرة 0011 لم تُطبَّق — بلا إشعارات
    return Object.fromEntries(r.data.map((f) => [f.id, f.last_error || null]));
}

async function notifyChanges(key, results, prevErrors, before, after) {
    const lines = [];
    let alert = false;

    const added = results.filter((f) => f.ok && f.added);
    const removed = results.filter((f) => f.ok && f.removed);
    if (added.length || removed.length) {
        const beforeSet = new Set((before || []).map(rangeKey));
        const afterSet = new Set((after || []).map(rangeKey));
        const newRanges = (after || []).filter((b) => !beforeSet.has(rangeKey(b)));
        const goneRanges = (before || []).filter((b) => !afterSet.has(rangeKey(b)));
        if (added.length) {
            lines.push(`🏠 حجز جديد من ${added.map((f) => f.name).join(' و')}`);
            newRanges.slice(0, 4).forEach((b) => lines.push(`• ${fmtDay(b.checkin)} ← ${fmtDay(b.checkout)}`));
        }
        if (removed.length) {
            lines.push(`❌ إلغاء حجز في ${removed.map((f) => f.name).join(' و')}`);
            goneRanges.slice(0, 4).forEach((b) => lines.push(`• ${fmtDay(b.checkin)} ← ${fmtDay(b.checkout)} (أصبحت متاحة)`));
        }
    }

    results.forEach((f) => {
        const had = prevErrors[f.id];
        if (!f.ok && !had) { alert = true; lines.push(`⚠️ تعذّرت مزامنة ${f.name}: ${f.error}`); }
        if (f.ok && had) lines.push(`✅ عادت مزامنة ${f.name} للعمل`);
    });

    if (!lines.length || !sendToOwner) return null;
    return sendToOwner(key, {
        title: alert ? '⚠️ مزامنة التقويم' : '📅 تحديث الحجوزات',
        body: lines.join('\n'),
        url: '/admin#calendar',
        tag: alert ? 'ical-alert' : undefined,
    });
}

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const send = (code, obj) => res.status(code).send(JSON.stringify(obj));

    if (req.method !== 'GET' && req.method !== 'POST') return send(405, { ok: false, error: 'method not allowed' });

    // لوحة التحكم ترسل المفتاح في ترويسة (لا يظهر في سجلات الروابط)، والمهمة المجدولة في الرابط
    const key = String(req.headers['x-sync-key'] || (req.query && req.query.key) || '').trim();
    if (key.length < 32) return send(401, { ok: false, error: 'sync key required' });

    try {
        const list = await rpc('ical_sync_feeds', { p_key: key });
        if (!list.ok) {
            const missing = list.status === 404;
            console.error('[ical-sync] feeds failed', list.status, JSON.stringify(list.data).slice(0, 300));
            return send(missing ? 503 : 401, { ok: false, error: missing ? 'apply migration 0010' : 'invalid sync key' });
        }

        const only = String((req.query && req.query.feed) || '').trim();
        const feeds = (Array.isArray(list.data) ? list.data : []).filter((f) => !only || f.id === only);
        // الحالة قبل المزامنة لإشعار الجوال (تُتجاهل بصمت إن لم تُطبَّق الهجرة 0011)
        const prevErrors = await feedStatus(key).catch(() => null);
        const before = prevErrors ? await bookedRanges().catch(() => null) : null;

        const results = await Promise.all(feeds.map((f) => syncOne(key, f)));

        let push = null;
        if (prevErrors) {
            const after = await bookedRanges().catch(() => null);
            push = await notifyChanges(key, results, prevErrors, before, after)
                .catch((e) => { console.error('[ical-sync] push failed', e.message); return { error: e.message }; });
        }
        return send(200, { ok: true, at: new Date().toISOString(), feeds: results, push });
    } catch (e) {
        console.error('[ical-sync] error', e);
        return send(500, { ok: false, error: 'sync failed' });
    }
};
