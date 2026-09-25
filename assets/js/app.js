document.addEventListener('DOMContentLoaded', async () => {
    /* الأيام المحجوزة من تقويم الموقع (يشمل ما استُورد من جاذر إن وAirbnb).
       دالة public_booked_ranges تُعيد التواريخ فقط — بلا أسماء ولا مبالغ (الهجرة 0008).
       عند تعذّر الجلب لا نمنع الزائر: المالك يؤكد التوفر عبر واتساب على أي حال.
       يبدأ الجلب مع فتح الصفحة بالتوازي مع apartments.json. */
    let bookedRanges = [];
    let bookedAt = 0;
    const SB_URL = window.SUPABASE_URL || 'https://divoyxodxkioxugrphby.supabase.co';
    const SB_KEY = window.SUPABASE_ANON_KEY || 'sb_publishable_qw9IiQ52_WFip-4gNX4lkA_CZA0VFzf';

    async function loadBookedRanges() {
        try {
            const r = await fetch(`${SB_URL}/rest/v1/rpc/public_booked_ranges`, {
                method: 'POST',
                headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
                body: '{}',
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const rows = await r.json();
            bookedRanges = (Array.isArray(rows) ? rows : [])
                .filter((b) => b && b.checkin && b.checkout && b.checkout > b.checkin);
            bookedAt = Date.now();
        } catch (e) {
            console.warn('تعذّر جلب الأيام المحجوزة:', e);
        }
    }

    const bookedReady = loadBookedRanges();

    /* الأسعار من القاعدة (الهجرة 0016) — يعدّلها المالك من أداة الجوال:
       سعر وسط الأسبوع والويكند، وأسعار خاصة لليالي المناسبات.
       عند أي خطأ تبقى أسعار apartments.json كما هي */
    async function loadPricing() {
        try {
            const r = await fetch(`${SB_URL}/rest/v1/rpc/public_pricing`, {
                method: 'POST',
                headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
                body: '{}',
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const p = await r.json();
            return p && Number(p.weekday) > 0 && Number(p.weekend) > 0 ? p : null;
        } catch (e) {
            console.warn('تعذّر جلب الأسعار — تُستخدم أسعار الملف:', e);
            return null;
        }
    }
    const pricingReady = loadPricing();

    // 1. Fetch apartments.json data
    let apartmentData = null;
    try {
        const response = await fetch('apartments.json');
        const data = await response.json();
        apartmentData = data.property_info;
    } catch (e) {
        console.error('Error fetching apartments.json:', e);
    }

    if (!apartmentData) return;

    /* 2. التسعير: سعر وسط الأسبوع وسعر الويكند، ويُحسب لكل ليلة على حدة.
          weekend_nights بأرقام getDay (4 = الخميس، 5 = الجمعة).
          السعر يظهر بعد اختيار اليوم، ولا تُملأ تواريخ افتراضية. */
    const pricing = apartmentData.pricing || {};
    let WEEKDAY = Number(pricing.weekday_price) || Number(pricing.price_per_night) || 220;
    let WEEKEND = Number(pricing.weekend_price) || WEEKDAY;
    let OVERRIDES = [];   // [{from, to, price, label}] — ليلة كل يوم من from إلى to شاملاً
    const WEEKEND_NIGHTS = Array.isArray(pricing.weekend_nights) ? pricing.weekend_nights : [4, 5];
    const LOCALE = 'ar-u-ca-gregory-nu-latn';

    const checkinInput = document.getElementById('checkin');
    const checkoutInput = document.getElementById('checkout');
    const checkinView = document.getElementById('checkin-view');
    const checkoutView = document.getElementById('checkout-view');
    const guestsInput = document.getElementById('guests');
    const priceVal = document.getElementById('price-val');
    const priceUnit = document.getElementById('price-unit');
    const priceHint = document.getElementById('price-hint');
    const summaryEl = document.getElementById('calc-summary');
    const nightsCountEl = document.getElementById('nights-count');
    const breakdownEl = document.getElementById('nights-breakdown');
    const totalAmountEl = document.getElementById('total-amount');
    const waBookingBtn = document.getElementById('btn-wa-booking');
    const noteInput = document.getElementById('booking-note');
    const unavailableEl = document.getElementById('booking-unavailable');
    const unavailableHint = document.getElementById('booking-unavailable-hint');
    if (!checkinInput || !checkoutInput) return;

    /* رسالة واتساب منسّقة: تحية للمالك ثم التفاصيل سطراً سطراً بأيقونات،
       والنص بين نجمتين يظهر عريضاً في واتساب. الملاحظات تُضاف فقط إن كُتبت. */
    const WA_PHONE = apartmentData.host.whatsapp || '966549814764';

    /* عدّ الليالي بالعربية: ليلة واحدة، ليلتان، 3–10 ليالٍ، 11 فأكثر ليلة.
       genitive للصيغة بعد حرف جر (لـ ليلتين) */
    const nightsWord = (n, genitive) => (n === 1 ? 'ليلة واحدة'
        : n === 2 ? (genitive ? 'ليلتين' : 'ليلتان')
        : n <= 10 ? `${n} ليالٍ` : `${n} ليلة`);
    const fullDate = (s) => parse(s).toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    function buildWaMessage(d) {
        const note = noteInput ? noteInput.value.trim() : '';
        const lines = ['السلام عليكم، محمد مالك العقار 👋', ''];
        if (!d) {
            lines.push(`أرغب في الاستفسار عن حجز *${apartmentData.title_gathern}* 🏠`);
        } else {
            lines.push(`أرغب في حجز *${apartmentData.title_gathern}* 🏠`, '');
            lines.push(`📅 *الوصول:* ${fullDate(d.ci)}`);
            lines.push(`📅 *المغادرة:* ${fullDate(d.co)}`);
            lines.push(`🌙 *عدد الليالي:* ${nightsWord(d.nights)}`);
            lines.push(`👥 *عدد الضيوف:* ${d.guests}`);
            lines.push(`💰 *الإجمالي التقديري:* ${d.total} ريال`);
            const parts = [];
            if (d.weekdayN) parts.push(`${d.weekdayN} × ${WEEKDAY} وسط الأسبوع`);
            if (d.weekendN) parts.push(`${d.weekendN} × ${WEEKEND} ويكند`);
            (d.events || []).forEach((e) => parts.push(`${e.n} × ${e.price} ${e.label || 'سعر خاص'}`));
            if (parts.length) lines.push(`      ▫️ ${parts.join(' + ')}`);
        }
        if (note) lines.push('', `📝 *ملاحظات:* ${note}`);
        lines.push('', 'شكراً لك 🌷');
        return lines.join('\n');
    }

    function setWaLink(d) {
        if (waBookingBtn) waBookingBtn.href = `https://wa.me/${WA_PHONE}?text=${encodeURIComponent(buildWaMessage(d))}`;
    }

    // التواريخ كنص YYYY-MM-DD وتُفسَّر محلياً (لا UTC) حتى لا يُزاح اليوم
    const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
    const toIso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const addDays = (s, n) => { const dt = parse(s); dt.setDate(dt.getDate() + n); return toIso(dt); };
    // اسم المناسبة يأتي من القاعدة — يُهرَّب قبل إدراجه في HTML
    const escapeText = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // سعر خاص يغطي هذه الليلة (أعلى سعر إن تداخل أكثر من واحد)، وإلا null
    const overrideFor = (dt) => {
        const iso = toIso(dt);
        return OVERRIDES.filter((o) => o.from <= iso && iso <= o.to)
            .sort((a, b) => b.price - a.price)[0] || null;
    };
    const nightPrice = (dt) => {
        const o = overrideFor(dt);
        if (o) return Number(o.price);
        return WEEKEND_NIGHTS.indexOf(dt.getDay()) !== -1 ? WEEKEND : WEEKDAY;
    };
    const isWeekend = (dt) => WEEKEND_NIGHTS.indexOf(dt.getDay()) !== -1;
    const fmt = (s) => parse(s).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' });
    const dayName = (s) => parse(s).toLocaleDateString(LOCALE, { weekday: 'long' });

    // تحديث صامت إن مرّت دقيقتان منذ آخر جلب — الحجوزات قد تتغير والصفحة مفتوحة
    function refreshBookedIfStale() {
        if (Date.now() - bookedAt > 120000) loadBookedRanges().then(calculateBooking);
    }

    // [ci, co) يتعارض مع حجز إذا تقاطعت الليالي؛ يوم المغادرة نفسه متاح لوصول جديد
    const conflictsWith = (ci, co) => bookedRanges.filter((b) => ci < b.checkout && co > b.checkin);

    // أول يوم متاح بعد الحجوزات المتتالية التي تغطي الفترة المختارة
    function nextFreeDay(ci) {
        let day = ci;
        for (let guard = 0; guard < 60; guard++) {
            const hit = bookedRanges.find((b) => day >= b.checkin && day < b.checkout);
            if (!hit) return day;
            day = hit.checkout;
        }
        return null;
    }

    const todayIso = toIso(new Date());
    checkinInput.min = todayIso;
    checkoutInput.min = addDays(todayIso, 1);

    // على الحاسوب لا يفتح النقر على حقل التاريخ التقويمَ تلقائياً؛ showPicker يفتحه
    [checkinInput, checkoutInput].forEach((inp) => {
        inp.addEventListener('click', () => { try { inp.showPicker && inp.showPicker(); } catch (e) { /* غير مدعوم */ } });
    });

    function setView(el, value) {
        if (!el) return;
        // التاريخ في سطر واسم اليوم تحته — يتسع للشاشات الضيقة دون قص
        el.textContent = value ? fmt(value) : 'اختر التاريخ';
        if (value) {
            const day = document.createElement('small');
            day.className = 'date-day';
            day.textContent = dayName(value);
            el.appendChild(day);
        }
        el.classList.toggle('is-empty', !value);
    }

    function calculateBooking() {
        const ci = checkinInput.value;
        const co = checkoutInput.value;
        setView(checkinView, ci);
        setView(checkoutView, co);

        const guests = guestsInput ? guestsInput.value : 1;

        // تعارض مع حجز قائم: تنبيه وتعطيل زر الواتساب بدل عرض السعر
        const clash = ci && co && co > ci ? conflictsWith(ci, co) : [];
        if (unavailableEl) unavailableEl.hidden = !clash.length;
        if (waBookingBtn) {
            waBookingBtn.classList.toggle('is-disabled', !!clash.length);
            waBookingBtn.setAttribute('aria-disabled', clash.length ? 'true' : 'false');
        }
        if (clash.length) {
            const free = nextFreeDay(ci);
            if (unavailableHint) {
                unavailableHint.textContent = free && free !== ci
                    ? `أقرب موعد وصول متاح: ${fmt(free)} (${dayName(free)})`
                    : 'يرجى اختيار تواريخ أخرى';
            }
            priceVal.textContent = WEEKDAY;
            priceUnit.textContent = 'ريال / ليلة وسط الأسبوع';
            priceHint.hidden = true;
            summaryEl.hidden = true;
            setWaLink(null);
            return;
        }

        if (!ci || !co || co <= ci) {
            // قبل اختيار الأيام: السعر المرجعي فقط
            priceVal.textContent = WEEKDAY;
            priceUnit.textContent = 'ريال / ليلة وسط الأسبوع';
            priceHint.hidden = false;
            summaryEl.hidden = true;
            setWaLink(null);
            return;
        }

        // سعر كل ليلة من ليلة الوصول حتى الليلة السابقة للمغادرة
        let weekdayN = 0, weekendN = 0, total = 0;
        const events = [];   // ليالي الأسعار الخاصة مجمّعة حسب المناسبة
        for (let d = parse(ci); toIso(d) < co; d.setDate(d.getDate() + 1)) {
            total += nightPrice(d);
            const o = overrideFor(d);
            if (o) {
                const g = events.find((e) => e.key === o.from + o.to);
                if (g) g.n++; else events.push({ key: o.from + o.to, n: 1, price: Number(o.price), label: o.label });
            } else if (isWeekend(d)) weekendN++; else weekdayN++;
        }
        const nights = weekdayN + weekendN + events.reduce((s, e) => s + e.n, 0);

        if (nights === 1) {
            priceVal.textContent = total;
            priceUnit.textContent = `ريال / ليلة ${dayName(ci)}`;
        } else {
            priceVal.textContent = total;
            priceUnit.textContent = `ريال لـ ${nightsWord(nights, true)}`;
        }
        priceHint.hidden = true;

        summaryEl.hidden = false;
        nightsCountEl.textContent = nightsWord(nights);
        breakdownEl.innerHTML = [
            weekdayN ? `<div class="calc-row calc-sub"><span>${weekdayN} × وسط الأسبوع</span><span>${weekdayN * WEEKDAY} ريال</span></div>` : '',
            weekendN ? `<div class="calc-row calc-sub"><span>${weekendN} × ويكند</span><span>${weekendN * WEEKEND} ريال</span></div>` : '',
            ...events.map((e) => `<div class="calc-row calc-sub"><span>${e.n} × ${escapeText(e.label || 'سعر خاص')}</span><span>${e.n * e.price} ريال</span></div>`),
        ].join('');
        totalAmountEl.textContent = `${total} ريال`;

        setWaLink({ ci, co, nights, guests, total, weekdayN, weekendN, events });
    }

    // اختيار يوم الوصول يكفي لحجز ليلة واحدة: المغادرة تُضبط تلقائياً لليوم التالي
    checkinInput.addEventListener('change', () => {
        const ci = checkinInput.value;
        if (ci) {
            checkoutInput.min = addDays(ci, 1);
            if (!checkoutInput.value || checkoutInput.value <= ci) checkoutInput.value = addDays(ci, 1);
        }
        calculateBooking();
        refreshBookedIfStale();
    });
    checkoutInput.addEventListener('change', () => { calculateBooking(); refreshBookedIfStale(); });
    if (guestsInput) guestsInput.addEventListener('change', calculateBooking);
    if (noteInput) noteInput.addEventListener('input', calculateBooking);
    // حماية إضافية: لا يُفتح واتساب إن كانت الأيام محجوزة
    if (waBookingBtn) {
        waBookingBtn.addEventListener('click', (e) => {
            if (waBookingBtn.classList.contains('is-disabled')) e.preventDefault();
        });
    }

    calculateBooking();
    bookedReady.then(calculateBooking);
    pricingReady.then((p) => {
        if (!p) return;
        WEEKDAY = Number(p.weekday);
        WEEKEND = Number(p.weekend);
        OVERRIDES = (Array.isArray(p.overrides) ? p.overrides : [])
            .filter((o) => o && o.from && o.to && Number(o.price) > 0);
        if (priceHint) priceHint.textContent = `ليلتا الخميس والجمعة ${WEEKEND} ريال • اختر تاريخ الوصول لعرض السعر`;
        calculateBooking();
    });
});

/* ============================================================
   ظهور تدريجي للأقسام عند التمرير
   يُضاف الصنف بالسكربت فقط، فإن تعطّل السكربت تبقى الأقسام ظاهرة.
   يُتجاوز لمن فعّل تقليل الحركة في جهازه.
   ============================================================ */
(function () {
    if (!('IntersectionObserver' in window)) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    function init() {
        const els = document.querySelectorAll('.gallery-grid, .card-section, .booking-widget, .site-footer');
        const io = new IntersectionObserver((entries) => {
            entries.forEach((e) => {
                if (!e.isIntersecting) return;
                e.target.classList.add('in');
                io.unobserve(e.target);
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

        els.forEach((el) => {
            el.classList.add('reveal');
            io.observe(el);
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();

/* ============================================================
   إبقاء عناوين المنصات واسم المضيف في سطر واحد دائماً
   يُصغّر حجم الخط تدريجياً حتى يتّسع النص كاملاً بدون قص
   ============================================================ */
(function () {
    const TARGETS = [
        { sel: '.title-card h2', max: 18, min: 9 },
        { sel: '.host-details h3', max: 16, min: 9 }
    ];

    function fitOneLine() {
        TARGETS.forEach(({ sel, max, min }) => {
            document.querySelectorAll(sel).forEach(el => {
                let size = max;
                el.style.fontSize = size + 'px';
                /* التقليص خطوة نصف بكسل حتى يختفي الفائض */
                while (el.scrollWidth > el.clientWidth && size > min) {
                    size -= 0.5;
                    el.style.fontSize = size + 'px';
                }
            });
        });
    }

    window.addEventListener('load', fitOneLine);
    window.addEventListener('resize', fitOneLine);
    document.addEventListener('DOMContentLoaded', fitOneLine);
})();

/* ============================================================
   عارض الصور بملء الشاشة (Lightbox) — بدون فتح تبويب جديد
   ============================================================ */
(function () {
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxCaption = document.getElementById('lightbox-caption');
    const closeBtn = document.getElementById('lightbox-close');
    if (!lightbox || !lightboxImg) return;

    function open(img) {
        lightboxImg.src = img.currentSrc || img.src;
        lightboxImg.alt = img.alt || '';
        const figcaption = img.closest('figure')?.querySelector('.gallery-caption');
        lightboxCaption.textContent = figcaption ? figcaption.textContent : (img.alt || '');
        document.body.classList.add('lightbox-open');
        requestAnimationFrame(() => lightbox.classList.add('open'));
    }

    function close() {
        lightbox.classList.remove('open');
        document.body.classList.remove('lightbox-open');
        setTimeout(() => { lightboxImg.src = ''; }, 250);
    }

    document.querySelectorAll('.gallery-img').forEach((img) => {
        img.style.cursor = 'zoom-in';
        img.addEventListener('click', () => open(img));
    });

    closeBtn?.addEventListener('click', close);
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) close();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && lightbox.classList.contains('open')) close();
    });
})();
