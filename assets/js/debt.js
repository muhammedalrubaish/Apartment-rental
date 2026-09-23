/* ============================================================
   حاسبة تحصيل الدين — صفحة خاصة بالمالك
   الدخول: كلمة مرور حساب المالك في Supabase (تُتحقق على الخادم)، أو الوجه/البصمة
   على جهاز سبق تفعيله فيه، أو جلسة مفتوحة من لوحة التحكم (owner-gate.js).
   أُزيلت كلمة السر الخاصة بهذه الصفحة وبصمتها SHA-256: كانتا في هذا الملف العام،
   والبصمة لرمز قصير تُكسر بالتجربة في ثوانٍ.
   ============================================================ */

const SESSION_KEY = 'debt_unlocked_v1';
const PAYMENTS_KEY = 'debt_payments_v1';
const BOOKINGS_KEY = 'debt_bookings_v1';
const PLATFORMS_KEY = 'debt_platforms_v1';

/* التطبيقات الحالية — تُضاف غيرها من داخل الصفحة */
const DEFAULT_PLATFORMS = ['جاذر ان (Gathern)', 'Airbnb', 'بوكينق (Booking)'];

/* نموذج عمولة المنصات (جاذر ان / Airbnb / بوكينق)
   مستنتج من الأمثلة: 269 ← 33 ، 139 ← 24  */
const FEE_BASE = 14.38;
const FEE_RATE = 0.0692;

const MONTH_NAMES = ['الشهر 1', 'الشهر 2', 'الشهر 3', 'الشهر 4', 'الشهر 5', 'الشهر 6',
    'الشهر 7', 'الشهر 8', 'الشهر 9', 'الشهر 10', 'الشهر 11', 'الشهر 12',
    'الشهر 13', 'الشهر 14', 'الشهر 15', 'الشهر 16', 'الشهر 17', 'الشهر 18',
    'الشهر 19', 'الشهر 20', 'الشهر 21', 'الشهر 22', 'الشهر 23', 'الشهر 24'];

/* ---------- أدوات مساعدة ---------- */


const fmt = n => (Math.round(n * 100) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 0, maximumFractionDigits: 2
});

const sar = n => `${fmt(n)} ريال`;

const num = id => {
    const el = document.getElementById(id);
    const v = parseFloat(el && el.value);
    return isNaN(v) ? 0 : v;
};

const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
};

/* ---------- شاشة كلمة السر ---------- */

function unlock() {
    document.getElementById('lock-screen').style.display = 'none';
    const app = document.getElementById('debt-app');
    app.hidden = false;
    sessionStorage.setItem(SESSION_KEY, '1');
    if (window.OwnerGate) window.OwnerGate.markUnlocked();
    initApp();
    maybeOfferBiometric();
}

// عرض تفعيل الوجه بزر حقيقي (لا confirm) — iPhone يرفض التسجيل خارج ضغطة المستخدم
function maybeOfferBiometric() {
    const gate = window.OwnerGate;
    if (!gate || !gate.offerBiometric) return;
    setTimeout(() => gate.offerBiometric(), 800);
}

function initLock() {
    const form = document.getElementById('lock-form');
    const input = document.getElementById('lock-input');
    const error = document.getElementById('lock-error');
    const bioBtn = document.getElementById('lock-biometric');
    const gate = window.OwnerGate;

    // جلسة موحّدة مع لوحة التحكم، أو جلسة محلية سابقة لهذه الصفحة
    if ((gate && gate.isSessionValid()) || sessionStorage.getItem(SESSION_KEY) === '1') {
        unlock();
        return;
    }

    let faceFirst = false;   // الوجه معروض أولاً — لا نفتح لوحة المفاتيح فوقه
    if (bioBtn && gate && gate.hasBiometricSupport() && gate.hasRegisteredBiometric()) {
        const tryFace = async () => {
            bioBtn.disabled = true;
            bioBtn.textContent = 'جارٍ التحقق بالوجه…';
            const ok = await gate.tryBiometric();
            bioBtn.disabled = false;
            bioBtn.textContent = '🙂 الدخول بالوجه';
            if (ok) return unlock();
            error.textContent = 'اضغط «الدخول بالوجه» للمحاولة مجدداً، أو أدخل كلمة المرور';
        };
        bioBtn.hidden = false;
        bioBtn.textContent = '🙂 الدخول بالوجه';
        bioBtn.addEventListener('click', tryFace);
        // محاولة تلقائية عند الفتح؛ إن اشترط المتصفح ضغطة يبقى الزر ظاهراً
        faceFirst = true;
        tryFace();
    }

    /* الرموز الثابتة أُزيلت (كانت مكتوبة في ملف عام). الدخول بكلمة مرور حساب
       المالك في Supabase فقط — كلمة واحدة لكل الصفحات، يتحقق منها الخادم */
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const raw = input.value.trim();
        if (!raw) return;

        const client = getSB();
        if (!client) {
            error.textContent = '⛔ تعذّر الاتصال بالخادم — تحقق من الإنترنت';
            return;
        }
        if (gate && gate.signInOwner && client) {
            try {
                const { error: authErr } = await gate.signInOwner(client, raw);
                if (!authErr) return unlock();
            } catch (err) {
                console.warn('[lock] تعذّر التحقق من كلمة المرور:', err);
            }
        }

        error.textContent = '⛔ كلمة المرور غير صحيحة — تعذّر فتح الملف.';
        input.value = '';
        input.focus();
    });

    if (!faceFirst) input.focus();
}

/* ---------- مزامنة Supabase السحابية ---------- */

function getSB() {
    return (window.getSupabaseClient && typeof window.getSupabaseClient === 'function')
        ? window.getSupabaseClient()
        : null;
}

async function syncFromSupabase() {
    const sb = getSB();
    if (!sb) return;

    try {
        // 1. جلب الدفعات
        const { data: pData, error: pErr } = await sb.from('debt_payments').select('*').order('date', { ascending: true });
        if (!pErr && pData && pData.length) {
            localStorage.setItem(PAYMENTS_KEY, JSON.stringify(pData));
        } else if (!pErr && pData && pData.length === 0) {
            // مزامنة الدفعات المحلية الأولية إلى Supabase إن وُجدت
            const localP = loadStore(PAYMENTS_KEY, []);
            if (localP.length > 0) {
                await sb.from('debt_payments').upsert(localP.map(p => ({
                    id: p.id,
                    date: p.date,
                    amount: p.amount,
                    note: p.note || ''
                })));
            }
        }

        // 2. جلب الحجوزات
        const { data: bData, error: bErr } = await sb.from('debt_bookings').select('*').order('date', { ascending: false });
        if (!bErr && bData && bData.length) {
            localStorage.setItem(BOOKINGS_KEY, JSON.stringify(bData));
        } else if (!bErr && bData && bData.length === 0) {
            const localB = loadStore(BOOKINGS_KEY, []);
            if (localB.length > 0) {
                await sb.from('debt_bookings').upsert(localB.map(b => ({
                    id: b.id,
                    date: b.date,
                    platform: b.platform,
                    method: b.method || 'platform',
                    nights: b.nights || 1,
                    amount: b.amount,
                    fee: b.fee || 0,
                    note: b.note || ''
                })));
            }
        }

        // 3. جلب المنصات
        const { data: sData, error: sErr } = await sb.from('debt_settings').select('*').eq('key', 'platforms').maybeSingle();
        if (!sErr && sData && sData.value && Array.isArray(sData.value)) {
            localStorage.setItem(PLATFORMS_KEY, JSON.stringify(sData.value));
        }

        recalc();
        renderPlatformOptions();
    } catch (err) {
        console.warn('[debt-sync] تعذر الاتصال بـ Supabase:', err);
    }
}

/* ---------- الدفعات ---------- */

function loadPayments() {
    try {
        const raw = localStorage.getItem(PAYMENTS_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}

function savePayments(list) {
    localStorage.setItem(PAYMENTS_KEY, JSON.stringify(list));
    const sb = getSB();
    if (sb) {
        // حفظ ومزامنة في Supabase
        sb.from('debt_payments').select('id').then(({ data }) => {
            const existingIds = (data || []).map(x => x.id);
            const currentIds = list.map(x => x.id);
            const toDelete = existingIds.filter(id => !currentIds.includes(id));
            if (toDelete.length) {
                sb.from('debt_payments').delete().in('id', toDelete).then();
            }
            if (list.length) {
                sb.from('debt_payments').upsert(list.map(p => ({
                    id: p.id,
                    date: p.date,
                    amount: p.amount,
                    note: p.note || ''
                }))).then();
            }
        });
    }
}

function renderPayments(debtTotal) {
    const body = document.getElementById('payments-body');
    const list = loadPayments().slice().sort((a, b) => a.date.localeCompare(b.date));
    body.innerHTML = '';

    if (!list.length) {
        body.innerHTML = '<tr><td colspan="5" class="empty-row">لا توجد دفعات مسجلة بعد.</td></tr>';
        return 0;
    }

    let running = 0;
    list.forEach((p) => {
        running += p.amount;
        const remaining = Math.max(debtTotal - running, 0);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${p.date}</td>
            <td class="num">${sar(p.amount)}</td>
            <td>${p.note ? p.note.replace(/[<>]/g, '') : '—'}</td>
            <td class="num">${sar(remaining)}</td>
            <td><button type="button" class="btn-x" data-id="${p.id}">حذف</button></td>`;
        body.appendChild(tr);
    });

    body.querySelectorAll('.btn-x').forEach(btn => {
        btn.addEventListener('click', () => {
            savePayments(loadPayments().filter(x => String(x.id) !== btn.dataset.id));
            recalc();
        });
    });

    return running;
}

/* ---------- الحجوزات والمنصات ---------- */

function loadStore(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        const val = raw ? JSON.parse(raw) : null;
        return Array.isArray(val) ? val : fallback;
    } catch (e) {
        return fallback;
    }
}

const loadBookings = () => loadStore(BOOKINGS_KEY, []);
function saveBookings(list) {
    localStorage.setItem(BOOKINGS_KEY, JSON.stringify(list));
    const sb = getSB();
    if (sb) {
        sb.from('debt_bookings').select('id').then(({ data }) => {
            const existingIds = (data || []).map(x => x.id);
            const currentIds = list.map(x => x.id);
            const toDelete = existingIds.filter(id => !currentIds.includes(id));
            if (toDelete.length) {
                sb.from('debt_bookings').delete().in('id', toDelete).then();
            }
            if (list.length) {
                sb.from('debt_bookings').upsert(list.map(b => ({
                    id: b.id,
                    date: b.date,
                    platform: b.platform,
                    method: b.method || 'platform',
                    nights: b.nights || 1,
                    amount: b.amount,
                    fee: b.fee || 0,
                    note: b.note || ''
                }))).then();
            }
        });
    }
}

const loadPlatforms = () => loadStore(PLATFORMS_KEY, DEFAULT_PLATFORMS.slice());
function savePlatforms(list) {
    localStorage.setItem(PLATFORMS_KEY, JSON.stringify(list));
    const sb = getSB();
    if (sb) {
        sb.from('debt_settings').upsert({
            key: 'platforms',
            value: list,
            updated_at: new Date().toISOString()
        }).then();
    }
}

function renderPlatformOptions() {
    const select = document.getElementById('bk-platform');
    const current = select.value;
    const list = loadPlatforms();
    select.innerHTML = '';
    list.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
    });
    if (list.includes(current)) select.value = current;

    /* شرائح التطبيقات مع إمكانية حذف المضاف */
    const chips = document.getElementById('platform-chips');
    chips.innerHTML = '';
    list.forEach(name => {
        const chip = document.createElement('span');
        chip.className = 'chip-tag';
        const isDefault = DEFAULT_PLATFORMS.includes(name);
        chip.innerHTML = `${name}${isDefault ? '' : ' <button type="button" class="chip-del" data-name="' + name + '">×</button>'}`;
        chips.appendChild(chip);
    });

    chips.querySelectorAll('.chip-del').forEach(btn => {
        btn.addEventListener('click', () => {
            const name = btn.dataset.name;
            const used = loadBookings().some(b => b.platform === name);
            if (used) {
                alert(`لا يمكن حذف "${name}" لوجود حجوزات مسجلة عليه.`);
                return;
            }
            savePlatforms(loadPlatforms().filter(p => p !== name));
            renderPlatformOptions();
        });
    });
}

function renderBookings() {
    const body = document.getElementById('bookings-body');
    const list = loadBookings().slice().sort((a, b) => a.date.localeCompare(b.date));
    body.innerHTML = '';

    let gross = 0, fees = 0, nights = 0;
    const byPlatform = {};

    if (!list.length) {
        body.innerHTML = '<tr><td colspan="9" class="empty-row">لا توجد حجوزات مسجلة بعد.</td></tr>';
    } else {
        list.forEach(bk => {
            const net = bk.amount - bk.fee;
            gross += bk.amount;
            fees += bk.fee;
            nights += bk.nights;

            const agg = byPlatform[bk.platform] || (byPlatform[bk.platform] = { count: 0, gross: 0, fee: 0 });
            agg.count++;
            agg.gross += bk.amount;
            agg.fee += bk.fee;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${bk.date}</td>
                <td>${esc(bk.platform)}</td>
                <td><span class="pill ${methodPill(bk.method)}">${esc(bk.method)}</span></td>
                <td class="num">${bk.nights}</td>
                <td class="num">${fmt(bk.amount)}</td>
                <td class="num red">${fmt(bk.fee)}</td>
                <td class="num green">${fmt(net)}</td>
                <td>${bk.note ? esc(bk.note) : '—'}</td>
                <td><button type="button" class="btn-x" data-id="${bk.id}">حذف</button></td>`;
            body.appendChild(tr);
        });

        const foot = document.createElement('tr');
        foot.className = 'total-row';
        foot.innerHTML = `
            <td colspan="3">الإجمالي</td>
            <td class="num">${nights}</td>
            <td class="num">${fmt(gross)}</td>
            <td class="num red">${fmt(fees)}</td>
            <td class="num green">${fmt(gross - fees)}</td>
            <td colspan="2"></td>`;
        body.appendChild(foot);
    }

    body.querySelectorAll('.btn-x').forEach(btn => {
        btn.addEventListener('click', () => {
            saveBookings(loadBookings().filter(x => String(x.id) !== btn.dataset.id));
            recalc();
        });
    });

    setText('bk-gross', sar(gross));
    setText('bk-fees', sar(fees));
    setText('bk-net', sar(gross - fees));
    setText('bk-count', `${list.length} حجز / ${nights} ليلة`);
    setText('tile-bk', sar(gross - fees));
    setText('tile-bk-sub', list.length ? `${list.length} حجز • ${nights} ليلة` : 'لا توجد حجوزات بعد');

    renderPlatformBars(byPlatform);

    /* جدول الأرباح حسب التطبيق */
    const pBody = document.getElementById('platform-body');
    pBody.innerHTML = '';
    const names = Object.keys(byPlatform);
    if (!names.length) {
        pBody.innerHTML = '<tr><td colspan="6" class="empty-row">لا توجد بيانات بعد.</td></tr>';
    } else {
        names.sort((a, b) => byPlatform[b].gross - byPlatform[a].gross).forEach(name => {
            const a = byPlatform[name];
            const pct = a.gross > 0 ? (a.fee / a.gross) * 100 : 0;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${esc(name)}</td>
                <td class="num">${a.count}</td>
                <td class="num">${fmt(a.gross)}</td>
                <td class="num red">${fmt(a.fee)}</td>
                <td class="num green">${fmt(a.gross - a.fee)}</td>
                <td class="num">${pct.toFixed(1)}%</td>`;
            pBody.appendChild(tr);
        });
    }

    return { gross, fees, net: gross - fees, nights };
}

/* ---------- عناصر اللوحة الرسومية ---------- */

const PILL_BY_METHOD = {
    'عبر المنصة': 'green',
    'تحويل بنكي': 'teal',
    'نقداً': 'yellow',
    'شبكة / مدى': 'teal',
    'Apple Pay': 'gray',
    'محفظة إلكترونية': 'gray'
};

const methodPill = m => PILL_BY_METHOD[m] || 'gray';

const PLATFORM_COLORS = ['#4ade80', '#a3e635', '#facc15', '#2dd4bf', '#38bdf8', '#c084fc'];

/* دونات المصاريف التشغيلية */
function renderDonut(clean, power, internet) {
    const C = 2 * Math.PI * 50;
    const total = clean + power + internet;
    const segs = [
        ['seg-clean', clean],
        ['seg-power', power],
        ['seg-net', internet]
    ];

    let offset = 0;
    segs.forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (!el) return;
        const len = total > 0 ? (val / total) * C : 0;
        /* فجوة بسيطة بين الأقسام لتبدو منفصلة */
        const gap = len > 6 ? 3 : 0;
        el.setAttribute('stroke-dasharray', `${Math.max(len - gap, 0)} ${C}`);
        el.setAttribute('stroke-dashoffset', `${-offset}`);
        offset += len;
    });
}

/* رسم منحنى ناعم من قائمة قيم */
function smoothPath(values, w, h, pad) {
    if (values.length < 2) return '';
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = max - min || 1;
    const stepX = (w - pad * 2) / (values.length - 1);

    const pts = values.map((v, i) => [
        pad + i * stepX,
        h - pad - ((v - min) / range) * (h - pad * 2)
    ]);

    let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[i + 1];
        const cx = (x1 + x2) / 2;
        d += ` C ${cx.toFixed(1)} ${y1.toFixed(1)}, ${cx.toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
    }
    return d;
}

/* منحنى: المتبقي من الدين + الأرباح التراكمية */
function renderTrend(debtTotal, payments, bookings) {
    const svg = document.getElementById('trend-chart');
    if (!svg) return;

    const W = 320, H = 120, PAD = 10;

    /* المتبقي من الدين عبر الدفعات */
    const remainSeries = [debtTotal];
    let acc = 0;
    payments.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(p => {
        acc += p.amount;
        remainSeries.push(Math.max(debtTotal - acc, 0));
    });

    /* صافي الأرباح التراكمي */
    const profitSeries = [0];
    let pacc = 0;
    bookings.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(b => {
        pacc += (b.amount - b.fee);
        profitSeries.push(pacc);
    });

    /* توحيد المقياس بين المنحنيين */
    const scaleMax = Math.max(debtTotal, pacc, 1);
    const norm = arr => arr.map(v => (v / scaleMax) * 100);

    svg.innerHTML = `
        <defs>
            <linearGradient id="gradRemain" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#4ade80" stop-opacity="0.35"></stop>
                <stop offset="100%" stop-color="#4ade80" stop-opacity="0"></stop>
            </linearGradient>
        </defs>`;

    const mk = (d, stroke, width, fill) => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', fill || 'none');
        if (stroke) {
            path.setAttribute('stroke', stroke);
            path.setAttribute('stroke-width', width);
            path.setAttribute('stroke-linecap', 'round');
        }
        path.setAttribute('vector-effect', 'non-scaling-stroke');
        svg.appendChild(path);
    };

    const rd = smoothPath(norm(remainSeries.length > 1 ? remainSeries : [debtTotal, debtTotal]), W, H, PAD);
    if (rd) {
        mk(`${rd} L ${W - PAD} ${H - PAD} L ${PAD} ${H - PAD} Z`, null, 0, 'url(#gradRemain)');
        mk(rd, '#4ade80', 2);
    }

    const pd = smoothPath(norm(profitSeries.length > 1 ? profitSeries : [0, 0]), W, H, PAD);
    if (pd) mk(pd, '#a3e635', 2);

    setText('trend-note',
        `— المتبقي من الدين (أخضر) • الأرباح التراكمية (ليموني): ${sar(pacc)}`);
}

/* أشرطة توزيع الأرباح حسب المنصة */
function renderPlatformBars(byPlatform) {
    const bars = document.getElementById('platform-bars');
    const legend = document.getElementById('platform-legend');
    if (!bars || !legend) return;

    bars.innerHTML = '';
    legend.innerHTML = '';

    const names = Object.keys(byPlatform);
    const total = names.reduce((s, n) => s + byPlatform[n].gross, 0);

    if (!total) {
        bars.innerHTML = '<div class="seg-item" style="flex:1"><div class="seg-pct" style="color:#77837e">—</div><div class="seg-bar"></div></div>';
        legend.innerHTML = '<span class="legend-item"><span class="legend-name">أضف حجزاً لعرض التوزيع</span></span>';
        return;
    }

    names.sort((a, b) => byPlatform[b].gross - byPlatform[a].gross).forEach((name, i) => {
        const share = (byPlatform[name].gross / total) * 100;
        const color = PLATFORM_COLORS[i % PLATFORM_COLORS.length];

        const item = document.createElement('div');
        item.className = 'seg-item';
        item.style.flex = share;
        item.innerHTML = `
            <div class="seg-pct">${share.toFixed(0)}%</div>
            <div class="seg-bar" style="background:${color}"></div>`;
        bars.appendChild(item);

        const lg = document.createElement('span');
        lg.className = 'legend-item';
        lg.innerHTML = `
            <span class="legend-dot" style="background:${color}"></span>
            <span class="legend-name">${esc(name)}</span>`;
        legend.appendChild(lg);
    });
}

/* الجدول الزمني للأشهر */
let timelineExpanded = false;

function renderTimeline(months, monthlyRent, cleanFirst, cleanRest, power, internet) {
    const body = document.getElementById('timeline-body');
    if (!body) return;

    body.innerHTML = '';
    const limit = timelineExpanded ? months : Math.min(months, 5);

    for (let i = 0; i < limit; i++) {
        const clean = i < 2 ? cleanFirst : cleanRest;
        const total = monthlyRent + clean + power + internet;

        const item = document.createElement('div');
        item.className = 'tl-item';
        item.innerHTML = `
            <div class="tl-date">
                <b>${String(i + 1).padStart(2, '0')}</b>
                <span>شهر</span>
            </div>
            <div class="tl-body">
                <h5>${MONTH_NAMES[i] || 'الشهر ' + (i + 1)}</h5>
                <p>إيجار ${fmt(monthlyRent)} • تشغيل ${fmt(clean + power + internet)}</p>
            </div>
            <div class="tl-amt">${fmt(total)}</div>`;
        body.appendChild(item);
    }

    const btn = document.getElementById('btn-view-all');
    if (btn) btn.textContent = timelineExpanded ? 'عرض أقل' : `عرض كل الأشهر (${months})`;
}

/* ---------- العمولة ---------- */

function platformFee(nightPrice, cap) {
    if (nightPrice <= 0) return 0;
    const fee = FEE_BASE + FEE_RATE * nightPrice;
    return Math.min(Math.max(fee, 0), cap > 0 ? cap : fee);
}

/* ---------- الحساب الرئيسي ---------- */

function recalc() {
    /* الدين: الإيجار فقط */
    const contract = num('in-contract');
    const paidByMom = num('in-paid-by-mom');
    const monthlyRent = contract / 12;
    const halfContract = contract / 2;
    const debtTotal = paidByMom;

    setText('out-monthly-rent', sar(monthlyRent));
    setText('out-half-contract', sar(halfContract));
    const diff = paidByMom - halfContract;
    setText('out-diff', diff === 0 ? 'مطابق تماماً (0)' :
        (diff > 0 ? `أكثر بـ ${sar(diff)}` : `أقل بـ ${sar(Math.abs(diff))}`));
    setText('out-debt-total', sar(debtTotal));

    /* الدفعات */
    const paid = renderPayments(debtTotal);
    const paidSoFar = paid;
    const remaining = Math.max(debtTotal - paid, 0);

    setText('kpi-contract', sar(contract));
    setText('kpi-debt', sar(debtTotal));
    setText('kpi-paid', sar(paid));
    setText('kpi-remaining', sar(remaining));
    setText('sb-remaining', sar(remaining));
    const dcEl = document.getElementById('dc-remaining');
    if (dcEl) dcEl.innerHTML = `${fmt(remaining)} <small>ريال</small>`;
    const payCount = loadPayments().length;
    setText('pay-count-chip', `${payCount} دفعة`);
    setText('tile-pay', sar(paidSoFar));
    setText('tile-pay-sub', payCount ? `${payCount} دفعة مسجلة` : 'لا توجد دفعات بعد');
    setText('tile-debt', sar(debtTotal));

    const pct = debtTotal > 0 ? Math.min((paid / debtTotal) * 100, 100) : 0;
    const bar = document.getElementById('debt-progress');
    if (bar) bar.style.width = pct.toFixed(1) + '%';
    const progressText = remaining === 0 && debtTotal > 0
        ? '🎉 تم سداد كامل الدين للوالدة'
        : `تم سداد ${pct.toFixed(1)}% — متبقٍ ${sar(remaining)}`;
    setText('debt-progress-label', progressText);
    setText('sb-remaining-note', progressText);
    setText('dc-pct', `${pct.toFixed(1)}% مسدَّد`);

    /* الحجوزات والأرباح */
    renderBookings();
    renderTrend(debtTotal, loadPayments(), loadBookings());

    /* المصاريف التشغيلية */
    const cleanFirst = num('in-clean-first');
    const cleanRest = num('in-clean-rest');
    const power = num('in-power');
    const internet = num('in-internet');
    const months = Math.max(Math.round(num('in-months')), 1);

    const firstMonths = Math.min(months, 2);
    const restMonths = Math.max(months - 2, 0);
    const cleanTotal = firstMonths * cleanFirst + restMonths * cleanRest;
    const powerTotal = months * power;
    const internetTotal = months * internet;
    const opexTotal = cleanTotal + powerTotal + internetTotal;
    const opexMonthly = opexTotal / months;

    setText('out-clean-total', `${sar(cleanTotal)} (${firstMonths}×${fmt(cleanFirst)} + ${restMonths}×${fmt(cleanRest)})`);
    setText('out-power-total', `${sar(powerTotal)} (${months}×${fmt(power)})`);
    setText('out-internet-total', `${sar(internetTotal)} (${months}×${fmt(internet)})`);
    setText('out-opex-monthly', sar(opexMonthly));
    setText('out-opex-total', sar(opexTotal));

    renderDonut(cleanTotal, powerTotal, internetTotal);
    setText('donut-total', fmt(opexTotal));
    setText('opex-total-chip', sar(opexTotal));
    setText('lg-clean', fmt(cleanTotal));
    setText('lg-power', fmt(powerTotal));
    setText('lg-net', fmt(internetTotal));
    setText('lg-monthly', fmt(opexMonthly));
    renderTimeline(months, monthlyRent, cleanFirst, cleanRest, power, internet);
    setText('tile-opex', sar(opexTotal));
    setText('tile-sch', sar(monthlyRent + opexMonthly));
    setText('tile-sch-sub', `${months} شهراً • متوسط التكلفة`);

    /* الجدول الشهري */
    const mBody = document.getElementById('months-body');
    mBody.innerHTML = '';
    for (let i = 0; i < months; i++) {
        const clean = i < 2 ? cleanFirst : cleanRest;
        const total = monthlyRent + clean + power + internet;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${MONTH_NAMES[i] || 'الشهر ' + (i + 1)}</td>
            <td class="num">${fmt(monthlyRent)}</td>
            <td class="num">${fmt(clean)}</td>
            <td class="num">${fmt(power)}</td>
            <td class="num">${fmt(internet)}</td>
            <td class="num green">${fmt(total)}</td>`;
        mBody.appendChild(tr);
    }
    const grandRent = monthlyRent * months;
    const foot = document.createElement('tr');
    foot.className = 'total-row';
    foot.innerHTML = `
        <td>الإجمالي</td>
        <td class="num">${fmt(grandRent)}</td>
        <td class="num">${fmt(cleanTotal)}</td>
        <td class="num">${fmt(powerTotal)}</td>
        <td class="num">${fmt(internetTotal)}</td>
        <td class="num green">${fmt(grandRent + opexTotal)}</td>`;
    mBody.appendChild(foot);

    /* الدخل بعد العمولة */
    const nightPrice = num('in-night-price');
    const nights = Math.max(Math.round(num('in-nights')), 1);
    const cap = num('in-fee-cap');

    const feeNight = platformFee(nightPrice, cap);
    const netNight = nightPrice - feeNight;
    const feeTotal = feeNight * nights;
    const netTotal = netNight * nights;

    setText('out-fee-night', sar(feeNight));
    setText('out-net-night', sar(netNight));
    setText('out-fee-total', sar(feeTotal));
    setText('out-net-total', sar(netTotal));
    setText('tile-calc', sar(netNight));

    const opexDaily = opexMonthly / 30;
    const netAfterOpexNight = netNight - opexDaily;
    setText('out-net-after-opex', `${sar(netAfterOpexNight * nights)} (${fmt(netAfterOpexNight)} / ليلة)`);

    if (remaining <= 0) {
        setText('out-nights-needed', '✅ لا يوجد متبقٍ');
        setText('out-months-needed', '—');
        setText('kpi-nights', '✅ مسدَّد');
        setText('dc-nights', '✅ مسدَّد بالكامل');
    } else if (netAfterOpexNight <= 0) {
        setText('out-nights-needed', 'صافي الليلة صفر أو أقل');
        setText('out-months-needed', '—');
        setText('kpi-nights', '—');
        setText('dc-nights', '—');
    } else {
        const nightsNeeded = Math.ceil(remaining / netAfterOpexNight);
        setText('out-nights-needed', `${nightsNeeded} ليلة`);
        setText('out-months-needed', `${(nightsNeeded / (30 * 0.6)).toFixed(1)} شهر`);
        setText('kpi-nights', `${nightsNeeded} ليلة`);
        setText('dc-nights', `${nightsNeeded} ليلة للسداد`);
    }
}

/* ---------- التنقل بين الصفحات ---------- */

const VIEW_TITLES = {
    home: ['لوحة تحصيل الدين', 'شقة السليمانية • RHSA7905'],
    debt: ['أساس الدين', 'الإيجار فقط — بدون أرباح'],
    payments: ['سجل الدفعات', 'ما سُدِّد للوالدة حتى الآن'],
    bookings: ['الحجوزات والأرباح', 'الصافي بعد العمولة الفعلية'],
    opex: ['المصاريف التشغيلية', 'للمتابعة فقط'],
    schedule: ['الجدول الشهري', 'تفصيل تكلفة كل شهر'],
    calc: ['حاسبة العمولة', 'تقدير حجز قبل حصوله']
};

/* تاريخ اليوم المعروض في الترويسة */
const TODAY_LABEL = new Date().toLocaleDateString('ar-SA-u-ca-gregory', { weekday: 'long', day: 'numeric', month: 'long' });

function showView(name, fromHash) {
    const views = document.querySelectorAll('.view');
    const exists = Array.from(views).some(v => v.dataset.view === name);
    if (!exists) name = 'home';

    views.forEach(v => { v.hidden = v.dataset.view !== name; });

    document.querySelectorAll('.sb-link[data-view]').forEach(l => {
        l.classList.toggle('active', l.dataset.view === name);
    });

    const t = VIEW_TITLES[name];
    if (t) {
        const title = document.querySelector('.tb-title');
        // تاريخ اليوم يبقى في سطر العنوان الفرعي مع كل تبديل للصفحة
        if (title) title.innerHTML = `${t[0]}<span>${t[1]} • <b id="today-chip">${esc(TODAY_LABEL)}</b></span>`;
    }

    if (!fromHash) location.hash = name;

    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sb-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- التهيئة ---------- */

function initApp() {
    ['in-contract', 'in-paid-by-mom', 'in-clean-first', 'in-clean-rest', 'in-power',
        'in-internet', 'in-months', 'in-night-price', 'in-nights', 'in-fee-cap']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', recalc);
        });

    const payDate = document.getElementById('pay-date');
    if (payDate) payDate.valueAsDate = new Date();

    document.getElementById('payment-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const date = document.getElementById('pay-date').value;
        const amount = parseFloat(document.getElementById('pay-amount').value);
        const note = document.getElementById('pay-note').value.trim();
        if (!date || isNaN(amount) || amount <= 0) return;

        const list = loadPayments();
        list.push({ id: Date.now(), date, amount, note });
        savePayments(list);

        document.getElementById('pay-amount').value = '';
        document.getElementById('pay-note').value = '';
        recalc();
    });

    /* الحجوزات */
    renderPlatformOptions();

    const bkDate = document.getElementById('bk-date');
    if (bkDate) bkDate.valueAsDate = new Date();

    document.getElementById('booking-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const date = document.getElementById('bk-date').value;
        const platform = document.getElementById('bk-platform').value;
        const method = document.getElementById('bk-method').value;
        const nights = parseInt(document.getElementById('bk-nights').value, 10);
        const amount = parseFloat(document.getElementById('bk-amount').value);
        const fee = parseFloat(document.getElementById('bk-fee').value);
        const note = document.getElementById('bk-note').value.trim();

        if (!date || !platform || isNaN(amount) || isNaN(fee)) return;
        if (fee > amount) {
            alert('العمولة أكبر من المبلغ الإجمالي — راجع الأرقام.');
            return;
        }

        const list = loadBookings();
        list.push({
            id: Date.now(), date, platform, method,
            nights: isNaN(nights) || nights < 1 ? 1 : nights,
            amount, fee, note
        });
        saveBookings(list);

        document.getElementById('bk-amount').value = '';
        document.getElementById('bk-fee').value = '';
        document.getElementById('bk-note').value = '';
        document.getElementById('bk-nights').value = '1';
        recalc();
    });

    document.getElementById('btn-add-platform').addEventListener('click', () => {
        const input = document.getElementById('new-platform');
        const name = input.value.trim();
        if (!name) return;

        const list = loadPlatforms();
        if (list.some(p => p.toLowerCase() === name.toLowerCase())) {
            alert('هذا التطبيق مضاف مسبقاً.');
            return;
        }
        list.push(name);
        savePlatforms(list);
        input.value = '';
        renderPlatformOptions();
        document.getElementById('bk-platform').value = name;
    });

    document.getElementById('new-platform').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('btn-add-platform').click();
        }
    });

    /* تاريخ اليوم في الشريط العلوي */
    setText('today-chip', TODAY_LABEL);

    /* التنقل بين صفحات اللوحة */
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sb-overlay');

    const closeSidebar = () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
    };

    document.getElementById('tb-menu').addEventListener('click', () => {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('show');
    });

    overlay.addEventListener('click', closeSidebar);

    document.querySelectorAll('[data-view]').forEach(el => {
        /* الصفحات نفسها ليست أزرار تنقل */
        if (el.classList.contains('view')) return;
        el.addEventListener('click', () => showView(el.dataset.view));
    });

    document.querySelectorAll('[data-back]').forEach(btn => {
        btn.addEventListener('click', () => showView('home'));
    });

    /* دعم زر الرجوع في المتصفح */
    window.addEventListener('hashchange', () => {
        showView((location.hash || '#home').slice(1), true);
    });

    showView((location.hash || '#home').slice(1), true);

    /* توسيع الجدول الزمني */
    document.getElementById('btn-view-all').addEventListener('click', () => {
        timelineExpanded = !timelineExpanded;
        recalc();
    });

    const lockPage = () => {
        sessionStorage.removeItem(SESSION_KEY);
        if (window.OwnerGate) window.OwnerGate.lock();
        location.reload();
    };
    document.getElementById('btn-lock').addEventListener('click', lockPage);
    // أيقونة القفل في الترويسة تؤدي عمل «قفل الصفحة» نفسه في القائمة الجانبية
    document.getElementById('tb-lock')?.addEventListener('click', lockPage);

    recalc();
    syncFromSupabase();
}

document.addEventListener('DOMContentLoaded', initLock);
