/* share-card.js — ritar delningsbilden efter ett straffavgörande.
 *
 * En kvadratisk bild (1080×1080) som funkar i alla flöden: nattarena, de två
 * föreningarnas emblem, resultatet, placeringen i månadens topplista och en
 * uppmaning att hjälpa klubben mot toppen.
 *
 * Emblemen: klubbens riktiga emblem ligger på Svenska Fotbollförbundets
 * bildarkiv, som inte skickar CORS-huvuden. En canvas som ritat en sådan bild
 * går inte att exportera, så emblemet hämtas via /api/emblem (se api/emblem.js)
 * som speglar bilden med rätt huvuden. Finns inte spegeln — eller har klubben
 * inget emblem — används den genererade skölden i stället, och bilden blir lika
 * delbar ändå.
 */

const W = 1080;
const H = 1080;

const GREEN = "#1a7a3c";
const DARK = "#06200f";
const GOLD = "#f5c518";
const CREAM = "#eafcef";

/** Laddar en bild och ger tillbaka null i stället för att kasta. */
function loadImage(src, crossOrigin) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    if (crossOrigin) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Klubbens emblem, redo att ritas i en canvas utan att låsa den.
 * @param {object} club        klubben (logo_url används om den finns)
 * @param {string} fallbackSrc genererad sköld som data-URI
 */
async function crestImage(club, fallbackSrc) {
  if (club.logo_url) {
    const speglad = await loadImage(
      "/api/emblem?url=" + encodeURIComponent(club.logo_url),
      true
    );
    if (speglad) return speglad;
  }
  return loadImage(fallbackSrc, false);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Skriver text som krymper tills den ryms inom maxbredden. */
function fitText(g, text, x, y, maxWidth, size, weight, color) {
  let s = size;
  g.fillStyle = color;
  do {
    g.font = weight + " " + s + "px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    s -= 2;
  } while (g.measureText(text).width > maxWidth && s > 16);
  g.fillText(text, x, y);
  return s;
}

function drawBackground(g) {
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#04150b");
  sky.addColorStop(0.55, "#0b3a1f");
  sky.addColorStop(1, DARK);
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);

  // Flodljus snett ovanifrån
  const lamp = g.createRadialGradient(W * 0.5, -120, 40, W * 0.5, 320, 760);
  lamp.addColorStop(0, "rgba(255, 233, 138, 0.35)");
  lamp.addColorStop(1, "rgba(255, 233, 138, 0)");
  g.fillStyle = lamp;
  g.fillRect(0, 0, W, H);

  // Gräs med klippta ränder, och en mörk list där texten står
  const grass = H - 260;
  g.fillStyle = GREEN;
  g.fillRect(0, grass, W, H - grass);
  g.fillStyle = "rgba(255, 255, 255, 0.05)";
  for (let y = grass; y < H; y += 58) g.fillRect(0, y, W, 28);

  // Mållinje och straffområdesbåge, antytt
  g.strokeStyle = "rgba(255, 255, 255, 0.32)";
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(0, grass + 26);
  g.lineTo(W, grass + 26);
  g.stroke();
  g.beginPath();
  g.arc(W / 2, grass + 26, 132, 0, Math.PI);
  g.stroke();

  // Mörk list så uppmaningen alltid är läsbar
  g.fillStyle = "rgba(4, 21, 11, 0.8)";
  g.fillRect(0, H - 168, W, 168);
  g.strokeStyle = "rgba(245, 197, 24, 0.5)";
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(0, H - 168);
  g.lineTo(W, H - 168);
  g.stroke();

  // Guldram
  g.strokeStyle = "rgba(245, 197, 24, 0.55)";
  g.lineWidth = 8;
  roundRect(g, 18, 18, W - 36, H - 36, 40);
  g.stroke();
}

function drawCrest(g, img, cx, cy, size) {
  if (!img) return;
  const r = size / 2;
  g.save();
  g.fillStyle = "rgba(255, 255, 255, 0.94)";
  g.beginPath();
  g.arc(cx, cy, r + 14, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(245, 197, 24, 0.85)";
  g.lineWidth = 5;
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, r + 8, 0, Math.PI * 2);
  g.clip();
  // Behåll proportionerna — emblemen är ofta breda
  const k = Math.min(size / img.width, size / img.height);
  const w = img.width * k;
  const h = img.height * k;
  g.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  g.restore();
}

/**
 * Ritar delningsbilden.
 * @param {object} o
 *   own, opp        – klubbarna
 *   won             – true vid vinst
 *   score           – "5–4"
 *   rank            – placering i månadens topplista, eller null
 *   monthLabel      – "september 2026"
 *   ownCrest        – genererad sköld (data-URI) som reserv
 *   oppCrest        – samma för motståndaren
 * @returns {Promise<{canvas: HTMLCanvasElement, blob: Blob|null}>}
 */
export async function renderShareCard(o) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d");

  drawBackground(g);

  g.textAlign = "center";
  g.textBaseline = "alphabetic";

  // Rubrik
  g.fillStyle = GOLD;
  g.font = "800 34px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  g.fillText("S T R A F F L I G A N", W / 2, 104);
  g.fillStyle = "rgba(234, 252, 239, 0.75)";
  g.font = "600 26px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  g.fillText("fotbollskarta.se", W / 2, 146);

  // Utfallet
  const banner = o.won ? "VINST!" : "FÖRLUST";
  g.fillStyle = o.won ? "#7ee2a2" : "#ff9a8f";
  g.font = "900 96px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  g.fillText(banner, W / 2, 268);

  // Emblem och resultat
  const [ownImg, oppImg] = await Promise.all([
    crestImage(o.own, o.ownCrest),
    crestImage(o.opp, o.oppCrest),
  ]);
  drawCrest(g, ownImg, 216, 430, 176);
  drawCrest(g, oppImg, W - 216, 430, 176);

  g.fillStyle = "#ffffff";
  g.font = "900 112px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  g.fillText(o.score, W / 2, 470);

  fitText(g, o.own.name, 216, 570, 340, 38, "700", CREAM);
  fitText(g, o.opp.name, W - 216, 570, 340, 38, "700", "rgba(234, 252, 239, 0.8)");

  // Placeringen i månadens topplista
  const box = { x: 90, y: 630, w: W - 180, h: 200 };
  g.fillStyle = "rgba(4, 21, 11, 0.72)";
  roundRect(g, box.x, box.y, box.w, box.h, 28);
  g.fill();
  g.strokeStyle = "rgba(245, 197, 24, 0.45)";
  g.lineWidth = 3;
  roundRect(g, box.x, box.y, box.w, box.h, 28);
  g.stroke();

  if (o.rank) {
    g.fillStyle = "rgba(234, 252, 239, 0.8)";
    g.font = "700 30px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    g.fillText("PLATS I " + String(o.monthLabel || "").toUpperCase(), W / 2, box.y + 60);
    g.fillStyle = GOLD;
    g.font = "900 88px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    g.fillText("#" + o.rank, W / 2, box.y + 152);
  } else {
    fitText(g, "Nu är vi med i månadens topplista", W / 2, box.y + 88, box.w - 60, 40, "700", CREAM);
    g.fillStyle = GOLD;
    g.font = "800 34px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    g.fillText(String(o.monthLabel || "").toUpperCase(), W / 2, box.y + 148);
  }

  // Uppmaning, på den mörka listen
  fitText(g, "Hjälp till att nå toppen!", W / 2, H - 96, W - 200, 54, "900", "#ffffff");
  g.fillStyle = GOLD;
  g.font = "700 30px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  g.fillText("Spela straffar för din förening på fotbollskarta.se", W / 2, H - 48);

  const blob = await new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), "image/png");
    } catch (e) {
      resolve(null); // canvasen är låst (emblem utan CORS) — då delas bara texten
    }
  });

  return { canvas: canvas, blob: blob };
}
