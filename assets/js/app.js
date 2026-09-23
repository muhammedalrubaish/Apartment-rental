document.addEventListener('DOMContentLoaded', async () => {
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
    const WEEKDAY = Number(pricing.weekday_price) || Number(pricing.price_per_night) || 220;
    const WEEKEND = Number(pricing.weekend_price) || WEEKDAY;
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
    const nightPrice = (dt) => (WEEKEND_NIGHTS.indexOf(dt.getDay()) !== -1 ? WEEKEND : WEEKDAY);
    const isWeekend = (dt) => WEEKEND_NIGHTS.indexOf(dt.getDay()) !== -1;
    const fmt = (s) => parse(s).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' });
    const dayName = (s) => parse(s).toLocaleDateString(LOCALE, { weekday: 'long' });

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
        for (let d = parse(ci); toIso(d) < co; d.setDate(d.getDate() + 1)) {
            total += nightPrice(d);
            if (isWeekend(d)) weekendN++; else weekdayN++;
        }
        const nights = weekdayN + weekendN;

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
        ].join('');
        totalAmountEl.textContent = `${total} ريال`;

        setWaLink({ ci, co, nights, guests, total, weekdayN, weekendN });
    }

    // اختيار يوم الوصول يكفي لحجز ليلة واحدة: المغادرة تُضبط تلقائياً لليوم التالي
    checkinInput.addEventListener('change', () => {
        const ci = checkinInput.value;
        if (ci) {
            checkoutInput.min = addDays(ci, 1);
            if (!checkoutInput.value || checkoutInput.value <= ci) checkoutInput.value = addDays(ci, 1);
        }
        calculateBooking();
    });
    checkoutInput.addEventListener('change', calculateBooking);
    if (guestsInput) guestsInput.addEventListener('change', calculateBooking);
    if (noteInput) noteInput.addEventListener('input', calculateBooking);

    calculateBooking();
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
