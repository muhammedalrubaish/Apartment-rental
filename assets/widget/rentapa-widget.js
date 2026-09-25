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
  manual: "pencil.circle.fill",
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
  t.size = new Size(o.width, o.height);

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
function slimPrices(parent, pr, width) {
  if (!pr) return;
  const gap = 6;
  const tw = Math.floor((width - gap) / 2);
  const txt = (x) => (x.min === x.max ? String(x.min) : x.min + " – " + x.max) + " ر.س";
  const src = (x) => (x.configured ? "معتمد" : "مباشر");
  const r = parent.addStack();
  r.layoutHorizontally();
  tile(r, { width: tw, height: 36, icon: "sun.max.fill", label: "وسط الأسبوع • " + src(pr.weekday), value: txt(pr.weekday), valueSize: 13 });
  r.addSpacer(gap);
  tile(r, { width: tw, height: 36, icon: "sparkles", label: "الويكند • " + src(pr.weekend), value: txt(pr.weekend), valueSize: 13 });
}

// تذكير: حجوزات من المنصات تنقصها بيانات — الضغط يفتح لوحة التحكم لإكمالها
function incompleteRow(parent, inc) {
  if (!inc || !inc.count) return false;
  const n = inc.count;
  const label = n === 1 ? "حجز من المنصات يحتاج إكمال" : n === 2 ? "حجزان من المنصات يحتاجان إكمال"
    : n + (n <= 10 ? " حجوزات" : " حجزاً") + " من المنصات تحتاج إكمال";
  const r = row(parent, label, { icon: "exclamationmark.circle.fill", font: Font.boldSystemFont(11), color: WHITE });
  r.url = ADMIN_URL + "#dashboard";
  return true;
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

// عرض المحتوى الداخلي للأداة الكبيرة بالنقاط (يختلف قليلاً بين أجهزة iPhone)
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

async function build(opts) {
  const show = opts.SHOW_NAMES !== false;
  const family = opts.family || "large";
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
      const t = h.addText("RentAPA" + (d && d.stale ? " ⟳" : ""));
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
  if (!main) {
    row(w, "لا حجوزات قادمة", { icon: "calendar.badge.checkmark", font: Font.boldSystemFont(15), color: WHITE, iconSize: 15 });
    if (family === "large") {
      w.addSpacer(8);
      if ((d.past || []).length) {
        row(w, "الحجوزات السابقة", { icon: "clock.arrow.circlepath", font: Font.boldSystemFont(12), color: SOFT });
        pastRows(w, d.past, show, 3);
        w.addSpacer(6);
      }
      billRows(w, d.bills, false);
      w.addSpacer();
      if (incompleteRow(w, d.incomplete)) w.addSpacer(5);
      const cw = contentWidth();
      compareTiles(w, d.stats, d.prevStats, cw);
      w.addSpacer(6);
      slimPrices(w, d.prices, cw);
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
    { icon: "arrow.up.right.circle.fill", font: Font.boldSystemFont(12), color: WHITE }));
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
  incompleteRow(w, d.incomplete);

  w.addSpacer();
  const cw = contentWidth();
  compareTiles(w, d.stats, d.prevStats, cw);
  w.addSpacer(6);
  slimPrices(w, d.prices, cw);
  return w;
}

module.exports = { build };
