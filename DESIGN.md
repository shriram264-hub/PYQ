---
name: SawaalBox
description: Past exam questions, searchable by what they're about; the examination booklet as a working document.
colors:
  ground: "#e6eae3"
  ground-dark: "#15191a"
  paper: "#f4f6f1"
  paper-dark: "#1d2224"
  paper-edge: "#d7ddd3"
  paper-edge-dark: "#2c3336"
  ink: "#14181a"
  ink-dark: "#e8ece6"
  ink-soft: "#4a544f"
  ink-soft-dark: "#a7b2ad"
  ink-faint: "#5a6560"
  ink-faint-dark: "#88938f"
  rule: "#b9c2b8"
  rule-dark: "#39423f"
  rule-strong: "#14181a"
  rule-strong-dark: "#e8ece6"
  field: "#0f3d2e"
  field-dark: "#123f30"
  field-deep: "#0a2c21"
  field-deep-dark: "#0c2c22"
  field-ink: "#f4f6f1"
  field-ink-dark: "#eef3ee"
  field-ink-soft: "#a9c4b7"
  field-ink-soft-dark: "#9dbcae"
  field-text: "#0f3d2e"
  field-text-dark: "#7fd3a6"
  stamp: "#b00d26"
  stamp-dark: "#e76678"
  seal: "#b00d26"
  seal-dark: "#c41e3a"
  seal-ink: "#ffffff"
  seal-ink-dark: "#ffffff"
  focus: "#0f3d2e"
  focus-dark: "#7fd3a6"
typography:
  display:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "clamp(2rem, 1.1rem + 4.2vw, 4.25rem)"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "clamp(1.9rem, 1.2rem + 3vw, 3.4rem)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.02em"
  title:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "clamp(1.25rem, 1rem + 1.1vw, 1.9rem)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.02em"
  subtitle:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.02em"
  body:
    fontFamily: "'Literata', Georgia, 'Times New Roman', serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
    fontFeature: "tnum"
  question:
    fontFamily: "'Literata', Georgia, 'Times New Roman', serif"
    fontSize: "1.02rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0"
  control:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 700
  nav:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "0.88rem"
    fontWeight: 600
  label:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "0.68rem"
    fontWeight: 600
    letterSpacing: "0.13em"
  serial:
    fontFamily: "'Courier Prime', 'Courier New', monospace"
    fontSize: "1rem"
    fontWeight: 700
    letterSpacing: "0.02em"
    fontFeature: "tnum"
rounded:
  none: "0px"
spacing:
  xs: "0.35rem"
  sm: "0.6rem"
  md: "1.1rem"
  lg: "1.25rem"
  xl: "2.5rem"
  section: "clamp(2.5rem, 6vw, 4rem)"
components:
  button-primary:
    backgroundColor: "{colors.field}"
    textColor: "{colors.field-ink}"
    typography: "{typography.control}"
    rounded: "{rounded.none}"
    padding: "0.85rem 1.6rem"
  button-primary-hover:
    backgroundColor: "{colors.field-deep}"
    textColor: "{colors.field-ink}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.field-text}"
    typography: "{typography.control}"
    rounded: "{rounded.none}"
    padding: "0.7rem 1.25rem"
  button-secondary-hover:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.field-text}"
  input-search:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "0.85rem 0.95rem"
  question-block:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.question}"
    rounded: "{rounded.none}"
    padding: "1rem 1.1rem"
  cover-band:
    backgroundColor: "{colors.field}"
    textColor: "{colors.field-ink}"
    typography: "{typography.serial}"
    padding: "0.55rem 1rem"
  cover-band-sealed:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink-faint}"
    padding: "0.55rem 1rem"
  seal-band:
    backgroundColor: "{colors.seal}"
    textColor: "{colors.seal-ink}"
    padding: "0.35rem 0"
  tag-flag:
    textColor: "{colors.stamp}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0.05rem 0.4rem"
  pager-number:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.nav}"
    rounded: "{rounded.none}"
    height: "2.2rem"
    padding: "0 0.55rem"
  pager-number-current:
    backgroundColor: "{colors.field}"
    textColor: "{colors.field-ink}"
    height: "2.2rem"
  theme-toggle:
    backgroundColor: "transparent"
    textColor: "{colors.field-ink}"
    rounded: "{rounded.none}"
    padding: "0.25rem 0.6rem"
---

# Design System: SawaalBox

## Overview

**Creative North Star: "The Question Paper"**

SawaalBox is the examination booklet itself, made searchable: not a marketing page about a question bank, but a working document the aspirant already knows how to read. Every component is a part of that document. Mastheads and colophons are printed fields of institutional green, forms are ruled instruction boxes, corpus figures are serial numerals in registration grids, each exam is a booklet cover with a printed series code, and every question is a serially numbered block with its answer under a seal you break to read.

The page is exam stationery, not cream: a pale green-grey ground carrying paper plates, offset ink, and a single deep green committed at page scale. Density is document density. Rules do the work that cards, shadows and radii do elsewhere; hierarchy comes from a heavy rule against a hairline, a green field against paper, and three typefaces with strictly separated jobs. Exam red appears only where real papers use it: stamps and seals.

There is a night sitting: the same document printed on dark stock. Light is the default; dark applies when the reader's system asks for it or when they force it with the theme toggle, and every semantic token swaps as a set. The world refuses the edtech category arrangement outright: no indigo hero, no rounded feature trio, no smiling-student illustration.

**Key Characteristics:**
- Committed green fields at page scale (masthead, cover band, colophon), never sprinkled as accent.
- Square corners everywhere; structure is drawn with 2px heavy and 1px hairline rules.
- Three typefaces with fixed jobs: Archivo builds, Literata is read, Courier Prime numbers.
- Red is ink for stamps and paper for seals; never an action.
- Flat at rest. Two motions only carry meaning: the booklet cover lifting at its spine and the answer sheet lifting when its seal breaks.
- Light and dark are one document on two stocks, defined once as value pairs and switched as a set.

## Colors

A cool stationery palette: green-grey ground and paper, near-black offset ink, one deep institutional green, and an exam red held in reserve.

### Primary
- **Institutional Green** (field, #0f3d2e; night #123f30): a background colour that owns whole regions: the masthead, the breadcrumb strip (as Deep Field), the colophon, the open cover's series band, the primary Search button, the current page in the pager, and text selection. It is never used as text; on dark stock it measures 1.36:1 against paper.
- **Deep Field** (field-deep, #0a2c21; night #0c2c22): the pressed state of the green, used for primary button hover and the breadcrumb strip under the masthead.
- **Green Text Ink** (field-text, #0f3d2e; night #7fd3a6): the green that is allowed to be read. Answer-toggle labels, OPEN states in the contents page, the outlined "Open the booklet" label, and the caret. On dark stock it lightens to a legible mint.
- **Field Ink** (field-ink, #f4f6f1; night #eef3ee) and **Field Ink Soft** (field-ink-soft, #a9c4b7; night #9dbcae): text on green fields; the soft variant carries the Devanagari wordmark, field labels inside the series band, and colophon prose.

### Secondary
- **Stamp Red** (stamp, #b00d26; night #e76678): red ink on the page, for text and borders only. The "Cancelled by UPSC" and "Answer disputed" flags and the "difficult" difficulty tag. It lightens on dark stock to stay legible.
- **Seal Red** (seal, #b00d26; night #c41e3a) with **Seal Ink** (seal-ink, #ffffff): the red paper band pasted across a sealed cover. On dark stock it stays a deep red with white ink rather than following the stamp to pink.

### Neutral
- **Stationery Ground** (ground, #e6eae3; night #15191a): the page background, the recessed search input, the sealed cover's blank band, and the marked correct option once an answer is revealed.
- **Paper Plate** (paper, #f4f6f1; night #1d2224): the raised sheet: ruled boxes, covers, question blocks, year tiles, pager cells.
- **Page Edge** (paper-edge, #d7ddd3; night #2c3336): the shelf plank under the rack and the fanned page edges behind an open cover.
- **Offset Ink** (ink, #14181a; night #e8ece6): primary text.
- **Soft Ink** (ink-soft, #4a544f; night #a7b2ad): ledes, standfirsts, entry bodies, metadata rows, field labels.
- **Faint Ink** (ink-faint, #5a6560; night #88938f): option keys, index serials, placeholders, COMING states, disabled pager steps. Both values clear 4.5:1 on ground and on paper; it is faint by hue, not by failing contrast.
- **Hairline Rule** (rule, #b9c2b8; night #39423f): 1px dividers, dashed answer separators, dotted leaders, the scrollbar thumb.
- **Heavy Rule** (rule-strong, #14181a; night #e8ece6): the 2px frame of anything the reader acts on or that bounds a document part.
- **Focus** (focus, #0f3d2e; night #7fd3a6): a 2px solid outline offset 2px, sitewide.

### Named Rules
**The Committed Field Rule.** Green is a field, not an accent. It fills a region edge to edge or it is not used; text that must read as green uses Green Text Ink, never the field colour.

**The Stamp and Seal Rule.** Exam red appears only as a stamp (flag text and borders, the difficult tag) or a seal band. It is never a button, a link, a heading or a decoration.

**The Two Stocks Rule.** Every colour is defined once as a light and dark pair and mapped to one semantic name. New surfaces consume the semantic tokens only; they never branch on theme themselves.

## Typography

**Display Font:** Archivo Variable (with Archivo, system-ui, sans-serif)
**Body Font:** Literata 400 and 600 (with Georgia, Times New Roman, serif)
**Label/Mono Font:** Courier Prime 400 and 700 (with Courier New, monospace)

All three are self-hosted through fontsource; nothing loads from a font CDN.

**Character:** Archivo is the booklet's printed structure: tight, heavy, institutional. Literata is what the candidate reads, a book serif at a reading measure. Courier Prime is the typewritten serial on the cover and the registration numerals, and it appears nowhere else.

### Hierarchy
- **Display** (Archivo 800, clamp(2rem, 1.1rem + 4.2vw, 4.25rem), line-height 1.02, -0.035em): the one-line thesis in a green masthead, capped at 22ch. The wordmark uses the same weight and tracking at masthead scale.
- **Headline** (Archivo 700, clamp(1.9rem, 1.2rem + 3vw, 3.4rem), 1.12, -0.02em): page h1 on listing pages and cover boxes. Balanced wrapping.
- **Title** (Archivo 700, clamp(1.25rem, 1rem + 1.1vw, 1.9rem), 1.12): section h2. Cover titles sit between title and headline, capped at 18ch.
- **Subtitle** (Archivo 700, 1.05rem): h3 and group headings in soft ink.
- **Body** (Literata 400, 1rem, 1.6): all running prose, tabular numerals on, paragraphs capped at 68ch.
- **Question** (Literata 400, 1.02rem, 1.55): the question text itself, pre-wrapped so statement lists keep their line breaks, capped at 68ch.
- **Control / Nav** (Archivo 700 at 0.95rem for buttons; 600 at 0.88rem for navigation and structural links).
- **Label** (Archivo 600, 0.68rem, 0.13em, uppercase): the printed label on a form field or box: "Series", "Questions", "Official answer", the search field label. State words (OPEN, COMING, EASY, SHOW ANSWER) use the same uppercase tracked Archivo at 0.68 to 0.8rem.
- **Serial** (Courier Prime 400/700, 0.02em, tabular): question serials ("2021 · Q32"), series codes, corpus counts, option keys, year numerals, list markers, pager numbers.

### Named Rules
**The Three Voices Rule.** Archivo builds, Literata is read, Courier Prime numbers. A serif heading, a sans question body, or a monospace sentence breaks the document.

**The Reading Measure Rule.** Anything meant to be read, prose, questions, options, answer notes, stops at 68ch however wide the sheet is.

**The Label Is a Field Rule.** The small uppercase label names the field or box directly beneath it, as on an official form. It never floats above a headline as a decorative eyebrow.

## Layout

One centred sheet, `min(100% - 2rem, 76rem)`, used by every band: masthead, main, colophon. Green bands run full-bleed while their contents sit on the sheet. On the homepage the search strip is pulled up by clamp(-1.25rem, -2vw, -0.75rem) so the ruled box overlaps the masthead's bottom rule, the way a form box sits on a printed band.

Rhythm is in rem. Rows and inline controls separate at 0.35 to 0.6rem; box interiors pad at 1 to 1.1rem; grid gutters sit at 1.25rem; sections are spaced by clamp(2.5rem, 6vw, 4rem) on the homepage and clamp(1.5rem, 4vw, 2.75rem) on listing pages. Listing heads close with a 2px heavy rule before content.

Composition is asymmetric where the document is: the homepage rack splits 3fr / 2fr (open cover dominant, sealed cover beside), the UPSC cover splits 1.75fr / 1fr (instructions box, registration grid), contents pages run two columns. Indexes are single-column rows with serial, name, dotted leader and count; years are an auto-fill grid of minmax(5.5rem, 1fr) tiles.

Responsive changes are collapses, not re-layouts: at 62rem the UPSC cover stacks; at 52rem the rack and contents collapse to one column and each cover gets its own plank; at 40rem mastheads go single-column, input and button stack, and the cover's registration fields stack with a top hairline in place of the side hairline; at 30rem the theme toggle drops its text label and keeps its icon.

## Elevation & Depth

Flat by default. Depth comes from stock and rules, not light: paper plates on ground, recessed inputs in ground colour inside paper boxes, green fields bounded by a 2px ink rule, and the shelf plank under the rack. There is exactly one shadow in the system and it exists only in a state.

### Shadow Vocabulary
- **Spine Lift** (`box-shadow: 10px 12px 24px -14px rgb(0 0 0 / 0.45)`): applied only while the open booklet cover is lifted on hover or focus. Never at rest.

### Named Rules
**The Stock Not Light Rule.** A surface is raised by being paper on ground and framed by a rule. If a new part seems to need a shadow at rest, it needs a heavier rule instead.

**The Two Motions Rule.** Motion is meaning, and the system has two meanings. The open cover lifts at its spine (rotateY(-5deg) about its left edge, 420ms cubic-bezier(0.16, 1, 0.3, 1)) while hairline page edges are revealed by clip-path, so layout never reflows. The answer sheet lifts when its seal breaks (rotateX(-16deg) from its top edge with a fade, 260ms, same curve). Everything is reduced to 0.01ms under prefers-reduced-motion.

## Shapes

Square. Radius is 0 on every element, including inputs, buttons, the theme toggle, and the scrollbar thumb. Form is drawn with two rule weights: the heavy rule (2px, Heavy Rule colour) frames masthead and colophon edges, ruled instruction boxes, covers, inputs and buttons; the hairline (1px, Hairline Rule or Heavy Rule colour) groups question blocks, registration cells, year tiles, pager cells and field grids. Dashed hairlines mark a fold or a seal line (above the answer, the fold on the UPSC cover, disabled pager steps). Dotted hairlines are leaders in indexes and contents pages.

The only non-orthogonal shape is the seal: a red band rotated -7deg that overruns its cover by 10% each side and is clipped by the cover's edge.

## Components

### Buttons
Printed and blunt: square slabs with a heavy ink frame.
- **Shape:** square corners (0), 2px Heavy Rule border.
- **Primary:** the Search submit only. Institutional Green fill, Field Ink text, Archivo 700 at 0.95rem, padding 0.85rem by 1.5 to 1.6rem. One per page.
- **Hover / Focus:** hover deepens to Deep Field; focus is the sitewide 2px green outline offset 2px.
- **Secondary:** outlined. Paper fill, Green Text Ink label, same heavy frame, padding 0.7rem by 1.25rem; hover and focus shift the fill to Stationery Ground. "Open the booklet" is the reference instance.

### Chips
- **Flag (stamp):** a 1px Stamp Red border with Stamp Red uppercase text at 0.68rem, 0.06em tracking, padding 0.05rem by 0.4rem. Used for "Cancelled by UPSC" and "Answer disputed".
- **Difficulty tag:** bare uppercase label at 0.68rem pushed to the row's end; soft ink for easy and moderate, Stamp Red for difficult.
- **Query token:** an inline search phrase set in Archivo 600 on paper with a 1px Heavy Rule frame, used where copy quotes a search.

### Cards / Containers
- **Ruled box:** paper fill inside a 2px Heavy Rule frame, square. Box heads close with their own 2px rule; interiors pad at 1.1rem. The instruction box and the registration grid are ruled boxes.
- **Question block:** paper fill, 1px hairline frame, padding 1rem by 1.1rem. Head row in Archivo 0.78rem soft ink: serial (Courier Prime, bold, the visible permalink cue), subject › subtopic links, difficulty tag, flags. Question text in Literata is a link with no resting underline; underline appears on hover or focus. Options are a two-column grid (2rem key column in faint serial, then text). Question block styling is one shared stylesheet so server-rendered and client-rendered results cannot drift.
- **Shadow Strategy:** none at rest (see Elevation & Depth).

### Inputs / Fields
- **Style:** 2px Heavy Rule frame, square, Literata at 1.05 to 1.08rem, padding about 0.85rem by 0.9rem. Inside a paper box the input recesses to Stationery Ground; on a bare page it sits on paper. Placeholder in Faint Ink. Field label above in the Label style.
- **Selects:** Archivo 0.9rem on paper with a 1px Heavy Rule frame.
- **Focus:** the sitewide 2px focus outline; the caret is Green Text Ink.

### Navigation
- **Masthead:** Institutional Green band with a 2px Heavy Rule bottom edge. Wordmark in Archivo 800 with the Devanagari name beside it in Field Ink Soft. Nav links in Archivo 600 at 0.88rem with a transparent underline at rest that turns solid on hover. On inner pages a Deep Field breadcrumb strip follows, slash-separated in Archivo 0.78rem.
- **Theme toggle:** a small outlined control (1px currentColor border, 0.78rem Archivo 600) cycling System, Light, Dark, with drawn inline SVG icons (1.4 stroke, round caps) and the current state as its text.
- **Colophon:** the green field again at the foot, 2px Heavy Rule top edge, soft prose and bold structural links.
- **Pager:** 2.2rem square-cornered cells on paper with hairline frames; hover strengthens the frame to Heavy Rule; the current page is a filled green cell; unavailable steps turn Faint Ink with a dashed frame. A serial "Showing x–y of n" line sits above.

### Answer Seal
The signature reading interaction. A `details` element under a dashed hairline; its summary is an uppercase Archivo label in Green Text Ink with a drawn square that fills solid when open ("Show answer" / "Hide answer"). Opening lifts the answer sheet from its top edge, shows "Official answer" as a field label with the serial key, and marks the correct option with a Stationery Ground fill and a 1px Heavy Rule outline. The correct option is never marked before the seal is broken.

### Booklet Rack
Each exam is a booklet cover standing on a shelf plank. The cover is a paper plate in a 2px Heavy Rule frame with no bottom border; the plank beneath (0.6rem of Page Edge with a heavy top rule and hairline bottom) is its bottom edge, and on wide screens the plank runs across the gap so covers share one shelf. The open cover carries a green series band with "Series" and the exam's code in serial, a title, a three-cell registration field grid of serial counts, top subject links, and an outlined open control whose hit area stretches across the whole cover. It lifts at its spine on hover and focus (see Elevation & Depth). A sealed cover has a blank ground-coloured band with a dash for its code, soft ink, a Seal Red band reading SEALED, is not a link, and never moves. Exams join the rack from a single registry entry (slug, path, name, series code, corpus, top subjects).

### Registration Grid
Corpus figures set digit by digit in 1.9 by 2.4rem ground-coloured cells with hairline frames, Courier Prime 700 at 1.25rem, under field labels, inside a ruled box. On the UPSC cover the digits stamp in on load (320ms, 45ms stagger per digit), a page-local entrance rather than a system motion.

### Index and Contents Rows
Numbered rows with a serial marker, an Archivo title, a dotted hairline leader, and a trailing count or state. In contents pages the state is OPEN in Green Text Ink or COMING in Faint Ink; coming titles drop to Soft Ink.

## Do's and Don'ts

### Do:
- **Do** fill whole regions with Institutional Green (masthead, series band, colophon, the one primary button, the current pager cell) and use Green Text Ink whenever green must be read as text.
- **Do** keep exactly one filled-green action per page, the search submit; every other action is outlined in a 2px Heavy Rule on paper.
- **Do** draw structure with the two rule weights: 2px Heavy Rule for frames and edges, 1px hairline for grouping, dashed for folds and seal lines, dotted for leaders.
- **Do** set every question serial, count, code, year and option key in Courier Prime, and nothing else.
- **Do** cap reading text at 68ch and keep question text pre-wrapped.
- **Do** consume semantic tokens only, so a new surface works on both stocks without a theme branch; check new text colours at 4.5:1 on both ground and paper in both themes.
- **Do** keep the question block's classes in the shared stylesheet so static and client-rendered questions stay identical.
- **Do** draw icons as inline SVG strokes at 1.4 with round caps, coloured by currentColor.

### Don't:
- **Don't** use the field green as a text colour; on dark stock it measures 1.36:1.
- **Don't** use exam red for buttons, links, headings, highlights or decoration; it is stamp ink and seal paper only.
- **Don't** let the seal band follow the stamp to its light dark-theme value; a seal stays deep red with white ink.
- **Don't** round a corner anywhere.
- **Don't** add a resting shadow, a glow, or a gradient fill to any surface; the only shadow is the spine lift.
- **Don't** add motion beyond the cover lift and the answer lift (the UPSC cover's digit stamp-in is a page-local entrance, not a pattern to repeat), and never ship motion that survives prefers-reduced-motion.
- **Don't** mark the correct option before the reader opens the answer.
- **Don't** underline question-heading links at rest; the serial carries the permalink cue.
- **Don't** use the uppercase field label as an eyebrow above a headline; it labels a field or box.
- **Don't** use an indigo hero, a row of rounded feature cards, or student illustration.
