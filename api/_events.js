/* مناسبات الرياض التي تجلب الزوار — لأداة الجوال (ليس مساراً: الملفات المبدوءة بـ _)
   ثلاثة أنواع:
   1) سنوية بتاريخ ميلادي ثابت: يوم التأسيس، اليوم الوطني
   2) هجرية تُحسب بتقويم أم القرى الرسمي: عيد الفطر وعيد الأضحى
      (قد يختلف يوماً واحداً حسب رؤية الهلال)
   3) فعاليات بتواريخ معلنة — تُراجع وتُضاف سنوياً. approx: موعد لم يُعلن بعد.
   المصادر (سبتمبر 2026): the-afc.com، oca.asia، fii-institute.org، cityscapeglobal.com،
   mdlbeast.com، onegiantleap.com، esportsworldcup.com، مواقع تذاكر كأس السعودية. */

const DAY = 24 * 60 * 60 * 1000;
const MAJOR_LEAD_DAYS = 90;
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const FIXED = [
    { name: 'يوم التأسيس', icon: 'flag.fill', month: 2, day: 22, days: 1 },
    { name: 'اليوم الوطني', icon: 'flag.fill', month: 9, day: 23, days: 1 },
];

const HIJRI = [
    // الشهر، اليوم، مدة الإجازة المعتادة بالأيام
    { name: 'عيد الفطر', icon: 'moon.stars.fill', month: 10, day: 1, days: 4 },
    { name: 'عيد الأضحى', icon: 'moon.stars.fill', month: 12, day: 10, days: 4 },
];

const EVENTS = [
    // major: مناسبة كبرى — تظهر قبل موعدها بـ 90 يوماً ولو سبقتها مناسبات أصغر أقرب
    { name: 'موسم الرياض', icon: 'sparkles', start: '2026-10-15', end: '2027-03-31', approx: true, major: true },
    { name: 'مؤتمر FII للاستثمار', icon: 'briefcase.fill', start: '2026-10-26', end: '2026-10-29' },
    { name: 'سيتي سكيب العالمي', icon: 'building.2.fill', start: '2026-11-16', end: '2026-11-19' },
    { name: 'ساوندستورم', icon: 'music.note', start: '2026-12-03', end: '2026-12-04' },
    { name: 'معرض الرياض للكتاب', icon: 'book.fill', start: '2026-12-10', end: '2026-12-19' },
    { name: 'الألعاب الآسيوية للصالات', icon: 'medal.fill', start: '2026-12-11', end: '2026-12-21' },
    { name: 'كأس آسيا 2027', icon: 'soccerball', start: '2027-01-07', end: '2027-02-05', major: true },
    { name: 'كأس السعودية للخيل', icon: 'trophy.fill', start: '2027-02-05', end: '2027-02-06' },
    { name: 'مؤتمر LEAP', icon: 'cpu', start: '2027-04-12', end: '2027-04-15' },
    { name: 'كأس الرياضات الإلكترونية', icon: 'gamecontroller.fill', start: '2027-07-16', end: '2027-08-01', major: true },
];

let hijriFmt = null;
function hijriOf(iso) {
    try {
        hijriFmt = hijriFmt || new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn',
            { day: 'numeric', month: 'numeric', timeZone: 'UTC' });
        const parts = hijriFmt.formatToParts(new Date(iso + 'T00:00:00Z'));
        const get = (t) => Number((parts.find((p) => p.type === t) || {}).value);
        return { month: get('month'), day: get('day') };
    } catch (e) {
        return null;   // بيئة بلا تقويم أم القرى: تُتجاهل الأعياد
    }
}

// «26–29 أكتوبر» أو «7 يناير – 5 فبراير» أو «22 فبراير»
function rangeLabel(start, end) {
    const s = new Date(start + 'T00:00:00Z'), e = new Date(end + 'T00:00:00Z');
    if (start === end) return `${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]}`;
    if (s.getUTCMonth() === e.getUTCMonth()) return `${s.getUTCDate()}–${e.getUTCDate()} ${MONTHS[s.getUTCMonth()]}`;
    return `${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]} – ${e.getUTCDate()} ${MONTHS[e.getUTCMonth()]}`;
}

function allEvents(today, horizon) {
    const last = addDays(today, horizon);
    const list = EVENTS.slice();
    const y = Number(today.slice(0, 4));
    [y, y + 1].forEach((yr) => FIXED.forEach((f) => {
        const start = `${yr}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`;
        list.push({ name: f.name, icon: f.icon, start, end: addDays(start, f.days - 1) });
    }));
    // الأعياد: بحث يومي ضمن الأفق (أقل من 400 يوم — خفيف)
    for (let d = addDays(today, -5); d <= last; d = addDays(d, 1)) {
        const h = hijriOf(d);
        if (!h) break;
        HIJRI.forEach((e) => {
            if (h.month === e.month && h.day === e.day) {
                list.push({ name: e.name, icon: e.icon, start: d, end: addDays(d, e.days - 1), approx: 'hijri' });
            }
        });
    }
    return list.filter((e) => e.end >= today && e.start <= last);
}

// ليالي المناسبة المتاحة: كل يوم فيها = ليلة (يوم ← اليوم التالي) غير محجوزة
// from: أول ليلة تُحسب — أثناء المناسبة الجارية تُحسب الليالي الباقية فقط
function freeNights(ev, rows, from) {
    const taken = (rows || []).filter((b) => b && b.status !== 'cancelled' && b.checkin && b.checkout);
    let total = 0, free = 0;
    for (let d = from && from > ev.start ? from : ev.start; d <= ev.end; d = addDays(d, 1)) {
        total += 1;
        const next = addDays(d, 1);
        if (!taken.some((b) => String(b.checkin).slice(0, 10) < next && String(b.checkout).slice(0, 10) > d)) free += 1;
    }
    return { total, free };
}

const daysWord = (n) => (n === 1 ? 'يوم' : n === 2 ? 'يومين' : n <= 10 ? `${n} أيام` : `${n} يوماً`);

/* أقرب المناسبات: الجارية أولاً ثم الأقرب بدءاً.
   foot: العدّ التنازلي، ومعه التوفر للمناسبات القصيرة (≤ 14 يوماً) */
function upcomingEvents(today, rows, limit, horizon) {
    // الموسم الطويل الجاري (أكثر من شهر) يتأخر عن المناسبات القصيرة القادمة كي لا يحجز مكاناً لأشهر
    const longNow = (e) => (e.start <= today && diffDays(e.start, e.end) > 30 ? 1 : 0);
    const order = (a, b) => longNow(a) - longNow(b) || a.start.localeCompare(b.start);
    const n = limit || 3;
    const all = allEvents(today, horizon || 240).sort(order);
    // المناسبات الكبرى القادمة خلال 90 يوماً تُحجز لها أماكن أولاً — التسعير يُقرَّر قبلها بأشهر
    const soonMajor = all.filter((e) => e.major && e.start > today && diffDays(today, e.start) <= MAJOR_LEAD_DAYS).slice(0, n);
    const rest = all.filter((e) => soonMajor.indexOf(e) === -1).slice(0, n - soonMajor.length);
    return soonMajor.concat(rest)
        .sort(order)   // العرض بترتيب زمني: الأقرب يميناً
        .map((e) => {
            const inDays = diffDays(today, e.start);
            const ongoing = inDays <= 0;
            const len = diffDays(e.start, e.end) + 1;
            const when = e.approx === true ? (ongoing ? 'جارٍ (متوقع)' : 'موعد متوقع')
                : ongoing ? `جارٍ حتى ${rangeLabel(e.end, e.end)}`
                : inDays === 1 ? 'غداً' : `بعد ${daysWord(inDays)}`;
            let avail = '';
            // التوفر للمناسبات القصيرة، وللكبرى مهما طالت (هي ما يُسعَّر له)
            if ((len <= 14 || e.major) && e.approx !== true) {
                const n = freeNights(e, rows, today);
                avail = n.free === 0 ? 'محجوزة ✓' : n.free === n.total ? 'متاحة' : `متاح ${n.free}/${n.total}`;
            }
            return {
                name: e.name, icon: e.icon, start: e.start, end: e.end,
                label: e.approx === true ? MONTHS[Number(e.start.slice(5, 7)) - 1] + ' (لم يُعلن)' : rangeLabel(e.start, e.end),
                inDays, ongoing, approx: !!e.approx, major: !!e.major, when, avail,
            };
        });
}

module.exports = { upcomingEvents, allEvents, rangeLabel, freeNights };
