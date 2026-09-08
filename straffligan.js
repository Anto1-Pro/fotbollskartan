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
   Emblem: riktiga när de finns, annars en genererad sköld
   ===================================================================== */

/** Färger ur klubbnamnet — används när emblemet inte kan läsas av. */
function fallbackColors(club) {
  const h = hashOf(club.name || club.id);
  const hue = h % 360;
  const alt = (hue + 150 + (h % 60)) % 360;
  return {
    shirt: hslToHex(hue, 62, 44),
    shorts: (h >> 3) % 3 === 0 ? 0xf2f2f2 : hslToHex(alt, 30, 22),
    socks: hslToHex(hue, 55, 38),
    gloves: hslToHex(alt, 78, 55),
    css: "#" + hslToHex(hue, 62, 44).toString(16).padStart(6, "0"),
    cssAlt: "#" + hslToHex(alt, 55, 34).toString(16).padStart(6, "0"),
  };
}

/** Genererad sköld med klubbens initialer, som data-URI. */
function initialsCrest(club) {
  const c = fallbackColors(club);
  const words = String(club.name || "?")
    .replace(/[()]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 1);
  let ini = words.slice(0, 3).map((w) => w[0].toUpperCase()).join("");
  if (ini.length < 2 && club.name) ini = club.name.slice(0, 2).toUpperCase();
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<path d="M32 2 60 10v26c0 14-12 22-28 26C16 58 4 50 4 36V10z" fill="' + c.css + '" stroke="' + c.cssAlt + '" stroke-width="3"/>' +
    '<path d="M32 2 60 10v10H4V10z" fill="' + c.cssAlt + '" opacity="0.55"/>' +
    '<text x="32" y="42" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" ' +
    'font-size="' + (ini.length > 2 ? 19 : 24) + '" font-weight="bold" fill="#ffffff">' + escapeHtml(ini) + "</text></svg>";
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

/**
 * Försöker läsa ut klubbens färger ur emblemet. Lyckas bara om bildservern
 * tillåter det (CORS) — annars används namnbaserade färger.
 */
function clubColors(club) {
  const fb = fallbackColors(club);
  if (!club.logo_url) return Promise.resolve(fb);
  if (club._colors) return Promise.resolve(club._colors);

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      club._colors = val;
      resolve(val);
    };
    setTimeout(() => finish(fb), 2500);
    img.onerror = () => finish(fb);
    img.onload = () => {
      try {
        const S = 32;
        const cv = document.createElement("canvas");
        cv.width = cv.height = S;
        const g = cv.getContext("2d");
        g.drawImage(img, 0, 0, S, S);
        const d = g.getImageData(0, 0, S, S).data;
        const buckets = {};
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 140) continue;
          const r = d[i];
          const gg = d[i + 1];
          const b = d[i + 2];
          const max = Math.max(r, gg, b);
          const min = Math.min(r, gg, b);
          if (max > 238 && max - min < 22) continue; // nästan vitt
          if (max < 30) continue; // nästan svart
          const key = ((r >> 5) << 10) | ((gg >> 5) << 5) | (b >> 5);
          const bucket = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0, sat: max - min });
          bucket.n++;
          bucket.r += r;
          bucket.g += gg;
          bucket.b += b;
        }
        const list = Object.keys(buckets)
          .map((k) => {
            const b = buckets[k];
            return { n: b.n, sat: b.sat, r: (b.r / b.n) | 0, g: (b.g / b.n) | 0, b: (b.b / b.n) | 0 };
          })
          .sort((a, b) => b.n * (1 + b.sat / 255) - a.n * (1 + a.sat / 255));
        if (!list.length) return finish(fb);
        const hex = (c) => (c.r << 16) | (c.g << 8) | c.b;
        const primary = list[0];
        const secondary = list[1] || { r: 245, g: 245, b: 245 };
        finish({
          shirt: hex(primary),
          shorts: list[1] ? hex(secondary) : 0xf2f2f2,
          socks: hex(primary),
          gloves: fb.gloves,
          css: "#" + hex(primary).toString(16).padStart(6, "0"),
          cssAlt: "#" + hex(secondary).toString(16).padStart(6, "0"),
        });
      } catch (e) {
        finish(fb); // canvas "tainted" — servern tillåter inte avläsning
      }
    };
    img.src = club.logo_url;
  });
}

/* =====================================================================
   Applikationens tillstånd
   ===================================================================== */

const state = {
  clubs: [],          // alla klubbar (för topplistans uppslag)
  byId: {},
  playable: [],       // klubbar man kan välja i spelet
  districts: [],
  pickMode: "own",    // "own" | "opponent"
  own: null,
  opp: null,
  match: null,
  scene: null,
  sceneReady: false,
};

/* =====================================================================
   Skärmhantering
   ===================================================================== */

const SCREENS = ["screenIntro", "screenPick", "screenGame", "screenResult", "screenBoard"];

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
  }));
  state.clubs.forEach((c) => {
    c._search = normalize(c.name + " " + (c.city || "") + " " + (c.municipality || ""));
    state.byId[c.id] = c;
  });

  state.playable = state.clubs
    .filter((c) => c.country === PLAYABLE_COUNTRY)
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));
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
      ? "Sök på klubbnamn eller ort, eller filtrera på distrikt. Poängen du spelar in hamnar på den här föreningen."
      : "Vilken förening ska " + (state.own ? state.own.name : "din klubb") + " möta?";
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
  return state.playable.filter((c) => {
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
    box.innerHTML =
      '<span class="cc-name">' + escapeHtml(c.name) + "</span>" +
      '<span class="cc-where">' +
      escapeHtml([titleCase(c.city) || c.municipality, c.district].filter(Boolean).join(" · ")) +
      "</span>" +
      (pts ? '<span class="cc-pts">' + pts + " p i Straffligan</span>" : "");
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
    openPicker("opponent");
  } else {
    state.opp = club;
    startMatch();
  }
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

  const [homeColors, awayColors] = await Promise.all([clubColors(state.own), clubColors(state.opp)]);
  state.scene.setTeams(homeColors, awayColors);
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
  state.scene.setPhase("idle");
  state.scene.celebrate();
  updateScoreboard();

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
    openPicker("opponent");
  } else if (params.get("topplista") !== null) {
    openBoard();
  }
}

init();
