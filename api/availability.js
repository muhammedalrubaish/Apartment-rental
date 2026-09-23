// api/availability.js — الأيام المحجوزة القادمة (للتشخيص والفحص من الخادم)
//
// GET /api/availability  →  { ok, count, ranges: [{ checkin, checkout }] }
//
// نفس بيانات دالة public_booked_ranges (الهجرة 0008) التي تقرؤها الصفحة الرئيسية:
// تواريخ فقط — بلا أسماء ولا أرقام ولا مبالغ. عند غياب الدالة تُعاد رسالة واضحة
// بدل فشل صامت، حتى يُعرف إن كانت الهجرة لم تُطبَّق.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://divoyxodxkioxugrphby.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_qw9IiQ52_WFip-4gNX4lkA_CZA0VFzf';

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return res.status(405).send(JSON.stringify({ ok: false, error: 'method not allowed' }));
    }

    try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/public_booked_ranges`, {
            method: 'POST',
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
            },
            body: '{}',
        });

        if (!r.ok) {
            const body = await r.text();
            console.error('[availability] rpc failed', r.status, body.slice(0, 300));
            // 404 على الدالة = الهجرة 0008 لم تُطبَّق بعد
            const missing = r.status === 404 || /could not find the function/i.test(body);
            return res.status(missing ? 503 : 502).send(JSON.stringify({
                ok: false,
                error: missing ? 'public_booked_ranges function missing — apply migration 0008' : 'rpc failed',
                status: r.status,
            }));
        }

        const rows = await r.json();
        const ranges = (Array.isArray(rows) ? rows : [])
            .map((b) => ({ checkin: b.checkin, checkout: b.checkout }));
        return res.status(200).send(JSON.stringify({ ok: true, count: ranges.length, ranges }));
    } catch (e) {
        console.error('[availability] error', e);
        return res.status(500).send(JSON.stringify({ ok: false, error: 'availability check failed' }));
    }
};
