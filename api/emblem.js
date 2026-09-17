/* api/emblem.js — speglar en klubbs emblem med CORS-huvuden.
 *
 * Varför: Straffligan ritar en delningsbild i en canvas, och där måste emblemet
 * med. Svenska Fotbollförbundets bildarkiv (staticcdn.svenskfotboll.se) skickar
 * inga CORS-huvuden, så en canvas som ritat bilden blir "tainted" och går inte
 * att exportera till en PNG. Den här funktionen hämtar bilden på serversidan och
 * skickar den vidare med `Access-Control-Allow-Origin`, vilket gör den läsbar.
 *
 * Bara bildarkivets domäner tillåts, så funktionen inte blir en öppen proxy.
 * Svaren cachas hårt (ett dygn i webbläsaren, ett år i Vercels edge-cache) —
 * emblemen ändras praktiskt taget aldrig.
 */

const ALLOWED_HOSTS = [
  "staticcdn.svenskfotboll.se",
  "static.svenskfotboll.se",
  "media.svenskfotboll.se",
];

const MAX_BYTES = 2 * 1024 * 1024;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const raw = req.query && req.query.url;
  if (!raw || Array.isArray(raw)) {
    res.status(400).json({ fel: "url saknas" });
    return;
  }

  let target;
  try {
    target = new URL(raw);
  } catch (e) {
    res.status(400).json({ fel: "ogiltig url" });
    return;
  }

  if (target.protocol !== "https:" || ALLOWED_HOSTS.indexOf(target.hostname) === -1) {
    res.status(403).json({ fel: "domänen är inte tillåten" });
    return;
  }

  try {
    const svar = await fetch(target.toString(), {
      headers: { "User-Agent": "fotbollskarta.se/straffligan" },
    });
    if (!svar.ok) {
      res.status(502).json({ fel: "bildarkivet svarade " + svar.status });
      return;
    }

    const typ = svar.headers.get("content-type") || "";
    if (typ.indexOf("image/") !== 0) {
      res.status(415).json({ fel: "inte en bild" });
      return;
    }

    const buf = Buffer.from(await svar.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      res.status(413).json({ fel: "bilden är för stor" });
      return;
    }

    res.setHeader("Content-Type", typ);
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=31536000, immutable");
    res.status(200).send(buf);
  } catch (e) {
    res.status(502).json({ fel: "kunde inte hämta bilden" });
  }
}
