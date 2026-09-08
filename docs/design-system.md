# Lectern — design direction

Date: 2026-09-04
Status: Direction shipped — §7 landed on 2026-09-08

The logo arrived after the interface did, and they disagree. This document reads
the direction out of the mark, measures what the app currently ships, names the
gap honestly, and ends with a phase that closes it.

Everything here is measured rather than asserted: hexes are sampled from the
logo's pixels, contrast ratios computed with the WCAG relative-luminance
formula, and every class named is one that exists in the codebase today.

---

## 1. The mark, and the direction it implies

A lectern whose top opens into a book, with a gooseneck microphone rising from
it. Those are the two halves of the product in one object: the lecture as it is
spoken, and the lecture as it is studied. The wordmark beside it is heavy,
geometric, all-caps, tightly set — closer to a university crest than to a
software logo.

| Fact | Value |
|---|---|
| File | `public/brand/lectern-lockup.png` |
| Pixels | 2172 × 724 (3.00 : 1) |
| Background | transparent; only 15% of the canvas is opaque ink |
| Navy | `#001B42` (89% of the ink) |
| Gold | `#D5A95C` (8%) |

**Read the direction from the subject, not from taste.** Navy and gold on an
academic mark is the visual language of a university: a lecture hall, a crest, a
library spine. That is exactly what the product is — a student's course library,
opened most days of the term, sitting beside a syllabus. The direction is
**quiet institutional**: dense, scannable, unhurried, deferring to the user's own
content. Not a landing page, not a SaaS dashboard.

**The one memorable thing** should be the syllabus coverage strip on the course
Overview — the idea no other note app has. Everything else stays disciplined so
that it stands out.

### Logo usage

- **Clear space:** the cap height of the "L" (≈27% of lockup height) on every
  side. The sidebar's `pt-5 pb-3` provides it.
- **Minimum size:** 96px wide / 32px tall. Below that the microphone stem and
  the gap between the book's pages stop resolving. The sidebar renders it at
  `h-12 w-auto` (48px tall, ~144px wide).
- **Grounds:** the sidebar's `from-surface to-brand-soft` gradient in either
  theme, plain white, or navy `#001B42`. On dark grounds use
  `lectern-lockup-dark.png` (§9), never a filter.
- **Never:** recolour, add a shadow, box it in a coloured chip, set it on a
  mid-tone or busy ground, stretch it, or pair it with a text label — the lockup
  already contains the wordmark.

---

## 2. Colour

### 2.1 Brand core, from the logo

| Token | Hex | Role |
|---|---|---|
| Navy | `#001B42` | Ink: headings, body, icons; the one dark surface the brand owns |
| Deep navy | `#00112B` | Hover/pressed state for navy surfaces |
| Gold | `#D5A95C` | Accent as a **fill**, never as text on light |
| Bronze | `#8A6A2F` | The legible form of gold: text and icons on light grounds |
| Parchment | `#FBFAF7` | Page ground — warm, paper-adjacent, replaces the violet-tinted `#fbfaff` |

Measured contrast:

| Pair | Ratio | Verdict |
|---|---|---|
| Navy on white | 17.0 : 1 | AAA at any size |
| White on navy | 17.0 : 1 | AAA — navy is a safe inverted surface |
| Navy on gold | 7.8 : 1 | AA for body text — gold fill with navy text works |
| Bronze on white | 5.0 : 1 | AA for body text |
| **Gold on white** | **2.2 : 1** | **Fails everything.** Never text, never a meaningful icon |
| Current violet on white | 5.7 : 1 | Passes, for reference |

Gold is the smallest quantity in the mark (8% of its ink) and should stay the
smallest quantity on screen: a coverage bar, a due-count pill, a focused input's
ring. The moment it carries meaning as text, it fails contrast.

### 2.2 What ships today, and why it fights the logo

`globals.css` defines a violet→magenta brand (`--color-brand: #7c3aed`,
`.grad-brand`, `.text-gradient`, `.shadow-brand`) over a `#fbfaff` ground washed
with three fixed radial gradients. Page titles are gradient-filled text; primary
buttons and the active nav item are gradient pills.

Two problems, in order of importance:

1. **It is the generic default.** A violet-to-magenta gradient with soft radial
   blobs and gradient headline text is the single most recognisable signature of
   generated UI. It says nothing about lectures, syllabi, or study.
2. **It contradicts the mark.** A navy-and-gold academic crest sits directly
   above a magenta pill in the same 256px column. They read as two products.

The pastel content families (`blush`, `daisy`, `lavender`, `moss`, `sky`,
`coral`) are **not** the problem. They encode state — `moss` for mastered,
`daisy` for learning, zinc for new (`src/lib/mastery.ts`) — and a
multi-dimensional palette for status is correct. They keep their roles.

### 2.3 The proposed system

Shipped in §7. Action and ink separate, which is what the violet system conflated:

| Role | Now | Proposed |
|---|---|---|
| Ink / headings | `#2b2540`, gradient-filled titles | Navy `#001B42`, solid |
| Primary action | Violet→magenta gradient pill | Solid navy, white label |
| Active nav | Gradient pill | Navy fill, white label, gold 2px left rule |
| Accent / emphasis | Violet | Gold fill; bronze when it must be text |
| Page ground | `#fbfaff` + 3 radial violet washes | Parchment `#FBFAF7`, flat |
| Focus ring | `ring-brand-soft` (violet) | `ring-2` gold at 40% over navy offset |
| State (mastery, status) | Six pastel families | Unchanged |

Dropping the radial washes is not cosmetic thrift: they are `background-attachment: fixed`
decoration behind every screen, and on a page whose job is to hold a wall of
lecture titles they add noise to the exact area the eye scans.

---

## 3. Typography

Geist Sans and Geist Mono are already loaded (`layout.tsx`). Geist is a neutral,
well-drawn grotesque — keep it for the interface. The wordmark supplies the
institutional voice; the UI does not need a second display face.

| Use | Current class | Change |
|---|---|---|
| Page title | `text-2xl font-bold tracking-tight` | Inherits `--ink`; §7 dropped the gradient fill. A gradient headline is decoration pretending to be hierarchy |
| Section heading | `text-[15px] font-semibold` | Keep |
| Body / row | `text-sm` | Keep |
| Secondary line | `text-[13px]` / `text-[12.5px]`, `text-muted` / `text-muted-2` | Keep |
| Eyebrow | `text-[11px] font-semibold uppercase tracking-wider` | Keep **only** where it labels a navigation tier (`GLOBAL`, `YOUR COURSES`). An all-caps eyebrow above ordinary content is template chrome |
| Numerals | add `tabular-nums` | Keep — counts sit in columns and must not jitter |

Line length: body copy caps at ~72 characters. The lecture list and notes column
already sit inside `max-w-4xl`/`max-w-3xl`; keep new reading surfaces there.

---

## 4. Structure and surfaces

| Element | Recipe (existing) |
|---|---|
| List row | `rounded-xl border border-line bg-surface px-4 py-3` |
| Panel | `rounded-2xl border border-line/80 bg-surface p-5` |
| Empty state | `rounded-2xl border border-dashed border-line-strong py-14 text-center text-sm text-muted-2` |
| Primary button | `rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white shadow-brand` |
| Secondary button | `rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-soft` |
| Field | `rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:ring-2 focus:ring-gold` |
| Brand as text | `text-brand-ink` — never `text-brand`, which is a fill value and fails contrast on a dark surface |

These are the semantic tokens from §9 — a literal `bg-white` or `text-zinc-500`
in new code is a bug, because it will not follow the theme.

Radii: `lg` for controls, `xl` for rows, `2xl` for panels, `full` for pills. One
shadow, on primary actions only — `.shadow-brand` is a navy glow.

Structure should encode information, not decorate it. Two things earn a border in
this product: a row that is a discrete object (a lecture, a material, a topic),
and a panel that groups a workflow. Nothing else. No card inside a card.

Three tiers of navigation, matching the IA in
`docs/superpowers/specs/2026-08-28-lectern-course-library-design.md` §11:

- **Global** — sidebar under a `GLOBAL` eyebrow; the active item is the only
  filled element in the column.
- **Course** — tabs on the course page. A tab label may carry a count, and the
  Overview tab carries the coverage gap (`Overview (2 uncovered)`) — a number
  that changes behaviour, not a badge for its own sake.
- **Lecture** — a row of quiet secondary buttons under the header
  (`LectureActions.tsx`), each pre-seeded from that lecture.

### The signature element: the coverage strip

Course Overview is where the product's idea lives. Give it the one expressive
moment in the app: a full-width strip of segments, one per syllabus topic, navy
where a lecture stands behind the topic and gold where nothing does — a syllabus
seen at a glance, with the gaps literally glowing. Everything below it stays a
plain list. Navy-on-gold is 7.8 : 1, so the segment labels remain legible, and
the strip needs a text summary beside it ("11 of 14 topics covered") because
colour alone is never the only channel.

---

## 5. Motion

The app is opened daily and used repeatedly; motion earns its place only by
explaining a change.

- **Keep:** the tab and route transitions already present, hover feedback on
  rows, spinner states during generation.
- **Add nothing** on page load. Section-by-section fade-and-slide entrances are
  the generated-page tell, and on the second visit they are just latency.
- **One considered exception:** the coverage strip may animate its segments once,
  on first paint after a syllabus parse — that is a genuine state change worth
  showing.
- Respect `prefers-reduced-motion` for anything added.

---

## 6. Words

Copy is design content. The rules already implicit in the codebase, made
explicit:

- Say **course** and **lecture**, never "folder" or "page" — whatever the Prisma
  models are called.
- Buttons name what happens: "Parse syllabus", "Schedule review", "Generate
  flashcards". Never "Submit".
- The same action keeps its name through the flow: "Parse syllabus" → "Parsing…"
  → the topic list.
- Errors say what happened and what to do: "Upload a syllabus to this course
  first", not "Operation failed".
- Empty states invite the next action, and admit uncertainty where the product is
  uncertain: "No lecture covers this yet" is a hint, never an accusation.
- Sentence case everywhere except the two navigation-tier eyebrows.

---

## 7. Phase 7 — visual identity alignment (shipped)

Landed 2026-09-08. **Goal:** one product, one identity. The interface shipped a
generic violet gradient while the mark is navy and gold; this phase moved ink and
action onto the brand and removed the decoration that fought the content.

**What landed**

1. **Tokens** (`src/app/globals.css`) — the whole `--brand*` family is the navy
   ramp; `--gold` and `--bronze` are new; `--foreground` and `--ink` are
   `#001B42`, `--background` is `#FBFAF7`; the three radial washes on `body` are
   gone; `.shadow-brand` is a navy glow.
2. **The gradient classes are deleted.** `.grad-brand`, `.grad-brand-soft` and
   `.text-gradient` no longer exist. Because the brand is now one flat colour,
   the migration was a rename to the utilities Tailwind already generates from
   the tokens — `bg-brand`, `bg-brand-soft` — rather than the codemod the plan
   expected. Page titles lost `text-gradient` and inherit `--ink`.
3. **Active nav** (`FolderSidebar.tsx`) — navy fill with a gold left rule. The
   rule is an inset shadow, not a border: a 2px border is clipped away by the
   pill's own radius and reads as a sliver. The sidebar's violet-to-white
   gradient ground is now flat `surface-2`.
4. **Coverage strip** (`CourseOverview.tsx`) — one segment per syllabus topic
   above the topic list, navy where a lecture stands behind the topic and gold
   where nothing does, with the count as a sentence beneath it. It renders only
   when a coverage verdict exists: with no verdict every segment would read as
   uncovered, which is the accusation §6 forbids, so the summary line stands
   alone instead.
5. **Focus states** — every `ring-brand-soft` is now `ring-gold`, one ring for
   the whole app.
6. **Sweep** — Courses, course Overview, Ask, Review, Planner, Focus timer and
   Feynman coach, at 375px and 1440px, in both themes.

**The one thing the plan got wrong.** It assumed a single `--brand` could serve
both roles. It cannot in dark mode: the fill needs to be dark enough to carry
white button text, and brand-as-text needs to be light enough to read on a dark
surface — 7.1 : 1 and 8.9 : 1 respectively, from opposite ends of the ramp. So
`--brand-ink` joined the family and the 76 `text-brand` call sites became
`text-brand-ink`. In light mode both values are the same navy.

**Out of scope, and still out:** a new typeface, an icon-set change, the six
pastel state families, and layout restructuring. The one composition change was
`flex-wrap` on the course header, whose action row was clipped at 375px before
this phase and would still be after it.

**Known debt this phase leaves.** The pastel families are still light-mode
values (§9, "still to check"), which is why the coverage-unavailable notice is a
bright daisy block on a dark ground. Four literal `zinc` values survive in
scrims and disabled states (`Modal`, `CommandPalette`, `AppShell`, `Button`).

---

## 8. Checklist for new UI

1. Reuse a recipe from §4 before writing new classes.
2. Colour by meaning: navy for ink and action, gold as accent fill, a pastel
   family for state, the `surface`/`line`/`ink` tokens for structure — never a
   literal zinc or white.
3. Check contrast on any new colour: 4.5 : 1 body, 3 : 1 large text and
   meaningful icons.
4. Visible focus ring on every interactive element; `aria-label` on every
   icon-only control.
5. No motion on load; motion only where something changed.
6. Read the copy back as a sentence a student would say.


---

## 9. Themes (shipped)

Light and dark, switched by the control in the header and remembered per
browser.

**How it works.** The theme's home is a `dark` class on `<html>`. An inline
script in `layout.tsx` sets it before first paint — from `localStorage`
(`lectern.theme`), falling back to `prefers-color-scheme` — so a reload never
flashes the wrong theme. `ThemeToggle.tsx` reads that class through
`useSyncExternalStore` rather than owning a copy of the state, which is why the
server-rendered HTML and the hydrated client agree.

**Semantic tokens.** Components no longer name literal colours. Every surface,
line, and text tone comes from a token that has a value in each theme:

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--surface` | `#ffffff` | `#141c2c` | Cards, rows, panels, inputs |
| `--surface-2` | `#f7f5f0` | `#1a2436` | Hover fills, quiet blocks, sidebar |
| `--surface-3` | `#efebe2` | `#212c41` | Chips, assistant bubbles |
| `--line` | `#e3dfd5` | `#26314a` | Borders, dividers |
| `--line-strong` | `#cfc9bb` | `#35425e` | Hover borders, inputs |
| `--ink` | `#001b42` | `#edf1f8` | Primary text |
| `--ink-soft` | `#2e4568` | `#c7d0e0` | Secondary text |
| `--muted` / `--muted-2` | `#5c6b85` / `#8593a8` | `#93a0b5` / `#74819a` | Labels, metadata |
| `--background` | `#fbfaf7` | `#0b1220` | Page ground |
| `--brand` | `#001b42` | `#2f5896` | Button and active-nav fills |
| `--brand-ink` | `#001b42` | `#9dbdf0` | Brand as text: links, icons |
| `--gold` / `--bronze` | `#d5a95c` / `#8a6320` | `#d5a95c` / `#e5c489` | Rules and focus rings / their text form |

Three rules fell out of building it, and they are the ones to keep:

1. **A near-black chip is not a colour, it is an inversion.** The chat "you"
   bubbles were `bg-zinc-900 text-white`; on a dark ground they vanished. They
   are now `bg-ink text-surface` — the same appearance in light, correctly
   flipped in dark.
2. **White is a surface, not a stroke.** The focus timer's ring track was
   `#ffffff` and blew out in dark; it reads `var(--surface)` now.
3. **The logo needs a second file, not a filter.** The mark's navy has to lift
   on a dark ground while the gold stays gold, which no single CSS filter does.
   `lectern-lockup-dark.png` recolours only the navy family; the sidebar swaps the
   two with `dark:hidden` / `hidden dark:block`.

Both themes now get a flat field. The violet radial washes were light-mode only
(on a near-black ground they turned to smears); §7 removed them from light mode
too, as decoration that fought the content.

**Still to check** when content exists on screen: the six pastel state families
were picked against white and are bright on dark. They stay legible (dark ink on
a pastel fill), but a future pass should give them dark-theme values rather than
reusing the light ones.