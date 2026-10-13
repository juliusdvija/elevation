# Elevation — architectuur en ontwerpkeuzes

Elevation is een 3D-modelleerprogramma in de geest van SketchUp, met als onderscheid **automatische, live bijgewerkte 2D-tekeningen** (plattegronden, doorsneden, aanzichten) in een strakke, moderne stijl.

Dit document beschrijft hoe de app in elkaar zit en **waarom** de belangrijkste keuzes zo gemaakt zijn. Werk het bij wanneer een keuze verandert; voeg nieuwe beslissingen onderaan het beslissingslog toe.

---

## 1. Overzicht

```
main.ts                 koppelt alles aan elkaar (UI, tools, sneltoetsen)
document.ts             Document: model, groepen/componenten, undo, bewerkcontext, bestandsstatus
kernel/                 geometrie: Model, tekenen, vlakken, push/pull, transformaties, booleans
drawing/                2D-engine: views, projectie + hidden-line removal, snede, SVG
tools/                  interactieve tools, picker, inference (snapping), selectie
viewport/               Three.js-weergave, camera, renderer, hulpobjecten
io/                     bestandsformaat (.elev), opslaan/openen, herstelkopie
ui/                     toolbar-shell, tekeningenpaneel, groepbalk
```

Stack: **TypeScript + Vite + Three.js**, geen UI-framework. Tests met **Vitest**. Eenheden: **millimeters**, **Z omhoog** (zoals SketchUp).

### Gegevensstroom

```
gebruiker → Tool → (inference/picker, wereldcoördinaten)
          → doc.run(label, () => kernel-bewerking op doc.context.model, lokale coördinaten)
          → Model-journaal → History (undo) → model.changed / doc.geometryChanged
          → ModelRenderer (3D) · DrawingPanel (2D, live) · Selection.prune · herstelkopie
```

---

## 2. Geometriekern (`src/kernel`)

### Model
- Een **edge/face-graaf**: vertices, randen, vlakken (buitenlus + gaten), hulplijnen en instances. Elke entiteit is een **onveranderlijk record**; wijzigen = vervangen.
- Indexen: rand per vertexpaar, randen per vertex, vlakken per vertexpaar (onafhankelijk van rand-id's, zodat undo in willekeurige volgorde kan herstellen).
- Vlakinvariant: de buitenlus loopt **tegen de klok in rond de normaal**, gaten met de klok mee.

### Journaal en undo
- Alle wijzigingen gebeuren binnen een **journaal** (`model.edit`, of `beginJournal/endJournal`). Het journaal bewaart per entiteit de toestand vóór de eerste wijziging; het resultaat (`ModelEdit`) kan exact worden teruggedraaid en opnieuw toegepast.
- `Document.run(label, fn)` journaliseert **alle modellen tegelijk** (hoofdmodel + groepen) en legt dat vast als één undo-stap.
- Tool-previews (Push/Pull, Move, Rotate) voeren de **echte bewerking** uit en draaien die bij elke muisbeweging terug: de preview is daardoor altijd exact.

### Vlakken vinden (`faces.ts`)
- Na het tekenen worden de **getroffen vlakken opnieuw opgebouwd** uit de randen die erin liggen (`rebuildPlane`): planaire graaf → kleinste cycli → buitenlussen met gaten.
- Een gebied wordt een vlak als het **binnen een bestaand vlak** lag (splitsen behoudt vlakken) of als zijn buitenrand een **nieuwe rand** bevat (een lus sluiten maakt een vlak). Een verwijderd vlak komt dus niet vanzelf terug.
- **Persistente id's:** het grootste deel van een gesplitst vlak houdt het oude id (nodig voor toekomstige maatvoering die aan geometrie vastzit).
- Nieuwe vlakken zonder "ouder" nemen hun **oriëntatie van de buren** over (zoals SketchUp); op de grond wijzen vlakken standaard omlaag.
- `rebuildPlane` accepteert optioneel een **beslissing per gebied** (gebruikt door de booleans).

### Tekenen (`draw.ts`)
- Lijnen splitsen zichzelf en bestaande randen op kruisingen en T-aansluitingen; punten binnen 0,001 mm zijn hetzelfde punt.

### Verplaatsen, kopiëren, roteren (`transform.ts`)
- Verplaatsen werkt op **vertices**: wat eraan vastzit rekt mee (SketchUp-gedrag).
- Daarna volgt altijd **`settle`**: samenvallende punten lassen, randen splitsen waar punten op landen of randen kruisen, niet-platte vlakken **vouwen** in driehoeken, getroffen vlakken herbouwen, coplanaire buren **samenvoegen**.

### Push/Pull (`pushPull.ts`)
- **Verplaatsmodus**: als alle buren loodrecht staan en de veeg niets anders raakt, schuift het vlak gewoon op.
- Anders **extrusie**, met een **booleaanse stap** (`intersect.ts`): de veeg wordt gesneden met de vlakken die hij kruist, en per gebied beslist het **materiaal** of er een vlak hoort. Materiaal = oud volume ∪ prisma (toevoegen) of oud volume ∖ prisma (uitsparen). Een vlak bestaat alleen waar aan de ene kant materiaal zit en aan de andere niet; de normaal wijst naar de lege kant.
- "Toevoegen of uitsparen" wordt bepaald met een **punt-in-volume-test** (meerdere stralen moeten het eens zijn, zodat open geometrie geen vals "binnen" geeft).

### Validatie en fuzzing
- `validate.ts` controleert de invarianten: geen dubbele/ontaarde randen, geen ongesplitste kruisingen of T-aansluitingen, platte vlakken, juiste lusoriëntatie, consistente oriëntatie tussen buren (optioneel), geen overlappende coplanaire vlakken, kloppende indexen. Daarnaast `selfIntersections` (een rand die door een vlak prikt).
- `fuzz.ts` voert **willekeurige reeksen bewerkingen** uit (vaste seeds, reproduceerbaar) en controleert na elke stap: validatie, exacte undo/redo, en dat alle tekeningen te berekenen zijn. Een `solids`-modus test alleen realistische bewerkingen op gesloten volumes en eist ook geslotenheid en oriëntatie.

---

## 3. Groepen en componenten (`document.ts`)

- Een groep of component is een **definitie** met een **eigen Model**. Een model bevat **instances**: verwijzing naar een definitie + 4×4-transformatie (rigide: rotatie + translatie). Groepen in groepen werken vanzelf.
- **Plaatsingen** (`doc.placements()`) lopen de boom af en geven per model de wereldmatrix. Renderer, picker en tekeningen werken op plaatsingen.
- **Bewerkcontext** (`doc.context`): het model dat open staat. Tools werken in **wereldcoördinaten** voor snapping en zetten om naar de **lokale coördinaten** van de context voor de bewerking (`tools/space.ts`). Alles buiten de context wordt vervaagd en is niet bewerkbaar, maar wel snapbaar.
- **Componenten** delen hun definitie: één wijziging verandert alle exemplaren. **Groepen** worden bij binnengaan **uniek gemaakt** als ze gedeeld zijn (na kopiëren).
- Definities worden niet verwijderd bij undo; ongebruikte definities worden simpelweg niet opgeslagen.

---

## 4. 2D-engine (`src/drawing`)

- **Tekeninginstellingen** (`drawing/settings.ts`, opgeslagen in het document en het bestand, wijzigingen zijn undo-baar): **bouwlagen** (naam + vloerpeil), de **snijhoogte** van plattegronden (standaard 1200 boven de vloer) en de **doorsneden** (A–A kijkt noord, B–B kijkt west, positie in mm of midden van het model).
- Views (`ViewRef`): een plattegrond **per bouwlaag** (gesneden op peil + snijhoogte, en alleen getekend tot de eigen vloer, zodat lagere verdiepingen niet doorschemeren; wat precies op vloerhoogte ligt, zoals een dakterras, telt wel mee), vier aanzichten, en de doorsneden. Groepen worden eerst **plat geslagen** naar één wereldmodel (`doc.flatten()`).
- **Hidden-line removal is exact en analytisch**: elke rand wordt geprojecteerd en weggeknipt waar een vlak ervoor ligt (intervalrekening per vlak). Samenvallende lijnstukken worden samengevoegd (dichtstbijzijnde diepte wint).
- **Snede**: het snijvlak wordt met alle vlakken gesneden; stukken worden aan elkaar geschakeld tot gesloten lussen en gevuld (poché, even-odd).
- **Sheet-opmaak** (`sheet.ts`): zet een tekening om naar **papier-primitieven** (lijnen, vlakken, tekst in papier-mm) met poché, grondlijn, **peilmarkeringen** (▼ naam + peil, in aanzichten en doorsneden), **snijsymbolen** (streep-stippellijn, zware uiteinden, pijlen in kijkrichting en de letter, in plattegronden), titelblok en schaalbalk; op "passend" formaat of op A4–A1 liggend (met een waarschuwing als het niet past). Stijl is een set tokens (`MINIMAL`): lijndiktes in **papier-mm**, diepte-fading over 12 m.
- **Bladen** (`drawing/layout.ts`): een blad (A4–A1) bevat **viewports**: een tekening (`ViewRef`) met eigen schaal en een plek in papier-mm. Elke viewport wordt als gewone `layoutSheet` (met titel en schaalbalk) gebouwd en verschoven op de pagina gezet (`composeLayout`); er komt een kader en een bladtitel bij. Nieuwe viewports komen op de eerste vrije plek (`addViewport`), `tidyLayout` pakt alles opnieuw in; past iets niet, dan komt het onder de pagina en meldt het blad dat het niet past. Bladen horen bij de tekeninginstellingen (undo, bestand).
- **Renderers**: `svg.ts` (scherm en SVG-export) en `pdf.ts`, een **eigen PDF-schrijver**: echte vectorpaden, even-odd-vullingen, streepjes en Helvetica (standaard-PDF-lettertype, niets ingesloten), meerdere pagina's per bestand. `build.ts` bouwt sheets voor één of alle views (de **tekeningenset**).
- Live: het paneel herberekent bij elke wijziging (max. één keer per frame), ook tijdens tool-previews.

---

## 5. Tools en inference (`src/tools`)

- Elke tool krijgt pointer- en toetsenbordinvoer via `ToolManager`; de middelste muisknop is altijd navigatie.
- **Picker**: wat ligt onder de cursor (vertex, origin, hulppunt, kruispunt, midden, rand, hulplijn, vlak, grond), met schermafstanden in pixels en verborgen geometrie uitgesloten. Elke hit draagt zijn **plaatsing** mee.
- **Inference**: snapt op geometrie, rode/groene/blauwe as, parallel/loodrecht aan een referentierand, uitlijning met onthouden punten (ook over hoogteverschillen), en het 3D-wereldraster van 1 m (`tools/grid.ts`). Shift en pijltjestoetsen vergrendelen een richting. Richtingen die "op de kop" gezien worden, worden overgeslagen.
- **Maatvak**: getypte lengtes, `b;h`, graden, `3x` / `/3` (arrays), `24s` (segmenten).

---

## 6. Bestanden (`src/io`)

- Formaat **`.elev`**: leesbare JSON `{ format, version, units: 'mm', model, definitions, drawing, camera }`. Versie 2 voegde definities toe, **3** de tekeninginstellingen, **4** de bladen (`drawing.layouts`), **5** de opgeslagen 3D-aanzichten (`drawing.scenes`). Nieuwere versies worden geweigerd met een duidelijke melding.
- **OBJ-import** (`io/obj.ts`, dialoog in `ui/ImportDialog.ts`): knop in de werkbalk of een .obj (met .mtl) op het venster slepen. Verliesgevend: geometrie, kleuren (`Kd`) en doorzichtigheid (`d`/`Tr`) komen mee; teksturen, normalen en groepen niet. Eenheid wordt geraden uit de afmetingen, Y-omhoog wordt Z-omhoog. Het resultaat wordt een groep in de huidige context, één undo-stap.
- **STL- en glTF-import** (`io/mesh.ts`): binaire en ASCII-STL (standaard mm, Z-omhoog) en glTF 2.0 als .glb of .gltf met ingebedde data (meters, Y-omhoog, knooptransformaties toegepast, basiskleur en alfa uit het materiaal; spiegelende schaal draait de windrichting terug). Allebei leveren dezelfde `ObjMesh` als de OBJ-lezer, dus lassen, samenvoegen en verf zijn gedeeld; de importdialoog kent het formaat en zijn gebruikelijke eenheid en as.
- **DXF-import als onderlegger** (`io/dxf.ts`): ASCII-DXF met LINE, LWPOLYLINE (met bulge-bogen), POLYLINE, CIRCLE en ARC; eenheid uit `$INSUNITS`. Het resultaat is een groep losse randen (geen vlakken) op de grond om aan te snappen en over te trekken; tekst, arceringen en blokken worden overgeslagen en in de dialoog geteld.
- **OBJ-export** (`io/objExport.ts`, knop in de werkbalk): het hele model met groepen platgeslagen, in meters en Y-omhoog, vlakken getrianguleerd met een platte normaal per vlak; kleur en glas gaan naar een .mtl dat de importer terugleest. Arcering is alleen voor tekeningen en gaat niet mee.
- Opslaan via de **File System Access API** waar beschikbaar (schrijft terug naar hetzelfde bestand), anders download/bestandskiezer.
- Een **herstelkopie** in `localStorage` vangt herladen op; het bestand blijft de echte opslag.

---

## 7. Beslissingslog

| # | Beslissing | Waarom |
|---|---|---|
| 1 | Web-stack (TS + Vite + Three.js), later eventueel Tauri | Snel itereren in de browser, later native app mogelijk. |
| 2 | Z-omhoog, millimeters | Zoals SketchUp en de bouwpraktijk. |
| 3 | Edge/face-graaf in plaats van half-edge | SketchUp kent losse randen en randen met 3+ vlakken; half-edge kan dat niet. |
| 4 | Onveranderlijke entiteiten + journaal | Eén mechanisme voor undo, redo en exacte previews. |
| 5 | Vlakken per vlakvlak herbouwen | Robuust en eenvoudig; gesplitste vlakken houden hun id. |
| 6 | Vlak alleen bij nieuwe rand of binnen oud vlak | Lussen sluiten maakt vlakken, maar verwijderde vlakken komen niet terug. |
| 7 | Exacte analytische hidden-line removal | Echte vectoruitvoer en printkwaliteit; GPU-versnelling kan later. |
| 8 | Lijndiktes in papier-mm, fading over vaste afstand | WYSIWYG printen; een klein uitsteeksel mag de gevel niet doen vervagen. |
| 9 | `settle` na elke verplaatsing | Geometrie sluit altijd netjes aan (lassen, splitsen, vouwen, samenvoegen). |
| 10 | Push/Pull als boolean met materiaalclassificatie | Door ander materiaal heen duwen/trekken geeft altijd een geldig volume. |
| 11 | Validator + seeded fuzzing | Robuustheid aantoonbaar maken; elke fout is reproduceerbaar. |
| 12 | Groepen = definitie met eigen Model + instances | Losse objecten plakken niet; componenten delen geometrie; nesting gratis. |
| 13 | Tools in wereldcoördinaten, bewerken in lokale | Snappen op alles, bewerken alleen in de open groep. |
| 14 | Gedeelde groepen uniek maken bij bewerken | Gedrag zoals SketchUp; componenten blijven bewust gekoppeld. |
| 15 | `.elev` als JSON met versienummer | Leesbaar, diff-baar, uitbreidbaar. |
| 16 | Boog via middelpunt + straal + hoek | Voorkeur van de gebruiker; past bij hoe architecten maatvoeren. |
| 17 | Raster-snap op een 3D-wereldraster van 1 m vanaf de origin, uitschakelbaar | Op elk vlak (grond, wand, dak, schuin) snappen twee wereldcoördinaten op hele meters; langs elke richting snapt een lijn waar hij een rastervlak kruist; Push/Pull landt op hele meters. Het 3D-raster wordt niet getekend (alleen het grondraster); het werkt puur als snap. Schakelt zichzelf uit als de cellen op het scherm te klein worden. |
| 18 | Plattegrond per bouwlaag, getekend tot de eigen vloer | Lagere verdiepingen schemeren niet door; terrassen op vloerhoogte blijven zichtbaar. |
| 19 | Doorsneden als vaste objecten met een positie in mm | Een doorsnede blijft staan als het model groeit, en kan in plattegronden gemarkeerd worden. |
| 20 | Tussenlaag van papier-primitieven voor SVG en PDF | Eén opmaak, twee identieke uitvoerformaten. |
| 21 | Eigen PDF-schrijver i.p.v. een library | Onze tekeningen zijn lijnen, vlakken en tekst: exacte vectoren, geen afhankelijkheden, klein bestand. |
| 22 | Tekeninginstellingen undo-baar via de history | Bouwlagen en doorsneden wijzigen voelt als elke andere bewerking (en markeert het bestand als gewijzigd). |
| 23 | Maten (twee punten + afstand) horen bij de tekeninginstellingen, in wereldcoördinaten | Eén opslagplek met undo en bestandsformaat erbij; getekend in 3D (`DimensionRenderer`) en in elk aanzicht waaraan de maat evenwijdig is (`drawing/dimensions.ts`); een plattegrond toont de maten van zijn eigen bouwlaag. Delete in de maattool verwijdert de maat onder de cursor. |
| 24 | Schaalfiguur = gedeeld component met een vlak silhouet (`kernel/figure.ts`, tool N) | Gedraagt zich als elk component (verplaatsen, roteren, tekeningen); draait bij plaatsen naar de camera. Eén definitie voor alle figuren. |
| 25 | "Face me" is een vlag op de definitie; de draaiing zit in `placements()`, niet in de opgeslagen matrix | Renderer, picker, snappen en bounds gebruiken allemaal `placements()`, dus alles blijft consistent terwijl de camera draait; er komt geen undo-stap of wijzigingsvlag bij. Tekeningen draaien de figuur per aanzicht naar de kijker (plattegrond: zoals opgeslagen). Een nieuw document begint met een schaalfiguur op de origin (`reset()`, zonder undo-stap). |
| 26 | Na Push/Pull worden openingen in een voorheen gesloten model gesloten (`kernel/close.ts`) | Wat op een doorgeduwd vlak stond blijft anders als open koker achter. Alleen als het model eerst gesloten was; vlakke lussen van open randen krijgen een deksel; eerst geprobeerd op een kopie en alleen overgenomen als het aantal kapotte randen daalt zonder driewegverbindingen. |
| 27 | Automatische maatvoering is een tekeninginstelling, geen opgeslagen maten | Totale breedte/hoogte plus een maatketen langs de gesneden muren (`autoDimensions`), live berekend per tekening en meegeschaald; handmatige maten (besluit 23) blijven er los van bestaan. |
| 28 | Push/Pull op een gesloten model is een proefbewerking (`model.attempt`); blijft het open, dan wordt hij geweigerd | Liever een geweigerde bewerking met een melding dan een stil beschadigd model. `attempt` draait in een eigen deeljournaal binnen de lopende bewerking: bij acceptatie gaat het over in het buitenste journaal (undo blijft één stap), anders wordt alles teruggezet. "Gesloten" betekent: alleen de rand van het getrokken vlak is open (`isClosedExcept`). Het afdekken van open lussen (`close.ts`) maakt alleen een vlak in de lus zelf, zodat een naastgelegen gebied (de monding van een sleuf) niet ook een vlak wordt. |
| 29 | Push/Pull schuift een vlak alleen op als het geen hoekpunt van een aangrenzend vlak passeert; een losse voetafdruk telt niet mee in de "oude massa" | Passeert het een hoekpunt van een buurvlak (bv. de onderkant van een ander volume dat aan de rand raakt), dan klapt dat vlak om; dan is de boolean-extrusie nodig. Een vlak met een open rand (voetafdruk naast een volume) hoort niet bij een massa en zou de binnen/buiten-telling van stralen omdraaien (`insideTester(model, skip)`). Een extrusie die precies op de overkant van een muur landt, haalt het dekvlak weg ook als splitsen het een nieuw id gaf (`backToBack`). |
| 30 | `offsetPolygon` laat hoekpunten midden op een rechte rand vallen; `offsetHolds` controleert of de offset nog een polygoon is | Anders ontstaan spijkers en na te ver offsetten een ingeklapte lijn. De Offset-tool tekent dan niets. |

| 31 | Ruimtelijk raster (`kernel/spatial.ts`) op hoekpunten en randen, bijgehouden in `Model.set` | Zoeken naar een hoekpunt of rand bij een punt (`findVertex`, `findEdgeContaining`) en het snijden van een nieuw lijnstuk (`insertSegment`) lopen niet meer over het hele model. Alle schrijfacties (ook undo) lopen via `set`, dus het raster blijft kloppen; een rand wordt opnieuw geplaatst als een eindpunt verschuift. Zeer lange randen staan in een korte lijst die elke zoekopdracht controleert. |
| 32 | `rebuildPlane` rekent plaatslidmaatschap per hoekpunt en snoeit met omhullende vakken | Dat was de grootste kostenpost bij het tekenen in grote modellen. Het scant nog steeds alle randen per vlak: een lokale herbouw (alleen de samenhangende component rond de nieuwe randen plus omsluitende vlakken) is de volgende stap. |

| 33 | Een blad is een lijst viewports, elk een gewone tekening op eigen schaal, geplaatst in papier-mm | Hergebruikt `layoutSheet` ongewijzigd (annotaties, titel, schaalbalk per tekening), dus een tekening ziet er op een blad hetzelfde uit als los. Positie is opgeslagen (verschuifbaar en undo-baar) in plaats van elke keer berekend; automatisch plaatsen gebeurt alleen bij toevoegen en bij "Tidy". |

| 34 | Op een blad staan ook losse tekstnotities en een noordpijl, en alles is te slepen | Presentatiebladen hebben titels en toelichting nodig. Notities (`Layout.texts`) en de pijl (`Layout.north`) zijn gewone onderdelen van het blad (undo, bestand); slepen toont live via een voorlopige instelling en wordt bij loslaten één undo-stap. PNG-export tekent de SVG op een canvas (200 dpi), dus de web-app heeft geen server nodig. |

| 35 | Verf is een `color` (`#rrggbb`) op het vlak zelf (`kernel/cleanup.ts: paintFaces`) | Geen aparte materiaaltabel: een kleur hoeft niet gedeeld of hernoemd te worden en blijft in het bestand leesbaar. Elk stuk van een gesplitst vlak houdt de kleur (`rebuildPlane` geeft de eigenaar-kleur door), flippen, kopiëren en vouwen nemen hem mee; de snapshot van undo/fuzz bevat hem ook. Het verfblik-gereedschap (B) verft ook de hele selectie als je een geselecteerd vlak aanklikt; Alt+klik pakt een kleur op. |
| 36 | Tekeningen vullen vlakken met schilderalgoritme, alleen als er iets geverfd is | Vlakken worden van ver naar dichtbij gevuld (gemiddelde diepte), onbeschilderde vlakken in papierkleur zodat ze geverfde erachter afdekken; een vlak van achteren gezien krijgt geen verf (zoals in 3D). Doorsneden en plattegronden knippen vlakken bij het snijvlak (vlakken met gaten die erdoor lopen vallen weg). Exact is het niet: bij elkaar doorborende vlakken kan de volgorde kloppen of niet; de lijnen (exacte hidden-line) staan er altijd bovenop. Zonder verf verandert de uitvoer niet. |

| 37 | De standaardaanzichten zijn een echte 3D-kubus in CSS (isometrisch gedraaid) die bij hover openvouwt; Front is de wortel en beweegt niet | Elk vlak hangt aan de rand die hij deelt met zijn ouder en draait 90° naar 0° (Back hangt aan Left en volgt iets later), zodat het net plat in het vlak van Front komt te liggen, scheef getekend zoals de isometrie het laat zien. Alleen CSS-transformaties, geen JavaScript voor de animatie. Er is een `bottom`-aanzicht bijgekomen (van onderen, zoals een plafondplan: oost links). |

| 38 | OBJ-import voegt driehoeken zelf samen (`buildModel`) en gebruikt `settle` alleen rond echte kruisingen | Driehoeken die een rand delen, in één vlak liggen en één kleur hebben, worden één vlak met buitenlus en gaten (de rand zonder partner in de groep). Dat is ~100× sneller dan `settle` over het hele model (24 s → 5 s voor 8.500 polygonen). T-aansluitingen worden met het ruimtelijk raster gesplitst, dubbele driehoeken vervallen. Vlakken van verschillende kleur blijven gescheiden, ook in `healEdges`. |

| 39 | Doorzichtigheid is een `opacity` op het vlak (naast `color`), uit `d`/`Tr` van een .mtl, en glas verbergt geen lijnen | Glas is een eigenschap van het vlak zoals verf (zelfde bewaring, kopieën, undo; `paintFaces` met een dekking maakt glas, een gewone kleur maakt het weer ondoorzichtig; vlakken met verschillende dekking worden niet samengevoegd). In 3D staat glas in een eigen transparante mesh per laag (RGBA-kleur per hoekpunt) zodat ondoorzichtige geometrie op het snelle pad blijft. In tekeningen telt glas niet mee als afdekker (randen erachter blijven zichtbaar), krijgt het een doorschijnende vulling (SVG `opacity`, PDF `ExtGState` met `/ca`) en blijft de rest van de volgorde schilderalgoritme. |

| 40 | Schaduwwerking in tekeningen is een instelling (`shading`) met één vast licht (`LIGHT`: van boven, voor en links); schaduwen worden per ontvangend vlak berekend en met een knippad op dat vlak getekend | Elk vlak krijgt een tint naar zijn stand ten opzichte van het licht (`lightOn`); bovendien werpt elk ondoorzichtig vlak zijn omtrek langs het licht op het vlak van elk verlicht vlak (`drawing/shadows.ts`, ruimtelijk raster, bereik 12 m); gaten laten licht door (tegen de klok in voor buitenlus, met de klok mee voor gat: niet-nul-regel). De schaduw is een doorschijnend zwart pad met `clip` (SVG `clipPath`, PDF `W* n`) zodat hij exact op het vlak blijft zonder polygoon-snijden. Vlakken die van het licht af staan krijgen geen schaduw (ze zijn al donker). Plattegronden op maaiveld krijgen daarnaast een slagschaduw op de grond (alle vlakken, één pad). Daardoor zie je dorpels, overstekken en ramen in een aanzicht. Eén vast licht houdt tekeningen onderling consistent; een instelbare zonnestand is een logische uitbreiding. |

| 41 | Een 3D-aanzicht op een blad is een `Scene` (naam + camera) die als JPEG-plaatje wordt gerenderd; het PDF-schrijven werkt nu op bytes | `Viewport.snapshot` rendert het model buiten beeld (render target met 4× MSAA, papierkleurige achtergrond, zonder raster, assen, selectie, hover en hulplijnen) en zet de camera daarna terug. Op het blad is het een `SceneViewport` naast de gewone tekeningen (zelfde kader, bijschrift, slepen, tidy, undo). Het plaatje is een primitief `image`: SVG `<image>` en een PDF-`XObject` met DCT (de JPEG-bytes ongewijzigd). Voorbeeld op 110 dpi, export op 220 dpi; renders worden gecachet op camera, grootte en modelversie en na een wijziging even hergebruikt zodat slepen soepel blijft. Een scene die geen blad meer toont, wordt vergeten. Het plaatje hangt van WebGL af, dus tests gebruiken een `ImageProvider`. |

| 42 | Scenes zijn zelfstandige opgeslagen aanzichten (strip onder het 3D-beeld) die ook op bladen gebruikt worden | Een scene is niet meer afhankelijk van een blad: opslaan met "+ View", aanklikken vliegt de camera er in 450 ms heen (gladde in-en-uit), dubbelklik hernoemt, × verwijdert; alles via de tekeninginstellingen (undo, bestand). "3D view" op een blad hergebruikt een scene als de camera er al op staat. Een blad met een verwijderde scene toont een placeholder. De vlucht stopt zodra de gebruiker de camera overneemt. |

| 43 | Een materiaal in het palet is kleur + dekking + arcering; de arcering (`Face.hatch`) wordt pas in de tekening uitgerekend, op schaal | Het vlak bewaart alleen de naam van het patroon (`brick`, `boards`, `tiles`, `concrete`, `grass`), net als verf en dekking (bestand, kopieën, splitsen, undo, Push/Pull geven het door; vlakken met verschillende arcering worden niet samengevoegd). `drawing/hatch.ts` maakt de lijnstukken in het vlak van de wand zelf (metselwerk loopt dus horizontaal, planken verticaal) met een modulemaat in mm; de maat wordt opgerekt tot het patroon op papier minstens `paperMin` mm is en een vlak niet meer dan ~700 lijnen krijgt. Op het blad is het één pad (donkerder tint van de kleur, dun, deels doorzichtig) met een knippad op het vlak. Alleen aan de voorkant van een vlak. Het palet heeft een knop "Patterns" om de arcering uit te zetten; in 3D blijft het kleur. |

| 44 | Importeren draait in een Web Worker (`io/importWorker.ts`) met voortgang en Annuleren | De bouw (lassen, vlakken samenvoegen, T-aansluitingen, kruisingen) duurt voor ~8.500 polygonen ~5 s; op de hoofddraad bevriest dat de pagina. De worker stuurt een gestructureerde kopie van de mesh in en krijgt het model terug als gewone data (`Model.toData`), dat de pagina met `load` in een nieuw model zet; voortgang komt per fase (~12 keer per seconde begrensd). Annuleren beëindigt de worker. Zonder `Worker` (testomgeving) valt het terug op de hoofddraad. Een verborgen browservenster remt de worker flink af (24 s tegen 5 s). |

| 45 | Follow Me (`kernel/followMe.ts`, tool W) is een sweep waarvan de zijvlakken plat blijven, daarna dezelfde boolean als Push/Pull | De doorsnede wordt langs de gekozen randen gesleept; op elke hoek ligt de doorsnede in het vlak dat de twee segmenten middendoor deelt (verstek), en elke ring volgt uit de vorige door langs zijn segment naar dat vlak te schuiven, dus elk zijvlak is een vlak trapezium. Open pad: twee afdekvlakken; gesloten pad: een ring zonder. De richting volgt uit het teken van het ingesloten volume. Het resultaat gaat via `insertSegment`/`updateFaces` het model in en daarna door `booleanPass` (nu geëxporteerd, met `force` voor sweeps die alleen samenvallen met bestaande vlakken): ligt de sweep in materiaal dan snijdt hij een groef, anders voegt hij toe en smelt hij met wat hij raakt. Gewrapt in `model.attempt`: een gesloten model dat open zou blijven wordt geweigerd. Het pad is de selectie (`chainEdges` ordent die vanaf het uiteinde bij het profiel; vertakkingen en losse stukken worden geweigerd). Een willekeurige test (400 sweeps) eindigt altijd gesloten en geldig. |

---

## 8. Bekende beperkingen

- Een volume wegduwen terwijl er iets aan vastzit: het deel dat blijft staan wordt nu dichtgemaakt als het model eerst gesloten was (besluit 26). In de solids-fuzz faalt nog ~1% van de reeksen van 40 stappen (was ~22% bij 30 stappen): zeldzame losse randen zonder vlakken, een rand die door een vlak prikt en oriëntatiefouten in lange reeksen. Randen met vier vlakken (twee volumes die elkaar langs een rand raken) zijn toegestaan. Een Push/Pull die een gesloten model open zou laten, wordt geweigerd (besluit 28).
- Zeldzame oriëntatieproblemen in zeer complexe, meermaals gedraaide modellen.
- Componenten kunnen hernoemd worden (naamveld in de balk bij selectie, undo-baar); een componentenoverzicht (knop in de werkbalk) laat ze hernoemen en alle kopieën selecteren; nog geen eigen assen.
- Tekeningen: automatische maten zijn alleen totaalmaten en een keten langs gesneden muren (geen ramen/deuren), tekstbreedtes in PDF zijn geschat (Helvetica-metrieken benaderd).
- Follow Me: het profiel moet (bijna) loodrecht op het eerste segment staan en het pad moet één keten zijn; profielen met gaten, paden die terugkeren op zichzelf en paden met vertakkingen worden geweigerd; geen 3D-gebogen paden met een afgeronde verstek (bochten blijven hoekig).
- Arcering: vijf patronen, alleen in tekeningen (geen texturen in 3D); de patroonrichting volgt het vlakraam (niet instelbaar) en loopt niet door over aangrenzende vlakken.
- 3D-aanzichten op bladen: maten en gereedschapsfeedback staan niet in het plaatje; het plaatje is een raster (niet schaalbaar) en toont geen cast shadows (3D-weergave heeft een eigen eenvoudige verlichting); geen perspectiefcorrectie of zonnestand.
- Schaduwen: één vaste lichtrichting; schaduw valt alleen op vlakken, niet op de grond in aanzichten; glas laat licht volledig door (geen getinte schaduw); gaten met meerdere onderdelen die door het snijvlak lopen kunnen ruwe randen geven.
- DXF-onderlegger: de lijnen tellen mee in de tekeningen (het is gewone geometrie in een groep) en kruisende lijnen worden niet gesplitst; geen DXF-export.
- OBJ-import: bij bronnen met dubbele of elkaar rakende geometrie blijven enkele vlakken overlappen (validator: `overlapping-faces`), en open meshes blijven open; er is nog geen STL-, glTF- of DXF-import en geen export.
- Verf: de wanden en bovenkant van een Push/Pull nemen de kleur van het getrokken vlak over; andere nieuwe vlakken zonder ouder zijn onbeschilderd. Schaduw, patronen/arceringen en texturen bestaan nog niet.
- Prestaties (`npm run bench`, raster van huisjes): bij 4.000 vlakken kost een Push/Pull ~35 ms en een tekening 40–70 ms; bij 9.000 vlakken ~100 ms en 170–350 ms; een tekenstap in het model ~45 ms gemiddeld. Wat nog kwadratisch is: `rebuildPlane` scant per vlak alle randen en vlakken, de validator (`validateModel`, alleen voor tests en fuzz) kost bij 9.000 vlakken ~50 s, en tekeningen rekenen bij elke wijziging alles opnieuw.
