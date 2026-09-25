// api/push-notify.js — إشعار لجوال المالك
//
// POST /api/push-notify   ترويسة X-Sync-Key: <مفتاح المزامنة السري>
//   { "title", "body", "url", "tag" }  → يُرسل لكل أجهزة المالك
//   { "action": "vapid" }              → يعيد المفتاح العام (لتسجيل جهاز من لوحة التحكم)
//
// يستدعيه مشغّل رسائل الضيوف في Supabase (الهجرة 0011) وزر «إرسال تجربة» في اللوحة.

const { sendToOwner, vapidKeys } = require('./_push');

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const send = (code, obj) => res.status(code).send(JSON.stringify(obj));

    if (req.method !== 'POST') return send(405, { ok: false, error: 'method not allowed' });

    const key = String(req.headers['x-sync-key'] || '').trim();
    if (key.length < 32) return send(401, { ok: false, error: 'sync key required' });

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};

    try {
        if (body.action === 'vapid') {
            const keys = await vapidKeys(key);
            return send(200, { ok: true, publicKey: keys.publicKey });
        }
        if (!body.title && !body.body) return send(400, { ok: false, error: 'title or body required' });
        const result = await sendToOwner(key, body);
        // في السجل: كم جهازاً مسجلاً وكم وصله الإشعار — devices: 0 يعني أن الإشعارات لم تُفعَّل على أي جوال
        console.log('[push-notify]', JSON.stringify({ tag: body.tag || null, ...result }));
        return send(200, { ok: true, ...result });
    } catch (e) {
        const msg = e.message || 'push failed';
        console.error('[push-notify]', msg);
        const code = msg === 'invalid key' ? 401 : msg === 'apply migration 0011' ? 503 : 500;
        return send(code, { ok: false, error: msg });
    }
};
