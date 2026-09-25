/* ============================================================
   بوابة دخول المالك الموحّدة — تُستخدم في admin.html و collection.html
   1) بصمة/وجه الجهاز عبر WebAuthn (تحقق محلي لا يغادر الجهاز)
   2) كلمة مرور حساب المالك في Supabase (أُزيلت كلمة السر الاحتياطية الثابتة
      لأنها كانت مكتوبة في هذا الملف العام ويقرؤها أي زائر)
   3) جلسة موحّدة: الدخول من أي صفحة يفتح الأخرى تلقائياً — 5 دقائق إن كان
      الدخول بالوجه مفعّلاً (فيُطلب الوجه عند كل فتح للتطبيق)، و12 ساعة بدونه
   ملاحظة iPhone: تسجيل الوجه (credentials.create) يجب أن يُستدعى مباشرة من
   ضغطة زر؛ استدعاؤه بعد confirm أو داخل setTimeout يُرفض بصمت.
   ملاحظة: حماية بسيطة من طرف المتصفح (الموقع ثابت بدون سيرفر خاص بها)،
   البصمة أولاً ثم يتبعها توثيق Supabase الحقيقي في admin.html فقط.
   ============================================================ */
(function (global) {
    'use strict';

    const CRED_KEY = 'rhsa_owner_cred_id';
    const SESSION_KEY = 'rhsa_owner_session';
    const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 ساعة — بلا دخول بالوجه
    const BIO_TTL_MS = 5 * 60 * 1000;           // 5 دقائق — مع الدخول بالوجه
    const OFFER_KEY = 'rhsa_bio_offer_dismissed';
    const OWNER_EMAIL = 'muhammedalrubaish@gmail.com';

    function b64urlToBuf(b64url) {
        const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(b64url.length + (4 - b64url.length % 4) % 4, '=');
        const bin = atob(b64);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return buf.buffer;
    }

    function bufToB64url(buf) {
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    // التخزين المحلي قد يكون محجوباً (تصفح خاص) — نعامله كجلسة منتهية
    function readLS(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
    function writeLS(key, v) { try { localStorage.setItem(key, v); } catch (e) { /* تجاهل */ } }

    function isSessionValid() {
        const ts = Number(readLS(SESSION_KEY) || 0);
        const ttl = hasRegisteredBiometric() ? BIO_TTL_MS : SESSION_TTL_MS;
        return ts > 0 && (Date.now() - ts) < ttl;
    }

    function markUnlocked() {
        writeLS(SESSION_KEY, String(Date.now()));
    }

    function lock() {
        try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* تجاهل */ }
    }

    function hasBiometricSupport() {
        return !!(global.PublicKeyCredential && navigator.credentials);
    }

    function hasRegisteredBiometric() {
        return !!readLS(CRED_KEY);
    }

    async function registerBiometric() {
        if (!hasBiometricSupport()) return false;
        try {
            const cred = await navigator.credentials.create({
                publicKey: {
                    challenge: crypto.getRandomValues(new Uint8Array(32)),
                    rp: { name: 'RentAPA لوحة المالك' },
                    user: {
                        id: crypto.getRandomValues(new Uint8Array(16)),
                        name: 'owner@rentapa',
                        displayName: 'مالك العقار',
                    },
                    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
                    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
                    timeout: 60000,
                },
            });
            if (!cred) return false;
            writeLS(CRED_KEY, bufToB64url(cred.rawId));
            return true;
        } catch (e) {
            console.warn('[owner-gate] تعذّر تسجيل البصمة:', e);
            return false;
        }
    }

    async function tryBiometric() {
        if (!hasBiometricSupport() || !hasRegisteredBiometric()) return false;
        try {
            const credId = readLS(CRED_KEY);
            const assertion = await navigator.credentials.get({
                publicKey: {
                    challenge: crypto.getRandomValues(new Uint8Array(32)),
                    allowCredentials: [{ id: b64urlToBuf(credId), type: 'public-key' }],
                    userVerification: 'required',
                    timeout: 60000,
                },
            });
            return !!assertion;
        } catch (e) {
            console.warn('[owner-gate] فشل التحقق بالبصمة:', e);
            return false;
        }
    }

    /* الدخول بكلمة مرور حساب المالك في Supabase — ينشئ جلسة بيانات حقيقية */
    async function signInOwner(client, password) {
        if (!client) return { error: { message: 'no client', status: 0 } };
        return client.auth.signInWithPassword({ email: OWNER_EMAIL, password: String(password || '').trim() });
    }

    /* عرض تفعيل الدخول بالوجه كشريط بزر حقيقي — الضغطة نفسها تستدعي التسجيل
       (شرط iPhone). يظهر مرة لكل جهاز حتى يُفعَّل أو يُختار «لاحقاً». */
    function offerBiometric(onDone) {
        if (!hasBiometricSupport() || hasRegisteredBiometric() || readLS(OFFER_KEY)) return;
        if (document.getElementById('bio-offer')) return;

        const bar = document.createElement('div');
        bar.id = 'bio-offer';
        bar.setAttribute('role', 'dialog');
        bar.style.cssText = 'position:fixed;inset-inline:12px;bottom:calc(76px + max(0px, env(safe-area-inset-bottom) - 14px));z-index:9999;'
            + 'background:#fff;color:#1f2430;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.25);padding:14px;'
            + 'display:flex;align-items:center;gap:10px;font-family:inherit;direction:rtl;max-width:520px;margin-inline:auto';
        bar.innerHTML = '<div style="font-size:26px">🔐</div>'
            + '<div style="flex:1;font-size:13.5px;font-weight:700;line-height:1.6">فعّل الدخول بالوجه على هذا الجهاز<br>'
            + '<span style="font-weight:500;color:#667">يُطلب عند كل فتح بدل كلمة المرور</span></div>'
            + '<button type="button" data-a="yes" style="border:0;border-radius:10px;padding:10px 14px;font:inherit;font-weight:800;background:#f2622a;color:#fff">تفعيل</button>'
            + '<button type="button" data-a="no" style="border:0;background:none;font:inherit;color:#889;padding:8px">لاحقاً</button>';
        document.body.appendChild(bar);

        bar.querySelector('[data-a="no"]').addEventListener('click', () => {
            writeLS(OFFER_KEY, '1');
            bar.remove();
        });
        bar.querySelector('[data-a="yes"]').addEventListener('click', async () => {
            const ok = await registerBiometric();   // مباشرة من الضغطة
            bar.remove();
            if (ok) markUnlocked();
            if (typeof onDone === 'function') onDone(ok);
        });
    }

    function resetBiometric() {
        try { localStorage.removeItem(CRED_KEY); localStorage.removeItem(OFFER_KEY); } catch (e) { /* تجاهل */ }
    }

    global.OwnerGate = {
        OWNER_EMAIL,
        isSessionValid,
        markUnlocked,
        lock,
        hasBiometricSupport,
        hasRegisteredBiometric,
        registerBiometric,
        tryBiometric,
        signInOwner,
        offerBiometric,
        resetBiometric,
    };
})(window);
