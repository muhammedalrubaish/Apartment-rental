/*
 * مجسم ثلاثي الأبعاد للشقة — يُبنى بالكامل من ملف data/floorplan.json
 * عدّل الأرقام في ذلك الملف فقط، وسيُعاد رسم الجدران والأثاث تلقائياً.
 */
import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';

/* نسخة احتياطية تُستخدم إذا تعذّر تحميل الملف (مثلاً عند الفتح عبر file://) */
const FALLBACK = {
    apartment: { width: 9, depth: 6.5, wallHeight: 2.9, wallThickness: 0.12 },
    rooms: [
        { key: 'bedroom', name: 'غرفة النوم', type: 'bedroom', x: 0, z: 0, w: 4.5, d: 3.3 },
        { key: 'bath', name: 'دورة المياه', type: 'bath', x: 0, z: 3.3, w: 2.6, d: 3.2 },
        { key: 'kitchen', name: 'المطبخ', type: 'kitchen', x: 2.6, z: 3.3, w: 1.9, d: 3.2 },
        { key: 'living', name: 'الصالة', type: 'living', x: 4.5, z: 0, w: 4.5, d: 4.6 },
        { key: 'hall', name: 'المدخل والممر', type: 'hall', x: 4.5, z: 4.6, w: 4.5, d: 1.9 },
    ],
    openings: [],
    windows: [],
};

const ROOM_INFO = {
    bedroom: { icon: '🛏️', desc: 'سرير كوين فاخر مع دولاب ملابس وإضاءة دافئة.' },
    living: { icon: '🛋️', desc: 'صالة أنيقة بشاشة ذكية وأريكة مريحة وإنترنت عالي السرعة.' },
    kitchen: { icon: '🍳', desc: 'مطبخ مجهز بالكامل للطبخ: ثلاجة وفرن ومغسلة وخزائن.' },
    bath: { icon: '🚿', desc: 'حمام كامل مع دش ومغسلة وسخان مياه.' },
    hall: { icon: '🔑', desc: 'دخول ذكي بالبصمة والرمز (قفل Tuya) — تسجيل وصول ذاتي.' },
};

/* ── أدوات مساعدة ───────────────────────────────────────────────── */
const mat = (color, opts = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...opts });

/* نسيج متكرر: يُكرَّر كل repeat متر تقريباً (UV الأشكال المبثوقة بوحدة المتر) */
const tiled = (tex, rx, ry) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(rx, ry);
    return tex;
};

const MAT = {
    floorWood: mat(0xf3f1ee, { roughness: 0.3, metalness: 0.02, map: makeMarbleTexture() }),   // رخام أبيض كما في الصور
    floorTile: mat(0xf4f3f1, { roughness: 0.3, metalness: 0.02, map: makeMarbleTexture() }),
    floorBath: mat(0xdde6ee, { roughness: 0.28, map: makeMarbleTexture() }),
    wall: mat(0xe4ddd3, { roughness: 0.92 }),        // جدران بلون بيج دافئ
    wallIn: mat(0xdbd3c8, { roughness: 0.92 }),
    wood: mat(0x8a6a4c, { roughness: 0.55, map: tiled(makeWoodTexture(), 1, 1) }),
    woodLight: mat(0xc9ad8b, { roughness: 0.5, map: tiled(makeWoodTexture(), 1, 1) }),
    fabric: mat(0x7a7c72, { roughness: 0.95, map: tiled(makeFabricTexture(), 3, 3) }),      // كنب رمادي
    fabricWarm: mat(0xe8e6df, { roughness: 0.9, map: tiled(makeFabricTexture(), 3, 3) }),   // وسائد فاتحة
    upholstery: mat(0xcfc6b8, { roughness: 0.95, map: tiled(makeFabricTexture(), 3, 3) }),  // تنجيد السرير
    duvet: mat(0xf7f5f1, { roughness: 0.92, map: tiled(makeFabricTexture(), 4, 4) }),
    lacquer: mat(0xefe8de, { roughness: 0.35 }),                                           // دولاب لامع كريمي
    throwAccent: mat(0xc9774f, { roughness: 0.95, map: tiled(makeFabricTexture(), 4, 4) }), // لمسة برتقالية
    white: mat(0xfafafa, { roughness: 0.4 }),
    ceramic: mat(0xffffff, { roughness: 0.12, metalness: 0.02 }),
    dark: mat(0x2b3440, { roughness: 0.4 }),
    stone: mat(0x3a3d42, { roughness: 0.22, metalness: 0.1 }),
    steel: mat(0xc0c8d0, { roughness: 0.25, metalness: 0.7 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xbfd9ea, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.1 }),
    screenOff: mat(0x0d1117, { roughness: 0.18, metalness: 0.4 }),
    gold: mat(0xc9a227, { roughness: 0.25, metalness: 0.8 }),
    slab: mat(0xc7cdd4, { roughness: 0.9 }),
    lampShade: mat(0xfff1d6, { roughness: 0.9, emissive: 0xffc27a, emissiveIntensity: 0.9 }),
    pot: mat(0xe9e2d6, { roughness: 0.6 }),
    leaf: mat(0x4f7a45, { roughness: 0.7 }),
    leafLight: mat(0x6f9a5c, { roughness: 0.7 }),
    water: new THREE.MeshStandardMaterial({
        color: 0xbfe4f5, transparent: true, opacity: 0.5,
        roughness: 0.08, metalness: 0.1,
        emissive: 0x2b7fa8, emissiveIntensity: 0.25,
    }),
    // مواد الصالة كما في صورتها الفعلية
    sofaGrey: mat(0x6c6d70, { roughness: 0.95, map: tiled(makeFabricTexture(), 3, 3) }),
    chairGrey: new THREE.MeshStandardMaterial({ color: 0x55575b, roughness: 0.95, map: tiled(makeFabricTexture(), 3, 3), side: THREE.DoubleSide }),
    pillowGrid: new THREE.MeshStandardMaterial({ map: makeGridPillowTexture(), roughness: 0.9 }),
    consoleMarble: mat(0xc4c1bc, { roughness: 0.35, map: makeMarbleTexture() }),
    walnut: mat(0x5e4331, { roughness: 0.5, map: tiled(makeWoodTexture(), 2, 2) }),
    blackMetal: mat(0x1d1f22, { roughness: 0.35, metalness: 0.6 }),
    rugGeo: new THREE.MeshStandardMaterial({ map: makeGeoRugTexture(), roughness: 0.98 }),
    artPhoto: new THREE.MeshStandardMaterial({ map: makeAbstractArtTexture(), roughness: 0.75 }),
    petal: mat(0xfbfaf6, { roughness: 0.6 }),
    stem: mat(0x5d8a4a, { roughness: 0.7 }),
    rug: new THREE.MeshStandardMaterial({ map: makeRugTexture(), roughness: 0.95, metalness: 0 }),
    cushion: new THREE.MeshStandardMaterial({ map: makeCushionTexture(), roughness: 0.85, metalness: 0 }),
};

const FLOOR_MAT = {
    bedroom: 'floorWood', living: 'floorWood', hall: 'floorWood',
    kitchen: 'floorTile', bath: 'floorBath',
};

/* ── نُسج مزخرفة تُرسم على canvas: سجاد منقوش ووسائد مربّعات ───────── */
function makeCanvasTexture(w, h, paint) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    paint(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
}

/* سجادة منسوجة بزخارف هندسية — مستوحاة من سجاد الشقة في الصور */
function makeRugTexture() {
    return makeCanvasTexture(512, 384, (g, W, H) => {
        g.fillStyle = '#cdc1ac';
        g.fillRect(0, 0, W, H);

        // نسيج خشن خفيف
        for (let i = 0; i < 5200; i++) {
            g.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(120,105,85,0.06)';
            g.fillRect(Math.random() * W, Math.random() * H, 2, 1);
        }

        // إطارات متداخلة
        [[16, '#a8977c'], [30, '#bcae95'], [44, '#8f8068']].forEach(([p, col]) => {
            g.strokeStyle = col;
            g.lineWidth = 6;
            g.strokeRect(p, p, W - p * 2, H - p * 2);
        });

        // معينات في الوسط
        const midY = H / 2;
        const step = 74;
        for (let x = step; x < W - 40; x += step) {
            g.beginPath();
            g.moveTo(x, midY - 34);
            g.lineTo(x + 30, midY);
            g.lineTo(x, midY + 34);
            g.lineTo(x - 30, midY);
            g.closePath();
            g.fillStyle = '#8f8068';
            g.fill();

            g.beginPath();
            g.moveTo(x, midY - 16);
            g.lineTo(x + 14, midY);
            g.lineTo(x, midY + 16);
            g.lineTo(x - 14, midY);
            g.closePath();
            g.fillStyle = '#e2d9c6';
            g.fill();
        }

        // أشرطة أفقية علوية وسفلية
        [72, H - 78].forEach((y) => {
            g.fillStyle = '#a8977c';
            g.fillRect(56, y, W - 112, 10);
            g.fillStyle = '#e2d9c6';
            for (let x = 62; x < W - 60; x += 26) g.fillRect(x, y + 2, 12, 6);
        });
    });
}

/* رخام أبيض بعروق رمادية خفيفة وحدود بلاط — يُكرَّر حسب مقاس كل غرفة */
function makeMarbleTexture() {
    return makeCanvasTexture(512, 512, (g, W, H) => {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, W, H);
        // عروق ناعمة متعرجة
        for (let v = 0; v < 7; v++) {
            g.strokeStyle = `rgba(150,150,155,${0.08 + Math.random() * 0.1})`;
            g.lineWidth = 0.6 + Math.random() * 1.6;
            g.beginPath();
            let x = Math.random() * W, y = 0;
            g.moveTo(x, y);
            while (y < H) {
                x += (Math.random() - 0.5) * 60;
                y += 20 + Math.random() * 40;
                g.lineTo(x, y);
            }
            g.stroke();
        }
        // فاصل البلاط
        g.strokeStyle = 'rgba(170,165,160,0.45)';
        g.lineWidth = 3;
        g.strokeRect(0, 0, W, H);
    });
}

/* عروق خشب طولية */
function makeWoodTexture() {
    return makeCanvasTexture(256, 256, (g, W, H) => {
        g.fillStyle = '#d8d8d8';
        g.fillRect(0, 0, W, H);
        for (let i = 0; i < 70; i++) {
            const y = Math.random() * H;
            g.strokeStyle = `rgba(${Math.random() < 0.5 ? '90,70,50' : '255,255,255'},${0.05 + Math.random() * 0.12})`;
            g.lineWidth = 0.5 + Math.random() * 2.2;
            g.beginPath();
            g.moveTo(0, y);
            for (let x = 0; x <= W; x += 32) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 3);
            g.stroke();
        }
    });
}

/* نسيج قماش ناعم (يضرب في لون المادة) */
function makeFabricTexture() {
    return makeCanvasTexture(128, 128, (g, W, H) => {
        g.fillStyle = '#eeeeee';
        g.fillRect(0, 0, W, H);
        for (let y = 0; y < H; y += 2) {
            g.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.03})`;
            g.fillRect(0, y, W, 1);
        }
        for (let x = 0; x < W; x += 2) {
            g.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.05})`;
            g.fillRect(x, 0, 1, H);
        }
        for (let i = 0; i < 900; i++) {
            g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
            g.fillRect(Math.random() * W, Math.random() * H, 1, 1);
        }
    });
}

/* وسادة بيضاء بشبكة سوداء رفيعة — مطابقة لوسائد كنب الصالة في الصورة */
function makeGridPillowTexture() {
    return makeCanvasTexture(128, 128, (g, W, H) => {
        g.fillStyle = '#f3f2ee';
        g.fillRect(0, 0, W, H);
        g.fillStyle = '#2a2b2e';
        for (let i = 4; i < W; i += 12) {
            g.fillRect(i, 0, 3, H);
            g.fillRect(0, i, W, 3);
        }
    });
}

/* سجادة رمادية بيج بمثلثات وخطوط متعرجة وأهداب — كما في صورة الصالة */
function makeGeoRugTexture() {
    return makeCanvasTexture(512, 384, (g, W, H) => {
        g.fillStyle = '#b9b2a6';
        g.fillRect(0, 0, W, H);
        const tones = ['#8f8a82', '#cfc8bb', '#a39d93', '#d9d3c7'];
        for (let i = 0; i < 9; i++) {
            g.fillStyle = tones[i % tones.length];
            const x = (i * 71) % W, y = (i * 53) % H;
            g.beginPath();
            g.moveTo(x, y);
            g.lineTo(x + 180, y + 60);
            g.lineTo(x + 40, y + 190);
            g.closePath();
            g.fill();
        }
        // خطوط متعرجة ناعمة (نسيج منسوج)
        g.strokeStyle = 'rgba(255,255,255,0.18)';
        g.lineWidth = 2;
        for (let y = 10; y < H; y += 14) {
            g.beginPath();
            for (let x = 0; x <= W; x += 14) g.lineTo(x, y + ((x / 14) % 2 ? 5 : -5));
            g.stroke();
        }
        // أهداب على الطرفين
        g.fillStyle = '#e8e2d6';
        for (let y = 4; y < H; y += 7) { g.fillRect(0, y, 14, 3); g.fillRect(W - 14, y, 14, 3); }
    });
}

/* اللوحة التجريدية فوق الكنب: رخام أبيض بأشكال زرقاء ورمادية وكحلية وعروق ذهبية */
function makeAbstractArtTexture() {
    return makeCanvasTexture(512, 420, (g, W, H) => {
        g.fillStyle = '#eef0f2';
        g.fillRect(0, 0, W, H);
        const poly = (c, pts) => {
            g.fillStyle = c;
            g.beginPath();
            pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
            g.closePath();
            g.fill();
        };
        poly('#8e97b3', [[10, 60], [150, 40], [170, 250], [20, 380]]);
        poly('#c9c4bd', [[120, 30], [300, 20], [280, 160], [140, 190]]);
        poly('#5d6a92', [[250, 90], [420, 60], [470, 240], [300, 300]]);
        poly('#aeb5c9', [[300, 20], [500, 10], [505, 120], [360, 110]]);
        poly('#1f2433', [[330, 250], [440, 210], [480, 360], [360, 380]]);
        poly('#d8d2c8', [[170, 260], [320, 230], [300, 400], [150, 410]]);
        poly('#7b86a8', [[40, 300], [160, 280], [140, 410], [30, 415]]);
        // عروق ذهبية
        g.strokeStyle = '#c9a227';
        g.lineWidth = 9;
        g.beginPath(); g.moveTo(60, 200); g.bezierCurveTo(160, 150, 260, 260, 470, 180); g.stroke();
        g.lineWidth = 5;
        g.beginPath(); g.moveTo(420, 40); g.lineTo(400, 260); g.lineTo(470, 390); g.stroke();
        // خطوط بيضاء رفيعة ونقاط رخامية
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = 1.5;
        for (let i = 0; i < 6; i++) {
            g.beginPath(); g.moveTo(Math.random() * W, 0);
            g.bezierCurveTo(Math.random() * W, H * 0.3, Math.random() * W, H * 0.7, Math.random() * W, H);
            g.stroke();
        }
        g.fillStyle = 'rgba(255,255,255,0.8)';
        for (let i = 0; i < 70; i++) { g.beginPath(); g.arc(Math.random() * W, Math.random() * H, Math.random() * 3, 0, 7); g.fill(); }
    });
}

/* قماش وسائد بمربّعات — مطابق لوسائد الصالة في الصور */
function makeCushionTexture() {
    return makeCanvasTexture(128, 128, (g, W, H) => {
        const n = 8, s = W / n;
        for (let r = 0; r < n; r++) {
            for (let col = 0; col < n; col++) {
                g.fillStyle = (r + col) % 2 ? '#f2efe6' : '#3a3a38';
                g.fillRect(col * s, r * s, s, s);
            }
        }
    });
}

/* ── شاشة يوتيوب: نسيج يُرسم على canvas ويتحدّث كأن الفيديو يعمل ───── */
function makeYouTubeScreen() {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 360;
    const g = c.getContext('2d');
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;

    const rounded = (x, y, w, h, r) => {
        g.beginPath();
        g.moveTo(x + r, y);
        g.arcTo(x + w, y, x + w, y + h, r);
        g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r);
        g.arcTo(x, y, x + w, y, r);
        g.closePath();
    };

    /* progress: من 0 إلى 1 */
    function draw(progress) {
        const W = c.width, H = c.height;

        // خلفية مشغّل يوتيوب الداكنة
        g.fillStyle = '#0f0f0f';
        g.fillRect(0, 0, W, H);

        // إطار الفيديو نفسه بتدرّج خفيف ليبدو كمشهد يعمل
        const grad = g.createLinearGradient(0, 0, W, H);
        grad.addColorStop(0, '#1f2937');
        grad.addColorStop(0.5, '#374151');
        grad.addColorStop(1, '#111827');
        g.fillStyle = grad;
        g.fillRect(0, 26, W, H - 74);

        // شعار يوتيوب: مستطيل أحمر بمثلث أبيض
        const bw = 132, bh = 92;
        const bx = (W - bw) / 2, by = (H - bh) / 2 - 6;
        g.fillStyle = '#ff0000';
        rounded(bx, by, bw, bh, 24);
        g.fill();

        g.fillStyle = '#ffffff';
        g.beginPath();
        g.moveTo(bx + bw * 0.40, by + bh * 0.28);
        g.lineTo(bx + bw * 0.40, by + bh * 0.72);
        g.lineTo(bx + bw * 0.70, by + bh * 0.50);
        g.closePath();
        g.fill();

        // شريط علوي: عنوان وهمي
        g.fillStyle = '#0f0f0f';
        g.fillRect(0, 0, W, 26);
        g.fillStyle = '#ff0000';
        rounded(12, 7, 26, 12, 4);
        g.fill();
        g.fillStyle = '#3f3f3f';
        rounded(48, 8, 150, 10, 5);
        g.fill();

        // شريط التقدّم السفلي
        const barY = H - 34;
        g.fillStyle = '#0f0f0f';
        g.fillRect(0, H - 48, W, 48);

        g.fillStyle = 'rgba(255,255,255,0.28)';
        g.fillRect(20, barY, W - 40, 5);

        const p = Math.max(0, Math.min(1, progress));
        g.fillStyle = '#ff0000';
        g.fillRect(20, barY, (W - 40) * p, 5);

        g.beginPath();
        g.arc(20 + (W - 40) * p, barY + 2.5, 8, 0, Math.PI * 2);
        g.fill();

        // أزرار تحكم مبسّطة
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.moveTo(22, H - 20);
        g.lineTo(22, H - 6);
        g.lineTo(34, H - 13);
        g.closePath();
        g.fill();

        texture.needsUpdate = true;
    }

    draw(0);
    return { texture, draw };
}

/* صندوق بأبعاد ومركز محددين */
function box(w, h, d, material, x, y, z) {
    const m = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(w, 0.01), Math.max(h, 0.01), Math.max(d, 0.01)), material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
}

/* صندوق بحواف مستديرة — يعطي الأثاث مظهراً ناعماً واقعياً بدل الزوايا الحادة.
   الهندسة تُخزَّن مؤقتاً حسب المقاس لتقليل استهلاك الذاكرة. */
const RB_CACHE = new Map();
function roundedBoxGeometry(w, h, d, r) {
    r = Math.min(r, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002);
    if (r < 0.004) return new THREE.BoxGeometry(w, h, d);
    const key = [w, h, d, r].map((n) => n.toFixed(3)).join('|');
    if (RB_CACHE.has(key)) return RB_CACHE.get(key);

    // مستطيل داخلي بزوايا مستديرة ثم بثق بشطف مستدير بنصف القطر نفسه
    const iw = w - 2 * r, ih = h - 2 * r, c = Math.min(iw, ih) * 0.2;
    const s = new THREE.Shape();
    const x0 = -iw / 2, y0 = -ih / 2;
    s.moveTo(x0 + c, y0);
    s.lineTo(x0 + iw - c, y0);
    s.quadraticCurveTo(x0 + iw, y0, x0 + iw, y0 + c);
    s.lineTo(x0 + iw, y0 + ih - c);
    s.quadraticCurveTo(x0 + iw, y0 + ih, x0 + iw - c, y0 + ih);
    s.lineTo(x0 + c, y0 + ih);
    s.quadraticCurveTo(x0, y0 + ih, x0, y0 + ih - c);
    s.lineTo(x0, y0 + c);
    s.quadraticCurveTo(x0, y0, x0 + c, y0);

    const geo = new THREE.ExtrudeGeometry(s, {
        depth: Math.max(d - 2 * r, 0.001),
        bevelEnabled: true, bevelThickness: r, bevelSize: r,
        bevelSegments: 3, curveSegments: 3,
    });
    geo.center();
    geo.computeVertexNormals();
    RB_CACHE.set(key, geo);
    return geo;
}

function rbox(w, h, d, r, material, x, y, z) {
    const m = new THREE.Mesh(roundedBoxGeometry(w, h, d, r), material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
}

function cyl(rt, rb, h, material, x, y, z, seg = 20) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
}

/* قضيب رفيع بين نقطتين — لهياكل الطاولات الهندسية الذهبية */
function rod(a, b, r, material) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, va.distanceTo(vb), 8), material);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    m.castShadow = true;
    return m;
}

/* طاولة زجاجية بهيكل ذهبي هندسي: مربع علوي ومربع سفلي مُدار 45° تربطهما دعامات مائلة */
function geoGlassTable(x, z, size, h) {
    const g = new THREE.Group();
    const t = size / 2, b = size * 0.5, r = 0.009;
    const top = [[-t, h, -t], [t, h, -t], [t, h, t], [-t, h, t]];
    const bot = [[0, 0.015, -b], [b, 0.015, 0], [0, 0.015, b], [-b, 0.015, 0]];
    for (let i = 0; i < 4; i++) {
        g.add(rod(top[i], top[(i + 1) % 4], r, MAT.gold));
        g.add(rod(bot[i], bot[(i + 1) % 4], r, MAT.gold));
        g.add(rod(top[i], bot[i], r, MAT.gold));
        g.add(rod(top[i], bot[(i + 3) % 4], r, MAT.gold));
    }
    g.add(box(size, 0.012, size, MAT.glass, 0, h + 0.008, 0));
    g.position.set(x, 0, z);
    return g;
}

/* مزهرية بيضاء وزهور زنبق بيضاء */
function lilies(x, y, z, vaseMat = MAT.ceramic, oval = false) {
    const g = new THREE.Group();
    if (oval) {
        // مزهرية بيضاوية بفتحة في وسطها كما في الصورة، فوق مفرش دائري رمادي
        g.add(cyl(0.16, 0.16, 0.006, MAT.fabric, 0, 0.003, 0, 28));
        const v = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.035, 12, 28), vaseMat);
        v.scale.set(1, 1.7, 0.8);
        v.position.y = 0.13;
        v.castShadow = true;
        g.add(v);
    } else {
        g.add(cyl(0.045, 0.06, 0.2, vaseMat, 0, 0.1, 0, 18));
    }
    const top = oval ? 0.25 : 0.2;
    for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const tip = [Math.cos(a) * 0.09, top + 0.22 + (i % 2) * 0.06, Math.sin(a) * 0.09];
        g.add(rod([0, top, 0], tip, 0.004, MAT.stem));
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.07, 6, 1, true), MAT.petal);
        f.position.set(...tip);
        f.rotation.set(Math.PI + Math.sin(a) * 0.6, 0, Math.cos(a) * 0.6);
        g.add(f);
    }
    g.position.set(x, y, z);
    return g;
}

/* نبتة زينة في أصيص — تضيف حياة واقعية للمشهد */
function plant(x, z, s = 1) {
    const g = new THREE.Group();
    g.add(cyl(0.13 * s, 0.1 * s, 0.3 * s, MAT.pot, 0, 0.15 * s, 0));
    g.add(cyl(0.12 * s, 0.12 * s, 0.02 * s, MAT.dark, 0, 0.29 * s, 0));
    const leafGeo = new THREE.SphereGeometry(0.1 * s, 10, 8);
    for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const r = (0.06 + (i % 3) * 0.04) * s;
        const l = new THREE.Mesh(leafGeo, i % 2 ? MAT.leaf : MAT.leafLight);
        l.scale.set(0.8, 1.5, 0.5);
        l.position.set(Math.cos(a) * r, (0.45 + (i % 4) * 0.09) * s, Math.sin(a) * r);
        l.rotation.set(Math.cos(a) * 0.5, a, Math.sin(a) * 0.5);
        l.castShadow = true;
        g.add(l);
    }
    g.position.set(x, 0, z);
    return g;
}

/* أريكة واقعية: قاعدة وأرجل ووسائد مقعد وظهر منفصلة ومساند مستديرة.
   تُبنى بالطول على المحور x ووجهها نحو +z ثم تُدار: rotY يحدد اتجاه الوجه. */
function sofa(len, dep, seats, x, z, rotY, fabricMat = MAT.fabric) {
    const g = new THREE.Group();
    const arm = 0.2;
    const inner = len - arm * 2;
    const cw = inner / seats;

    g.add(rbox(len, 0.16, dep, 0.03, fabricMat, 0, 0.14, 0));                        // القاعدة
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) =>
        g.add(cyl(0.022, 0.016, 0.07, MAT.dark, sx * (len / 2 - 0.08), 0.035, sz * (dep / 2 - 0.08))));
    g.add(rbox(len, 0.46, 0.16, 0.05, fabricMat, 0, 0.43, -dep / 2 + 0.08));          // هيكل الظهر
    [-1, 1].forEach((sx) =>
        g.add(rbox(arm, 0.44, dep, 0.07, fabricMat, sx * (len / 2 - arm / 2), 0.37, 0))); // المساند

    for (let i = 0; i < seats; i++) {
        const cx = -inner / 2 + cw * (i + 0.5);
        g.add(rbox(cw - 0.02, 0.15, dep - 0.2, 0.06, fabricMat, cx, 0.3, 0.07));       // وسادة المقعد
        const back = rbox(cw - 0.03, 0.4, 0.18, 0.08, fabricMat, cx, 0.56, -dep / 2 + 0.24);
        back.rotation.x = -0.14;
        g.add(back);                                                                   // وسادة الظهر
    }

    // وسادتا زينة بمربّعات عند الطرفين
    [-1, 1].forEach((sx) => {
        const p = rbox(0.38, 0.36, 0.12, 0.06, MAT.cushion, sx * (inner / 2 - 0.22), 0.55, -dep / 2 + 0.36);
        p.rotation.set(-0.3, sx * 0.25, sx * 0.08);
        g.add(p);
    });

    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    return g;
}

/* كنب الصالة كما في الصورة: رمادي بثلاثة مقاعد مخيّطة، مساند منخفضة مستديرة،
   أرجل سوداء، ووسادتان بشبكة سوداء. الوجه نحو +z قبل الإدارة. */
function sofaPhoto(len, dep, x, z, rotY) {
    const g = new THREE.Group();
    const F = MAT.sofaGrey;
    const arm = 0.16;
    const inner = len - arm * 2;
    g.add(rbox(len, 0.2, dep, 0.04, F, 0, 0.19, 0));
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) =>
        g.add(cyl(0.02, 0.015, 0.09, MAT.blackMetal, sx * (len / 2 - 0.1), 0.045, sz * (dep / 2 - 0.1))));
    for (let i = 0; i < 3; i++) {
        const cx = -inner / 2 + (inner / 3) * (i + 0.5);
        g.add(rbox(inner / 3 - 0.012, 0.13, dep - 0.26, 0.05, F, cx, 0.355, 0.07));        // المقاعد المخيّطة
        const back = rbox(inner / 3 - 0.012, 0.4, 0.17, 0.07, F, cx, 0.6, -dep / 2 + 0.13);
        back.rotation.x = -0.12;
        g.add(back);
    }
    [-1, 1].forEach((sx) => g.add(rbox(arm, 0.3, dep - 0.04, 0.075, F, sx * (len / 2 - arm / 2), 0.43, 0)));
    // وسادتان بشبكة سوداء في المنتصف، ومسند رمادي عند الطرف
    [-0.18, 0.28].forEach((px, i) => {
        const p = rbox(0.42, 0.4, 0.11, 0.07, MAT.pillowGrid, px, 0.62, -dep / 2 + 0.3);
        p.rotation.set(-0.28, i ? -0.18 : 0.12, i ? -0.1 : 0.08);
        g.add(p);
    });
    const bol = rbox(0.4, 0.2, 0.2, 0.09, F, inner / 2 - 0.22, 0.5, -dep / 2 + 0.3);
    bol.rotation.set(-0.3, -0.2, 0);
    g.add(bol);
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    return g;
}

/* كرسي مفرد رمادي بظهر مقوّس يلتف ليكون مسندين، وأرجل معدنية سوداء (كما في الصورة) */
function armchairPhoto(x, z, rotY) {
    const g = new THREE.Group();
    g.add(rbox(0.54, 0.09, 0.5, 0.04, MAT.chairGrey, 0, 0.45, 0.03));                       // المقعد
    const arc = Math.PI * 1.25;
    [0.29, 0.265].forEach((r) => {
        const shell = new THREE.Mesh(
            new THREE.CylinderGeometry(r, r, 0.24, 32, 1, true, Math.PI - arc / 2, arc), MAT.chairGrey);
        shell.position.set(0, 0.7, 0.02);
        shell.castShadow = true;
        g.add(shell);
    });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.2775, 0.0135, 8, 32, arc), MAT.chairGrey);
    rim.rotation.set(Math.PI / 2, 0, Math.PI / 2 - arc / 2 + Math.PI);   // حافة علوية تغلق سماكة الظهر
    rim.position.set(0, 0.82, 0.02);
    g.add(rim);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) =>
        g.add(rod([sx * 0.22, 0.42, sz * 0.2], [sx * 0.25, 0, sz * 0.23], 0.012, MAT.blackMetal)));
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    return g;
}

/* ── نفّاث ماء: قطرات تتساقط داخل مجموعة مخفية حتى الضغط على الحنفية ── */
function makeWaterJet(spread, height, x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.visible = false;
    g.userData.waterJet = true;
    g.userData.drops = [];

    const wide = spread > 0.1;

    // الحنفية الضيقة: عمود ماء متصل حتى قاع الحوض ليكون واضحاً
    if (!wide) {
        const stream = new THREE.Mesh(
            new THREE.CylinderGeometry(0.016, 0.013, height, 8), MAT.water);
        stream.position.y = -height / 2;
        g.add(stream);
    }

    const n = wide ? 14 : 7;
    for (let i = 0; i < n; i++) {
        const r = spread * (0.25 + Math.random() * 0.75);
        const a = Math.random() * Math.PI * 2;
        const d = new THREE.Mesh(
            new THREE.CylinderGeometry(wide ? 0.008 : 0.012, wide ? 0.006 : 0.009,
                height * (wide ? 0.22 : 0.3), 6),
            MAT.water);
        d.position.set(Math.cos(a) * r, -Math.random() * height, Math.sin(a) * r);
        d.userData.speed = 1.6 + Math.random() * 1.4;
        g.add(d);
        g.userData.drops.push(d);
    }
    g.userData.height = height;
    return g;
}

/* ── مولّدات الأثاث: كل واحدة تتكيّف مع أبعاد الغرفة ───────────── */
const FURNITURE = {
    bedroom(R) {
        const bw = Math.min(1.7, R.w * 0.45);
        const bl = Math.min(2.05, R.d * 0.62);
        const bx = R.mx;
        const bz = R.z0 + 0.25 + bl / 2;
        const head = bz - bl / 2;
        const out = [];

        // قاعدة منجّدة بأرجل قصيرة
        out.push(rbox(bw + 0.08, 0.28, bl + 0.04, 0.04, MAT.upholstery, bx, 0.2, bz + 0.02));
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) =>
            out.push(cyl(0.025, 0.02, 0.07, MAT.dark, bx + sx * (bw / 2 - 0.06), 0.035, bz + sz * (bl / 2 - 0.06))));
        // مرتبة ولحاف أبيض ومفرش برتقالي عند القدمين
        out.push(rbox(bw - 0.02, 0.2, bl - 0.06, 0.07, MAT.white, bx, 0.44, bz + 0.02));
        out.push(rbox(bw + 0.07, 0.09, bl * 0.7, 0.04, MAT.duvet, bx, 0.57, bz + bl * 0.15));
        out.push(rbox(bw + 0.09, 0.035, 0.44, 0.015, MAT.throwAccent, bx, 0.625, bz + bl / 2 - 0.32));

        // رأس سرير منجّد بألواح عمودية
        out.push(rbox(bw + 0.3, 1.1, 0.1, 0.03, MAT.upholstery, bx, 0.62, head - 0.03));
        const pw = (bw + 0.2) / 4;
        for (let i = 0; i < 4; i++) {
            out.push(rbox(pw - 0.025, 0.82, 0.06, 0.025, MAT.fabricWarm,
                bx - (bw + 0.2) / 2 + pw * (i + 0.5), 0.72, head + 0.03));
        }

        // مخدات كبيرة وصغيرة مائلة على رأس السرير
        [-1, 1].forEach((sx) => {
            const big = rbox(bw * 0.42, 0.34, 0.14, 0.07, MAT.white, bx + sx * bw * 0.23, 0.7, head + 0.14);
            big.rotation.x = -0.35;
            out.push(big);
            const small = rbox(0.34, 0.28, 0.11, 0.06, MAT.upholstery, bx + sx * bw * 0.16, 0.68, head + 0.3);
            small.rotation.set(-0.3, sx * 0.15, 0);
            out.push(small);
        });

        // كومودينو بدرج ومقبض، وأباجورة بظل مضيء دافئ
        [-1, 1].forEach((sx) => {
            const nx = bx + sx * (bw / 2 + 0.36);
            const nz = head + 0.25;
            out.push(rbox(0.46, 0.46, 0.4, 0.02, MAT.woodLight, nx, 0.25, nz));
            out.push(box(0.4, 0.006, 0.005, MAT.dark, nx, 0.33, nz + 0.2));
            out.push(box(0.1, 0.018, 0.02, MAT.gold, nx, 0.4, nz + 0.21));
            out.push(cyl(0.06, 0.075, 0.03, MAT.gold, nx, 0.495, nz));
            out.push(cyl(0.01, 0.01, 0.26, MAT.gold, nx, 0.63, nz));
            out.push(cyl(0.085, 0.125, 0.18, MAT.lampShade, nx, 0.82, nz, 28));
        });

        // سجادة منقوشة أمام السرير
        out.push(rbox(bw * 1.45, 0.02, Math.min(1.5, R.d * 0.34), 0.008, MAT.rug, bx, 0.05, bz + bl / 2 + 0.55));

        // الدولاب مقابل السرير على الجدار الجنوبي، بثلاثة أبواب ومقابض ذهبية
        if (R.w > 3.2) {
            const wl = Math.min(1.9, R.w * 0.44);
            const wx = R.x0 + R.w - wl / 2 - 0.35;
            const wz = R.z0 + R.d - 0.35;
            const front = wz - 0.29;
            out.push(rbox(wl, 1.95, 0.58, 0.02, MAT.lacquer, wx, 1.0, wz));
            for (let i = 1; i < 3; i++) out.push(box(0.006, 1.85, 0.006, MAT.dark, wx - wl / 2 + (wl / 3) * i, 1.0, front - 0.002));
            // مقبض لكل باب بجانب الفاصل الأقرب
            [wl / 3 - 0.06, wl / 3 + 0.06, (wl * 2) / 3 + 0.06].forEach((off) =>
                out.push(box(0.018, 0.34, 0.025, MAT.gold, wx - wl / 2 + off, 1.05, front - 0.015)));
            out.push(plant(R.x0 + 0.45, R.z0 + R.d - 0.45, 1.1));
        }
        return out;
    },

    living(R) {
        /* ترتيب الصالة مطابق لصورتها الفعلية:
           - التلفزيون على طاولة رمادية رخامية عند الجدار الشمالي، ومكيف فوقه.
           - طاولة زاوية ذهبية زجاجية (ساعة وزهور) ومصباح أرضي بأرفف سوداء في الركن.
           - الكنب الرمادي على الجدار الجانبي، فوقه اللوحة التجريدية، وبجانبيه طاولتان خشبيتان.
           - طاولة القهوة الزجاجية بهيكل ذهبي هندسي في المنتصف فوق سجادة رمادية.
           - كرسيان رماديان مقابل الكنب. */
        const east = (R.sofaSide || 'east') === 'east';
        const inward = east ? -1 : 1;                                    // اتجاه داخل الغرفة
        const half = (R.T || 0.25) / 2;
        const faceX = east ? R.x0 + R.w - half : R.x0 + half;            // وجه الجدار خلف الكنب
        const northZ = R.z0 + half;                                      // وجه الجدار الشمالي

        const sofaLen = Math.min(2.15, R.d * 0.72);
        const sofaDep = 0.9;
        const sofaZ = R.z0 + Math.max(sofaLen / 2 + 0.72, R.d * 0.6);
        const sofaX = faceX + inward * (sofaDep / 2 + 0.03);
        const tableX = sofaX + inward * (sofaDep / 2 + 0.78);
        const chairX = tableX + inward * 1.02;
        const tvX = R.mx + inward * 0.45;
        const consoleZ = northZ + 0.2;

        // التلفزيون: شاشة على قاعدة فوق الطاولة — قابلة للتشغيل بالضغط (تفتح يوتيوب)
        const screen = box(1.22, 0.7, 0.03, MAT.screenOff.clone(), tvX, 0.98, consoleZ + 0.02);
        screen.userData.interactive = 'tv';
        screen.userData.tvAnchor = [tvX, 0.98, consoleZ + 0.4];

        const out = [
            // طاولة التلفزيون الرمادية: درجان بنقشة وفتحة وسطى وأرجل سوداء
            rbox(1.7, 0.4, 0.4, 0.02, MAT.consoleMarble, tvX, 0.3, consoleZ),
            box(0.55, 0.16, 0.36, MAT.dark, tvX, 0.3, consoleZ + 0.03),                      // الفتحة الوسطى
            box(0.005, 0.36, 0.005, MAT.dark, tvX - 0.3, 0.3, consoleZ + 0.202),
            box(0.005, 0.36, 0.005, MAT.dark, tvX + 0.3, 0.3, consoleZ + 0.202),
            ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) =>
                cyl(0.012, 0.012, 0.1, MAT.blackMetal, tvX + sx * 0.78, 0.05, consoleZ + sz * 0.15, 8)),
            box(1.26, 0.74, 0.025, MAT.dark, tvX, 0.98, consoleZ + 0.005),                    // إطار الشاشة
            screen,
            box(0.3, 0.02, 0.14, MAT.dark, tvX, 0.51, consoleZ),                              // قاعدة الشاشة
            box(0.04, 0.12, 0.03, MAT.dark, tvX, 0.57, consoleZ),

            // المكيف على الجدار الشمالي
            rbox(0.85, 0.27, 0.2, 0.04, MAT.white, tvX - inward * 0.55, 1.58, northZ + 0.11),
            box(0.75, 0.02, 0.01, MAT.dark, tvX - inward * 0.55, 1.47, northZ + 0.21),

            // طاولة الزاوية الذهبية وعليها ساعة وزهور
            geoGlassTable(faceX + inward * 0.72, northZ + 0.3, 0.44, 0.58),
            rbox(0.14, 0.2, 0.08, 0.02, MAT.walnut, faceX + inward * 0.8, 0.7, northZ + 0.26),
            cyl(0.04, 0.04, 0.005, MAT.white, faceX + inward * 0.8, 0.72, northZ + 0.305, 20),
            lilies(faceX + inward * 0.62, 0.6, northZ + 0.32),

            // مصباح أرضي بأرفف سوداء وظل مربع مضيء في الركن
            ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) =>
                box(0.02, 1.25, 0.02, MAT.blackMetal, faceX + inward * 0.2 + sx * 0.13, 0.625, northZ + 0.2 + sz * 0.13)),
            box(0.28, 0.015, 0.28, MAT.blackMetal, faceX + inward * 0.2, 0.45, northZ + 0.2),
            box(0.28, 0.015, 0.28, MAT.blackMetal, faceX + inward * 0.2, 0.85, northZ + 0.2),
            rbox(0.14, 0.08, 0.1, 0.02, MAT.walnut, faceX + inward * 0.2, 0.9, northZ + 0.2),
            box(0.3, 0.36, 0.3, MAT.lampShade, faceX + inward * 0.2, 1.43, northZ + 0.2),

            // الكنب الرمادي ظهره للجدار
            sofaPhoto(sofaLen, sofaDep, sofaX, sofaZ, inward * Math.PI / 2),

            // اللوحة التجريدية فوق الكنب مزاحة قليلاً نحو الجنوب كما في الصورة
            box(0.025, 0.66, 0.82, MAT.artPhoto, faceX + inward * 0.013, 1.12, sofaZ + 0.3),

            // طاولة القهوة الزجاجية بهيكل ذهبي، وعليها مزهرية بيضاوية وزهور
            geoGlassTable(tableX, sofaZ, 0.86, 0.44),
            lilies(tableX, 0.46, sofaZ - 0.1, MAT.ceramic, true),

            // سجادة رمادية هندسية بأهداب
            box(2.3, 0.015, 1.9, MAT.rugGeo, tableX + inward * 0.15, 0.048, sofaZ),

            // كرسيان رماديان مقابل الكنب
            armchairPhoto(chairX, sofaZ - 0.42, -inward * Math.PI / 2),
            armchairPhoto(chairX, sofaZ + 0.42, -inward * Math.PI / 2),
        ];

        // طاولتان جانبيتان خشبيتان على شكل C عند طرفي الكنب
        [-1, 1].forEach((sz) => {
            const cx = sofaX + inward * 0.32;
            const cz = sofaZ + sz * (sofaLen / 2 + 0.02);
            out.push(
                rbox(0.3, 0.025, 0.4, 0.012, MAT.walnut, cx, 0.64, cz),
                cyl(0.013, 0.013, 0.63, MAT.blackMetal, cx - inward * 0.12, 0.32, cz, 10),
                box(0.3, 0.012, 0.3, MAT.blackMetal, cx, 0.012, cz),
            );
        });

        return out;
    },

    kitchen(R) {
        // الكف يستند إلى الجدار الشمالي أو الجنوبي حسب facing
        const north = R.facing === 'north';
        const backZ = north ? R.z0 + 0.32 : R.z0 + R.d - 0.32;     // مركز الخزائن السفلية
        const upZ = north ? R.z0 + 0.19 : R.z0 + R.d - 0.19;       // الخزائن العلوية
        const inward = north ? 1 : -1;                              // اتجاه داخل الغرفة
        const cabW = Math.max(1.2, R.w - 0.5);
        const frontZ = backZ + inward * 0.3;
        const upFront = upZ + inward * 0.17;
        const doors = Math.max(2, Math.round(cabW / 0.5));

        const out = [
            rbox(cabW, 0.85, 0.6, 0.012, MAT.white, R.mx, 0.45, backZ),                  // خزائن سفلية
            rbox(cabW + 0.04, 0.05, 0.64, 0.01, MAT.stone, R.mx, 0.9, backZ),            // سطح جرانيت
            rbox(cabW * 0.86, 0.55, 0.34, 0.012, MAT.white, R.mx, 1.5, upZ),             // خزائن علوية
        ];
        // أبواب الخزائن ومقابضها
        for (let i = 0; i < doors; i++) {
            const dx = R.mx - cabW / 2 + (cabW / doors) * (i + 0.5);
            if (i) out.push(box(0.005, 0.8, 0.005, MAT.dark, R.mx - cabW / 2 + (cabW / doors) * i, 0.45, frontZ + inward * 0.002));
            out.push(box(0.14, 0.015, 0.02, MAT.steel, dx, 0.8, frontZ + inward * 0.012));
            if (Math.abs(dx - R.mx) < cabW * 0.43) out.push(box(0.12, 0.015, 0.02, MAT.steel, dx, 1.3, upFront + inward * 0.012));
        }

        const sinkX = R.mx - cabW * 0.28;
        out.push(
            box(0.5, 0.012, 0.38, MAT.steel, sinkX, 0.93, backZ),                          // المغسلة
            cyl(0.015, 0.015, 0.3, MAT.steel, sinkX, 1.07, backZ - inward * 0.2, 12),      // الخلاط
            box(0.03, 0.03, 0.18, MAT.steel, sinkX, 1.21, backZ - inward * 0.12),
            rbox(0.46, 0.012, 0.34, 0.004, MAT.screenOff, R.mx + cabW * 0.05, 0.93, backZ),// سطح طبخ زجاجي
            rbox(0.5, 0.3, 0.36, 0.02, MAT.white, R.mx + cabW * 0.3, 1.08, backZ),         // ميكروويف
            box(0.3, 0.2, 0.005, MAT.screenOff, R.mx + cabW * 0.28, 1.08, backZ + inward * 0.181),
            rbox(0.6, 0.85, 0.58, 0.02, MAT.white, R.x0 + 0.42, 0.43, backZ),              // ثلاجة صغيرة
            box(0.02, 0.4, 0.03, MAT.steel, R.x0 + 0.65, 0.5, backZ + inward * 0.3),
            cyl(0.07, 0.08, 0.2, MAT.steel, R.x0 + 0.42, 0.98, backZ - inward * 0.06, 20), // الغلاية
            rbox(R.w * 0.5, 0.02, 0.8, 0.008, MAT.rug, R.mx, 0.05, backZ + inward * 1.05), // سجادة
        );
        [[-0.12, 0], [0.12, 0]].forEach(([dx]) =>                                          // دائرتا الطبخ
            out.push(cyl(0.08, 0.08, 0.004, MAT.dark, R.mx + cabW * 0.05 + dx, 0.938, backZ, 24)));

        return out;
    },

    bath(R) {
        // الباب في الجدار الجنوبي ناحية الشرق، لذلك:
        // الجدار الشمالي: الدش (غرباً) ثم المغسلة (شرقاً) — جنباً إلى جنب.
        // المرحاض ملاصق تماماً للجدار الغربي.
        const showerX = R.x0 + 0.56;                  // الجدار الشمالي — غرب المغسلة
        const showerZ = R.z0 + 0.48;
        const basinX = R.x0 + R.w - 0.44;             // الجدار الشمالي — شرقاً
        const basinZ = R.z0 + 0.38;
        const toiletX = R.x0 + 0.34;                  // ملاصق للجدار الغربي
        const toiletZ = R.z0 + R.d - 0.92;

        // ── المرحاض: قاعدة وحوض بيضاوي وغطاء وخزان على الجدار ──
        const bowl = cyl(0.2, 0.15, 0.36, MAT.ceramic, toiletX + 0.14, 0.2, toiletZ, 28);
        bowl.scale.set(1.35, 1, 1);
        const seat = cyl(0.21, 0.21, 0.035, MAT.ceramic, toiletX + 0.14, 0.4, toiletZ, 28);
        seat.scale.set(1.35, 1, 1);

        const out = [
            bowl, seat,
            rbox(0.18, 0.5, 0.42, 0.04, MAT.ceramic, R.x0 + 0.1, 0.55, toiletZ),       // الخزان على الجدار
            box(0.05, 0.02, 0.08, MAT.steel, R.x0 + 0.2, 0.81, toiletZ),                  // زر الطرد

            // ── الدش: مصرف أرضي وعمود ورشاش ومنشفة ──
            box(0.16, 0.012, 0.16, MAT.steel, showerX, 0.045, showerZ),
            cyl(0.02, 0.02, 1.15, MAT.steel, showerX, 0.62, R.z0 + 0.10, 12),
            rbox(0.5, 0.6, 0.02, 0.01, MAT.duvet, showerX + 0.62, 1.05, R.z0 + 0.06),    // منشفة معلّقة
        ];

        // ── المغسلة مع مرآة بإطار ── (عناصر تفاعلية تُخرج الماء)
        const basinTop = rbox(0.48, 0.1, 0.36, 0.04, MAT.ceramic, basinX, 0.85, basinZ);
        const basinStand = rbox(0.32, 0.74, 0.26, 0.03, MAT.ceramic, basinX, 0.42, basinZ);
        out.push(basinTop, basinStand,
            rbox(0.5, 0.6, 0.02, 0.01, MAT.gold, basinX, 1.36, R.z0 + 0.045),             // إطار المرآة
            box(0.44, 0.54, 0.02, mat(0xe6eef5, { metalness: 0.85, roughness: 0.05 }), basinX, 1.36, R.z0 + 0.06));

        const head = cyl(0.13, 0.13, 0.03, MAT.steel, showerX, 1.22, R.z0 + 0.30, 24);
        const mixer = rbox(0.14, 0.16, 0.09, 0.02, MAT.steel, showerX, 0.98, R.z0 + 0.11);
        const tap = cyl(0.025, 0.025, 0.18, MAT.steel, basinX, 1.00, basinZ - 0.12, 12);
        const spout = box(0.04, 0.035, 0.16, MAT.steel, basinX, 1.07, basinZ - 0.05);

        const showerJet = makeWaterJet(0.22, 1.10, showerX, 1.19, R.z0 + 0.30);
        const basinJet = makeWaterJet(0.055, 0.20, basinX, 1.05, basinZ - 0.02);

        [head, mixer].forEach((m) => {
            m.userData.interactive = 'water';
            m.userData.jet = showerJet;
            m.userData.label = '🚿 الدش';
        });
        [tap, spout, basinTop, basinStand].forEach((m) => {
            m.userData.interactive = 'water';
            m.userData.jet = basinJet;
            m.userData.label = '🚰 المغسلة';
        });

        return out.concat([head, mixer, tap, spout, showerJet, basinJet]);
    },

    hall(R) {
        const cw = Math.min(0.9, R.w * 0.25);
        return [
            // طاولة مدخل بدرج، ومرآة ومزهرية، وسجادة ونبتة
            rbox(cw, 0.06, 0.35, 0.015, MAT.woodLight, R.x0 + 0.8, 0.78, R.z0 + R.d - 0.3),
            rbox(cw - 0.04, 0.16, 0.31, 0.015, MAT.woodLight, R.x0 + 0.8, 0.66, R.z0 + R.d - 0.3),
            ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) =>
                cyl(0.015, 0.015, 0.75, MAT.gold, R.x0 + 0.8 + sx * (cw / 2 - 0.04), 0.375, R.z0 + R.d - 0.3 + sz * 0.13, 10)),
            cyl(0.05, 0.035, 0.2, MAT.ceramic, R.x0 + 0.8 + cw * 0.25, 0.91, R.z0 + R.d - 0.3, 18),
            rbox(0.5, 0.02, 0.8, 0.008, MAT.rug, R.mx, 0.05, R.z0 + R.d - 0.5),
            plant(R.x0 + 0.8 + cw / 2 + 0.3, R.z0 + R.d - 0.3, 1),
        ];
    },
};

/* ── البناء من المخطط ───────────────────────────────────────────── */
function buildApartment(scene, plan) {
    const A = plan.apartment;
    const W = A.width, D = A.depth, H = A.wallHeight;
    const T = A.wallThickness || 0.12;

    /* تحويل من نظام الملف (الركن العلوي الأيسر) إلى نظام three.js (المركز) */
    const cx = (x) => x - W / 2;
    const cz = (z) => z - D / 2;

    const wallH = H * 0.62;    // الجدران الخارجية مقطوعة لرؤية الداخل
    const frontH = H * 0.34;   // الجدار الأمامي أقصر
    const innerH = H * 0.52;   // الجدران الداخلية — منخفضة لكشف الغرف، وتتسع للوحة فوق الكنب

    const pickables = [];
    const rooms = plan.rooms || [];
    const openings = plan.openings || [];
    const windows = plan.windows || [];
    const solids = plan.solids || [];

    /* الأرضيات */
    scene.add(box(W + 0.6, 0.2, D + 0.6, MAT.slab, 0, -0.1, 0));
    rooms.forEach((r, i) => {
        // نسخة من المادة لكل غرفة حتى يُكرَّر البلاط بمقاس ثابت (~80 سم) مهما كبرت الغرفة
        const base = MAT[FLOOR_MAT[r.type] || 'floorWood'];
        const m = base.clone();
        if (base.map) {
            m.map = base.map.clone();
            m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping;
            m.map.repeat.set(Math.max(1, Math.round(r.w / 0.8)), Math.max(1, Math.round(r.d / 0.8)));
            m.map.needsUpdate = true;
        }
        // توسيع بسيط للغرف المدموجة حتى لا تظهر فجوة أرضية عند الجدار المحذوف،
        // مع إزاحة رأسية ضئيلة تمنع تداخل الأسطح المتطابقة (z-fighting)
        const pad = r.group ? 0.3 : 0;
        scene.add(box(r.w + pad, 0.04, r.d + pad, m,
            cx(r.x + r.w / 2), 0.02 + i * 0.002, cz(r.z + r.d / 2)));
    });

    /* الكتل الصماء (مجاري خدمات، خزائن مبنية) */
    solids.forEach((b) => {
        const h = b.height || wallH;
        scene.add(box(b.w, h, b.d, MAT.wall, cx(b.x + b.w / 2), h / 2, cz(b.z + b.d / 2)));
    });

    /* جمع أضلاع الغرف كقطع جدارية فريدة */
    const segs = new Map();
    const addSeg = (axis, at, from, to) => {
        const a = Math.min(from, to), b = Math.max(from, to);
        if (b - a < 0.05) return;
        const key = axis + '|' + at.toFixed(2) + '|' + a.toFixed(2) + '|' + b.toFixed(2);
        if (!segs.has(key)) segs.set(key, { axis, at, from: a, to: b });
    };

    rooms.forEach((r) => {
        addSeg('x', r.z, r.x, r.x + r.w);
        addSeg('x', r.z + r.d, r.x, r.x + r.w);
        addSeg('z', r.x, r.z, r.z + r.d);
        addSeg('z', r.x + r.w, r.z, r.z + r.d);
    });

    /* الغرف التي تحمل نفس group تُدمج: نحذف الجدار المشترك بينها */
    const merges = [];
    rooms.forEach((a) => {
        if (!a.group) return;
        rooms.forEach((b) => {
            if (b === a || b.group !== a.group) return;
            // حافة أفقية مشتركة (a أعلى b أو العكس)
            /* يُحذف الضلع المشترك فقط. سابقاً كان يُحذف الضلع المقابل أيضاً،
               فتختفي جدران خارجية (خلف التلفزيون) وجدار دورة المياه وجدار الكنب. */
            const below = Math.abs((a.z + a.d) - b.z) < 0.35;
            const above = Math.abs(a.z - (b.z + b.d)) < 0.35;
            if (below || above) {
                const lo = Math.max(a.x, b.x), hi = Math.min(a.x + a.w, b.x + b.w);
                if (hi - lo > 0.05) merges.push({ axis: 'x', at: below ? a.z + a.d : a.z, from: lo, to: hi });
            }
            // حافة رأسية مشتركة
            const right = Math.abs((a.x + a.w) - b.x) < 0.35;
            const left = Math.abs(a.x - (b.x + b.w)) < 0.35;
            if (right || left) {
                const lo = Math.max(a.z, b.z), hi = Math.min(a.z + a.d, b.z + b.d);
                if (hi - lo > 0.05) merges.push({ axis: 'z', at: right ? a.x + a.w : a.x, from: lo, to: hi });
            }
        });
    });

    /* طرح الفتحات (أبواب وممرات وحدود الدمج) من القطعة الجدارية */
    const cuts = openings.concat(merges);

    function subtract(seg) {
        let parts = [{ from: seg.from, to: seg.to }];
        cuts
            .filter((o) => o.axis === seg.axis && Math.abs(o.at - seg.at) < 0.28)
            .forEach((o) => {
                const oa = Math.min(o.from, o.to), ob = Math.max(o.from, o.to);
                const next = [];
                parts.forEach((p) => {
                    if (ob <= p.from || oa >= p.to) { next.push(p); return; }
                    if (oa > p.from) next.push({ from: p.from, to: oa });
                    if (ob < p.to) next.push({ from: ob, to: p.to });
                });
                parts = next;
            });
        return parts.filter((p) => p.to - p.from > 0.05);
    }

    /* رسم الجدران */
    const EPS = 0.06;
    segs.forEach((seg) => {
        const onOuter = seg.axis === 'x'
            ? (Math.abs(seg.at) < EPS || Math.abs(seg.at - D) < EPS)
            : (Math.abs(seg.at) < EPS || Math.abs(seg.at - W) < EPS);
        const isFront = seg.axis === 'x' && Math.abs(seg.at - D) < EPS;
        const h = isFront ? frontH : (onOuter ? wallH : innerH);
        const material = onOuter ? MAT.wall : MAT.wallIn;

        subtract(seg).forEach((p) => {
            const len = p.to - p.from;
            const mid = (p.from + p.to) / 2;
            if (seg.axis === 'x') scene.add(box(len, h, T, material, cx(mid), h / 2, cz(seg.at)));
            else scene.add(box(T, h, len, material, cx(seg.at), h / 2, cz(mid)));
        });
    });

    /* الأبواب داخل الفتحات — كل باب مجموعة تدور حول مفصلها عند الضغط */
    const doors = [];

    /* مقابض الأبواب — تُبنى في إطار محلي (u على امتداد الباب، n عمودياً عليه)
       ثم تُسقط على المحور الصحيح. smart = قفل بصمة إلكتروني، lever = مقبض عادي. */
    const HANDLE_PANEL = mat(0x23262b, { roughness: 0.35, metalness: 0.55 });
    const HANDLE_PAD = mat(0x3fa9e0, { roughness: 0.2, metalness: 0.3, emissive: 0x1d6f9c, emissiveIntensity: 0.6 });

    function addHandle(pivot, axis, lock, len, dh) {
        // put(uSize, ySize, nSize, material, u, y, n)
        const put = axis === 'x'
            ? (a, b, c, m, u, y, n) => box(a, b, c, m, u, y, n)
            : (a, b, c, m, u, y, n) => box(c, b, a, m, n, y, u);

        const u = len * 0.84;
        const y = dh * 0.55;

        if (lock === 'smart') {
            // لوحة قفل ذكي عمودية + قارئ بصمة مضيء + مقبض معدني قصير
            pivot.add(put(0.13, 0.46, 0.035, HANDLE_PANEL, u, y + 0.06, -0.048));
            pivot.add(put(0.075, 0.075, 0.015, HANDLE_PAD, u, y + 0.16, -0.068));
            pivot.add(put(0.055, 0.055, 0.012, mat(0x8f98a3, { metalness: 0.7, roughness: 0.3 }),
                u, y - 0.03, -0.068));
            pivot.add(put(0.05, 0.16, 0.05, MAT.steel, u, y - 0.16, -0.08));
            // نفس اللوحة على الوجه الآخر
            pivot.add(put(0.12, 0.34, 0.03, HANDLE_PANEL, u, y + 0.02, 0.045));
            pivot.add(put(0.05, 0.16, 0.05, MAT.steel, u, y - 0.16, 0.075));
        } else {
            // مقبض عادي: وردة دائرية + ذراع أفقي على الوجهين
            [-1, 1].forEach((s) => {
                pivot.add(put(0.09, 0.09, 0.018, MAT.gold, u, y, s * 0.042));
                pivot.add(put(0.05, 0.05, 0.055, MAT.gold, u, y, s * 0.075));
                pivot.add(put(0.15, 0.035, 0.035, MAT.gold, u - 0.05, y, s * 0.10));
            });
        }
    }

    openings.filter((o) => o.kind === 'door').forEach((o) => {
        const len = Math.abs(o.to - o.from);
        const outer = o.axis === 'x'
            ? (Math.abs(o.at) < EPS || Math.abs(o.at - D) < EPS)
            : (Math.abs(o.at) < EPS || Math.abs(o.at - W) < EPS);
        const front = o.axis === 'x' && Math.abs(o.at - D) < EPS;
        const dh = (front ? frontH : (outer ? wallH : innerH)) * 0.94;

        const pivot = new THREE.Group();
        pivot.userData.interactive = 'door';
        pivot.userData.open = false;
        pivot.userData.swing = o.swing === 'ccw' ? 1 : -1;
        pivot.userData.lock = o.lock === 'smart' ? 'smart' : 'lever';

        if (o.axis === 'x') {
            pivot.position.set(cx(Math.min(o.from, o.to)), 0, cz(o.at));
            pivot.add(box(len * 0.97, dh, 0.06, MAT.wood, len / 2, dh / 2, 0));
        } else {
            pivot.position.set(cx(o.at), 0, cz(Math.min(o.from, o.to)));
            pivot.add(box(0.06, dh, len * 0.97, MAT.wood, 0, dh / 2, len / 2));
        }
        addHandle(pivot, o.axis, pivot.userData.lock, len, dh);

        scene.add(pivot);
        doors.push(pivot);
    });

    /* النوافذ */
    windows.forEach((wn) => {
        const len = Math.abs(wn.to - wn.from);
        const mid = (wn.from + wn.to) / 2;
        const gh = wallH * 0.5;
        const gy = wallH * 0.62;
        if (wn.axis === 'z') scene.add(box(len, gh, 0.05, MAT.glass, cx(mid), gy, cz(wn.at)));
        else scene.add(box(0.05, gh, len, MAT.glass, cx(wn.at), gy, cz(mid)));
    });

    /* الأثاث لكل غرفة */
    rooms.forEach((r) => {
        const g = new THREE.Group();
        g.userData.room = r.key;
        g.userData.info = {
            name: r.name,
            icon: (ROOM_INFO[r.type] || {}).icon || '📐',
            desc: (ROOM_INFO[r.type] || {}).desc || '',
            area: (r.w * r.d).toFixed(1),
            dims: r.w + ' × ' + r.d + ' م',
        };

        const R = {
            x0: cx(r.x), z0: cz(r.z), w: r.w, d: r.d,
            mx: cx(r.x + r.w / 2), mz: cz(r.z + r.d / 2),
            facing: r.facing || 'south',
            T,                                   // سماكة الجدار: وجه الجدار الداخلي = حافة الغرفة − T/2
            sofaSide: r.sofaSide,
        };
        (FURNITURE[r.type] || (() => []))(R).forEach((m) => g.add(m));

        scene.add(g);
        pickables.push(g);
    });

    return { pickables, rooms, doors, W, D };
}

/* ── الإضاءة ─────────────────────────────────────────────────────── */

/* بيئة إضاءة ناعمة (Image-Based Lighting): غرفة افتراضية بألواح ضوء دافئة
   تُحوَّل إلى خريطة انعكاس، فتكتسب الأسطح انعكاسات وإضاءة محيطة واقعية
   دون تحميل أي صورة خارجية. */
function makeEnvironment(renderer) {
    const env = new THREE.Scene();
    const room = new THREE.Mesh(
        new THREE.BoxGeometry(24, 12, 24),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0xcfc4b6).multiplyScalar(0.55), side: THREE.BackSide }));
    room.position.y = 5;
    env.add(room);

    // ENV_K يضبط شدة البيئة كلها (بديل environmentIntensity غير المتاح في هذه النسخة)
    const ENV_K = 0.55;
    const panel = (w, h, pos, color, k) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k * ENV_K), side: THREE.DoubleSide }));
        m.position.set(...pos);
        m.lookAt(0, 2, 0);
        env.add(m);
    };
    panel(14, 14, [0, 10.9, 0], 0xfff4e6, 3.2);     // سقف مضيء
    panel(8, 5, [11.5, 5, 3], 0xffe2bf, 5.5);       // نافذة شمس دافئة
    panel(6, 4, [-11.5, 4, -4], 0xdbe8ff, 2.2);     // ضوء سماء بارد
    panel(10, 3, [0, 3, -11.5], 0xfff0dd, 1.6);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const tex = pmrem.fromScene(env, 0.04).texture;
    pmrem.dispose();
    return tex;
}

/* خلفية بتدرّج دافئ ناعم بدل اللون المسطّح */
function makeBackground() {
    return makeCanvasTexture(4, 256, (g, W, H) => {
        const grad = g.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, '#fbf3ec');
        grad.addColorStop(0.55, '#f4ede6');
        grad.addColorStop(1, '#e9e1d8');
        g.fillStyle = grad;
        g.fillRect(0, 0, W, H);
    });
}

function buildLights(scene, plan) {
    const A = plan.apartment;
    const W = A.width, D = A.depth;

    // ضوء السماء العام — خفيف لأن خريطة البيئة تتولى الإضاءة المحيطة
    scene.add(new THREE.HemisphereLight(0xeaf2ff, 0xd9c2a3, 0.35));

    // شمس ذهبية منخفضة: ظلال طويلة ناعمة تُبرز الأثاث
    const sun = new THREE.DirectionalLight(0xffe7c4, 2.4);
    sun.position.set(W * 0.6, Math.max(9, W * 0.7), D * 1.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.025;
    const s = Math.max(W, D) * 0.75;
    sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
    sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 60;
    scene.add(sun);

    // ضوء ملء بارد خفيف من الجهة المقابلة
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.35);
    fill.position.set(-W * 0.5, 6, -D * 1.2);
    scene.add(fill);

    // إنارة داخلية دافئة لكل غرفة — تحاكي الإضاءة المخفية في الصور
    (plan.rooms || []).forEach((r) => {
        const lamp = new THREE.PointLight(0xffc98a, 7, Math.max(r.w, r.d) * 1.8, 2);
        lamp.position.set(r.x + r.w / 2 - W / 2, 1.85, r.z + r.d / 2 - D / 2);
        scene.add(lamp);
    });

    // أرضية خارجية شفافة تستقبل ظل الشقة فتبدو مستقرة على الأرض
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W * 4, D * 6),
        new THREE.ShadowMaterial({ opacity: 0.16 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.199;
    ground.receiveShadow = true;
    scene.add(ground);
}

/* أيقونات خطية موحّدة للأزرار — لونها يتبع لون الزر (برتقالي، وأبيض عند الضغط) */
const svgIcon = (paths) =>
    `<svg class="ico ico-inherit" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

const CHIP_ICON = {
    bedroom: svgIcon('<path d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7"/><path d="M2 18h20M6 9V6.5A1.5 1.5 0 0 1 7.5 5h9A1.5 1.5 0 0 1 18 6.5V9"/><path d="M3 21v-3M21 21v-3"/>'),
    living: svgIcon('<path d="M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3"/><path d="M3 11h18a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z"/><path d="M5 17v2M19 17v2"/>'),
    kitchen: svgIcon('<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.6"/><circle cx="15.5" cy="8.5" r="1.6"/><path d="M6 14.5h12"/>'),
    bath: svgIcon('<path d="M6 13V6.5A3.5 3.5 0 0 1 9.5 3h1"/><path d="M3 13h10M5.5 17v.5M8 16.5v.5M10.5 17v.5M6.5 20.5v.5M9.5 20v.5"/>'),
    hall: svgIcon('<circle cx="8" cy="8" r="4.5"/><path d="M11.2 11.2 20 20M17 17l-2 2M20 14l-2 2"/>'),
    other: svgIcon('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16"/>'),
};
const ICON_PAUSE = svgIcon('<path d="M9.5 5v14M14.5 5v14"/>');
const ICON_PLAY = svgIcon('<path d="M8 5.5v13l10.5-6.5z"/>');

/* أزرار الغرف تُولَّد من الملف حتى تتطابق دائماً مع المخطط */
function buildChips(rooms) {
    const zone = document.querySelector('.apt3d-chips');
    if (!zone) return;
    const extras = Array.from(zone.querySelectorAll('.apt3d-chip.alt'));
    zone.innerHTML = '';
    rooms.forEach((r) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'apt3d-chip';
        b.dataset.room = r.key;
        b.title = r.name;
        b.setAttribute('aria-label', r.name);

        // الأيقونة وحدها هي الظاهرة؛ الاسم يبقى في عنصر مخفي لقارئات الشاشة
        b.innerHTML = CHIP_ICON[r.type] || CHIP_ICON.other;
        const label = document.createElement('span');
        label.className = 'apt3d-chip-label';
        label.textContent = r.name;
        b.appendChild(label);

        zone.appendChild(b);
    });
    extras.forEach((e) => zone.appendChild(e));
}

/* ── التشغيل ─────────────────────────────────────────────────────── */
function init(container, plan) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;   // تدرّج لوني سينمائي
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = makeBackground();
    scene.environment = makeEnvironment(renderer);

    buildLights(scene, plan);
    const { pickables, rooms, doors, W, D } = buildApartment(scene, plan);
    buildChips(rooms);

    /* الكاميرا تُؤطَّر تلقائياً على الحجم الفعلي للشقة */
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
    const radius = Math.hypot(W, D) / 2;
    const fitDist = (radius / Math.sin((camera.fov * Math.PI / 180) / 2)) * 0.62;
    // زاوية النظر الافتراضية من الجنوب الغربي — نفس زاوية صورة الصالة، فيظهر الكنب واللوحة
    const DIR = new THREE.Vector3(-0.42, 0.62, 0.66).normalize();
    // الشاشات الطولية (ملء الشاشة على الجوال): النظر على امتداد طول الشقة فتملأ الشاشة عمودياً
    const DIR_PORTRAIT = new THREE.Vector3(-0.72, 0.66, 0.2).normalize();
    const HOME = DIR.clone().multiplyScalar(fitDist);
    camera.position.copy(HOME);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = radius * 0.35;
    controls.maxDistance = fitDist * 2.4;
    controls.maxPolarAngle = Math.PI / 2.15;
    controls.target.set(0, 0.6, 0);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const infoEl = document.getElementById('apt3d-info');
    let downPos = null;
    let anim = null;

    renderer.domElement.addEventListener('pointerdown', (e) => { downPos = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener('pointerup', (e) => {
        if (!downPos) return;
        const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
        downPos = null;
        if (moved > 6) return;
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);

        // الأبواب والشاشة لها الأولوية على تحديد الغرفة
        const hits = raycaster.intersectObjects(doors.concat(pickables), true);
        if (!hits.length) return;

        let o = hits[0].object;
        while (o && !o.userData.interactive && !o.userData.room) o = o.parent;
        if (!o) return;

        if (o.userData.interactive === 'door') return toggleDoor(o);
        if (o.userData.interactive === 'tv') return toggleTv(o);
        if (o.userData.interactive === 'water') return toggleWater(o);
        if (o.userData.room) selectRoom(o.userData.room);
    });

    /* فتح/إغلاق الباب بحركة انسيابية */
    const doorAnims = [];
    function toggleDoor(pivot) {
        pivot.userData.open = !pivot.userData.open;
        const target = pivot.userData.open ? pivot.userData.swing * Math.PI * 0.52 : 0;
        doorAnims.push({ pivot, from: pivot.rotation.y, to: target, t: 0 });
        hint(pivot.userData.open ? '🚪 فُتح الباب' : '🚪 أُغلق الباب');
    }

    /* فتح/إغلاق الماء في المغسلة أو الدش */
    const jets = [];
    scene.traverse((n) => { if (n.userData && n.userData.waterJet) jets.push(n); });

    function toggleWater(target) {
        const jet = target.userData.jet;
        if (!jet) return;
        jet.visible = !jet.visible;
        hint(jet.visible
            ? (target.userData.label || '💧') + ' — الماء يجري'
            : (target.userData.label || '💧') + ' — أُغلق الماء');
    }

    function updateWater(dt) {
        jets.forEach((j) => {
            if (!j.visible) return;
            const h = j.userData.height;
            j.userData.drops.forEach((d) => {
                d.position.y -= d.userData.speed * dt;
                if (d.position.y < -h) d.position.y += h;
            });
        });
    }

    /* تشغيل/إطفاء التلفزيون — يفتح واجهة يوتيوب */
    const tvLight = new THREE.PointLight(0xdfe9ff, 0, 3.4, 2);
    scene.add(tvLight);

    const yt = makeYouTubeScreen();
    let tvOnScreen = null;      // الشاشة العاملة حالياً
    let tvProgress = 0;         // موضع شريط التقدّم
    let tvRedraw = 0;           // مؤقّت إعادة الرسم

    function toggleTv(screen) {
        const on = !screen.userData.on;
        screen.userData.on = on;
        const m = screen.material;

        if (on) {
            tvProgress = 0;
            yt.draw(0);
            m.map = yt.texture;
            m.emissiveMap = yt.texture;
            m.color.set(0xffffff);
            m.emissive.set(0xffffff);
            m.emissiveIntensity = 1.0;
            tvOnScreen = screen;
        } else {
            m.map = null;
            m.emissiveMap = null;
            m.color.set(0x0d1117);
            m.emissive.set(0x000000);
            m.emissiveIntensity = 0;
            tvOnScreen = null;
        }
        m.needsUpdate = true;

        const a = screen.userData.tvAnchor;
        if (a) tvLight.position.set(a[0], a[1], a[2]);
        tvLight.intensity = on ? 6 : 0;
        hint(on ? '📺 يوتيوب يعمل الآن' : '📺 التلفزيون مطفأ');
    }

    /* تقدّم شريط الفيديو — يُستدعى من حلقة الرسم */
    function updateTv(dt) {
        if (!tvOnScreen) return;
        tvProgress = (tvProgress + dt * 0.05) % 1;
        tvRedraw += dt;
        if (tvRedraw >= 0.25) {            // إعادة رسم 4 مرات بالثانية تكفي بصرياً
            tvRedraw = 0;
            yt.draw(tvProgress);
        }
    }

    /* رسالة قصيرة أسفل اللوحة */
    let hintTimer = null;
    function hint(text) {
        if (!infoEl) return;
        infoEl.innerHTML = `<b>${text}</b><span>اضغط مرة أخرى للعكس</span>`;
        infoEl.classList.add('visible');
        clearTimeout(hintTimer);
        hintTimer = setTimeout(() => infoEl.classList.remove('visible'), 2200);
    }

    /* تغيير شكل المؤشر فوق العناصر التفاعلية */
    renderer.domElement.addEventListener('pointermove', (e) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const h = raycaster.intersectObjects(doors.concat(pickables), true)[0];
        let o = h && h.object;
        while (o && !o.userData.interactive && !o.userData.room) o = o.parent;
        renderer.domElement.style.cursor = o ? 'pointer' : 'grab';
    });

    function selectRoom(key) {
        const g = pickables.find((p) => p.userData.room === key);
        const r = rooms.find((x) => x.key === key);
        if (!g || !r) return;

        const info = g.userData.info;
        if (infoEl) {
            infoEl.innerHTML = '<b>' + info.icon + ' ' + info.name + '</b>'
                + '<span>' + info.desc + '</span>'
                + '<span style="margin-top:6px;font-weight:700;color:var(--text-main,#0f172a)">'
                + 'المساحة ' + info.area + ' م² • ' + info.dims + '</span>';
            infoEl.classList.add('visible');
        }

        document.querySelectorAll('.apt3d-chip[data-room]').forEach((c) => {
            c.classList.toggle('active', c.dataset.room === key);
        });

        const t = new THREE.Vector3(r.x + r.w / 2 - W / 2, 0.6, r.z + r.d / 2 - D / 2);
        const dist = Math.max(4, Math.max(r.w, r.d) * 1.5);
        anim = {
            from: controls.target.clone(), to: t,
            camFrom: camera.position.clone(),
            camTo: t.clone().add(new THREE.Vector3(-dist * 0.6, dist * 0.95, dist)),
            t: 0,
        };
    }

    document.querySelectorAll('.apt3d-chip').forEach((chip) => {
        if (chip.dataset.room) chip.addEventListener('click', () => selectRoom(chip.dataset.room));
    });

    const resetBtn = document.getElementById('apt3d-reset');
    if (resetBtn) resetBtn.addEventListener('click', () => {
        document.querySelectorAll('.apt3d-chip[data-room]').forEach((c) => c.classList.remove('active'));
        resetBtn.classList.add('active');
        setTimeout(() => resetBtn.classList.remove('active'), 350);
        if (infoEl) infoEl.classList.remove('visible');
        anim = {
            from: controls.target.clone(), to: new THREE.Vector3(0, 0.6, 0),
            camFrom: camera.position.clone(), camTo: HOME.clone(), t: 0,
        };
    });

    let autoRotate = true;
    const rotBtn = document.getElementById('apt3d-rotate');
    if (rotBtn) rotBtn.addEventListener('click', () => {
        autoRotate = !autoRotate;
        const label = autoRotate ? 'إيقاف الدوران' : 'تشغيل الدوران';
        rotBtn.innerHTML = autoRotate ? ICON_PAUSE : ICON_PLAY;
        rotBtn.classList.toggle('active', !autoRotate);   // متوقف = زر مضغوط (أبيض)
        rotBtn.title = label;
        rotBtn.setAttribute('aria-label', label);
    });

    let lastPortrait = null;
    function resize() {
        const w = container.clientWidth;
        const h = container.clientHeight || Math.round(w * 0.62);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        // إن كانت اللوحة ضيقة (جوال) ابتعد قليلاً حتى تظهر الشقة كاملة،
        // وإن كانت طولية جداً (ملء الشاشة) انظر على امتداد الشقة
        const portrait = camera.aspect < 0.85;
        const need = portrait ? 1.3 : (camera.aspect < 1.5 ? Math.min(1.5 / camera.aspect, 1.8) : 1);
        const wasHome = camera.position.distanceTo(HOME) < 0.01;
        HOME.copy(portrait ? DIR_PORTRAIT : DIR).multiplyScalar(fitDist * need);
        // عند تغيّر نوع العرض (فتح ملء الشاشة أو إغلاقه) يُعاد التأطير دائماً
        if (wasHome || portrait !== lastPortrait) {
            camera.position.copy(HOME);
            controls.target.set(0, 0.6, 0);
        }
        lastPortrait = portrait;
        camera.updateProjectionMatrix();
    }
    resize();
    new ResizeObserver(resize).observe(container);

    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
        const dt = Math.min(clock.getDelta(), 0.05);
        if (anim) {
            anim.t = Math.min(anim.t + dt * 1.6, 1);
            const e = anim.t < 0.5 ? 2 * anim.t * anim.t : 1 - Math.pow(-2 * anim.t + 2, 2) / 2;
            controls.target.lerpVectors(anim.from, anim.to, e);
            camera.position.lerpVectors(anim.camFrom, anim.camTo, e);
            if (anim.t >= 1) anim = null;
        } else if (autoRotate) {
            const p = camera.position;
            const a = 0.12 * dt;
            p.set(p.x * Math.cos(a) - p.z * Math.sin(a), p.y, p.x * Math.sin(a) + p.z * Math.cos(a));
        }
        // حركة فتح/إغلاق الأبواب
        for (let i = doorAnims.length - 1; i >= 0; i--) {
            const a = doorAnims[i];
            a.t = Math.min(a.t + dt * 2.2, 1);
            const e = 1 - Math.pow(1 - a.t, 3);           // تباطؤ في النهاية
            a.pivot.rotation.y = a.from + (a.to - a.from) * e;
            if (a.t >= 1) doorAnims.splice(i, 1);
        }

        updateTv(dt);
        updateWater(dt);
        controls.update();
        renderer.render(scene, camera);
    });

    container.classList.add('ready');
}

async function loadPlan() {
    try {
        const res = await fetch('data/floorplan.json', { cache: 'no-cache' });
        if (!res.ok) throw new Error('http ' + res.status);
        const plan = await res.json();
        if (!plan.apartment || !Array.isArray(plan.rooms)) throw new Error('bad plan');
        return plan;
    } catch (e) {
        console.warn('[3D] تعذّر تحميل floorplan.json، سيُستخدم المخطط الافتراضي:', e.message);
        return FALLBACK;
    }
}

/* ── عرض المجسم بملء الشاشة كصفحة مستقلة على الجوال ────────────────
   يُفتح بزر التكبير، ويُغلق بالزر نفسه أو بزر الرجوع في المتصفح أو Esc. */
(function fullscreenView() {
    const section = document.querySelector('.apt3d-section');
    const btn = document.getElementById('apt3d-full');
    if (!section || !btn) return;

    const ICON_EXPAND = svgIcon('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>');
    const ICON_CLOSE = svgIcon('<path d="M18 6 6 18M6 6l12 12"/>');

    function setOpen(open) {
        section.classList.toggle('is-full', open);
        document.documentElement.classList.toggle('apt3d-lock', open);
        btn.classList.toggle('active', open);
        btn.innerHTML = open ? ICON_CLOSE : ICON_EXPAND;
        const label = open ? 'إغلاق ملء الشاشة' : 'عرض بملء الشاشة';
        btn.title = label;
        btn.setAttribute('aria-label', label);
    }

    btn.addEventListener('click', () => {
        if (!section.classList.contains('is-full')) {
            setOpen(true);
            history.pushState({ apt3dFull: true }, '');          // زر الرجوع يغلق العرض بدل مغادرة الصفحة
        } else if (history.state && history.state.apt3dFull) {
            history.back();
        } else {
            setOpen(false);
        }
    });

    window.addEventListener('popstate', () => {
        if (section.classList.contains('is-full')) setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && section.classList.contains('is-full')) btn.click();
    });
})();

const host = document.getElementById('apt3d-canvas');
if (host) {
    loadPlan().then((plan) => {
        try {
            init(host, plan);
        } catch (err) {
            console.error('[3D] فشل بناء المجسم:', err);
            const fb = host.querySelector('.apt3d-fallback');
            if (fb) fb.innerHTML = 'تعذّر عرض المجسم.<small>تحقق من صحة ملف data/floorplan.json</small>';
        }
    });
}
