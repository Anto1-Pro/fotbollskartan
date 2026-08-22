# Fotbollskartan

En självständig, statisk webbsida med en interaktiv karta över svenska fotbollsklubbar (Leaflet + OpenStreetMap).

## Innehåll

- `index.html` – landningssidan (förklarar syftet, länkar vidare till kartan)
- `karta.html` – själva kartan
- `landing.css` – utseende för landningssidan
- `app.js` – all logik för kartan (sök, distriktsfilter, popups)
- `styles.css` – utseende för kartan
- `data.json` – alla ~2850 klubbar (namn, adress, telefon, e-post, hemsida, distrikt, loggo-URL, koordinater, `has_youth`)
- `vendor/` – Leaflet och Leaflet.markercluster (medskickade, ingen extern CDN krävs)

## Köra lokalt

Öppna inte filerna direkt via `file://` (webbläsaren blockerar då `fetch("data.json")` på kartsidan). Starta istället en enkel lokal server i mappen:

```
python3 -m http.server 8000
```

och besök `http://localhost:8000/`.

## Hosta live (gratis alternativ)

- **GitHub Pages**: skapa ett repo, lägg in filerna i `site/`-mappen (eller roten), aktivera Pages i repots inställningar.
- **Netlify / Vercel**: dra och släpp mappen på netlify.com/drop, eller koppla ett GitHub-repo.
- Sidan är helt statisk (inga servrar eller databaser krävs).

## Uppdatera klubbdata / lägga till loggor

Allt klubbdata ligger i `data.json` – en JSON-lista med ett objekt per klubb. Varje klubb har fältet `logo_url`. Sätt om ett fält om du vill peka på en egen bild (t.ex. en URL till en uppladdad logga), spara filen igen. Sidan läser om `data.json` vid varje sidladdning, ingen ombyggnad krävs.

Om ni vill uppdatera hela registret (nya klubbar, ändrade adresser) från en ny Excel-export: hör av er, så uppdaterar jag `data.json` utifrån den nya filen.

## Klubbar med och utan ungdomsverksamhet

Registret innehåller två grupper av klubbar, skilda åt med fältet `has_youth`:

- **1889 klubbar med barn-/ungdomsverksamhet** (`has_youth: true`) – det ursprungliga registret.
- **961 klubbar med enbart seniorverksamhet** (`has_youth: false`) – tillagda i en senare omgång (runda 6) från SvFF:s fullständiga klubblista. Dessa klumpas inte ihop med ungdomsklubbarna: ungdomsfiltret (`state.youthOnly` i `app.js`) utesluter alla klubbar där `has_youth` inte är sant, så filtreringen fungerar precis som innan för den ursprungliga gruppen.

Varje ny klubb har fått distrikt/`association_id` kopplat utifrån sin adress (samma `district_by_prefix`-logik som resten av registret), så de dyker upp korrekt i distriktsfiltret tillsammans med de befintliga klubbarna. 4 klubbar (`FC Tolkarna`, `Husqvarna IF`, `Kalmarpolisens IF`, `Vasastans BK`) saknade helt adress/postnummer/ort i källdatan och kunde inte placeras automatiskt – se `round6_unplaceable.csv` i projektmappen för manuell uppföljning.

## Kända begränsningar

- **Positionering**: klubbarna är geokodade från sin gatuadress via OpenStreetMap (Nominatim). Ca 83% (1564/1889) matchar den faktiska adressen eller en identifierad anläggning/plan (`geo_source`: `osm_address`, `osm_address_freetext`, `researched_osm_verified`, `researched_coords`, `researched_local_script`, `researched_local_script_v2`, `researched_local_script_v3`, `researched_local_script_v4` eller `researched_manual_v5`). Ytterligare ca 2% (30) är en anläggningsgissning på stadsnivå (`researched_local_script_v4_city_guess`, t.ex. "Malmö IP") i orter med flera registrerade klubbar - dessa har lägre konfidens och kan i enstaka fall peka på fel anläggning om orten har flera planer. Resterande ca 16% (295) landar på postnummer- eller ortnivå (`osm_postal`/`osm_city`) när adressen varit ofullständig (t.ex. en postbox). Samtliga 1889 klubbar (ungdomsverksamhet) har nu antingen en bekräftad adress/anläggning eller en trygg postnummerposition - ingen står längre på en misstänkt/overifierad position. Se `sanity_check_geo.py` för rimlighetskontrollen.

  För de 961 seniorklubbarna (runda 6, `has_youth: false`) gäller samma princip men egna `geo_source`-taggar: `round6_osm_address` (66%, 633 st – adressmatchning mot OpenStreetMap), `round6_osm_freetext` (2%, 17 st – fritextsökning när strukturerad adress inte gav träff), `round6_postal_centroid` (32%, 303 st – postnummercentroid när adressen inte kunde geokodas eller matchningen gav en misstänkt kollision med en annan klubb), och `round6_city_centroid` (1%, 8 st – ortcentroid när postnummer helt saknades). Alla postnummer-/ortcentroid-placeringar har en liten deterministisk offset så klubbar på samma postnummer inte staplas exakt på varandra.

  De sista 15 klubbarna (`researched_manual_v5`) fick sin adress genom att användaren själv sökte upp dem manuellt (Google/Google Maps) - Claude geokodade sedan varje adress mot OpenStreetMap och verifierade att postnummer/ortnamn i träffen matchade det användaren hittat. Fyra av dem avvek mer än det annars använda 60 km-gränsvärdet mot `zipcodes_se.json`s referenskoordinat, men accepterades ändå efter granskning: `zipcodes_se.json` visade sig ha felaktiga referenskoordinater för postnummer 932 52 (Bureå), 932 61 (Lövånger) och 590 45 (Brokind) - alla tre pekar antingen på fel ort eller (för Brokind) har fel län/landskap i källdatan. OpenStreetMap-träffarnas egna postnummer/ortnamn matchade istället användarens adresser exakt. Idre SK avvek eftersom klubbens registrerade postnummer (797 31, Särna) skiljer sig från den faktiska klubbadressens postnummer (797 71, Idre) - två närliggande men olika postorter i fjällvärlden.

  **Om anläggningsgissningarna på stadsnivå (`researched_local_script_v4_city_guess`)**: när flera olika klubbar i en och samma (ofta större) stad matchade exakt samma anläggning i OpenStreetMap (t.ex. flera Kalmar-klubbar mot samma "Kalmar IP") uteslöts de träffarna helt och klubbarna fick istället sin adress manuellt bekräftad (se ovan) eller behöll sin trygga postnummerposition, eftersom flera klubbar rimligen inte kan dela exakt samma hemmaplan. De 30 som ändå lades in automatiskt är fall där bara EN klubb matchade den stadens anläggning i den aktuella omgången, men staden har ändå fler registrerade klubbar totalt - så det finns en viss kvarstående risk att just den träffen pekar på en annan klubbs plan än den tilltänkta. Flaggat separat i `geo_source` för framtida uppföljning.
- **Loggor**: visas där SvFF har en registrerad bild för klubben; övriga visar en genererad platshållare med klubbens initialer tills riktiga loggor läggs till.
- **Distrikt**: filtret visar/zoomar till alla klubbar inom ett distrikt – det ritar inte en exakt distriktsgräns på kartan (sådan geodata för fotbollsdistrikt är inte allmänt tillgänglig).

## Licens för positionsdata

Koordinaterna kommer från OpenStreetMap (Nominatim), licensierade under **ODbL** – de får sparas och redistribueras permanent, helt gratis, så länge OpenStreetMap krediteras. Det görs redan i kartans sidfot och i info-panelen på sajten. Ingen återkommande omkörning krävs (till skillnad från Google Maps Geocoding API, som testades tidigare i projektet men som har en 30-dagars gräns för hur länge koordinater får mellanlagras enligt Googles användarvillkor – därför valdes OpenStreetMap som permanent källa istället).
