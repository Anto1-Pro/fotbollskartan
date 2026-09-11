#!/usr/bin/env python3
"""Genererar straffliga-klubbar.json ur data.json.

Startsidan visar månadens topp 10 i Straffligan. Poängen kommer från Supabase
och innehåller bara klubb-id, så namnen måste komma någon annanstans ifrån.
Hela data.json är 3 MB — alldeles för tungt för startsidan — så den här filen
innehåller bara de svenska föreningarnas namn och distrikt (ca 130 kB, 48 kB
komprimerat).

Nyckeln är de 12 första tecknen i klubbens id, vilket räcker för att skilja alla
föreningar åt och sparar en tredjedel av filen.

Kör om när klubbregistret ändras:

    python3 tools/gen-straffliga-klubbar.py

Saknas en klubb i filen hoppas raden bara över i listan, så en gammal fil gör
ingen skada — den kan bara sakna nytillkomna föreningar.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
KEY_LEN = 12


def main():
    with open(os.path.join(ROOT, "data.json"), encoding="utf-8") as f:
        data = json.load(f)
    clubs = data["clubs"] if isinstance(data, dict) else data

    out = {}
    for c in clubs:
        if c.get("country") != "SE":
            continue
        out[c["id"][:KEY_LEN]] = [c["name"], c.get("district") or ""]

    se = sum(1 for c in clubs if c.get("country") == "SE")
    if len(out) != se:
        raise SystemExit(
            "Två klubbar delar de %d första tecknen i id — höj KEY_LEN." % KEY_LEN
        )

    path = os.path.join(ROOT, "straffliga-klubbar.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("%d föreningar, %d kB -> %s" % (len(out), os.path.getsize(path) // 1024, path))


if __name__ == "__main__":
    main()
