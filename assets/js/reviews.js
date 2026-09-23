/* ==========================================================================
   تقييمات الضيوف — متصلة بقاعدة بيانات Supabase (الهجرة 0009)
   - الزائر يختار من 1 إلى 5 نجوم، ويكتب اسمه الثنائي وتعليقاً اختيارياً
   - الإرسال عبر دالة submit_review (تتحقق من المدخلات وتحد من الإغراق)
   - التقييم يُحفظ بانتظار اعتماد المالك من لوحة التحكم، ثم يظهر هنا
   - العرض يقرأ المعتمَد فقط (سياسة RLS)، فلا يرى الزائر المعلّق ولا المحذوف
   ========================================================================== */
(function () {
    'use strict';

    const SB_URL = window.SUPABASE_URL || 'https://divoyxodxkioxugrphby.supabase.co';
    const SB_KEY = window.SUPABASE_ANON_KEY || 'sb_publishable_qw9IiQ52_WFip-4gNX4lkA_CZA0VFzf';
    const HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };
    const SENT_KEY = 'rhsa_review_sent';
    const SHOW = 6;
    const LABELS = ['اختر تقييمك', 'سيئ', 'مقبول', 'جيد', 'جيد جداً', 'ممتاز'];
    const STAR = '<svg viewBox="0 0 24 24"><path d="M12 3.2l2.7 5.5 6 .9-4.35 4.25 1.03 6-5.38-2.83-5.38 2.83 1.03-6L3.3 9.6l6-.9z"/></svg>';

    const $ = (s) => document.querySelector(s);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // التخزين المحلي قد يكون محجوباً (تصفح خاص) — لا يتوقف شيء بسببه
    const store = {
        get() { try { return localStorage.getItem(SENT_KEY); } catch (e) { return null; } },
        set(v) { try { localStorage.setItem(SENT_KEY, v); } catch (e) { /* تجاهل */ } },
    };

    const starsHtml = (n) => Array.from({ length: 5 }, (_, i) => `<i class="${i < n ? 'on' : ''}">${STAR}</i>`).join('');

    function timeAgo(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        return d.toLocaleDateString('ar-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric' });
    }

    /* ---------- العرض ---------- */
    async function loadReviews() {
        const list = $('#reviews-list');
        try {
            const r = await fetch(`${SB_URL}/rest/v1/reviews?select=name,rating,comment,created_at&approved=eq.true&order=created_at.desc&limit=200`,
                { headers: HEADERS });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const rows = await r.json();
            if (!Array.isArray(rows) || !rows.length) return;

            const avg = rows.reduce((s, x) => s + Number(x.rating || 0), 0) / rows.length;
            $('#reviews-avg').textContent = avg.toFixed(1);
            $('#reviews-avg-stars').innerHTML = starsHtml(Math.round(avg));
            $('#reviews-count').textContent = rows.length === 1 ? 'تقييم واحد'
                : rows.length === 2 ? 'تقييمان'
                : rows.length <= 10 ? `${rows.length} تقييمات` : `${rows.length} تقييماً`;
            $('#reviews-summary').hidden = false;

            // أحدث 6 تقييمات ظاهرة، والبقية خلف زر «عرض المزيد»؛ المتوسط من الكل
            list.innerHTML = rows.map((x, i) => `
                <article class="review-card"${i >= SHOW ? ' hidden' : ''}>
                    <header>
                        <span class="review-avatar">${esc(String(x.name || '؟').trim().charAt(0))}</span>
                        <div>
                            <b>${esc(x.name)}</b>
                            <small>${esc(timeAgo(x.created_at))}</small>
                        </div>
                        <span class="stars-static" aria-label="${x.rating} من 5">${starsHtml(Number(x.rating) || 0)}</span>
                    </header>
                    ${x.comment ? `<p>${esc(x.comment)}</p>` : ''}
                </article>`).join('')
                + (rows.length > SHOW ? `<button type="button" class="reviews-more" id="reviews-more">عرض كل التقييمات (${rows.length})</button>` : '');
            const more = $('#reviews-more');
            if (more) {
                more.addEventListener('click', () => {
                    list.querySelectorAll('.review-card[hidden]').forEach((el) => { el.hidden = false; });
                    more.remove();
                });
            }
        } catch (e) {
            // الجدول غير موجود بعد أو انقطاع — تبقى رسالة «كن أول من يقيّم»
            console.warn('تعذّر تحميل التقييمات:', e);
        }
    }

    /* ---------- النموذج ---------- */
    function initForm() {
        const form = $('#review-form');
        if (!form) return;
        const picker = $('#star-picker');
        const btns = Array.from(picker.querySelectorAll('button'));
        const label = $('#star-label');
        const msg = $('#review-msg');
        const submit = $('#review-submit');
        let rating = 0;

        const paint = (n) => btns.forEach((b, i) => b.classList.toggle('on', i < n));
        const showMsg = (text, ok) => {
            msg.textContent = text;
            msg.className = 'review-msg ' + (ok ? 'ok' : 'err');
            msg.hidden = false;
        };

        btns.forEach((b) => {
            const v = Number(b.dataset.v);
            b.addEventListener('click', () => {
                rating = v;
                paint(v);
                btns.forEach((x) => x.setAttribute('aria-checked', String(x === b)));
                label.textContent = LABELS[v];
                label.classList.add('picked');
            });
            b.addEventListener('mouseenter', () => { paint(v); label.textContent = LABELS[v]; });
        });
        picker.addEventListener('mouseleave', () => { paint(rating); label.textContent = LABELS[rating]; });

        if (store.get()) {
            showMsg('شكراً لك! وصلنا تقييمك وسيظهر بعد المراجعة 🌷', true);
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if ($('#review-hp').value) return;   // روبوت ملأ حقل الفخ

            const name = $('#review-name').value.trim().replace(/\s+/g, ' ');
            const comment = $('#review-comment').value.trim();

            if (!rating) return showMsg('اختر عدد النجوم أولاً', false);
            if (!/^\S{2,}( \S{2,})+$/.test(name)) return showMsg('اكتب اسمك الثنائي (الاسم واسم العائلة)', false);

            submit.disabled = true;
            submit.textContent = 'جارٍ الإرسال…';
            try {
                const r = await fetch(`${SB_URL}/rest/v1/rpc/submit_review`, {
                    method: 'POST',
                    headers: HEADERS,
                    body: JSON.stringify({ p_name: name, p_rating: rating, p_comment: comment || null }),
                });
                if (!r.ok) {
                    const body = await r.json().catch(() => ({}));
                    const m = String(body.message || '');
                    if (m.includes('duplicate')) throw new Error('وصلنا تقييم بهذا الاسم اليوم، شكراً لك');
                    if (m.includes('too many')) throw new Error('ضغط كبير حالياً، حاول بعد قليل');
                    if (m.includes('invalid name')) throw new Error('اكتب اسمك الثنائي (الاسم واسم العائلة)');
                    throw new Error('تعذّر الإرسال، حاول مرة أخرى');
                }
                store.set(new Date().toISOString());
                form.reset();
                rating = 0;
                paint(0);
                btns.forEach((x) => x.setAttribute('aria-checked', 'false'));
                label.textContent = LABELS[0];
                label.classList.remove('picked');
                showMsg('شكراً لك! وصلنا تقييمك وسيظهر بعد المراجعة 🌷', true);
            } catch (err) {
                showMsg(err.message || 'تعذّر الإرسال، حاول مرة أخرى', false);
            } finally {
                submit.disabled = false;
                submit.textContent = 'إرسال التقييم';
            }
        });
    }

    function init() {
        initForm();
        loadReviews();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
