// api/calendar.js — رابط تصدير التقويم (iCal) الذي تُلصقه في جاذر إن وAirbnb
//
// GET /api/calendar?token=XXXX  →  ملف text/calendar بكل الحجوزات غير الملغاة
//
// الرمز يُتحقق منه داخل قاعدة البيانات بدالة ical_bookings (انظر الهجرة 0007)،
// فلا حاجة لمفتاح خدمة سري هنا: مفتاح anon العام يكفي والدالة ترفض أي رمز خاطئ.
// لا يُصدَّر رقم جوال ولا مبلغ — المنصات تحتاج التواريخ فقط.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://divoyxodxkioxugrphby.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_qw9IiQ52_WFip-4gNX4lkA_CZA0VFzf';

const SOURCE_LABEL = {
    direct: 'الموقع المباشر', whatsapp: 'واتساب', gathern: 'جاذر إن', airbnb: 'Airbnb',
    ical: 'مزامنة iCal', block: 'حجب', manual: 'إضافة يدوية',
};

function stamp(d) { return String(d).slice(0, 10).replace(/-/g, ''); }

// طيّ الأسطر الطويلة حسب معيار iCalendar (75 بايت كحد أقصى للسطر)
function fold(line) {
    const out = [];
    let s = line;
    while (Buffer.byteLength(s, 'utf8') > 73) {
        let cut = 73;
        while (Buffer.byteLength(s.slice(0, cut), 'utf8') > 73) cut--;
        out.push(s.slice(0, cut));
        s = ' ' + s.slice(cut);
    }
    out.push(s);
    return out.join('\r\n');
}

function esc(v) {
    return String(v || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function buildICS(rows) {
    const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const lines = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RHSA7905//Property Manager//AR',
        'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:حجوزات الشقة',
    ];

    rows.forEach((b) => {
        const blocked = b.status === 'blocked';
        lines.push('BEGIN:VEVENT');
        lines.push('UID:' + b.id + '@rhsa7905');
        lines.push('DTSTAMP:' + now);
        lines.push('DTSTART;VALUE=DATE:' + stamp(b.checkin));
        lines.push('DTEND;VALUE=DATE:' + stamp(b.checkout));
        lines.push('SUMMARY:' + esc(blocked ? 'غير متاح' : 'محجوز — ' + (b.guest || '')));
        lines.push('DESCRIPTION:' + esc(SOURCE_LABEL[b.source] || b.source || ''));
        lines.push('STATUS:CONFIRMED');
        lines.push('TRANSP:OPAQUE');
        lines.push('END:VEVENT');
    });

    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return res.status(405).send('Method Not Allowed');
    }

    const token = String((req.query && req.query.token) || '').trim();
    if (!token) return res.status(401).send('token required');

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
            const body = await r.text();
            console.error('[calendar] rpc failed', r.status, body.slice(0, 300));
            // 404 على الدالة = الهجرة 0007 لم تُطبَّق بعد
            if (r.status === 404) return res.status(503).send('ical_bookings function missing — apply migration 0007');
            return res.status(403).send('invalid token');
        }

        const rows = await r.json();
        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', 'inline; filename="calendar.ics"');
        return res.status(200).send(buildICS(Array.isArray(rows) ? rows : []));
    } catch (e) {
        console.error('[calendar] error', e);
        return res.status(500).send('calendar export failed');
    }
};
