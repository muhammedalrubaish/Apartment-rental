// api/_push.js — إرسال إشعارات الجوال (Web Push) لكل أجهزة المالك
// (الملف يبدأ بشرطة سفلية فلا يصبح نقطة خادم مستقلة؛ تستورده ical-sync وpush-notify)
//
// مفتاحا التوقيع (VAPID) يولّدهما الخادم عند أول استخدام ويحفظهما في Supabase
// (جدول push_vapid — الهجرة 0011)، ولا يُقرآن إلا بمفتاح المزامنة السري.

const webpush = require('web-push');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://divoyxodxkioxugrphby.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_qw9IiQ52_WFip-4gNX4lkA_CZA0VFzf';
const SUBJECT = 'https://rentapa.vercel.app';

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

// مفتاحا التوقيع: من القاعدة، أو يُولَّدان ويُحفظان أول مرة
async function vapidKeys(key) {
    const read = async () => {
        const r = await rpc('push_vapid_get', { p_key: key });
        if (!r.ok) throw new Error(r.status === 404 ? 'apply migration 0011' : 'invalid key');
        const row = Array.isArray(r.data) ? r.data[0] : null;
        return row && row.public_key ? { publicKey: row.public_key, privateKey: row.private_key } : null;
    };
    let keys = await read();
    if (!keys) {
        const gen = webpush.generateVAPIDKeys();
        const init = await rpc('push_vapid_init', { p_key: key, p_public: gen.publicKey, p_private: gen.privateKey });
        if (!init.ok) throw new Error('vapid init failed');
        keys = await read();   // قد يسبقنا طلب متزامن — نعتمد ما حُفظ فعلاً
    }
    if (!keys) throw new Error('vapid keys unavailable');
    return keys;
}

/* إرسال إشعار لكل الأجهزة المسجلة. الأجهزة المنتهية (404/410) تُحذف تلقائياً.
   payload: { title, body, url, tag } */
async function sendToOwner(key, payload) {
    const keys = await vapidKeys(key);
    webpush.setVapidDetails(SUBJECT, keys.publicKey, keys.privateKey);

    const t = await rpc('push_targets', { p_key: key });
    if (!t.ok) throw new Error('targets failed');
    const subs = Array.isArray(t.data) ? t.data : [];

    const body = JSON.stringify({
        title: String(payload.title || 'RentAPA').slice(0, 80),
        body: String(payload.body || '').slice(0, 240),
        url: String(payload.url || '/admin'),
        tag: payload.tag ? String(payload.tag).slice(0, 64) : undefined,
    });

    let sent = 0, removed = 0, failed = 0;
    await Promise.all(subs.map(async (s) => {
        try {
            await webpush.sendNotification(
                { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                body,
                { TTL: 24 * 60 * 60, urgency: 'high' },
            );
            sent++;
        } catch (e) {
            if (e && (e.statusCode === 404 || e.statusCode === 410)) {
                removed++;
                await rpc('push_forget', { p_key: key, p_endpoint: s.endpoint }).catch(() => {});
            } else {
                failed++;
                console.error('[push] send failed', e && e.statusCode, e && e.body);
            }
        }
    }));
    return { devices: subs.length, sent, removed, failed };
}

module.exports = { sendToOwner, vapidKeys, rpc };
