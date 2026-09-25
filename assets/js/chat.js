/* ==========================================================================
   محادثة مباشرة مع الزائر — متصلة بقاعدة بيانات Supabase
   - يجب تسجيل الدخول بالاسم الثنائي ورقم الجوال قبل بدء المحادثة
   - رسائل الزائر تُخزَّن في قاعدة البيانات وتصل للمالك في لوحة التحكم فوراً
   - ردود المالك تُسحب بفحص دوري (polling) عبر دالة آمنة (RPC) لأن الزائر
     مجهول الهوية ولا يملك صلاحية قراءة مباشرة على الجداول (انظر سياسات RLS)
   ========================================================================== */
(function () {
    'use strict';

    const OWNER_WA = '966549814764';
    const OWNER_NAME = 'محمد';
    const STORE = 'rhsa_visitor_chat_v2';
    const POLL_MS = 4000;

    const $ = (s, r = document) => r.querySelector(s);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /* ---------- الحالة ---------- */
    let state = load();
    /* رسالة الترحيب والردود الآلية لا تُخزَّن في أي مكان: تُولَّد عند العرض من رسائل
       الزائر نفسها. سابقاً كانت في الذاكرة فقط فتضيع عند إعادة تحميل الصفحة،
       وتبدو أسئلة الزائر بلا إجابة. */
    let pending = [];          // رسائل الزائر قيد الإرسال (عرض فوري قبل تأكيد الحفظ)
    let dbMessages = [];       // الرسائل الحقيقية القادمة من القاعدة
    const REPLY_DELAY = 700;   // مهلة قصيرة قبل ظهور الرد الآلي لرسالة جديدة
    let pollTimer = null;
    let sending = false;

    function load() {
        try {
            const raw = localStorage.getItem(STORE);
            if (raw) return JSON.parse(raw);
        } catch (e) { /* تجاهل البيانات التالفة */ }
        return { name: '', phone: '', conversationId: '' };
    }

    function save() {
        try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* مساحة ممتلئة */ }
    }

    const isLoggedIn = () => Boolean(state.name && state.phone && state.conversationId);

    /* ---------- التحقق من المدخلات ---------- */
    function checkName(v) {
        const parts = v.trim().split(/\s+/).filter((p) => p.length > 1);
        if (parts.length < 2) return 'اكتب الاسم الثنائي (الاسم الأول واسم العائلة)';
        if (!/^[؀-ۿ\sء-يa-zA-Z]+$/.test(v.trim())) return 'الاسم يجب أن يحتوي حروفاً فقط';
        return '';
    }

    function normalizePhone(v) {
        return String(v).replace(/[^\d+]/g, '');
    }

    function checkPhone(v) {
        const d = normalizePhone(v).replace(/^\+?966/, '0');
        if (!/^05\d{8}$/.test(d)) return 'أدخل رقم جوال سعودي صحيح (مثال: 0512345678)';
        return '';
    }

    /* رقم الجوال بصيغة القاعدة: 05xxxxxxxx */
    function dbPhone(v) {
        return normalizePhone(v).replace(/^\+?966/, '0');
    }

    /* ---------- الوقت ---------- */
    function clock(iso) {
        const d = new Date(iso);
        // أرقام لاتينية كبقية أرقام الموقع
        return d.toLocaleTimeString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
    }

    /* ---------- الردود الآلية الفورية (محلية فقط، لا تصل لقاعدة البيانات) ---------- */
    const AUTO = [
        { k: ['سعر', 'كم', 'تكلفة', 'ليلة', 'كلفة'], a: 'سعر الليلة 220 ريال وسط الأسبوع و280 ريال ليلتي الخميس والجمعة، ويقل السعر للإقامات الطويلة. أخبرني بتواريخك وسيرد عليك المالك بالعرض النهائي.' },
        { k: ['متاح', 'متوفر', 'حجز', 'فاضي', 'شاغر'], a: 'وصل طلبك للمالك وسيتحقق من التقويم ويرد عليك خلال دقائق. ما التواريخ التي تريدها؟' },
        { k: ['موقع', 'وين', 'عنوان', 'مكان'], a: 'الشقة في حي السليمانية بالرياض — 7905 عبدالحميد الكاتب، على بعد دقائق من المترو والمستشفيات.' },
        { k: ['واي فاي', 'انترنت', 'إنترنت', 'نت'], a: 'نعم، يوجد إنترنت عالي السرعة مجاني يغطي الشقة بالكامل.' },
        { k: ['موقف', 'سيارة', 'باركن'], a: 'يوجد موقف سيارات مجاني خاص في المبنى.' },
        { k: ['دخول', 'مفتاح', 'استلام', 'تسجيل'], a: 'الدخول ذاتي بقفل ذكي بالبصمة أو الرمز — تستلم الرمز قبل موعد وصولك.' },
        { k: ['مطبخ', 'طبخ'], a: 'المطبخ مجهز بالكامل: ثلاجة، ميكروويف، سخانة، أواني، ومغسلة.' },
    ];

    function autoReply(text) {
        const t = text.toLowerCase();
        const hit = AUTO.find((r) => r.k.some((k) => t.includes(k)));
        return hit ? hit.a : null;
    }

    /* ---------- الاتصال بقاعدة البيانات ---------- */
    function sb() {
        return window.getSupabaseClient ? window.getSupabaseClient() : null;
    }

    async function createConversation(name, phone) {
        const client = sb();
        if (!client) throw new Error('no-client');

        // نولّد المعرّف من المتصفح ونمرره صراحةً بدل الاعتماد على RETURNING:
        // الزائر مجهول لا يملك صلاحية SELECT على الجدول (بحكم سياسات RLS)،
        // وPostgres يتطلب سياسة SELECT إضافية لأي إدراج يطلب RETURNING،
        // فتجنّب هذا المسار أبسط وأكثر أماناً من فتح صلاحية قراءة عامة.
        const id = crypto.randomUUID();

        const { error } = await client
            .from('conversations')
            .insert({ id, visitor_name: name, visitor_phone: dbPhone(phone) });

        if (error) throw error;
        return id;
    }

    async function sendVisitorMessage(text) {
        const client = sb();
        if (!client) throw new Error('no-client');

        const { error } = await client
            .from('messages')
            .insert({ conversation_id: state.conversationId, sender: 'visitor', body: text });

        if (error) throw error;
    }

    async function fetchThread() {
        const client = sb();
        if (!client || !state.conversationId) return null;

        const { data, error } = await client.rpc('fetch_my_thread', {
            p_conversation: state.conversationId,
            p_phone: dbPhone(state.phone),
        });

        if (error) throw error;
        return data;
    }

    /* ---------- الرسم ---------- */
    const panel = () => $('#visitor-chat');

    function renderLogin() {
        panel().innerHTML = head() + `
            <div class="chat-login">
                <h5>مرحباً بك 👋</h5>
                <p>سجّل بياناتك لبدء المحادثة مع المالك مباشرة، أو تواصل عبر الواتساب فوراً.</p>

                <div class="chat-field">
                    <label for="cv-name">الاسم الثنائي</label>
                    <input type="text" id="cv-name" placeholder="مثال: محمد العتيبي" autocomplete="name" value="${esc(state.name)}">
                    <span class="err" id="cv-name-err"></span>
                </div>

                <div class="chat-field">
                    <label for="cv-phone">رقم الجوال</label>
                    <input type="tel" id="cv-phone" placeholder="05xxxxxxxx" dir="ltr" inputmode="tel" autocomplete="tel" value="${esc(state.phone)}">
                    <span class="err" id="cv-phone-err"></span>
                </div>

                <button class="chat-btn" id="cv-start">ابدأ المحادثة</button>
                <span class="err" id="cv-start-err" style="display:block;text-align:center;margin-top:6px"></span>

                <div class="chat-or">أو</div>

                <a class="chat-btn wa" href="https://wa.me/${OWNER_WA}" target="_blank" rel="noopener">
                    التواصل عبر الواتساب مباشرة
                </a>

                <p class="chat-privacy">
                    نستخدم اسمك ورقمك للرد على استفسارك وتأكيد الحجز فقط.
                </p>
            </div>`;

        const name = $('#cv-name');
        const phone = $('#cv-phone');
        const startBtn = $('#cv-start');

        startBtn.addEventListener('click', async () => {
            const ne = checkName(name.value);
            const pe = checkPhone(phone.value);
            $('#cv-name-err').textContent = ne;
            $('#cv-phone-err').textContent = pe;
            $('#cv-start-err').textContent = '';
            if (ne) return name.focus();
            if (pe) return phone.focus();

            const cleanName = name.value.trim().replace(/\s+/g, ' ');
            startBtn.disabled = true;
            startBtn.textContent = 'جارٍ الاتصال…';

            try {
                const id = await createConversation(cleanName, phone.value);
                state.name = cleanName;
                state.phone = normalizePhone(phone.value);
                state.conversationId = id;
                save();
                renderChat();
                startPolling();
            } catch (err) {
                console.error('[chat] فشل إنشاء المحادثة:', err);
                startBtn.disabled = false;
                startBtn.textContent = 'ابدأ المحادثة';
                $('#cv-start-err').textContent = 'تعذّر الاتصال حالياً — استخدم زر الواتساب أدناه.';
            }
        });

        [name, phone].forEach((el) => el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') startBtn.click();
        }));
    }

    function head() {
        return `
            <div class="chat-head">
                <div class="ch-av">${esc(OWNER_NAME.charAt(0))}</div>
                <div class="ch-meta">
                    <h4>${esc(OWNER_NAME)} — مالك الشقة</h4>
                    <span><i></i> يرد عادة خلال دقائق</span>
                </div>
                <button class="ch-x" id="cv-close" aria-label="إغلاق المحادثة">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                        <path d="M18 6 6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>`;
    }

    const QUICK = ['هل الشقة متاحة؟', 'كم سعر الليلة؟', 'أين الموقع بالضبط؟', 'كيف أستلم المفتاح؟'];

    function renderChat() {
        panel().innerHTML = head() + `
            <div class="chat-body" id="cv-body">
                <div class="chat-note">
                    تصلك الردود هنا مباشرة، وعلى الواتساب على الرقم ${esc(state.phone)}
                </div>
                <div id="cv-messages"></div>
            </div>

            <a class="chat-forward" id="cv-forward" target="_blank" rel="noopener" hidden>
                📤 أرسل المحادثة للمالك عبر واتساب
            </a>

            <div class="chat-quick" id="cv-quick"></div>

            <div class="chat-compose">
                <input type="text" id="cv-input" placeholder="اكتب رسالتك…" autocomplete="off">
                <button class="chat-send" id="cv-send" aria-label="إرسال">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M20 4 3 11l6 2.5L11.5 20z"/><path d="M20 4 9.5 13.5"/>
                    </svg>
                </button>
            </div>`;

        renderMessages();

        $('#cv-send').addEventListener('click', send);
        $('#cv-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
        // الأسئلة السريعة: ضغطة واحدة ترسل السؤال، ثم يختفي من القائمة
        $('#cv-quick').addEventListener('click', (e) => {
            const b = e.target.closest('button');
            if (!b || sending) return;
            b.blur();
            $('#cv-input').value = b.textContent;
            send();
        });
    }

    /* تُعرض فقط الأسئلة التي لم يسألها الزائر بعد، ويختفي الشريط إن انتهت */
    function renderQuick(all) {
        const zone = $('#cv-quick');
        if (!zone) return;
        const asked = new Set(all.filter((m) => m.sender === 'visitor').map((m) => String(m.body).trim()));
        const left = QUICK.filter((q) => !asked.has(q));
        zone.innerHTML = left.map((q) => `<button type="button">${esc(q)}</button>`).join('');
        zone.hidden = !left.length;
    }

    function bubble(m) {
        const mine = m.sender === 'visitor';
        return `<div class="chat-msg ${mine ? 'me' : 'them'}">${esc(m.body)}<time>${clock(m.created_at)}</time></div>`;
    }

    let replyTimer = null;

    function renderMessages() {
        const box = $('#cv-messages');
        if (!box) return;

        const thread = dbMessages.concat(pending)
            .slice()
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

        // الترحيب أولاً، ثم كل رسالة زائر يليها ردها الآلي إن وُجد
        const all = [{
            sender: 'owner', created_at: thread.length ? thread[0].created_at : new Date().toISOString(),
            body: `أهلاً ${String(state.name || '').split(' ')[0]} 👋 أنا ${OWNER_NAME}، مالك الشقة. كيف أقدر أساعدك؟`,
        }];
        let waiting = false;
        thread.forEach((m) => {
            all.push(m);
            if (m.sender !== 'visitor') return;
            const reply = autoReply(m.body);
            if (!reply) return;
            if (Date.now() - new Date(m.created_at) < REPLY_DELAY) { waiting = true; return; }
            all.push({ sender: 'owner', body: reply, created_at: m.created_at });
        });

        box.innerHTML = all.map(bubble).join('');
        renderQuick(all);
        scrollDown();

        clearTimeout(replyTimer);
        if (waiting) replyTimer = setTimeout(renderMessages, REPLY_DELAY);
    }

    function scrollDown() {
        const body = $('#cv-body');
        if (body) body.scrollTop = body.scrollHeight;
    }

    async function send() {
        const input = $('#cv-input');
        const text = input.value.trim();
        if (!text || sending) return;

        input.value = '';
        sending = true;

        // عرض فوري (متفائل) قبل تأكيد الحفظ
        const optimistic = { sender: 'visitor', body: text, created_at: new Date().toISOString(), local: true };
        pending.push(optimistic);
        renderMessages();

        try {
            await sendVisitorMessage(text);
            markForwardLink(text);
            await pollOnce();   // يجلب الرسالة من القاعدة ويزيل نسختها المؤقتة
        } catch (err) {
            console.error('[chat] فشل إرسال الرسالة:', err);
            optimistic.body += '  ⚠️ لم تصل — جرّب الواتساب';
            renderMessages();
            markForwardLink(text);
        } finally {
            sending = false;
        }
    }

    /* شريط تحويل احتياطي للواتساب — يبقى متاحاً دائماً */
    function markForwardLink(lastText) {
        const link = $('#cv-forward');
        if (!link) return;

        const summary = [
            'محادثة من الموقع',
            `الاسم: ${state.name}`,
            `الجوال: ${state.phone}`,
            '',
            `• ${lastText}`,
        ].join('\n');

        link.href = `https://wa.me/${OWNER_WA}?text=${encodeURIComponent(summary)}`;
        link.hidden = false;
    }

    /* ---------- الفحص الدوري لردود المالك ---------- */
    async function pollOnce() {
        if (!state.conversationId) return;
        try {
            const rows = await fetchThread();
            if (Array.isArray(rows)) {
                dbMessages = rows;
                pending = pending.filter((p) => !rows.some((m) => m.sender === 'visitor' && m.body === p.body));
                renderMessages();
            }
        } catch (err) {
            console.warn('[chat] تعذّر جلب الردود:', err.message || err);
        }
    }

    function startPolling() {
        stopPolling();
        pollOnce();
        pollTimer = setInterval(pollOnce, POLL_MS);
    }

    function stopPolling() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
    }

    /* ---------- الفتح والإغلاق ---------- */
    /* تثبيت الصفحة خلف المحادثة على الجوال فقط (هي بطاقة تغطي معظم الشاشة هناك):
       overflow:hidden وحده لا يكفي في Safari، فتُثبَّت الصفحة بموضعها ثم تعود إليه */
    let lockedY = null;
    function lockPage(on) {
        const body = document.body;
        if (on && lockedY === null && window.matchMedia('(max-width: 560px)').matches) {
            lockedY = window.scrollY || 0;
            document.documentElement.classList.add('chat-lock');
            body.classList.add('chat-lock-fixed');
            body.style.top = `-${lockedY}px`;
        } else if (!on && lockedY !== null) {
            const y = lockedY;
            lockedY = null;
            document.documentElement.classList.remove('chat-lock');
            body.classList.remove('chat-lock-fixed');
            body.style.top = '';
            window.scrollTo(0, y);
        }
    }

    function open() {
        panel().classList.add('open');
        document.body.classList.add('chat-open');
        lockPage(true);
        $('#chat-launcher').style.display = 'none';

        if (isLoggedIn()) {
            renderChat();
            startPolling();
        } else {
            renderLogin();
        }

        $('#cv-close').addEventListener('click', close);
        const first = $('#cv-input') || $('#cv-name');
        if (first && window.innerWidth > 560) first.focus();
    }

    function close() {
        panel().classList.remove('open');
        document.body.classList.remove('chat-open');
        lockPage(false);
        $('#chat-launcher').style.display = '';
        stopPolling();
    }

    /* ---------- الإقلاع ---------- */
    function start() {
        const launcher = $('#chat-launcher');
        if (!launcher || !panel()) return;
        launcher.addEventListener('click', open);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && panel().classList.contains('open')) close();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) stopPolling();
            else if (panel().classList.contains('open') && isLoggedIn()) startPolling();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
