// RentAPA — تصميم أداة الحجوزات (وحدة Scriptable)
// لا تُلصق هذا الملف في Scriptable: المُحمِّل (rentapa-scriptable.js) ينزّله من الموقع
// عند كل تحديث للأداة، فتصل التعديلات تلقائياً دون نسخ ولصق من جديد.
//
// build({ DATA_URL, SHOW_NAMES, family }) → ListWidget
// الأشكال: small / medium / large (الشاشة الرئيسية)،
//          accessoryRectangular / accessoryInline / accessoryCircular (شاشة القفل)

const ADMIN_URL = "https://rentapa.vercel.app/admin";

// أيقونات المنصات (رموز نظام iPhone — تُلوَّن بالأبيض على الشاشة الرئيسية)
const PLATFORM_ICON = {
  airbnb: "a.circle.fill",
  gathern: "g.circle.fill",
  whatsapp: "message.fill",
  direct: "globe",
  manual: "pencil.circle.fill",
  ical: "calendar",
};

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

// سطر عربي من اليمين: [فراغ] النص  الأيقونة
function row(parent, text, opts) {
  const o = opts || {};
  const r = parent.addStack();
  r.layoutHorizontally();
  r.centerAlignContent();
  r.addSpacer();
  const t = r.addText(text);
  t.font = o.font || Font.systemFont(12);
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.55;
  if (o.color) t.textColor = o.color;
  if (o.icon) {
    r.addSpacer(o.gap || 5);
    const im = r.addImage(sym(o.icon));
    const size = o.iconSize || 12;
    im.imageSize = new Size(size, size);
    if (o.color) im.tintColor = o.color;
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

  row(w, "RentAPA" + (d && d.stale ? " ⟳" : ""), { icon: "building.2.fill", font: Font.boldSystemFont(12), color: SOFT, iconSize: 12 });
  w.addSpacer(6);

  if (!d) {
    row(w, "تعذّر التحديث — تحقق من الإنترنت", { icon: "exclamationmark.triangle.fill", font: Font.boldSystemFont(13), color: WHITE });
    w.addSpacer();
    return w;
  }
  if (!main) {
    row(w, "لا حجوزات قادمة", { icon: "calendar.badge.checkmark", font: Font.boldSystemFont(15), color: WHITE, iconSize: 15 });
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
    return w;
  }

  // الكبيرة: حركة اليوم، بطاقة المقيم، بطاقة القادم، ثم بقية الحجوزات
  (d.departuresToday || []).forEach((x) => row(w, "مغادرة اليوم: " + (show ? x.first + " — " : "") + "جهّز الشقة للتنظيف",
    { icon: "arrow.up.right.circle.fill", font: Font.boldSystemFont(12), color: WHITE }));
  if ((d.departuresToday || []).length) w.addSpacer(5);

  if (cur) { card(w, cur, "مقيم الآن", "house.fill", show, false); w.addSpacer(6); }
  if (next) { card(w, next, "الحجز القادم • " + next.when, "calendar.badge.clock", show, !!cur); w.addSpacer(6); }

  const shown = [cur, next].filter(Boolean).map((x) => x.checkin + x.checkout);
  const rest = (d.upcoming || []).filter((x) => shown.indexOf(x.checkin + x.checkout) === -1).slice(0, cur ? 2 : 3);
  if (rest.length) {
    row(w, "بعدها", { icon: "list.bullet", font: Font.boldSystemFont(12), color: SOFT });
    w.addSpacer(2);
    rest.forEach((x) => row(w, x.when + " • " + [nameOf(x, show), platformLine(x)].filter(Boolean).join(" • ") + " • " + x.range,
      { icon: PLATFORM_ICON[x.source] || "calendar", font: Font.systemFont(11), color: SOFT }));
  }

  w.addSpacer();
  const tl = timeLabel();
  if (tl) row(w, "آخر تحديث " + tl, { icon: "arrow.clockwise", font: Font.systemFont(9), color: SOFT, iconSize: 9 });
  return w;
}

module.exports = { build };
