#!/usr/bin/env python3
"""Genererar de två filerna som Straffligan behöver ur data.json.

1. straffliga-klubbar.json — namn och distrikt per klubb, för månadens topp 10 på
   startsidan. Hela data.json är 3 MB och alldeles för tungt att ladda där.
   Nyckeln är de 12 första tecknen i klubbens id.

2. api/_klubbar.js — samma klubbar men sökbara på adress-slug ("jamshogs-if"),
   för de klubbsidor som Vercel-funktionerna renderar (api/spela.js, api/og.js).
   Där behövs också emblemets adress och orten.

Kör om när klubbregistret ändras:

    python3 tools/gen-straffliga-klubbar.py

Saknas en klubb i filerna hoppas raden bara över, så en gammal fil gör ingen
skada — den kan bara sakna nytillkomna föreningar.

VIKTIGT: slugen räknas ut på exakt samma sätt i webbläsaren (slugOf i
straffligan.js). Ändras den här måste den ändras där också, annars pekar
delningslänkarna på adresser som inte finns. test-slug.mjs jämför de två.
"""
import json
import os
import re
import unicodedata
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
KEY_LEN = 12


def slugify(name):
    """"Jämshögs IF" -> "jamshogs-if". Samma regler som slugOf() i straffligan.js."""
    s = name.lower()
    for a, b in (("å", "a"), ("ä", "a"), ("ö", "o"), ("é", "e"), ("è", "e"),
                 ("ü", "u"), ("ø", "o"), ("æ", "ae"), ("ü", "u")):
        s = s.replace(a, b)
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def slug_map(clubs):
    """Slug per klubb. Krockar (tre stycken i dag) får id:ts fyra första tecken."""
    grupper = defaultdict(list)
    for c in clubs:
        grupper[slugify(c["name"])].append(c)
    ut = {}
    for bas, lista in grupper.items():
        for c in lista:
            ut[c["id"]] = bas if len(lista) == 1 else bas + "-" + c["id"][:4]
    return ut


def main():
    with open(os.path.join(ROOT, "data.json"), encoding="utf-8") as f:
        data = json.load(f)
    clubs = data["clubs"] if isinstance(data, dict) else data
    se = [c for c in clubs if c.get("country") == "SE"]

    # 1. Liten uppslagsfil för startsidan
    kort = {}
    for c in se:
        kort[c["id"][:KEY_LEN]] = [c["name"], c.get("district") or ""]
    if len(kort) != len(se):
        raise SystemExit(
            "Två klubbar delar de %d första tecknen i id — höj KEY_LEN." % KEY_LEN
        )
    p1 = os.path.join(ROOT, "straffliga-klubbar.json")
    with open(p1, "w", encoding="utf-8") as f:
        json.dump(kort, f, ensure_ascii=False, separators=(",", ":"))

    # 2. Klubbar per slug, för Vercel-funktionerna
    slugs = slug_map(se)
    rader = []
    for c in sorted(se, key=lambda x: slugs[x["id"]]):
        rader.append(
            "  %s: { id: %s, namn: %s, distrikt: %s, ort: %s, emblem: %s },"
            % (
                json.dumps(slugs[c["id"]], ensure_ascii=False),
                json.dumps(c["id"]),
                json.dumps(c["name"], ensure_ascii=False),
                json.dumps(c.get("district") or "", ensure_ascii=False),
                json.dumps(c.get("city") or "", ensure_ascii=False),
                json.dumps(c.get("logo_url") or "", ensure_ascii=False),
            )
        )
    p2 = os.path.join(ROOT, "api", "_klubbar.js")
    os.makedirs(os.path.dirname(p2), exist_ok=True)
    with open(p2, "w", encoding="utf-8") as f:
        f.write(
            "/* Genererad av tools/gen-straffliga-klubbar.py — redigera inte här.\n"
            " *\n"
            " * De svenska föreningarna sökbara på adress-slug, för klubbsidorna som\n"
            " * api/spela.js och api/og.js renderar. Slugen räknas ut på samma sätt i\n"
            " * webbläsaren (slugOf i straffligan.js).\n"
            " */\n\n"
            "export const KLUBBAR = {\n"
            + "\n".join(rader)
            + "\n};\n\n"
            "/** Klubben bakom en adress-slug, eller null. */\n"
            "export function klubbAvSlug(slug) {\n"
            "  if (!slug) return null;\n"
            "  const k = KLUBBAR[String(slug).toLowerCase()];\n"
            "  return k ? Object.assign({ slug: String(slug).toLowerCase() }, k) : null;\n"
            "}\n\n"
            "/** Klubben bakom ett klubb-id, eller null. */\n"
            "export function klubbAvId(id) {\n"
            "  if (!id) return null;\n"
            "  const nycklar = Object.keys(KLUBBAR);\n"
            "  for (let i = 0; i < nycklar.length; i++) {\n"
            "    if (KLUBBAR[nycklar[i]].id === id) {\n"
            "      return Object.assign({ slug: nycklar[i] }, KLUBBAR[nycklar[i]]);\n"
            "    }\n"
            "  }\n"
            "  return null;\n"
            "}\n"
        )

    print(
        "%d föreningar\n  %s (%d kB)\n  %s (%d kB)"
        % (
            len(se),
            os.path.relpath(p1, ROOT),
            os.path.getsize(p1) // 1024,
            os.path.relpath(p2, ROOT),
            os.path.getsize(p2) // 1024,
        )
    )


if __name__ == "__main__":
    main()
