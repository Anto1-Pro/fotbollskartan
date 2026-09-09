/* penalty-scene.js — 3D-scenen för straffsparksspelet på Fotbollskarta.
 *
 * Bygger en nattmatch under flodljus: gräsmatta med klippta ränder och målade
 * linjer, mål med nät, läktare med publik, boll, målvakt och skytt.
 * All spellogik ligger i straffliga.js — den här filen ritar och animerar bara.
 */

import * as THREE from "./vendor/three/three.module.min.js";

/* ---------- Måtten är riktiga fotbollsmått, i meter ---------- */
const GOAL_W = 7.32;
const GOAL_H = 2.44;
const POST_R = 0.06;
const NET_DEPTH = 1.9;
const SPOT_Z = 11; // straffpunkten, 11 m från mållinjen
const BALL_R = 0.11;
const PITCH = 70; // gräsplanet är 70×70 m med mållinjen i mitten

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);

/* =====================================================================
   Texturer — allt ritas i canvas så att sidan inte behöver bildfiler
   ===================================================================== */

function grassTexture() {
  const S = 2048;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d");
  const px = S / PITCH; // pixlar per meter
  const toX = (x) => (x + PITCH / 2) * px;
  const toY = (z) => (z + PITCH / 2) * px;

  g.fillStyle = "#2f6b2c";
  g.fillRect(0, 0, S, S);

  // Klippta ränder på tvären, som på en riktig arena
  const stripe = 5; // meter
  for (let z = -PITCH / 2; z < PITCH / 2; z += stripe * 2) {
    g.fillStyle = "#356f30";
    g.fillRect(0, toY(z), S, stripe * px);
  }

  // Slitage och variation
  for (let i = 0; i < 26000; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const a = Math.random() * 0.05;
    g.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    g.fillRect(x, y, 3 + Math.random() * 6, 2 + Math.random() * 4);
  }
  // Nedtrampat område kring straffpunkten
  const wear = g.createRadialGradient(toX(0), toY(SPOT_Z), 0, toX(0), toY(SPOT_Z), 2.2 * px);
  wear.addColorStop(0, "rgba(120,105,70,0.30)");
  wear.addColorStop(1, "rgba(120,105,70,0)");
  g.fillStyle = wear;
  g.fillRect(toX(-4), toY(SPOT_Z - 4), 8 * px, 8 * px);

  // Målade linjer (12 cm breda)
  g.strokeStyle = "rgba(255,255,255,0.92)";
  g.lineWidth = Math.max(4, 0.12 * px);
  g.lineCap = "butt";

  const line = (x1, z1, x2, z2) => {
    g.beginPath();
    g.moveTo(toX(x1), toY(z1));
    g.lineTo(toX(x2), toY(z2));
    g.stroke();
  };

  line(-34, 0, 34, 0); // mållinje
  // Straffområde: 16,5 m djupt, 40,32 m brett
  line(-20.16, 0, -20.16, 16.5);
  line(20.16, 0, 20.16, 16.5);
  line(-20.16, 16.5, 20.16, 16.5);
  // Målområde: 5,5 m djupt, 18,32 m brett
  line(-9.16, 0, -9.16, 5.5);
  line(9.16, 0, 9.16, 5.5);
  line(-9.16, 5.5, 9.16, 5.5);
  // Sidlinjer
  line(-34, 0, -34, 35);
  line(34, 0, 34, 35);

  // Straffområdesbågen — bara den del som ligger utanför straffområdet
  g.save();
  g.beginPath();
  g.rect(toX(-34), toY(16.5), 68 * px, 20 * px);
  g.clip();
  g.beginPath();
  g.arc(toX(0), toY(SPOT_Z), 9.15 * px, 0, Math.PI * 2);
  g.stroke();
  g.restore();

  // Straffpunkten
  g.fillStyle = "rgba(255,255,255,0.95)";
  g.beginPath();
  g.arc(toX(0), toY(SPOT_Z), 0.12 * px, 0, Math.PI * 2);
  g.fill();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function crowdTexture() {
  const W = 1024;
  const H = 256;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d");
  g.fillStyle = "#131a1d";
  g.fillRect(0, 0, W, H);

  // Sittande publik: rader av små färgklickar som ljusnar uppåt
  // Dämpade toner — på håll läser en publik som ett stillsamt myller,
  // inte som konfetti.
  const palette = [
    "#9aa0a4", "#8d4c44", "#3f5470", "#9c8a4e", "#4a6b4f",
    "#5f4a68", "#8f6a44", "#232c33", "#7d838a", "#5a4436",
    "#b0b4b8", "#6a6f75",
  ];
  const rows = 30;
  for (let r = 0; r < rows; r++) {
    const y = H - 10 - (r * (H - 20)) / rows;
    const jitter = 1 + r * 0.04;
    for (let c = 0; c < 170; c++) {
      if (Math.random() < 0.08) continue; // tomma platser
      const x = (c + (r % 2) * 0.5) * (W / 170) + (Math.random() - 0.5) * 2.5;
      g.fillStyle = palette[(Math.random() * palette.length) | 0];
      g.globalAlpha = 0.5 + Math.random() * 0.4;
      g.beginPath();
      g.ellipse(x, y, 1.7 * jitter, 2.4 * jitter, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  // Skugga nedåt så de nedre raderna hamnar i mörker
  const shade = g.createLinearGradient(0, H, 0, 0);
  shade.addColorStop(0, "rgba(0,0,0,0.62)");
  shade.addColorStop(0.6, "rgba(0,0,0,0.24)");
  shade.addColorStop(1, "rgba(0,0,0,0.12)");
  g.fillStyle = shade;
  g.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function ballTexture() {
  const S = 512;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d");
  g.fillStyle = "#f5f6f4";
  g.fillRect(0, 0, S, S);

  const poly = (cx, cy, r, n, rot, fill) => {
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.strokeStyle = "rgba(30,30,30,0.35)";
    g.lineWidth = 3;
    g.stroke();
  };

  // Approximation av klassiskt svartvitt mönster
  const r = S * 0.085;
  const rows = [
    { y: S * 0.17, n: 5, off: 0 },
    { y: S * 0.4, n: 5, off: 0.5 },
    { y: S * 0.62, n: 5, off: 0 },
    { y: S * 0.85, n: 5, off: 0.5 },
  ];
  rows.forEach((row) => {
    for (let i = 0; i < row.n; i++) {
      const cx = ((i + row.off) / row.n) * S;
      poly(cx, row.y, r, 5, -Math.PI / 2, "#22262b");
      poly(cx + S / row.n / 2, row.y, r * 0.55, 6, 0, "rgba(200,205,200,0.35)");
    }
  });
  // Sömmar
  g.strokeStyle = "rgba(120,125,120,0.35)";
  g.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    g.beginPath();
    g.moveTo(0, (i / 8) * S);
    g.lineTo(S, (i / 8) * S);
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function skyTexture() {
  const cv = document.createElement("canvas");
  cv.width = 32;
  cv.height = 512;
  const g = cv.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, "#050b16");
  grad.addColorStop(0.55, "#0d1c31");
  grad.addColorStop(0.85, "#1b3550");
  grad.addColorStop(1, "#2b4a63");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 512);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* =====================================================================
   Spelarfigurer
   ---------------------------------------------------------------------
   Kropparna byggs av svepta ellipsprofiler ("loft") i stället för lådor
   och kapslar, så att axlar, armar och ben får mjuka övergångar och
   människoliknande proportioner. Varje kroppsdel sitter i en egen grupp
   så att den kan animeras: höft → rygg → bröst → nacke/axlar, och
   höft → knä → fotled i benen.
   ===================================================================== */

const HIP_Y = 0.93; // höfthöjd över gräset, för en spelare på ca 1,80 m

/** Sveper en ellipsprofil längs y-axeln till en sluten, mjuk kropp. */
function loft(rows, seg) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      pos.push(Math.cos(a) * r.rx, r.y, Math.sin(a) * r.rz);
      uv.push(j / seg, i / (rows.length - 1));
    }
  }
  for (let i = 0; i < rows.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j;
      const b = a + 1;
      const c = a + seg + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Rundar av båda ändarna av en lem som en kapsel. */
function capFactor(t, k) {
  if (t < k) {
    const u = (k - t) / k;
    return Math.sqrt(Math.max(0, 1 - u * u));
  }
  if (t > 1 - k) {
    const u = (t - (1 - k)) / k;
    return Math.sqrt(Math.max(0, 1 - u * u));
  }
  return 1;
}

/**
 * Avsmalnande lem som hänger nedåt från origo (arm eller ben).
 * rTop/rMid/rBot är radier vid fäste, mitt och ände.
 */
function limbGeometry(len, rTop, rMid, rBot, flat, capK) {
  const rows = [];
  const N = 14;
  const k = capK == null ? 0.13 : capK;
  // Raderna läggs i växande y (nedifrån och upp) — samma ordning som bålens
  // profil — annars vänds trianglarna inåt och lemmen blir mörk.
  for (let i = N; i >= 0; i--) {
    const t = i / N;
    const base = t < 0.5 ? rTop + (rMid - rTop) * (t / 0.5) : rMid + (rBot - rMid) * ((t - 0.5) / 0.5);
    const r = base * capFactor(t, k);
    rows.push({ y: -t * len, rx: r, rz: r * (flat || 0.9) });
  }
  return loft(rows, 14);
}

/**
 * Fotbollsskon. Profilen sveps längs y och roteras sedan så att den pekar
 * framåt i z — häl bakåt, avsmalnande tå framåt.
 */
function shoeGeometry(len) {
  const rows = [];
  const prof = [
    [0.0, 0.038, 0.04],
    [0.1, 0.048, 0.047],
    [0.28, 0.052, 0.044],
    [0.5, 0.051, 0.038],
    [0.72, 0.045, 0.03],
    [0.88, 0.035, 0.022],
    [1.0, 0.011, 0.009],
  ];
  prof.forEach(([t, rx, rz]) => rows.push({ y: t * len, rx: rx, rz: rz }));
  const g = loft(rows, 16);
  g.rotateX(Math.PI / 2); // sveparriktningen blir framåt (+z)
  return g;
}

/** Skotextur: mörk sula runt undersidan plus ett par ljusa detaljer. */
function shoeTexture(primary) {
  const W = 256;
  const H = 128;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d");
  const hex = (c) => "#" + c.toString(16).padStart(6, "0");
  g.fillStyle = hex(primary);
  g.fillRect(0, 0, W, H);
  // u ≈ 0,25 hamnar på skons undersida efter rotationen
  g.fillStyle = "#111417";
  g.fillRect(W * 0.13, 0, W * 0.24, H);
  // Ljus rand längs sidan
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.fillRect(W * 0.62, H * 0.3, W * 0.05, H * 0.45);
  g.fillRect(W * 0.7, H * 0.34, W * 0.035, H * 0.38);
  g.fillRect(W * 0.86, H * 0.3, W * 0.05, H * 0.45);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Bålen, från höft upp till nacken. */
function torsoGeometry() {
  return loft(
    [
      { y: -0.03, rx: 0.10, rz: 0.075 },
      { y: 0.02, rx: 0.148, rz: 0.108 },
      { y: 0.12, rx: 0.152, rz: 0.110 },
      { y: 0.22, rx: 0.136, rz: 0.100 },
      { y: 0.32, rx: 0.152, rz: 0.113 },
      { y: 0.42, rx: 0.19, rz: 0.126 },
      { y: 0.50, rx: 0.186, rz: 0.12 },
      { y: 0.545, rx: 0.115, rz: 0.088 },
      { y: 0.565, rx: 0.055, rz: 0.048 },
    ],
    18
  );
}

/* ---------- Matchställ, ritat i canvas ---------- */

const KIT_PATTERNS = ["solid", "stripes", "band", "halves"];

/* ---------------------------------------------------------------------
   Tyg- och hudtexturer
   ---------------------------------------------------------------------
   Alla kroppsdelar sveps med UV där u går runt delen och v längs den.
   För bålen ligger v = 1 vid nacken, för lemmarna vid infästningen. Det
   utnyttjas för att baka in kontaktskuggning vid lederna: en mörkare kant
   där en kroppsdel möter en annan gör att figuren slutar se ut som
   hopsatta rör, utan att kosta något att rendera.
   --------------------------------------------------------------------- */

const hexOf = (c) => "#" + c.toString(16).padStart(6, "0");

/** Fint brus, så tyget inte blir spegelblankt. */
function weave(g, W, H, alpha) {
  g.save();
  for (let i = 0; i < W * H * 0.05; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    g.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255," + alpha + ")" : "rgba(0,0,0," + alpha + ")";
    g.fillRect(x, y, 1.4, 1.4);
  }
  g.restore();
}

/** Mjuka veck längs tyget, som hos ett plagg som hänger på en kropp. */
function folds(g, W, H, count, strength) {
  g.save();
  for (let i = 0; i < count; i++) {
    const x = ((i + 0.5) / count) * W + (Math.random() - 0.5) * (W / count) * 0.4;
    const w = (W / count) * (0.35 + Math.random() * 0.4);
    const grad = g.createLinearGradient(x - w, 0, x + w, 0);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.4, "rgba(0,0,0," + strength + ")");
    grad.addColorStop(0.55, "rgba(255,255,255," + strength * 0.5 + ")");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(x - w, 0, w * 2, H);
  }
  g.restore();
}

/** Mörkare mot den ena eller båda ändarna — kontaktskugga vid leden. */
function endShade(g, W, H, topAmount, bottomAmount) {
  // Breda, mjuka övergångar — en smal gradient läser som en hård ring
  if (topAmount > 0) {
    const t = g.createLinearGradient(0, 0, 0, H * 0.36);
    t.addColorStop(0, "rgba(0,0,0," + topAmount + ")");
    t.addColorStop(0.45, "rgba(0,0,0," + topAmount * 0.35 + ")");
    t.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = t;
    g.fillRect(0, 0, W, H * 0.36);
  }
  if (bottomAmount > 0) {
    const b = g.createLinearGradient(0, H, 0, H * 0.64);
    b.addColorStop(0, "rgba(0,0,0," + bottomAmount + ")");
    b.addColorStop(0.45, "rgba(0,0,0," + bottomAmount * 0.35 + ")");
    b.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = b;
    g.fillRect(0, H * 0.64, W, H * 0.36);
  }
}

/** Formskugga i sidorna: u = 0 och u = 0,5 ligger på kroppens sidor. */
function sideShade(g, W, H, amount) {
  const shade = g.createLinearGradient(0, 0, W, 0);
  shade.addColorStop(0, "rgba(0,0,0," + amount + ")");
  shade.addColorStop(0.25, "rgba(255,255,255,0.05)");
  shade.addColorStop(0.5, "rgba(0,0,0," + amount + ")");
  shade.addColorStop(0.75, "rgba(255,255,255,0.04)");
  shade.addColorStop(1, "rgba(0,0,0," + amount + ")");
  g.fillStyle = shade;
  g.fillRect(0, 0, W, H);
}

function makeTexture(cv) {
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Tröjtextur. u = 0,25 är framsidan, u = 0,75 ryggen där numret sitter,
 * u = 0 och 0,5 kroppens sidor. v = 1 (canvas y = 0) är vid nacken.
 */
function kitTexture(primary, secondary, number, seed, patternName) {
  const W = 512;
  const H = 256;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d");
  const pattern = patternName || KIT_PATTERNS[seed % KIT_PATTERNS.length];

  g.fillStyle = hexOf(primary);
  g.fillRect(0, 0, W, H);

  if (pattern === "stripes") {
    g.fillStyle = hexOf(secondary);
    for (let i = 0; i < 10; i++) g.fillRect((i * W) / 10, 0, W / 20, H);
  } else if (pattern === "band") {
    g.fillStyle = hexOf(secondary);
    g.fillRect(0, H * 0.42, W, H * 0.2);
  } else if (pattern === "halves") {
    g.fillStyle = hexOf(secondary);
    g.fillRect(W * 0.5, 0, W * 0.5, H);
  }

  // Krage: färgad kant med en mörkare linje under
  g.fillStyle = hexOf(secondary);
  g.fillRect(0, 0, W, 15);
  g.fillStyle = "rgba(0,0,0,0.18)";
  g.fillRect(0, 15, W, 2);

  // Ryggnummer
  g.save();
  g.font = "bold 148px Impact, 'Arial Black', -apple-system, Helvetica, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 13;
  g.strokeStyle = "rgba(0,0,0,0.62)";
  g.strokeText(String(number), W * 0.75, H * 0.44);
  g.fillStyle = "#ffffff";
  g.fillText(String(number), W * 0.75, H * 0.44);
  g.restore();

  folds(g, W, H, 8, 0.075);
  weave(g, W, H, 0.045);
  sideShade(g, W, H, 0.2);
  // Nederkanten stoppas in i shortsen och ligger i skugga
  endShade(g, W, H, 0, 0.16);

  return makeTexture(cv);
}

/** Hårtextur: strån och lite variation, så hjässan inte blir en jämn klump. */
function hairTexture(tone) {
  const W = 128;
  const H = 128;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d");
  g.fillStyle = hexOf(tone);
  g.fillRect(0, 0, W, H);
  g.lineWidth = 1.2;
  for (let i = 0; i < 460; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const l = 5 + Math.random() * 12;
    g.strokeStyle = Math.random() > 0.45 ? "rgba(0,0,0,0.16)" : "rgba(255,255,255,0.11)";
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (Math.random() - 0.5) * 4, y + l);
    g.stroke();
  }
  // Mörkare i nacken, ljusare på hjässan
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "rgba(255,255,255,0.1)");
  grad.addColorStop(1, "rgba(0,0,0,0.3)");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  return makeTexture(cv);
}

/** Ärmtextur: tröjfärgen med en mjuk kant där ärmen slutar. */
function sleeveTexture(primary, secondary, striped) {
  const W = 96;
  const H = 128;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d");
  g.fillStyle = hexOf(primary);
  g.fillRect(0, 0, W, H);
  if (striped) {
    g.fillStyle = hexOf(secondary);
    for (let i = 0; i < 10; i++) g.fillRect((i * W) / 10, 0, W / 20, H);
  }
  folds(g, W, H, 4, 0.06);
  weave(g, W, H, 0.045);
  sideShade(g, W, H, 0.18);
  endShade(g, W, H, 0.12, 0.05);
  return makeTexture(cv);
}

/** Shortstextur: linning upptill, fåll nedtill och en rand i sidan. */
function shortsTexture(primary, secondary) {
  const W = 256;
  const H = 128;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d");

  g.fillStyle = hexOf(primary);
  g.fillRect(0, 0, W, H);

  // Rand längs kroppens sidor
  g.fillStyle = hexOf(secondary);
  g.globalAlpha = 0.9;
  [0, W * 0.5].forEach((x) => {
    g.fillRect(x - 3.5, 0, 7, H);
    if (x === 0) g.fillRect(W - 3.5, 0, 3.5, H);
  });
  g.globalAlpha = 1;

  // Linning
  g.fillStyle = hexOf(secondary);
  g.fillRect(0, 0, W, 8);
  g.fillStyle = "rgba(0,0,0,0.16)";
  g.fillRect(0, 8, W, 2);
  // Fåll
  g.fillStyle = "rgba(0,0,0,0.12)";
  g.fillRect(0, H - 5, W, 2);

  folds(g, W, H, 6, 0.07);
  weave(g, W, H, 0.045);
  sideShade(g, W, H, 0.13);
  endShade(g, W, H, 0.14, 0.08);

  return makeTexture(cv);
}

/** Strumptextur: rand upptill, ribbning och mörkare in mot skon. */
function sockTexture(primary, secondary) {
  const W = 64;
  const H = 128;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d");

  g.fillStyle = hexOf(primary);
  g.fillRect(0, 0, W, H);
  g.fillStyle = hexOf(secondary);
  g.fillRect(0, 10, W, 9);
  g.fillRect(0, 23, W, 4);

  // Ribbning: fina lodräta linjer
  g.strokeStyle = "rgba(0,0,0,0.13)";
  g.lineWidth = 1;
  for (let x = 2; x < W; x += 4) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H);
    g.stroke();
  }

  weave(g, W, H, 0.045);
  sideShade(g, W, H, 0.16);
  endShade(g, W, H, 0.15, 0.13);

  return makeTexture(cv);
}

/**
 * Hudtextur för lemmarna: mörkare vid båda ändarna, så varje arm och ben
 * får en kontaktskugga in mot leden.
 */
function skinLimbTexture(tone) {
  const W = 64;
  const H = 128;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d");
  g.fillStyle = hexOf(tone);
  g.fillRect(0, 0, W, H);
  weave(g, W, H, 0.03);
  sideShade(g, W, H, 0.17);
  endShade(g, W, H, 0.17, 0.1);
  return makeTexture(cv);
}

// Spelet utgår från de svenska klubbarna, så utseendet är nordiskt viktat:
// mest ljusa hudtoner och blont till ljusbrunt hår. Listorna innehåller
// upprepningar för att styra fördelningen, och behåller några mörkare toner
// eftersom svenska klubblag ser ut så i verkligheten.
const SKIN_TONES = [
  0xf3dcc6, 0xefd4ba, 0xe9cbae, 0xf3dcc6, 0xe3c0a2,
  0xefd4ba, 0xe9cbae, 0xd9ab84, 0xf3dcc6, 0xc08a5c,
  0xefd4ba, 0x8d5a36,
];
// Något dämpade nyanser — riktigt ljust blont smälter ihop med hudtonen
const HAIR_TONES = [
  0xc39a45, 0xa8813a, 0x8a6535, 0xc39a45, 0x6f5033,
  0xa8813a, 0x8a6535, 0xb1552c, 0xc39a45, 0x3c2c1e,
];
const BOOT_TONES = [0xf2f2f2, 0x14181b, 0xe8402c, 0x2f7de0, 0xd8e021, 0xff7a00];

/**
 * Bygger en spelare.
 * colors: { shirt, shorts, socks, gloves }
 * opts:   { keeper, number, seed }
 */
function buildPlayer(colors, opts) {
  const o = opts || {};
  const keeper = !!o.keeper;
  const seed = o.seed || 1;
  const number = o.number || (keeper ? 1 : 9);

  const root = new THREE.Group();

  const mat = (extra) =>
    new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.66, metalness: 0.02 }, extra));

  const second = colors.second == null ? colors.shorts : colors.second;
  const skinTone = SKIN_TONES[seed % SKIN_TONES.length];
  // Sfärer (huvud, näsa, leder) tar den släta huden, lemmarna den med
  // inbakad kontaktskugga vid ändarna
  const skinMat = mat({ color: skinTone, roughness: 0.74 });
  const limbMat = mat({ map: skinLimbTexture(skinTone), roughness: 0.74 });
  const hairMat = mat({ map: hairTexture(HAIR_TONES[(seed >> 3) % HAIR_TONES.length]), roughness: 0.92 });
  const shirtMat = mat({
    map: kitTexture(colors.shirt, second, number, seed, colors.pattern),
    roughness: 0.72,
  });
  const sleeveMat = mat({
    map: sleeveTexture(colors.shirt, second, colors.pattern === "stripes"),
    roughness: 0.72,
  });
  const cuffMat = mat({ color: second, roughness: 0.72 });
  const shortsMat = mat({ map: shortsTexture(colors.shorts, second), roughness: 0.72 });
  const sockMat = mat({ map: sockTexture(colors.socks, second), roughness: 0.78 });
  const bootMat = mat({
    map: shoeTexture(BOOT_TONES[(seed >> 5) % BOOT_TONES.length]),
    roughness: 0.34,
    metalness: 0.14,
  });
  const gloveMat = mat({ color: colors.gloves || 0xf4f4f4, roughness: 0.55 });
  const eyeMat = mat({ color: 0x1b1512, roughness: 0.3 });
  const scleraMat = mat({ color: 0xf0ece4, roughness: 0.35 });

  const add = (parent, geo, material, x, y, z) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  /* --- Höft och bål --- */
  const hips = new THREE.Group();
  hips.position.y = HIP_Y;
  root.add(hips);

  const spine = new THREE.Group(); // böjer hela överkroppen
  hips.add(spine);
  add(spine, torsoGeometry(), shirtMat, 0, 0, 0);

  // Shorts sitter över höften och över bålens nedre del. Profilen byggs i
  // växande y, annars vänds ytan inåt och plagget blir mörkt.
  add(
    spine,
    loft(
      [
        { y: -0.085, rx: 0.152, rz: 0.112 },
        { y: -0.04, rx: 0.168, rz: 0.124 },
        { y: 0.02, rx: 0.172, rz: 0.126 },
        { y: 0.09, rx: 0.166, rz: 0.121 },
        { y: 0.16, rx: 0.149, rz: 0.11 },
      ],
      16
    ),
    shortsMat,
    0,
    0,
    0
  );

  const chest = new THREE.Group(); // fäste för nacke och axlar
  chest.position.y = 0.5;
  spine.add(chest);

  /* --- Nacke och huvud --- */
  const traps = add(chest, new THREE.SphereGeometry(0.1, 16, 12), shirtMat, 0, 0.03, 0);
  traps.scale.set(1.5, 0.55, 0.85);
  add(chest, limbGeometry(0.12, 0.058, 0.057, 0.056, 0.9, 0.05), limbMat, 0, 0.12, 0);

  const head = new THREE.Group();
  head.position.y = 0.152;
  chest.add(head);

  const skull = add(head, new THREE.SphereGeometry(0.1, 22, 18), skinMat, 0, 0.075, 0.005);
  skull.scale.set(0.9, 1.1, 1.0);
  // Käke, så huvudet inte blir en kula
  const jaw = add(head, new THREE.SphereGeometry(0.078, 18, 14), skinMat, 0, 0.03, 0.016);
  jaw.scale.set(0.92, 0.85, 1.02);

  // Frisyr — tre varianter
  const style = (seed >> 7) % 3;
  if (style === 0) {
    const h = add(
      head,
      new THREE.SphereGeometry(0.104, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.52),
      hairMat,
      0,
      0.082,
      0.002
    );
    h.scale.set(0.93, 1.12, 1.02);
  } else if (style === 1) {
    const h = add(
      head,
      new THREE.SphereGeometry(0.108, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.66),
      hairMat,
      0,
      0.078,
      -0.008
    );
    h.scale.set(0.95, 1.05, 1.06);
  } else {
    const h = add(head, new THREE.SphereGeometry(0.112, 18, 14), hairMat, 0, 0.088, -0.012);
    h.scale.set(0.9, 0.78, 0.95);
  }

  // Pannben och kindben, så ansiktet får relief
  const brow = add(head, new THREE.SphereGeometry(0.05, 14, 10), skinMat, 0, 0.083, 0.05);
  brow.scale.set(1.55, 0.42, 0.72);
  [-1, 1].forEach((sd) => {
    const cheek = add(head, new THREE.SphereGeometry(0.026, 12, 10), skinMat, sd * 0.05, 0.036, 0.055);
    cheek.scale.set(1, 0.75, 0.7);
  });

  // Näsa
  const nose = add(head, new THREE.SphereGeometry(0.016, 12, 10), skinMat, 0, 0.05, 0.094);
  nose.scale.set(0.8, 1.3, 1.55);

  // Ett par testar bryter av den släta hjässan
  const clumps = 3 + (seed % 3);
  for (let i = 0; i < clumps; i++) {
    const a = (i / clumps) * Math.PI * 2 + (seed % 7) * 0.3;
    const r = 0.042 + ((seed >> (i + 1)) % 4) * 0.005;
    const cl = add(
      head,
      new THREE.SphereGeometry(r, 10, 8),
      hairMat,
      Math.cos(a) * 0.048,
      0.108 + Math.sin(i * 1.7) * 0.008,
      Math.sin(a) * 0.04 - 0.014
    );
    cl.scale.set(1, 0.52, 1);
    cl.rotation.z = Math.cos(a) * 0.3;
  }

  // Nacken: håret måste täcka bakhuvudet också, annars ser man en kal fläck
  // rakt bakifrån — och målvakten ses just bakifrån i spelet.
  const nape = add(head, new THREE.SphereGeometry(0.101, 18, 14), hairMat, 0, 0.055, -0.03);
  nape.scale.set(0.97, 1.0, 0.72);

  // Tinningarna, så hårfästet inte blir en rak linje över pannan
  [-1, 1].forEach((sd) => {
    const temple = add(head, new THREE.SphereGeometry(0.034, 10, 8), hairMat, sd * 0.073, 0.072, 0.022);
    temple.scale.set(0.65, 1.25, 0.85);
  });

  // Öron, ögon och bryn
  [-1, 1].forEach((s) => {
    const ear = add(head, new THREE.SphereGeometry(0.022, 10, 8), skinMat, s * 0.086, 0.052, -0.006);
    ear.scale.set(0.5, 1.05, 0.85);

    const sclera = add(head, new THREE.SphereGeometry(0.016, 10, 8), scleraMat, s * 0.037, 0.064, 0.079);
    sclera.scale.set(1.05, 0.7, 0.5);
    const pupil = add(head, new THREE.SphereGeometry(0.008, 8, 6), eyeMat, s * 0.038, 0.063, 0.088);
    pupil.scale.set(1, 1, 0.5);

    const brow = add(head, new THREE.BoxGeometry(0.032, 0.008, 0.012), hairMat, s * 0.037, 0.083, 0.086);
    brow.rotation.z = -s * 0.12;
  });

  /* --- Armar --- */
  const arms = {};
  [["left", -1], ["right", 1]].forEach(([side, s]) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.166, -0.005, 0);
    chest.add(shoulder);

    // Axelkappa i tröjfärg täcker leden
    const capMesh = add(shoulder, new THREE.SphereGeometry(0.062, 16, 12), sleeveMat, 0, 0.014, 0);
    capMesh.scale.set(1.05, 1.2, 0.98);

    // Överarm: ärm ner till halva, sedan hud (målvakten har lång ärm)
    const sleeveLen = keeper ? 0.31 : 0.17;
    add(shoulder, limbGeometry(sleeveLen, 0.07, 0.066, 0.062, 0.9, 0.05), sleeveMat, 0, 0, 0);
    // Målvakten har manschett i andrafärgen längst ut på den långa ärmen
    if (keeper) add(shoulder, limbGeometry(0.04, 0.066, 0.066, 0.064, 0.9, 0.02), cuffMat, 0, -sleeveLen + 0.035, 0);
    if (!keeper) add(shoulder, limbGeometry(0.3, 0.058, 0.055, 0.05), limbMat, 0, -0.14, 0);

    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    shoulder.add(elbow);
    const elbowCap = add(elbow, new THREE.SphereGeometry(0.052, 12, 10), skinMat, 0, 0.004, 0);
    elbowCap.scale.set(1, 0.95, 1);
    add(elbow, limbGeometry(0.27, 0.053, 0.047, 0.038), limbMat, 0, 0, 0);

    const wrist = new THREE.Group();
    wrist.position.y = -0.27;
    elbow.add(wrist);
    if (keeper) {
      // Handske: manschett plus en rundad, vantliknande hand
      add(wrist, limbGeometry(0.055, 0.05, 0.052, 0.052, 0.85, 0.04), gloveMat, 0, 0.012, 0);
      const glove = add(wrist, limbGeometry(0.155, 0.052, 0.07, 0.052, 0.6), gloveMat, 0, -0.035, 0.004);
      glove.scale.set(1.2, 1, 1);
      const fingers = add(wrist, new THREE.SphereGeometry(0.048, 14, 10), gloveMat, 0, -0.175, 0.004);
      fingers.scale.set(1.35, 0.85, 0.62);
    } else {
      const palm = add(wrist, limbGeometry(0.145, 0.043, 0.05, 0.027, 0.55), limbMat, 0, 0, 0);
      palm.scale.set(1.15, 1, 1);
      // Tumme, så handen får en igenkännbar silhuett
      const thumb = add(wrist, limbGeometry(0.06, 0.021, 0.02, 0.015), limbMat, s * 0.035, -0.032, 0.014);
      thumb.rotation.z = -s * 0.85;
      thumb.rotation.x = -0.3;
    }
    arms[side] = { shoulder, elbow, wrist };
  });

  /* --- Ben --- */
  const legs = {};
  [["left", -1], ["right", 1]].forEach(([side, s]) => {
    const hip = new THREE.Group();
    hip.position.set(s * 0.088, -0.05, 0);
    hips.add(hip);
    // Låret: kraftigast en bit ner, avsmalnande mot knäet
    add(hip, limbGeometry(0.44, 0.106, 0.098, 0.073), limbMat, 0, 0, 0);
    // Shortsben en bit ner på låret
    add(hip, limbGeometry(0.29, 0.118, 0.124, 0.132, 0.92, 0.05), shortsMat, 0, 0.055, 0);

    const knee = new THREE.Group();
    knee.position.y = -0.44;
    hip.add(knee);
    const kneeCap = add(knee, new THREE.SphereGeometry(0.068, 14, 12), skinMat, 0, 0.005, 0.006);
    kneeCap.scale.set(1, 0.92, 1.02);
    // Vaden buktar ut strax under knäet och smalnar av mot fotleden
    add(knee, limbGeometry(0.4, 0.07, 0.068, 0.036), limbMat, 0, 0, 0);
    // Strumpa från strax under knäet och ner i skon
    add(knee, limbGeometry(0.36, 0.086, 0.075, 0.055, 0.92, 0.03), sockMat, 0, 0.02, 0);

    const ankle = new THREE.Group();
    ankle.position.y = -0.4;
    knee.add(ankle);
    // Fotleden och skon
    const heel = add(ankle, new THREE.SphereGeometry(0.042, 14, 10), bootMat, 0, -0.022, -0.028);
    heel.scale.set(1, 1.05, 1.1);
    add(ankle, shoeGeometry(0.255), bootMat, 0, -0.042, -0.055);

    legs[side] = { hip, knee, ankle };
  });

  return { root, hips, spine, chest, head, arms, legs, keeper };
}

/* =====================================================================
   Poser och animationer
   ===================================================================== */

/** Nollställer alla leder. */
function poseReset(p) {
  p.root.position.set(0, 0, 0);
  p.root.rotation.set(0, 0, 0);
  p.hips.position.set(0, HIP_Y, 0);
  p.hips.rotation.set(0, 0, 0);
  p.spine.rotation.set(0, 0, 0);
  p.head.rotation.set(0, 0, 0);
  ["left", "right"].forEach((s) => {
    p.arms[s].shoulder.rotation.set(0, 0, 0);
    p.arms[s].elbow.rotation.set(0, 0, 0);
    p.arms[s].wrist.rotation.set(0, 0, 0);
    p.legs[s].hip.rotation.set(0, 0, 0);
    p.legs[s].knee.rotation.set(0, 0, 0);
    p.legs[s].ankle.rotation.set(0, 0, 0);
  });
}

/** Står still och andas. */
function poseIdle(p, t) {
  const b = Math.sin(t * 1.6);
  poseReset(p);
  // Tyngden på ena benet och en aning osymmetriskt — helt spegelvänt ser
  // ut som en skyltdocka
  p.hips.position.y = HIP_Y - 0.012 + b * 0.006;
  p.hips.rotation.z = 0.035;
  p.spine.rotation.set(0.06, 0.05, -0.03);
  p.head.rotation.set(-0.02, -0.07, 0);
  p.arms.left.shoulder.rotation.set(0.06, 0, -0.13);
  p.arms.right.shoulder.rotation.set(0.02, 0, 0.1);
  p.arms.left.elbow.rotation.set(-0.34 - b * 0.03, 0, 0.1);
  p.arms.right.elbow.rotation.set(-0.22 + b * 0.03, 0, -0.08);
  p.legs.left.hip.rotation.set(-0.03, 0, -0.04);
  p.legs.right.hip.rotation.set(0.06, 0, 0.09);
  p.legs.left.knee.rotation.x = 0.04;
  p.legs.right.knee.rotation.x = 0.14;
  p.legs.right.ankle.rotation.x = -0.06;
}

/** Löpsteg. phase räknas i hela steg, speed 0–1 skalar utslaget. */
function poseRun(p, phase, speed) {
  const th = phase * Math.PI * 2;
  const s = Math.sin(th);
  const A = 0.78 * speed;

  p.legs.left.hip.rotation.set(A * s - 0.14 * speed, 0, -0.04);
  p.legs.right.hip.rotation.set(-A * s - 0.14 * speed, 0, 0.04);
  p.legs.left.knee.rotation.x = 0.14 + 1.35 * Math.max(0, -Math.sin(th - 0.95)) * speed;
  p.legs.right.knee.rotation.x = 0.14 + 1.35 * Math.max(0, -Math.sin(th + Math.PI - 0.95)) * speed;
  p.legs.left.ankle.rotation.x = -0.3 * Math.sin(th + 0.7) * speed;
  p.legs.right.ankle.rotation.x = -0.3 * Math.sin(th + Math.PI + 0.7) * speed;

  p.arms.left.shoulder.rotation.set(-A * 0.72 * s, 0, -0.14);
  p.arms.right.shoulder.rotation.set(A * 0.72 * s, 0, 0.14);
  p.arms.left.elbow.rotation.x = -(0.95 + 0.5 * s) * speed - 0.15;
  p.arms.right.elbow.rotation.x = -(0.95 - 0.5 * s) * speed - 0.15;

  p.spine.rotation.set(0.2 * speed, -0.15 * s * speed, 0);
  p.head.rotation.set(-0.13 * speed, 0.15 * s * speed, 0);
  p.hips.position.y = HIP_Y + 0.038 * Math.abs(s) * speed;
  p.hips.rotation.z = 0.06 * s * speed;
}

/**
 * Sista steget före sparken. Blandar från löpposen mot exakt samma värden
 * som poseKick(0) börjar i, så att övergången blir sömlös.
 */
function poseBackswing(p, k) {
  const e = k * k * (3 - 2 * k);
  const bl = (obj, axis, target) => {
    obj.rotation[axis] = obj.rotation[axis] + (target - obj.rotation[axis]) * e;
  };
  bl(p.legs.right.hip, "x", 1.3);
  bl(p.legs.right.hip, "z", 0.04);
  bl(p.legs.right.knee, "x", 1.85);
  bl(p.legs.right.ankle, "x", 0.35);
  bl(p.legs.left.hip, "x", -0.22);
  bl(p.legs.left.hip, "z", -0.04);
  bl(p.legs.left.knee, "x", 0.3);
  bl(p.legs.left.ankle, "x", -0.1);
  bl(p.arms.left.shoulder, "x", -1.15);
  bl(p.arms.left.shoulder, "z", -0.69);
  bl(p.arms.left.elbow, "x", -1.0);
  bl(p.arms.right.shoulder, "x", 0.5);
  bl(p.arms.right.shoulder, "z", 0.39);
  bl(p.arms.right.elbow, "x", -0.3);
  bl(p.spine, "x", 0.26);
  bl(p.spine, "y", 0.32);
  bl(p.spine, "z", -0.12);
  bl(p.head, "x", 0.06);
  bl(p.head, "y", -0.2);
  bl(p.hips, "z", -0.1);
  p.hips.position.y = p.hips.position.y + (HIP_Y - 0.03 - p.hips.position.y) * e;
}

/** Genom bollen och följ igenom. */
function poseKick(p, k) {
  const e = 1 - Math.pow(1 - k, 3);
  p.legs.right.hip.rotation.x = 1.3 - 2.25 * e;
  p.legs.right.knee.rotation.x = 1.8 * (1 - e) + 0.05;
  p.legs.right.ankle.rotation.x = 0.35 - 0.55 * e;
  p.legs.left.hip.rotation.x = -0.22 - 0.12 * e;
  p.legs.left.knee.rotation.x = 0.3 - 0.22 * e;
  p.arms.left.shoulder.rotation.set(-1.15 + 0.55 * e, 0, -0.69 + 0.3 * e);
  p.arms.left.elbow.rotation.x = -1.0 + 0.35 * e;
  p.arms.right.shoulder.rotation.set(0.5 - 0.9 * e, 0, 0.39 + 0.3 * e);
  p.arms.right.elbow.rotation.x = -0.3 - 0.5 * e;
  p.spine.rotation.set(0.26 - 0.1 * e, 0.32 - 0.67 * e, -0.12 + 0.05 * e);
  p.head.rotation.set(0.06 - 0.14 * e, -0.2 + 0.28 * e, 0);
  p.hips.rotation.z = -0.1 + 0.16 * e;
  p.hips.position.y = HIP_Y - 0.03 - 0.05 * Math.sin(e * Math.PI);
}

/** Målvaktens grundställning: bred, låg, händerna framför. */
function poseKeeperSet(p, t) {
  const b = Math.sin(t * 6.5) * 0.5 + 0.5;
  poseReset(p);
  p.hips.position.y = HIP_Y - 0.13 - 0.025 * b;
  p.legs.left.hip.rotation.set(0.06, 0, -0.34);
  p.legs.right.hip.rotation.set(0.06, 0, 0.34);
  p.legs.left.knee.rotation.x = 0.62 + 0.1 * b;
  p.legs.right.knee.rotation.x = 0.62 + 0.1 * b;
  p.legs.left.ankle.rotation.x = -0.3;
  p.legs.right.ankle.rotation.x = -0.3;
  p.spine.rotation.set(0.24, 0, 0);
  p.arms.left.shoulder.rotation.set(-0.72, 0, -1.02 - 0.07 * b);
  p.arms.right.shoulder.rotation.set(-0.72, 0, 1.02 + 0.07 * b);
  p.arms.left.elbow.rotation.set(-1.0, 0, 0.25);
  p.arms.right.elbow.rotation.set(-1.0, 0, -0.25);
  p.arms.left.wrist.rotation.x = -0.35;
  p.arms.right.wrist.rotation.x = -0.35;
  p.head.rotation.x = -0.1;
}

/**
 * Vrider huvudet mot en punkt i världen, med begränsat utslag så nacken
 * inte vrids orimligt. Ger liv: spelarna följer bollen med blicken.
 */
function lookHeadAt(p, targetWorld, weight) {
  const head = p.head;
  head.updateWorldMatrix(true, false);
  _v.copy(targetWorld);
  head.parent.worldToLocal(_v);
  _v.sub(head.position);
  const yaw = clamp(Math.atan2(_v.x, _v.z), -1.1, 1.1);
  const pitch = clamp(-Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -0.6, 0.6);
  head.rotation.y += (yaw - head.rotation.y) * weight;
  head.rotation.x += (pitch - head.rotation.x) * weight;
}

/** Vrider en arm så att handen pekar mot en punkt i världen. */
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, -1, 0);

function reachArm(arm, targetWorld, blend) {
  const shoulder = arm.shoulder;
  shoulder.updateWorldMatrix(true, false);
  _v.copy(targetWorld);
  shoulder.parent.worldToLocal(_v);
  _v.sub(shoulder.position);
  if (_v.lengthSq() < 1e-6) return;
  _v.normalize();
  _q.setFromUnitVectors(_up, _v);
  shoulder.quaternion.slerp(_q, blend);
  arm.elbow.rotation.x *= 1 - blend;
}

/** Målgest: armarna upp i ett V, hopp och knytnävsslag. */
function poseCelebrate(p, t) {
  poseReset(p);
  const raise = Math.min(1, t / 0.32);
  const jump = t < 0.6 ? Math.sin((t / 0.6) * Math.PI) : 0;
  const pump = t > 0.75 ? Math.max(0, Math.sin((t - 0.75) * 7.5)) : 0;

  p.root.position.y = jump * 0.4;
  p.hips.position.y = HIP_Y - 0.08 * (1 - raise);
  p.spine.rotation.set(-0.24 * raise, Math.sin(t * 2.2) * 0.08, 0);
  p.head.rotation.set(-0.32 * raise, Math.sin(t * 2.2) * 0.12, 0);

  p.arms.left.shoulder.rotation.set(-0.25, 0, -2.5 * raise + 0.35 * pump);
  p.arms.right.shoulder.rotation.set(-0.25, 0, 2.5 * raise - 0.35 * pump);
  p.arms.left.elbow.rotation.x = -(0.18 + 1.15 * pump);
  p.arms.right.elbow.rotation.x = -(0.18 + 1.15 * pump);

  p.legs.left.hip.rotation.set(-0.55 * jump, 0, -0.06);
  p.legs.right.hip.rotation.set(0.32 * jump, 0, 0.06);
  p.legs.left.knee.rotation.x = 0.12 + 1.05 * jump;
  p.legs.right.knee.rotation.x = 0.12 + 0.3 * jump;
  p.legs.left.ankle.rotation.x = 0.35 * jump;
  p.legs.right.ankle.rotation.x = 0.35 * jump;
}

/** Förlustgest: händerna upp mot ansiktet, huvudet ner. */
function poseDejected(p, t) {
  poseReset(p);
  const e = Math.min(1, t / 0.85);
  const sway = Math.sin(t * 1.5) * 0.05;

  p.hips.position.y = HIP_Y - 0.07 * e;
  p.spine.rotation.set(0.32 * e, sway, 0);
  p.head.rotation.set(0.48 * e, sway * 2, 0);

  p.arms.left.shoulder.rotation.set(-1.2 * e, 0, -0.6 * e);
  p.arms.right.shoulder.rotation.set(-1.2 * e, 0, 0.6 * e);
  p.arms.left.elbow.rotation.set(-2.2 * e, 0, 0.3 * e);
  p.arms.right.elbow.rotation.set(-2.2 * e, 0, -0.3 * e);

  p.legs.left.hip.rotation.set(0.06, 0, -0.09);
  p.legs.right.hip.rotation.set(0.06, 0, 0.09);
  p.legs.left.knee.rotation.x = 0.14 + 0.12 * e;
  p.legs.right.knee.rotation.x = 0.14 + 0.12 * e;
}

/**
 * Målvaktens dyk. e = 0–1, dirX = -1/1 (världens x-riktning), high = högt
 * hörn, ballWorld = bollens position att sträcka sig mot (får vara null),
 * lateral = hur många meter i sidled dyket når.
 */
function poseDive(p, e, dirX, high, ballWorld, lateral) {
  const s = 1 - Math.pow(1 - e, 2);

  // Avstamp: kroppen kastar sig i sidled och roterar mot horisontalläge
  p.root.position.x = (lateral || 0) * s;
  p.root.position.z = 0.22 - 0.18 * s;
  // Kroppen roteras kring rotpunkten, som ligger i marknivå. Ju mer liggande
  // kroppen blir, desto mer måste roten lyftas — annars hamnar halva spelaren
  // under gräset. 0,2 m är ungefär kroppens halva tjocklek.
  const lie = Math.sin(Math.min(1, s) * (Math.PI / 2));
  const air = Math.sin(Math.min(1, s) * Math.PI * 0.78);
  p.root.position.y = (high ? 0.6 : 0.26) * air + 0.2 * lie;
  p.root.rotation.z = -dirX * (high ? 1.0 : 1.34) * s;
  p.root.rotation.y = -dirX * 0.3 * s;
  p.root.rotation.x = (high ? -0.12 : 0.16) * s;
  p.hips.position.y = HIP_Y - 0.13 + (high ? 0.16 : 0.02) * s;
  p.spine.rotation.set((high ? -0.34 : 0.26) * s, -dirX * 0.18 * s, 0);
  p.head.rotation.set(-0.1 - 0.15 * s, dirX * 0.2 * s, 0);

  // Benen sträcks ut och trailar efter
  const lead = dirX > 0 ? "right" : "left";
  const trail = dirX > 0 ? "left" : "right";
  p.legs[lead].hip.rotation.set(0.06 + (high ? -0.5 : 0.2) * s, 0, (dirX > 0 ? 0.34 : -0.34) * (1 - 0.6 * s));
  p.legs[lead].knee.rotation.x = 0.62 - 0.5 * s;
  p.legs[trail].hip.rotation.set(0.06 + (high ? -0.2 : 0.55) * s, 0, (dirX > 0 ? -0.34 : 0.34) * (1 - 0.3 * s));
  p.legs[trail].knee.rotation.x = 0.62 - 0.15 * s;
  p.legs.left.ankle.rotation.x = -0.3 + 0.5 * s;
  p.legs.right.ankle.rotation.x = -0.3 + 0.5 * s;

  // Armarna: den ledande armen sträcks mot bollen, den andra följer med
  p.arms.left.shoulder.rotation.set(-0.55, 0, -0.95 - (high ? 1.5 : 0.9) * s);
  p.arms.right.shoulder.rotation.set(-0.55, 0, 0.95 + (high ? 1.5 : 0.9) * s);
  p.arms.left.elbow.rotation.x = -0.75 * (1 - 0.85 * s);
  p.arms.right.elbow.rotation.x = -0.75 * (1 - 0.85 * s);
  if (ballWorld && s > 0.05) {
    reachArm(p.arms[lead], ballWorld, Math.min(1, s * 1.1));
    reachArm(p.arms[trail], ballWorld, Math.min(0.75, s * 0.7));
  }
}

/**
 * Räddning i mitten: ingen sidledsrörelse utan ett hopp uppåt (högt skott)
 * eller ett fall ihop med benen (lågt skott).
 */
function poseCenterSave(p, e, high, ballWorld) {
  const s = 1 - Math.pow(1 - e, 2);
  p.root.position.x = 0;
  p.root.position.z = 0.22 - 0.1 * s;
  p.root.rotation.set(0, 0, 0);
  p.root.position.y = high ? 0.45 * Math.sin(Math.min(1, s) * Math.PI * 0.8) : 0;
  if (high) {
    p.hips.position.y = HIP_Y - 0.13 + 0.06 * s;
    p.spine.rotation.set(-0.2 * s, 0, 0);
    p.arms.left.shoulder.rotation.set(-0.55 - 2.1 * s, 0, -0.95 + 0.65 * s);
    p.arms.right.shoulder.rotation.set(-0.55 - 2.1 * s, 0, 0.95 - 0.65 * s);
    p.legs.left.hip.rotation.x = 0.06 - 0.5 * s;
    p.legs.right.hip.rotation.x = 0.06 - 0.5 * s;
    p.legs.left.knee.rotation.x = 0.62 + 0.5 * s;
    p.legs.right.knee.rotation.x = 0.62 + 0.5 * s;
  } else {
    p.hips.position.y = HIP_Y - 0.13 - 0.42 * s;
    p.spine.rotation.set(0.24 + 0.35 * s, 0, 0);
    p.arms.left.shoulder.rotation.set(-0.9 - 0.5 * s, 0, -0.95 + 0.7 * s);
    p.arms.right.shoulder.rotation.set(-0.9 - 0.5 * s, 0, 0.95 - 0.7 * s);
    p.legs.left.hip.rotation.set(0.4 * s, 0, -0.34 - 0.3 * s);
    p.legs.right.hip.rotation.set(0.4 * s, 0, 0.34 + 0.3 * s);
    p.legs.left.knee.rotation.x = 0.62 + 0.7 * s;
    p.legs.right.knee.rotation.x = 0.62 + 0.7 * s;
  }
  p.arms.left.elbow.rotation.x = -0.75 * (1 - 0.8 * s);
  p.arms.right.elbow.rotation.x = -0.75 * (1 - 0.8 * s);
  if (ballWorld && s > 0.1) {
    reachArm(p.arms.left, ballWorld, Math.min(0.9, s));
    reachArm(p.arms.right, ballWorld, Math.min(0.9, s));
  }
}

/* =====================================================================
   Scenen
   ===================================================================== */

export class PenaltyScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.running = false;
    this.time = 0;
    this.phase = "idle";
    this._anim = null;
    this._cam = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    this._camGoal = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    this._shake = 0;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog(0x0d1c31, 45, 165);

    this.camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 400);
    this.camera.position.set(0, 1.55, 14.6);

    this._buildLights();
    this._buildPitch();
    this._buildGoal();
    this._buildStadium();
    this._buildBall();
    this._buildAim();

    this.keeper = null;
    this.shooter = null;
    this.teams = {
      home: { shirt: 0x1a7a3c, shorts: 0xffffff, socks: 0x1a7a3c, gloves: 0xe8e8e8 },
      away: { shirt: 0xc9352b, shorts: 0x1c231f, socks: 0xc9352b, gloves: 0xffe066 },
    };

    this.raycaster = new THREE.Raycaster();
    this._aimPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(GOAL_W * 2.2, 4.2),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this._aimPlane.position.set(0, 1.3, 0);
    this.scene.add(this._aimPlane);

    this.setPhase("shoot", true);
    this.resize();
  }

  /* ---------- Ljus: flodljus på natten ---------- */
  _buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x9fb8d0, 0x22331f, 0.45));

    // Huvudljuset kastar skuggorna
    const key = new THREE.DirectionalLight(0xf2f6ff, 2.6);
    key.position.set(-16, 26, 20);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 90;
    key.shadow.camera.left = -26;
    key.shadow.camera.right = 26;
    key.shadow.camera.top = 26;
    key.shadow.camera.bottom = -14;
    key.shadow.bias = -0.0009;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 3.5; // mjukare skuggkant
    this.scene.add(key);
    this.scene.add(key.target);
    key.target.position.set(0, 0, 6);

    const fill = new THREE.DirectionalLight(0xbfd4ff, 1.05);
    fill.position.set(20, 22, -8);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xdce8ff, 0.8);
    rim.position.set(4, 14, -24);
    this.scene.add(rim);

    // Svagt ljus rakt framifrån, så ansikten och nummer inte hamnar i mörker
    const face = new THREE.DirectionalLight(0xe8f0ff, 0.32);
    face.position.set(-2, 6, 26);
    this.scene.add(face);

    // Flodljusmaster i hörnen
    this.pylons = [];
    const mastMat = new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.7, metalness: 0.3 });
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfff4d6,
      emissiveIntensity: 3.2,
      roughness: 0.4,
    });
    [[-30, -12], [30, -12], [-30, 30], [30, 30]].forEach(([x, z]) => {
      const g = new THREE.Group();
      const h = 24;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.42, h, 10), mastMat);
      mast.position.y = h / 2;
      g.add(mast);
      const rig = new THREE.Mesh(new THREE.BoxGeometry(5.4, 2.6, 0.5), mastMat);
      rig.position.y = h + 1.2;
      g.add(rig);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 2; j++) {
          const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.5, 12), lampMat);
          lamp.position.set(-2 + i * 1.35, h + 0.55 + j * 1.2, z > 0 ? -0.3 : 0.3);
          lamp.rotation.y = z > 0 ? Math.PI : 0;
          g.add(lamp);
        }
      }
      // Ljusdimma runt masten
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this._glowTexture(),
          color: 0xfff0cc,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      glow.position.set(0, h + 1.2, 0);
      glow.scale.set(16, 16, 1);
      g.add(glow);
      g.position.set(x, 0, z);
      this.scene.add(g);
      this.pylons.push(g);
    });
  }

  _glowTexture() {
    if (this._glowTex) return this._glowTex;
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const g = cv.getContext("2d");
    const rad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    rad.addColorStop(0, "rgba(255,248,225,0.9)");
    rad.addColorStop(0.35, "rgba(255,240,200,0.28)");
    rad.addColorStop(1, "rgba(255,235,190,0)");
    g.fillStyle = rad;
    g.fillRect(0, 0, 128, 128);
    this._glowTex = new THREE.CanvasTexture(cv);
    return this._glowTex;
  }

  /* ---------- Gräsmattan ---------- */
  _buildPitch() {
    const pitch = new THREE.Mesh(
      new THREE.PlaneGeometry(PITCH, PITCH),
      new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 0.92, metalness: 0 })
    );
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    this.scene.add(pitch);

    // Mörkt underlag längre bort så kanten inte syns
    const around = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 260),
      new THREE.MeshStandardMaterial({ color: 0x16301a, roughness: 1 })
    );
    around.rotation.x = -Math.PI / 2;
    around.position.y = -0.02;
    this.scene.add(around);
  }

  /* ---------- Målet med stolpar, ribba och nät ---------- */
  _buildGoal() {
    const goal = new THREE.Group();
    this.scene.add(goal);
    this.goal = goal;

    const white = new THREE.MeshStandardMaterial({ color: 0xf4f7f8, roughness: 0.42, metalness: 0.12 });

    const post = new THREE.CylinderGeometry(POST_R, POST_R, GOAL_H, 16);
    [-1, 1].forEach((s) => {
      const p = new THREE.Mesh(post, white);
      p.position.set((s * GOAL_W) / 2, GOAL_H / 2, 0);
      p.castShadow = true;
      goal.add(p);
    });
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(POST_R, POST_R, GOAL_W + POST_R * 2, 16), white);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, GOAL_H, 0);
    bar.castShadow = true;
    goal.add(bar);

    // Bakre stödrör
    const backBottomY = 0.05;
    [-1, 1].forEach((s) => {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, Math.hypot(NET_DEPTH, GOAL_H - backBottomY), 10), white);
      strut.position.set((s * GOAL_W) / 2, GOAL_H / 2, -NET_DEPTH / 2);
      strut.rotation.x = Math.atan2(NET_DEPTH, GOAL_H - backBottomY);
      goal.add(strut);
    });
    const backBar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, GOAL_W, 10), white);
    backBar.rotation.z = Math.PI / 2;
    backBar.position.set(0, backBottomY, -NET_DEPTH);
    goal.add(backBar);

    this._buildNet(goal);
  }

  _buildNet(parent) {
    const step = 0.13; // maskstorlek
    const pts = [];
    const hw = GOAL_W / 2;

    // Baksidan lutar bakåt och nätet hänger med en lätt sväng
    const backZ = (y) => -NET_DEPTH * (0.55 + 0.45 * (1 - y / GOAL_H));
    const sag = (t) => Math.sin(t * Math.PI) * 0.06;

    const push = (x1, y1, z1, x2, y2, z2) => pts.push(x1, y1, z1, x2, y2, z2);

    // Bakre panel
    for (let x = -hw; x <= hw + 0.001; x += step) {
      push(x, 0, backZ(0), x, GOAL_H, backZ(GOAL_H));
    }
    for (let y = 0; y <= GOAL_H + 0.001; y += step) {
      push(-hw, y, backZ(y), hw, y, backZ(y));
    }
    // Sidopaneler
    [-1, 1].forEach((s) => {
      for (let y = 0; y <= GOAL_H + 0.001; y += step) {
        push(s * hw, y, 0, s * hw, y, backZ(y));
      }
      const zs = [];
      for (let z = 0; z >= -NET_DEPTH - 0.001; z -= step) zs.push(z);
      zs.forEach((z) => {
        const t = clamp(-z / NET_DEPTH, 0, 1);
        const topY = GOAL_H - t * 0.02;
        push(s * hw, 0, z, s * hw, topY, z);
      });
    });
    // Tak
    for (let x = -hw; x <= hw + 0.001; x += step) {
      push(x, GOAL_H, 0, x, GOAL_H - 0.02, backZ(GOAL_H));
    }
    for (let z = 0; z >= -NET_DEPTH - 0.001; z -= step) {
      const t = clamp(-z / NET_DEPTH, 0, 1);
      const y = GOAL_H - sag(t) - t * 0.02;
      push(-hw, y, z, hw, y, z);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this._netBase = Float32Array.from(pts);
    const net = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })
    );
    parent.add(net);
    this.net = net;
  }

  /* ---------- Läktare, publik och reklamskyltar ---------- */
  _buildStadium() {
    const crowd = crowdTexture();
    const concrete = new THREE.MeshStandardMaterial({ color: 0x2b3238, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x1b2126, roughness: 0.8, metalness: 0.2 });

    const stand = (w, x, z, rotY, height) => {
      const g = new THREE.Group();
      const depth = height * 1.35;

      // Publiken på ett lutande plan som reser sig bort från planen
      const tex = crowd.clone();
      tex.needsUpdate = true;
      tex.repeat.set(Math.max(1, w / 24), 1);
      const seats = new THREE.Mesh(
        new THREE.PlaneGeometry(w, Math.hypot(depth, height)),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 })
      );
      seats.rotation.x = -Math.atan2(depth, height);
      seats.position.set(0, height / 2 + 1.2, -depth / 2);
      g.add(seats);

      // Framkant och bakvägg
      const front = new THREE.Mesh(new THREE.BoxGeometry(w, 1.4, 0.6), concrete);
      front.position.set(0, 0.7, 0.3);
      g.add(front);
      const back = new THREE.Mesh(new THREE.BoxGeometry(w, height + 2, 1.2), concrete);
      back.position.set(0, (height + 2) / 2, -depth - 0.4);
      g.add(back);

      // Tak, en bit ovanför översta raden
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 1.5, 0.45, depth + 2.5), roofMat);
      roof.position.set(0, height + 3.9, -depth / 2 - 0.5);
      roof.rotation.x = 0.06;
      g.add(roof);
      [-1, 1].forEach((s) => {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.7, height + 3.9, 0.9), roofMat);
        pillar.position.set((s * (w - 1.5)) / 2, (height + 3.9) / 2, -depth - 0.7);
        g.add(pillar);
      });

      g.position.set(x, 0, z);
      g.rotation.y = rotY;
      this.scene.add(g);
      return g;
    };

    stand(64, 0, -23.5, 0, 6.5); // bakom målet
    stand(76, -32, 14, Math.PI / 2, 13); // långsida vänster
    stand(76, 32, 14, -Math.PI / 2, 13); // långsida höger

    // Reklamskyltar runt planen — samarbetet med Föreningsdomare i Sverige.
    // Texturen är en bricka på tre skyltar (12 m) som upprepas längs sidan,
    // så att texten får rätt proportioner i stället för att sträckas ut.
    const boards = new THREE.Mesh(new THREE.PlaneGeometry(58, 1.05), this._boardMaterial(58));
    boards.position.set(0, 0.53, -14);
    this.scene.add(boards);
    [-1, 1].forEach((sd) => {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(46, 1.05), this._boardMaterial(46));
      side.position.set(sd * 29.5, 0.53, 12);
      side.rotation.y = sd > 0 ? -Math.PI / 2 : Math.PI / 2;
      this.scene.add(side);
    });
  }

  /** Material för en skyltrad av given längd, med rätt antal upprepningar. */
  _boardMaterial(lengthMeters) {
    if (!this._boardTex) this._boardTex = this._boardTexture();
    const tex = this._boardTex.clone();
    tex.needsUpdate = true;
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(lengthMeters / 12, 1);
    return new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.5,
      emissive: 0x101a12,
      emissiveIntensity: 0.35,
    });
  }

  /** Föreningsdomares visselpipa, förenklad. */
  _drawWhistle(g, x, y, s) {
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    g.rotate(-0.12);
    // Kropp
    g.fillStyle = "#f5c518";
    g.beginPath();
    g.moveTo(-26, -14);
    g.lineTo(16, -14);
    g.quadraticCurveTo(30, -14, 30, 0);
    g.quadraticCurveTo(30, 14, 16, 14);
    g.lineTo(-26, 14);
    g.quadraticCurveTo(-34, 14, -34, 0);
    g.quadraticCurveTo(-34, -14, -26, -14);
    g.closePath();
    g.fill();
    // Munstycke
    g.fillStyle = "#f5c518";
    g.fillRect(24, -5, 20, 10);
    // Ljudhål
    g.fillStyle = "#0c1c0f";
    g.beginPath();
    g.arc(-6, -1, 6.5, 0, Math.PI * 2);
    g.fill();
    // Limegrön accent
    g.strokeStyle = "#8dc63f";
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(-30, 16);
    g.quadraticCurveTo(-4, 26, 24, 12);
    g.stroke();
    g.restore();
  }

  _boardTexture() {
    const PW = 768; // en skylt = 4 m
    const H = 202;
    const cv = document.createElement("canvas");
    cv.width = PW * 3;
    cv.height = H;
    const g = cv.getContext("2d");

    const DARK = "#0c1c0f";
    const YELLOW = "#f5c518";
    const LIME = "#8dc63f";

    const swoosh = (x0) => {
      g.save();
      g.beginPath();
      g.moveTo(x0 + PW * 0.62, H);
      g.quadraticCurveTo(x0 + PW * 0.82, H * 0.45, x0 + PW, 0);
      g.lineTo(x0 + PW, H);
      g.closePath();
      g.fillStyle = "rgba(141,198,63,0.16)";
      g.fill();
      g.strokeStyle = LIME;
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(x0 + PW * 0.6, H);
      g.quadraticCurveTo(x0 + PW * 0.8, H * 0.45, x0 + PW * 0.98, 0);
      g.stroke();
      g.restore();
    };

    /* Skylt 1: logotyp och namn */
    g.fillStyle = DARK;
    g.fillRect(0, 0, PW, H);
    swoosh(0);
    this._drawWhistle(g, 92, H * 0.5, 1.15);
    g.fillStyle = "#ffffff";
    g.font = "bold 62px 'Helvetica Neue', Helvetica, Arial, sans-serif";
    g.textBaseline = "middle";
    g.fillText("FÖRENINGS", 162, H * 0.34);
    g.fillText("DOMARE", 162, H * 0.66);
    g.fillStyle = YELLOW;
    g.font = "bold 26px 'Helvetica Neue', Helvetica, Arial, sans-serif";
    g.fillText("I  S V E R I G E", 470, H * 0.7);

    /* Skylt 2: sloganen, gul botten */
    g.fillStyle = YELLOW;
    g.fillRect(PW, 0, PW, H);
    g.fillStyle = DARK;
    g.font = "bold 58px 'Helvetica Neue', Helvetica, Arial, sans-serif";
    g.textAlign = "center";
    g.fillText("BOKA ERA FÖRENINGS-", PW * 1.5, H * 0.34);
    g.fillText("DOMARE ENKELT!", PW * 1.5, H * 0.68);
    g.textAlign = "left";

    /* Skylt 3: adressen */
    g.fillStyle = DARK;
    g.fillRect(PW * 2, 0, PW, H);
    swoosh(PW * 2);
    g.fillStyle = "#ffffff";
    g.font = "bold 64px 'Helvetica Neue', Helvetica, Arial, sans-serif";
    g.textAlign = "center";
    g.fillText("FORENINGSDOMARE.SE", PW * 2.5, H * 0.44);
    g.strokeStyle = YELLOW;
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(PW * 2 + 150, H * 0.72);
    g.quadraticCurveTo(PW * 2.5, H * 0.86, PW * 3 - 150, H * 0.72);
    g.stroke();
    g.textAlign = "left";

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  /* ---------- Bollen ---------- */
  _buildBall() {
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 32, 24),
      new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.45, metalness: 0.02 })
    );
    this.ball.castShadow = true;
    this.scene.add(this.ball);
    this.resetBall();
  }

  /* ---------- Siktet ---------- */
  _buildAim() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.21, 28),
      new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.95, side: THREE.DoubleSide })
    );
    g.add(ring);
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.05, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
    );
    g.add(dot);
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(
        new THREE.PlaneGeometry(0.02, 0.13),
        new THREE.MeshBasicMaterial({ color: 0xffe066, side: THREE.DoubleSide })
      );
      tick.position.set(Math.cos((i * Math.PI) / 2) * 0.3, Math.sin((i * Math.PI) / 2) * 0.3, 0);
      tick.rotation.z = (i * Math.PI) / 2;
      g.add(tick);
    }
    g.position.set(0, GOAL_H * 0.5, 0.06);
    g.visible = false;
    this.scene.add(g);
    this.aim = g;
    this._aimRing = ring;
  }

  /* =====================================================================
     Publikt API
     ===================================================================== */

  setTeams(home, away) {
    this.teams.home = Object.assign({}, this.teams.home, home || {});
    this.teams.away = Object.assign({}, this.teams.away, away || {});
    this._rebuildPlayers();
  }

  _rebuildPlayers() {
    if (this.keeper) this.scene.remove(this.keeper.root);
    if (this.shooter) this.scene.remove(this.shooter.root);

    // I skjutläget är motståndaren målvakt, i räddningsläget är det vi själva
    const keeperColors = this.phase === "save" ? this.teams.home : this.teams.away;
    const shooterColors = this.phase === "save" ? this.teams.away : this.teams.home;

    // Utseende (hudton, frisyr, skor, tröjmönster) härleds ur lagfärgerna, så
    // att samma klubb alltid får samma spelare.
    const seedOf = (c) => ((c.shirt ^ (c.shorts * 7)) >>> 0) % 9973;
    const kSeed = seedOf(keeperColors);
    const sSeed = seedOf(shooterColors);

    // Målvakten bär klubbens egen tröjfärg, så man ser vilket lag som står i mål
    this.keeper = buildPlayer(
      {
        shirt: keeperColors.shirt,
        shorts: keeperColors.shorts,
        socks: keeperColors.socks,
        gloves: 0xf4f4f4,
      },
      { keeper: true, number: 1, seed: kSeed }
    );
    this.keeper.root.position.set(0, 0, 0.22);
    this.scene.add(this.keeper.root);

    this.shooter = buildPlayer(shooterColors, {
      number: [7, 9, 10, 11, 17, 8][sSeed % 6],
      seed: sSeed,
    });
    this.scene.add(this.shooter.root);

    this._resetPoses();
  }

  _resetPoses() {
    if (!this.keeper) return;

    poseKeeperSet(this.keeper, 0);
    this.keeper.root.position.set(0, 0, 0.22);
    this.keeper.root.rotation.set(0, 0, 0);

    poseIdle(this.shooter, 0);
    // Startposition för upploppet, snett bakom bollen
    this.shooter.root.position.set(-2.6, 0, SPOT_Z + 4.2);
    this.shooter.root.rotation.set(0, Math.PI + 0.42, 0);
    // I skjutläget står man bakom sin egen spelare — han göms tills upploppet
    // börjar, så att han inte skymmer målet medan man siktar.
    this.shooter.root.visible = this.phase !== "shoot";
  }

  setPhase(phase, immediate) {
    this.phase = phase;
    this._phaseAt = performance.now();
    if (phase === "shoot") {
      // Bakom skytten, som på tv:ns straffkamera
      this._camGoal.pos.set(0.4, 2.1, SPOT_Z + 9);
      this._camGoal.target.set(0, 1.25, 0);
      this.camera.fov = 32;
    } else if (phase === "save") {
      // Bakom och över målet, så hela målramen och skytten syns
      // Låg kamera strax bakom nätet — målramen hamnar mitt i bild och
      // skytten syns genom målmunnen, som en riktig målkamera.
      this._camGoal.pos.set(0, 1.3, -5.6);
      this._camGoal.target.set(0, 1.3, 12);
      this.camera.fov = 48;
    } else if (phase === "ending") {
      // Nära, låg vinkel framifrån — gesten ska fylla bilden
      this._camGoal.pos.set(1.15, 1.14, SPOT_Z + 2.75);
      this._camGoal.target.set(0, 1.28, SPOT_Z - 0.6);
      this.camera.fov = 40;
    } else {
      this._camGoal.pos.set(9.5, 3.1, 11.5);
      this._camGoal.target.set(0, 1.2, 1);
      this.camera.fov = 42;
    }
    this.camera.updateProjectionMatrix();
    if (immediate) {
      this._cam.pos.copy(this._camGoal.pos);
      this._cam.target.copy(this._camGoal.target);
    }
    if (this.keeper) this._rebuildPlayers();
  }

  /**
   * Ger +1 om världens positiva x-axel hamnar till höger i bild, annars -1.
   * Målvaktsvyn ligger bakom målet, där sidorna byter plats — den här
   * funktionen låter knapparna alltid betyda vänster/höger så som det ser ut
   * på skärmen.
   */
  worldXScreenSign() {
    const a = new THREE.Vector3(3, 1.2, 0).project(this.camera);
    const b = new THREE.Vector3(-3, 1.2, 0).project(this.camera);
    return a.x >= b.x ? 1 : -1;
  }

  /**
   * Har kameran hunnit fram till sitt nya läge? Siktet räknas ut genom att
   * skjuta en stråle från kameran, så ett tryck under själva kamerabytet
   * skulle peka någon helt annanstans.
   */
  cameraSettled() {
    // Efter 0,7 s släpper vi igenom oavsett, så att ett tryck aldrig kan
    // bli helt låst om kameran av någon anledning inte hinner ända fram.
    if (performance.now() - (this._phaseAt || 0) > 700) return true;
    return this._cam.pos.distanceTo(this._camGoal.pos) < 0.5;
  }

  /** Avstånd kvar till kamerans målläge — används vid felsökning. */
  cameraGap() {
    return this._cam.pos.distanceTo(this._camGoal.pos);
  }

  showAim(visible) {
    this.aim.visible = !!visible;
  }

  setAim(tx, ty) {
    this._aimTx = tx;
    this._aimTy = ty;
    this.aim.position.set(tx * (GOAL_W / 2), ty * GOAL_H, 0.07);
  }

  /** Omvandlar en pekarposition på canvasen till normaliserat sikte i målet. */
  pickAim(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this._aimPlane, false)[0];
    if (!hit) return null;
    return {
      tx: clamp(hit.point.x / (GOAL_W / 2), -1.45, 1.45),
      ty: clamp(hit.point.y / GOAL_H, 0.02, 1.5),
    };
  }

  resetBall() {
    this.ball.position.set(0, BALL_R, SPOT_Z);
    this.ball.rotation.set(0, 0, 0);
    this._netOffset = 0;
    this._restoreNet();
  }

  _restoreNet() {
    const pos = this.net.geometry.attributes.position;
    pos.array.set(this._netBase);
    pos.needsUpdate = true;
  }

  /** Låter nätet buckla ut där bollen träffade. */
  _bulgeNet(point, amount) {
    const pos = this.net.geometry.attributes.position;
    const base = this._netBase;
    for (let i = 0; i < base.length; i += 3) {
      const dx = base[i] - point.x;
      const dy = base[i + 1] - point.y;
      const d = Math.hypot(dx, dy);
      const w = Math.exp(-(d * d) / 1.1);
      pos.array[i] = base[i] + dx * 0.06 * w * amount;
      pos.array[i + 1] = base[i + 1] + dy * 0.06 * w * amount;
      pos.array[i + 2] = base[i + 2] - 0.55 * w * amount;
    }
    pos.needsUpdate = true;
  }

  /**
   * Spelar upp en straff.
   * @param {object} o
   *   tx, ty      – sikte, normaliserat (tx: -1..1 över målet, ty: 0..1 höjd)
   *   power       – 0..1
   *   keeperZone  – {col:-1|0|1, row:0|1} dit målvakten kastar sig
   *   outcome     – "goal" | "save" | "miss" | "post"
   */
  playShot(o) {
    const self = this;
    this.showAim(false);
    this._restoreNet();
    this.shooter.root.visible = true;

    const power = clamp(o.power == null ? 0.7 : o.power, 0.15, 1);
    const flightTime = lerp(0.95, 0.52, power);
    const targetX = o.tx * (GOAL_W / 2);
    const targetY = Math.max(0.05, o.ty * GOAL_H);
    const start = new THREE.Vector3(0, BALL_R, SPOT_Z);

    // Slutpunkt: i nätet vid mål, förbi målet vid miss
    let endZ = -NET_DEPTH * 0.62;
    if (o.outcome === "miss") endZ = -3.4;
    if (o.outcome === "post") endZ = -0.1;
    const end = new THREE.Vector3(targetX, targetY, endZ);
    if (o.outcome === "miss") {
      // Utanför ramen — antingen vid sidan eller över ribban
      const overBar = o.ty > 0.95;
      end.x = overBar ? targetX : Math.sign(o.tx || 1) * (GOAL_W / 2 + 1.1);
      end.y = overBar ? Math.max(GOAL_H + 0.9, targetY) : targetY;
    }

    // Kurva och lyft
    const curve = (o.curve == null ? 0 : o.curve) * lerp(1.4, 0.55, power);
    const apex = lerp(0.55, 1.15, Math.max(0, targetY / GOAL_H - 0.15)) + power * 0.35;
    const mid = new THREE.Vector3(
      (start.x + end.x) / 2 + curve,
      Math.max(start.y, targetY) + apex * 0.42,
      (start.z + end.z) / 2
    );
    const path = new THREE.QuadraticBezierCurve3(start, mid, end);

    // Målvaktens mål: bollen om han räddar, annars mitten av den valda rutan
    const kz = o.keeperZone || { col: 0, row: 0 };
    let diveTo;
    if (o.outcome === "save") {
      const t = clamp(0.9, 0, 1);
      diveTo = path.getPoint(t);
    } else {
      diveTo = new THREE.Vector3(kz.col * (GOAL_W / 2) * 0.78, kz.row ? GOAL_H * 0.78 : GOAL_H * 0.22, 0.1);
    }

    // Åt vilket håll, hur högt och hur långt målvakten kastar sig
    const diveHigh = diveTo.y > GOAL_H * 0.5;
    const centreDive = Math.abs(diveTo.x) < 0.9;
    const diveDirX = Math.sign(diveTo.x) || 1;
    const diveLateral = diveTo.x * 0.82;

    const runUp = 0.72;
    const dive = 0.42;
    const settle = o.outcome === "goal" ? 1.25 : 1.15;
    const total = runUp + flightTime + settle;

    return new Promise((resolve) => {
      self._anim = {
        t: 0,
        t0: null,
        total,
        resolve,
        update(dt) {
          // Tiden räknas i verklig tid, inte i bildrutor, så att animationen
          // tar lika lång tid även på en enhet som ritar få bilder per sekund.
          if (this.t0 === null) this.t0 = performance.now();
          this.t = (performance.now() - this.t0) / 1000;
          const t = this.t;
          const s = self.shooter;
          const k = self.keeper;

          /* --- Upploppet --- */
          if (t < runUp) {
            const p = t / runUp;
            const travel = easeInOut(Math.min(1, p / 0.9));
            s.root.position.set(
              lerp(-2.6, -0.42, travel),
              0,
              lerp(SPOT_Z + 4.2, SPOT_Z + 0.34, travel)
            );
            s.root.rotation.y = lerp(Math.PI + 0.42, Math.PI + 0.1, travel);
            // Knappt tre löpsteg, som saktar in inför sparken
            poseRun(s, p * 2.7, clamp(1.15 - p * 0.55, 0.45, 1));
            if (p > 0.66) poseBackswing(s, (p - 0.66) / 0.34);
            poseKeeperSet(k, t);
            lookHeadAt(k, self.ball.position, 0.35);
            return;
          }

          /* --- Kontakt och bollflykt --- */
          const rawFt = (t - runUp) / flightTime;
          const ft = clamp(rawFt, 0, 1);
          if (rawFt < 1) {
            const bp = path.getPoint(easeOut(ft) * 0.35 + ft * 0.65);
            self.ball.position.copy(bp);
            const spin = (1 / flightTime) * 11;
            self.ball.rotation.x -= dt * spin;
            self.ball.rotation.y -= dt * spin * (o.curve || 0) * 2.5;

            // Sparkbenet går genom bollen och följer igenom
            poseKick(s, clamp(ft * 2.8, 0, 1));
            s.root.position.z = SPOT_Z + 0.34 - Math.min(0.4, ft * 0.55);
            // Båda följer bollen med blicken
            lookHeadAt(s, self.ball.position, 0.35);

            const dp = clamp((t - runUp - 0.02) / dive, 0, 1);
            if (dp > 0) {
              // Räddar han bollen sträcker han sig mot dess faktiska bana,
              // annars mot mitten av rutan han valde
              const target = o.outcome === "save" ? self.ball.position : diveTo;
              if (centreDive) poseCenterSave(k, dp, diveHigh, target);
              else poseDive(k, dp, diveDirX, diveHigh, target, diveLateral);
              lookHeadAt(k, self.ball.position, 0.4);
            } else {
              poseKeeperSet(k, t);
              lookHeadAt(k, self.ball.position, 0.5);
            }
            return;
          }

          /* --- Efter träffen --- */
          if (!this._impact) {
            this._impact = true;
            self._shake = o.outcome === "goal" ? 0.05 : 0.08;
          }
          const st = clamp((t - runUp - flightTime) / settle, 0, 1);

          if (o.outcome === "goal") {
            // Bollen sätter sig i nätet, nätet svänger ut och tillbaka
            const bulge = Math.exp(-st * 5.5) * Math.cos(st * 26) * 0.5 + Math.exp(-st * 3.2) * 0.5;
            self._bulgeNet(new THREE.Vector3(targetX, targetY, 0), Math.max(0, bulge));
            self.ball.position.set(
              targetX * (1 - st * 0.28),
              Math.max(BALL_R, targetY - st * st * targetY * 1.15),
              lerp(endZ, -NET_DEPTH * 0.5, st)
            );
            self.ball.rotation.x -= dt * 3;
          } else if (o.outcome === "save") {
            // Bollen slås undan i den riktning målvakten kom ifrån
            const dir = centreDive ? (Math.random() < 0.5 ? -1 : 1) * 0.4 : diveDirX;
            self.ball.position.set(
              diveTo.x + dir * st * 5.2,
              Math.max(BALL_R, diveTo.y + st * 1.2 - st * st * 3.4),
              lerp(diveTo.z, 3.6, st)
            );
            self.ball.rotation.z -= dt * 8 * (dir || 1);
          } else if (o.outcome === "post") {
            const dir = Math.sign(o.tx) || 1;
            self.ball.position.set(
              end.x - dir * st * 3.1,
              Math.max(BALL_R, end.y + st * 0.9 - st * st * 2.6),
              lerp(end.z, 4.2, st)
            );
            self.ball.rotation.y -= dt * 9;
          } else {
            self.ball.position.set(
              lerp(end.x, end.x * 1.5, st),
              Math.max(BALL_R, end.y + st * 1.1 - st * st * 2.2),
              lerp(end.z, end.z - 7, st)
            );
            self.ball.rotation.x -= dt * 6;
          }

          // Skytten står kvar i sin följ-igenom
          poseKick(s, 1);

          // Målvakten landar och sjunker ner mot gräset
          if (centreDive) poseCenterSave(k, 1, diveHigh, null);
          else poseDive(k, 1, diveDirX, diveHigh, null, diveLateral);
          const land = clamp((st - 0.15) / 0.5, 0, 1);
          if (land > 0) {
            k.root.position.y = lerp(k.root.position.y, centreDive ? 0.05 : 0.2, land);
            if (!centreDive) k.root.rotation.z = lerp(k.root.rotation.z, -diveDirX * 1.5, land);
            if (centreDive) k.hips.position.y = lerp(k.hips.position.y, HIP_Y - 0.45, land);
            k.legs.left.knee.rotation.x = lerp(k.legs.left.knee.rotation.x, 0.45, land);
            k.legs.right.knee.rotation.x = lerp(k.legs.right.knee.rotation.x, 0.6, land);
            k.arms.left.elbow.rotation.x = lerp(k.arms.left.elbow.rotation.x, -0.5, land);
            k.arms.right.elbow.rotation.x = lerp(k.arms.right.elbow.rotation.x, -0.5, land);
          }

          if (t >= total) {
            self._anim = null;
            resolve();
          }
        },
      };
    });
  }

  /**
   * Spelar upp slutgesten framför kameran: målgest vid vinst, förlustgest
   * annars. Spelaren bär den egna klubbens färger.
   */
  playEnding(won) {
    const self = this;
    const total = 3.1;
    this.showAim(false);
    const s = this.shooter;
    s.root.visible = true;
    return new Promise((resolve) => {
      self._anim = {
        t: 0,
        t0: null,
        total: total,
        resolve: resolve,
        update() {
          if (this.t0 === null) this.t0 = performance.now();
          this.t = (performance.now() - this.t0) / 1000;
          if (won) poseCelebrate(s, this.t);
          else poseDejected(s, this.t);
          // Poserna nollställer roten, så placeringen sätts efter dem
          s.root.position.z += SPOT_Z - 0.6;
          s.root.rotation.y = 0.28;
          if (this.t >= total) {
            self._anim = null;
            resolve();
          }
        },
      };
    });
  }

  /** Kameran svänger ut för en repris-liknande vinkel. */
  celebrate() {
    this._camGoal.pos.set(-6.4, 2.4, 4.5);
    this._camGoal.target.set(0, 1.1, -0.8);
  }

  /* ---------- Renderloop ---------- */

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.getDelta();
    const loop = () => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      this._frame();
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  _frame() {
    // raw = verklig tid sedan förra bildrutan, dt = samma men tak för att inte
    // få hopp i animationerna om webbläsaren varit borta en stund.
    const raw = Math.min(this.clock.getDelta(), 0.5);
    const dt = Math.min(raw, 0.05);
    this.time += dt;

    if (this._anim) this._anim.update(dt);

    // Kameran glider mjukt mot sitt mål — i verklig tid, så bytet mellan
    // skjut- och målvaktsläge går lika snabbt även på en långsam enhet.
    const k = 1 - Math.pow(0.0004, raw);
    this._cam.pos.lerp(this._camGoal.pos, k);
    this._cam.target.lerp(this._camGoal.target, k);

    let shakeX = 0;
    let shakeY = 0;
    if (this._shake > 0.0005) {
      shakeX = (Math.random() - 0.5) * this._shake;
      shakeY = (Math.random() - 0.5) * this._shake;
      this._shake *= Math.pow(0.02, raw);
    }
    this.camera.position.copy(this._cam.pos);
    this.camera.position.x += shakeX;
    this.camera.position.y += shakeY;
    this.camera.lookAt(this._cam.target);

    if (this.aim.visible) {
      const pulse = 0.9 + Math.sin(this.time * 5) * 0.1;
      this.aim.scale.setScalar(pulse);
    }

    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 450;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.stop();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
    this.renderer.dispose();
  }
}

export const GOAL = { W: GOAL_W, H: GOAL_H };
