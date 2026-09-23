// api/ical-fetch.js — جلب تقويم iCal من منصة خارجية (جاذر إن / Airbnb) نيابةً عن لوحة التحكم
//
// GET /api/ical-fetch?url=https://…   مع ترويسة Authorization: Bearer <جلسة Supabase للمالك>
//
// السبب: المتصفح يمنع قراءة رابط المنصة مباشرة من نطاق آخر (CORS)، فيجلبه الخادم
// ويعيد نصه كما هو. الوصول للمالك المسجّل دخوله فقط، وروابط https فقط، ويُرفض أي
// عنوان داخلي أو محلي حتى لا تُستغل النقطة للوصول إلى شبكات خاصة (SSRF).

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://divoyxodxkioxugrphby.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_qw9IiQ52_WFip-4gNX4lkA_CZA0VFzf';

const MAX_BYTES = 2 * 1024 * 1024;   // 2MB تكفي لأي تقويم حجوزات

function isPrivateHost(host) {
    const h = host.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
        const [a, b] = h.split('.').map(Number);
        return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    }
    return h.includes(':');   // IPv6 حرفي — نرفضه احتياطاً
}

async function isOwner(req) {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return false;
    try {
        const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: { apikey: SUPABASE_ANON_KEY, Authorization: auth },
        });
        if (!r.ok) return false;
        const u = await r.json();
        return !!(u && u.id);
    } catch (e) {
        console.error('[ical-fetch] auth check failed', e);
        return false;
    }
}

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

    if (!(await isOwner(req))) return res.status(401).json({ error: 'unauthorized' });

    const raw = String((req.query && req.query.url) || '').trim();
    let target;
    try { target = new URL(raw); } catch (e) { return res.status(400).json({ error: 'bad url' }); }

    if (target.protocol !== 'https:' || isPrivateHost(target.hostname)) {
        return res.status(400).json({ error: 'https public url required' });
    }

    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        const r = await fetch(target.toString(), {
            redirect: 'follow',
            signal: ctrl.signal,
            headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5', 'User-Agent': 'rentapa-ical-sync/1.0' },
        });
        clearTimeout(timer);

        if (!r.ok) return res.status(502).json({ error: `platform responded ${r.status}` });

        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'calendar too large' });

        const text = buf.toString('utf8');
        if (!/BEGIN:VCALENDAR/i.test(text)) return res.status(422).json({ error: 'not an ics calendar' });

        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        return res.status(200).send(text);
    } catch (e) {
        console.error('[ical-fetch] fetch failed', e);
        return res.status(504).json({ error: e.name === 'AbortError' ? 'timeout' : 'fetch failed' });
    }
};
