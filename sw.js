/* عامل الخدمة (Service Worker) — لإشعارات الجوال فقط
   لا يعترض طلبات الصفحات ولا يخزّن شيئاً مؤقتاً، فلا يؤثر على تحديثات الموقع.
   يُسجَّل من لوحة التحكم عند تفعيل الإشعارات. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }

    const title = data.title || 'RentAPA';
    const options = {
        body: data.body || '',
        icon: '/assets/apple-touch-icon.png',
        badge: '/assets/favicon.png',
        dir: 'rtl',
        lang: 'ar',
        data: { url: data.url || '/admin' },
    };
    // الوسم يجمع إشعارات المحادثة نفسها في إشعار واحد يُحدَّث بدل تكدّسها
    if (data.tag) { options.tag = data.tag; options.renotify = true; }

    event.waitUntil(self.registration.showNotification(title, options));
});

// الضغط على الإشعار يفتح اللوحة على القسم المعني (أو ينقل نافذة مفتوحة إليه)
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = new URL((event.notification.data && event.notification.data.url) || '/admin', self.location.origin).href;

    event.waitUntil((async () => {
        const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const w of wins) {
            if (new URL(w.url).pathname.startsWith('/admin')) {
                await w.focus();
                if ('navigate' in w) { try { await w.navigate(target); } catch (e) { /* تجاهل */ } }
                return;
            }
        }
        await self.clients.openWindow(target);
    })());
});
