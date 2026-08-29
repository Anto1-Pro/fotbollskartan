# Fotbollskarta

En självständig, statisk webbsida med en interaktiv karta över fotbollsklubbar i Sverige, Norge och Danmark (Leaflet + OpenStreetMap).

## Innehåll

- `index.html` – landningssidan (förklarar syftet, länkar vidare till kartan)
- `karta.html` – själva kartan
- `landing.css` – utseende för landningssidan
- `app.js` – all logik för kartan (sök, distriktsfilter, landsflaggor, popups)
- `styles.css` – utseende för kartan
- `data.json` – alla ~6194 klubbar (namn, adress, telefon, e-post, hemsida, distrikt, loggo-URL, koordinater, `has_youth`, `country`)
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
- **965 klubbar med enbart seniorverksamhet** (`has_youth: false`) – tillagda i en senare omgång (runda 6) från SvFF:s fullständiga klubblista. Dessa klumpas inte ihop med ungdomsklubbarna: ungdomsfiltret (`state.youthOnly` i `app.js`) utesluter alla klubbar där `has_youth` inte är sant, så filtreringen fungerar precis som innan för den ursprungliga gruppen.

Varje ny klubb har fått distrikt/`association_id` kopplat utifrån sin adress (samma `district_by_prefix`-logik som resten av registret), så de dyker upp korrekt i distriktsfiltret tillsammans med de befintliga klubbarna. 4 klubbar (`FC Tolkarna`, `Husqvarna IF`, `Kalmarpolisens IF`, `Vasastans BK`) saknade helt adress/postnummer/ort i källdatan och kunde inte placeras automatiskt av skriptet – de låg i `round6_unplaceable.csv` för manuell uppföljning. Användaren sökte själv upp gatuadresserna (Google Maps), och de geokodades sedan mot OpenStreetMap och lades in (`geo_source: round6_manual_address`). Samtliga 965 seniorklubbar har nu en position.

## Norge och Danmark – landsflaggor

Kartan visar numera klubbar från tre länder, styrt av fältet `country` (`"SE"`/`"NO"`/`"DK"`) som varje klubb i `data.json` har. Flaggorna vid sökrutan i `karta.html` filtrerar på detta fält (`state.activeCountries` i `app.js`) – **som standard är bara Sverige aktivt**, klick på en flagga tonar ner den och släcker/tänder alla klubbar från det landet. Flaggraden byggs dynamiskt från vilka `country`-värden som faktiskt finns i datan, så ett fjärde land kräver ingen kodändring – bara klubbar med rätt `country`-fält i `data.json`. Distriktsfiltret räknas om till bara de distrikt som finns bland just nu aktiva länder. Söker man fram en klubb vars land är avstängt aktiveras det landet automatiskt (samma princip som redan gällde för distrikt-/ungdomsfiltret).

**Norge** (1527 klubbar): källan är NFF:s (Norges Fotballforbund) 18 kretsöversikter på fotball.no för namn+krets, och Brønnøysundregistrenes öppna API (`data.brreg.no`, näringskod 93.120) för adresser – matchat på klubbnamn med en tokenbaserad poängsättning. 1225 klubbar (80%) fick sin gatuadress direkt, ytterligare 177 (12%) uppgraderades via NFF:s egen "besøksadresse" (klubbens anläggning snarare än kansliadress), och 121 (8%) landar på postnummernivå. 79 klubbar (5% av de ursprungliga 1608) kunde inte matchas säkert mot Brreg och saknar därför koordinater – de är inte med på kartan. `association_id` motsvarar NFF:s kretsnummer. `has_youth` är okänt för samtliga norska klubbar (`null`, källan skiljer inte på ungdoms-/seniorverksamhet) – de exkluderas därför ur "Endast ungdomsverksamhet"-filtret snarare än att felaktigt antas ha ungdomslag.

**Danmark** (1813 klubbar): källan är DGI:s (Danske Gymnastik- og Idrætsforeninger) öppna API `api.dgi.dk`, som redan levererar färdiggeokodade koordinater (98% täckning i källan). Datan kom in på "lokations"-nivå (2129 rader, en klubb kan ha flera anläggningar) och grupperades till 1849 unika klubbar; av dem saknade 36 koordinater i samtliga sina lokationer och är inte med på kartan. `has_youth` beräknas från källans åldersgrupper (`Aldersgrupper`) – klubben räknas som ungdomsklubb om något av åldersspannen 0–6, 7–12 eller 13–18 år finns registrerat. Danska klubbar saknar distriktsindelning i källdatan (`district: ""`) och är därför osynliga i distriktsfiltret men fullt sökbara och synliga på kartan.

**E-postadresser (Norge/Danmark)**: samma GDPR-princip som för Sverige (se nedan) tillämpades även här, med en egen matchare (`nordic_gdpr.py`) anpassad för norsk/dansk namngivning – bland annat att æ/ø/å transkribereras till både den vanliga (`ae`/`o`/`a`) och den äldre (`oe`/`aa`) webbkonventionen, danska pluralsuffix (`-ernes`/`-erne`/`-ens` osv) provas bortplockade, och att utskrivna organisationsord ("Idrettslag", "Fotballklubb", "Boldklub" …) räknas som sin vanliga förkortning (IL, FK, BK …) vid initialbygge. Av 1525 norska adresser behölls 1123 (74%), av 1273 danska behölls 731 (57%). Se `norway_gdpr_report.csv`/`denmark_gdpr_report.csv` för varje enskilt beslut.

## Kända begränsningar

- **Positionering**: klubbarna är geokodade från sin gatuadress via OpenStreetMap (Nominatim). Ca 85,5% (1616/1889) matchar den faktiska adressen eller en identifierad anläggning/plan (`geo_source`: `osm_address`, `osm_address_freetext`, `researched_osm_verified`, `researched_coords`, `researched_local_script`, `researched_local_script_v2`, `researched_local_script_v3`, `researched_local_script_v4`, `researched_manual_v5`, `round7_name_match` eller `round8_address_match`). Ytterligare ca 1,6% (30) är en anläggningsgissning på stadsnivå (`researched_local_script_v4_city_guess`, t.ex. "Malmö IP") i orter med flera registrerade klubbar - dessa har lägre konfidens och kan i enstaka fall peka på fel anläggning om orten har flera planer. Resterande ca 12,9% (243) landar på postnummer- eller ortnivå (`osm_postal`/`osm_city`) när adressen varit ofullständig (t.ex. en postbox). Samtliga 1889 klubbar (ungdomsverksamhet) har nu antingen en bekräftad adress/anläggning eller en trygg postnummerposition - ingen står längre på en misstänkt/overifierad position. Se `sanity_check_geo.py` för rimlighetskontrollen.

  För de 965 seniorklubbarna (runda 6, `has_youth: false`) gäller samma princip men egna `geo_source`-taggar: `round6_osm_address` (65,6%, 633 st – adressmatchning mot OpenStreetMap), `round8_address_match` (8,3%, 80 st – se runda 8 nedan), `round6_postal_centroid` (23,3%, 225 st – postnummercentroid när adressen inte kunde geokodas eller matchningen gav en misstänkt kollision med en annan klubb), `round6_osm_freetext` (1,8%, 17 st – fritextsökning när strukturerad adress inte gav träff), `round6_city_centroid` (0,6%, 6 st – ortcentroid när postnummer helt saknades), och `round6_manual_address` (0,4%, 4 st – gatuadress som användaren själv sökte upp manuellt eftersom källdatan helt saknade adress/postnummer/ort, sedan geokodad mot OpenStreetMap). Alla postnummer-/ortcentroid-placeringar har en liten deterministisk offset så klubbar på samma postnummer inte staplas exakt på varandra.

  De sista 15 klubbarna (`researched_manual_v5`) fick sin adress genom att användaren själv sökte upp dem manuellt (Google/Google Maps) - Claude geokodade sedan varje adress mot OpenStreetMap och verifierade att postnummer/ortnamn i träffen matchade det användaren hittat. Fyra av dem avvek mer än det annars använda 60 km-gränsvärdet mot `zipcodes_se.json`s referenskoordinat, men accepterades ändå efter granskning: `zipcodes_se.json` visade sig ha felaktiga referenskoordinater för postnummer 932 52 (Bureå), 932 61 (Lövånger) och 590 45 (Brokind) - alla tre pekar antingen på fel ort eller (för Brokind) har fel län/landskap i källdatan. OpenStreetMap-träffarnas egna postnummer/ortnamn matchade istället användarens adresser exakt. Idre SK avvek eftersom klubbens registrerade postnummer (797 31, Särna) skiljer sig från den faktiska klubbadressens postnummer (797 71, Idre) - två närliggande men olika postorter i fjällvärlden.

  **Om anläggningsgissningarna på stadsnivå (`researched_local_script_v4_city_guess`)**: när flera olika klubbar i en och samma (ofta större) stad matchade exakt samma anläggning i OpenStreetMap (t.ex. flera Kalmar-klubbar mot samma "Kalmar IP") uteslöts de träffarna helt och klubbarna fick istället sin adress manuellt bekräftad (se ovan) eller behöll sin trygga postnummerposition, eftersom flera klubbar rimligen inte kan dela exakt samma hemmaplan. De 30 som ändå lades in automatiskt är fall där bara EN klubb matchade den stadens anläggning i den aktuella omgången, men staden har ändå fler registrerade klubbar totalt - så det finns en viss kvarstående risk att just den träffen pekar på en annan klubbs plan än den tilltänkta. Flaggat separat i `geo_source` för framtida uppföljning.

  **Runda 7 och 8 (`round7_name_match`, `round8_address_match`)**: en sista omgång riktad mot de ~606 klubbar (ungdoms- och seniorklubbar tillsammans) som fortfarande stod på postnummer- eller ortnivå. Runda 7 sökte på klubbens NAMN + ort mot Nominatim (samma metod som tidigare researched-omgångar) och gav en träffprocent på bara ~4% (12 av 303 sökta). Runda 8 byggde på användarens egen iakttagelse att adressfältet i källdatan ofta redan innehåller en riktig gatuadress eller anläggning (t.ex. "Idrottsplatsen", "Forsavallen") - att söka på ADRESSFÄLTETS EGEN TEXT + ort istället för klubbnamnet gav en klart högre träffprocent, ca 23% (126 av 539 sökta). Adressfältet är ofta kommaseparerat med ett inledande "brus"-segment (klubbens kansli-underavdelning, en fastighetsbeteckning, en Kivra-adress, en postbox) som fick Nominatim att missa hela sökningen - att automatiskt plocka ut och söka på bara det mest adressartade segmentet (det som har ett husnummer eller en gatu-/anläggningsändelse) återvann de flesta av dessa. Där både runda 7 och runda 8 gav träff för samma klubb användes den med lägst avvikelse (`drift_km`) mot klubbens tidigare postnummerposition. Samtliga träffar validerades mot samma 20 km-avvikelsegräns och uteslutning av lågspecifika OSM-träffar (`place`/`boundary`-klasser, `place_rank < 26`) som tidigare omgångar, samt en manuell rimlighetsgranskning av varje enskild träff (t.ex. uteslöts en postbox-sökning som råkat matcha en orelaterad gata, och en sökning på ett ensamt husnummer som råkat matcha ett orelaterat hus 19 km bort). 132 klubbar fick sin position uppgraderad från postnummer-/ortnivå till en bekräftad adress genom dessa två rundor: 52 ungdomsklubbar (44 via runda 8, 8 via runda 7) och 80 seniorklubbar (samtliga via runda 8).
- **Loggor**: visas där SvFF har en registrerad bild för klubben; övriga visar en genererad platshållare med klubbens initialer tills riktiga loggor läggs till.
- **Distrikt**: filtret visar/zoomar till alla klubbar inom ett distrikt – det ritar inte en exakt distriktsgräns på kartan (sådan geodata för fotbollsdistrikt är inte allmänt tillgänglig).

## E-postadresser (GDPR)

Källdatan innehöll för många klubbar personliga e-postadresser (t.ex. en enskild kontaktpersons `fornamn.efternamn@gmail.com`) blandat med klubbens egna adresser. Dessa har rensats bort: en adress behålls bara om klubbens namn (eller en rimlig förkortning av det, t.ex. "IFK Skövde FK" → `ifkskovde.se`, "Mjällby AIF" → `maif.se`) går att känna igen antingen i domänen eller i delen före `@`. Adresser utan någon sådan koppling till klubben (som skulle exponera en privatpersons namn helt utan organisatorisk kontext) har tagits bort helt. Av klubbar som hade minst en e-postadress fick 318 st alla sina adresser borttagna eftersom ingen av dem gick att koppla till klubbnamnet. Se `gdpr_email_scan.py` för matchningslogiken och `gdpr_email_report.csv` för en fullständig lista över varje enskild adress och beslutet för den (kan innehålla enstaka felaktiga borttagningar där klubben använder en ovanlig förkortning, t.ex. ett universitets officiella kortnamn som inte följer det vanliga initialmönstret).

## Licens för positionsdata

Koordinaterna kommer från OpenStreetMap (Nominatim), licensierade under **ODbL** – de får sparas och redistribueras permanent, helt gratis, så länge OpenStreetMap krediteras. Det görs redan i kartans sidfot och i info-panelen på sajten. Ingen återkommande omkörning krävs (till skillnad från Google Maps Geocoding API, som testades tidigare i projektet men som har en 30-dagars gräns för hur länge koordinater får mellanlagras enligt Googles användarvillkor – därför valdes OpenStreetMap som permanent källa istället).
