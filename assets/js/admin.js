/* ==========================================================================
   لوحة تحكم إدارة العقارات
   البيانات محفوظة محلياً (localStorage) — لا تحتاج خادماً
   ========================================================================== */
(function () {
    'use strict';

    const STORE_KEY = 'rhsa_admin_v3';
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

    /* ---------------------------------------------------------------------
       0. بوابة الدخول — مصادقة حقيقية عبر Supabase Auth
       رمز الدخول هو كلمة سر حساب المالك الفعلي؛ الدخول ينشئ جلسة حقيقية
       (JWT) تمنح صلاحية القراءة والكتابة على الرسائل بحكم سياسات RLS
       (role = authenticated)، وليست مجرد إخفاء واجهة كما كانت سابقاً.

       البصمة والرمز الاحتياطي يحرسان الواجهة فقط ولا يمنحان صلاحية بيانات؛
       لذلك لا يفتحان اللوحة إلا مع وجود جلسة Supabase صالحة، وإلا رُفضت كل
       عمليات القراءة والكتابة من RLS وظهرت اللوحة فارغة دون تفسير.
       --------------------------------------------------------------------- */
    const OWNER_EMAIL = 'muhammedalrubaish@gmail.com';

    /* جلسة Supabase المحفوظة إن وُجدت — تُجدَّد تلقائياً إذا انتهت صلاحيتها */
    async function supabaseSession() {
        const client = window.getSupabaseClient ? window.getSupabaseClient() : null;
        if (!client) return null;

        try {
            const { data, error } = await client.auth.getSession();
            if (error || !data || !data.session) return null;

            const now = Math.floor(Date.now() / 1000);
            if (data.session.expires_at && data.session.expires_at <= now) {
                const { data: fresh } = await client.auth.refreshSession();
                return (fresh && fresh.session) || null;
            }
            return data.session;
        } catch (e) {
            console.warn('[gate] تعذّر قراءة جلسة Supabase:', e);
            return null;
        }
    }

    function unlock() {
        const lock = document.getElementById('lock');
        const app = document.getElementById('app');
        if (lock) lock.remove();
        if (app) app.hidden = false;
        if (window.OwnerGate) window.OwnerGate.markUnlocked();
        start();
        maybeOfferBiometric();
    }

    function maybeOfferBiometric() {
        const gate = window.OwnerGate;
        if (!gate || !gate.hasBiometricSupport() || gate.hasRegisteredBiometric()) return;
        setTimeout(async () => {
            if (!confirm('هل تريد تفعيل الدخول بالبصمة/الوجه على هذا الجهاز لتسجيل دخول أسرع؟')) return;
            const ok = await gate.registerBiometric();
            toast(ok ? 'تم تفعيل الدخول بالبصمة' : 'تعذّر تفعيل البصمة على هذا الجهاز', !ok);
        }, 600);
    }

    async function initGate() {
        const form = document.getElementById('lock-form');
        const input = document.getElementById('lock-pass');
        const err = document.getElementById('lock-err');
        const bioBtn = document.getElementById('lock-biometric');
        const gate = window.OwnerGate;
        const client = window.getSupabaseClient ? window.getSupabaseClient() : null;

        if (!form) return unlock();                       // لا توجد بوابة

        // جلسة قاعدة البيانات هي مصدر الصلاحية الوحيد؛ البصمة والجلسة الموحّدة
        // تحرسان الواجهة فوقها ولا تحلّان محلّها.
        const hasDbSession = !!(await supabaseSession());

        if (hasDbSession) {
            // القفل المحلي سليم، أو لا بصمة مسجّلة على الجهاز → دخول مباشر
            if (!gate || gate.isSessionValid() || !gate.hasRegisteredBiometric()) return unlock();

            // انتهى القفل المحلي (12 ساعة) والبصمة مسجّلة → يكفي التحقق بالبصمة
            if (bioBtn && gate.hasBiometricSupport()) {
                bioBtn.hidden = false;
                bioBtn.addEventListener('click', async () => {
                    bioBtn.disabled = true;
                    bioBtn.textContent = 'جارٍ التحقق بالبصمة…';
                    const ok = await gate.tryBiometric();
                    bioBtn.disabled = false;
                    bioBtn.textContent = '🫆 الدخول بالبصمة';
                    if (ok) return unlock();
                    err.textContent = 'تعذّر التحقق بالبصمة — استخدم رمز الدخول';
                });
            }
        } else if (gate) {
            // لا جلسة بيانات: لا نفتح اللوحة مهما كان القفل المحلي، لأنها ستظهر
            // فارغة ويفشل كل حفظ. الجلسة الموحّدة تُترك كما هي لأنها مشتركة مع
            // صفحة التحصيل التي تعمل محلياً بلا قاعدة بيانات.
            if (gate.isSessionValid() || gate.hasRegisteredBiometric()) {
                err.textContent = 'انتهت جلسة قاعدة البيانات — أدخل رمز المالك مرة واحدة لتجديدها، وتعود البصمة للعمل بعدها';
            }
        }

        input.focus();
        let tries = 0;

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            // الرمز الاحتياطي يرفع القفل المحلي فقط؛ لا يفتح اللوحة إلا إذا كانت
            // جلسة قاعدة البيانات قائمة أصلاً، وإلا فتحنا لوحة لا تقرأ ولا تحفظ.
            if (gate && gate.isFallbackPassword(input.value)) {
                if (await supabaseSession()) return unlock();
                err.textContent = 'الرمز الاحتياطي يفتح الواجهة فقط — أدخل رمز المالك الحقيقي لتفعيل قراءة البيانات وحفظها';
                input.value = '';
                input.focus();
                return;
            }

            if (!client) {
                err.textContent = 'تعذّر الاتصال بالخادم — تحقق من الإنترنت';
                return;
            }

            const btn = form.querySelector('button');
            btn.disabled = true;
            btn.textContent = 'جارٍ التحقق…';

            const { error } = await client.auth.signInWithPassword({
                email: OWNER_EMAIL,
                password: input.value.trim(),
            });

            btn.disabled = false;
            btn.textContent = 'دخول';

            if (!error) return unlock();

            if (error.status === 0 || error.name === 'AuthRetryableFetchError') {
                err.textContent = 'تعذّر الاتصال بالخادم — تحقق من الإنترنت وحاول مجدداً';
                input.focus();
                return;
            }

            tries++;
            err.textContent = tries >= 3 ? 'رمز غير صحيح — تأكد من الرمز' : 'رمز غير صحيح';
            input.value = '';
            input.focus();
        });
    }

    /* ---------------------------------------------------------------------
       1. أدوات مساعدة
       --------------------------------------------------------------------- */
    const uid = () => Math.random().toString(36).slice(2, 10);
    const todayISO = () => new Date().toISOString().slice(0, 10);
    const iso = (d) => d.toISOString().slice(0, 10);

    function addDays(dateStr, n) {
        const d = new Date(dateStr + 'T00:00:00');
        d.setDate(d.getDate() + n);
        return iso(d);
    }

    function nightsBetween(a, b) {
        return Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    const CURRENCIES = { SAR: 'ر.س', USD: '$', AED: 'د.إ' };

    /* ثوابت التشغيل — منقولة من لوحة تحصيل الديون (collection.html)
       ملاحظة: النظافة والكهرباء والإنترنت لم تبقَ ثوابت — أصبحت تقديرات قابلة للتعديل
       في state.rates (انظر DEFAULT_RATES أدناه)، والقيمة الفعلية تُقرأ من جدول المصاريف. */
    const RATES = {
        nightly: 294,        // سعر الليلة المرجعي
    };

    /* عمولة كل منصة على حدة — قابلة للتعديل من الإعدادات.
       المعادلة لكل ليلة: ثابت + (نسبة% × سعر الليلة)، بحد أقصى إن وُجد (0 = بلا حد).
       القيم الأولية هي معادلة النظام السابقة نفسها حتى لا تتغيّر أرقام قديمة تلقائياً. */
    const FEE_PLATFORMS = ['gathern', 'airbnb', 'direct'];
    const DEFAULT_FEES = {
        gathern: { base: 14.38, rate: 6.92, cap: 50 },
        airbnb: { base: 14.38, rate: 6.92, cap: 50 },
        direct: { base: 0, rate: 0, cap: 0 },
    };

    function feeConf(source) {
        const f = (state.fees && state.fees[source]) || DEFAULT_FEES[source];
        return f || { base: 0, rate: 0, cap: 0 };
    }

    /* تقديرات المصاريف المتغيّرة — تُستخدم فقط حين لا يوجد مصروف مسجَّل للشهر الحالي.
       - الإنترنت: إجمالي الفاتورة ÷ عدد المشاركين (يتغيّر بانسحاب أو انضمام أحدهم).
       - الكهرباء: يتغيّر حسب الإشغال، فالرقم هنا تقدير متوسط فقط.
       - النظافة: يتغيّر حسب عدد الزيارات (أول شهر أقل عادةً). */
    const DEFAULT_RATES = {
        cleaning: 500,          // تقدير النظافة شهرياً
        power: 130,             // تقدير الكهرباء شهرياً
        internetTotal: 210,     // إجمالي فاتورة الإنترنت للمجموعة
        internetShares: 4,      // عدد المشاركين في الفاتورة
    };

    /* حصتي من الإنترنت = الإجمالي ÷ عدد المشاركين */
    function internetShare() {
        const r = state.rates || DEFAULT_RATES;
        const shares = Math.max(1, Number(r.internetShares) || 1);
        return (Number(r.internetTotal) || 0) / shares;
    }

    /* عمولة المنصة عن الليلة الواحدة — حسب إعدادات المنصة المطلوبة */
    function platformFee(nightPrice, source) {
        if (nightPrice <= 0) return 0;
        const f = feeConf(source || 'gathern');
        const raw = (Number(f.base) || 0) + ((Number(f.rate) || 0) / 100) * nightPrice;
        const cap = Number(f.cap) || 0;
        return cap > 0 ? Math.min(raw, cap) : raw;   // حد أقصى صفر = بلا حد
    }

    /* عمولة حجز كامل */
    function bookingFee(total, nights, source) {
        if (!nights || total <= 0) return 0;
        return round2(platformFee(total / nights, source) * nights);
    }

    /* العمولة المتوقعة لحجز بإعدادات منصته — اقتراح فقط.
       العمولة الفعلية المحفوظة هي b.commission (انظر bookingCommissionAmount). */
    function bookingCommission(b) {
        if (!b || b.status === 'cancelled' || b.status === 'blocked') return 0;
        if (FEE_PLATFORMS.indexOf(b.source) === -1) return 0;
        return bookingFee(Number(b.total) || 0, nightsBetween(b.checkin, b.checkout), b.source);
    }

    /* بنود المصاريف المعتمدة */
    const EXPENSE_CATEGORIES = ['تنظيف', 'كهرباء', 'إنترنت', 'عمولة منصات'];

    /* تقريب لأقرب هللة — يمنع تراكم أخطاء الفاصلة العائمة (0.1+0.2) */
    function round2(n) {
        return Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
    }

    /* عرض المبلغ بالهللات عند وجودها، وبلا كسور صفرية حين يكون صحيحاً */
    function money(n) {
        const cur = CURRENCIES[state.settings.currency] || 'ر.س';
        const v = round2(n).toLocaleString(state.settings.lang === 'ar' ? 'ar-EG' : 'en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
        });
        return `${v} ${cur}`;
    }

    function fmtDate(dstr) {
        if (!dstr) return '—';
        const d = new Date(dstr + 'T00:00:00');
        const locale = state.settings.lang === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-GB';
        return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function hijri(dstr) {
        try {
            return new Date(dstr + 'T00:00:00').toLocaleDateString('ar-SA-u-ca-islamic', {
                day: 'numeric', month: 'long',
            });
        } catch (e) { return ''; }
    }

    function relTime(tsIso) {
        const diff = (Date.now() - new Date(tsIso)) / 1000;
        if (diff < 60) return 'الآن';
        if (diff < 3600) return `قبل ${Math.floor(diff / 60)} د`;
        if (diff < 86400) return `قبل ${Math.floor(diff / 3600)} س`;
        if (diff < 604800) return `قبل ${Math.floor(diff / 86400)} ي`;
        return fmtDate(tsIso.slice(0, 10));
    }

    function toast(msg, isErr) {
        const el = document.createElement('div');
        el.className = 'toast' + (isErr ? ' err' : '');
        el.textContent = msg;
        $('#toast-zone').appendChild(el);
        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transition = 'opacity .3s';
            setTimeout(() => el.remove(), 300);
        }, 3200);
    }

    function download(filename, content, type) {
        const blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    /* ---------------------------------------------------------------------
       2. البيانات الأولية
       --------------------------------------------------------------------- */
    function seed() {
        const properties = [
            {
                id: 'p1', name: 'شقة السليمانية — RHSA7905', city: 'الرياض', district: 'حي السليمانية',
                address: '7905 عبدالحميد الكاتب، السليمانية، الرياض 12245',
                rooms: 1, beds: 1, baths: 1, area: 68, floor: 'الأرضي',
                nightly: 294, status: 'active', img: 'assets/images/living.jpg',
                platforms: ['جاذر إن', 'Airbnb'], license: '50034291',
            },
        ];

        // الحجوزات لم تعد بيانات تجريبية — تُحمَّل من جدول bookings في Supabase (انظر loadBookings)
        const bookings = [];

        // المصاريف لم تعد بيانات تجريبية — تُحمَّل من جدول expenses في Supabase (انظر loadExpenses)
        const expenses = [];

        // جهات الاتصال لم تعد بيانات تجريبية — تُحمَّل من جدول contacts في Supabase (انظر loadContacts)
        const contacts = [];

        // الإشعارات التجريبية أُزيلت — تبدأ فارغة وتتولّد فعلياً من أحداث حقيقية (حجز، رسالة...)
        const notifications = [];

        return {
            settings: {
                lang: 'ar', theme: 'light', currency: 'SAR', hijri: false,
                notifBooking: true, notifBills: true, notifMessages: true, notifCheckout: false,
            },
            rates: Object.assign({}, DEFAULT_RATES),
            /* أرقام جهات اتصال حذفها المالك عمداً — تمنع مزامنة محادثات
               الموقع من إعادة إنشائها عند كل تحميل للصفحة */
            dismissedChatPhones: [],
            fees: JSON.parse(JSON.stringify(DEFAULT_FEES)),
            syncFeeds: [
                { id: uid(), name: 'جاذر إن (Gathern)', url: '', lastSync: '' },
                { id: uid(), name: 'Airbnb', url: '', lastSync: '' },
            ],
            properties, bookings, expenses, contacts, notifications,
        };
    }

    /* ---------------------------------------------------------------------
       3. الحالة والتخزين
       --------------------------------------------------------------------- */
    let state = load();
    let calCursor = new Date();
    let notifFilter = 'all';
    let contactFilter = 'all';   // all | guests | ops
    let chartMonths = 6;
    let yearRange = { preset: 'this-year', from: '', to: '' };   // this-year | last-year | 12m | custom
    let upcomingMode = 'next';   // next | past
    let billsExpanded = false;

    function load() {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.settings) {
                    // ترقية النسخ القديمة: أضيفت تقديرات المصاريف المتغيّرة لاحقاً
                    parsed.rates = Object.assign({}, DEFAULT_RATES, parsed.rates || {});
                    parsed.dismissedChatPhones = parsed.dismissedChatPhones || [];
                    // ترقية: عمولة كل منصة على حدة أُضيفت لاحقاً
                    parsed.fees = parsed.fees || {};
                    FEE_PLATFORMS.forEach((k) => {
                        parsed.fees[k] = Object.assign({}, DEFAULT_FEES[k], parsed.fees[k] || {});
                    });
                    return parsed;
                }
            }
        } catch (e) { /* بيانات تالفة — نبدأ من جديد */ }
        return seed();
    }

    function save() {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(state));
        } catch (e) {
            toast('تعذّر حفظ البيانات محلياً', true);
        }
    }

    /* ---------------------------------------------------------------------
       4. الحسابات المالية والتشغيلية
       --------------------------------------------------------------------- */
    function realBookings() {
        return state.bookings.filter((b) => b.status !== 'blocked' && b.status !== 'cancelled');
    }

    function inMonth(dstr, y, m) {
        const d = new Date(dstr + 'T00:00:00');
        return d.getFullYear() === y && d.getMonth() === m;
    }

    /* عمولة الحجز المسجَّلة — المنصة تحجزها من الإجمالي فلا تُعدّ فاتورة */
    function bookingCommissionAmount(b) {
        return Number(b.commission) || 0;
    }

    /* الإيراد الصافي للحجز = الإجمالي − عمولة المنصة */
    function bookingNet(b) {
        return (Number(b.total) || 0) - bookingCommissionAmount(b);
    }

    /* إيراد الشهر بعد خصم عمولات المنصات — هو ما يصل حساب المالك فعلاً */
    function monthRevenue(y, m) {
        return realBookings()
            .filter((b) => inMonth(b.checkin, y, m))
            .reduce((s, b) => s + bookingNet(b), 0);
    }

    /* الإجمالي قبل العمولة — للعرض والمقارنة */
    function monthGross(y, m) {
        return realBookings()
            .filter((b) => inMonth(b.checkin, y, m))
            .reduce((s, b) => s + (Number(b.total) || 0), 0);
    }

    function monthCommission(y, m) {
        return realBookings()
            .filter((b) => inMonth(b.checkin, y, m))
            .reduce((s, b) => s + bookingCommissionAmount(b), 0);
    }

    function monthExpenses(y, m) {
        return state.expenses
            .filter((e) => inMonth(e.date, y, m))
            .reduce((s, e) => s + (Number(e.amount) || 0), 0);
    }

    /* ---------------------------------------------------------------------
       حصيلة نطاق تاريخي — أساس بطاقة «إيرادات السنة»
       --------------------------------------------------------------------- */

    /* تاريخ ISO من الوقت المحلي — iso() يعتمد UTC فيُنقص يوماً عند منتصف الليل المحلي */
    function localISO(d) {
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${mm}-${dd}`;
    }

    /* حدود النطاق المختار (تواريخ ISO شاملة الطرفين) */
    function yearRangeBounds() {
        const now = new Date();
        const y = now.getFullYear();

        if (yearRange.preset === 'last-year') {
            return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: `سنة ${y - 1}` };
        }
        if (yearRange.preset === '12m') {
            const start = new Date(y, now.getMonth() - 11, 1);
            return { from: localISO(start), to: localISO(now), label: 'آخر 12 شهراً' };
        }
        if (yearRange.preset === 'custom') {
            const from = yearRange.from || `${y}-01-01`;
            const to = yearRange.to || localISO(now);
            return { from, to, label: `${fmtDate(from)} ← ${fmtDate(to)}` };
        }
        return { from: `${y}-01-01`, to: `${y}-12-31`, label: `سنة ${y}` };
    }

    /* حصيلة النطاق: الإيرادات بتاريخ الوصول، والمصاريف بتاريخ المصروف.
       gross = ما دفعه الضيوف • fees = ما حجزته المنصات • revenue = ما وصلني */
    function rangeStats(from, to) {
        const bookings = realBookings().filter((b) => b.checkin >= from && b.checkin <= to);
        const gross = bookings.reduce((s, b) => s + (Number(b.total) || 0), 0);
        const fees = bookings.reduce((s, b) => s + bookingCommissionAmount(b), 0);
        const revenue = gross - fees;
        const nights = bookings.reduce((s, b) => s + nightsBetween(b.checkin, b.checkout), 0);

        const expenses = state.expenses.filter((e) => e.date >= from && e.date <= to);
        const expTotal = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

        return {
            gross, fees, revenue, nights,
            expenses: expTotal,
            net: revenue - expTotal,
            count: bookings.length,
            adr: nights ? round2(gross / nights) : 0,
            margin: gross ? Math.round(((revenue - expTotal) / gross) * 100) : 0,
            bookings,
        };
    }

    /* إجمالي بند مصروف واحد في شهر معيّن — الأساس في عرض القيمة الفعلية المتغيّرة */
    function monthCategoryTotal(category, y, m) {
        return state.expenses
            .filter((e) => e.category === category && inMonth(e.date, y, m))
            .reduce((s, e) => s + (Number(e.amount) || 0), 0);
    }

    function occupancyRate(days) {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - days);
        let booked = 0;
        realBookings().forEach((b) => {
            for (let d = new Date(b.checkin + 'T00:00:00'); d < new Date(b.checkout + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
                if (d >= start && d <= end) booked++;
            }
        });
        return Math.min(100, Math.round((booked / days) * 100));
    }

    function stats() {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        const rev = monthRevenue(y, m);
        const gross = monthGross(y, m);
        const commission = monthCommission(y, m);
        const exp = monthExpenses(y, m);
        const prevM = m === 0 ? 11 : m - 1;
        const prevY = m === 0 ? y - 1 : y;
        const prevRev = monthRevenue(prevY, prevM);

        const nights = realBookings()
            .filter((b) => inMonth(b.checkin, y, m))
            .reduce((s, b) => s + nightsBetween(b.checkin, b.checkout), 0);

        return {
            revenue: rev,          // بعد خصم عمولة المنصات
            gross,
            commission,
            expenses: exp,
            net: rev - exp,
            growth: prevRev ? Math.round(((rev - prevRev) / prevRev) * 100) : 0,
            occupancy: occupancyRate(30),
            nights,
            adr: nights ? round2(gross / nights) : 0,
            dueBills: state.expenses.filter((e) => e.status === 'due').reduce((s, e) => s + Number(e.amount || 0), 0),
            dueCount: state.expenses.filter((e) => e.status === 'due').length,
            upcoming: realBookings().filter((b) => b.checkin >= todayISO()).length,
        };
    }

    /* ---------------------------------------------------------------------
       5. التنقل بين الأقسام
       --------------------------------------------------------------------- */
    const PAGE_META = {
        dashboard: ['لوحة التحكم', 'نظرة شاملة على التشغيل والإيرادات والمصاريف'],
        calendar: ['التقويم', 'الحجوزات والمزامنة مع منصات الحجز'],
        messages: ['الرسائل', 'محادثات الزبائن من الموقع والمنصات'],
        properties: ['العقارات', 'الوحدات المُدارة وتفاصيلها'],
        contacts: ['جهات الاتصال', 'الزبائن من الموقع والإضافات اليدوية'],
        notifications: ['الإشعارات', 'الحجوزات والفواتير والتنبيهات'],
        settings: ['الإعدادات', 'اللغة والمظهر والتكاملات'],
    };

    function go(view) {
        $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
        $$('.rail-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
        const meta = PAGE_META[view] || ['', ''];
        $('#page-title').textContent = meta[0];
        $('#page-sub').textContent = meta[1];
        window.scrollTo({ top: 0, behavior: 'smooth' });
        location.hash = view;
        renderView(view);
    }

    function renderView(view) {
        ({
            dashboard: renderDashboard,
            calendar: renderCalendar,
            messages: renderMessages,
            properties: renderProperties,
            contacts: renderContacts,
            notifications: renderNotifications,
            settings: renderSettings,
        }[view] || (() => {}))();
    }

    /* ---------------------------------------------------------------------
       6. لوحة التحكم
       --------------------------------------------------------------------- */
    function renderDashboard() {
        const s = stats();

        // حصيلة السنة الميلادية الجارية — بالمعادلة نفسها: الإجمالي ناقص العمولة
        const yr = new Date().getFullYear();
        const year = rangeStats(`${yr}-01-01`, `${yr}-12-31`);

        const kpis = [
            { label: 'إيرادات الشهر', value: money(s.revenue), icon: '💰', color: 'var(--ok)', soft: 'var(--ok-soft)',
              foot: s.commission
                  ? `إجمالي ${money(s.gross)} − عمولة ${money(s.commission)}`
                  : `<span class="kpi-trend ${s.growth >= 0 ? 'up' : 'down'}">${s.growth >= 0 ? '▲' : '▼'} ${Math.abs(s.growth)}%</span> مقارنة بالشهر الماضي` },
            { label: `إيرادات السنة ${yr}`, value: money(year.revenue), icon: '📅', color: 'var(--ok)', soft: 'var(--ok-soft)',
              foot: year.fees
                  ? `إجمالي ${money(year.gross)} − عمولة ${money(year.fees)}`
                  : `${year.count} حجز • ${year.nights} ليلة منذ يناير` },
            { label: 'المصاريف التشغيلية', value: money(s.expenses), icon: '🧾', color: 'var(--brand)', soft: 'var(--brand-soft)',
              foot: `هذا الشهر • ${s.dueCount} فاتورة غير مسددة بقيمة ${money(s.dueBills)}` },
            // صافي الربح على مستوى السنة لا الشهر — الصورة الأشمل لأداء الوحدة
            { label: `صافي ربح السنة ${yr}`, value: money(year.net), icon: '📈', color: 'var(--info)', soft: 'var(--info-soft)',
              foot: `الواصل ${money(year.revenue)} − مصاريف ${money(year.expenses)} • هامش ${year.margin}%` },
            { label: 'نسبة الإشغال', value: s.occupancy + '<small>%</small>', icon: '🏠', color: 'var(--warn)', soft: 'var(--warn-soft)',
              foot: `${s.nights} ليلة مؤجَّرة • ${s.upcoming} حجز قادم` },
        ];

        $('#kpi-zone').innerHTML = kpis.map((k) => `
            <div class="kpi" style="--kpi-color:${k.color};--kpi-soft:${k.soft}">
                <div class="kpi-top">
                    <div class="kpi-icon">${k.icon}</div>
                    <div class="kpi-label">${k.label}</div>
                </div>
                <div class="kpi-value">${k.value}</div>
                <div class="kpi-foot">${k.foot}</div>
            </div>`).join('');

        renderYearRevenue();
        drawChart();
        renderExpenseBreakdown();
        renderUpcoming();
        renderBills();
        renderOps(s);
    }

    /* بطاقة إيرادات السنة — حصيلة النطاق المختار وتفصيل شهري */
    function renderYearRevenue() {
        const zone = $('#year-zone');
        if (!zone) return;

        const { from, to, label } = yearRangeBounds();
        const r = rangeStats(from, to);

        $$('#year-preset button').forEach((b) => b.classList.toggle('active', b.dataset.yr === yearRange.preset));
        $('#year-custom').hidden = yearRange.preset !== 'custom';
        $('#year-from').value = yearRange.from || from;
        $('#year-to').value = yearRange.to || to;
        $('#year-range-lbl').textContent = `${label} • ${fmtDate(from)} ← ${fmtDate(to)}`;

        const items = [
            { icon: '💵', label: 'إجمالي مبالغ الحجوزات', value: money(r.gross), note: `${r.count} حجز • ${r.nights} ليلة` },
            { icon: '🧾', label: 'عمولات المنصات', value: money(r.fees), note: r.gross ? `${Math.round((r.fees / r.gross) * 100)}% من الإجمالي — تحجزها المنصة` : 'تحجزها المنصة من الإجمالي' },
            { icon: '💰', label: 'الإيراد الواصل لي', value: money(r.revenue), note: 'الإجمالي بعد خصم العمولات' },
            { icon: '🧹', label: 'المصاريف التشغيلية', value: money(r.expenses), note: 'نظافة وكهرباء وإنترنت' },
            { icon: '📈', label: 'صافي الربح', value: money(r.net), note: `هامش ${r.margin}% من إجمالي الحجوزات` },
            { icon: '🛏️', label: 'متوسط سعر الليلة', value: money(r.adr), note: 'قبل خصم العمولة' },
        ];

        zone.innerHTML = items.map((i) => `
            <div class="list-item">
                <div class="li-icon">${i.icon}</div>
                <div class="li-body">
                    <h4>${i.label}</h4>
                    <p>${i.note}</p>
                </div>
                <div class="li-side"><b style="font-size:15px">${i.value}</b></div>
            </div>`).join('');

        renderYearMonths(from, to);
    }

    /* تفصيل شهري داخل النطاق — أشرطة نسبية لأعلى شهر */
    function renderYearMonths(from, to) {
        const box = $('#year-months');
        if (!box) return;

        const start = new Date(from + 'T00:00:00');
        const end = new Date(to + 'T00:00:00');
        const months = [];
        const cursor = new Date(start.getFullYear(), start.getMonth(), 1);

        // سقف 24 شهراً يحمي من نطاق مخصص طويل جداً
        while (cursor <= end && months.length < 24) {
            const y = cursor.getFullYear();
            const m = cursor.getMonth();
            months.push({
                label: cursor.toLocaleDateString('ar-SA-u-ca-gregory', { month: 'short', year: '2-digit' }),
                rev: monthRevenue(y, m),          // بعد خصم العمولة
                fee: monthCommission(y, m),
                exp: monthExpenses(y, m),
            });
            cursor.setMonth(cursor.getMonth() + 1);
        }

        const active = months.filter((x) => x.rev > 0 || x.exp > 0 || x.fee > 0);
        if (!active.length) {
            box.innerHTML = emptyBox('📊', 'لا حركة في هذا النطاق', 'اختر نطاقاً آخر أو أضف حجوزات');
            return;
        }

        const max = Math.max.apply(null, active.map((x) => x.rev));

        box.innerHTML = `<h4 style="font-size:13px;margin:0 0 10px;color:var(--text-dim)">التفصيل الشهري</h4>`
            + active.map((x) => `
            <div class="bar-row">
                <div class="bar-top">
                    <span>${x.label}</span>
                    <span class="amt">${money(x.rev)} <span style="color:var(--muted);font-weight:500">${x.fee ? `(بعد عمولة ${money(x.fee)}) ` : ''}− ${money(x.exp)} = ${money(x.rev - x.exp)}</span></span>
                </div>
                <div class="bar-track">
                    <div class="bar-fill" style="width:${max ? (x.rev / max) * 100 : 0}%;background:var(--ok)"></div>
                </div>
            </div>`).join('');
    }

    function drawChart() {
        const svg = $('#chart-cashflow');
        const W = 700, H = 230, pad = { t: 16, r: 12, b: 30, l: 52 };
        const now = new Date();
        const data = [];

        for (let i = chartMonths - 1; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            data.push({
                label: d.toLocaleDateString('ar-SA-u-ca-gregory', { month: 'short' }),
                rev: monthRevenue(d.getFullYear(), d.getMonth()),
                exp: monthExpenses(d.getFullYear(), d.getMonth()),
            });
        }

        const max = Math.max(1000, ...data.map((d) => Math.max(d.rev, d.exp))) * 1.15;
        const innerW = W - pad.l - pad.r;
        const innerH = H - pad.t - pad.b;
        const slot = innerW / data.length;
        const bw = Math.min(20, slot / 3.2);
        const yOf = (v) => pad.t + innerH - (v / max) * innerH;

        let out = '';

        // خطوط الشبكة
        for (let i = 0; i <= 4; i++) {
            const y = pad.t + (innerH / 4) * i;
            const val = Math.round((max / 4) * (4 - i));
            out += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="var(--line)" stroke-width="1"/>`;
            out += `<text x="${pad.l - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--muted)" font-weight="600">${val >= 1000 ? (val / 1000).toFixed(0) + 'k' : val}</text>`;
        }

        // الأعمدة
        data.forEach((d, i) => {
            const cx = pad.l + slot * i + slot / 2;
            const hRev = Math.max(2, innerH - (yOf(d.rev) - pad.t));
            const hExp = Math.max(2, innerH - (yOf(d.exp) - pad.t));
            out += `<rect x="${cx - bw - 2}" y="${yOf(d.rev)}" width="${bw}" height="${hRev}" rx="4" fill="var(--ok)"><title>الإيراد: ${d.rev}</title></rect>`;
            out += `<rect x="${cx + 2}" y="${yOf(d.exp)}" width="${bw}" height="${hExp}" rx="4" fill="var(--brand)"><title>المصاريف: ${d.exp}</title></rect>`;
            out += `<text x="${cx}" y="${H - 10}" text-anchor="middle" font-size="10.5" fill="var(--muted)" font-weight="700">${escapeHtml(d.label)}</text>`;
        });

        // خط صافي الربح
        const pts = data.map((d, i) => `${pad.l + slot * i + slot / 2},${yOf(Math.max(0, d.rev - d.exp))}`).join(' ');
        out += `<polyline points="${pts}" fill="none" stroke="var(--info)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
        data.forEach((d, i) => {
            out += `<circle cx="${pad.l + slot * i + slot / 2}" cy="${yOf(Math.max(0, d.rev - d.exp))}" r="3.5" fill="var(--surface)" stroke="var(--info)" stroke-width="2"/>`;
        });

        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.innerHTML = out;
    }

    function renderExpenseBreakdown() {
        const now = new Date();
        const byCat = {};
        state.expenses.forEach((e) => {
            byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount || 0);
        });

        const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
        const total = entries.reduce((s, e) => s + e[1], 0);
        const colors = ['var(--brand)', 'var(--info)', 'var(--warn)', 'var(--ok)', 'var(--danger)', 'var(--muted)'];

        $('#exp-total-lbl').textContent = 'الإجمالي ' + money(total);

        if (!entries.length) {
            $('#exp-breakdown').innerHTML = emptyBox('🧾', 'لا توجد مصاريف', 'أضف أول مصروف تشغيلي لتتبع التكاليف');
            return;
        }

        $('#exp-breakdown').innerHTML = entries.map(([cat, amt], i) => `
            <div class="bar-row">
                <div class="bar-top">
                    <span>${escapeHtml(cat)}</span>
                    <span class="amt">${money(amt)}</span>
                </div>
                <div class="bar-track">
                    <div class="bar-fill" style="width:${total ? (amt / total) * 100 : 0}%;background:${colors[i % colors.length]}"></div>
                </div>
            </div>`).join('');
    }

    const SOURCE_LABEL = {
        direct: 'الموقع المباشر', gathern: 'جاذر إن', airbnb: 'Airbnb', ical: 'مزامنة iCal',
        block: 'حجب', manual: 'إضافة يدوية', site_chat: 'محادثة الموقع',
        // أدوار تشغيلية — جهات اتصال إدارة الإشغال لا زبائن
        cleaning_lead: 'مسؤول النظافة', cleaning_staff: 'موظف نظافة', cleaning_company: 'شركة النظافة',
        building_office: 'مكتب العمارة', building_worker: 'مسؤول المبنى', host: 'مضيف بالعمارة',
    };

    /* جهات الاتصال التشغيلية — أدوار إدارة الإشغال والصيانة داخل العمارة */
    const OPS_SOURCES = ['cleaning_lead', 'cleaning_staff', 'cleaning_company', 'building_office', 'building_worker', 'host'];
    const OPS_ICON = {
        cleaning_lead: '🧹', cleaning_staff: '🧽', cleaning_company: '🏬',
        building_office: '🏢', building_worker: '🛠️', host: '🤝',
    };

    function isOpsContact(c) {
        return OPS_SOURCES.indexOf(c.source) !== -1;
    }

    /* جهات الاتصال التشغيلية المعروفة — تُدخل بضغطة واحدة من صفحة جهات الاتصال.
       المضيفون الثلاثة + المالك = ٤ مشاركين في فاتورة الإنترنت (٢١٠ ÷ ٤). */
    const OPS_SEED = [
        { name: 'شركة ديار رؤي العقارية', phone: '0535397764', source: 'building_office', note: 'مكتب إدارة العمارة' },
        { name: 'إقبال حسين', phone: '0578068823', source: 'building_worker', note: 'مسؤول المبنى' },
        { name: 'بسمتك', phone: '0536461956', source: 'cleaning_lead', note: 'مسؤول النظافة' },
        { name: 'مدير شركة النظافة', phone: '0545777919', source: 'cleaning_company', note: 'إدارة شركة النظافة' },
        { name: 'عبدالرحمن السلطان', phone: '', source: 'host', note: 'شقة A4 — مشارك في فاتورة الإنترنت' },
        { name: 'عايض الشمري', phone: '', source: 'host', note: 'شقة A1 وشقة B28 في مبنى B — مشارك في فاتورة الإنترنت' },
        { name: 'عبدالمجيد', phone: '0567559595', source: 'host', note: 'شقة A7 — مشارك في فاتورة الإنترنت' },
    ];

    const STATUS_TAG = {
        confirmed: ['tag-ok', 'مؤكد'],
        pending: ['tag-warn', 'بانتظار التأكيد'],
        completed: ['tag-mute', 'منتهٍ'],
        blocked: ['tag-info', 'محجوب'],
        cancelled: ['tag-danger', 'ملغي'],
    };

    function renderUpcoming() {
        const past = upcomingMode === 'past';
        const today = todayISO();

        // «سابقة» تعرض الأحدث أولاً ليصل المالك لآخر حجز منتهٍ بسرعة
        const rows = realBookings()
            .filter((b) => (past ? b.checkout < today : b.checkout >= today))
            .sort((a, b) => (past ? b.checkin.localeCompare(a.checkin) : a.checkin.localeCompare(b.checkin)))
            .slice(0, past ? 10 : 6);

        $('#upcoming-title').textContent = past ? 'الحجوزات السابقة' : 'الحجوزات القادمة';
        $$('#upcoming-mode button').forEach((b) => b.classList.toggle('active', b.dataset.um === upcomingMode));

        if (!rows.length) {
            const empty = past
                ? emptyBox('🗂️', 'لا حجوزات سابقة', 'ستظهر هنا الحجوزات بعد انتهاء مدتها')
                : emptyBox('📅', 'لا حجوزات قادمة', 'ستظهر هنا فور وصول حجز جديد');
            $('#tbl-upcoming').innerHTML = `<tr><td colspan="7">${empty}</td></tr>`;
            return;
        }

        $('#tbl-upcoming').innerHTML = rows.map((b) => {
            const tag = STATUS_TAG[b.status] || ['tag-mute', b.status];
            return `<tr>
                <td>${escapeHtml(b.guest)}</td>
                <td class="num dim">${fmtDate(b.checkin)}</td>
                <td class="num">${nightsBetween(b.checkin, b.checkout)}</td>
                <td class="dim">${SOURCE_LABEL[b.source] || b.source}</td>
                <td class="num">${money(b.total)}${bookingCommissionAmount(b) ? `<br><span style="font-size:10.5px;color:var(--muted);font-weight:600">الواصل ${money(bookingNet(b))}</span>` : ''}</td>
                <td><span class="tag ${tag[0]}">${tag[1]}</span></td>
                <td><button class="btn btn-ghost btn-sm" data-edit-booking="${b.id}">تعديل</button></td>
            </tr>`;
        }).join('');

        // التعديل من اللوحة مباشرة دون المرور بالتقويم
        $$('[data-edit-booking]', $('#tbl-upcoming')).forEach((btn) => {
            btn.addEventListener('click', () => {
                const b = state.bookings.find((x) => x.id === btn.dataset.editBooking);
                if (b) openBookingForm(null, b);
            });
        });
    }

    const BILLS_PREVIEW = 7;

    function renderBills() {
        const sorted = state.expenses.slice().sort((a, b) => {
            if (a.status !== b.status) return a.status === 'due' ? -1 : 1;
            return (a.dueDate || '').localeCompare(b.dueDate || '');
        });

        // زر «عرض الكل» حتى تبقى كل المصاريف قابلة للتعديل والحذف لا أول سبعة فقط
        const allBtn = $('#btn-bills-all');
        if (allBtn) {
            allBtn.hidden = sorted.length <= BILLS_PREVIEW;
            allBtn.textContent = billsExpanded ? 'عرض أقل' : `عرض الكل (${sorted.length})`;
        }

        const rows = billsExpanded ? sorted : sorted.slice(0, BILLS_PREVIEW);

        if (!rows.length) {
            $('#tbl-bills').innerHTML = `<tr><td colspan="5">${emptyBox('🧾', 'لا فواتير', 'أضف مصروفاً لتتبعه')}</td></tr>`;
            return;
        }

        const today = todayISO();
        $('#tbl-bills').innerHTML = rows.map((e) => {
            const overdue = e.status === 'due' && e.dueDate && e.dueDate < today;
            const tag = e.status === 'paid'
                ? '<span class="tag tag-ok">مسدد</span>'
                : (overdue ? '<span class="tag tag-danger">متأخر</span>' : '<span class="tag tag-warn">مستحق</span>');
            return `<tr>
                <td>${escapeHtml(e.category)}${e.note ? `<br><span style="font-size:11px;color:var(--muted);font-weight:500">${escapeHtml(e.note)}</span>` : ''}</td>
                <td class="num dim">${fmtDate(e.dueDate || e.date)}</td>
                <td class="num">${money(e.amount)}</td>
                <td>${tag}</td>
                <td>
                    <div style="display:flex;gap:6px;justify-content:flex-end">
                        ${e.status === 'due' ? `<button class="btn btn-ghost btn-sm" data-pay="${e.id}">تسديد</button>` : ''}
                        <button class="btn btn-ghost btn-sm" data-edit-exp="${e.id}" title="تعديل أو حذف">تعديل</button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        $$('[data-pay]', $('#tbl-bills')).forEach((btn) => {
            btn.addEventListener('click', async () => {
                const e = state.expenses.find((x) => x.id === btn.dataset.pay);
                if (!e) return;

                btn.disabled = true;
                const updated = await updateExpense(e.id, Object.assign({}, e, { status: 'paid' }));
                btn.disabled = false;
                if (!updated) return;

                Object.assign(e, updated);
                pushNotification('bill', 'تم تسديد فاتورة', `${e.category} — ${money(e.amount)}`);
                save();
                renderDashboard();
                toast('تم تعليم الفاتورة كمسددة');
            });
        });

        $$('[data-edit-exp]', $('#tbl-bills')).forEach((btn) => {
            btn.addEventListener('click', () => {
                const e = state.expenses.find((x) => x.id === btn.dataset.editExp);
                if (e) openExpenseForm(e);
            });
        });
    }

    function renderOps(s) {
        const cleaningDue = realBookings().filter((b) => b.checkout >= todayISO()).length;
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        const r = state.rates || DEFAULT_RATES;

        /* البنود المتغيّرة: القيمة الفعلية المسجَّلة لهذا الشهر تسبق التقدير دائماً.
           فإن لم تُسجَّل فاتورة الشهر بعد نعرض التقدير موسوماً بأنه تقديري. */
        const actualCleaning = monthCategoryTotal('تنظيف', y, m);
        const actualPower = monthCategoryTotal('كهرباء', y, m);
        const actualInternet = monthCategoryTotal('إنترنت', y, m);
        const shares = Math.max(1, Number(r.internetShares) || 1);

        const items = [
            { icon: '🛏️', label: 'متوسط سعر الليلة', value: money(s.adr), note: 'محسوب من حجوزات الشهر' },
            {
                icon: '🧹', label: 'النظافة',
                value: money(actualCleaning || r.cleaning),
                note: actualCleaning
                    ? `فعلي هذا الشهر • ${cleaningDue} زيارة قادمة`
                    : `تقديري — لم تُسجَّل بعد • ${cleaningDue} زيارة قادمة`,
            },
            {
                icon: '⚡', label: 'الكهرباء',
                value: money(actualPower || r.power),
                note: actualPower
                    ? 'فعلي هذا الشهر — يتغيّر حسب الإشغال'
                    : `تقديري — يتغيّر حسب الإشغال (متوسط ${round2(r.power)})`,
            },
            {
                icon: '📶', label: 'الإنترنت',
                value: money(actualInternet || internetShare()),
                note: actualInternet
                    ? `فعلي هذا الشهر • حصتي من ${shares} مشاركين`
                    : `حصتي = ${round2(r.internetTotal)} ÷ ${shares} مشاركين`,
            },
            { icon: '🧾', label: 'عمولة المنصات', value: money(monthCommission(y, m)), note: 'محجوزة من إجمالي حجوزات هذا الشهر' },
            { icon: '🔑', label: 'الوحدات النشطة', value: state.properties.filter((p) => p.status === 'active').length, note: 'من أصل ' + state.properties.length },
            // الزبائن فقط — جهات الاتصال التشغيلية (نظافة، مكتب العمارة، مضيفون) لا تُحسب زبائن
            { icon: '👥', label: 'إجمالي الزبائن', value: state.contacts.filter((c) => !isOpsContact(c)).length, note: 'من الموقع والمنصات' },
            { icon: '🧹', label: 'جهات الاتصال التشغيلية', value: state.contacts.filter(isOpsContact).length, note: 'نظافة • مكتب العمارة • عامل • مضيفون' },
        ];

        $('#ops-zone').innerHTML = items.map((i) => `
            <div class="list-item">
                <div class="li-icon">${i.icon}</div>
                <div class="li-body">
                    <h4>${i.label}</h4>
                    <p>${i.note}</p>
                </div>
                <div class="li-side"><b style="font-size:15px">${i.value}</b></div>
            </div>`).join('');
    }

    function emptyBox(ic, title, text) {
        return `<div class="empty"><div class="ic">${ic}</div><h4>${escapeHtml(title)}</h4><p>${escapeHtml(text)}</p></div>`;
    }

    /* ---------------------------------------------------------------------
       7. التقويم
       --------------------------------------------------------------------- */
    const DOWS = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];

    function bookingOn(dayIso) {
        return state.bookings.find((b) => dayIso >= b.checkin && dayIso < b.checkout && b.status !== 'cancelled');
    }

    function renderCalendar() {
        $('#cal-dows').innerHTML = DOWS.map((d) => `<div class="cal-dow">${d}</div>`).join('');

        const y = calCursor.getFullYear();
        const m = calCursor.getMonth();
        const first = new Date(y, m, 1);
        const daysInMonth = new Date(y, m + 1, 0).getDate();
        const lead = first.getDay();
        const today = todayISO();

        $('#cal-month').textContent = first.toLocaleDateString('ar-SA-u-ca-gregory', { month: 'long', year: 'numeric' });

        let html = '';
        for (let i = 0; i < lead; i++) html += '<div class="cal-day empty"></div>';

        for (let d = 1; d <= daysInMonth; d++) {
            const dayIso = iso(new Date(y, m, d));
            const b = bookingOn(dayIso);
            const cls = ['cal-day'];
            if (dayIso < today) cls.push('past');
            if (dayIso === today) cls.push('today');
            if (b) cls.push(b.status === 'blocked' ? 'blocked' : 'booked');

            let pill = '';
            if (b) {
                const pcls = [b.status === 'blocked' ? 'block' : (b.source === 'direct' ? '' : 'ext')];

                /* شريط الحجز يُوصَل عبر الأيام المتتالية: يمتد نحو اليوم السابق
                   واللاحق ما داما ضمن الحجز نفسه وضمن صف الأسبوع ذاته.
                   col = عمود اليوم في الصف (0 = أول يوم في الأسبوع). */
                const col = (lead + d - 1) % 7;
                const prev = bookingOn(addDays(dayIso, -1));
                const next = bookingOn(addDays(dayIso, 1));
                const contPrev = !!prev && prev.id === b.id;
                const contNext = !!next && next.id === b.id;

                // لا يمتد الشريط خارج شبكة الشهر ولو كان الحجز عابراً لحدّ الشهر
                if (contPrev && col > 0 && d > 1) pcls.push('cont-start');
                if (contNext && col < 6 && d < daysInMonth) pcls.push('cont-end');

                // الاسم يُكتب مرة واحدة: عند بداية الحجز أو بداية صف أسبوع أو بداية الشهر
                const label = (!contPrev || col === 0 || d === 1) ? escapeHtml(b.guest) : '';
                pill = `<span class="cal-pill ${pcls.join(' ')}" title="${escapeHtml(b.guest)}">${label}</span>`;
            }

            const hj = state.settings.hijri ? `<span style="font-size:9px;color:var(--muted)">${hijri(dayIso)}</span>` : '';
            html += `<button class="${cls.join(' ')}" data-day="${dayIso}">
                        <span class="d-num">${d}</span>${hj}${pill}
                     </button>`;
        }

        $('#cal-grid').innerHTML = html;
        $$('[data-day]', $('#cal-grid')).forEach((el) => {
            el.addEventListener('click', () => onDayClick(el.dataset.day));
        });

        renderMonthList(y, m);
        renderSyncList();
    }

    function onDayClick(dayIso) {
        const b = bookingOn(dayIso);
        if (b) return openBookingDetails(b);
        openBookingForm({ checkin: dayIso, checkout: addDays(dayIso, 1) });
    }

    function renderMonthList(y, m) {
        const list = state.bookings
            .filter((b) => inMonth(b.checkin, y, m) || inMonth(b.checkout, y, m))
            .sort((a, b) => a.checkin.localeCompare(b.checkin));

        $('#cal-month-count').textContent = list.length + ' حجز';

        if (!list.length) {
            $('#cal-month-list').innerHTML = emptyBox('📆', 'لا حجوزات هذا الشهر', 'اضغط على أي يوم لإضافة حجز');
            return;
        }

        // الإجماليات تحسب الحجوزات الفعلية فقط دون الملغي والمحجوب
        const real = list.filter((b) => b.status !== 'cancelled' && b.status !== 'blocked');
        const gross = real.reduce((sum, b) => sum + (Number(b.total) || 0), 0);
        const fees = real.reduce((sum, b) => sum + bookingCommissionAmount(b), 0);

        const rows = list.map((b) => {
            const tag = STATUS_TAG[b.status] || ['tag-mute', b.status];
            const fee = bookingCommissionAmount(b);
            const total = Number(b.total) || 0;
            return `<tr data-open-booking="${b.id}" style="cursor:pointer" title="اضغط لعرض التفاصيل والتعديل">
                <td>
                    ${b.status === 'blocked' ? '🚧' : '🛏️'} ${escapeHtml(b.guest)}
                    <br><span style="font-size:10.5px;color:var(--muted);font-weight:600">${fmtDate(b.checkin)} ← ${fmtDate(b.checkout)} • ${nightsBetween(b.checkin, b.checkout)} ليالٍ</span>
                </td>
                <td class="dim">${SOURCE_LABEL[b.source] || b.source}</td>
                <td class="num">${total ? money(total) : '—'}</td>
                <td class="num dim">${fee ? '−' + money(fee) : '—'}</td>
                <td class="num" style="font-weight:800">${total ? money(total - fee) : '—'}</td>
                <td><span class="tag ${tag[0]}">${tag[1]}</span></td>
            </tr>`;
        }).join('');

        $('#cal-month-list').innerHTML = `
            <div class="table-wrap" style="margin-bottom:0">
                <table>
                    <thead><tr>
                        <th>الضيف</th><th>المصدر</th><th>المبلغ الإجمالي</th>
                        <th>عمولة المنصة</th><th>الإيراد الواصل لي</th><th>حالة الحجز</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                    <tfoot><tr style="font-weight:800;background:var(--surface-2)">
                        <td>الإجمالي</td>
                        <td class="dim">${real.length} حجز</td>
                        <td class="num">${money(gross)}</td>
                        <td class="num dim">${fees ? '−' + money(fees) : '—'}</td>
                        <td class="num" style="color:var(--ok)">${money(gross - fees)}</td>
                        <td></td>
                    </tr></tfoot>
                </table>
            </div>`;

        $$('[data-open-booking]', $('#cal-month-list')).forEach((tr) => {
            tr.addEventListener('click', () => {
                const b = state.bookings.find((x) => x.id === tr.dataset.openBooking);
                if (b) openBookingDetails(b);
            });
        });
    }

    function renderSyncList() {
        const zone = $('#sync-list');
        const exportUrl = location.origin + location.pathname.replace('admin.html', '') + 'calendar.ics';

        zone.innerHTML = `
            <div class="field" style="margin-bottom:14px">
                <label>رابط التصدير (ألصقه في منصات الحجز)</label>
                <div style="display:flex;gap:8px">
                    <input class="input" id="ics-out" readonly value="${escapeHtml(exportUrl)}">
                    <button class="btn btn-ghost btn-sm" id="btn-copy-ics">نسخ</button>
                </div>
            </div>` + state.syncFeeds.map((f) => `
            <div class="list-item">
                <div class="li-icon">🔗</div>
                <div class="li-body">
                    <h4>${escapeHtml(f.name)}</h4>
                    <p>${f.url ? escapeHtml(f.url.slice(0, 46)) + '…' : 'لم يُربط بعد'}${f.lastSync ? ' • آخر مزامنة ' + relTime(f.lastSync) : ''}</p>
                </div>
                <div class="li-side">
                    <button class="btn btn-ghost btn-sm" data-feed="${f.id}">${f.url ? 'تعديل' : 'ربط'}</button>
                </div>
            </div>`).join('');

        $('#btn-copy-ics').addEventListener('click', () => {
            const input = $('#ics-out');
            input.select();
            navigator.clipboard?.writeText(input.value).then(
                () => toast('تم نسخ الرابط'),
                () => toast('انسخ الرابط يدوياً', true),
            );
        });

        $$('[data-feed]', zone).forEach((btn) => {
            btn.addEventListener('click', () => openFeedForm(state.syncFeeds.find((f) => f.id === btn.dataset.feed)));
        });
    }

    /* ---- تصدير واستيراد iCal ---- */
    function icsStamp(dstr) { return dstr.replace(/-/g, ''); }

    function buildICS() {
        const lines = [
            'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RHSA7905//Property Manager//AR',
            'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:حجوزات الشقة',
        ];

        state.bookings.filter((b) => b.status !== 'cancelled').forEach((b) => {
            lines.push('BEGIN:VEVENT');
            lines.push('UID:' + b.id + '@rhsa7905');
            lines.push('DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z');
            lines.push('DTSTART;VALUE=DATE:' + icsStamp(b.checkin));
            lines.push('DTEND;VALUE=DATE:' + icsStamp(b.checkout));
            lines.push('SUMMARY:' + (b.status === 'blocked' ? 'غير متاح' : 'محجوز — ' + b.guest));
            lines.push('DESCRIPTION:' + [SOURCE_LABEL[b.source] || b.source, b.phone, b.note].filter(Boolean).join(' | '));
            lines.push('STATUS:CONFIRMED');
            lines.push('TRANSP:OPAQUE');
            lines.push('END:VEVENT');
        });

        lines.push('END:VCALENDAR');
        return lines.join('\r\n');
    }

    function parseICS(text) {
        const out = [];
        // فك طي الأسطر الطويلة حسب معيار iCalendar
        const unfolded = text.replace(/\r?\n[ \t]/g, '');
        const blocks = unfolded.split('BEGIN:VEVENT').slice(1);

        blocks.forEach((blk) => {
            const get = (key) => {
                const m = blk.match(new RegExp('^' + key + '[^:\\r\\n]*:(.*)$', 'm'));
                return m ? m[1].trim() : '';
            };
            const toIso = (v) => {
                const d = v.replace(/[^0-9]/g, '').slice(0, 8);
                return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '';
            };

            const start = toIso(get('DTSTART'));
            const end = toIso(get('DTEND'));
            if (!start || !end) return;

            out.push({
                checkin: start,
                checkout: end,
                guest: (get('SUMMARY') || 'حجز مستورد').replace(/^محجوز\s*—\s*/, ''),
                uid: get('UID'),
            });
        });

        return out;
    }

    async function importICSText(text, feedName) {
        const events = parseICS(text);
        if (!events.length) {
            toast('لم يُعثر على حجوزات في الملف', true);
            return 0;
        }

        let added = 0;
        for (const ev of events) {
            const dup = state.bookings.some((b) => b.checkin === ev.checkin && b.checkout === ev.checkout);
            if (dup) continue;
            const booking = await createBooking({
                propertyId: state.properties[0]?.id || 'p1',
                guest: ev.guest, phone: '', source: 'ical',
                checkin: ev.checkin, checkout: ev.checkout,
                total: 0, status: 'confirmed', note: 'مستورد من ' + (feedName || 'ملف iCal'),
            });
            if (!booking) continue;
            state.bookings.push(booking);
            added++;
        }

        if (added) {
            pushNotification('booking', 'مزامنة التقويم', `تم استيراد ${added} حجز من ${feedName || 'ملف iCal'}`);
            save();
            renderCalendar();
        }

        toast(added ? `تمت إضافة ${added} حجز` : 'كل الحجوزات موجودة مسبقاً');
        return added;
    }

    /* ---------------------------------------------------------------------
       8. الرسائل — متصلة بقاعدة بيانات Supabase (جدولا conversations وmessages)
       --------------------------------------------------------------------- */
    const CHANNEL_META = {
        site: ['🌐', 'نموذج الموقع', 'tag-brand'],
        whatsapp: ['💬', 'واتساب', 'tag-ok'],
        airbnb: ['🏡', 'Airbnb', 'tag-danger'],
        gathern: ['🏷️', 'جاذر إن', 'tag-info'],
    };

    // حالة الرسائل الحية — لا تُحفظ في localStorage، تُسحب من الخادم مباشرة
    const msg = { conversations: [], byId: {}, activeId: null, channel: null, loaded: false };

    function sbc() {
        return window.getSupabaseClient ? window.getSupabaseClient() : null;
    }

    /* ---------------------------------------------------------------------
       تشخيص أخطاء قاعدة البيانات
       رسالة واحدة عامة لكل الأسباب كانت تخفي الفرق بين مشروع موقوف، وانقطاع
       إنترنت، وجلسة منتهية ترفضها سياسات RLS. هذه الطبقة تترجم خطأ Supabase
       الخام إلى سبب صريح يعرف المستخدم معه ما الذي يفعله.
       --------------------------------------------------------------------- */
    const AUTH_ERROR_CODES = ['42501', 'PGRST301', 'PGRST302'];

    function isAuthError(error) {
        if (!error) return false;
        if (error.status === 401 || error.status === 403) return true;
        if (AUTH_ERROR_CODES.indexOf(error.code) !== -1) return true;
        return /row-level security|permission denied|jwt/i.test(error.message || '');
    }

    function isNetworkError(error) {
        if (!error) return false;
        if (error.status === 0 || error.name === 'AuthRetryableFetchError') return true;
        return /failed to fetch|networkerror|load failed|fetch failed/i.test(error.message || '');
    }

    function dbErrorMessage(error, action) {
        if (isNetworkError(error)) {
            return `${action} — تعذّر الوصول لقاعدة البيانات. تحقق من الإنترنت ومن أن مشروع Supabase غير موقوف`;
        }
        if (isAuthError(error)) {
            return `${action} — انتهت جلسة المالك. سجّل الخروج ثم ادخل برمز المالك لتجديدها`;
        }
        if (error && error.code === '42P01') return `${action} — الجدول غير موجود في قاعدة البيانات`;
        if (error && error.code === '23503') return `${action} — السجل المرتبط (الوحدة) غير موجود`;
        if (error && error.code === '23505') return `${action} — السجل مسجّل مسبقاً`;
        return `${action}${error && error.message ? ` — ${error.message}` : ''}`;
    }

    function reportDbError(scope, action, error) {
        console.error(`[${scope}] ${action}:`, error);
        toast(dbErrorMessage(error, action), true);
    }

    /* أخطاء التحميل تقع دفعة واحدة عند الإقلاع (حجوزات + مصاريف + جهات اتصال…)
       فنعرض السبب مرة واحدة بدل إغراق الشاشة بتنبيهات متطابقة */
    let loadErrorShown = false;

    function reportLoadError(scope, action, error) {
        console.error(`[${scope}] ${action}:`, error);
        if (loadErrorShown) return;
        loadErrorShown = true;
        toast(dbErrorMessage(error, action), true);
    }

    /* ---------------------------------------------------------------------
       جدول الحجوزات الحقيقي في Supabase (public.bookings)
       --------------------------------------------------------------------- */
    function bookingFromRow(r) {
        return {
            id: r.id, propertyId: r.property_id, guest: r.guest, phone: r.phone || '',
            source: r.source, checkin: r.checkin, checkout: r.checkout,
            total: Number(r.total) || 0, status: r.status, note: r.note || '',
            // العمولة التي حجزتها المنصة من الإجمالي — 0 للحجوزات المباشرة
            commission: Number(r.commission) || 0,
        };
    }

    function bookingToRow(b) {
        return {
            property_id: b.propertyId, guest: b.guest, phone: b.phone || '',
            source: b.source, checkin: b.checkin, checkout: b.checkout,
            total: b.total || 0, status: b.status, note: b.note || '',
            commission: Number(b.commission) || 0,
        };
    }

    /* عمود commission أُضيف بهجرة 0004. إن لم تُطبَّق الهجرة بعد ترفض Supabase
       الصف بالخطأ 42703 / PGRST204، فنعيد المحاولة دون العمود ونبلّغ المالك
       بدل أن يفشل حفظ الحجز كلياً. */
    function isMissingCommissionColumn(error) {
        if (!error) return false;
        const code = error.code || '';
        const msg = `${error.message || ''}${error.details || ''}`;
        return (code === '42703' || code === 'PGRST204') && msg.indexOf('commission') !== -1;
    }

    let commissionColumnMissing = false;

    /* العمود ناقص = العمولة لا تُحفظ أبداً. لا يكفي تنبيه عابر يمرّ دون أن
       يراه المالك، فنعرض شريط تحذير ثابتاً يحمل جملة SQL المطلوبة. */
    function warnCommissionColumn() {
        commissionColumnMissing = true;
        toast('لم تُحفظ العمولة — عمود commission غير موجود في قاعدة البيانات', true);
        renderCommissionWarning();
    }

    const COMMISSION_SQL = 'alter table public.bookings add column if not exists commission numeric not null default 0;';

    function renderCommissionWarning() {
        if (!commissionColumnMissing) return;
        if (document.getElementById('commission-warning')) return;

        const main = document.querySelector('.main');
        const topbar = document.querySelector('.topbar');
        if (!main || !topbar) return;

        const box = document.createElement('div');
        box.className = 'card';
        box.id = 'commission-warning';
        box.style.cssText = 'border-color:var(--danger);background:var(--danger-soft, var(--surface))';
        box.innerHTML = `
            <div class="card-head"><h2 style="color:var(--danger)">⚠️ عمولة المنصة لا تُحفظ</h2></div>
            <p style="font-size:12.5px;line-height:1.9;margin-bottom:10px">
                جدول الحجوزات في قاعدة البيانات ينقصه عمود <b>commission</b>، فكل عمولة تُدخلها
                تُهمل عند الحفظ. نفّذ هذه الجملة مرة واحدة في
                <b>Supabase ← SQL Editor</b> ثم أعد تحميل الصفحة.
            </p>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <code style="flex:1;min-width:260px;background:var(--surface-2);padding:9px 11px;border-radius:8px;font-size:11.5px;direction:ltr;text-align:left;overflow-x:auto;white-space:nowrap">${escapeHtml(COMMISSION_SQL)}</code>
                <button class="btn btn-primary btn-sm" id="btn-copy-commission-sql">نسخ الجملة</button>
            </div>`;

        topbar.insertAdjacentElement('afterend', box);

        document.getElementById('btn-copy-commission-sql').addEventListener('click', () => {
            navigator.clipboard.writeText(COMMISSION_SQL)
                .then(() => toast('نُسخت الجملة — ألصقها في SQL Editor'))
                .catch(() => toast('تعذّر النسخ — حدّد الجملة وانسخها يدوياً', true));
        });
    }

    async function loadBookings() {
        const client = sbc();
        if (!client) return;

        const { data, error } = await client
            .from('bookings')
            .select('*')
            .order('checkin', { ascending: true });

        if (error) { reportLoadError('bookings', 'تعذّر تحميل الحجوزات', error); return; }

        // كشف مبكر: صف بلا خاصية commission يعني أن الهجرة 0004 لم تُطبَّق
        if (data && data.length && !Object.prototype.hasOwnProperty.call(data[0], 'commission')) {
            commissionColumnMissing = true;
            renderCommissionWarning();
        }

        state.bookings = (data || []).map(bookingFromRow);
        save();
        renderView(currentView());
        updateBadges();
    }

    async function createBooking(booking) {
        const client = sbc();
        if (!client) { toast('مكتبة قاعدة البيانات لم تُحمَّل — أعد تحميل الصفحة', true); return null; }

        let { data, error } = await client
            .from('bookings')
            .insert(bookingToRow(booking))
            .select()
            .single();

        if (isMissingCommissionColumn(error)) {
            const row = bookingToRow(booking);
            delete row.commission;
            ({ data, error } = await client.from('bookings').insert(row).select().single());
            if (!error) warnCommissionColumn();
        }

        if (error) { reportDbError('bookings', 'تعذّر حفظ الحجز', error); return null; }
        return bookingFromRow(data);
    }

    async function updateBooking(id, patch) {
        const client = sbc();
        if (!client) { toast('مكتبة قاعدة البيانات لم تُحمَّل — أعد تحميل الصفحة', true); return null; }

        let { data, error } = await client
            .from('bookings')
            .update(bookingToRow(patch))
            .eq('id', id)
            .select()
            .single();

        if (isMissingCommissionColumn(error)) {
            const row = bookingToRow(patch);
            delete row.commission;
            ({ data, error } = await client.from('bookings').update(row).eq('id', id).select().single());
            if (!error) warnCommissionColumn();
        }

        if (error) { reportDbError('bookings', 'تعذّر حفظ تعديل الحجز', error); return null; }
        return bookingFromRow(data);
    }

    async function deleteBooking(id) {
        const client = sbc();
        if (!client) { toast('مكتبة قاعدة البيانات لم تُحمَّل — أعد تحميل الصفحة', true); return false; }

        const { error } = await client.from('bookings').delete().eq('id', id);
        if (error) { reportDbError('bookings', 'تعذّر حذف الحجز', error); return false; }
        return true;
    }

    /* ---------------------------------------------------------------------
       جدول جهات الاتصال الحقيقي في Supabase (public.contacts)
       --------------------------------------------------------------------- */
    function contactFromRow(r) {
        return {
            id: r.id, name: r.name, phone: r.phone || '', email: r.email || '',
            source: r.source, note: r.note || '',
            createdAt: r.created_at ? r.created_at.slice(0, 10) : todayISO(),
        };
    }

    function contactToRow(c) {
        return {
            name: c.name, phone: c.phone || '', email: c.email || '',
            source: c.source, note: c.note || '',
        };
    }

    async function loadContacts() {
        const client = sbc();
        if (!client) return;

        const { data, error } = await client
            .from('contacts')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) { reportLoadError('contacts', 'تعذّر تحميل جهات الاتصال', error); return; }

        state.contacts = (data || []).map(contactFromRow);
        save();
        renderView(currentView());

        // المحادثات قد تكون وصلت قبل جهات الاتصال — أعد المزامنة بعد التحميل
        if (msg.loaded) syncContactsFromConversations();
    }

    async function createContact(contact) {
        const client = sbc();
        if (!client) { toast('مكتبة قاعدة البيانات لم تُحمَّل — أعد تحميل الصفحة', true); return null; }

        const { data, error } = await client
            .from('contacts')
            .insert(contactToRow(contact))
            .select()
            .single();

        if (error) {
            // 23505 = تكرار الجوال؛ ليست خطأً فعلياً عند المزامنة التلقائية
            if (error.code === '23505') return null;
            reportDbError('contacts', 'تعذّر حفظ جهة الاتصال', error);
            return null;
        }
        return contactFromRow(data);
    }

    async function updateContact(id, patch) {
        const client = sbc();
        if (!client) { toast('مكتبة قاعدة البيانات لم تُحمَّل — أعد تحميل الصفحة', true); return null; }

        const { data, error } = await client
            .from('contacts')
            .update(contactToRow(patch))
            .eq('id', id)
            .select()
            .single();

        if (error) {
            reportDbError('contacts', 'تعذّر حفظ التعديل', error);
            return null;
        }
        return contactFromRow(data);
    }

    async function deleteContact(id) {
        const client = sbc();
        if (!client) { toast('مكتبة قاعدة البيانات لم تُحمَّل — أعد تحميل الصفحة', true); return false; }

        const { error } = await client.from('contacts').delete().eq('id', id);
        if (error) {
            reportDbError('contacts', 'تعذّر حذف جهة الاتصال', error);
            return false;
        }
        return true;
    }

    /* ---------------------------------------------------------------------
       جدول المصاريف الحقيقي في Supabase (public.expenses)
       --------------------------------------------------------------------- */
    function expenseFromRow(r) {
        return {
            id: r.id, propertyId: r.property_id, category: r.category,
            amount: Number(r.amount) || 0, date: r.date, dueDate: r.due_date,
            status: r.status, note: r.note || '',
        };
    }

    function expenseToRow(e) {
        return {
            property_id: e.propertyId || 'p1', category: e.category,
            amount: e.amount || 0, date: e.date, due_date: e.dueDate,
            status: e.status, note: e.note || '',
        };
    }

    async function loadExpenses() {
        const client = sbc();
        if (!client) return;

        const { data, error } = await client
            .from('expenses')
            .select('*')
            .order('due_date', { ascending: true });

        if (error) { reportLoadError('expenses', 'تعذّر تحميل المصاريف', error); return; }

        state.expenses = (data || []).map(expenseFromRow);
        save();
        renderView(currentView());
        updateBadges();
    }

    async function createExpense(expense) {
        const client = sbc();
        if (!client) { toast('مكتبة قاعدة البيانات لم تُحمَّل — أعد تحميل الصفحة', true); return null; }

        const { data, error } = await client
            .from('expenses')
            .insert(expenseToRow(expense))
            .select()
            .single();

        if (error) { reportDbError('expenses', 'تعذّر حفظ المصروف', error); return null; }
        return expenseFromRow(data);
    }

    async function updateExpense(id, patch) {
        const client = sbc();
        if (!client) { toast('مكتبة قاعدة البيانات لم تُحمَّل — أعد تحميل الصفحة', true); return null; }

        const { data, error } = await client
            .from('expenses')
            .update(expenseToRow(patch))
            .eq('id', id)
            .select()
            .single();

        if (error) { reportDbError('expenses', 'تعذّر تعديل المصروف', error); return null; }
        return expenseFromRow(data);
    }

    async function deleteExpense(id) {
        const client = sbc();
        if (!client) { toast('مكتبة قاعدة البيانات لم تُحمَّل — أعد تحميل الصفحة', true); return false; }

        const { error } = await client.from('expenses').delete().eq('id', id);
        if (error) { reportDbError('expenses', 'تعذّر حذف المصروف', error); return false; }
        return true;
    }

    async function loadConversations() {
        const client = sbc();
        if (!client) return;

        const { data, error } = await client
            .from('conversations')
            .select('*')
            .order('last_at', { ascending: false });

        if (error) { reportLoadError('messages', 'تعذّر تحميل المحادثات', error); return; }

        msg.conversations = data || [];
        msg.loaded = true;
        syncContactsFromConversations();
        renderMessages();
    }

    /* جهة اتصال حذفها المالك لا تُعاد تلقائياً من محادثات الموقع */
    function dismissChatPhone(phone) {
        const p = String(phone || '').trim();
        if (!p) return;
        if (!state.dismissedChatPhones) state.dismissedChatPhones = [];
        if (state.dismissedChatPhones.indexOf(p) === -1) state.dismissedChatPhones.push(p);
    }

    /* إضافة الرقم يدوياً من جديد تُلغي الاستبعاد */
    function undismissChatPhone(phone) {
        const p = String(phone || '').trim();
        if (!p || !state.dismissedChatPhones) return;
        state.dismissedChatPhones = state.dismissedChatPhones.filter((x) => x !== p);
    }

    function isDismissedChatPhone(phone) {
        const p = String(phone || '').trim();
        return !!p && (state.dismissedChatPhones || []).indexOf(p) !== -1;
    }

    /* حفظ معلومات تسجيل دخول الزائر للمحادثة كجهة اتصال — تلقائياً وبلا تكرار */
    async function syncContactsFromConversations() {
        let added = 0;

        for (const c of msg.conversations) {
            if (!c.visitor_phone || !c.visitor_name) continue;
            if (state.contacts.some((x) => x.phone === c.visitor_phone)) continue;
            if (isDismissedChatPhone(c.visitor_phone)) continue;   // حذفها المالك عمداً

            const contact = await createContact({
                name: c.visitor_name,
                phone: c.visitor_phone,
                email: '',
                source: 'site_chat',
                note: 'سجّل بيانات الدخول عبر المحادثة المباشرة في الموقع',
            });
            if (!contact) continue;      // موجودة مسبقاً أو تعذّر الحفظ

            state.contacts.push(contact);
            added++;
        }

        if (added) {
            save();
            const contactsView = document.getElementById('view-contacts');
            if (contactsView && contactsView.classList.contains('active')) renderContacts();
        }
    }

    async function loadThreadMessages(id) {
        const client = sbc();
        if (!client) return [];

        const { data, error } = await client
            .from('messages')
            .select('*')
            .eq('conversation_id', id)
            .order('created_at', { ascending: true });

        if (error) { reportLoadError('messages', 'تعذّر تحميل الرسائل', error); return []; }
        return data || [];
    }

    async function sendOwnerReply(id, text) {
        const client = sbc();
        if (!client) return false;

        const { error } = await client
            .from('messages')
            .insert({ conversation_id: id, sender: 'owner', body: text });

        if (error) { reportDbError('messages', 'تعذّر إرسال الرد', error); return false; }
        return true;
    }

    async function markConversationRead(id) {
        const client = sbc();
        if (!client) return;
        await client.from('conversations').update({ unread_owner: 0 }).eq('id', id);
        const c = msg.conversations.find((x) => x.id === id);
        if (c) c.unread_owner = 0;
    }

    function renderMessages() {
        const list = $('#chat-list');
        if (!msg.loaded) {
            list.innerHTML = emptyBox('⏳', 'جارٍ التحميل…', 'يتم الاتصال بقاعدة البيانات');
            loadConversations();
            return;
        }

        const totalUnread = msg.conversations.reduce((s, c) => s + (c.unread_owner || 0), 0);

        if (!msg.conversations.length) {
            list.innerHTML = emptyBox('💬', 'لا رسائل', 'ستصلك رسائل الزبائن من الموقع هنا فور وصولها');
            $('#chat-panel').innerHTML = `<div class="chat-empty">اختر محادثة لعرضها</div>`;
        } else {
            list.innerHTML = msg.conversations.map((c) => {
                const ch = CHANNEL_META[c.channel] || CHANNEL_META.site;
                return `<button class="chat-item ${msg.activeId === c.id ? 'active' : ''}" data-thread="${c.id}">
                    <span class="av">${escapeHtml(c.visitor_name.charAt(0))}</span>
                    <span class="meta">
                        <span class="nm">${escapeHtml(c.visitor_name)} <span style="font-size:11px">${ch[0]}</span></span>
                        <span class="pv">${escapeHtml(c.last_message || 'لا رسائل بعد')}</span>
                    </span>
                    <span style="display:flex;flex-direction:column;align-items:flex-end;gap:5px">
                        <span class="tm">${c.last_at ? relTime(c.last_at) : ''}</span>
                        ${c.unread_owner ? '<span class="unread-dot"></span>' : ''}
                    </span>
                </button>`;
            }).join('');

            $$('[data-thread]', list).forEach((el) => {
                el.addEventListener('click', () => openThread(el.dataset.thread));
            });

            if (!msg.activeId) openThread(msg.conversations[0].id, true);
            else openThread(msg.activeId, true);
        }

        const badge = $('#badge-msg');
        badge.hidden = !totalUnread;
        badge.textContent = totalUnread;
        updateBadges();
        renderChannels();
    }

    async function openThread(id, keepList) {
        const c = msg.conversations.find((x) => x.id === id);
        if (!c) return;

        msg.activeId = id;
        $$('.chat-item').forEach((el) => el.classList.toggle('active', el.dataset.thread === id));

        if (c.unread_owner) markConversationRead(id).then(renderMessages);

        const ch = CHANNEL_META[c.channel] || CHANNEL_META.site;
        $('#chat-panel').innerHTML = `
            <div class="chat-top">
                <span class="av" style="width:36px;height:36px;border-radius:50%;background:var(--surface-3);display:grid;place-items:center;font-weight:800">${escapeHtml(c.visitor_name.charAt(0))}</span>
                <div style="margin-inline-end:auto">
                    <div style="font-size:14px;font-weight:800">${escapeHtml(c.visitor_name)}</div>
                    <div style="font-size:11.5px;color:var(--muted);font-weight:600" dir="ltr">${escapeHtml(c.visitor_phone || '')}</div>
                </div>
                <span class="tag ${ch[2]}">${ch[0]} ${ch[1]}</span>
                <a class="btn btn-ghost btn-sm" href="https://wa.me/${(c.visitor_phone || '').replace(/^0/, '966')}" target="_blank" rel="noopener">واتساب</a>
                <button class="btn btn-ghost btn-sm" id="btn-thread-book">+ حجز</button>
            </div>
            <div class="chat-body" id="chat-body">
                <div class="empty" style="padding:20px"><div class="ic">⏳</div></div>
            </div>
            <div class="chat-compose">
                <input class="input" id="msg-input" placeholder="اكتب رداً…">
                <button class="btn btn-primary" id="msg-send">إرسال</button>
            </div>`;

        $('#btn-thread-book').addEventListener('click', () => {
            openBookingForm({ guest: c.visitor_name, phone: c.visitor_phone, source: 'direct' });
        });

        const renderBubbles = (rows) => {
            const body = $('#chat-body');
            if (!body) return;
            body.innerHTML = rows.length
                ? rows.map((m) => `
                    <div class="msg ${m.sender === 'owner' ? 'me' : 'them'}">
                        ${escapeHtml(m.body)}
                        <span class="t">${relTime(m.created_at)}</span>
                    </div>`).join('')
                : emptyBox('💬', 'لا رسائل بعد', '');
            body.scrollTop = body.scrollHeight;
        };

        const rows = await loadThreadMessages(id);
        if (msg.activeId !== id) return;   // بدّل المحادثة أثناء التحميل
        msg.byId[id] = rows;
        renderBubbles(rows);

        const send = async () => {
            const input = $('#msg-input');
            const text = input.value.trim();
            if (!text) return;
            input.value = '';

            const ok = await sendOwnerReply(id, text);
            if (ok) {
                const fresh = await loadThreadMessages(id);
                msg.byId[id] = fresh;
                if (msg.activeId === id) renderBubbles(fresh);
                const conv = msg.conversations.find((x) => x.id === id);
                if (conv) { conv.last_message = text; conv.last_at = new Date().toISOString(); }
            } else {
                toast('تعذّر إرسال الرد', true);
            }
        };

        $('#msg-send').addEventListener('click', send);
        $('#msg-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    }

    /* بث لحظي: أي رسالة أو محادثة جديدة تحدّث الواجهة فوراً بلا تحديث يدوي */
    function startMessagesRealtime() {
        const client = sbc();
        if (!client || msg.channel) return;

        msg.channel = client
            .channel('admin-messages')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
                loadConversations();
            })
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
                const row = payload.new;
                if (row && row.conversation_id === msg.activeId) {
                    loadThreadMessages(msg.activeId).then((rows) => {
                        msg.byId[msg.activeId] = rows;
                        const body = $('#chat-body');
                        if (!body) return;
                        body.innerHTML = rows.map((m) => `
                            <div class="msg ${m.sender === 'owner' ? 'me' : 'them'}">
                                ${escapeHtml(m.body)}
                                <span class="t">${relTime(m.created_at)}</span>
                            </div>`).join('');
                        body.scrollTop = body.scrollHeight;
                    });
                }
                loadConversations();
                if (row && row.sender === 'visitor') {
                    pushNotification('message', 'رسالة جديدة', row.body.slice(0, 80));
                    updateBadges();
                }
            })
            .subscribe();
    }

    function stopMessagesRealtime() {
        const client = sbc();
        if (client && msg.channel) client.removeChannel(msg.channel);
        msg.channel = null;
    }

    function renderChannels() {
        const counts = {};
        msg.conversations.forEach((c) => { counts[c.channel] = (counts[c.channel] || 0) + 1; });

        const rows = [
            { key: 'site', desc: 'نموذج التواصل في صفحة الشقة — يعمل الآن ومتصل بقاعدة البيانات', tag: '<span class="tag tag-ok">مفعّل</span>' },
            { key: 'whatsapp', desc: 'بوت هجين: رد آلي على الاستفسارات المتكررة مع تحويل المحادثة للمالك', tag: '<span class="tag tag-warn">قيد التجهيز</span>' },
            { key: 'gathern', desc: 'رسائل منصة جاذر إن', tag: '<span class="tag tag-mute">يدوي</span>' },
            { key: 'airbnb', desc: 'رسائل منصة Airbnb', tag: '<span class="tag tag-mute">يدوي</span>' },
        ];

        $('#channels-zone').innerHTML = rows.map((r) => {
            const ch = CHANNEL_META[r.key];
            return `<div class="list-item">
                <div class="li-icon">${ch[0]}</div>
                <div class="li-body">
                    <h4>${ch[1]}</h4>
                    <p>${r.desc}</p>
                </div>
                <div class="li-side">
                    <span style="font-size:12px;color:var(--muted);font-weight:700">${counts[r.key] || 0} محادثة</span>
                    ${r.tag}
                </div>
            </div>`;
        }).join('');
    }

    /* ---------------------------------------------------------------------
       9. العقارات
       --------------------------------------------------------------------- */
    function renderProperties() {
        $('#prop-count').textContent = state.properties.length + ' وحدة';

        if (!state.properties.length) {
            $('#prop-grid').innerHTML = emptyBox('🏠', 'لا وحدات', 'أضف أول وحدة عقارية');
            return;
        }

        $('#prop-grid').innerHTML = state.properties.map((p) => {
            const bookedNow = bookingOn(todayISO());
            const isBusy = bookedNow && bookedNow.propertyId === p.id;
            const revenue = realBookings().filter((b) => b.propertyId === p.id).reduce((s, b) => s + Number(b.total || 0), 0);

            return `<div class="prop-card">
                <div class="prop-media">
                    ${p.img ? `<img src="${escapeHtml(p.img)}" alt="${escapeHtml(p.name)}" loading="lazy">` : ''}
                    <span class="prop-status tag ${isBusy ? 'tag-danger' : 'tag-ok'}">${isBusy ? 'مشغولة الآن' : 'متاحة'}</span>
                </div>
                <div class="prop-body">
                    <h3>${escapeHtml(p.name)}</h3>
                    <div class="loc">📍 ${escapeHtml(p.district)} — ${escapeHtml(p.city)}</div>
                    <div class="prop-specs">
                        <span>🛏️ ${p.rooms} غرفة</span>
                        <span>🚿 ${p.baths} حمام</span>
                        <span>📐 ${p.area} م²</span>
                        <span>🏢 ${escapeHtml(p.floor)}</span>
                    </div>
                    <div class="prop-specs">
                        ${(p.platforms || []).map((x) => `<span class="tag tag-mute">${escapeHtml(x)}</span>`).join('')}
                    </div>
                    <div class="prop-foot">
                        <div class="prop-price">${money(p.nightly)} <small>/ ليلة</small></div>
                        <div style="margin-inline-start:auto;text-align:end">
                            <div style="font-size:11px;color:var(--muted);font-weight:600">إجمالي الإيراد</div>
                            <b style="font-size:13px">${money(revenue)}</b>
                        </div>
                    </div>
                    <div style="display:flex;gap:6px">
                        <button class="btn btn-ghost btn-sm" data-edit-prop="${p.id}" style="flex:1">تعديل</button>
                        <a class="btn btn-ghost btn-sm" href="index.html" target="_blank" style="flex:1;justify-content:center">معاينة</a>
                    </div>
                </div>
            </div>`;
        }).join('');

        $$('[data-edit-prop]').forEach((btn) => {
            btn.addEventListener('click', () => openPropertyForm(state.properties.find((p) => p.id === btn.dataset.editProp)));
        });
    }

    /* ---------------------------------------------------------------------
       10. جهات الاتصال
       --------------------------------------------------------------------- */
    /* ---------------------------------------------------------------------
       عمولات المنصات — إعادة الحساب على الحجوزات السابقة
       --------------------------------------------------------------------- */

    /* ملاحظة مصروف العمولة — تحمل اسم الضيف والمنصة وتاريخ الوصول ليصبح الربط
       بالحجز فريداً دون الحاجة لعمود booking_id في قاعدة البيانات */
    function feeNote(b) {
        return `${b.guest} — ${SOURCE_LABEL[b.source] || b.source} — ${b.checkin}`;
    }

    /* البحث عن مصروف عمولة حجز معيّن. الصفوف القديمة كانت بلا تاريخ في الملاحظة
       فنقبل أيضاً الصيغة السابقة «الضيف — المنصة»، ونمنع ربط صفٍ واحد بحجزين. */
    function findFeeExpense(b, used) {
        const exact = feeNote(b);
        const legacy = `${b.guest} — ${SOURCE_LABEL[b.source] || b.source}`;

        let found = state.expenses.find((e) => (
            e.category === 'عمولة منصات' && e.note === exact && !used.has(e.id)
        ));
        if (found) return found;

        found = state.expenses.find((e) => (
            e.category === 'عمولة منصات' && e.note === legacy && !used.has(e.id)
        ));
        return found || null;
    }

    /* تنظيف صف مصروف عمولة قديم لحجز صار يحفظ عمولته داخله.
       يمنع احتساب العمولة مرتين: مرة في الحجز ومرة كفاتورة. */
    async function dropLegacyFeeExpense(b, before) {
        const used = new Set();
        const exp = findFeeExpense(b, used) || (before ? findFeeExpense(before, used) : null);
        if (!exp) return;
        if (await deleteExpense(exp.id)) {
            state.expenses = state.expenses.filter((x) => x.id !== exp.id);
        }
    }

    /* ترحيل العمولات القديمة: كل صف «عمولة منصات» في المصاريف يُنقل إلى
       حقل commission في حجزه ثم يُحذف الصف. الرصيد النهائي لا يتغيّر —
       تتغيّر فقط طريقة التمثيل: خصم داخل الحجز بدل فاتورة مستحقة. */
    async function migrateFeeExpenses(btn) {
        const feeRows = state.expenses.filter((e) => e.category === 'عمولة منصات');
        if (!feeRows.length) {
            toast('لا توجد عمولات في الفواتير — كل العمولات محفوظة داخل حجوزاتها');
            return;
        }

        if (btn) { btn.disabled = true; btn.textContent = 'جارٍ الترحيل…'; }

        let moved = 0;
        let orphan = 0;
        let failed = 0;
        let total = 0;

        for (const e of feeRows) {
            // الملاحظة تحمل «الضيف — المنصة — تاريخ الوصول» أو الصيغة القديمة بلا تاريخ
            const b = realBookings().find((x) => (
                e.note === feeNote(x) || e.note === `${x.guest} — ${SOURCE_LABEL[x.source] || x.source}`
            ));

            if (!b) { orphan++; continue; }

            const amount = Number(e.amount) || 0;
            const saved = await updateBooking(b.id, Object.assign({}, b, {
                commission: (Number(b.commission) || 0) + amount,
            }));
            if (!saved) { failed++; continue; }

            const idx = state.bookings.findIndex((x) => x.id === b.id);
            if (idx !== -1) state.bookings[idx] = saved;

            if (await deleteExpense(e.id)) {
                state.expenses = state.expenses.filter((x) => x.id !== e.id);
            }
            total += amount;
            moved++;
        }

        if (btn) { btn.disabled = false; btn.textContent = 'ترحيل العمولات من الفواتير'; }

        save();
        renderView(currentView());

        if (moved) toast(`تم ترحيل ${moved} عمولة بقيمة ${money(total)} إلى حجوزاتها`);
        if (orphan) toast(`${orphan} عمولة لم يُعرف حجزها — عدّلها يدوياً من الفواتير`, true);
        if (failed) toast(`تعذّر ترحيل ${failed} عمولة — تحقق من تنفيذ هجرة 0004`, true);
    }

    /* إعادة حساب عمولات الحجوزات بأسعار المنصات الحالية — تكتب في حقل
       commission داخل كل حجز، فتنعكس فوراً على الإيراد الواصل وصافي الربح.
       تُستخدم عند تغيير نسبة منصة، أو لتقدير عمولات حجوزات قديمة بلا عمولة. */
    async function recalcCommissions(btn) {
        const bookings = realBookings().filter((b) => (
            FEE_PLATFORMS.indexOf(b.source) !== -1 && (Number(b.total) || 0) > 0
        ));
        if (!bookings.length) {
            toast('لا توجد حجوزات من منصات لإعادة حسابها');
            return;
        }

        const changes = bookings
            .map((b) => ({ b, expected: bookingCommission(b), current: bookingCommissionAmount(b) }))
            .filter((x) => round2(x.expected) !== round2(x.current));

        if (!changes.length) {
            toast('العمولات مطابقة للإعدادات الحالية — لا تغيير');
            return;
        }

        const diff = changes.reduce((sum, x) => sum + (x.expected - x.current), 0);
        const sign = diff > 0 ? '+' : '';
        const ok = confirm(
            `إعادة حساب عمولات ${changes.length} حجز بإعدادات المنصات الحالية؟
`
            + `فرق العمولات ${sign}${round2(diff)} ر.س — سيتغيّر الإيراد الواصل بالمقابل.`
        );
        if (!ok) return;

        if (btn) { btn.disabled = true; btn.textContent = 'جارٍ إعادة الحساب…'; }

        let updated = 0;
        let failed = 0;

        for (const { b, expected } of changes) {
            const saved = await updateBooking(b.id, Object.assign({}, b, { commission: expected }));
            if (!saved) { failed++; continue; }
            const idx = state.bookings.findIndex((x) => x.id === b.id);
            if (idx !== -1) state.bookings[idx] = saved;
            updated++;
        }

        if (btn) { btn.disabled = false; btn.textContent = 'إعادة حساب عمولات الحجوزات'; }

        save();
        renderView(currentView());

        if (updated) toast(`أُعيد حساب عمولة ${updated} حجز — فرق ${sign}${round2(diff)} ر.س`);
        if (failed) toast(`تعذّر تحديث ${failed} حجز — تحقق من تنفيذ هجرة 0004`, true);
    }

    /* إدخال جهات الاتصال التشغيلية المعروفة — يتجاهل الموجود مسبقاً فلا يُكرّر شيئاً.
       المطابقة بالجوال إن وُجد، وإلا بالاسم (المضيفون دون أرقام). */
    async function seedOpsContacts(btn) {
        const missing = OPS_SEED.filter((s) => !state.contacts.some((c) => (
            s.phone ? c.phone === s.phone : c.name === s.name
        )));

        if (!missing.length) {
            toast('جهات الاتصال التشغيلية مُدخلة مسبقاً');
            return;
        }

        if (btn) { btn.disabled = true; btn.textContent = 'جارٍ الإضافة…'; }

        let added = 0;
        let failed = 0;
        for (const s of missing) {
            const saved = await createContact(Object.assign({ email: '' }, s));
            if (saved) { state.contacts.push(saved); added++; } else { failed++; }
        }

        if (btn) { btn.disabled = false; btn.textContent = '+ جهات التشغيل الأساسية'; }

        save();
        renderContacts();

        if (added) toast(`تمت إضافة ${added} جهة اتصال تشغيلية`);
        // الفشل الصامت الأشهر: قيد تفرّد الجوال يرفض جهتين بلا رقم — انظر هجرة 0003
        if (failed) toast(`تعذّر إضافة ${failed} جهة — راجع أرقام الجوال المكرّرة`, true);
    }

    /* رقم واتساب دولي من رقم محلي */
    function waNumber(phone) {
        return (phone || '').replace(/^0/, '966').replace(/\D/g, '');
    }

    function renderContacts() {
        const q = ($('#contact-search').value || '').trim();
        const opsMode = contactFilter === 'ops';

        const list = state.contacts
            .filter((c) => (contactFilter === 'all' ? true : (opsMode ? isOpsContact(c) : !isOpsContact(c))))
            .filter((c) => !q || c.name.includes(q) || (c.phone || '').includes(q));

        const opsCount = state.contacts.filter(isOpsContact).length;
        $('#contact-count').textContent = `${state.contacts.length - opsCount} زبون • ${opsCount} جهة تشغيل`;
        $$('#contact-filter button').forEach((b) => b.classList.toggle('active', b.dataset.cf === contactFilter));

        // زر الإدخال السريع يظهر في وضع التشغيل فقط، وما دامت جهة واحدة على الأقل ناقصة
        const seedBtn = $('#btn-seed-ops');
        const seedMissing = OPS_SEED.some((s) => !state.contacts.some((c) => (
            s.phone ? c.phone === s.phone : c.name === s.name
        )));
        seedBtn.hidden = !(opsMode && seedMissing);

        // جدول التشغيل لا يعرض أعمدة الحجوزات والإنفاق — فهي بلا معنى لمسؤول نظافة أو عامل مبنى
        $('#thead-contacts').innerHTML = opsMode
            ? '<tr><th>الاسم</th><th>الدور</th><th>الجوال</th><th>ملاحظات</th><th></th></tr>'
            : '<tr><th>الاسم</th><th>الجوال</th><th>المصدر</th><th>الحجوزات</th><th>إجمالي الإنفاق</th><th>آخر تواصل</th><th></th></tr>';

        if (!list.length) {
            const cols = opsMode ? 5 : 7;
            const empty = opsMode
                ? emptyBox('🧹', 'لا جهات تشغيل', 'أضف مسؤول النظافة ومكتب العمارة وعامل المبنى والمضيفين')
                : emptyBox('👥', 'لا نتائج', 'لا توجد جهات اتصال مطابقة');
            $('#tbl-contacts').innerHTML = `<tr><td colspan="${cols}">${empty}</td></tr>`;
            return;
        }

        $('#tbl-contacts').innerHTML = list.map((c) => {
            const wa = waNumber(c.phone);
            const callBtns = `
                ${wa ? `<a class="btn btn-ghost btn-sm" href="https://wa.me/${wa}" target="_blank" rel="noopener">واتساب</a>` : ''}
                ${c.phone ? `<a class="btn btn-ghost btn-sm" href="tel:${escapeHtml(c.phone)}">اتصال</a>` : ''}
                <button class="btn btn-ghost btn-sm" data-edit-contact="${c.id}">تعديل</button>
                <button class="btn btn-ghost btn-sm" data-del-contact="${c.id}" style="color:var(--danger)">حذف</button>`;

            if (opsMode) {
                return `<tr>
                    <td>${OPS_ICON[c.source] || '👤'} ${escapeHtml(c.name)}</td>
                    <td><span class="tag tag-info">${SOURCE_LABEL[c.source] || c.source}</span></td>
                    <td class="num dim">${escapeHtml(c.phone || '—')}</td>
                    <td class="dim">${c.note ? escapeHtml(c.note) : '—'}</td>
                    <td><div style="display:flex;gap:6px;justify-content:flex-end">${callBtns}</div></td>
                </tr>`;
            }

            const bk = realBookings().filter((b) => b.phone && b.phone === c.phone);
            const spend = bk.reduce((s, b) => s + Number(b.total || 0), 0);
            const last = bk.map((b) => b.checkin).sort().pop();
            const ops = isOpsContact(c);

            return `<tr>
                <td>${ops ? (OPS_ICON[c.source] || '👤') + ' ' : ''}${escapeHtml(c.name)}${c.note ? `<br><span style="font-size:11px;color:var(--muted);font-weight:500">${escapeHtml(c.note)}</span>` : ''}</td>
                <td class="num dim">${escapeHtml(c.phone || '—')}</td>
                <td><span class="tag ${ops ? 'tag-info' : 'tag-mute'}">${SOURCE_LABEL[c.source] || c.source}</span></td>
                <td class="num">${ops ? '—' : bk.length}</td>
                <td class="num">${ops ? '—' : money(spend)}</td>
                <td class="num dim">${last ? fmtDate(last) : '—'}</td>
                <td>
                    <div style="display:flex;gap:6px;justify-content:flex-end">
                        ${wa ? `<a class="btn btn-ghost btn-sm" href="https://wa.me/${wa}" target="_blank" rel="noopener">واتساب</a>` : ''}
                        ${ops ? '' : `<button class="btn btn-ghost btn-sm" data-book-contact="${c.id}">حجز</button>`}
                        <button class="btn btn-ghost btn-sm" data-edit-contact="${c.id}">تعديل</button>
                        <button class="btn btn-ghost btn-sm" data-del-contact="${c.id}" style="color:var(--danger)">حذف</button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        $$('[data-book-contact]').forEach((btn) => {
            const c = state.contacts.find((x) => x.id === btn.dataset.bookContact);
            btn.addEventListener('click', () => openBookingForm({ guest: c.name, phone: c.phone, source: 'direct' }));
        });

        $$('[data-edit-contact]').forEach((btn) => {
            const c = state.contacts.find((x) => x.id === btn.dataset.editContact);
            btn.addEventListener('click', () => openContactForm(c));
        });

        $$('[data-del-contact]').forEach((btn) => {
            const c = state.contacts.find((x) => x.id === btn.dataset.delContact);
            btn.addEventListener('click', async () => {
                const fromChat = c.source === 'site_chat';
                const warn = fromChat
                    ? `حذف جهة الاتصال «${c.name}»؟
لن تُعاد إضافتها تلقائياً من محادثات الموقع.`
                    : `حذف جهة الاتصال «${c.name}»؟`;
                if (!confirm(warn)) return;

                const ok = await deleteContact(c.id);
                if (!ok) return;
                state.contacts = state.contacts.filter((x) => x.id !== c.id);

                // بدون هذا التسجيل تعيد مزامنة المحادثات إنشاءها عند كل تحميل
                dismissChatPhone(c.phone);

                save();
                toast('تم حذف جهة الاتصال');
                renderContacts();
            });
        });
    }

    /* ---------------------------------------------------------------------
       11. الإشعارات
       --------------------------------------------------------------------- */
    const NOTIF_META = {
        booking: ['📅', 'var(--ok-soft)'],
        bill: ['⚡', 'var(--warn-soft)'],
        message: ['💬', 'var(--info-soft)'],
        system: ['⚙️', 'var(--surface-3)'],
    };

    function pushNotification(type, title, body) {
        state.notifications.unshift({ id: uid(), type, title, body, at: new Date().toISOString(), read: false });
        state.notifications = state.notifications.slice(0, 60);
        updateBadges();
    }

    function renderNotifications() {
        const list = state.notifications.filter((n) => notifFilter === 'all' || n.type === notifFilter);

        if (!list.length) {
            $('#notif-list').innerHTML = emptyBox('🔔', 'لا إشعارات', 'ستظهر التنبيهات هنا');
            return;
        }

        $('#notif-list').innerHTML = list.map((n) => {
            const meta = NOTIF_META[n.type] || NOTIF_META.system;
            return `<div class="list-item notif ${n.read ? '' : 'unread'}">
                <div class="li-icon" style="background:${meta[1]}">${meta[0]}</div>
                <div class="li-body">
                    <h4>${escapeHtml(n.title)}</h4>
                    <p>${escapeHtml(n.body)}</p>
                </div>
                <div class="li-side">
                    <span style="font-size:11px;color:var(--muted);font-weight:600">${relTime(n.at)}</span>
                    ${n.read ? '' : `<button class="btn btn-ghost btn-sm" data-read="${n.id}">تعليم كمقروء</button>`}
                </div>
            </div>`;
        }).join('');

        $$('[data-read]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const n = state.notifications.find((x) => x.id === btn.dataset.read);
                if (n) n.read = true;
                save();
                renderNotifications();
                updateBadges();
            });
        });
    }

    function updateBadges() {
        const unreadN = state.notifications.filter((n) => !n.read).length;
        const badge = $('#badge-notif');
        badge.hidden = !unreadN;
        badge.textContent = unreadN;
        $('#bell-dot').hidden = !unreadN;

        const unreadM = msg.conversations.reduce((s, c) => s + (c.unread_owner || 0), 0);
        const bm = $('#badge-msg');
        bm.hidden = !unreadM;
        bm.textContent = unreadM;
    }

    /* ---------------------------------------------------------------------
       12. الإعدادات
       --------------------------------------------------------------------- */
    /* صفوف تعديل عمولة المنصات — ثابت ونسبة وحد أقصى لكل منصة، مع مثال محسوب */
    function renderFeeRows() {
        const zone = $('#fee-rows');
        if (!zone) return;

        const sample = RATES.nightly;   // سعر ليلة مرجعي للمثال

        zone.innerHTML = FEE_PLATFORMS.map((p) => {
            const f = feeConf(p);
            const per = round2(platformFee(sample, p));
            return `<div class="switch" style="flex-wrap:wrap;gap:8px">
                <div class="switch-info" style="min-width:130px">
                    <h4>${SOURCE_LABEL[p] || p}</h4>
                    <p>مثال: ليلة ${sample} ← ${per} ر.س</p>
                </div>
                <div style="display:flex;gap:6px;align-items:flex-end;margin-inline-start:auto">
                    <div class="field" style="margin:0"><label style="font-size:11px">ثابت</label>
                        <input type="number" class="input" data-fee="${p}" data-fee-key="base" min="0" step="0.01" value="${Number(f.base) || 0}" style="width:82px"></div>
                    <div class="field" style="margin:0"><label style="font-size:11px">نسبة %</label>
                        <input type="number" class="input" data-fee="${p}" data-fee-key="rate" min="0" step="0.01" value="${Number(f.rate) || 0}" style="width:82px"></div>
                    <div class="field" style="margin:0"><label style="font-size:11px">حد أقصى</label>
                        <input type="number" class="input" data-fee="${p}" data-fee-key="cap" min="0" step="1" value="${Number(f.cap) || 0}" style="width:82px"></div>
                </div>
            </div>`;
        }).join('');

        $$('[data-fee]', zone).forEach((el) => {
            el.addEventListener('change', () => {
                if (!state.fees) state.fees = JSON.parse(JSON.stringify(DEFAULT_FEES));
                const p = el.dataset.fee;
                if (!state.fees[p]) state.fees[p] = Object.assign({}, DEFAULT_FEES[p]);
                const v = Math.max(0, Number(el.value) || 0);
                state.fees[p][el.dataset.feeKey] = v;
                save();
                renderFeeRows();
                toast(`تم تحديث عمولة ${SOURCE_LABEL[p] || p} — اضغط إعادة الحساب لتطبيقها على الحجوزات`);
            });
        });
    }

    function renderSettings() {
        $$('#set-lang button').forEach((b) => b.classList.toggle('active', b.dataset.lang === state.settings.lang));
        $('#set-theme').classList.toggle('on', state.settings.theme === 'dark');
        $('#set-hijri').classList.toggle('on', !!state.settings.hijri);
        $('#set-currency').value = state.settings.currency;
        $$('[data-pref]').forEach((t) => t.classList.toggle('on', !!state.settings[t.dataset.pref]));

        // تقديرات المصاريف المتغيّرة
        const r = state.rates || DEFAULT_RATES;
        $('#rate-internet-total').value = Number(r.internetTotal) || 0;
        $('#rate-internet-shares').value = Math.max(1, Number(r.internetShares) || 1);
        $('#rate-power').value = Number(r.power) || 0;
        $('#rate-cleaning').value = Number(r.cleaning) || 0;
        $('#rate-internet-share').textContent = money(internetShare());

        renderFeeRows();

        // تلميح مقارنة: المضيفون المسجّلون في جهات الاتصال + المالك مقابل الرقم المُدخل
        const hosts = state.contacts.filter((c) => c.source === 'host').length;
        const hint = $('#rate-hosts-hint');
        if (hint) {
            hint.textContent = hosts
                ? `المضيفون المسجّلون ${hosts} + أنت = ${hosts + 1} — عدّله عند انسحاب أحدهم`
                : 'يتغيّر بانسحاب أو انضمام أحدهم';
        }
    }

    function applyTheme() {
        document.documentElement.setAttribute('data-theme', state.settings.theme);
        const dark = state.settings.theme === 'dark';
        $('#icon-theme').innerHTML = dark
            ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
            : '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8"/>';
    }

    function applyLang() {
        const ar = state.settings.lang === 'ar';
        document.documentElement.lang = ar ? 'ar' : 'en';
        document.documentElement.dir = ar ? 'rtl' : 'ltr';
        document.body.classList.toggle('is-ltr', !ar);
        $('#lang-label').textContent = ar ? 'EN' : 'ع';

        const EN = {
            'nav.dashboard': 'Dashboard', 'nav.calendar': 'Calendar', 'nav.messages': 'Messages',
            'nav.properties': 'Properties', 'nav.contacts': 'Contacts',
            'nav.notifications': 'Notifications', 'nav.settings': 'Settings',
            'action.newBooking': 'New booking',
        };
        const AR = {
            'nav.dashboard': 'لوحة التحكم', 'nav.calendar': 'التقويم', 'nav.messages': 'الرسائل',
            'nav.properties': 'العقارات', 'nav.contacts': 'جهات الاتصال',
            'nav.notifications': 'الإشعارات', 'nav.settings': 'الإعدادات',
            'action.newBooking': 'حجز جديد',
        };

        const dict = ar ? AR : EN;
        $$('[data-i18n]').forEach((el) => {
            const v = dict[el.dataset.i18n];
            if (v) el.textContent = v;
        });
    }

    /* ---------------------------------------------------------------------
       13. النوافذ المنبثقة
       --------------------------------------------------------------------- */
    function openModal(title, bodyHtml, footHtml) {
        $('#modal').innerHTML = `
            <div class="modal-head">
                <h3>${escapeHtml(title)}</h3>
                <button class="icon-btn" id="modal-x">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
            </div>
            <div class="modal-body">${bodyHtml}</div>
            <div class="modal-foot">${footHtml || ''}</div>`;
        $('#modal-back').classList.add('open');
        $('#modal-x').addEventListener('click', closeModal);
    }

    function closeModal() { $('#modal-back').classList.remove('open'); }

    /* نموذج الحجز — إنشاء (pre = قيم مبدئية) أو تعديل (existing = الحجز القائم) */
    function openBookingForm(pre, existing) {
        pre = existing || pre || {};
        const isEdit = !!existing;
        const props = state.properties.map((p) => (
            `<option value="${p.id}"${pre.propertyId === p.id ? ' selected' : ''}>${escapeHtml(p.name)}</option>`
        )).join('');

        openModal(isEdit ? 'تعديل الحجز' : 'حجز جديد', `
            <div class="field"><label>اسم الضيف</label><input class="input" id="f-guest" value="${escapeHtml(pre.guest || '')}" placeholder="الاسم الكامل"></div>
            <div class="form-row">
                <div class="field"><label>الجوال</label><input class="input" id="f-phone" value="${escapeHtml(pre.phone || '')}" placeholder="05xxxxxxxx"></div>
                <div class="field"><label>الوحدة</label><select class="input" id="f-prop">${props}</select></div>
            </div>
            <div class="form-row">
                <div class="field"><label>تاريخ الوصول</label><input type="date" class="input" id="f-in" value="${pre.checkin || todayISO()}"></div>
                <div class="field"><label>تاريخ المغادرة</label><input type="date" class="input" id="f-out" value="${pre.checkout || addDays(todayISO(), 1)}"></div>
            </div>
            <div class="form-row">
                <div class="field"><label>المصدر</label><select class="input" id="f-source">
                    <option value="direct">الموقع المباشر</option>
                    <option value="gathern">جاذر إن</option>
                    <option value="airbnb">Airbnb</option>
                    <option value="manual">إضافة يدوية</option>
                    <option value="block">حجب / صيانة</option>
                </select></div>
                <div class="field"><label>المبلغ الإجمالي</label><input type="number" class="input" id="f-total" placeholder="0" value="${pre.total || ''}"></div>
            </div>
            <div class="form-row">
                <div class="field">
                    <label>عمولة المنصة (ر.س)</label>
                    <input type="number" class="input" id="f-fee" min="0" step="0.01" placeholder="0" value="${pre.commission != null && pre.commission !== '' ? pre.commission : ''}">
                </div>
                <div class="field">
                    <label>الإيراد الواصل لي</label>
                    <input class="input" id="f-netview" disabled value="—" style="font-weight:800">
                </div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;margin:-4px 0 12px;flex-wrap:wrap">
                <button type="button" class="btn btn-ghost btn-sm" id="f-fee-auto">حساب العمولة تلقائياً</button>
                <span style="font-size:11.5px;color:var(--muted);font-weight:600">المنصة تحجز العمولة من الإجمالي — اتركها صفراً للحجز المباشر</span>
            </div>
            ${isEdit ? `<div class="field"><label>حالة الحجز</label><select class="input" id="f-status">
                <option value="confirmed"${pre.status === 'confirmed' ? ' selected' : ''}>مؤكد</option>
                <option value="pending"${pre.status === 'pending' ? ' selected' : ''}>بانتظار التأكيد</option>
                <option value="completed"${pre.status === 'completed' ? ' selected' : ''}>منتهٍ</option>
                <option value="blocked"${pre.status === 'blocked' ? ' selected' : ''}>محجوب</option>
                <option value="cancelled"${pre.status === 'cancelled' ? ' selected' : ''}>ملغي</option>
            </select></div>` : ''}
            <div class="field"><label>ملاحظات</label><textarea class="input" id="f-note" placeholder="طلبات خاصة، وقت الوصول…">${escapeHtml(pre.note || '')}</textarea></div>
            <div id="f-hint" style="font-size:12px;color:var(--muted);font-weight:600"></div>`,
            `<button class="btn btn-ghost" id="f-cancel">إلغاء</button>
             <button class="btn btn-primary" id="f-save">${isEdit ? 'حفظ التعديل' : 'حفظ الحجز'}</button>`);

        if (pre.source) $('#f-source').value = pre.source;

        /* العمولة يكتبها المالك بالريال. الحساب التلقائي اقتراح فقط بإعدادات المنصة،
           والصافي = الإجمالي − العمولة يُعرض لحظياً قبل الحفظ. */
        const suggestedFee = () => bookingFee(
            Number($('#f-total').value) || 0,
            nightsBetween($('#f-in').value, $('#f-out').value),
            $('#f-source').value
        );

        const recalc = () => {
            const n = nightsBetween($('#f-in').value, $('#f-out').value);
            const nightly = state.properties.find((p) => p.id === $('#f-prop').value)?.nightly || 0;
            const src = $('#f-source').value;
            if (n > 0 && !$('#f-total').value) $('#f-total').value = n * nightly;

            const total = Number($('#f-total').value) || 0;
            const fee = round2(Math.max(0, Number($('#f-fee').value) || 0));
            $('#f-netview').value = money(total - fee);

            if (n <= 0) {
                $('#f-hint').textContent = 'تاريخ المغادرة يجب أن يكون بعد الوصول';
                return;
            }
            if (fee > total) {
                $('#f-hint').innerHTML = '<span style="color:var(--danger)">العمولة أكبر من المبلغ الإجمالي — راجع الرقم</span>';
                return;
            }

            const sug = suggestedFee();
            const pct = total ? ((fee / total) * 100).toFixed(1) : '0';
            $('#f-hint').textContent = fee > 0
                ? `${n} ليالٍ — العمولة ${pct}% من الإجمالي • الصافي ${money(total - fee)}`
                : `${n} ليالٍ — السعر المقترح ${money(n * nightly)}${sug > 0 ? ` • العمولة المتوقعة لـ${SOURCE_LABEL[src] || src} ${money(sug)}` : ' • بلا عمولة'}`;
        };

        ['#f-total', '#f-source', '#f-fee'].forEach((sel) => $(sel).addEventListener('input', recalc));

        $('#f-fee-auto').addEventListener('click', () => {
            const sug = suggestedFee();
            if (!sug) return toast('لا عمولة محسوبة لهذه المنصة — راجع الإعدادات', true);
            $('#f-fee').value = sug;
            recalc();
            toast(`عمولة مقترحة ${money(sug)} بإعدادات ${SOURCE_LABEL[$('#f-source').value] || ''}`);
        });

        ['#f-in', '#f-out', '#f-prop'].forEach((sel) => $(sel).addEventListener('change', recalc));
        recalc();

        $('#f-cancel').addEventListener('click', closeModal);
        $('#f-save').addEventListener('click', async () => {
            const guest = $('#f-guest').value.trim();
            const ci = $('#f-in').value;
            const co = $('#f-out').value;
            const source = $('#f-source').value;

            if (!guest && source !== 'block') return toast('أدخل اسم الضيف', true);
            if (!ci || !co || nightsBetween(ci, co) < 1) return toast('تحقق من التواريخ', true);

            // التعارض يُفحص مع الحجوزات الأخرى فقط — الحجز نفسه لا يتعارض مع نفسه
            const clash = state.bookings.find((b) => (
                b.status !== 'cancelled' && (!isEdit || b.id !== existing.id) && ci < b.checkout && co > b.checkin
            ));
            if (clash) return toast(`تعارض مع حجز ${clash.guest}`, true);

            const phone = $('#f-phone').value.trim();
            const saveBtn = $('#f-save');
            saveBtn.disabled = true;

            const total = Number($('#f-total').value) || 0;
            const fee = round2(Math.max(0, Number($('#f-fee').value) || 0));
            if (fee > total) return toast('العمولة أكبر من المبلغ الإجمالي', true);

            const payload = {
                propertyId: $('#f-prop').value,
                guest: guest || 'غير متاح (حجب)',
                phone, source,
                checkin: ci, checkout: co,
                total,
                commission: fee,
                status: isEdit
                    ? $('#f-status').value
                    : (source === 'block' ? 'blocked' : 'confirmed'),
                note: $('#f-note').value.trim(),
            };

            // في التعديل نحتفظ بالحالة السابقة لمطابقة مصروف العمولة القديم قبل تغيّر البيانات
            const before = isEdit ? Object.assign({}, existing) : null;

            const booking = isEdit
                ? await updateBooking(existing.id, payload)
                : await createBooking(payload);

            saveBtn.disabled = false;
            if (!booking) return;

            if (isEdit) {
                const idx = state.bookings.findIndex((x) => x.id === existing.id);
                if (idx !== -1) state.bookings[idx] = booking;
                await dropLegacyFeeExpense(booking, before);
                save();
                closeModal();
                toast('تم حفظ تعديل الحجز');
                renderView(currentView());
                updateBadges();
                return;
            }

            state.bookings.push(booking);

            // إنشاء جهة اتصال تلقائياً إن لم تكن موجودة
            if (phone && !state.contacts.some((c) => c.phone === phone)) {
                const contact = await createContact({
                    name: guest, phone, email: '', source, note: 'أُضيف تلقائياً من حجز',
                });
                if (contact) state.contacts.push(contact);
            }

            if (source !== 'block') {
                pushNotification('booking', 'حجز جديد مؤكد', `${guest} — ${nightsBetween(ci, co)} ليالٍ عبر ${SOURCE_LABEL[source] || source}`);
            }

            // العمولة لم تُعد صفَّ مصروف — المنصة تحجزها من الإجمالي فهي محفوظة
            // في حقل commission داخل الحجز نفسه (انظر هجرة 0004)

            save();
            closeModal();
            toast('تم حفظ الحجز');
            renderView(currentView());
            updateBadges();
        });
    }

    function openBookingDetails(b) {
        const tag = STATUS_TAG[b.status] || ['tag-mute', b.status];
        openModal('تفاصيل الحجز', `
            <div class="list-item"><div class="li-icon">👤</div><div class="li-body"><h4>${escapeHtml(b.guest)}</h4><p>${escapeHtml(b.phone || 'بدون جوال')}</p></div><div class="li-side"><span class="tag ${tag[0]}">${tag[1]}</span></div></div>
            <div class="list-item"><div class="li-icon">📅</div><div class="li-body"><h4>${fmtDate(b.checkin)} ← ${fmtDate(b.checkout)}</h4><p>${nightsBetween(b.checkin, b.checkout)} ليالٍ</p></div></div>
            <div class="list-item"><div class="li-icon">🔗</div><div class="li-body"><h4>${SOURCE_LABEL[b.source] || b.source}</h4><p>مصدر الحجز</p></div><div class="li-side"><b>${money(b.total)}</b></div></div>
            ${(() => {
                const fee = bookingCommissionAmount(b);
                if (!fee) return '';
                const total = Number(b.total) || 0;
                const pct = total ? ((fee / total) * 100).toFixed(1) : '0';
                return `<div class="list-item"><div class="li-icon">🧾</div><div class="li-body"><h4>عمولة المنصة</h4><p>${pct}% من الإجمالي — حجزتها المنصة</p></div><div class="li-side"><b>−${money(fee)}</b><br><span style="font-size:11px;color:var(--ok);font-weight:700">الواصل ${money(total - fee)}</span></div></div>`;
            })()}
            ${b.note ? `<div class="list-item"><div class="li-icon">📝</div><div class="li-body"><h4>ملاحظات</h4><p>${escapeHtml(b.note)}</p></div></div>` : ''}`,
            `<button class="btn btn-ghost" id="b-del" style="color:var(--danger)">حذف الحجز</button>
             <button class="btn btn-ghost" id="b-edit">تعديل الحجز</button>
             <button class="btn btn-primary" id="b-close">إغلاق</button>`);

        $('#b-close').addEventListener('click', closeModal);

        // التعديل يفتح النموذج نفسه محمَّلاً ببيانات الحجز
        $('#b-edit').addEventListener('click', () => {
            closeModal();
            openBookingForm(null, b);
        });

        $('#b-del').addEventListener('click', async () => {
            if (!confirm(`حذف حجز «${b.guest}»؟ ستُحذف معه عمولة المنصة المسجَّلة.`)) return;

            const ok = await deleteBooking(b.id);
            if (!ok) return;
            state.bookings = state.bookings.filter((x) => x.id !== b.id);

            // مصروف العمولة يُحذف مع الحجز فلا تبقى مصاريف معلّقة بلا حجز
            const exp = findFeeExpense(b, new Set());
            if (exp && await deleteExpense(exp.id)) {
                state.expenses = state.expenses.filter((x) => x.id !== exp.id);
            }

            save();
            closeModal();
            toast('تم حذف الحجز');
            renderView(currentView());
        });
    }

    function openExpenseForm(e) {
        const isNew = !e;
        e = e || {};

        openModal(isNew ? 'إضافة مصروف' : 'تعديل المصروف', `
            <div class="form-row">
                <div class="field"><label>البند</label><select class="input" id="e-cat">
                    ${EXPENSE_CATEGORIES.map((c) => `<option>${c}</option>`).join('')}
                </select></div>
                <div class="field"><label>المبلغ</label><input type="number" class="input" id="e-amt" placeholder="0" value="${e.amount || ''}"></div>
            </div>
            <div class="form-row">
                <div class="field"><label>تاريخ التسجيل</label><input type="date" class="input" id="e-date" value="${e.date || todayISO()}"></div>
                <div class="field"><label>تاريخ الاستحقاق</label><input type="date" class="input" id="e-due" value="${e.dueDate || addDays(todayISO(), 7)}"></div>
            </div>
            <div class="field"><label>الحالة</label><select class="input" id="e-status">
                <option value="due">مستحق</option><option value="paid">مسدد</option>
            </select></div>
            <div class="field"><label>ملاحظات</label><input class="input" id="e-note" placeholder="اختياري" value="${escapeHtml(e.note || '')}"></div>`,
            `${isNew ? '' : '<button class="btn btn-ghost" id="e-del" style="color:var(--danger)">حذف</button>'}
             <button class="btn btn-ghost" id="e-cancel">إلغاء</button>
             <button class="btn btn-primary" id="e-save">حفظ</button>`);

        // بند المصروف قد يكون خارج القائمة المعتمدة (مثل بند قديم) — أضفه حتى لا يُستبدل صامتاً
        if (!isNew && e.category && !EXPENSE_CATEGORIES.includes(e.category)) {
            $('#e-cat').insertAdjacentHTML('beforeend', `<option>${escapeHtml(e.category)}</option>`);
        }
        if (e.category) $('#e-cat').value = e.category;
        if (e.status) $('#e-status').value = e.status;

        $('#e-cancel').addEventListener('click', closeModal);

        if (!isNew) {
            $('#e-del').addEventListener('click', async () => {
                if (!confirm(`حذف مصروف «${e.category}» بمبلغ ${money(e.amount)}؟`)) return;
                const delBtn = $('#e-del');
                delBtn.disabled = true;
                const ok = await deleteExpense(e.id);
                delBtn.disabled = false;
                if (!ok) return;

                state.expenses = state.expenses.filter((x) => x.id !== e.id);
                save();
                closeModal();
                toast('تم حذف المصروف');
                renderDashboard();
                updateBadges();
            });
        }

        $('#e-save').addEventListener('click', async () => {
            const amt = Number($('#e-amt').value);
            if (!amt || amt <= 0) return toast('أدخل مبلغاً صحيحاً', true);

            const status = $('#e-status').value;
            const data = {
                propertyId: e.propertyId || state.properties[0]?.id || 'p1',
                category: $('#e-cat').value, amount: amt,
                date: $('#e-date').value || todayISO(),
                dueDate: $('#e-due').value || todayISO(),
                status,
                note: $('#e-note').value.trim(),
            };

            const saveBtn = $('#e-save');
            saveBtn.disabled = true;

            if (isNew) {
                const created = await createExpense(data);
                saveBtn.disabled = false;
                if (!created) return;

                state.expenses.push(created);
                // الإشعار للمصاريف المستحقة الجديدة فقط، حتى لا يتكرر عند كل تعديل
                if (status === 'due') {
                    pushNotification('bill', 'مصروف مستحق', `${data.category} — ${money(amt)}`);
                }
            } else {
                const updated = await updateExpense(e.id, data);
                saveBtn.disabled = false;
                if (!updated) return;

                const i = state.expenses.findIndex((x) => x.id === e.id);
                if (i === -1) { closeModal(); return toast('المصروف لم يعد موجوداً', true); }
                state.expenses[i] = updated;
            }

            save();
            closeModal();
            toast(isNew ? 'تمت إضافة المصروف' : 'تم حفظ التعديل');
            renderDashboard();
            updateBadges();
        });
    }

    function openContactForm(existing) {
        const isNew = !existing;
        const c = existing || { name: '', phone: '', source: 'manual', email: '', note: '' };

        openModal(isNew ? 'جهة اتصال جديدة' : 'تعديل جهة الاتصال', `
            <div class="field"><label>الاسم</label><input class="input" id="c-name" placeholder="الاسم الكامل" value="${escapeHtml(c.name)}"></div>
            <div class="form-row">
                <div class="field"><label>الجوال</label><input class="input" id="c-phone" placeholder="05xxxxxxxx" value="${escapeHtml(c.phone)}"></div>
                <div class="field"><label>المصدر أو الدور</label><select class="input" id="c-source">
                    <optgroup label="الزبائن">
                        <option value="manual"${c.source === 'manual' ? ' selected' : ''}>إضافة يدوية</option>
                        <option value="direct"${c.source === 'direct' ? ' selected' : ''}>الموقع المباشر</option>
                        <option value="gathern"${c.source === 'gathern' ? ' selected' : ''}>جاذر إن</option>
                        <option value="airbnb"${c.source === 'airbnb' ? ' selected' : ''}>Airbnb</option>
                    </optgroup>
                    <optgroup label="التشغيل">
                        ${OPS_SOURCES.map((s) => `<option value="${s}"${c.source === s ? ' selected' : ''}>${OPS_ICON[s]} ${SOURCE_LABEL[s]}</option>`).join('')}
                    </optgroup>
                </select></div>
            </div>
            <div class="field"><label>البريد الإلكتروني</label><input class="input" id="c-email" placeholder="اختياري" value="${escapeHtml(c.email || '')}"></div>
            <div class="field"><label>ملاحظات</label><input class="input" id="c-note" placeholder="اختياري" value="${escapeHtml(c.note || '')}"></div>`,
            `<button class="btn btn-ghost" id="c-cancel">إلغاء</button>
             <button class="btn btn-primary" id="c-save">حفظ</button>`);

        $('#c-cancel').addEventListener('click', closeModal);
        $('#c-save').addEventListener('click', async () => {
            const name = $('#c-name').value.trim();
            if (!name) return toast('أدخل الاسم', true);

            const phone = $('#c-phone').value.trim();
            if (phone && state.contacts.some((x) => x.phone === phone && x.id !== c.id)) {
                return toast('هذا الجوال مسجّل مسبقاً', true);
            }

            const saveBtn = $('#c-save');
            saveBtn.disabled = true;

            const payload = {
                name, phone,
                email: $('#c-email').value.trim(),
                source: $('#c-source').value,
                note: $('#c-note').value.trim(),
            };

            const saved = isNew ? await createContact(payload) : await updateContact(c.id, payload);

            saveBtn.disabled = false;
            if (!saved) return;

            if (isNew) {
                state.contacts.push(saved);
            } else {
                const idx = state.contacts.findIndex((x) => x.id === c.id);
                if (idx !== -1) state.contacts[idx] = saved;
            }

            // إعادة إدخال رقم محذوف سابقاً تُلغي استبعاده من مزامنة المحادثات
            undismissChatPhone(saved.phone);

            save();
            closeModal();
            toast(isNew ? 'تمت إضافة جهة الاتصال' : 'تم حفظ التعديل');
            renderContacts();
        });
    }

    function openPropertyForm(p) {
        const isNew = !p;
        p = p || { name: '', city: 'الرياض', district: '', rooms: 1, baths: 1, area: 60, floor: 'الأرضي', nightly: 294, status: 'active', img: 'assets/images/living.jpg', platforms: [] };

        openModal(isNew ? 'إضافة وحدة' : 'تعديل الوحدة', `
            <div class="field"><label>اسم الوحدة</label><input class="input" id="p-name" value="${escapeHtml(p.name)}"></div>
            <div class="form-row">
                <div class="field"><label>المدينة</label><input class="input" id="p-city" value="${escapeHtml(p.city)}"></div>
                <div class="field"><label>الحي</label><input class="input" id="p-dist" value="${escapeHtml(p.district)}"></div>
            </div>
            <div class="form-row">
                <div class="field"><label>عدد الغرف</label><input type="number" class="input" id="p-rooms" value="${p.rooms}"></div>
                <div class="field"><label>دورات المياه</label><input type="number" class="input" id="p-baths" value="${p.baths}"></div>
            </div>
            <div class="form-row">
                <div class="field"><label>المساحة (م²)</label><input type="number" class="input" id="p-area" value="${p.area}"></div>
                <div class="field"><label>سعر الليلة</label><input type="number" class="input" id="p-price" value="${p.nightly}"></div>
            </div>
            <div class="field"><label>الحالة</label><select class="input" id="p-status">
                <option value="active">نشطة</option><option value="paused">موقوفة مؤقتاً</option>
            </select></div>`,
            `${isNew ? '' : '<button class="btn btn-ghost" id="p-del" style="color:var(--danger)">حذف</button>'}
             <button class="btn btn-ghost" id="p-cancel">إلغاء</button>
             <button class="btn btn-primary" id="p-save">حفظ</button>`);

        $('#p-status').value = p.status;
        $('#p-cancel').addEventListener('click', closeModal);

        if (!isNew) {
            $('#p-del').addEventListener('click', () => {
                state.properties = state.properties.filter((x) => x.id !== p.id);
                save();
                closeModal();
                renderProperties();
                toast('تم حذف الوحدة');
            });
        }

        $('#p-save').addEventListener('click', () => {
            const name = $('#p-name').value.trim();
            if (!name) return toast('أدخل اسم الوحدة', true);

            const data = {
                name,
                city: $('#p-city').value.trim(),
                district: $('#p-dist').value.trim(),
                rooms: Number($('#p-rooms').value) || 1,
                baths: Number($('#p-baths').value) || 1,
                area: Number($('#p-area').value) || 0,
                nightly: Number($('#p-price').value) || 0,
                status: $('#p-status').value,
            };

            if (isNew) {
                state.properties.push(Object.assign({ id: uid(), floor: 'الأرضي', beds: 1, img: 'assets/images/living.jpg', platforms: [] }, data));
            } else {
                Object.assign(p, data);
            }

            save();
            closeModal();
            renderProperties();
            toast('تم الحفظ');
        });
    }

    function openFeedForm(feed) {
        if (!feed) return;

        openModal('ربط ' + feed.name, `
            <div class="field">
                <label>رابط تقويم iCal الخاص بالمنصة</label>
                <input class="input" id="s-url" value="${escapeHtml(feed.url || '')}" placeholder="https://…/calendar.ics" dir="ltr">
            </div>
            <p style="font-size:12px;color:var(--text-dim);line-height:1.8">
                يُحفظ الرابط للمزامنة. لاستيراد الحجوزات الآن، الصق محتوى ملف ICS في الحقل أدناه أو ارفع الملف —
                لأن متصفحك يمنع القراءة المباشرة من نطاق آخر (CORS).
            </p>
            <div class="field">
                <label>لصق محتوى ملف ICS (اختياري)</label>
                <textarea class="input" id="s-text" placeholder="BEGIN:VCALENDAR…" dir="ltr"></textarea>
            </div>
            <button class="btn btn-ghost btn-sm" id="s-file">📂 رفع ملف .ics بدلاً من ذلك</button>`,
            `<button class="btn btn-ghost" id="s-cancel">إلغاء</button>
             <button class="btn btn-primary" id="s-save">حفظ ومزامنة</button>`);

        $('#s-cancel').addEventListener('click', closeModal);
        $('#s-file').addEventListener('click', () => pickFile('.ics', (text) => {
            $('#s-text').value = text;
            toast('تم تحميل الملف، اضغط حفظ ومزامنة');
        }));

        $('#s-save').addEventListener('click', () => {
            feed.url = $('#s-url').value.trim();
            const text = $('#s-text').value.trim();

            if (text) {
                importICSText(text, feed.name);
                feed.lastSync = new Date().toISOString();
            }

            save();
            closeModal();
            renderCalendar();
            toast('تم حفظ إعدادات المزامنة');
        });
    }

    function pickFile(accept, cb) {
        const input = $('#file-input');
        input.accept = accept;
        input.value = '';
        input.onchange = () => {
            const f = input.files[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = () => cb(String(r.result));
            r.readAsText(f);
        };
        input.click();
    }

    function currentView() {
        const active = $('.view.active');
        return active ? active.id.replace('view-', '') : 'dashboard';
    }

    /* ---------------------------------------------------------------------
       14. ربط الأحداث
       --------------------------------------------------------------------- */
    function bind() {
        $$('.rail-btn').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
        $$('[data-goto]').forEach((b) => b.addEventListener('click', () => go(b.dataset.goto)));

        $('#btn-theme').addEventListener('click', () => {
            state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
            applyTheme();
            save();
            renderView(currentView());
        });

        $('#btn-lang').addEventListener('click', () => {
            state.settings.lang = state.settings.lang === 'ar' ? 'en' : 'ar';
            applyLang();
            save();
            renderView(currentView());
        });

        $('#btn-bell').addEventListener('click', () => go('notifications'));
        $('#btn-new-booking').addEventListener('click', () => openBookingForm());
        // بلا تمرير مباشر: الدالة تستقبل مصروفاً للتعديل، وكائن الحدث سيبدو كأنه مصروف
        $('#btn-add-expense').addEventListener('click', () => openExpenseForm());

        $('#btn-bills-all').addEventListener('click', () => {
            billsExpanded = !billsExpanded;
            renderBills();
        });
        $('#btn-add-contact').addEventListener('click', () => openContactForm());
        $('#btn-add-prop').addEventListener('click', () => openPropertyForm(null));
        $('#contact-search').addEventListener('input', renderContacts);

        $$('#contact-filter button').forEach((b) => {
            b.addEventListener('click', () => {
                contactFilter = b.dataset.cf;
                renderContacts();
            });
        });

        $('#btn-seed-ops').addEventListener('click', (e) => seedOpsContacts(e.currentTarget));
        $('#btn-recalc-fees').addEventListener('click', (e) => recalcCommissions(e.currentTarget));
        $('#btn-migrate-fees').addEventListener('click', (e) => migrateFeeExpenses(e.currentTarget));

        // تبديل الحجوزات القادمة/السابقة في اللوحة
        $$('#upcoming-mode button').forEach((b) => {
            b.addEventListener('click', () => {
                upcomingMode = b.dataset.um;
                renderUpcoming();
            });
        });

        // فلترة تاريخ بطاقة إيرادات السنة
        $$('#year-preset button').forEach((b) => {
            b.addEventListener('click', () => {
                yearRange.preset = b.dataset.yr;
                if (yearRange.preset === 'custom' && !yearRange.from) {
                    const y = new Date().getFullYear();
                    yearRange.from = `${y}-01-01`;
                    yearRange.to = todayISO();
                }
                renderYearRevenue();
            });
        });

        ['#year-from', '#year-to'].forEach((sel) => {
            $(sel).addEventListener('change', () => {
                const from = $('#year-from').value;
                const to = $('#year-to').value;
                if (from && to && from > to) return toast('تاريخ البداية بعد النهاية', true);
                yearRange.preset = 'custom';
                yearRange.from = from;
                yearRange.to = to;
                renderYearRevenue();
            });
        });

        // التقويم
        $('#cal-prev').addEventListener('click', () => { calCursor.setMonth(calCursor.getMonth() - 1); renderCalendar(); });
        $('#cal-next').addEventListener('click', () => { calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar(); });
        $('#cal-today').addEventListener('click', () => { calCursor = new Date(); renderCalendar(); });
        $('#cal-add').addEventListener('click', () => openBookingForm());
        $('#btn-ics-export').addEventListener('click', () => {
            download('calendar.ics', buildICS(), 'text/calendar;charset=utf-8');
            toast('تم تصدير ملف التقويم');
        });
        $('#btn-ics-import').addEventListener('click', () => pickFile('.ics', (t) => importICSText(t, 'ملف مرفوع')));
        $('#btn-add-sync').addEventListener('click', () => {
            const name = prompt('اسم المنصة (مثال: تقويم جوجل)');
            if (!name) return;
            state.syncFeeds.push({ id: uid(), name: name.trim(), url: '', lastSync: '' });
            save();
            renderSyncList();
        });

        // الإشعارات
        $$('#notif-filter button').forEach((b) => {
            b.addEventListener('click', () => {
                notifFilter = b.dataset.f;
                $$('#notif-filter button').forEach((x) => x.classList.toggle('active', x === b));
                renderNotifications();
            });
        });

        $('#btn-read-all').addEventListener('click', () => {
            state.notifications.forEach((n) => { n.read = true; });
            save();
            renderNotifications();
            updateBadges();
            toast('تم تعليم الكل كمقروء');
        });

        // الرسم البياني
        $$('#chart-range button').forEach((b) => {
            b.addEventListener('click', () => {
                chartMonths = Number(b.dataset.months);
                $$('#chart-range button').forEach((x) => x.classList.toggle('active', x === b));
                drawChart();
            });
        });

        // الإعدادات
        $$('#set-lang button').forEach((b) => {
            b.addEventListener('click', () => {
                state.settings.lang = b.dataset.lang;
                applyLang();
                save();
                renderSettings();
                renderView(currentView());
            });
        });

        $('#set-theme').addEventListener('click', () => {
            state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
            applyTheme();
            save();
            renderSettings();
        });

        $('#set-hijri').addEventListener('click', () => {
            state.settings.hijri = !state.settings.hijri;
            save();
            renderSettings();
        });

        $('#set-currency').addEventListener('change', (e) => {
            state.settings.currency = e.target.value;
            save();
            renderView(currentView());
            toast('تم تغيير العملة');
        });

        // تقديرات المصاريف المتغيّرة — الإنترنت والكهرباء والنظافة
        const RATE_FIELDS = {
            'rate-internet-total': { key: 'internetTotal', min: 0, msg: 'تم تحديث إجمالي فاتورة الإنترنت' },
            'rate-internet-shares': { key: 'internetShares', min: 1, msg: 'تم تحديث عدد المشاركين — أُعيد حساب حصتي' },
            'rate-power': { key: 'power', min: 0, msg: 'تم تحديث متوسط الكهرباء' },
            'rate-cleaning': { key: 'cleaning', min: 0, msg: 'تم تحديث متوسط النظافة' },
        };

        Object.keys(RATE_FIELDS).forEach((id) => {
            const el = $('#' + id);
            if (!el) return;
            const f = RATE_FIELDS[id];
            el.addEventListener('change', () => {
                if (!state.rates) state.rates = Object.assign({}, DEFAULT_RATES);
                // عدد المشاركين صحيح دائماً، وبقية المبالغ تقبل الهللات
                const raw = Math.max(f.min, Number(el.value) || 0);
                const v = f.key === 'internetShares' ? Math.round(raw) : round2(raw);
                state.rates[f.key] = v;
                el.value = v;
                save();
                renderSettings();
                if (currentView() === 'dashboard') renderDashboard();
                toast(f.msg);
            });
        });

        $$('[data-pref]').forEach((t) => {
            t.addEventListener('click', () => {
                state.settings[t.dataset.pref] = !state.settings[t.dataset.pref];
                t.classList.toggle('on');
                save();
            });
        });

        // البيانات
        $('#btn-export-data').addEventListener('click', () => {
            download(`backup-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json');
            toast('تم تصدير النسخة الاحتياطية');
        });

        $('#btn-import-data').addEventListener('click', () => pickFile('.json', (text) => {
            try {
                const data = JSON.parse(text);
                if (!data.settings) throw new Error('bad');
                state = data;
                save();
                applyTheme();
                applyLang();
                updateBadges();
                renderView(currentView());
                toast('تم استيراد البيانات');
            } catch (e) {
                toast('الملف غير صالح', true);
            }
        }));

        $('#btn-reset-data').addEventListener('click', () => {
            if (!confirm('سيتم حذف جميع البيانات والعودة للبيانات الافتراضية. متأكد؟')) return;
            state = seed();
            save();
            applyTheme();
            applyLang();
            updateBadges();
            renderView(currentView());
            toast('تمت إعادة التعيين');
        });

        // إغلاق النافذة
        $('#modal-back').addEventListener('click', (e) => { if (e.target.id === 'modal-back') closeModal(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

        // تسجيل الخروج
        const signOutBtn = $('#btn-sign-out');
        if (signOutBtn) signOutBtn.addEventListener('click', async () => {
            if (!confirm('تسجيل الخروج من لوحة التحكم؟')) return;
            const client = window.getSupabaseClient ? window.getSupabaseClient() : null;
            if (client) await client.auth.signOut();
            if (window.OwnerGate) window.OwnerGate.lock();
            stopMessagesRealtime();
            location.reload();
        });
    }

    /* ---------------------------------------------------------------------
       15. الإقلاع
       --------------------------------------------------------------------- */
    async function start() {
        save();            // ثبّت البيانات الأولية عند أول فتح
        applyTheme();
        applyLang();
        bind();
        updateBadges();
        // اعرض الواجهة فوراً، ثم تُحدَّث تلقائياً حالما تصل البيانات من الخادم
        const hash = location.hash.replace('#', '');
        go(PAGE_META[hash] ? hash : 'dashboard');

        loadBookings();            // تحميل الحجوزات الحقيقية من Supabase
        loadExpenses();            // تحميل المصاريف الحقيقية من Supabase
        startMessagesRealtime();   // بث لحظي: رسائل الزوار الجديدة تصل بلا تحديث

        // جهات الاتصال أولاً، حتى تتم مقارنة التكرار قبل مزامنتها من المحادثات
        await loadContacts();
        loadConversations();       // لتحديث شارة الرسائل حتى قبل فتح القسم
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initGate);
    } else {
        initGate();
    }
})();
