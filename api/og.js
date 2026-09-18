/* api/og.js — bilden som visas när en klubblänk delas: /api/og?klubb=<slug>
 *
 * Facebook, X, Messenger och WhatsApp läser bara serverns og:image, så en bild
 * som ritas i webbläsaren (share-card.js) kan aldrig hamna i förhandsvisningen.
 * Den här funktionen ritar därför samma sorts kort på servern: klubbens emblem,
 * namn och placering i månadens topplista.
 *
 * Tekniken: SVG som ritas till PNG med resvg (@resvg/resvg-js). Typsnittet
 * måste följa med som fil — resvg har inga systemtypsnitt att låna i Vercels
 * körmiljö — därför fonts/Poppins-*.ttf. Emblemet hämtas på serversidan och
 * bäddas in som data-URI; här finns inga CORS-problem, de gäller bara i
 * webbläsaren.
 */

import { readFileSync } from "fs";
import path from "path";
import { Resvg } from "@resvg/resvg-js";
import { klubbAvSlug, klubbAvId } from "./_klubbar.js";

const W = 1200;
const H = 630;

const SUPABASE_URL = "https://zltqnzabmrpqvxsxindf.supabase.co";
const SUPABASE_KEY = "sb_publishable_nrmUk-rMVPZEWY3xQnQRqg_RhWUYMIx";

const MANADER = [
  "januari", "februari", "mars", "april", "maj", "juni",
  "juli", "augusti", "september", "oktober", "november", "december",
];

// Typsnitten läses en gång per kall start
const FONTS = ["fonts/Poppins-Bold.ttf", "fonts/Poppins-Regular.ttf"].map((f) =>
  path.join(process.cwd(), f)
);

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"'&]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[c]);
}

function manadStart() {
  const bits = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit",
  }).format(new Date()).split("-");
  return bits[0] + "-" + bits[1] + "-01";
}

function manadNamn(iso) {
  const bits = String(iso).split("-");
  return MANADER[Number(bits[1]) - 1] + " " + bits[0];
}

/** Klubbens plats i månadens topplista, eller null. */
async function manadsplats(klubbId) {
  const url =
    SUPABASE_URL +
    "/rest/v1/straffligan_poang_manad?select=club_id,points,wins&manad=eq." +
    manadStart() +
    "&order=points.desc,wins.desc&limit=400";
  try {
    const svar = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY },
      signal: AbortSignal.timeout(2500),
    });
    if (!svar.ok) return null;
    let plats = 0;
    for (const rad of (await svar.json()) || []) {
      if (!klubbAvId(rad.club_id)) continue;
      plats += 1;
      if (rad.club_id === klubbId) return { plats: plats, poang: rad.points || 0 };
    }
  } catch (e) {
    /* utan placering blir kortet lite tommare, det är allt */
  }
  return null;
}

/** Emblemet som data-URI, eller null. Hämtas på servern — inga CORS-regler här. */
async function emblemData(url) {
  if (!url) return null;
  try {
    const svar = await fetch(url, {
      headers: { "User-Agent": "fotbollskarta.se/straffligan" },
      signal: AbortSignal.timeout(2500),
    });
    if (!svar.ok) return null;
    const typ = svar.headers.get("content-type") || "";
    if (typ.indexOf("image/") !== 0) return null;
    const buf = Buffer.from(await svar.arrayBuffer());
    if (buf.length > 1024 * 1024) return null;
    return "data:" + typ.split(";")[0] + ";base64," + buf.toString("base64");
  } catch (e) {
    return null;
  }
}

/** Klubbens initialer, när emblemet inte gick att hämta. */
function initialer(namn) {
  const ord = String(namn || "?").replace(/[()]/g, "").split(/\s+/).filter((w) => w.length > 1);
  let i = ord.slice(0, 3).map((w) => w[0].toUpperCase()).join("");
  if (i.length < 2) i = String(namn || "?").slice(0, 2).toUpperCase();
  return i.slice(0, 3);
}

/** Textstorlek som krymper med namnets längd, så långa klubbnamn får plats. */
function storlek(text, bas, maxBredd) {
  const bredd = String(text).length * bas * 0.54;
  return bredd <= maxBredd ? bas : Math.max(28, Math.floor((bas * maxBredd) / bredd));
}

function svgKort(klubb, emblem, stall, manad) {
  const namnStorlek = storlek(klubb.namn, 72, 900);
  const platsText = stall
    ? "PLATS #" + stall.plats + " I " + manadNamn(manad).toUpperCase()
    : manadNamn(manad).toUpperCase() + " – INGA POÄNG ÄN";
  const under = stall
    ? stall.poang + " poäng i månadens topplista"
    : "Bli först att spela för föreningen";

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="himmel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#04150b"/>
      <stop offset="0.55" stop-color="#0b3a1f"/>
      <stop offset="1" stop-color="#06200f"/>
    </linearGradient>
    <radialGradient id="flodljus" cx="0.5" cy="0" r="0.9">
      <stop offset="0" stop-color="#ffe98a" stop-opacity="0.34"/>
      <stop offset="1" stop-color="#ffe98a" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="rund"><circle cx="196" cy="300" r="104"/></clipPath>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#himmel)"/>
  <rect width="${W}" height="${H}" fill="url(#flodljus)"/>

  <!-- gräs och mållinje -->
  <rect x="0" y="${H - 132}" width="${W}" height="132" fill="#1a7a3c"/>
  <rect x="0" y="${H - 132}" width="${W}" height="30" fill="#ffffff" opacity="0.05"/>
  <rect x="0" y="${H - 72}" width="${W}" height="30" fill="#ffffff" opacity="0.05"/>
  <line x1="0" y1="${H - 120}" x2="${W}" y2="${H - 120}" stroke="#ffffff" stroke-opacity="0.32" stroke-width="4"/>

  <!-- guldram -->
  <rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="28" fill="none" stroke="#f5c518" stroke-opacity="0.5" stroke-width="6"/>

  <!-- emblem -->
  <circle cx="196" cy="300" r="112" fill="#ffffff" fill-opacity="0.95"/>
  <circle cx="196" cy="300" r="112" fill="none" stroke="#f5c518" stroke-opacity="0.85" stroke-width="5"/>
  ${emblem
      ? `<g clip-path="url(#rund)"><image x="92" y="196" width="208" height="208" preserveAspectRatio="xMidYMid meet" xlink:href="${emblem}"/></g>`
      : `<text x="196" y="330" font-family="Poppins" font-weight="bold" font-size="76" fill="#0b3a1f" text-anchor="middle">${esc(initialer(klubb.namn))}</text>`}

  <!-- text -->
  <text x="352" y="150" font-family="Poppins" font-weight="bold" font-size="30" letter-spacing="7" fill="#f5c518">STRAFFLIGAN</text>
  <text x="352" y="196" font-family="Poppins" font-size="27" fill="#eafcef" fill-opacity="0.8">fotbollskarta.se</text>

  <text x="352" y="${namnStorlek > 60 ? 292 : 286}" font-family="Poppins" font-weight="bold" font-size="${namnStorlek}" fill="#ffffff">${esc(klubb.namn)}</text>
  <text x="352" y="340" font-family="Poppins" font-size="30" fill="#eafcef" fill-opacity="0.85">${esc(klubb.distrikt || "Sverige")}</text>

  <rect x="352" y="378" width="${Math.min(760, 44 + platsText.length * 19)}" height="72" rx="36" fill="#f5c518"/>
  <text x="${352 + 30}" y="425" font-family="Poppins" font-weight="bold" font-size="32" fill="#22190a">${esc(platsText)}</text>

  <text x="352" y="492" font-family="Poppins" font-size="29" fill="#eafcef" fill-opacity="0.9">${esc(under)}</text>

  <text x="${W / 2}" y="${H - 44}" font-family="Poppins" font-weight="bold" font-size="34" fill="#ffffff" text-anchor="middle">SPELA STRAFFAR FÖR DIN FÖRENING</text>
</svg>`;
}

export default async function handler(req, res) {
  const q = (req.query && (req.query.klubb || req.query.slug)) || "";
  const slug = Array.isArray(q) ? q[0] : q;
  const klubb = klubbAvSlug(slug) || klubbAvId(slug);

  if (!klubb) {
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60");
    res.setHeader("Location", "/social-share.jpg");
    res.status(307).end();
    return;
  }

  const manad = manadStart();
  const [emblem, stall] = await Promise.all([
    emblemData(klubb.emblem),
    manadsplats(klubb.id),
  ]);

  try {
    const resvg = new Resvg(svgKort(klubb, emblem, stall, manad), {
      font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: "Poppins" },
      fitTo: { mode: "width", value: W },
    });
    const png = resvg.render().asPng();

    res.setHeader("Content-Type", "image/png");
    // Delningsbilder hämtas en gång per länk och plattform, sedan cachar de
    // själva. En timme på edge räcker för att placeringen ska hinna ändras.
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).send(png);
  } catch (e) {
    res.setHeader("Location", "/social-share.jpg");
    res.status(307).end();
  }
}
