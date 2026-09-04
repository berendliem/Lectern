# Lectern — design direction

Date: 2026-09-04
Status: Direction proposed; §7 is the phase that would land it

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
| File | `public/brand/lectern-logo.png` |
| Pixels | 2170 × 725 (2.99 : 1 — treat as 3 : 1) |
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
  `lectern-logo-dark.png` (§9), never a filter.
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

Action and ink separate, which is what the current system conflates:

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
| Page title | `text-2xl font-bold tracking-tight text-gradient` | Drop `text-gradient` → navy. A gradient headline is decoration pretending to be hierarchy |
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
| Primary button | `rounded-lg grad-brand px-3 py-2 text-sm font-medium text-white shadow-brand` → becomes solid navy |
| Secondary button | `rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-soft` |

These are the semantic tokens from §9 — a literal `bg-white` or `text-zinc-500`
in new code is a bug, because it will not follow the theme.

Radii: `lg` for controls, `xl` for rows, `2xl` for panels, `full` for pills. One
shadow, on primary actions only — under the new palette, `.shadow-brand`'s violet
glow becomes a navy one.

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

## 7. Phase 7 — visual identity alignment

Written in the shape the spec's other phases use, so it can drop into
`docs/superpowers/specs/2026-08-28-lectern-course-library-design.md` §13.

**Goal:** one product, one identity. The interface currently ships a generic
violet gradient while the mark is navy and gold; this phase moves ink and action
onto the brand and removes the decoration that fights the content.

**Contents**

1. **Tokens** (`src/app/globals.css`) — repoint `--brand-from/mid/to` and
   `--color-brand*` to the navy ramp; add `--color-gold`, `--color-bronze`;
   change `--foreground` to `#001B42` and `--background` to `#FBFAF7`; delete the
   three radial washes on `body`; recolour `.shadow-brand` to a navy glow.
2. **`.grad-brand` and `.text-gradient`** — replace the gradient CTA with solid
   navy and remove `text-gradient` from page titles. These two classes have ~30
   call sites; a codemod plus a screen-by-screen pass, not a find-and-replace.
3. **Active nav** — navy fill with a 2px gold left rule, replacing the gradient
   pill (`FolderSidebar.tsx`).
4. **Coverage strip** — build the signature element on the course Overview above
   the existing topic list, with its text summary (`CourseOverview.tsx`).
5. **Focus states** — a single gold focus ring token, applied wherever
   `ring-brand-soft` appears.
6. **Sweep** — every screen at 375px and 1440px, in **both** themes.

**Explicitly not in scope:** a new typeface, an icon-set change, touching the
six pastel state families, and any layout restructuring. This phase changes
colour, not composition.

Dark mode is **already shipped** (§9) and is what makes this phase cheaper than
it looks: every surface now reads its colour from a semantic token, so the
navy/gold migration is a change to token values plus the gradient call sites,
not a sweep through 183 hardcoded utility classes.

**Risks**

- `.grad-brand` and `.text-gradient` are load-bearing across the app; a partial
  migration looks worse than either endpoint. Land it in one PR.
- Gold fails contrast as text (2.2 : 1). Every gold usage must be a fill or a
  rule, with bronze as its text form — this is the mistake most likely to ship.
- The pastel families were chosen against a violet brand; on parchment they need
  a second look, not a redefinition.

**Done when:** the sidebar's active item, the primary buttons, and the page
titles all belong to the same family as the logo above them; no gradient text
remains; the course Overview leads with the coverage strip; and every screen has
been checked at both widths.

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
| `--surface` | `#ffffff` | `#161922` | Cards, rows, panels, inputs |
| `--surface-2` | `#fafafa` | `#1c202b` | Hover fills, quiet blocks |
| `--surface-3` | `#f4f4f5` | `#232834` | Chips, assistant bubbles |
| `--line` | `#e4e4e7` | `#2b3140` | Borders, dividers |
| `--line-strong` | `#d4d4d8` | `#3a4152` | Hover borders, inputs |
| `--ink` | `#18181b` | `#f2f3f7` | Primary text |
| `--ink-soft` | `#3f3f46` | `#d3d6de` | Secondary text |
| `--muted` / `--muted-2` | `#71717a` / `#a1a1aa` | `#9ba2b0` / `#7b8290` | Labels, metadata |
| `--background` | `#fbfaff` | `#0d0f16` | Page ground |
| brand ramp | violet → magenta | lifted violet → magenta | CTAs, active nav |

Three rules fell out of building it, and they are the ones to keep:

1. **A near-black chip is not a colour, it is an inversion.** The chat "you"
   bubbles were `bg-zinc-900 text-white`; on a dark ground they vanished. They
   are now `bg-ink text-surface` — the same appearance in light, correctly
   flipped in dark.
2. **White is a surface, not a stroke.** The focus timer's ring track was
   `#ffffff` and blew out in dark; it reads `var(--surface)` now.
3. **The logo needs a second file, not a filter.** The mark's navy has to lift
   on a dark ground while the gold stays gold, which no single CSS filter does.
   `lectern-logo-dark.png` recolours only the navy family; the sidebar swaps the
   two with `dark:hidden` / `hidden dark:block`.

The violet radial washes on `body` are light-mode only — on a near-black ground
they turn to smears, so dark mode gets a flat field.

**Still to check** when content exists on screen: the six pastel state families
were picked against white and are bright on dark. They stay legible (dark ink on
a pastel fill), but a future pass should give them dark-theme values rather than
reusing the light ones.