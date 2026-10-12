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

- Formaat **`.elev`**: leesbare JSON `{ format, version, units: 'mm', model, definitions, drawing, camera }`. Versie 2 voegde definities toe, **3** de tekeninginstellingen. Nieuwere versies worden geweigerd met een duidelijke melding.
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

---

## 8. Bekende beperkingen

- Een volume wegduwen terwijl er iets aan vastzit laat dat deel open achter (zoals SketchUp).
- Zeldzame oriëntatieproblemen in zeer complexe, meermaals gedraaide modellen.
- Componenten hebben nog geen eigen assen/naam-UI; nog geen componentenoverzicht.
- Tekeningen: maten zijn handmatig (geen automatische maatketens) en er zijn nog geen meerdere tekeningen per blad; tekstbreedtes in PDF zijn geschat (Helvetica-metrieken benaderd).
- Prestaties: kernel-bewerkingen en tekeningen zijn O(n²) en rekenen alles opnieuw; prima voor gebouwen van normale omvang, niet voor zeer grote modellen.
