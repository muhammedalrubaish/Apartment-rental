// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: orange; icon-glyph: home;
// RentAPA — الحجوزات على شاشة القفل والشاشة الرئيسية (تطبيق Scriptable)
//
// هذا «مُحمِّل» صغير يُلصق مرة واحدة فقط: تصميم الأداة يُنزَّل من الموقع عند كل
// تحديث، فتصلك التحسينات تلقائياً. إن انقطع الإنترنت يُستخدم آخر تصميم محفوظ.
//
// التثبيت:
//   1) ثبّت Scriptable ← زر + ← ألصق هذا النص كاملاً ← سمّه RentAPA
//   2) الشاشة الرئيسية أو شاشة القفل: أضف أداة Scriptable ← اضغطها ← Script: RentAPA
//
// ⚠️ الرابط والمفتاح أدناه خاصان بك (قراءة الحجوزات وإضافتها) — لا تشاركهما مع أحد.

const DATA_URL = "__DATA_URL__";

// مفتاح الحجز السريع وإكمال حجوزات المنصات من الأداة (الهجرة 0015)
const WRITE_KEY = "__WRITE_KEY__";

// true: اسم الضيف ظاهر — false: التواريخ والمنصة فقط (شاشة القفل يراها من يرى جوالك)
const SHOW_NAMES = true;

const CODE_URL = "https://rentapa.vercel.app/assets/widget/rentapa-widget.js";
const fm = FileManager.local();
const codePath = fm.joinPath(fm.cacheDirectory(), "rentapa-widget.js");

// تنزيل أحدث تصميم (يُحفظ فقط إن كان سليماً)
try {
  const req = new Request(CODE_URL + "?v=" + Math.floor(Date.now() / 600000));
  req.timeoutInterval = 10;
  const code = await req.loadString();
  if (req.response && req.response.statusCode === 200 && code.indexOf("module.exports") !== -1) {
    fm.writeString(codePath, code);
  }
} catch (e) { /* نستخدم التصميم المحفوظ */ }

let widget;
let handled = false;   // ضغطة «حجز سريع» / «إكمال» في الأداة تفتح نماذجها بدل المعاينة
if (fm.fileExists(codePath)) {
  const mod = importModule(codePath);
  const opts = { DATA_URL, WRITE_KEY, SHOW_NAMES, family: config.widgetFamily || "large" };
  const params = args.queryParameters || {};
  if (!config.runsInWidget && params.action && mod.handle) handled = await mod.handle(opts, params);
  if (!handled) widget = await mod.build(opts);
} else {
  widget = new ListWidget();
  widget.addText("RentAPA: تعذّر تحميل الأداة — تحقق من الإنترنت ثم أعد المحاولة");
}

if (handled) {
  // انتهى النموذج — لا معاينة
} else if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentLarge();   // معاينة عند تشغيل السكربت من داخل التطبيق
}
Script.complete();
