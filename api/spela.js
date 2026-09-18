/* api/spela.js — klubbens egen sida i Straffligan: /spela/<klubb-slug>
 *
 * Varför den finns: när någon delar spelet ser länken likadan ut för alla, och
 * en delning som inte känns som klubbens egen får ingen att trycka. Den här
 * funktionen renderar en liten sida per förening med klubbens namn, emblem och
 * aktuella placering — och, viktigast, egna og-taggar så att förhandsvisningen
 * i Facebook, X, Messenger och WhatsApp visar just den klubben.
 *
 * Statiska sidor hade också fungerat, men då blir det 2 854 filer i repot som
 * måste genereras om varje gång klubbregistret ändras. En funktion med
 * edge-cache ger samma sak och är alltid i synk. (En rewrite per klubb i
 * vercel.json går INTE: taket är 2 048 rutter per deploy.)
 *
 * Adressen kommer från rewriten i vercel.json: /spela/:slug → /api/spela?slug=
 */

import { klubbAvSlug, klubbAvId } from "./_klubbar.js";

const SITE = "https://www.fotbollskarta.se";
const SUPABASE_URL = "https://zltqnzabmrpqvxsxindf.supabase.co";
const SUPABASE_KEY = "sb_publishable_nrmUk-rMVPZEWY3xQnQRqg_RhWUYMIx";

const MANADER = [
  "januari", "februari", "mars", "april", "maj", "juni",
  "juli", "augusti", "september", "oktober", "november", "december",
];

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/** Första dagen i innevarande månad, svensk tid. */
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

function titleCase(s) {
  return String(s || "").toLowerCase().replace(/(^|[\s\-/])([a-zà-ÿ])/g, (m, p, c) => p + c.toUpperCase());
}

/**
 * Klubbens plats och poäng i månadens topplista. Bara id:n som finns i
 * klubbregistret räknas, så testrader inte förskjuter placeringen.
 */
async function manadsplats(klubbId) {
  const url =
    SUPABASE_URL +
    "/rest/v1/straffligan_poang_manad?select=club_id,points,wins,played&manad=eq." +
    manadStart() +
    "&order=points.desc,wins.desc&limit=400";
  try {
    const svar = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY },
      signal: AbortSignal.timeout(2500),
    });
    if (!svar.ok) return null;
    const rader = await svar.json();
    let plats = 0;
    for (const rad of rader || []) {
      if (!klubbAvId(rad.club_id)) continue;
      plats += 1;
      if (rad.club_id === klubbId) {
        return { plats: plats, poang: rad.points || 0, matcher: rad.played || 0 };
      }
    }
  } catch (e) {
    /* Supabase svarar inte — sidan funkar ändå, bara utan placering */
  }
  return null;
}

function sida(klubb, stall, manad) {
  const spelUrl = "/straffligan.html?klubb=" + encodeURIComponent(klubb.id);
  const delaUrl = SITE + "/spela/" + klubb.slug;
  const ogBild = SITE + "/api/og?klubb=" + encodeURIComponent(klubb.slug);
  const ort = klubb.ort ? titleCase(klubb.ort) : "";

  const rubrik = "Spela straffar för " + klubb.namn;
  const beskrivning = stall
    ? klubb.namn + " ligger på plats " + stall.plats + " i Straffligan i " +
      manadNamn(manad) + " med " + stall.poang + " poäng. Vinn ett straffavgörande " +
      "i 3D och hjälp föreningen mot toppen."
    : "Avgör en straffsparkstävling i 3D för " + klubb.namn + " och ta föreningen " +
      "upp i topplistan. Ny topplista varje månad.";

  return `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(rubrik)} | Straffligan på Fotbollskarta</title>
<meta name="description" content="${esc(beskrivning)}" />
<link rel="canonical" href="${esc(delaUrl)}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${esc(delaUrl)}" />
<meta property="og:title" content="${esc(rubrik)}" />
<meta property="og:description" content="${esc(beskrivning)}" />
<meta property="og:image" content="${esc(ogBild)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:site_name" content="Fotbollskarta" />
<meta property="og:locale" content="sv_SE" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(rubrik)}" />
<meta name="twitter:description" content="${esc(beskrivning)}" />
<meta name="twitter:image" content="${esc(ogBild)}" />
<link rel="stylesheet" href="/landing.css" />
<style>
  .klubb-hero { text-align: center; padding: 54px 0 64px; }
  .klubb-crest {
    width: 132px; height: 132px; object-fit: contain; background: #fff;
    border-radius: 50%; padding: 14px; box-shadow: var(--shadow-lg);
    margin-bottom: 20px;
  }
  .klubb-hero h1 { font-size: clamp(1.7rem, 4vw, 2.6rem); margin: 0 0 10px; }
  .klubb-meta { color: #d6f2de; font-size: 0.95rem; margin: 0 0 26px; }
  .klubb-stall {
    display: inline-flex; flex-direction: column; gap: 4px; align-items: center;
    background: rgba(4, 21, 11, 0.5); border: 1px solid rgba(245, 197, 24, 0.5);
    border-radius: 16px; padding: 14px 28px; margin-bottom: 28px;
  }
  .klubb-stall b { font-size: 2rem; color: #ffd94a; line-height: 1; }
  .klubb-stall span { font-size: 0.8rem; letter-spacing: 0.06em; text-transform: uppercase; color: #d6f2de; }
  .klubb-links { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 18px; }
  .klubb-foot { font-size: 0.82rem; color: var(--text-muted); line-height: 1.6; }
</style>
</head>
<body>

<nav class="nav">
  <div class="container">
    <a class="brand-link" href="/index.html"><span class="ball">⚽</span> Fotbollskarta</a>
    <div class="nav-actions">
      <a class="nav-cta nav-map" href="/karta.html">🗺️ Öppna kartan →</a>
    </div>
  </div>
</nav>

<header class="hero klubb-hero">
  <div class="container">
    ${klubb.emblem ? `<img class="klubb-crest" src="/api/emblem?url=${encodeURIComponent(klubb.emblem)}" alt="${esc(klubb.namn)} emblem" width="132" height="132" />` : ""}
    <p class="kicker">Straffligan</p>
    <h1>Spela straffar för ${esc(klubb.namn)}</h1>
    <p class="klubb-meta">${esc([ort, klubb.distrikt].filter(Boolean).join(" · "))}</p>

    ${stall ? `<div class="klubb-stall">
      <span>Plats i ${esc(manadNamn(manad))}</span>
      <b>#${stall.plats}</b>
      <span>${stall.poang} poäng på ${stall.matcher} ${stall.matcher === 1 ? "match" : "matcher"}</span>
    </div>` : `<div class="klubb-stall">
      <span>${esc(manadNamn(manad))}</span>
      <b>Inga poäng än</b>
      <span>Bli först för föreningen</span>
    </div>`}

    <div>
      <a class="btn-primary" href="${esc(spelUrl)}">⚽ Spela för ${esc(klubb.namn)}</a>
    </div>

    <div class="klubb-links">
      <a class="locate-btn" href="/straffligan.html?topplista=manad">🏆 Månadens topplista</a>
      <a class="locate-btn" href="/karta.html">🗺️ ${esc(klubb.namn)} på kartan</a>
    </div>
  </div>
</header>

<section class="block">
  <div class="container prose">
    <h2>Så funkar Straffligan</h2>
    <p>Du skjuter fem straffar och står i mål på fem mot en annan förening, i 3D direkt i webbläsaren. Vinner du får ${esc(klubb.namn)} <strong>+2 poäng</strong> i topplistan, förlorar du kostar det 1 poäng — men en förening kan aldrig hamna under noll. Står det lika efter fem straffar var blir det sudden death.</p>
    <p>Topplistan finns i två versioner: <a href="/straffligan.html?topplista=manad">denna månad</a>, som nollställs den 1:a varje månad, och alla tider. Ju fler i föreningen som spelar, desto högre hamnar ${esc(klubb.namn)}.</p>
    <p class="klubb-foot">Uppgifterna om ${esc(klubb.namn)} kommer från samma klubbregister som <a href="/karta.html">kartan över nordiska fotbollsklubbar</a>. Straffligan är ett spel för skojs skull — resultaten har inget att göra med föreningens riktiga verksamhet. Domarna på plan bokas av föreningar via <a href="https://www.foreningsdomare.se/?utm_source=fotbollskarta&amp;utm_medium=klubbsida&amp;utm_campaign=straffligan" rel="noopener">Föreningsdomare</a>.</p>
  </div>
</section>

<footer>
  <div class="container">
    <p><a href="/index.html">Fotbollskarta</a> · <a href="/straffligan.html">Straffligan</a> · <a href="/karta.html">Kartan</a></p>
  </div>
</footer>

</body>
</html>
`;
}

export default async function handler(req, res) {
  const slug = (req.query && (req.query.slug || req.query.klubb)) || "";
  const klubb = klubbAvSlug(Array.isArray(slug) ? slug[0] : slug);

  if (!klubb) {
    // Okänd slug (t.ex. en klubb som tillkommit sedan _klubbar.js genererades)
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60");
    res.setHeader("Location", "/straffligan.html");
    res.status(307).end();
    return;
  }

  const manad = manadStart();
  const stall = await manadsplats(klubb.id);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Cachas på Vercels edge i fem minuter, så placeringen hinner uppdateras men
  // varje delad länk inte blir ett funktionsanrop.
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=3600");
  res.status(200).send(sida(klubb, stall, manad));
}
