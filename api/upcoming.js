// api/upcoming.js — الحجوزات القادمة: لأداة شاشة القفل (Scriptable) وللملخص الصباحي
//
// GET /api/upcoming?token=<رمز تصدير التقويم>
//   → JSON: المقيم الآن، الحجز القادم، وصول/مغادرة اليوم، وأقرب 5 حجوزات
//     (نفس رمز رابط iCal في لوحة التحكم — الدالة ical_bookings ترفض أي رمز خاطئ)
//
// GET /api/upcoming?token=…&digest=1   مع ترويسة X-Sync-Key
//   → يرسل أيضاً «ملخص اليوم» إشعاراً لجوال المالك (تستدعيه مهمة pg_cron كل صباح
//     — الهجرة 0012). بلا حجوزات اليوم أو غداً لا يُرسل شيء، إلا مع force=1 (زر التجربة).
//
// التواريخ بتوقيت الرياض (UTC+3 بلا توقيت صيفي).

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://divoyxodxkioxugrphby.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_qw9IiQ52_WFip-4gNX4lkA_CZA0VFzf';

// الإشعارات اختيارية: لو تعذّر تحميل مكتبتها يبقى رد JSON للأداة يعمل
let sendToOwner = null;
try { ({ sendToOwner } = require('./_push')); } catch (e) { console.error('[upcoming] push unavailable', e.message); }

const SOURCE_LABEL = {
    direct: 'مباشر', whatsapp: 'واتساب', gathern: 'جاذر إن', airbnb: 'Airbnb',
    ical: 'iCal', manual: 'يدوي',
};

const DAY = 24 * 60 * 60 * 1000;
const riyadhToday = () => new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
const fmtDay = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('ar-u-nu-latn', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const fmtWeekday = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('ar-u-nu-latn', { weekday: 'long', timeZone: 'UTC' });

const nightsWord = (n) => (n === 1 ? 'ليلة واحدة' : n === 2 ? 'ليلتان' : n <= 10 ? `${n} ليالٍ` : `${n} ليلة`);
function whenWord(days) {
    if (days <= 0) return 'اليوم';
    if (days === 1) return 'غداً';
    if (days === 2) return 'بعد يومين';
    return days <= 10 ? `بعد ${days} أيام` : `بعد ${days} يوماً`;
}

function item(b, today) {
    const guest = String(b.guest || '').trim();
    const nights = Math.max(1, diffDays(b.checkin, b.checkout));
    const inDays = diffDays(today, b.checkin);
    return {
        guest,
        first: guest.split(/\s+/)[0] || 'ضيف',
        source: b.source,
        sourceLabel: SOURCE_LABEL[b.source] || b.source || '',
        checkin: b.checkin,
        checkout: b.checkout,
        nights,
        nightsLabel: nightsWord(nights),
        inLabel: fmtDay(b.checkin),
        outLabel: fmtDay(b.checkout),
        range: `${fmtDay(b.checkin)} ← ${fmtDay(b.checkout)}`,
        nightsLeft: Math.max(0, diffDays(today, b.checkout)),
        inDays,
        when: b.checkin <= today && today < b.checkout ? 'مقيم الآن' : whenWord(inDays),
    };
}

function summarize(rows) {
    const today = riyadhToday();
    const tomorrow = addDays(today, 1);
    const list = rows
        .filter((b) => b && b.checkin && b.checkout && b.status !== 'cancelled' && b.status !== 'blocked')
        .map((b) => ({ ...b, checkin: String(b.checkin).slice(0, 10), checkout: String(b.checkout).slice(0, 10) }))
        .sort((a, b) => (a.checkin < b.checkin ? -1 : 1));

    const current = list.find((b) => b.checkin <= today && today < b.checkout) || null;
    // «القادم» = أول وصول بعد المقيم الحالي (المقيم نفسه يُعرض في current)
    const future = list.filter((b) => b.checkin >= today && b !== current);
    return {
        ok: true,
        today,
        todayLabel: `${fmtWeekday(today)} ${fmtDay(today)}`,
        current: current ? item(current, today) : null,
        next: future.length ? item(future[0], today) : null,
        arrivalsToday: list.filter((b) => b.checkin === today).map((b) => item(b, today)),
        departuresToday: list.filter((b) => b.checkout === today).map((b) => item(b, today)),
        arrivalsTomorrow: list.filter((b) => b.checkin === tomorrow).map((b) => item(b, today)),
        departuresTomorrow: list.filter((b) => b.checkout === tomorrow).map((b) => item(b, today)),
        upcoming: list.filter((b) => b.checkout > today).slice(0, 5).map((b) => item(b, today)),
        // آخر ثلاثة ضيوف غادروا (الأحدث أولاً) مع متى خرج كل منهم
        past: list.filter((b) => b.checkout <= today)
            .sort((a, b) => (a.checkout < b.checkout ? 1 : -1))
            .slice(0, 3)
            .map((b) => {
                const ago = diffDays(b.checkout, today);
                return Object.assign(item(b, today), {
                    ago,
                    left: ago === 0 ? 'خرج اليوم' : ago === 1 ? 'خرج أمس' : ago === 2 ? 'خرج قبل يومين'
                        : `خرج قبل ${ago <= 10 ? ago + ' أيام' : ago + ' يوماً'}`,
                });
            }),
    };
}

/* مواعيد الإنترنت والكهرباء (الهجرة 0013): أقرب فاتورة مستحقة، وإلا تقدير الموعد
   القادم = آخر فاتورة + شهر. يُعاد null إن لم تُطبَّق الهجرة، فتعمل الأداة بدونها. */
const BILL_META = { 'إنترنت': { key: 'internet', label: 'الإنترنت' }, 'كهرباء': { key: 'power', label: 'الكهرباء' } };

function addMonth(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();   // آخر يوم في الشهر التالي
    return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

function billItems(rows) {
    const today = riyadhToday();
    return rows.filter((r) => BILL_META[r.category] && r.due_date).map((r) => {
        const meta = BILL_META[r.category];
        let due = String(r.due_date).slice(0, 10);
        let estimated = false;
        if (r.status !== 'due') {
            // آخر فاتورة مسددة: الموعد القادم تقديراً بعد شهر (ويُكرر حتى يصبح قادماً)
            estimated = true;
            for (let i = 0; i < 24 && due < today; i++) due = addMonth(due);
            if (due === String(r.due_date).slice(0, 10)) due = addMonth(due);
        }
        const days = diffDays(today, due);
        const when = days < 0 ? `متأخرة ${-days} ${-days === 1 ? 'يوم' : -days <= 10 ? 'أيام' : 'يوماً'}`
            : days === 0 ? 'اليوم' : days === 1 ? 'غداً' : `بعد ${days} ${days <= 10 ? 'أيام' : 'يوماً'}`;
        return {
            key: meta.key,
            label: meta.label,
            dueDate: due,
            dueLabel: fmtDay(due),
            days,
            when,
            overdue: days < 0,
            estimated,
            amount: Number(r.amount) || 0,
        };
    }).sort((a, b) => a.days - b.days);
}

/* مؤشرات الشهر الحالي (بتوقيت الرياض):
   - bookings: عدد الحجوزات التي لها ليالٍ داخل الشهر
   - bookedNights: الليالي المحجوزة في الشهر (دون تكرار التداخل) من أصل daysInMonth
   - freeLeft: الليالي المتاحة من اليوم حتى نهاية الشهر (لا حجز ولا حجب) من أصل daysLeft */
function monthStats(rows) {
    const today = riyadhToday();
    const monthStart = today.slice(0, 8) + '01';
    const [y, m] = today.split('-').map(Number);
    const monthEnd = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);   // أول الشهر التالي
    const daysInMonth = diffDays(monthStart, monthEnd);
    const daysLeft = diffDays(today, monthEnd);

    const booked = new Set();
    const blocked = new Set();
    let bookings = 0;
    rows.forEach((b) => {
        if (!b || !b.checkin || !b.checkout || b.status === 'cancelled') return;
        const ci = String(b.checkin).slice(0, 10), co = String(b.checkout).slice(0, 10);
        const from = ci > monthStart ? ci : monthStart;
        const to = co < monthEnd ? co : monthEnd;
        if (from >= to) return;
        const target = b.status === 'blocked' ? blocked : booked;
        if (b.status !== 'blocked') bookings++;
        for (let dd = from; dd < to; dd = addDays(dd, 1)) target.add(dd);
    });

    let freeLeft = 0;
    for (let dd = today; dd < monthEnd; dd = addDays(dd, 1)) if (!booked.has(dd) && !blocked.has(dd)) freeLeft++;

    return {
        month: new Date(monthStart + 'T00:00:00Z').toLocaleDateString('ar-u-nu-latn', { month: 'long', timeZone: 'UTC' }),
        bookings,
        bookedNights: booked.size,
        daysInMonth,
        occupancy: daysInMonth ? Math.round((booked.size / daysInMonth) * 100) : 0,
        freeLeft,
        daysLeft,
    };
}

/* أسعار الليلة الأقل والأعلى: وسط الأسبوع والويكند (الهجرة 0014).
   سعر الليلة = المبلغ ÷ الليالي، ويُصنَّف الحجز ويكند إن كانت كل لياليه خميس/جمعة،
   ووسط أسبوع إن لم يكن فيها ويكند؛ الحجز المختلط لا يُفصل بدقة فيُستبعد.
   بلا بيانات كافية تُعرض الأسعار المعتمدة في apartments.json. */
const WEEKEND_NIGHTS = [4, 5];   // الخميس والجمعة (getUTCDay)
const CONFIGURED = { weekday: 220, weekend: 280 };

function priceRanges(rows) {
    const groups = { weekday: [], weekend: [] };
    rows.forEach((b) => {
        const ci = String(b.checkin).slice(0, 10), co = String(b.checkout).slice(0, 10);
        const nights = diffDays(ci, co);
        const total = Number(b.total) || 0;
        if (nights <= 0 || total <= 0) return;
        let we = 0;
        for (let dd = ci; dd < co; dd = addDays(dd, 1)) {
            if (WEEKEND_NIGHTS.indexOf(new Date(dd + 'T00:00:00Z').getUTCDay()) !== -1) we++;
        }
        const nightly = Math.round(total / nights);
        if (we === nights) groups.weekend.push(nightly);
        else if (we === 0) groups.weekday.push(nightly);
    });
    const range = (arr, fallback) => (arr.length
        ? { min: Math.min(...arr), max: Math.max(...arr), count: arr.length, configured: false }
        : { min: fallback, max: fallback, count: 0, configured: true });
    return { weekday: range(groups.weekday, CONFIGURED.weekday), weekend: range(groups.weekend, CONFIGURED.weekend) };
}

async function loadPrices(token) {
    try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/widget_prices`, {
            method: 'POST',
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ p_token: token }),
        });
        const rows = r.ok ? await r.json() : [];
        return priceRanges(Array.isArray(rows) ? rows : []);
    } catch (e) {
        return priceRanges([]);
    }
}

async function loadBills(token) {
    try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/widget_bills`, {
            method: 'POST',
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ p_token: token }),
        });
        if (!r.ok) return null;
        const rows = await r.json();
        return Array.isArray(rows) ? billItems(rows) : null;
    } catch (e) {
        return null;
    }
}

// نص «ملخص اليوم» — فارغ إن لم يكن هناك وصول/مغادرة اليوم أو غداً ولا مقيم
function digestLines(s) {
    const who = (x) => `${x.first} (${x.nightsLabel}${x.sourceLabel ? ' • ' + x.sourceLabel : ''})`;
    const lines = [];
    s.arrivalsToday.forEach((x) => lines.push(`🟢 وصول اليوم: ${who(x)}`));
    s.departuresToday.forEach((x) => lines.push(`🔴 مغادرة اليوم: ${x.first} — جهّز الشقة للتنظيف`));
    if (s.current && !s.arrivalsToday.some((x) => x.checkin === s.current.checkin)) {
        lines.push(`🏠 مقيم الآن: ${s.current.first} حتى ${fmtDay(s.current.checkout)}`);
    }
    s.arrivalsTomorrow.forEach((x) => lines.push(`📅 غداً وصول: ${who(x)}`));
    s.departuresTomorrow.forEach((x) => lines.push(`📅 غداً مغادرة: ${x.first}`));
    // تذكير بالإنترنت/الكهرباء إن كان الموعد خلال 3 أيام أو متأخراً
    (s.bills || []).filter((b) => b.days <= 3).forEach((b) => {
        lines.push(`${b.key === 'internet' ? '📶' : '⚡'} ${b.label}: ${b.overdue ? b.when : 'موعدها ' + b.when}${b.amount ? ' • ' + b.amount + ' ريال' : ''}`);
    });
    return lines;
}

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const send = (code, obj) => res.status(code).send(JSON.stringify(obj));

    if (req.method !== 'GET') return send(405, { ok: false, error: 'method not allowed' });

    const q = req.query || {};
    const token = String(q.token || '').trim();
    if (token.length < 16) return send(401, { ok: false, error: 'token required' });

    try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ical_bookings`, {
            method: 'POST',
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ p_token: token }),
        });
        if (!r.ok) {
            console.error('[upcoming] rpc failed', r.status, (await r.text()).slice(0, 200));
            return send(r.status === 404 ? 503 : 403, { ok: false, error: r.status === 404 ? 'apply migration 0007' : 'invalid token' });
        }
        const rows = await r.json();
        const summary = summarize(Array.isArray(rows) ? rows : []);
        summary.stats = monthStats(Array.isArray(rows) ? rows : []);
        [summary.bills, summary.prices] = await Promise.all([loadBills(token), loadPrices(token)]);

        if (q.digest) {
            const key = String(req.headers['x-sync-key'] || '').trim();
            const lines = digestLines(summary);
            if (!lines.length && q.force) lines.push('لا وصول ولا مغادرة اليوم أو غداً ✨');
            if (lines.length && key.length >= 32 && sendToOwner) {
                summary.digest = await sendToOwner(key, {
                    title: `☀️ حجوزات ${summary.todayLabel}`,
                    body: lines.join('\n'),
                    url: '/admin#calendar',
                    tag: 'daily-digest',
                }).catch((e) => ({ error: e.message }));
            } else {
                summary.digest = { skipped: !lines.length ? 'nothing today' : 'no key' };
            }
        }
        return send(200, summary);
    } catch (e) {
        console.error('[upcoming] error', e);
        return send(500, { ok: false, error: 'upcoming failed' });
    }
};

module.exports.summarize = summarize;
module.exports.digestLines = digestLines;
module.exports.billItems = billItems;
module.exports.monthStats = monthStats;
module.exports.priceRanges = priceRanges;
