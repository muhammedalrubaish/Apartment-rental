// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: orange; icon-glyph: home;
// RentAPA — الحجوزات القادمة على شاشة القفل والشاشة الرئيسية (تطبيق Scriptable)
//
// التثبيت:
//   1) ثبّت تطبيق Scriptable المجاني من App Store
//   2) افتحه ← زر + ← ألصق هذا السكربت كاملاً ← سمّه RentAPA ← تم
//   3) شاشة القفل: اضغط مطولاً ← تخصيص ← شاشة القفل ← أضف أداة ← Scriptable
//      ← اختر الشكل المستطيل ← اضغط الأداة ← Script: RentAPA
//
// ⚠️ الرابط أدناه خاص بك ويقرأ حجوزاتك — لا تشاركه مع أحد.

const DATA_URL = "__DATA_URL__";
const ADMIN_URL = "https://rentapa.vercel.app/admin";

// false: التواريخ فقط (شاشة القفل يراها من يرى جوالك) — true: يظهر الاسم الأول للضيف
const SHOW_NAMES = false;

const fm = FileManager.local();
const cachePath = fm.joinPath(fm.cacheDirectory(), "rentapa-upcoming.json");

// آخر بيانات ناجحة تُحفظ، فتبقى الأداة تعرض شيئاً عند انقطاع الإنترنت
async function load() {
  try {
    const req = new Request(DATA_URL);
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

const who = (x) => (SHOW_NAMES && x.first ? x.first + " • " : "");

// كل حالة: أيقونة نظام iPhone (SF Symbol) + ثلاثة أسطر
function lines(d) {
  if (!d) return ["exclamationmark.triangle.fill", "RentAPA", "تعذّر التحديث", ""];
  if (d.current) {
    const next = d.next && d.next.checkin !== d.current.checkin ? "التالي " + d.next.when + ": " + d.next.inLabel : "";
    return ["house.fill", "مقيم الآن", who(d.current) + "المغادرة " + d.current.outLabel, next];
  }
  if (d.next) {
    return ["calendar.badge.clock", "الحجز القادم " + d.next.when, who(d.next) + d.next.range,
      d.next.nightsLabel + (d.next.sourceLabel ? " • " + d.next.sourceLabel : "")];
  }
  return ["calendar.badge.checkmark", "RentAPA", "لا حجوزات قادمة", ""];
}

// النص محاذى لليمين (عربي)
function text(stack, value, font, opacity) {
  if (!value) return;
  const t = stack.addText(value);
  t.font = font;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.6;
  t.rightAlignText();
  if (opacity) t.textOpacity = opacity;
  return t;
}

function symbol(name) {
  const sf = SFSymbol.named(name) || SFSymbol.named("house.fill");
  return sf.image;
}

// سطر العنوان: النص ثم الأيقونة على يمينه — ترتيب عربي من اليمين لليسار
function header(w, icon, title, size, color) {
  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.addSpacer();
  const t = row.addText(title);
  t.font = Font.boldSystemFont(size);
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.6;
  if (color) t.textColor = color;
  row.addSpacer(4);
  const img = row.addImage(symbol(icon));
  img.imageSize = new Size(size + 1, size + 1);
  if (color) img.tintColor = color;
  return row;
}

async function build(d, family) {
  const w = new ListWidget();
  w.url = ADMIN_URL;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  const [icon, l1, l2, l3] = lines(d);

  if (family === "accessoryInline") {
    // سطر واحد فوق الساعة
    const inline = !d ? "RentAPA: تعذّر التحديث"
      : d.current ? "🏠 مقيم حتى " + d.current.outLabel
      : d.next ? "📅 " + d.next.when + ": " + d.next.inLabel
      : "RentAPA: لا حجوزات";
    text(w, inline, Font.systemFont(12));
    return w;
  }

  if (family === "accessoryCircular") {
    // دائرة صغيرة: عدد الأيام حتى الوصول القادم، أو الليالي المتبقية للمقيم
    w.addAccessoryWidgetBackground = true;
    const big = !d ? "!" : d.current ? String(d.current.nightsLeft) : d.next ? (d.next.inDays <= 0 ? "0" : String(d.next.inDays)) : "—";
    const small = !d ? "RentAPA" : d.current ? "ليلة باقية" : d.next ? (d.next.inDays <= 0 ? "وصول اليوم" : "يوم للوصول") : "لا حجز";
    const top = w.addStack();
    top.addSpacer();
    const ic = top.addImage(symbol(icon));
    ic.imageSize = new Size(12, 12);
    top.addSpacer();
    const a = text(w, big, Font.boldRoundedSystemFont(18)); if (a) a.centerAlignText();
    const b = text(w, small, Font.systemFont(8)); if (b) b.centerAlignText();
    return w;
  }

  if (family === "accessoryRectangular") {
    header(w, icon, l1, 13);
    text(w, l2, Font.systemFont(12));
    text(w, l3 + (d && d.stale ? " ⟳" : ""), Font.systemFont(11), 0.8);
    return w;
  }

  // أدوات الشاشة الرئيسية: خلفية بهوية الموقع وقائمة الحجوزات القادمة
  const g = new LinearGradient();
  g.colors = [new Color("#f2622a"), new Color("#d8521c")];
  g.locations = [0, 1];
  w.backgroundGradient = g;
  w.setPadding(12, 14, 12, 14);
  const white = (t) => { if (t) t.textColor = Color.white(); };

  header(w, "building.2.fill", "RentAPA" + (d && d.stale ? " ⟳" : ""), 12, new Color("#ffffff", 0.85));
  w.addSpacer(4);
  header(w, icon, l1, 15, Color.white());
  white(text(w, l2, Font.systemFont(13)));
  white(text(w, l3, Font.systemFont(12), 0.85));

  if (family !== "small" && d && d.upcoming && d.upcoming.length > 1) {
    w.addSpacer(6);
    d.upcoming.slice(1, family === "large" ? 6 : 3).forEach((x) => {
      white(text(w, "• " + x.when + ": " + who(x) + x.range + " (" + x.nightsLabel + ")", Font.systemFont(11), 0.9));
    });
  }
  w.addSpacer();
  return w;
}

const data = await load();
const family = config.widgetFamily || "medium";
const widget = await build(data, family);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();   // معاينة عند تشغيل السكربت من داخل التطبيق
}
Script.complete();
