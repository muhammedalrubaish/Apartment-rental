// RentAPA — تصميم أداة الحجوزات (وحدة Scriptable)
// لا تُلصق هذا الملف في Scriptable: المُحمِّل (rentapa-scriptable.js) ينزّله من الموقع
// عند كل تحديث للأداة، فتصل التعديلات تلقائياً دون نسخ ولصق من جديد.
//
// build({ DATA_URL, SHOW_NAMES, family }) → ListWidget
// الأشكال: small / medium / large (الشاشة الرئيسية)،
//          accessoryRectangular / accessoryInline / accessoryCircular (شاشة القفل)

const ADMIN_URL = "https://rentapa.vercel.app/admin";

// أيقونات المنصات (رموز نظام iPhone — تُلوَّن بالأبيض على الشاشة الرئيسية)
// (رموز الحروف a.circle/g.circle ظهرت دوائر فارغة بهذا الحجم — استُبدلت برموز واضحة)
const PLATFORM_ICON = {
  airbnb: "bed.double.fill",
  gathern: "key.fill",
  whatsapp: "message.fill",
  direct: "globe",
  manual: "pencil",
  ical: "calendar",
};

/* iPhone بلغة عربية يعكس ترتيب عناصر السطر تلقائياً (أول عنصر يظهر يميناً).
   لذلك يُبنى السطر بترتيب مختلف حسب لغة الجهاز، فتكون النتيجة دائماً:
   النص محاذى لليمين والأيقونة على يمينه. */
/* لغة Scriptable نفسها إنجليزية حتى على جوال عربي، فـ Device.language() لا تكفي؛
   المعتمد أول لغة مفضّلة للجهاز (ar-SA على جوال عربي) ثم منطقة الجهاز */
const RTL = (() => {
  try {
    const prefs = (typeof Device.preferredLanguages === "function" && Device.preferredLanguages()) || [];
    const first = prefs[0] || (Device.locale && Device.locale()) || Device.language() || "";
    return /^(ar|he|fa|ur)/i.test(first);
  } catch (e) { return false; }
})();

const WHITE = Color.white();
const SOFT = new Color("#ffffff", 0.82);

// آخر بيانات ناجحة تُحفظ، فتبقى الأداة تعرض شيئاً عند انقطاع الإنترنت
async function load(url) {
  const fm = FileManager.local();
  const cachePath = fm.joinPath(fm.cacheDirectory(), "rentapa-upcoming.json");
  try {
    const req = new Request(url);
    req.timeoutInterval = 15;
    const data = await req.loadJSON();
    if (data && data.ok) {
      fm.writeString(cachePath, JSON.stringify(data));
      return data;
    }
  } catch (e) { /* نستخدم المحفوظ */ }
  if (fm.fileExists(cachePath)) {
    const d = JSON.parse(fm.readString(cachePath));
    d.stale = true;
    return d;
  }
  return null;
}

function sym(name) {
  const s = SFSymbol.named(name) || SFSymbol.named("circle.fill");
  return s.image;
}

// سطر عربي: النص محاذى لليمين والأيقونة على يمينه
function row(parent, text, opts) {
  const o = opts || {};
  const r = parent.addStack();
  r.layoutHorizontally();
  r.centerAlignContent();

  const addIcon = () => {
    if (!o.icon) return;
    const im = r.addImage(sym(o.icon));
    const size = o.iconSize || 12;
    im.imageSize = new Size(size, size);
    if (o.color) im.tintColor = o.color;
  };
  const addLabel = () => {
    const t = r.addText(text);
    t.font = o.font || Font.systemFont(12);
    t.lineLimit = 1;
    t.minimumScaleFactor = 0.55;
    if (o.color) t.textColor = o.color;
  };

  if (RTL) {
    // يُعكس عند العرض: الأيقونة يميناً ثم النص ثم الفراغ يساراً
    addIcon();
    if (o.icon) r.addSpacer(o.gap || 5);
    addLabel();
    r.addSpacer();
  } else {
    r.addSpacer();
    addLabel();
    if (o.icon) r.addSpacer(o.gap || 5);
    addIcon();
  }
  return r;
}

const platformLine = (x) => x.sourceLabel || "";
const nameOf = (x, show) => (show ? x.guest || x.first || "ضيف" : "");
const nightsLeftWord = (n) => (n === 1 ? "ليلة واحدة" : n === 2 ? "ليلتان" : n <= 10 ? n + " ليالٍ" : n + " ليلة");

// بطاقة حجز: العنوان، الضيف، المنصة، التواريخ، الليالي
function card(parent, x, title, titleIcon, show, compact) {
  const c = parent.addStack();
  c.layoutVertically();
  c.backgroundColor = new Color("#ffffff", 0.16);
  c.cornerRadius = 12;
  c.setPadding(7, 10, 7, 10);

  row(c, title, { icon: titleIcon, font: Font.boldSystemFont(compact ? 13 : 14), color: WHITE, iconSize: 13 });
  c.addSpacer(3);
  if (show) row(c, nameOf(x, show), { icon: "person.fill", font: Font.boldSystemFont(compact ? 13 : 15), color: WHITE });
  if (compact) {
    row(c, platformLine(x) + " • " + x.range, { icon: PLATFORM_ICON[x.source] || "calendar", font: Font.systemFont(11), color: SOFT });
  } else {
    if (platformLine(x)) row(c, platformLine(x), { icon: PLATFORM_ICON[x.source] || "calendar", font: Font.systemFont(12), color: SOFT });
    row(c, "الوصول " + x.inLabel + "  ←  المغادرة " + x.outLabel, { icon: "calendar", font: Font.systemFont(12), color: SOFT });
    const nights = x.when === "مقيم الآن"
      ? "باقي " + nightsLeftWord(x.nightsLeft) + " من " + x.nightsLabel
      : x.nightsLabel;
    row(c, nights, { icon: "moon.fill", font: Font.systemFont(12), color: SOFT });
  }
  return c;
}

// مواعيد الإنترنت والكهرباء: «الإنترنت بعد 12 يوماً • 7 أكتوبر»
function billRows(parent, bills, compact) {
  (bills || []).forEach((b) => {
    const icon = b.key === "internet" ? "wifi" : "bolt.fill";
    const text = b.label + " " + b.when + (compact ? "" : " • " + b.dueLabel) + (b.estimated ? " (تقديري)" : "");
    row(parent, text, { icon, font: b.overdue ? Font.boldSystemFont(11) : Font.systemFont(11), color: b.overdue ? WHITE : SOFT });
  });
}

// الضيوف السابقون: «سليمان الوهبي • واتساب • خرج أمس (27 سبتمبر)»
// «ضيف Airbnb» اسم مستورد يحمل المنصة أصلاً — لا نكرر «Airbnb» بعده
function guestAndPlatform(x, show) {
  const name = show ? x.guest || x.first || "" : "";
  const dup = name && x.sourceLabel && name.indexOf(x.sourceLabel) !== -1;
  return [name, dup ? "" : x.sourceLabel].filter(Boolean);
}

function pastRows(parent, past, show, limit) {
  (past || []).slice(0, limit).forEach((x) => {
    row(parent, guestAndPlatform(x, show).concat([x.left + " (" + x.outLabel + ")"]).join(" • "),
      { icon: PLATFORM_ICON[x.source] || "arrow.uturn.backward", font: Font.systemFont(11), color: SOFT });
  });
}

/* ---------- مؤشرات بصرية ---------- */

// شريط تقدّم بزوايا ناعمة (صورة) — يمتلئ من اليمين على جوال عربي
function progressBar(frac, width, height) {
  const ctx = new DrawContext();
  ctx.size = new Size(width, height);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const bg = new Path();
  bg.addRoundedRect(new Rect(0, 0, width, height), height / 2, height / 2);
  ctx.addPath(bg);
  ctx.setFillColor(new Color("#ffffff", 0.25));
  ctx.fillPath();
  const f = Math.max(0, Math.min(1, frac || 0));
  if (f > 0) {
    const fw = Math.max(height, Math.round(width * f));
    const fg = new Path();
    fg.addRoundedRect(new Rect(RTL ? width - fw : 0, 0, fw, height), height / 2, height / 2);
    ctx.addPath(fg);
    ctx.setFillColor(Color.white());
    ctx.fillPath();
  }
  return ctx.getImage();
}

// إطار ناعم: أيقونة وعنوان صغير، رقم كبير، ثم شريط أو سطر توضيح
function tile(parent, o) {
  const t = parent.addStack();
  t.layoutVertically();
  t.centerAlignContent();
  t.backgroundColor = new Color("#ffffff", o.dim ? 0.09 : 0.16);
  t.cornerRadius = 12;
  t.setPadding(4, 5, 4, 5);
  t.size = new Size(0, o.height);   // العرض مرن: البطاقات تتقاسم عرض الأداة الفعلي

  const head = t.addStack();
  head.addSpacer();
  const ic = head.addImage(sym(o.icon));
  ic.imageSize = new Size(9, 9);
  ic.tintColor = SOFT;
  head.addSpacer(3);
  const hl = head.addText(o.label);
  hl.font = Font.systemFont(8);
  hl.textColor = SOFT;
  hl.lineLimit = 1;
  hl.minimumScaleFactor = 0.6;
  head.addSpacer();

  t.addSpacer(1);
  const vs = t.addStack();
  vs.addSpacer();
  const v = vs.addText(o.value);
  v.font = Font.boldRoundedSystemFont(o.valueSize || 15);
  v.textColor = WHITE;
  v.lineLimit = 1;
  v.minimumScaleFactor = 0.5;
  vs.addSpacer();

  if (o.sub) {
    const ss = t.addStack();
    ss.addSpacer();
    const st = ss.addText(o.sub);
    st.font = Font.systemFont(7);
    st.textColor = SOFT;
    st.lineLimit = 1;
    st.minimumScaleFactor = 0.6;
    ss.addSpacer();
  }
  if (o.frac != null) {
    t.addSpacer(2);
    const bs = t.addStack();
    bs.addSpacer();
    const img = bs.addImage(progressBar(o.frac, o.width - 18, 4));
    img.imageSize = new Size(o.width - 18, 4);
    bs.addSpacer();
  }
  if (o.foot) {
    t.addSpacer(2);
    const fs = t.addStack();
    fs.addSpacer();
    const ft = fs.addText(o.foot);
    ft.font = Font.systemFont(7.5);
    ft.textColor = SOFT;
    ft.lineLimit = 1;
    ft.minimumScaleFactor = 0.6;
    fs.addSpacer();
  }
  return t;
}

/* ---------- التصميم المختصر للأداة الكبيرة ---------- */

// سطر بطرفين: النص والأيقونة يميناً، ونص صغير يساراً (حالة أو تاريخ)
function splitRow(parent, text, side, o) {
  const r = parent.addStack();
  r.layoutHorizontally();
  r.centerAlignContent();
  const main = () => {
    if (o.icon) {
      const im = r.addImage(sym(o.icon));
      im.imageSize = new Size(o.iconSize || 13, o.iconSize || 13);
      im.tintColor = WHITE;
      r.addSpacer(5);
    }
    const t = r.addText(text);
    t.font = o.font || Font.boldSystemFont(15);
    t.textColor = WHITE;
    t.lineLimit = 1;
    t.minimumScaleFactor = 0.6;
  };
  const aside = () => {
    if (!side) return;
    const t = r.addText(side);
    t.font = Font.semiboldSystemFont(10);
    t.textColor = SOFT;
    t.lineLimit = 1;
  };
  // الجوال العربي يعكس الترتيب: الأول يظهر يميناً
  if (RTL) { main(); r.addSpacer(); aside(); } else { aside(); r.addSpacer(); main(); }
  return r;
}

// بطاقة رئيسية بثلاثة أسطر: الاسم والحالة، المنصة والتواريخ، الليالي
function heroCard(parent, x, status, icon, show) {
  const c = parent.addStack();
  c.layoutVertically();
  c.backgroundColor = new Color("#ffffff", 0.14);
  c.cornerRadius = 14;
  c.setPadding(8, 11, 8, 11);
  splitRow(c, show ? nameOf(x, show) : status, show ? status : "", { icon, iconSize: 14 });
  c.addSpacer(4);
  row(c, guestAndPlatform(x, false).concat([x.inLabel + " ← " + x.outLabel]).join(" • "),
    { icon: PLATFORM_ICON[x.source] || "calendar", font: Font.systemFont(12), color: SOFT });
  const nights = x.when === "مقيم الآن" ? "باقي " + nightsLeftWord(x.nightsLeft) + " من " + x.nightsLabel : x.nightsLabel;
  row(c, nights, { icon: "moon.fill", font: Font.systemFont(12), color: SOFT });
  return c;
}

// مقارنة بالشهر السابق: سهم صعود/هبوط
const trend = (a, b) => (a > b ? " ▲" : a < b ? " ▼" : "");

// صف واحد من ثلاثة إطارات: الشهر الحالي كبيراً والسابق صغيراً تحته
function compareTiles(parent, st, prev, width) {
  if (!st) return;
  const gap = 6;
  const h = prev ? 54 : 44;
  const tw = Math.floor((width - gap * 2) / 3);
  const pm = prev ? prev.month + ": " : "";
  const r = parent.addStack();
  r.layoutHorizontally();
  tile(r, { width: tw, height: h, icon: "calendar", label: "حجوزات " + st.month, value: String(st.bookings),
    foot: prev ? pm + prev.bookings + trend(st.bookings, prev.bookings) : "" });
  r.addSpacer(gap);
  tile(r, { width: tw, height: h, icon: "moon.fill", label: "ليالٍ محجوزة", value: st.bookedNights + "/" + st.daysInMonth,
    frac: st.daysInMonth ? st.bookedNights / st.daysInMonth : 0,
    foot: prev ? pm + prev.bookedNights + "/" + prev.daysInMonth + trend(st.occupancy, prev.occupancy) : "" });
  r.addSpacer(gap);
  tile(r, { width: tw, height: h, icon: "calendar.badge.plus", label: "متاحة للشهر", value: String(st.freeLeft),
    frac: st.daysLeft ? st.freeLeft / st.daysLeft : 0,
    foot: prev ? pm + prev.freeLeft + " لم تُحجز" : "" });
}

// أسعار الليلة بإطارين نحيفين؛ المصدر في العنوان (مباشر/معتمد)
/* القيمة الكبيرة = سعر الموقع الحالي (ما يدفعه الضيف)، والعنوان = المحقق فعلاً من
   حجوزاتك المباشرة (الأقل–الأعلى). الضغط يفتح تعديل السعر (بمفتاح الأداة) */
function slimPrices(parent, pr, width, opts, site) {
  if (!pr && !site) return;
  const gap = 6;
  const tw = Math.floor((width - gap) / 2);
  const range = (x) => (x.min === x.max ? String(x.min) : x.min + "–" + x.max);
  const edit = hasWriteKey(opts);
  const one = (k, name, icon) => {
    const x = pr && pr[k];
    const realized = x && !x.configured ? " • حجوزاتك " + range(x) : " • سعر الموقع";
    const value = site ? site[k] + " ر.س" : x ? range(x) + " ر.س" : "—";
    return { width: tw, height: 36, icon, label: name + realized + (edit ? " ✎" : ""), value, valueSize: 13 };
  };
  const r = parent.addStack();
  r.layoutHorizontally();
  if (edit) r.url = actionUrl(opts, "prices");
  tile(r, one("weekday", "وسط الأسبوع", "sun.max.fill"));
  r.addSpacer(gap);
  tile(r, one("weekend", "الويكند", "sparkles"));
}

/* مناسبات الرياض القادمة (يوم التأسيس، الأعياد، كأس آسيا، موسم الرياض…) بطاقات
   صغيرة متجاورة كتقويم مصغّر: الاسم، التاريخ، ثم العدّ التنازلي وتوفر الشقة فيها.
   تُحسب في الخادم (api/_events.js) — الأداة تعرض فقط. */
// رابط تسعير المناسبة (بمفتاح الأداة): سعر خاص لكل لياليها — المواعيد غير المعلنة تُستثنى
function eventUrl(opts, e) {
  if (!hasWriteKey(opts) || e.approx === true || !e.start || !e.end) return null;
  return actionUrl(opts, "event") + "&from=" + e.start + "&to=" + e.end + "&name=" + encodeURIComponent(e.name);
}

function eventCard(parent, e, width, opts) {
  const c = parent.addStack();
  c.layoutVertically();
  const url = eventUrl(opts, e);
  if (url) c.url = url;
  // الجارية والكبرى (كأس آسيا، موسم الرياض…) أوضح من غيرها
  c.backgroundColor = new Color("#ffffff", e.ongoing || e.major ? 0.2 : 0.11);
  c.cornerRadius = 11;
  c.setPadding(5, 6, 5, 6);
  c.size = new Size(0, e.price || url ? 64 : 54);   // العرض مرن كي يملأ الشريط عرض الأداة
  const line = (text, font, color, icon) => {
    const r = c.addStack();
    r.layoutHorizontally();
    r.centerAlignContent();
    r.addSpacer();
    const addIcon = () => {
      if (!icon) return;
      const im = r.addImage(sym(icon));
      im.imageSize = new Size(9, 9);
      im.tintColor = WHITE;
      r.addSpacer(3);
    };
    if (RTL) addIcon();
    const t = r.addText(text);
    t.font = font;
    t.textColor = color;
    t.lineLimit = 1;
    t.minimumScaleFactor = 0.55;
    if (!RTL && icon) { r.addSpacer(3); const im = r.addImage(sym(icon)); im.imageSize = new Size(9, 9); im.tintColor = WHITE; }
    r.addSpacer();
  };
  line(e.name, Font.boldSystemFont(10), WHITE, e.icon);
  c.addSpacer(2);
  line(e.label, Font.systemFont(9), SOFT);
  c.addSpacer(2);
  line([e.when, e.avail].filter(Boolean).join(" • "), Font.boldSystemFont(8.5), e.avail === "محجوزة ✓" ? WHITE : SOFT);
  // تحت كل مناسبة: سعرها الخاص إن حُدد، وإلا دعوة لتحديده
  if (e.price) { c.addSpacer(2); line("سعر خاص " + e.price + " ر.س", Font.heavySystemFont(8.5), WHITE, "tag.fill"); }
  else if (url) { c.addSpacer(2); line("تحديد السعر ›", Font.systemFont(8), SOFT); }
}

function eventsStrip(parent, events, width, opts) {
  const list = (events || []).slice(0, 3);
  if (!list.length) return false;
  const gap = 6;
  const cw = Math.floor((width - gap * (list.length - 1)) / list.length);
  const r = parent.addStack();
  r.layoutHorizontally();
  // الأقرب يظهر يميناً على جوال عربي
  const ordered = RTL ? list : list.slice().reverse();
  ordered.forEach((e, i) => { if (i) r.addSpacer(gap); eventCard(r, e, cw, opts); });
  return true;
}

// عند ضيق المساحة: سطر واحد لأقرب مناسبة
function eventLine(parent, events) {
  const e = (events || [])[0];
  if (!e) return false;
  row(parent, e.name + " • " + e.when + (e.avail ? " • " + e.avail : ""), { icon: e.icon || "calendar", font: Font.systemFont(11), color: SOFT });
  return true;
}

/* زرّا «حجز سريع» و«إكمال» (حجوزات المنصات الناقصة) أسفل المعلومات.
   مع مفتاح الكتابة (سكربت منسوخ بعد الهجرة 0015): الضغط يشغّل السكربت داخل
   Scriptable فتظهر نماذج أصلية سريعة (handle أدناه) دون تسجيل دخول.
   بدونه: الضغط يفتح لوحة التحكم مباشرة على نموذج الحجز أو الإكمال. */
function hasWriteKey(opts) {
  const k = opts && opts.WRITE_KEY;
  return typeof k === "string" && k.length >= 32 && k.indexOf("__") !== 0;
}

function actionUrl(opts, action) {
  if (hasWriteKey(opts)) {
    let name = "RentAPA";
    try { name = Script.name() || name; } catch (e) { /* الاسم الافتراضي */ }
    return "scriptable:///run/" + encodeURIComponent(name) + "?action=" + action;
  }
  return ADMIN_URL + "#" + action;
}

function pill(parent, label, icon, url, width, strong) {
  const p = parent.addStack();
  p.layoutHorizontally();
  p.centerAlignContent();
  p.backgroundColor = new Color("#ffffff", strong ? 0.26 : 0.16);
  p.cornerRadius = 11;
  p.size = new Size(0, 24);   // العرض مرن كي يملأ الزرّان عرض الأداة
  p.url = url;
  const addIcon = () => {
    const im = p.addImage(sym(icon));
    im.imageSize = new Size(11, 11);
    im.tintColor = WHITE;
  };
  const addLabel = () => {
    const t = p.addText(label);
    t.font = Font.boldSystemFont(11);
    t.textColor = WHITE;
    t.lineLimit = 1;
    t.minimumScaleFactor = 0.6;
  };
  p.addSpacer();
  if (RTL) { addIcon(); p.addSpacer(4); addLabel(); } else { addLabel(); p.addSpacer(4); addIcon(); }
  p.addSpacer();
  return p;
}

function actionPills(parent, inc, opts, width) {
  const n = (inc && inc.count) || 0;
  const r = parent.addStack();
  r.layoutHorizontally();
  const gap = 6;
  const book = () => pill(r, "حجز سريع", "plus", actionUrl(opts, "book"), n ? Math.floor((width - gap) / 2) : width, true);
  const done = () => pill(r, n === 1 ? "إكمال حجز منصة" : "إكمال " + n + " من المنصات", "square.and.pencil",
    actionUrl(opts, "complete"), Math.floor((width - gap) / 2), false);
  // الأول يظهر يميناً على جوال عربي
  if (!n) book();
  else if (RTL) { book(); r.addSpacer(gap); done(); } else { done(); r.addSpacer(gap); book(); }
  return r;
}

// عدّ الحجوزات بالعربية: حجز واحد، حجزان، 3–10 حجوزات، 11+ حجزاً
const bookingsWord = (n) => (n === 0 ? "لا حجوزات" : n === 1 ? "حجز واحد" : n === 2 ? "حجزين" : n <= 10 ? n + " حجوزات" : n + " حجزاً");

// ثلاثة مؤشرات للشهر جنباً إلى جنب (أول مؤشر يظهر يميناً على جوال عربي).
// past: الشهر السابق — إطارات أخفت، و«المتاحة» تصبح «لم تُحجز» طوال الشهر
function statsTiles(parent, st, width, past) {
  if (!st) return;
  const gap = 6;
  const h = 44;   // صفّا الشهر والأسعار يتسعان أسفل الأداة الكبيرة
  const tw = Math.floor((width - gap * 2) / 3);
  const r = parent.addStack();
  r.layoutHorizontally();
  const inMonth = past ? " • " + st.month : "";
  tile(r, { width: tw, height: h, dim: past, icon: past ? "clock.arrow.circlepath" : "calendar", label: "حجوزات " + st.month,
    value: String(st.bookings), frac: null });
  r.addSpacer(gap);
  tile(r, { width: tw, height: h, dim: past, icon: "moon.fill", label: "محجوزة" + inMonth,
    value: st.bookedNights + "/" + st.daysInMonth, frac: st.daysInMonth ? st.bookedNights / st.daysInMonth : 0 });
  r.addSpacer(gap);
  tile(r, { width: tw, height: h, dim: past, icon: past ? "calendar.badge.minus" : "calendar.badge.plus",
    label: past ? "لم تُحجز" + inMonth : "متاحة للشهر",
    value: String(st.freeLeft), frac: st.daysLeft ? st.freeLeft / st.daysLeft : 0 });
}

// سعر الليلة الأقل–الأعلى: وسط الأسبوع والويكند
function priceTiles(parent, pr, width) {
  if (!pr) return;
  const gap = 6;
  const tw = Math.floor((width - gap) / 2);
  const txt = (x) => (x.min === x.max ? String(x.min) : x.min + " – " + x.max) + " ر.س";
  // الأسعار من الحجوزات المباشرة فقط (الموقع/واتساب)، وإلا السعر المعتمد
  const note = (x) => (x.configured ? "السعر المعتمد" : "مباشر • من " + bookingsWord(x.count));
  const r = parent.addStack();
  r.layoutHorizontally();
  tile(r, { width: tw, height: 40, icon: "sun.max.fill", label: "وسط الأسبوع • الليلة", value: txt(pr.weekday), valueSize: 13, sub: note(pr.weekday) });
  r.addSpacer(gap);
  tile(r, { width: tw, height: 40, icon: "sparkles", label: "الويكند • الليلة", value: txt(pr.weekend), valueSize: 13, sub: note(pr.weekend) });
}

// تقدير عرض المحتوى الداخلي للأداة الكبيرة — لأطوال أشرطة التقدم فقط؛ البطاقات نفسها مرنة العرض
// (العرض الثابت ترك فراغاً يساراً على الجوالات الأعرض)
function contentWidth() {
  // الأداة الكبيرة ≈ 85% من عرض الشاشة، ناقص الحواف الداخلية (14 من كل جانب)
  try { return Math.max(280, Math.min(336, Math.floor(Device.screenSize().width * 0.85 - 30))); } catch (e) { return 300; }
}

function homeBackground(w) {
  const g = new LinearGradient();
  g.colors = [new Color("#f2622a"), new Color("#c9491a")];
  g.locations = [0, 1];
  w.backgroundGradient = g;
}

function timeLabel() {
  try {
    return new Date().toLocaleTimeString("ar-u-nu-latn", { hour: "numeric", minute: "2-digit" });
  } catch (e) {
    return "";
  }
}

/* صفحتان في «مجموعة ذكية» (Smart Stack): أداتان كبيرتان فوق بعض يُمرَّر بينهما عمودياً.
   رقم الصفحة من خانة «Parameter» عند تعديل الأداة:
     1 → اليوم: المقيم، التالي، الحجوزات القادمة، الفواتير، الحجز السريع
     2 → الأرقام: مناسبات الرياض، مؤشرات الشهر، الأسعار
     فارغ → التصميم المجمّع كما كان */
function pageOf(opts) {
  let p = opts && opts.PAGE;
  try { if (!p && typeof args !== "undefined" && args) p = args.widgetParameter; } catch (e) { /* بلا معامل */ }
  p = String(p || "").trim();
  return /^(1|١|اليوم)$/.test(p) ? "1" : /^(2|٢|الأرقام)$/.test(p) ? "2" : "";
}

// الحجوزات القادمة بعد المعروضة أعلى الصفحة: «بعد 5 أيام: خالد • مباشر • 1 أكتوبر ← 3 أكتوبر»
function upcomingRows(parent, d, skip, show, limit) {
  const key = (x) => x && x.checkin + "|" + x.checkout;
  const seen = skip.map(key);
  const list = (d.upcoming || []).filter((x) => seen.indexOf(key(x)) === -1 && x.when !== "مقيم الآن").slice(0, limit);
  if (!list.length) return 0;
  row(parent, "القادمة", { icon: "calendar", font: Font.boldSystemFont(11), color: WHITE });
  parent.addSpacer(2);
  list.forEach((x) => row(parent, x.when + ": " + guestAndPlatform(x, show).concat([x.range]).join(" • "),
    { icon: PLATFORM_ICON[x.source] || "calendar", font: Font.systemFont(11), color: SOFT }));
  return list.length;
}

// الصفحة 2: المناسبات قائمةً في بطاقة، ثم مؤشرات الشهر والأسعار
function numbersPage(w, d, opts) {
  const cw = contentWidth();
  const ev = (d.events || []).slice(0, 6);
  if (ev.length) {
    const c = w.addStack();
    c.layoutVertically();
    c.backgroundColor = new Color("#ffffff", 0.14);
    c.cornerRadius = 12;
    c.setPadding(7, 10, 7, 10);
    row(c, "مناسبات الرياض القادمة", { icon: "sparkles", font: Font.boldSystemFont(12), color: WHITE });
    c.addSpacer(4);
    ev.forEach((e, i) => {
      if (i) c.addSpacer(3);
      const r = splitRow(c, e.name + " • " + e.label, [e.when, e.avail, e.price ? e.price + " ر.س" : ""].filter(Boolean).join(" • "),
        { icon: e.icon, iconSize: 11, font: e.major ? Font.boldSystemFont(12) : Font.systemFont(12) });
      const url = eventUrl(opts, e);
      if (url) r.url = url;
    });
  }
  w.addSpacer();
  compareTiles(w, d.stats, d.prevStats, cw);
  w.addSpacer(6);
  slimPrices(w, d.prices, cw, opts, d.pricing);
}

async function build(opts) {
  const show = opts.SHOW_NAMES !== false;
  const family = opts.family || "large";
  const page = family === "large" ? pageOf(opts) : "";
  const d = await load(opts.DATA_URL);
  const w = new ListWidget();
  w.url = ADMIN_URL;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  const cur = d && d.current;
  const next = d && d.next;
  const main = cur || next;
  const mainTitle = cur ? "مقيم الآن" : next ? "الحجز القادم • " + next.when : "";
  const mainIcon = cur ? "house.fill" : "calendar.badge.clock";

  /* ---------- شاشة القفل ---------- */
  if (family === "accessoryInline") {
    const t = w.addText(!d ? "RentAPA: تعذّر التحديث"
      : cur ? (show ? cur.first + " • " : "") + "مقيم حتى " + cur.outLabel
      : next ? next.when + ": " + (show ? next.first + " • " : "") + next.inLabel
      : "RentAPA: لا حجوزات");
    t.font = Font.systemFont(12);
    return w;
  }

  if (family === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true;
    const top = w.addStack();
    top.addSpacer();
    const ic = top.addImage(sym(!d ? "exclamationmark.triangle.fill" : cur ? "house.fill" : "calendar"));
    ic.imageSize = new Size(12, 12);
    top.addSpacer();
    const big = !d ? "!" : cur ? String(cur.nightsLeft) : next ? String(Math.max(0, next.inDays)) : "—";
    const small = !d ? "RentAPA" : cur ? "ليلة باقية" : next ? (next.inDays <= 0 ? "وصول اليوم" : "يوم للوصول") : "لا حجز";
    const a = w.addText(big); a.font = Font.boldRoundedSystemFont(18); a.centerAlignText();
    const b = w.addText(small); b.font = Font.systemFont(8); b.centerAlignText(); b.minimumScaleFactor = 0.6;
    return w;
  }

  if (family === "accessoryRectangular") {
    if (!d) { row(w, "RentAPA: تعذّر التحديث", { icon: "exclamationmark.triangle.fill", font: Font.boldSystemFont(13) }); return w; }
    if (!main) { row(w, "لا حجوزات قادمة", { icon: "calendar.badge.checkmark", font: Font.boldSystemFont(13) }); return w; }
    row(w, mainTitle, { icon: mainIcon, font: Font.boldSystemFont(13), iconSize: 13 });
    row(w, [nameOf(main, show), platformLine(main)].filter(Boolean).join(" • "), { icon: PLATFORM_ICON[main.source] || "person.fill", font: Font.systemFont(12) });
    row(w, main.range + (d.stale ? " ⟳" : ""), { icon: "calendar", font: Font.systemFont(11) });
    return w;
  }

  /* ---------- الشاشة الرئيسية ---------- */
  homeBackground(w);
  w.setPadding(14, 14, 12, 14);

  {
    const h = w.addStack();
    h.layoutHorizontally();
    h.centerAlignContent();
    const addBrand = () => {
      const im = h.addImage(sym("building.2.fill"));
      im.imageSize = new Size(12, 12);
      im.tintColor = SOFT;
      h.addSpacer(4);
      const t = h.addText("RentAPA" + (page === "1" ? " • اليوم" : page === "2" ? " • الأرقام" : "") + (d && d.stale ? " ⟳" : ""));
      t.font = Font.boldSystemFont(12);
      t.textColor = SOFT;
    };
    const addTime = () => {
      const tl = timeLabel();
      if (!tl) return;
      const t = h.addText("↻ " + tl);
      t.font = Font.systemFont(9);
      t.textColor = SOFT;
    };
    // الجوال العربي يعكس الترتيب: الأول يظهر يميناً
    if (RTL) { addBrand(); h.addSpacer(); addTime(); } else { addTime(); h.addSpacer(); addBrand(); }
  }
  w.addSpacer(6);

  if (!d) {
    row(w, "تعذّر التحديث — تحقق من الإنترنت", { icon: "exclamationmark.triangle.fill", font: Font.boldSystemFont(13), color: WHITE });
    w.addSpacer();
    return w;
  }
  if (page === "2") { numbersPage(w, d, opts); return w; }
  if (!main) {
    row(w, "لا حجوزات قادمة", { icon: "calendar.badge.checkmark", font: Font.boldSystemFont(15), color: WHITE, iconSize: 15 });
    if (family === "large" && page === "1") {
      // الصفحة 1 بلا مقيم ولا قادم: السابقون والفواتير والحجز السريع
      w.addSpacer(8);
      if ((d.past || []).length) {
        row(w, "الحجوزات السابقة", { icon: "clock.arrow.circlepath", font: Font.boldSystemFont(12), color: SOFT });
        pastRows(w, d.past, show, 3);
        w.addSpacer(6);
      }
      billRows(w, d.bills, false);
      w.addSpacer();
      actionPills(w, d.incomplete, opts, contentWidth());
      return w;
    }
    if (family === "large") {
      w.addSpacer(8);
      if ((d.past || []).length) {
        row(w, "الحجوزات السابقة", { icon: "clock.arrow.circlepath", font: Font.boldSystemFont(12), color: SOFT });
        pastRows(w, d.past, show, (d.events || []).length ? 2 : 3);   // سطر للمناسبات
        w.addSpacer(6);
      }
      billRows(w, d.bills, false);
      const cw = contentWidth();
      w.addSpacer();
      eventsStrip(w, d.events, cw, opts);
      w.addSpacer();
      actionPills(w, d.incomplete, opts, cw);
      w.addSpacer(6);
      compareTiles(w, d.stats, d.prevStats, cw);
      w.addSpacer(6);
      slimPrices(w, d.prices, cw, opts, d.pricing);
      return w;
    } else if (family === "medium") {
      w.addSpacer();
      billRows(w, d.bills, true);
    }
    w.addSpacer();
    return w;
  }

  if (family === "small") {
    row(w, mainTitle, { icon: mainIcon, font: Font.boldSystemFont(13), color: WHITE, iconSize: 13 });
    w.addSpacer(3);
    if (show) row(w, nameOf(main, show), { icon: "person.fill", font: Font.boldSystemFont(13), color: WHITE });
    if (platformLine(main)) row(w, platformLine(main), { icon: PLATFORM_ICON[main.source] || "calendar", font: Font.systemFont(11), color: SOFT });
    row(w, main.inLabel + " ← " + main.outLabel, { icon: "calendar", font: Font.systemFont(11), color: SOFT });
    row(w, main.nightsLabel, { icon: "moon.fill", font: Font.systemFont(11), color: SOFT });
    w.addSpacer();
    return w;
  }

  if (family === "medium") {
    card(w, main, mainTitle, mainIcon, show, true);
    const after = cur ? next : (d.upcoming || []).find((x) => x !== main && x.checkin > main.checkin);
    if (after) {
      w.addSpacer(5);
      row(w, after.when + " • " + [nameOf(after, show), platformLine(after)].filter(Boolean).join(" • ") + " • " + after.range,
        { icon: PLATFORM_ICON[after.source] || "calendar", font: Font.systemFont(11), color: SOFT });
    }
    w.addSpacer();
    billRows(w, d.bills, true);
    return w;
  }

  // الكبيرة (مختصرة): بطاقة رئيسية بثلاثة أسطر، أسطر معلومات بلا عناوين، ثم المؤشرات والأسعار
  (d.departuresToday || []).forEach((x) => row(w, "مغادرة اليوم: " + (show ? x.first + " — " : "") + "جهّز الشقة للتنظيف",
    { icon: "arrow.up.right", font: Font.boldSystemFont(12), color: WHITE }));
  if ((d.departuresToday || []).length) w.addSpacer(5);

  heroCard(w, main, cur ? "مقيم الآن" : next.when, cur ? "house.fill" : "calendar.badge.clock", show);
  w.addSpacer(7);

  // سطر واحد لكل معلومة: التالي، آخر مغادر، الإنترنت/الكهرباء، الحجوزات الناقصة
  const second = cur ? next : (d.upcoming || []).find((x) => x.checkin > main.checkin);
  if (second) {
    row(w, "التالي " + second.when + ": " + guestAndPlatform(second, show).concat([second.inLabel]).join(" • "),
      { icon: "calendar.badge.clock", font: Font.systemFont(11), color: SOFT });
  }
  const last = (d.past || [])[0];
  if (last) {
    row(w, "آخر مغادر: " + guestAndPlatform(last, show).concat([last.left]).join(" • "),
      { icon: "clock.arrow.circlepath", font: Font.systemFont(11), color: SOFT });
  }
  billRows(w, d.bills, true);

  if (page === "1") {
    // الصفحة 1: الحجوزات القادمة في الفراغ بدل المؤشرات (هي في الصفحة 2)
    w.addSpacer(8);
    upcomingRows(w, d, [main, second], show, 4);
    w.addSpacer();
    actionPills(w, d.incomplete, opts, contentWidth());
    return w;
  }

  // المناسبات في الفراغ: بطاقات إن اتسع المكان، وإلا سطر واحد
  const infoLines = (d.departuresToday || []).length + (second ? 1 : 0) + (last ? 1 : 0) + (d.bills || []).length;
  const cw = contentWidth();
  // فراغان مرنان حول المناسبات: تتوسط المساحة الفارغة بدل الالتصاق بأعلاها
  if (infoLines <= 3) { w.addSpacer(); eventsStrip(w, d.events, cw, opts); }
  else if (infoLines <= 4) { w.addSpacer(); eventLine(w, d.events); }

  w.addSpacer();
  actionPills(w, d.incomplete, opts, cw);
  w.addSpacer(6);
  compareTiles(w, d.stats, d.prevStats, cw);
  w.addSpacer(6);
  slimPrices(w, d.prices, cw, opts, d.pricing);
  return w;
}

/* ---------------------------------------------------------------------
   الحجز السريع والإكمال — نماذج أصلية داخل Scriptable (بعد الضغط على الزر)
   تُكتب في القاعدة عبر دوال الهجرة 0015 بمفتاح الكتابة، والقاعدة ترفض أي
   حجز يتقاطع مع حجز قائم.
   --------------------------------------------------------------------- */
const SUPABASE_URL = "https://divoyxodxkioxugrphby.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_qw9IiQ52_WFip-4gNX4lkA_CZA0VFzf";
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const SOURCES = [
  { id: "whatsapp", label: "واتساب" },
  { id: "direct", label: "الموقع المباشر" },
  { id: "gathern", label: "جاذر إن" },
  { id: "airbnb", label: "Airbnb" },
  { id: "manual", label: "إضافة يدوية" },
  { id: "block", label: "حجب / صيانة" },
];
const SOURCE_NAME = { whatsapp: "واتساب", direct: "الموقع المباشر", gathern: "جاذر إن", airbnb: "Airbnb", manual: "يدوي", block: "حجب", ical: "تقويم خارجي" };

const DAY_MS = 86400000;
const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const fromIso = (s) => { const p = String(s).split("-").map(Number); return new Date(p[0], p[1] - 1, p[2], 12); };
const dayLabel = (s) => { const d = fromIso(s); return d.getDate() + " " + MONTHS[d.getMonth()]; };
// أرقام عربية/فارسية ← لاتينية، وإزالة الفواصل
const latin = (s) => String(s || "").replace(/[٠-٩]/g, (c) => "٠١٢٣٤٥٦٧٨٩".indexOf(c)).replace(/[۰-۹]/g, (c) => "۰۱۲۳۴۵۶۷۸۹".indexOf(c)).replace(/[,،\s]/g, "");
const num = (s) => { const v = parseFloat(latin(s)); return isFinite(v) && v >= 0 ? v : null; };
const nightsWord = (n) => (n === 1 ? "ليلة واحدة" : n === 2 ? "ليلتان" : n <= 10 ? n + " ليالٍ" : n + " ليلة");
const isPlaceholder = (g) => !String(g || "").trim() || /^ضيف\s/.test(String(g).trim()) || /^(reserved|booked|محجوز|not available)$/i.test(String(g).trim());

async function rpc(fn, body) {
  const req = new Request(SUPABASE_URL + "/rest/v1/rpc/" + fn);
  req.method = "POST";
  req.timeoutInterval = 20;
  req.headers = { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY, "Content-Type": "application/json" };
  req.body = JSON.stringify(body);
  let j = null;
  try { j = JSON.parse(await req.loadString()); } catch (e) {
    if (!req.response || !req.response.statusCode) throw new Error("تعذّر الاتصال — تحقق من الإنترنت");
  }
  const code = req.response && req.response.statusCode;
  if (code >= 200 && code < 300) return j;
  const msg = (j && (j.message || j.hint || j.code)) || "";
  if (/dates taken/.test(msg)) throw new Error("عفواً الأيام المختارة محجوزة");
  if (/invalid widget key/.test(msg)) throw new Error("مفتاح الأداة غير صالح — انسخ السكربت من لوحة التحكم ← الإشعارات من جديد");
  if (/invalid dates/.test(msg)) throw new Error("تواريخ غير صحيحة (الحد 60 ليلة)");
  if (/booking not found/.test(msg)) throw new Error("الحجز لم يعد يحتاج إكمالاً أو أُلغي");
  if (/invalid price/.test(msg)) throw new Error("سعر غير صحيح — من 50 إلى 5000 ر.س");
  if (/PGRST202|Could not find the function/.test(msg + (j && j.code))) {
    throw new Error("طبّق الهجرة " + (/pric/.test(fn) ? "0016" : "0015") + " في Supabase أولاً");
  }
  throw new Error("رفض الخادم الطلب (" + code + ")" + (msg ? ": " + msg : ""));
}

async function say(title, message, buttons) {
  const a = new Alert();
  a.title = title;
  a.message = message || "";
  (buttons || ["حسناً"]).forEach((b) => a.addAction(b));
  return a.present();
}

async function pickCheckin() {
  const dp = new DatePicker();
  dp.initialDate = new Date();
  dp.minimumDate = new Date(Date.now() - 60 * DAY_MS);   // لتسجيل حجز سابق فات
  try { return await dp.pickDate(); } catch (e) { return null; }   // أُلغي الاختيار
}

async function quickBook(key) {
  const s = new Alert();
  s.title = "حجز سريع";
  s.message = "من أين الحجز؟";
  SOURCES.forEach((x) => s.addAction(x.label));
  s.addCancelAction("إلغاء");
  const si = await s.presentSheet();
  if (si < 0) return;
  const src = SOURCES[si].id;

  // التاريخ والليالي — يُعاد السؤال إن كانت الأيام محجوزة
  let ci, co, nights;
  for (;;) {
    const picked = await pickCheckin();
    if (!picked) return;
    ci = iso(picked);
    const n = new Alert();
    n.title = "عدد الليالي";
    n.message = "الدخول " + dayLabel(ci);
    const f = n.addTextField("عدد الليالي", "1");
    f.setNumberPadKeyboard();
    n.addAction("التالي");
    n.addCancelAction("إلغاء");
    if (await n.present() < 0) return;
    nights = Math.round(num(n.textFieldValue(0)) || 0);
    if (nights < 1 || nights > 60) { await say("عدد غير صحيح", "اكتب عدد الليالي من 1 إلى 60"); continue; }
    co = iso(new Date(fromIso(ci).getTime() + nights * DAY_MS));
    let free;
    try { free = await rpc("widget_dates_free", { p_key: key, p_checkin: ci, p_checkout: co }); }
    catch (e) { await say("تعذّر التحقق", e.message); return; }
    if (free) break;
    const again = await say("عفواً الأيام المختارة محجوزة", dayLabel(ci) + " ← " + dayLabel(co) + " تتقاطع مع حجز قائم", ["اختيار تاريخ آخر", "إلغاء"]);
    if (again !== 0) return;
  }

  let guest = "", phone = "", total = 0, fee = 0;
  if (src !== "block") {
    const g = new Alert();
    g.title = "بيانات الضيف";
    g.message = SOURCE_NAME[src] + " • " + dayLabel(ci) + " ← " + dayLabel(co) + " • " + nightsWord(nights);
    g.addTextField("اسم الضيف", "");
    g.addTextField("الجوال (اختياري)", "").setPhonePadKeyboard();
    g.addTextField("المبلغ الإجمالي (ر.س)", "").setDecimalPadKeyboard();
    const platform = src === "gathern" || src === "airbnb";
    if (platform) g.addTextField("عمولة المنصة (ر.س) — اختياري", "").setDecimalPadKeyboard();
    g.addAction("حفظ الحجز");
    g.addCancelAction("إلغاء");
    if (await g.present() < 0) return;
    guest = g.textFieldValue(0).trim();
    phone = latin(g.textFieldValue(1));
    total = num(g.textFieldValue(2)) || 0;
    if (platform) fee = num(g.textFieldValue(3)) || 0;
  }

  try {
    await rpc("widget_quick_book", {
      p_key: key, p_source: src, p_checkin: ci, p_checkout: co,
      p_guest: guest, p_phone: phone, p_total: total, p_commission: fee,
    });
  } catch (e) { await say("لم يُحفظ الحجز", e.message); return; }
  await say(src === "block" ? "✅ حُجبت الأيام" : "✅ تم الحجز",
    [guest, SOURCE_NAME[src], dayLabel(ci) + " ← " + dayLabel(co), nightsWord(nights), total ? total + " ر.س" : ""].filter(Boolean).join(" • ")
    + "\nيظهر في لوحة التحكم والتقويم الآن، وفي الأداة عند تحديثها التالي.");
}

async function completeFlow(key) {
  let saved = false;
  for (;;) {
    let list;
    try { list = await rpc("widget_pending", { p_key: key }); }
    catch (e) { await say("تعذّر التحميل", e.message); return; }
    if (!list || !list.length) {
      await say(saved ? "✅ حُفظ — اكتملت كل الحجوزات" : "✅ لا حجوزات تحتاج إكمال", "كل حجوزات المنصات مكتملة البيانات");
      return;
    }

    const today = iso(new Date());
    const a = new Alert();
    a.title = saved ? "✅ حُفظ — التالي؟" : "إكمال حجوزات المنصات";
    a.message = "اختر الحجز لإضافة اسم الضيف والمبلغ";
    list.forEach((b) => a.addAction((SOURCE_NAME[b.source] || b.source) + " • " + dayLabel(b.checkin) + " ← " + dayLabel(b.checkout)
      + (b.checkout <= today ? " (سابق)" : b.checkin <= today ? " (مقيم)" : "")));
    a.addCancelAction("إغلاق");
    const i = await a.presentSheet();
    if (i < 0) return;
    const b = list[i];

    const missing = [isPlaceholder(b.guest) && "الاسم", !(Number(b.total) > 0) && "المبلغ"].filter(Boolean);
    const f = new Alert();
    f.title = "إكمال الحجز";
    f.message = (SOURCE_NAME[b.source] || b.source) + " • " + dayLabel(b.checkin) + " ← " + dayLabel(b.checkout)
      + (missing.length ? "\nينقص: " + missing.join(" و") : "");
    f.addTextField("اسم الضيف", isPlaceholder(b.guest) ? "" : b.guest);
    f.addTextField("الجوال (اختياري)", b.phone || "").setPhonePadKeyboard();
    f.addTextField("المبلغ الإجمالي (ر.س)", Number(b.total) > 0 ? String(b.total) : "").setDecimalPadKeyboard();
    f.addTextField("عمولة المنصة (ر.س)", Number(b.commission) > 0 ? String(b.commission) : "").setDecimalPadKeyboard();
    f.addAction("حفظ");
    f.addCancelAction("رجوع");
    if (await f.present() < 0) continue;

    const guest = f.textFieldValue(0).trim();
    const total = num(f.textFieldValue(2));
    const fee = num(f.textFieldValue(3));
    try {
      await rpc("widget_complete", {
        p_key: key, p_id: b.id,
        p_guest: guest || null, p_phone: latin(f.textFieldValue(1)) || null,
        p_total: total, p_commission: fee,
      });
    } catch (e) { await say("لم يُحفظ", e.message); continue; }
    saved = true;   // القائمة تُحمَّل من جديد: ما اكتمل يختفي منها
  }
}

/* ---------- الأسعار ---------- */
const round10 = (x) => Math.round(x / 10) * 10;

// سعر وسط الأسبوع والويكند المعروض للضيوف في الموقع
async function editPrices(key) {
  let cur;
  try { cur = await rpc("public_pricing", {}); } catch (e) { await say("تعذّر تحميل الأسعار", e.message); return; }
  const a = new Alert();
  a.title = "أسعار الليلة";
  a.message = "السعر الذي يراه الضيف في الموقع\nالويكند = ليلتا الخميس والجمعة";
  a.addTextField("وسط الأسبوع (ر.س)", String(cur.weekday)).setNumberPadKeyboard();
  a.addTextField("الويكند (ر.س)", String(cur.weekend)).setNumberPadKeyboard();
  a.addAction("حفظ");
  a.addCancelAction("إلغاء");
  if (await a.present() < 0) return;
  const wd = Math.round(num(a.textFieldValue(0)) || 0), we = Math.round(num(a.textFieldValue(1)) || 0);
  try {
    await rpc("widget_set_prices", { p_key: key, p_weekday: wd, p_weekend: we });
  } catch (e) { await say("لم تُحفظ الأسعار", e.message); return; }
  await say("✅ حُفظت الأسعار", "وسط الأسبوع " + wd + " ر.س • الويكند " + we + " ر.س\nتظهر للضيوف في الموقع فوراً.");
}

// سعر خاص لكل ليالي مناسبة — بخيارات جاهزة من سعر الويكند أو سعر تحدده
async function editEventPrice(key, p) {
  const from = p.from, to = p.to, name = p.name || "المناسبة";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || "")) return;
  let cur;
  try { cur = await rpc("public_pricing", {}); } catch (e) { await say("تعذّر تحميل الأسعار", e.message); return; }
  const ov = (cur.overrides || []).find((o) => o.from === from && o.to === to);
  const nights = Math.round((fromIso(to) - fromIso(from)) / DAY_MS) + 1;
  const base = Number(cur.weekend) || 280;
  const choices = [
    { label: "+25% ← " + round10(base * 1.25) + " ر.س", v: round10(base * 1.25) },
    { label: "+50% ← " + round10(base * 1.5) + " ر.س", v: round10(base * 1.5) },
    { label: "ضعف السعر ← " + round10(base * 2) + " ر.س", v: round10(base * 2) },
    { label: "سعر آخر…", v: "custom" },
  ];
  if (ov) choices.push({ label: "إلغاء السعر الخاص (العودة للعادي)", v: 0 });

  const a = new Alert();
  a.title = name + " • " + dayLabel(from) + (to !== from ? " ← " + dayLabel(to) : "");
  a.message = "سعر كل ليلة من لياليها (" + nightsWord(nights) + ")\n"
    + (ov ? "الحالي: سعر خاص " + ov.price + " ر.س" : "الحالي: العادي " + cur.weekday + " / الويكند " + cur.weekend + " ر.س")
    + "\nالنسب محسوبة من سعر الويكند";
  choices.forEach((c) => a.addAction(c.label));
  a.addCancelAction("إغلاق");
  const i = await a.presentSheet();
  if (i < 0) return;
  let price = choices[i].v;
  if (price === "custom") {
    const f = new Alert();
    f.title = "سعر الليلة في " + name;
    f.addTextField("السعر (ر.س)", ov ? String(ov.price) : String(base)).setNumberPadKeyboard();
    f.addAction("حفظ");
    f.addCancelAction("إلغاء");
    if (await f.present() < 0) return;
    price = Math.round(num(f.textFieldValue(0)) || 0);
    if (!price) return;
  }
  try {
    await rpc("widget_set_event_price", { p_key: key, p_from: from, p_to: to, p_price: price || null, p_label: name });
  } catch (e) { await say("لم يُحفظ السعر", e.message); return; }
  await say(price ? "✅ سعر " + name + ": " + price + " ر.س" : "✅ أُلغي السعر الخاص",
    price ? "لكل ليلة من " + dayLabel(from) + " إلى " + dayLabel(to) + " — يظهر للضيوف في الموقع فوراً."
      : "ليالي " + name + " تعود للسعر العادي.");
}

// يُستدعى من المُحمِّل عند التشغيل داخل التطبيق بـ ?action=… — يعيد true إن تولّى الطلب
async function handle(opts, params) {
  const action = params && params.action;
  if (["book", "complete", "prices", "event"].indexOf(action) === -1) return false;
  if (!hasWriteKey(opts)) {
    const r = await say("يلزم تحديث السكربت", "لتفعيل الحجز السريع من الأداة: لوحة التحكم ← الإشعارات ← نسخ السكربت، ثم ألصقه مكان القديم في Scriptable.\nأو افتح لوحة التحكم الآن.", ["فتح لوحة التحكم", "إغلاق"]);
    if (r === 0) Safari.open(ADMIN_URL + "#" + action);
    return true;
  }
  if (action === "book") await quickBook(opts.WRITE_KEY);
  else if (action === "complete") await completeFlow(opts.WRITE_KEY);
  else if (action === "prices") await editPrices(opts.WRITE_KEY);
  else await editEventPrice(opts.WRITE_KEY, params);
  return true;
}

module.exports = { build, handle };
