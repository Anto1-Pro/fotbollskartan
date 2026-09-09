/* straffligan.js — Straffligan på Fotbollskarta.
 *
 * Sköter klubbval, straffsparkslogik, kontroller och topplista. 3D-vyn ligger
 * i penalty-scene.js, poänglagringen i score-api.js (window.FKScore).
 */

import { PenaltyScene } from "./penalty-scene.js";

/* =====================================================================
   Konstanter och hjälpfunktioner
   ===================================================================== */

const KICKS_PER_TEAM = 5;
const MAX_CARDS = 60; // hur många klubbkort som ritas åt gången
const PLAYABLE_COUNTRY = "SE"; // spelet börjar med de svenska föreningarna

const COUNTRY_META = {
  SE: { flag: "🇸🇪", label: "Sverige" },
  NO: { flag: "🇳🇴", label: "Norge" },
  DK: { flag: "🇩🇰", label: "Danmark" },
  FI: { flag: "🇫🇮", label: "Finland" },
  IS: { flag: "🇮🇸", label: "Island" },
};

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Normalfördelat slumptal (Box–Muller), för spridning på skotten. */
function gauss() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function titleCase(s) {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/(^|[\s\-/])([a-zà-ÿ])/g, (m, p, c) => p + c.toUpperCase());
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[éè]/g, "e")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stabil pseudoslump ur en sträng — ger varje klubb samma färger varje gång. */
function hashOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x) => Math.round(255 * x);
  return (to(f(0)) << 16) | (to(f(8)) << 8) | to(f(4));
}

/* =====================================================================
   Matchställ och emblem
   ---------------------------------------------------------------------
   Klubbens riktiga färger går INTE att läsa ur emblemet: bildservern
   (staticcdn.svenskfotboll.se) skickar inga CORS-huvuden, så en canvas som
   ritat emblemet blir "tainted" och pixlarna kan inte läsas av. Verifierat i
   riktig webbläsare — bilden laddar utan crossOrigin men inte med.
   Emblemet visas därför som det är, medan lagfärgerna kommer ur en lista av
   riktiga matchställ. Besökaren ställer in sin egen klubbs ställ en gång, och
   valet sparas per förening.
   ===================================================================== */

const KITS = [
  { label: "Blå / vit", shirt: 0x1b4f9c, second: 0xffffff, shorts: 0xf4f4f4, socks: 0x1b4f9c, pattern: "solid" },
  { label: "Blåvit randig", shirt: 0x1b4f9c, second: 0xffffff, shorts: 0xf4f4f4, socks: 0x1b4f9c, pattern: "stripes" },
  { label: "Blå / svart", shirt: 0x163d85, second: 0x121417, shorts: 0x121417, socks: 0x163d85, pattern: "solid" },
  { label: "Marinblå / röd", shirt: 0x172a4d, second: 0xc8102e, shorts: 0x172a4d, socks: 0x172a4d, pattern: "solid" },
  { label: "Ljusblå / marin", shirt: 0x5fa5dd, second: 0x12294c, shorts: 0x12294c, socks: 0x5fa5dd, pattern: "solid" },
  { label: "Röd / vit", shirt: 0xc8102e, second: 0xffffff, shorts: 0xf4f4f4, socks: 0xc8102e, pattern: "solid" },
  { label: "Rödvit randig", shirt: 0xc8102e, second: 0xffffff, shorts: 0x121417, socks: 0xc8102e, pattern: "stripes" },
  { label: "Röd / svart", shirt: 0xc21b2b, second: 0x141618, shorts: 0x141618, socks: 0xc21b2b, pattern: "solid" },
  { label: "Vinröd / grädde", shirt: 0x7c1526, second: 0xf0e6d2, shorts: 0x7c1526, socks: 0x7c1526, pattern: "solid" },
  { label: "Gul / blå", shirt: 0xf3c300, second: 0x143a7b, shorts: 0x143a7b, socks: 0xf3c300, pattern: "solid" },
  { label: "Gul / svart", shirt: 0xf3c300, second: 0x161819, shorts: 0x161819, socks: 0xf3c300, pattern: "solid" },
  { label: "Grön / vit", shirt: 0x11793d, second: 0xffffff, shorts: 0xf4f4f4, socks: 0x11793d, pattern: "solid" },
  { label: "Grönvit randig", shirt: 0x11793d, second: 0xffffff, shorts: 0xf4f4f4, socks: 0x11793d, pattern: "stripes" },
  { label: "Grön / svart", shirt: 0x0d6b35, second: 0x141618, shorts: 0x141618, socks: 0x0d6b35, pattern: "solid" },
  { label: "Svart / vit", shirt: 0x1b1d1f, second: 0xf2f2f2, shorts: 0xf2f2f2, socks: 0x1b1d1f, pattern: "solid" },
  { label: "Svartvit randig", shirt: 0x1b1d1f, second: 0xf2f2f2, shorts: 0x1b1d1f, socks: 0x1b1d1f, pattern: "stripes" },
  { label: "Vit / svart", shirt: 0xf2f2f2, second: 0x1b1d1f, shorts: 0x1b1d1f, socks: 0xf2f2f2, pattern: "solid" },
  { label: "Vit / blå", shirt: 0xf2f2f2, second: 0x1b4f9c, shorts: 0x1b4f9c, socks: 0xf2f2f2, pattern: "solid" },
  { label: "Orange / svart", shirt: 0xe4690f, second: 0x161819, shorts: 0x161819, socks: 0xe4690f, pattern: "solid" },
  { label: "Blå med gult band", shirt: 0x1b4f9c, second: 0xf3c300, shorts: 0x1b4f9c, socks: 0x1b4f9c, pattern: "band" },
  { label: "Röd / vit i halvor", shirt: 0xc8102e, second: 0xf2f2f2, shorts: 0x141618, socks: 0xc8102e, pattern: "halves" },
  { label: "Himmelsblå / vit", shirt: 0x7fc4e8, second: 0xffffff, shorts: 0xf4f4f4, socks: 0x7fc4e8, pattern: "solid" },
];

const KIT_KEY = "fk_straffliga_kit_";

function savedKitIndex(club) {
  try {
    const v = localStorage.getItem(KIT_KEY + club.id);
    if (v === null) return -1;
    const n = parseInt(v, 10);
    return n >= 0 && n < KITS.length ? n : -1;
  } catch (e) {
    return -1;
  }
}

function kitIndexFor(club) {
  const saved = savedKitIndex(club);
  return saved >= 0 ? saved : hashOf(club.name) % KITS.length;
}

function saveKitIndex(club, i) {
  try {
    localStorage.setItem(KIT_KEY + club.id, String(i));
  } catch (e) { /* ignoreras */ }
}

function kitOf(club) {
  return KITS[kitIndexFor(club)];
}

function colorDistance(a, b) {
  const dr = ((a >> 16) & 255) - ((b >> 16) & 255);
  const dg = ((a >> 8) & 255) - ((b >> 8) & 255);
  const db = (a & 255) - (b & 255);
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Motståndarens ställ, men bytt till nästa som syns tydligt mot vårt eget. */
function opponentKit(own, opp) {
  const mine = kitOf(own);
  const base = kitIndexFor(opp);
  for (let i = 0; i < KITS.length; i++) {
    const k = KITS[(base + i) % KITS.length];
    if (colorDistance(k.shirt, mine.shirt) > 95) return k;
  }
  return KITS[base];
}

/** Färgerna som 3D-scenen behöver. */
function sceneColors(club, kit) {
  return {
    shirt: kit.shirt,
    second: kit.second,
    shorts: kit.shorts,
    socks: kit.socks,
    gloves: 0xf4f4f4,
    pattern: kit.pattern,
    seed: hashOf(club.id) % 9973,
  };
}

const hex6 = (c) => "#" + c.toString(16).padStart(6, "0");

/** Genererad sköld med klubbens initialer, som data-URI. */
function initialsCrest(club) {
  const kit = kitOf(club);
  const main = hex6(kit.shirt);
  const alt = hex6(kit.second);
  const words = String(club.name || "?")
    .replace(/[()]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 1);
  let ini = words.slice(0, 3).map((w) => w[0].toUpperCase()).join("");
  if (ini.length < 2 && club.name) ini = club.name.slice(0, 2).toUpperCase();
  const light = colorDistance(kit.shirt, 0xffffff) < 140;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<path d="M32 2 60 10v26c0 14-12 22-28 26C16 58 4 50 4 36V10z" fill="' + main + '" stroke="#1c231f" stroke-width="4" stroke-opacity="0.35"/>' +
    '<path d="M32 2 60 10v26c0 14-12 22-28 26C16 58 4 50 4 36V10z" fill="none" stroke="' + alt + '" stroke-width="2.5"/>' +
    '<path d="M32 2 60 10v10H4V10z" fill="' + alt + '" opacity="0.55"/>' +
    '<text x="32" y="42" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" ' +
    'font-size="' + (ini.length > 2 ? 19 : 24) + '" font-weight="bold" fill="' + (light ? "#1c231f" : "#ffffff") + '">' +
    escapeHtml(ini) + "</text></svg>";
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

/** Liten tröjikon till matchställsvalet. */
function kitShirtSvg(kit) {
  const body = "M22 6 L13 12 L8 30 L17 33 L17 58 L47 58 L47 33 L56 30 L51 12 L42 6 C38 13 26 13 22 6 Z";
  const main = hex6(kit.shirt);
  const alt = hex6(kit.second);
  let overlay = "";
  if (kit.pattern === "stripes") {
    overlay = "";
    for (let i = 0; i < 4; i++) {
      overlay += '<rect x="' + (12 + i * 11) + '" y="0" width="5.5" height="64" fill="' + alt + '"/>';
    }
  } else if (kit.pattern === "band") {
    overlay = '<rect x="0" y="26" width="64" height="13" fill="' + alt + '"/>';
  } else if (kit.pattern === "halves") {
    overlay = '<rect x="32" y="0" width="32" height="64" fill="' + alt + '"/>';
  }
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<defs><clipPath id="c"><path d="' + body + '"/></clipPath></defs>' +
    '<path d="' + body + '" fill="' + main + '"/>' +
    (overlay ? '<g clip-path="url(#c)">' + overlay + "</g>" : "") +
    '<path d="M22 6 C26 13 38 13 42 6 L42 11 C38 17 26 17 22 11 Z" fill="' + alt + '"/>' +
    '<path d="' + body + '" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="2"/>' +
    "</svg>";
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function crestSrc(club) {
  return club.logo_url || initialsCrest(club);
}

/** Sätter emblem på ett <img> och faller tillbaka på skölden om bilden dör. */
function applyCrest(img, club) {
  img.alt = club.name + " emblem";
  img.onerror = function () {
    img.onerror = null;
    img.src = initialsCrest(club);
  };
  img.src = crestSrc(club);
}

/** Avstånd mellan två klubbar i kilometer. */
function distanceKm(a, b) {
  if (a.lat == null || b.lat == null) return null;
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1 > 0 ? a.length - 1 : 0; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/* =====================================================================
   Applikationens tillstånd
   ===================================================================== */

const state = {
  clubs: [],          // alla klubbar (för topplistans uppslag)
  byId: {},
  playable: [],       // klubbar man kan välja i spelet
  shuffled: [],       // samma lista i blandad ordning
  nearby: [],         // motståndarkandidater sorterade efter avstånd
  districts: [],
  pickMode: "own",    // "own" | "opponent"
  kitClub: null,      // klubben vars matchställ visas
  own: null,
  opp: null,
  match: null,
  scene: null,
  sceneReady: false,
};

/* =====================================================================
   Skärmhantering
   ===================================================================== */

const SCREENS = ["screenIntro", "screenPick", "screenKit", "screenGame", "screenResult", "screenBoard"];

function show(id) {
  SCREENS.forEach((s) => $(s).classList.toggle("is-active", s === id));
  document.body.classList.toggle("is-playing", id === "screenGame");
  window.scrollTo(0, 0);
  if (id === "screenGame" && state.scene) {
    requestAnimationFrame(() => {
      state.scene.resize();
      state.scene.start();
    });
  } else if (state.scene) {
    state.scene.stop();
  }
}

/* =====================================================================
   Enkel bekräftelseruta (undviker webbläsarens egen confirm)
   ===================================================================== */

function confirmBox(title, text, okLabel) {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
      "<h3>" + escapeHtml(title) + "</h3>" +
      "<p>" + escapeHtml(text) + "</p>" +
      '<div class="modal-buttons">' +
      '<button type="button" class="btn-ghost" data-no>Fortsätt spela</button>' +
      '<button type="button" class="btn-primary" data-yes>' + escapeHtml(okLabel) + "</button>" +
      "</div></div>";
    document.body.appendChild(back);
    const close = (val) => {
      back.remove();
      resolve(val);
    };
    back.querySelector("[data-no]").onclick = () => close(false);
    back.querySelector("[data-yes]").onclick = () => close(true);
    back.onclick = (e) => {
      if (e.target === back) close(false);
    };
  });
}

/* =====================================================================
   Ladda klubbdata
   ===================================================================== */

async function loadClubs() {
  const res = await fetch("data.json", { cache: "force-cache" });
  if (!res.ok) throw new Error("Kunde inte läsa klubbregistret (" + res.status + ")");
  const raw = await res.json();

  state.clubs = raw.map((c) => ({
    id: c.id,
    name: c.name,
    city: c.city,
    municipality: c.municipality,
    district: c.district || "",
    country: c.country || "SE",
    logo_url: c.logo_url || "",
    lat: typeof c.lat === "number" ? c.lat : null,
    lon: typeof c.lon === "number" ? c.lon : null,
  }));
  state.clubs.forEach((c) => {
    c._search = normalize(c.name + " " + (c.city || "") + " " + (c.municipality || ""));
    state.byId[c.id] = c;
  });

  state.playable = state.clubs.filter((c) => c.country === PLAYABLE_COUNTRY);
  // Blandad ordning, så att det inte alltid är samma klubbar högst upp
  state.shuffled = shuffle(state.playable);
  state.districts = Array.from(new Set(state.playable.map((c) => c.district).filter(Boolean))).sort(
    (a, b) => a.localeCompare(b, "sv")
  );

  const sel = $("districtFilter");
  state.districts.forEach((d) => {
    const o = document.createElement("option");
    o.value = d;
    o.textContent = d;
    sel.appendChild(o);
  });

  // Topplistans landsfilter byggs av alla länder i registret
  const countries = Array.from(new Set(state.clubs.map((c) => c.country))).sort();
  const cs = $("boardCountry");
  countries.forEach((code) => {
    const meta = COUNTRY_META[code] || { flag: "🏳️", label: code };
    const o = document.createElement("option");
    o.value = code;
    o.textContent = meta.flag + " " + meta.label;
    cs.appendChild(o);
  });
}

/* =====================================================================
   Klubbväljaren
   ===================================================================== */

function openPicker(mode) {
  state.pickMode = mode;
  $("pickKicker").textContent = mode === "own" ? "Steg 1 av 2" : "Steg 2 av 2";
  $("pickTitle").textContent = mode === "own" ? "Välj din förening" : "Välj motståndare";
  $("pickSub").textContent =
    mode === "own"
      ? "Sök på klubbnamn eller ort, eller filtrera på distrikt. Listan visar ett blandat urval — poängen du spelar in hamnar på den förening du väljer."
      : "Närmaste föreningarna till " + (state.own ? state.own.name : "din klubb") +
        " visas först, så att det blir ett lokalt derby. Sök om du vill möta någon längre bort.";

  if (mode === "opponent" && state.own) {
    // Sortera motståndarna efter fågelvägen från den egna klubben
    const withDist = state.playable
      .filter((c) => c.id !== state.own.id)
      .map((c) => {
        c._km = distanceKm(state.own, c);
        return c;
      });
    withDist.sort((a, b) => {
      if (a._km == null) return b._km == null ? 0 : 1;
      if (b._km == null) return -1;
      return a._km - b._km;
    });
    state.nearby = withDist;
  }
  $("clubSearch").value = "";
  $("districtFilter").value = "";
  renderClubs();
  show("screenPick");
  $("clubSearch").focus({ preventScroll: true });
}

function filteredClubs() {
  const q = normalize($("clubSearch").value);
  const dist = $("districtFilter").value;
  const terms = q ? q.split(" ") : [];
  const base = state.pickMode === "opponent" && state.nearby.length ? state.nearby : state.shuffled;
  return base.filter((c) => {
    if (dist && c.district !== dist) return false;
    if (state.pickMode === "opponent" && state.own && c.id === state.own.id) return false;
    if (!terms.length) return true;
    return terms.every((t) => c._search.indexOf(t) !== -1);
  });
}

let boardTotals = {};

function renderClubs() {
  const list = filteredClubs();
  const grid = $("clubGrid");
  grid.innerHTML = "";

  const shown = list.slice(0, MAX_CARDS);
  const frag = document.createDocumentFragment();
  shown.forEach((c) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "club-card";
    const img = document.createElement("img");
    img.className = "crest";
    img.loading = "lazy";
    img.width = 40;
    img.height = 40;
    applyCrest(img, c);
    const box = document.createElement("span");
    const pts = boardTotals[c.id] && boardTotals[c.id].points;
    let extra = "";
    if (state.pickMode === "opponent" && c._km != null) {
      extra = '<span class="cc-km">' + (c._km < 1 ? "under 1 km bort" : Math.round(c._km) + " km bort") + "</span>";
    } else if (pts) {
      extra = '<span class="cc-pts">' + pts + " p i Straffligan</span>";
    }
    box.innerHTML =
      '<span class="cc-name">' + escapeHtml(c.name) + "</span>" +
      '<span class="cc-where">' +
      escapeHtml([titleCase(c.city) || c.municipality, c.district].filter(Boolean).join(" · ")) +
      "</span>" +
      extra;
    btn.appendChild(img);
    btn.appendChild(box);
    btn.onclick = () => choose(c);
    frag.appendChild(btn);
  });
  grid.appendChild(frag);

  $("pickCount").textContent =
    list.length === 0
      ? "Inga föreningar matchade sökningen."
      : list.length + (list.length === 1 ? " förening" : " föreningar") +
        (list.length > MAX_CARDS ? " – visar de " + MAX_CARDS + " första" : "");
  $("pickMore").hidden = list.length <= MAX_CARDS;
}

function choose(club) {
  if (state.pickMode === "own") {
    state.own = club;
    try {
      localStorage.setItem("fk_straffliga_club", club.id);
    } catch (e) { /* ignoreras */ }
    // Har klubben inget matchställ valt än får besökaren välja det en gång
    if (savedKitIndex(club) < 0) openKit(club);
    else openPicker("opponent");
  } else {
    state.opp = club;
    startMatch();
  }
}

/* =====================================================================
   Matchställsväljaren
   ===================================================================== */

function openKit(club) {
  state.kitClub = club;
  $("kitTitle").textContent = "Vilka färger spelar " + club.name + " i?";
  $("kitClubName").textContent = club.name;
  applyCrest($("kitCrest"), club);

  const grid = $("kitGrid");
  grid.innerHTML = "";
  const current = kitIndexFor(club);
  KITS.forEach((kit, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "kit-card" + (i === current ? " is-picked" : "");
    btn.innerHTML =
      '<img src="' + kitShirtSvg(kit) + '" alt="" width="56" height="56" />' +
      '<span>' + escapeHtml(kit.label) + "</span>";
    btn.onclick = () => {
      saveKitIndex(club, i);
      Array.prototype.forEach.call(grid.children, (el) => el.classList.remove("is-picked"));
      btn.classList.add("is-picked");
      applyCrest($("kitCrest"), club); // skölden följer färgerna om emblem saknas
    };
    grid.appendChild(btn);
  });

  // Har klubben inget val sparat ännu räknas förslaget som valt
  if (savedKitIndex(club) < 0) saveKitIndex(club, current);
  show("screenKit");
}

/* =====================================================================
   Straffsparkstävlingen
   ===================================================================== */

function newMatch() {
  return {
    kicks: [],            // { team: "home"|"away", scored: bool }
    homeScore: 0,
    awayScore: 0,
    index: 0,             // vilken spark i ordningen som är näst
    aimHistory: [],       // spelarens siktade kolumner, målvakts-AI:n lär sig
    over: false,
    won: null,
    suddenDeath: false,
  };
}

const kicksBy = (m, team) => m.kicks.filter((k) => k.team === team).length;

/** Hur många sparkar laget har kvar, inklusive pågående sudden death-omgång. */
function remainingFor(mine, theirs) {
  if (mine < KICKS_PER_TEAM) return KICKS_PER_TEAM - mine;
  return theirs > mine ? 1 : 0;
}

/** Är tävlingen avgjord? Returnerar "home", "away" eller null. */
function decidedWinner(m) {
  const hk = kicksBy(m, "home");
  const ak = kicksBy(m, "away");
  const hRem = remainingFor(hk, ak);
  const aRem = remainingFor(ak, hk);
  if (m.homeScore > m.awayScore + aRem) return "home";
  if (m.awayScore > m.homeScore + hRem) return "away";
  return null;
}

function currentTeam(m) {
  return m.index % 2 === 0 ? "home" : "away";
}

function roundNumber(m) {
  return Math.floor(m.index / 2) + 1;
}

async function startMatch() {
  state.match = newMatch();
  const m = state.match;

  $("sbHomeName").textContent = state.own.name;
  $("sbAwayName").textContent = state.opp.name;
  applyCrest($("sbHomeCrest"), state.own);
  applyCrest($("sbAwayCrest"), state.opp);
  updateScoreboard();

  window.FKScore.matchStarted(state.own.id, state.opp.id);

  show("screenGame");
  $("stageLoading").hidden = false;

  if (!state.scene) {
    try {
      state.scene = new PenaltyScene($("pitch"));
      state.sceneReady = true;
    } catch (e) {
      $("stageLoading").innerHTML =
        "Din webbläsare kunde inte starta 3D-vyn (WebGL). Prova en annan webbläsare eller enhet.";
      return;
    }
  }
  state.scene.resize();
  state.scene.start();

  state.scene.setTeams(
    sceneColors(state.own, kitOf(state.own)),
    sceneColors(state.opp, opponentKit(state.own, state.opp))
  );
  $("stageLoading").hidden = true;

  nextKick();
}

function updateScoreboard() {
  const m = state.match;
  $("sbHomeScore").textContent = m.homeScore;
  $("sbAwayScore").textContent = m.awayScore;

  const hk = kicksBy(m, "home");
  const ak = kicksBy(m, "away");
  const r = roundNumber(m);
  $("sbRound").textContent = m.suddenDeath
    ? "Sudden death – omgång " + (r - KICKS_PER_TEAM)
    : "Straff " + Math.min(r, KICKS_PER_TEAM) + " av " + KICKS_PER_TEAM;

  const draw = (rowId, team) => {
    const row = $(rowId);
    row.innerHTML = "";
    const taken = m.kicks.filter((k) => k.team === team);
    const total = Math.max(KICKS_PER_TEAM, taken.length + (currentTeam(m) === team && !m.over ? 1 : 0));
    for (let i = 0; i < total; i++) {
      const d = document.createElement("span");
      d.className = "dot";
      if (i < taken.length) d.classList.add(taken[i].scored ? "is-goal" : "is-miss");
      else if (i === taken.length && currentTeam(m) === team && !m.over) d.classList.add("is-next");
      row.appendChild(d);
    }
  };
  draw("dotsHome", "home");
  draw("dotsAway", "away");
}

/* ---------- Rutorna i målet ---------- */

function zoneOf(tx, ty) {
  return {
    col: tx < -0.34 ? -1 : tx > 0.34 ? 1 : 0,
    row: ty >= 0.5 ? 1 : 0,
  };
}

/**
 * Sannolikheten att målvakten räddar, givet var skottet gick, vart målvakten
 * kastade sig och hur hårt det var.
 */
function saveProbability(shot, dive, power) {
  const dc = Math.abs(shot.zone.col - dive.col);
  const dr = Math.abs(shot.zone.row - dive.row);
  let p;
  if (dc === 0 && dr === 0) p = 0.68;        // rätt ruta
  else if (dc === 1 && dr === 0) p = 0.15;   // grannruta i sidled
  else if (dc === 0 && dr === 1) p = 0.11;   // rätt sida, fel höjd
  else if (dc === 1 && dr === 1) p = 0.05;   // snett intill
  else p = 0.015;                            // helt fel sida
  p *= 1 - 0.42 * power;                     // hårda skott är svårare
  p *= 1 - 0.22 * clamp(Math.abs(shot.tx) / 0.95, 0, 1); // välplacerat nära stolpen
  return clamp(p, 0.004, 0.92);
}

/** Var skottet faktiskt hamnar, efter spridning som växer med kraften. */
function resolveShot(aimX, aimY, power) {
  const spread = 0.045 + 0.34 * Math.max(0, power - 0.5) / 0.5;
  const tx = aimX + gauss() * spread;
  const ty = clamp(aimY + gauss() * spread * 0.62, -0.04, 1.7);

  let outcome = null;
  const insideX = Math.abs(tx) <= 0.985;
  const insideY = ty <= 0.985 && ty > 0.005;
  if (Math.abs(tx) > 0.985 && Math.abs(tx) < 1.045) outcome = "post";
  else if (ty > 0.985 && ty < 1.05 && Math.abs(tx) <= 1.02) outcome = "post";
  else if (!insideX || !insideY) outcome = "miss";

  return { tx, ty, power, outcome, zone: zoneOf(tx, ty) };
}

/** Målvakts-AI: mest slumpmässig, men straffar den som skjuter i samma hörn. */
function aiDive(m) {
  const cols = [-1, 0, 1];
  const weights = [0.37, 0.26, 0.37]; // mitten lite mer sällan, som i verkligheten
  let col;
  const recent = m.aimHistory.slice(-3);
  if (recent.length >= 2 && Math.random() < 0.34) {
    // Har spelaren siktat i samma sida flera gånger går målvakten dit
    const counts = { "-1": 0, "0": 0, "1": 0 };
    recent.forEach((c) => counts[c]++);
    const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    col = counts[best] >= 2 ? parseInt(best, 10) : cols[weightedIndex(weights)];
  } else {
    col = cols[weightedIndex(weights)];
  }
  return { col, row: Math.random() < 0.42 ? 1 : 0 };
}

function weightedIndex(w) {
  const sum = w.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < w.length; i++) {
    r -= w[i];
    if (r <= 0) return i;
  }
  return w.length - 1;
}

/** Motståndarskyttens val av hörn och kraft. */
function aiShot() {
  const cols = [-1, 0, 1];
  const col = cols[weightedIndex([0.36, 0.28, 0.36])];
  const row = Math.random() < 0.34 ? 1 : 0;
  const aimX = col * (0.55 + Math.random() * 0.32);
  const aimY = row ? 0.62 + Math.random() * 0.3 : 0.14 + Math.random() * 0.26;
  const power = 0.5 + Math.random() * 0.45;
  return { aimX, aimY, power };
}

/* ---------- Turordning ---------- */

function nextKick() {
  const m = state.match;
  const winner = decidedWinner(m);
  if (winner) return finishMatch(winner === "home");

  if (kicksBy(m, "home") >= KICKS_PER_TEAM && kicksBy(m, "away") >= KICKS_PER_TEAM) {
    m.suddenDeath = true;
  }
  updateScoreboard();

  if (currentTeam(m) === "home") setupPlayerShot();
  else setupPlayerSave();
}

/* ---------- Spelaren skjuter ---------- */

const ui = {
  aim: null,
  power: 0,
  powerDir: 1,
  powerRaf: null,
  locked: false,
  busy: false,
};

function stopPowerBar() {
  if (ui.powerRaf) cancelAnimationFrame(ui.powerRaf);
  ui.powerRaf = null;
}

function runPowerBar() {
  stopPowerBar();
  ui.power = 0.15;
  ui.powerDir = 1;
  let last = performance.now();
  const step = (now) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    ui.power += ui.powerDir * dt * 1.15;
    if (ui.power >= 1) {
      ui.power = 1;
      ui.powerDir = -1;
    } else if (ui.power <= 0.12) {
      ui.power = 0.12;
      ui.powerDir = 1;
    }
    $("powerMarker").style.left = (ui.power * 100).toFixed(1) + "%";
    ui.powerRaf = requestAnimationFrame(step);
  };
  ui.powerRaf = requestAnimationFrame(step);
}

function setupPlayerShot() {
  const m = state.match;
  ui.busy = false;
  ui.aim = null;
  state.scene.setPhase("shoot");
  state.scene.resetBall();
  state.scene.showAim(false);
  stopPowerBar();

  $("zonePicker").hidden = true;
  $("powerWrap").hidden = true;
  $("controlHint").textContent = m.suddenDeath
    ? "Sudden death – tryck i målet för att sikta."
    : "Din straff. Tryck i målet för att sikta.";
  const b = $("btnAction");
  b.disabled = true;
  b.textContent = "Sikta först";
  b.onclick = null;
}

function onCanvasAim(ev) {
  if (ui.busy || state.match.over) return;
  if (currentTeam(state.match) !== "home") return;
  // Vänta in kamerabytet, annars pekar strålen från fel läge
  if (!state.scene.cameraSettled()) return;
  const pt = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
  const hit = state.scene.pickAim(pt.clientX, pt.clientY);
  if (!hit) return;
  ui.aim = hit;
  state.scene.setAim(hit.tx, hit.ty);
  state.scene.showAim(true);

  $("powerWrap").hidden = false;
  runPowerBar();
  $("controlHint").textContent = "Tryck igen i målet för att flytta siktet – eller skjut.";
  const b = $("btnAction");
  b.disabled = false;
  b.textContent = "⚽ Skjut!";
  b.onclick = doPlayerShot;
}

async function doPlayerShot() {
  if (ui.busy || !ui.aim) return;
  ui.busy = true;
  const m = state.match;
  const power = ui.power;
  stopPowerBar();
  $("powerWrap").hidden = true;
  $("btnAction").disabled = true;
  $("btnAction").textContent = "Skjuter…";
  $("controlHint").textContent = "";

  m.aimHistory.push(zoneOf(ui.aim.tx, ui.aim.ty).col);

  const shot = resolveShot(ui.aim.tx, ui.aim.ty, power);
  const dive = aiDive(m);

  let outcome = shot.outcome;
  if (!outcome) {
    outcome = Math.random() < saveProbability(shot, dive, power) ? "save" : "goal";
  }

  await state.scene.playShot({
    tx: shot.tx,
    ty: shot.ty,
    power: power,
    curve: (ui.aim.tx - shot.tx) * 0.8,
    keeperZone: dive,
    outcome: outcome,
  });

  await registerKick("home", outcome);
}

/* ---------- Spelaren står i mål ---------- */

function setupPlayerSave() {
  const m = state.match;
  ui.busy = false;
  state.scene.setPhase("save");
  state.scene.resetBall();
  state.scene.showAim(false);
  stopPowerBar();

  $("powerWrap").hidden = true;
  $("zonePicker").hidden = false;
  $("controlHint").textContent = m.suddenDeath
    ? "Sudden death – rädda den här och du vinner."
    : state.opp.name + " skjuter. Välj hörn innan bollen är på väg.";
  const b = $("btnAction");
  b.disabled = true;
  b.textContent = "Välj hörn ovan";
  b.onclick = null;
}

async function doPlayerSave(screenCol, row) {
  if (ui.busy) return;
  ui.busy = true;
  $("zonePicker").hidden = true;
  $("controlHint").textContent = "";

  // Knapparna är märkta efter hur det ser ut i bild; scenen säger åt vilket
  // håll världens x-axel pekar just nu, så vänster alltid blir vänster.
  const dive = { col: screenCol * state.scene.worldXScreenSign(), row: row };
  const a = aiShot();
  const shot = resolveShot(a.aimX, a.aimY, a.power);

  let outcome = shot.outcome;
  if (!outcome) {
    outcome = Math.random() < saveProbability(shot, dive, a.power) ? "save" : "goal";
  }

  await state.scene.playShot({
    tx: shot.tx,
    ty: shot.ty,
    power: a.power,
    curve: (a.aimX - shot.tx) * 0.8,
    keeperZone: dive,
    outcome: outcome,
  });

  await registerKick("away", outcome);
}

/* ---------- Efter varje straff ---------- */

const OUTCOME_TEXT = {
  goal: { text: "MÅL!", cls: "is-goal" },
  save: { text: "RÄDDNING!", cls: "is-save" },
  miss: { text: "UTANFÖR!", cls: "is-miss" },
  post: { text: "STOLPEN!", cls: "is-miss" },
};

async function registerKick(team, outcome) {
  const m = state.match;
  const scored = outcome === "goal";
  m.kicks.push({ team: team, scored: scored });
  if (scored) {
    if (team === "home") m.homeScore++;
    else m.awayScore++;
  }
  m.index++;
  updateScoreboard();

  // Utfallstexten – "MÅL!" är bra för dig när du skjuter, dåligt när du står i mål
  const o = OUTCOME_TEXT[outcome] || OUTCOME_TEXT.goal;
  const box = $("outcome");
  box.className = "outcome " + (team === "home" ? o.cls : scored ? "is-miss" : "is-goal");
  $("outcomeText").textContent = o.text;
  box.hidden = false;
  await sleep(1250);
  box.hidden = true;

  nextKick();
}

/* ---------- Slut ---------- */

async function finishMatch(won) {
  const m = state.match;
  m.over = true;
  m.won = won;
  stopPowerBar();
  updateScoreboard();
  $("zonePicker").hidden = true;
  $("powerWrap").hidden = true;
  $("btnAction").disabled = true;
  $("btnAction").textContent = won ? "Vinst!" : "Förlust";
  $("controlHint").textContent = "";

  // Slutgest framför kameran: målgest vid vinst, förlustgest vid förlust
  state.scene.setPhase("ending");
  const box = $("outcome");
  box.className = "outcome " + (won ? "is-goal" : "is-miss");
  $("outcomeText").textContent = won ? "VINST!" : "FÖRLUST";
  box.hidden = false;
  await state.scene.playEnding(won);
  box.hidden = true;

  await window.FKScore.reportResult(state.own.id, state.opp.id, won).catch(() => {});
  await showResult(won ? "win" : "loss");
}

async function abandonMatch() {
  const ok = await confirmBox(
    "Avbryta straffavgörandet?",
    "Om du avbryter nu räknas det som förlust och " + state.opp.name + " får poängen.",
    "Avbryt matchen"
  );
  if (!ok) return;
  state.match.over = true;
  stopPowerBar();
  await window.FKScore.reportAbandon(state.own.id, state.opp.id).catch(() => {});
  await showResult("abandon");
}

async function showResult(kind) {
  const m = state.match;
  const card = $("resultCard");
  card.classList.toggle("is-win", kind === "win");
  card.classList.toggle("is-loss", kind !== "win");

  $("resultTitle").textContent =
    kind === "win"
      ? "Ni vann straffavgörandet!"
      : kind === "abandon"
      ? "Matchen avbröts"
      : "Ni förlorade straffavgörandet";
  $("resultKicker").textContent = m.suddenDeath ? "Straffligan · avgjort i sudden death" : "Straffligan";
  $("resScore").textContent = m.homeScore + "–" + m.awayScore;
  $("resHomeName").textContent = state.own.name;
  $("resAwayName").textContent = state.opp.name;
  applyCrest($("resHomeCrest"), state.own);
  applyCrest($("resAwayCrest"), state.opp);

  $("resultPoints").textContent =
    kind === "win"
      ? "+1 poäng till " + state.own.name
      : "+1 poäng till " + state.opp.name +
        (kind === "abandon" ? " (avbrott räknas som förlust)" : "");

  const stats = await window.FKScore.statsFor(state.own.id).catch(() => null);
  $("resultStanding").textContent = stats
    ? state.own.name + " har nu " + stats.points + (stats.points === 1 ? " poäng" : " poäng") +
      " på " + stats.played + (stats.played === 1 ? " match" : " matcher") + " i Straffligan."
    : "";

  show("screenResult");
}

/* =====================================================================
   Topplistan
   ===================================================================== */

async function renderBoard() {
  const rows = await window.FKScore.leaderboard().catch(() => []);
  boardTotals = {};
  rows.forEach((r) => (boardTotals[r.clubId] = r));

  const country = $("boardCountry").value;
  const district = $("boardDistrict").value;
  const mine = state.own ? state.own.id : localStorage.getItem("fk_straffliga_club");

  const visible = rows.filter((r) => {
    const c = state.byId[r.clubId];
    if (!c) return false;
    if (country && c.country !== country) return false;
    if (district && c.district !== district) return false;
    return true;
  });

  const body = $("boardBody");
  body.innerHTML = "";
  visible.forEach((r, i) => {
    const c = state.byId[r.clubId];
    const tr = document.createElement("tr");
    if (c.id === mine) tr.className = "is-you";
    const meta = COUNTRY_META[c.country] || { flag: "🏳️" };
    tr.innerHTML =
      '<td class="c-rank">' + (i + 1) + "</td>" +
      '<td class="c-club"><span class="board-club"><img alt="" width="28" height="28" /><b>' +
      escapeHtml(c.name) + "</b></span></td>" +
      '<td class="c-dist">' + meta.flag + " " + escapeHtml(c.district || "–") + "</td>" +
      '<td class="c-num">' + r.played + "</td>" +
      '<td class="c-num">' + r.wins + "</td>" +
      '<td class="c-num">' + r.losses + "</td>" +
      '<td class="c-num c-pts">' + r.points + "</td>";
    applyCrest(tr.querySelector("img"), c);
    body.appendChild(tr);
  });

  $("boardEmpty").hidden = visible.length > 0;
  const legend = "S = spelade, V = vunna, F = förlorade, P = poäng.";
  $("boardNote").textContent =
    window.FKScore.backend() === "local"
      ? legend +
        " Poängen sparas just nu i din egen webbläsare, så topplistan visar dina egna matcher. När sidan kopplas mot en gemensam databas blir listan delad mellan alla besökare."
      : legend;
}

function fillBoardDistricts() {
  const country = $("boardCountry").value;
  const sel = $("boardDistrict");
  const current = sel.value;
  const pool = country ? state.clubs.filter((c) => c.country === country) : state.clubs;
  const list = Array.from(new Set(pool.map((c) => c.district).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "sv")
  );
  sel.innerHTML = '<option value="">Alla distrikt</option>';
  list.forEach((d) => {
    const o = document.createElement("option");
    o.value = d;
    o.textContent = d;
    sel.appendChild(o);
  });
  if (list.indexOf(current) !== -1) sel.value = current;
  sel.disabled = list.length === 0;
}

/* =====================================================================
   Start
   ===================================================================== */

function bindEvents() {
  $("btnStart").onclick = () => openPicker("own");
  $("btnChangeClub").onclick = () => openPicker("own");
  $("btnChangeKit").onclick = () => state.own && openKit(state.own);
  $("btnKitBack").onclick = () => openPicker("own");
  $("btnKitDone").onclick = () => openPicker("opponent");
  $("btnToBoard").onclick = openBoard;
  $("btnResultBoard").onclick = openBoard;
  $("btnBoardBack").onclick = () => show(state.own ? "screenResult" : "screenIntro");
  $("btnBoardPlay").onclick = () => openPicker(state.own ? "opponent" : "own");
  $("btnPickBack").onclick = () => (state.pickMode === "opponent" ? openPicker("own") : show("screenIntro"));
  $("btnAgain").onclick = () => openPicker("opponent");
  $("btnQuit").onclick = abandonMatch;

  let searchTimer = null;
  $("clubSearch").oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderClubs, 120);
  };
  $("districtFilter").onchange = renderClubs;
  $("btnRandom").onclick = () => {
    const list = filteredClubs();
    if (!list.length) return;
    choose(list[(Math.random() * list.length) | 0]);
  };

  $("boardCountry").onchange = () => {
    fillBoardDistricts();
    renderBoard();
  };
  $("boardDistrict").onchange = renderBoard;

  const canvas = $("pitch");
  canvas.addEventListener("click", onCanvasAim);
  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    onCanvasAim(e);
  }, { passive: false });

  document.querySelectorAll(".zone-grid button").forEach((b) => {
    b.onclick = () => doPlayerSave(parseInt(b.dataset.col, 10), parseInt(b.dataset.row, 10));
  });

  window.addEventListener("resize", () => {
    if (state.scene) state.scene.resize();
  });
}

async function openBoard() {
  fillBoardDistricts();
  await renderBoard();
  show("screenBoard");
}

async function init() {
  bindEvents();

  // En match som aldrig spelades färdigt (stängd flik) bokförs som förlust
  const abandoned = await window.FKScore.settleAbandoned().catch(() => null);

  try {
    await loadClubs();
  } catch (e) {
    $("screenIntro").insertAdjacentHTML(
      "afterbegin",
      '<p style="text-align:center;padding:20px;color:#b8352c">Kunde inte läsa klubbregistret. Ladda om sidan eller gå till <a href="karta.html">kartan</a>.</p>'
    );
    return;
  }

  const rows = await window.FKScore.leaderboard().catch(() => []);
  boardTotals = {};
  rows.forEach((r) => (boardTotals[r.clubId] = r));

  // Kom ihåg vilken förening besökaren spelade för sist
  try {
    const saved = localStorage.getItem("fk_straffliga_club");
    if (saved && state.byId[saved] && state.byId[saved].country === PLAYABLE_COUNTRY) {
      state.own = state.byId[saved];
      $("btnStart").textContent = "⚽ Spela för " + state.own.name;
      $("btnStart").onclick = () => openPicker("opponent");
      $("btnChangeClub").hidden = false;
      $("btnChangeKit").hidden = false;
    }
  } catch (e) { /* ignoreras */ }

  if (abandoned && state.byId[abandoned.opp]) {
    const note = document.createElement("p");
    note.className = "abandon-note";
    note.textContent =
      "Din förra match spelades inte färdigt, så " + state.byId[abandoned.opp].name + " fick poängen.";
    $("screenIntro").querySelector(".straff-hero .container").appendChild(note);
  }

  // Djuplänk: straffligan.html?klubb=<id> hoppar direkt till motståndarvalet
  const params = new URLSearchParams(location.search);
  const deep = params.get("klubb");
  if (deep && state.byId[deep] && state.byId[deep].country === PLAYABLE_COUNTRY) {
    state.own = state.byId[deep];
    try {
      localStorage.setItem("fk_straffliga_club", state.own.id);
    } catch (e) { /* ignoreras */ }
    $("btnStart").textContent = "⚽ Spela för " + state.own.name;
    $("btnStart").onclick = () => openPicker("opponent");
    $("btnChangeClub").hidden = false;
    $("btnChangeKit").hidden = false;
    openPicker("opponent");
  } else if (params.get("topplista") !== null) {
    openBoard();
  }
}

init();
