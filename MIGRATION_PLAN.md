# Tandem → Tailwind CSS Migration Plan

**Status: audit complete, no code changed. This document is a planning
deliverable only — nothing described here has been implemented.**

Scope of this pass: inspect Tandem (`mraaronbautista/tandem`, this repo,
local path `/Users/aaron/Projects/psyberscribe`) and a2
(`mraaronbautista/a2`, local path `/Users/aaron/Projects/a2`) in full, and
produce a concrete plan for migrating Tandem's hand-written CSS to Tailwind
CSS — adopting a2's Tailwind conventions and mobile navigation patterns
where they fit, while treating Tandem's existing functionality, business
logic, and desktop UX as the source of truth. Mobile navigation
consolidation is explicitly in scope; desktop redesign and business-logic
changes are not.

Everything in Sections 1–3 is a direct report of what exists today, cited
by file and line. Sections 4 onward are analysis, proposals, and rules —
clearly separated from the factual audit above them.

A real Tailwind-coexistence spike was already run against this repo (branch
`design/a2-look`, commit `d441fa1`) as part of an earlier, narrower planning
pass. Its findings are real, tested evidence (not inference) and are folded
into Section 6 below, cross-validated against this deeper audit.

---

## 1. Tandem CSS architecture

### 1.1 File inventory

| File | Lines | Role |
|---|---|---|
| `src/index.css` | 122 | Design tokens (`:root` custom properties + light/dark overrides), base document styles (`body`, `h1`/`h2`, `box-sizing`), the one `!important` rule in the codebase. |
| `src/App.css` | 4,481 | The entire application's hand-authored class library. One flat file, no CSS Modules, no preprocessor, no per-component stylesheets. Covers every screen and is extensively commented — most rule blocks explain *why*, not just *what*. |

No other CSS exists anywhere in the repo — no `*.module.css`, no CSS-in-JS,
no `styled-components`/`emotion` dependency. There is also no CSS
framework currently in use on `main` (confirmed absent from
`package.json` and both stylesheets).

*(A `design/a2-look` branch adds `postcss.config.js` and `src/tailwind.css`
as an unmerged experimental spike — see Section 6. It is not part of `main`
and is not counted in the architecture below.)*

### 1.2 Design tokens (`src/index.css`)

Three token layers: a base `:root` block (light values), an OS-driven
override (`@media (prefers-color-scheme: dark)` on plain `:root`), and two
explicit-choice overrides (`:root[data-theme='dark']` /
`:root[data-theme='light']`) that win over the OS setting — set by
`src/lib/useTheme.js` via a `data-theme` attribute on `<html>`, persisted to
`localStorage`. This is architecturally identical to how a2 themes itself
(see Section 3.2) — a genuinely easy, low-risk pattern to carry into
Tailwind's `@theme` block unchanged.

| Token | Light | Dark | Heaviest consumers |
|---|---|---|---|
| `--text` | `#4a4550` | `#c7c2cc` | Default body/label text (12 uses) |
| `--text-h` | `#08060d` | `#f3f4f6` | Headings/high-emphasis text — the most-used token (52 uses): task titles, form input text, modal headings |
| `--bg` | `#faf7f2` | `#16171d` | Page background, most input/textarea backgrounds (13 uses) |
| `--card-bg` | `#ffffff` | `#1f2028` | Every "raised surface" — task rows, cork items, modals, nav bar (24 uses) |
| `--border` | `#e5e4e7` | `#2e303a` | The most-referenced token overall (82 uses) — hairlines, outlines, dividers |
| `--accent` | `#d9a066` | (no dark override) | Primary action color — FAB, active pills, submit buttons (46 uses) |
| `--accent-h` | `#c98a4a` | (no dark override) | Hover-state accent only (4 uses) |
| `--overdue` | `#c94f4f` | (no dark override) | The one semantic "danger" color (16 uses) |
| `--pill-bg` | `#f0eee8` | `#262832` | "Quiet chip/segment" background (32 uses) |
| `--radius-sm` / `-md` / `-lg` | `6px` / `10px` / `14px` | not redefined | Small controls / cards / modals respectively |
| `--shadow-resting` / `-raised` / `-floating` / `-press` | warm low-alpha | near-black higher-alpha | A full elevation system: default card shadow, hover-lift, FAB/modal top elevation, and an inset "pressed" shadow — a2 has no equivalent system (see Section 4). |
| `--ease-tactile`, `--dur-fast` (120ms), `--dur-base` (180ms) | same both themes | — | The app's entire transition vocabulary — 60+ combined uses |
| `--sans` | system-ui stack | — | Set once on `:root`, never re-declared in App.css |

Two colors function as de facto semantic tokens but are **hardcoded, not
declared as custom properties**: `#4caf7d` (online-status green,
`App.css:418`/`430`), `#e0a83e` (amber "notice" — overlap badge, negotiating
toggle, inbox nudge), `#22c55e`/`#dc2626` (rental surplus/deficit and
destructive-action red). These should become real tokens during migration
rather than staying as scattered hex literals.

### 1.3 Shared/reused CSS classes (3+ consumers)

| Class | Consumers | Pattern |
|---|---|---|
| `.submission-modal` | 17 files — the single most-reused class in the app | Base modal card + per-modal compound-class modifiers (`.submission-modal.how-to-guide-modal`, `.vault-modal`, etc.) for width/height overrides |
| `.period-tabs`/`.period-tab`/`.period-tab-active` | 8 files | Shared pill-capsule segmented control (Day/Week/Month, Add/Edit, All/Needs-reply/…, Guide/FAQ) |
| `.icon-button` | 3 files, 3 different sizes by ancestor context (32px base, 40px in `.header-actions` under 480px, 26px in `.month-nav-arrows`) | Circular icon button |
| `.month-nav-row`/`.month-nav-label`/`.month-nav-arrows`/`.month-nav-today-button` | 3 files | Generic "‹ Month Year ›" nav row, explicitly named neutrally per its own comment since Rentals and Today reuse it unrelatedly |
| `.task-done-checkbox` | 5 files | 18px accent checkbox |
| `.rental-add-booking`(`-primary`) | 5 files | Generic pill action button reused for several toolbar actions |
| `.modal-backdrop` | Structurally 1 file (`Modal.jsx`) but every dialog in the app renders through it | Shared positioning/dimming/slide-up-sheet logic for effectively every modal |
| `.rental-overview-list`/`-item` | 2 files, 2 different layouts via ancestor-context override | Same markup, vertical list by default, forced into a 2-per-row grid inside `.rental-calendar-toolbar` |

Not confirmed as 3+ reuse despite being an obvious candidate: **the
"priority dot" visual concept is implemented three separate times** under
three different class names — `.task-priority-dot` (`BulkAddTasksForm.jsx`,
`TaskRow.jsx`), `.timeline-dot` (`TimelineRow.jsx`), and
`.month-view-task-dot` (`MonthView.jsx`) — a real consolidation opportunity
the migration should take, not just preserve as-is.

### 1.4 Media queries & responsive breakpoints

| Breakpoint | Direction | What changes |
|---|---|---|
| `480px` | max-width | Phone-width density/touch-target tuning only (gaps, icon-button size, timeline sizing) — never structural |
| `640px` | max-width | **The modal shape breakpoint** — bottom slide-up sheet vs. centered card |
| `641px` | min-width | Inverse of 640px — fixed width/height for the centered-card modal variant |
| `899px` / `900px` | max/min-width | Same conceptual boundary from both sides — **the app's primary desktop breakpoint** |
| `(prefers-color-scheme: dark)` | media feature | One box-shadow override, mirrors the explicit-dark-theme rule |

**JS-driven *structural* branches** (different component trees, not just
repositioned CSS) — exactly two-and-a-half exist, all via the same
`src/lib/useMediaQuery.js` hook at the identical `(min-width: 900px)` query:

1. **`RentalsView.jsx:40`** — mobile renders a stacked, one-panel-at-a-time
   tree; desktop renders a genuinely different 2-column dashboard tree.
   This is the highest-value/highest-risk structural branch in the app.
2. **`TaskBoard.jsx:104`** — gates which of two `<nav>` elements mounts
   (bottom bar vs. header-folded nav); same underlying `navButtons`
   array/markup either way, restyled via a descendant selector — a
   borderline case, closer to CSS-only than #1.
3. **`MonthView.jsx:62`** — same hook, but only picks a content-density
   detail (chip previews vs. a count badge) within one shared grid
   structure — not a different tree.

Tandem keeps this 900px value in sync **by hand** across JS
(`useMediaQuery('(min-width: 900px)')` string, repeated in 3 files) and CSS
(`App.css:260`, `:1275`, `:2313`). A Tailwind `screens` override doesn't
automatically fix this — the JS-side string still needs to be kept in sync
separately, since Tailwind's config doesn't influence `matchMedia` calls.

### 1.5 `!important` usage

**Exactly one occurrence in the entire codebase**: `src/index.css:107-112`,
inside `.theme-transitioning, .theme-transitioning *, ... { transition:
none !important; }`. This is a deliberate global kill-switch (not a
specificity war) — `useTheme.js` briefly applies this class to `<html>`
while `data-theme` flips, so none of the dozens of theme-dependent
`transition:` rules in `App.css` render a visibly "stuck" wrong-color frame
mid-switch. **Must be preserved exactly** — see Section 9.

### 1.6 Pseudo-elements/pseudo-classes

- **`:focus-visible`** (`App.css:34-46`) — applies to every text
  input/textarea/select app-wide: accent border + a 3px accent-tinted
  focus ring, with native `outline` suppressed. **This is the only visible
  keyboard-focus indicator on form fields in the entire app** — load-bearing
  for accessibility, must be reproduced exactly, not simplified.
- **`:hover`** — the "raised card" pattern (`translateY(-1px)` +
  `--shadow-resting` → `--shadow-raised`) and accent → accent-hover swaps.
- **`:active`** — a near-ubiquitous "tactile press" pattern (scale-down +,
  on cards, a swap to `--shadow-press` inset shadow) — this is the app's
  core physical "feel" and is entirely pseudo-class driven.
- **`:disabled`** — dimming + `cursor: default`, purely visual (the actual
  disabling is the HTML attribute).
- **`:not()`** — both attribute-exclusion (`input:not([type='checkbox'])…`)
  and structural (`:root:not([data-theme='light'])`,
  `.task-list > section:not(:first-child)`).
- **`::before`/`::after`** — only inside the `!important` kill-switch
  selector (mechanical, not decorative).

### 1.7 Animations/transitions

Two `@keyframes` blocks, both hardcoded (not tokenized) since they're
continuous/progress animations rather than discrete state transitions:
`pull-to-refresh-spin` (`App.css:366-373`, `0.7s linear infinite`) and
`modal-slide-up` (`App.css:2529-2536`, `0.2s ease-out`, mobile-sheet-only).

Everything else routes through two duration tokens paired with one easing
curve: `--dur-fast` (120ms, `:active` press feedback) and `--dur-base`
(180ms, hover/state transitions), both with `--ease-tactile:
cubic-bezier(0.22, 1, 0.36, 1)`. A handful of measurement-driven
transitions (pull-to-refresh height, a savings-bar fill width) bypass the
tokens with their own literal durations.

### 1.8 DOM-structure-dependent styles — migration hazards

These rely on sibling/order relationships and would silently break if each
element got an independent utility class without preserving the
relationship:

1. **`App.css:271-274`** — `.task-list > section:not(:first-child)` draws a
   divider between Today-tab section groups except the first.
2. **`App.css:518-524`** — the inverse: every section gets top margin
   except the first.
3. **`App.css:1844-1852`** — `.eod-report-item:last-child` removes the
   trailing border/padding between report items within a month group.

All three are exactly what Tailwind's native `divide-y`/`space-y-*`
utilities are built for — a genuine improvement opportunity, not just a
faithful port, **provided** the "all but one edge" behavior is preserved.

Additionally, a large number of **ancestor-context** rules exist (not
order-dependent, but parent-dependent) — e.g. `.header-nav
.task-board-nav-item`, `.rental-calendar-toolbar .rental-overview-list`,
`.view-mode-row .who-select` — where the *same* class renders differently
purely because of which parent wraps it. A flat per-element utility-class
conversion loses this relationship unless re-expressed as an explicit
variant or a separate component.

### 1.9 Third-party styling

No fonts (pure system-font stack), no icon library (emoji glyphs + a small
hand-authored `currentColor`-based inline SVG set in `src/components/icons.jsx`),
no CSS framework. **`react-router-dom` is a listed dependency but is
genuinely unused** — confirmed zero references anywhere in `src/`; `App.jsx`
just conditionally renders `Login` or `TaskBoard` based on session state.

### 1.10 Touch/interaction CSS and JS

**No CSS touch hints exist anywhere** — `touch-action`,
`-webkit-overflow-scrolling`, `overscroll-behavior`, and `user-select` all
return zero matches. Every gesture is pure JS coordinate math with no
browser-hinting assistance. `cursor:` appears 74 times, always plain
`pointer`/`default`.

**Three independent, unshared gesture implementations**, all
touch-coordinate-delta based:

1. **`PullToRefresh.jsx`** — a *running* `touchmove` tracker (unlike the
   other two), `THRESHOLD = 70`, only engages when `window.scrollY === 0`.
   Depends on `.pull-to-refresh-indicator`'s CSS height transition and the
   `pull-to-refresh-spin` keyframe.
2. **Day/Month swipe in `TaskBoard.jsx`** (two near-identical copies,
   `handleDaySwipeStart/End` and `handleMonthSwipeStart/End`) — a
   `touchstart` vs. final `touchend` position comparison (no running
   tracker, no `preventDefault()`), `SWIPE_MIN_DISTANCE = 60`, an
   angle-gate (`|dx| < |dy| * 1.5` rejects the swipe) so it can't misfire
   during vertical scrolling. **Depends on `.task-list { min-height: 50vh
   }` (`App.css:509-512`)** — without this, an empty day's task list
   collapses to just its "Nothing here." text line and the swipe's hit
   area shrinks to that sliver, since the handlers are on `.task-list`
   itself.
3. **Month swipe in `RentalsView.jsx`** — a mobile-only wrapper `<div>`
   around `<RentalCalendar>` (not code inside `RentalCalendar.jsx` itself),
   same threshold/angle-gate math, no runtime desktop gate needed since
   Rentals already has two fully separate JSX trees.

All three are independent copies of essentially the same ~15-line gesture,
by deliberate choice per the code's own comments (not an oversight) — a
real consolidation candidate, but **only as a refactor explicitly requested
later**, not as a side effect of the CSS migration (see Section 9's "no
unrelated refactors" rule).

### 1.11 Accessibility-relevant markup/CSS

- **`.visually-hidden`** (`App.css:1-15`) — standard screen-reader-only
  clip pattern, used for real `<label>`s paired with placeholder-only
  inputs.
- **`Modal.jsx`** — `role="dialog" aria-modal="true"`, a real focus-trap
  (Tab/Shift+Tab cycling), and focus restoration on close. This is the
  single most load-bearing a11y implementation in the app — every one of
  the 17 `.submission-modal` callers inherits it for free.
- **`aria-label`** — 36 occurrences across 15 files, concentrated on
  icon-only/emoji-only buttons.
- **`aria-pressed`** — one use, correctly reflecting the negotiating
  toggle's boolean state.
- **No skip-link** anywhere — a pre-existing gap, not something the
  migration needs to fix unless asked.
- The app generally prefers real form controls (native checkbox/select)
  over ARIA-widget reimplementations, reaching for `role="button"` +
  manual `onKeyDown` only where a real `<button>` can't be nested
  (`RentalOverview.jsx`'s negotiating-toggle-inside-a-clickable-card case).

---

## 2. Tandem component/navigation architecture

### 2.1 Navigation/screen map

**Five persistent primary tabs** (`TABS`, `TaskBoard.jsx:77-83`), rendered
through one shared `navButtons` array mounted into either the mobile bottom
bar or the desktop header-folded nav:

| Tab | Component(s) | Classification |
|---|---|---|
| Today | `TaskBoard.jsx` (inline) + `AllDayRow`, `TimelineRow`, `DayTimeline`, `MonthView`, `DateStrip`, `DatePickerModal` | Primary |
| Rentals | `RentalsView.jsx` + 5 sub-components | Primary |
| Reports | `EodReportsList.jsx` | Primary |
| Cork Board | `CorkBoardView.jsx` | Primary |
| Inbox | `InboxView.jsx` | Primary (carries an unread-dot badge) |

**Floating "+" speed-dial** (`NewTaskForm.jsx`, the FAB):

| Item | Component(s) | Classification |
|---|---|---|
| New task | `TaskForm.jsx` | One-shot action |
| Bulk add/edit tasks | `BulkAddTasksForm.jsx` (+ nested `TaskExportForm.jsx`) | One-shot action |
| Priorities | `PrioritiesForm.jsx` + `PriorityItemsEditor.jsx` | One-shot action |
| Submit report (Aaron only) | `EndOfDayReportForm.jsx` | One-shot action |
| Vault | `VaultView.jsx` + 3 sub-components | **Borderline** — technically a speed-dial item, but functions as a browsable secondary destination (its own folder navigation, list of entries) rather than a single completing action |

**Header** (present on every tab): working-status toggle/badge (persistent
inline control, not a destination), a 👋 nudge icon (Ada-only, one-shot,
no UI beyond the icon), and ⚙️ Settings (one-shot modal) containing one
nested secondary destination — **How to use this app** (`HowToGuide.jsx`,
its own Guide/FAQ accordion tabs).

**Contextual modals** not reached via nav/speed-dial/settings:
`DatePickerModal`, inline `TaskForm` edit mode, `TaskClarifications` (a
secondary-destination-in-miniature — a persistent per-task thread, but no
standalone entry point), and the five Rental sub-forms, all opened from
within their parent screen.

### 2.2 Primary / secondary / groupable classification

Restating the above for navigation-planning purposes:

- **True primary destinations** (browsed often, hold ongoing state): Today,
  Rentals.
- **Primary destinations that are lower-frequency but still deserve
  first-class access**: Reports (periodic but recurring, at least for
  Aaron), Inbox (reactive — you check it when something's pending, and it
  carries a live unread indicator).
- **Casual/secondary**: Cork Board (freeform scratch space, no urgency of
  its own).
- **Genuinely secondary, already correctly demoted out of the tab bar**:
  Vault (rare, sensitive, browsable-but-occasional — correctly reached via
  the FAB today).
- **Logical grouping candidate**: Cork Board and Inbox already overlap
  conceptually — both are "shared, non-scheduled" spaces, and Inbox's own
  `InboxView.jsx` already reuses Cork Board's editing/commenting UI
  patterns and shows completion-submission/nudge activity that's
  conceptually adjacent to Cork Board's "shared board" framing. This is
  the single most defensible merge candidate in the app (see Section 8).

### 2.3 Full component inventory

48 files under `src/components/`, 16 under `src/lib/` — see the audit
appendix data gathered for this report for the complete one-line-each
list; the highest-level groupings are: **Today/task-board** (12
components), **Rentals** (9 components), **Vault** (4 components),
**Cork Board** (1), **Inbox** (1), **Reports** (2), **shared
primitives** (`Modal.jsx`, `ScrollSelect.jsx`, `icons.jsx`,
`AttachmentList.jsx`, `PullToRefresh.jsx`), and **settings/misc**
(`SettingsMenu.jsx`, `HowToGuide.jsx`, `ThemeToggle.jsx`,
`WorkingStatusToggle.jsx`, `Login.jsx`).

---

## 3. a2 analysis

### 3.1 Tailwind setup

Tailwind **v4.3.3**, wired purely through PostCSS
(`@tailwindcss/postcss` + `autoprefixer` in `postcss.config.js`) — **no**
`@tailwindcss/vite` plugin, **no** `tailwind.config.js`/`.ts` file
anywhere. This is a fully CSS-first v4 setup: all customization lives in
one `@theme` block inside `src/index.css`. No `content` globs to maintain,
no `darkMode` config option (dark mode is done manually via a data
attribute, not Tailwind's `dark:` variant — confirmed zero `dark:` uses
anywhere in the codebase).

### 3.2 Design tokens

```css
@theme {
  --font-sans: system-ui, 'Segoe UI', Roboto, sans-serif;
  --color-bg: #faf7f2;
  --color-surface: #ffffff;
  --color-ink: #1b2436;
  --color-ink-muted: #5b6478;
  --color-border: #e6e1d8;
  --color-navy: #1b2436;
  --color-navy-light: #2c3855;   /* declared, never actually used anywhere */
  --color-accent: #d97a4d;
  --color-accent-bg: #fbe9de;
}
```

Nine tokens (one font, eight colors) — no custom radius/spacing/shadow
theme keys at all; every radius/shadow/spacing value in the app is a stock
Tailwind default utility. The **dark-mode-via-CSS-variable-reassignment**
pattern (not `dark:` variants) is the single most valuable, directly
portable idea here — it means a component only ever writes
`bg-bg`/`text-ink`/etc. once, and theming is free.

Real, undeclared-but-consistent "tokens" found by usage frequency:
`rounded-lg` (66×, controls), `rounded-full` (39×, pills/circles),
`rounded-xl` (9×, list-item cards), `rounded-2xl`/`rounded-t-2xl` (12+11×,
modals) — a clean, if informal, **radius hierarchy: lg = control, xl =
card, 2xl = modal, full = pill/circle**. Two genuinely necessary arbitrary
values exist: `text-[10px]`/`text-[11px]` for weekday letters and
bottom-nav labels, below Tailwind's smallest default (`text-xs`/12px).

### 3.3 Typography, spacing, borders/radii/shadows (in practice)

- **Type scale**: `text-sm` (122×) is the app-wide default for
  body/labels/buttons; `text-xs` (75×) for meta/secondary text; `text-2xl
  font-semibold text-navy` for every page `<h1>`; `text-lg` for
  modal/detail titles. Exactly two font weights are used anywhere:
  `font-medium` and `font-semibold`.
- **Spacing**: heavily weighted to `gap-1`/`gap-2`/`gap-3` and
  `space-y-2`–`space-y-4`; `p-6` is the fixed page-container/modal-body
  padding everywhere; margins are rare — layout is done with `gap`/
  `space-y`, not `mt-*` chains. Every page wraps content in `mx-auto
  max-w-{2xl|3xl} space-y-4 p-6`.
- **Borders**: a single hairline convention, `border border-border`
  (109 plain uses) — no arbitrary colors, no thicker borders anywhere.
- **Shadows**: **only two shadow utilities exist in the whole app**,
  `shadow-lg` (exclusively the mobile nav capsule + FAB) and `shadow-sm`
  (the login card) — both stock Tailwind defaults, no custom values.
  Ordinary cards/rows use zero shadow, relying on the border hairline for
  definition instead. This is a materially flatter elevation model than
  Tandem's own 4-level shadow system (Section 1.2) — see Section 4.

### 3.4 Responsive breakpoints

Only `md:` (33×) and `sm:` (3×) are used anywhere — no `lg:`/`xl:`/`2xl:`.
**No custom breakpoint override exists in the `@theme` block**, so `md:`
is Tailwind v4's unmodified default **768px**, not a deliberately-chosen
value the way Tandem's 900px is. `md:` is entirely driven by `AppShell.tsx`
(sidebar vs. floating-nav split) — every other `md:` use in the app is a
downstream consequence of that same split (a per-route mobile-only
Settings icon, `MonthView`'s chip-vs-count day cells). `sm:` is a narrower
intermediate step purely within the mobile layout (`Today.tsx`'s period
label/toggle sizing), not a mobile/desktop split.

### 3.5 Reusable component patterns

**a2 has no shared low-level UI component library** — no `Button.tsx`,
`Card.tsx`, `Input.tsx`, or `Modal.tsx`. Every screen writes its own
utility-class string inline. Concretely:

- The "row card" recipe (`flex items-center gap-3 rounded-xl border
  border-border bg-surface px-4 py-3`) is **independently declared in 6
  files** (`NoteCard`, `TaskItem`, `CourseCard`, `ThoughtCard`, `NudgeRow`,
  `ReadingItemRow`).
- The modal shell (`fixed inset-0 flex items-end justify-center bg-black/30
  md:items-center` + `rounded-t-2xl … md:rounded-2xl`) is **duplicated
  verbatim across 12 files** — the single largest duplication surface in
  the app, and there is no `<Modal>` component at all.
- The one exception is icons (`layout/icons.tsx`, a shared `BASE = 'h-5
  w-5'` constant) and `Logo.tsx` — both genuinely reusable, parameterized
  components.

**This is a real "what not to copy" finding** (Section 4) — a2's
non-abstraction works at its own scale (~35 files) but the 12-file modal
duplication and 6-file card duplication are exactly the kind of repetition
that would not scale to Tandem, which is already 48 components and already
has a working shared-`Modal.jsx`/shared-class-family philosophy that is
architecturally *better* than a2's in this one respect.

### 3.6 Button/input patterns

All copy-pasted per instance (no `cva`/`clsx` variant map, no shared
component). Distinct treatments found: primary filled (`rounded-lg bg-navy
px-4 py-2 text-sm font-medium text-bg`), accent pill/segmented toggle
(`rounded-full px-3 py-1 … bg-accent-bg text-accent` active vs. `bg-bg
text-ink-muted` inactive — recurs 6+ times), ghost/text button, destructive
text (color-only, no icon), icon-only circular button, the FAB
(`h-16 w-16 rounded-full bg-accent … shadow-lg`), and a color-swatch
selector button.

**The standard text input recipe — `w-full rounded-lg border border-border
bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent` —
appears verbatim in 13 files.** Focus state is 100% consistent app-wide:
border-color swap to accent, no ring, no `focus-visible:` variant at all.
This is **less visible/accessible than Tandem's own existing focus-ring
treatment** (Section 1.6) — another "don't downgrade" case for Section 4.

### 3.7 Navigation pattern — full detail

`AppShell.tsx` is the single layout shell wrapping every authenticated
route:

```
<div className="flex min-h-svh flex-col bg-bg md:flex-row">
  <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface p-6 md:flex">
    <!-- Logo, "+ Quick add" pill, vertical nav links, Settings pinned via mt-auto -->
  </aside>
  <main className="flex-1 overflow-y-auto pb-28 md:pb-0">
    <Outlet />
  </main>
  <nav className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-center gap-3 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:hidden">
    <!-- floating capsule + separate FAB, md:hidden -->
  </nav>
</div>
```

Active/inactive nav-link color is computed by one shared helper,
`navLinkClass(isActive)`, reused identically by the desktop sidebar links
and the mobile capsule links — accent color when active, muted-with-hover
otherwise, **no background fill change, no bold change** — color only.
Icons are hand-built inline SVGs using `stroke="currentColor"` specifically
so `navLinkClass` alone recolors icon+label together with no separate icon
styling needed.

**A real inconsistency worth flagging, not copying**: the sidebar has one
"Settings" link, but on mobile, since there's no sidebar, a Settings icon
button is **independently duplicated into 4 separate route files**
(`Today.tsx`, `Courses.tsx`, `Notes.tsx`, `Us.tsx`, each `md:hidden`)
rather than the shell providing one control both layouts share. Tandem's
own current header (`.header-actions`, present on every tab from one
shared render point in `TaskBoard.jsx`) already avoids this duplication —
another "Tandem already does this better" case.

### 3.8 Mobile bottom navigation — exact specifics

```
<nav class="fixed inset-x-0 bottom-0 z-10 flex items-center justify-center gap-3 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:hidden">
  <div class="flex items-center gap-1 rounded-full border border-border bg-surface p-1.5 shadow-lg">
    <!-- one NavLink per item: flex flex-col items-center gap-0.5 rounded-full px-4 py-2 text-[11px] font-medium -->
  </div>
  <button class="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-accent text-3xl leading-none text-white shadow-lg transition-transform hover:scale-105">+</button>
</nav>
```

- Outer `<nav>`: fixed to viewport bottom, `z-10`, centers the capsule+FAB
  pair as a group (doesn't stretch edge-to-edge), `gap-3` (0.75rem)
  between capsule and FAB.
- **Capsule** (a separate `<div>`, not the `<nav>` itself): `gap-1` between
  items, `rounded-full`, hairline border, `p-1.5` — height is emergent
  from `2×p-1.5 + content`, not a fixed height utility.
- **Each nav item**: icon stacked over an 11px arbitrary-size label,
  `px-4 py-2` per-item touch target, `rounded-full`.
- **FAB**: a true 64px circle (`h-16 w-16`), `shrink-0`, solid accent fill,
  `shadow-lg` (same value as the capsule), the only hover-scale effect in
  the mobile nav.
- **z-index**: nav is `z-10`; all 12 modals are `z-10`/`z-20` — modals
  always render above the nav.

### 3.9 Safe-area handling

**Exactly one `env(safe-area-inset-*)` usage in the whole app** —
`AppShell.tsx`'s bottom nav: `pb-[calc(env(safe-area-inset-bottom)+1rem)]`.
**A real gap, worth noting but not importing**: none of the 12 modals
apply any safe-area padding even though 11 of them render as a
bottom-anchored sheet on mobile — their bottom edge sits flush against the
true viewport bottom, unlike the persistent nav. Tandem's own current
implementation is actually more thorough here (3 separate
`env(safe-area-inset-bottom)` usages — see Section 1.11) — this is a case
to **keep Tandem's existing approach**, not adopt a2's narrower one.

### 3.10 Mobile-specific spacing/behavior

- Every one of a2's 12 modals uses the identical `items-end … md:items-center`
  + `rounded-t-2xl … md:rounded-2xl` pair (bottom sheet on mobile, centered
  dialog on desktop, both capped at `max-w-sm`) — directly comparable to
  Tandem's existing `.submission-modal`/`.modal-backdrop` 640px breakpoint
  behavior (Section 1.4), which already does the same thing.
- The iOS input-zoom fix (`input, textarea { font-size: 16px }`, with
  `<select>` deliberately excluded) is **identical in spirit and near-
  identical in implementation** to Tandem's own version — nothing to
  change here, just confirms the same real-world constraint independently
  discovered by both apps.
- `min-h-svh`/`100svh` used throughout (not `vh`) specifically so mobile
  browser chrome show/hide doesn't cause layout jumps.

### 3.11 Desktop vs. mobile differences summary

Only three elements are genuinely bifurcated markup (not just responsive
CSS on one DOM tree): the nav shell (sidebar vs. capsule+FAB), the
per-route duplicated Settings icon, and `MonthView`'s chip-vs-count day
cells. Everything else — modal shape, type-scale bumps, month-cell
min-height, bottom padding for nav clearance — is pure responsive CSS on
one shared DOM tree.

### 3.12 Remaining custom CSS

Beyond the `@theme` block, `index.css` contains: `html { overflow-x:
hidden }` (mobile zoom-out fix), base `body`/`#root` styles (Preflight's
job, done manually because these are static HTML elements outside React's
`className` reach), the iOS input-zoom fix, and a large `.tiptap-content`
block styling the Tiptap rich-text editor's dynamically-generated output
(list markers, heading sizes, image radius, highlight-mark coloring) —
**every one of these exists specifically because it targets either a
static document-level element, a global override too broad to className
individually, or library-generated markup the app's own JSX never
touches.** Tandem has no Tiptap-equivalent dynamic-content case, but the
underlying principle — some things should just stay plain CSS, and that's
correct, not a migration failure — directly informs Section 9's rules.

### 3.13 Component/route inventory

35 files total: `components/agenda/*` (3 modals), `components/calendar/*`
(9 files — the agenda/calendar rendering engine), `components/courses/*`
(6 files), `components/layout/*` (4 files — `AppShell`, `HowToGuide`,
`SettingsMenu`, `icons`), `components/notes/*` (4 files), `components/
tasks/TaskItem.tsx` (1 file), `components/us/*` (4 files), `routes/*` (7
route-level pages), `hooks/*` (6 hooks), `lib/*` (3 files: push,
recurrence, supabaseClient).

---

## 4. a2 → Tandem mapping

| a2 pattern | Tandem equivalent / recommendation | Adopt, adapt, or diverge? |
|---|---|---|
| `@theme` CSS-first token block, no JS config | Define Tandem's own `@theme` block in a new Tailwind entry stylesheet | **Adopt** — Tandem is simple enough to not need `tailwind.config.js` either |
| Dark mode via CSS-variable reassignment (`prefers-color-scheme` + `data-theme` attribute), no `dark:` variant | Tandem already does exactly this in plain CSS | **Adopt directly** — this is a like-for-like port, not a redesign; zero behavior change |
| 8-color palette, near-identical light `bg`/`surface` values to Tandem's own | Keep Tandem's *own* actual hex values (already validated by the user in an earlier session as close to a2's) | **Adapt** — don't overwrite Tandem's accent (`#d9a066`) with a2's (`#d97a4d`) or its heading-ink color without an explicit design decision; that's a visual choice for a separate, deliberate step, not a side effect of the CSS-engine migration |
| No custom radius/shadow tokens — everything is stock Tailwind defaults | Tandem has a real, deliberate 3-step radius scale (6/10/14px) and a full 4-level shadow/elevation system (resting/raised/floating/press) that a2 doesn't have an equivalent of | **Diverge — keep Tandem's own tokens.** Define them as Tandem's own `@theme` keys (`--radius-sm/-md/-lg`, `--shadow-resting/-raised/-floating/-press`) so migrated components render pixel-identical to today. Do not flatten Tandem's elevation system down to a2's "shadow on nav/login only" minimalism — that would be an unrequested desktop/interaction redesign. |
| Only `md:`/`sm:`, `md:` = stock 768px | Tandem's primary breakpoint is a deliberately-chosen 900px, currently hand-synced across 3 JS call sites and 3 CSS locations | **Diverge — define a custom breakpoint.** Add `--breakpoint-tandem-desktop: 900px` (or override `--breakpoint-md`) in `@theme` so migrated CSS uses the *same* 900px value Tandem already ships, rather than silently adopting a2's 768px and shifting where every responsive rule kicks in |
| No shared Button/Card/Modal component — every screen writes its own utility string, verbatim duplication in 12 modal call sites and 6 card call sites | Tandem already has `Modal.jsx` as a single dialog primitive behind 17+ call sites, plus shared classes (`.submission-modal`, `.icon-button`, `.period-tabs`, `.month-nav-row`) | **Diverge — keep and strengthen Tandem's existing abstraction.** Do not regress to a2's ad hoc per-instance copy-paste philosophy; it demonstrably doesn't scale past ~35 files and Tandem is already at 48+. Convert each shared class into an equivalent reusable pattern (a real component, or at minimum a documented utility-class recipe applied consistently), not 17 independently-maintained utility strings. |
| One input recipe, copy-pasted verbatim into 13 files | Tandem should adopt the *visual result* (one consistent input treatment) but not the *duplication* | **Adapt** — implement as a real shared pattern given Tandem's larger form surface (40+ forms across Tasks/Rentals/Vault/Reports) |
| Focus state = border-color swap only, no ring, no `focus-visible:` | Tandem's existing `:focus-visible` rule (accent border + a 3px accent-tinted ring) is more visible/accessible | **Diverge — keep Tandem's richer focus treatment.** Don't downgrade accessibility to match a2. |
| Exactly one `env(safe-area-inset-bottom)` usage (nav only); modals have no safe-area awareness | Tandem already applies safe-area insets in 3 places (page bottom padding, nav bar padding, FAB position) | **Diverge — keep Tandem's more thorough approach**, and don't import a2's modal gap into Tandem's own modals either |
| Type scale: `text-sm` default, `text-xs` meta, `text-2xl` headings, exactly 2 font weights | No formal type scale currently exists in Tandem (sizes are ad hoc per rule) | **Adopt as the new convention** for any migrated/new markup — a genuinely good, simple, disciplined scale worth standardizing on |
| Spacing via `gap`/`space-y`, not `mt-*` chains; `p-6` universal page padding | Tandem's current spacing (8/10/12/14/18px) maps cleanly onto Tailwind's default 4px-step scale already (`gap-2`=8px, `gap-3`=12px, etc.) | **Adopt the layout mechanism** (prefer `gap`/`space-y` over margin chains going forward); Tandem's own existing pixel values already translate without needing custom spacing tokens |
| Mobile floating capsule nav + separate circular FAB, safe-area-aware | Tandem's current mobile nav is a full-width fixed bottom bar, no FAB (the FAB is a *separate*, already-existing element for "+") | **Adopt directly** — this is the explicitly-requested navigation redesign (Section 8); the FAB pattern is a near-perfect fit since Tandem already has an equivalent FAB concept (`.fab-new-task`), just visually/positionally different today |
| Desktop sidebar with nav links + inline Quick-Add + Settings | Tandem's current desktop nav is folded into the header row, no sidebar | **Adopt directly** — same rationale as the mobile nav; this was already scoped and approved in an earlier, narrower planning pass for this repo |
| Per-route duplicated Settings icon button (4 files) | Tandem already renders Settings once, from one shared header | **Do not adopt this duplication** — keep Tandem's single shared entry point |
| No Tiptap/dynamic-content equivalent in Tandem | N/A directly, but the underlying principle applies | **Adopt the principle**: some CSS should stay plain CSS (static document elements, anything Tailwind utilities structurally can't reach) — this is not a migration failure, see Section 9 |

---

## 5. Tailwind migration strategy

### 5.1 Recommended approach: gradual, component-by-component

**Not** a batch/big-bang rewrite. Reasons:

1. Tandem is a real, daily-use, two-person production app with **no
   automated test coverage** — a large simultaneous rewrite across 4,481
   lines of CSS and 48 components cannot be verified incrementally, and a
   subtle regression (a lost `min-height: 50vh`, a dropped `:last-child`
   exception) would only surface in real use, not in a diff review.
2. The user has repeatedly emphasized wanting incremental, reviewable
   steps ("one step at a time so we don't mess Tandem up") — this is
   already how the nav-shell work in this repo's `design/a2-look` branch
   was scoped and approved.
3. A gradual approach lets each merged step serve as a validated
   checkpoint — both for the token/convention decisions in Section 4 (get
   them right on 2-3 low-risk components before they're load-bearing
   everywhere) and for the visual-regression tooling in Section 7 (each
   step is independently diffable against its own "before").

### 5.2 Suggested order

**First — App Shell / navigation** (already scoped conceptually in an
earlier pass for this repo): highest *visibility* (this is literally what
"look and navigate like a2" means) but relatively low *logic* risk — no
Supabase writes live here beyond what already exists, mostly presentational
plus the existing `activeTab`/`quickAddOpen` state.

**Second — genuinely leaf/presentational components** with little or no
business logic, cheap to visually diff, low blast radius: `TimelineRow.jsx`,
`AllDayRow.jsx`, `icons.jsx`, `ThemeToggle.jsx`, `WorkingStatusToggle.jsx`,
`TaskExportForm.jsx` (read-only), `HowToGuide.jsx` (static content).

**Third — shared primitives**, once the token/utility conventions are
validated by the above: `Modal.jsx`'s chrome, then the shared class
families (`.submission-modal`, `.icon-button`, `.period-tabs`,
`.month-nav-row`) — converted class-by-class, and *within* each class,
canary-tested on 2-3 of its many call sites before touching the rest
(`.submission-modal` alone has 17 consumers).

**Fourth — mid-complexity forms**, once shared primitives are solid:
`TaskForm.jsx`, `ChecklistEditor.jsx`/`ChecklistView.jsx`,
`PriorityItemsEditor.jsx`, the Rental sub-forms
(`RentalBookingForm.jsx`, `RentalExpenseForm.jsx`,
`RentalPropertyForm.jsx`, `RentalSavingsGoalForm.jsx`).

**Last, or high-risk / do-not-casually-migrate:**

- **`TaskBoard.jsx`** — the app's central shell: owns Realtime
  subscriptions, Day/Week/Month rendering, *both* swipe gestures, and both
  nav mount points. CSS changes here risk breaking live gesture math (the
  `min-height: 50vh` dependency) or interacting badly with Realtime-driven
  re-renders. Migrate only after the gesture-dependent CSS is independently
  verified untouched.
- **`RentalsView.jsx`/`RentalCalendar.jsx`** — the one place with a fully
  separate desktop/mobile component tree, plus a deliberate
  `box-shadow`-based visual trick bridging multi-day booking bars across
  the grid's gap. A naive utility conversion could visually break booking-
  bar continuity. High complexity-to-value ratio; migrate near the end.
- **`VaultView.jsx`/`vault.js`** — not a CSS-engine risk per se (the
  encryption logic is untouched by a styling migration), but this is the
  app's one security-sensitive, typed-confirmation-gated destructive-action
  surface. Treat markup changes here with elevated care regardless of how
  mechanical they look.
- **`MonthView.jsx`'s grid** — the 1px-outline hairline-collapse trick
  (adjacent cells sharing one line via `outline`, not `border`, to avoid
  doubled edges) is a specific, deliberate hack and must be reproduced
  carefully (Tailwind's `divide-x`/`divide-y` is the natural fit, but must
  be verified to produce the same visual result, not just assumed to).
- **The 3 swipe-gesture components** — the CSS migration must not touch
  gesture JS at all; the *only* CSS dependency, `.task-list`'s
  `min-height: 50vh`, must be preserved verbatim (e.g. as `min-h-[50vh]`)
  or the day-swipe gesture silently loses its hit area on sparse days.
- **The `!important` theme-transition kill-switch** — preserve exactly;
  this is deliberate and correctness-critical, not legacy cruft.
- **The three `:first-child`/`:not(:first-child)`/`:last-child` rules** —
  re-express with `divide-y`/`space-y-*` (a genuine improvement Tailwind
  offers natively), but verify the "all but one edge" result is identical
  before merging.

---

## 6. Preflight and CSS compatibility

### 6.1 The risk

Tailwind's Preflight layer (included by a bare `@import 'tailwindcss'`)
applies a global CSS reset — zeroing default margins, removing list
markers, normalizing form-element fonts, etc. Since Tandem's entire
existing UI is built assuming *un-reset* browser defaults in several
places, introducing Preflight is not a neutral, purely-additive change —
it can silently alter existing, un-migrated screens the moment it's
imported anywhere in the bundle (Vite bundles all imported CSS globally
regardless of which component imports it).

### 6.2 Confirmed findings (tested, not inferred)

A real spike was run against this exact repo (branch `design/a2-look`,
commit `d441fa1`) specifically to answer this question, and this deeper
audit independently re-confirmed the same result by grepping every
`list-style` rule in `App.css`:

**Full Preflight (`@import 'tailwindcss'`) breaks four specific existing
lists** — confirmed via a before/after computed-style diff
(`getComputedStyle(...).listStyleType`) — because these four are the only
list classes in the entire app that don't already set their own
`list-style`:

| Class | File | Why it's exposed |
|---|---|---|
| `.bulk-add-hint-list` | `BulkAddTasksForm.jsx` | Relies on the browser default `disc` bullet at a custom 18px indent |
| `.priorities-last-set-list` | `PrioritiesForm.jsx` | Same — default `disc` at a custom 20px indent |
| `.how-to-guide-items` | `HowToGuide.jsx` | Same — default `disc` at a custom 30px indent |
| `.cork-board-list` | `CorkBoardView.jsx` | Relies on default `disc` **and** the default browser 40px `padding-left` — no override of either |

(Every other `<ul>` in the app — `.cork-board-comment-list`,
`.bulk-add-preview-list`/`.bulk-add-error-list`, `.bulk-edit-task-list`,
`.inbox-list`, `.rental-overview-list` — already explicitly sets
`list-style: none` and its own padding/margin, so Preflight has nothing to
change there. This is a clean, fully-enumerated risk set, not a "there
could be more we haven't found" situation.)

Full Preflight also **zeroes default UA paragraph margins app-wide** —
measured directly on the Login screen: `<p className="login-tagline">`'s
`margin-top` went from the browser-default `14px` to `0px`, visibly
shifting the Sign-in button up by ~6px in the rendered layout.

### 6.3 The verified-safe alternative

Importing only Tailwind's **theme + utilities layers, without Preflight**
— `@import 'tailwindcss/theme.css'; @import 'tailwindcss/utilities.css';`
— was tested the same way and produced **byte-for-byte identical**
computed styles (`list-style-type`, `padding-left`, `margin-top`) to the
current no-Tailwind baseline on all four at-risk classes. This makes
Tailwind's utility classes available for new/migrated markup with zero
effect on any un-migrated screen.

### 6.4 Recommended coexistence strategy

1. Add Tailwind via the theme+utilities-only import (already proven safe
   on this exact codebase), **not** the full `@import 'tailwindcss'`.
2. Keep `src/App.css` and `src/index.css` in place, imported alongside the
   new Tailwind entry stylesheet, **for the entire migration** — per the
   user's explicit instruction, neither file is deleted "to make the
   migration clean."
3. A class is only removed from `App.css` once **every** consumer of that
   class has been migrated to Tailwind utilities **and** visually verified
   (Section 7) — not proactively, not in bulk, not as a "cleanup" pass
   riding along with an unrelated component's migration.
4. Revisit enabling full Preflight only as a distinct, explicit,
   separately-approved decision **after** every existing `App.css` class
   has actually been migrated away — not as a default end-state assumed
   up front. At that point the four at-risk list classes will already be
   gone (migrated), so the specific risk identified here will have
   resolved itself as a side effect of completion, not as something that
   needs separately re-litigating.

---

## 7. Visual regression strategy

Tandem has no test runner and no fixture/seed data — most screens require
a real authenticated Supabase session to reach. Two complementary layers
are recommended:

### 7.1 Layer 1 — computed-style diffing (cheap, no fixtures needed)

The exact technique already used for the Section 6 spike:
`getBoundingClientRect()` + `getComputedStyle()` snapshots of key elements
(margins, padding, colors, radii, list-style, font) taken before and after
a change, diffed programmatically. This works on the pre-auth Login screen
alone (no Supabase data required) and is the right first-pass check for
anything token- or shared-class-related, since it catches global-reset-
style regressions (like the Preflight list-bullet issue) far more cheaply
than a full screenshot pipeline. Use this on every step that touches a
shared class or a design token, before moving to Layer 2.

### 7.2 Layer 2 — Playwright screenshot-based visual regression

For full-screen and per-component visual diffing once real data is
reachable:

1. **Fixture data is a prerequisite, not an afterthought.** Most of the
   app (Today, Rentals, Reports, Cork Board, Inbox, Vault) needs an
   authenticated session with representative data to render meaningfully.
   Recommend a disposable/dedicated Supabase project seeded with fixed,
   deterministic fixture data (two test members, a handful of tasks across
   states, one rental property with a booking, a submitted report, a cork
   pin, an inbox item) — this needs to exist before Layer 2 screenshots are
   meaningful, and is a real decision for the user (a throwaway project vs.
   pointing at a copy of real data with a fixed snapshot).
2. **Baseline first.** Before any component's migration begins, capture
   screenshots of every primary tab plus 3-4 representative modals, at
   three viewport widths (375px mobile, 900px — the breakpoint boundary
   itself — and 1280px desktop), in both light and dark theme (`data-theme`
   toggle). This baseline is captured once, against `main`, and is the
   permanent point of comparison.
3. **Per-step verification.** After each component's migration PR,
   re-capture the same screenshots and diff with Playwright's
   `expect(page).toHaveScreenshot()` (small `maxDiffPixelRatio` threshold)
   — this is the actual go/no-go gate for merging that step, not manual
   eyeballing.
4. **Test matrix dimensions**: viewport width (375 / 900 / 1280), theme
   (light/dark), and — for Today/Rentals specifically — the JS-driven
   structural branch (mobile tree vs. desktop tree), since these are the
   three axes most likely to silently diverge (Sections 1.4, 3.4).
5. **Touch gestures need interaction testing, not just screenshots.** A
   static screenshot diff cannot verify the 3 swipe gestures still work —
   use Playwright's touch-emulation APIs (`page.touchscreen`) to actually
   perform a swipe and assert the resulting date/month changed, in
   addition to a manual click-through pass on a real device before merging
   any step that touches `TaskBoard.jsx` or `RentalsView.jsx`.

### 7.3 Manual fallback

Regardless of automated tooling, every merged step should get a real
manual click-through on both a real mobile device (or accurate emulation)
and desktop, in both themes, before being considered done — this is
already implicitly how the earlier nav-shell planning pass in this repo
was scoped, and should stay the standard given the app's actual two daily
users are a stronger real-world signal than any synthetic test.

---

## 8. Mobile navigation redesign

Three proposals, each showing every current feature's new destination.
Current inventory being redistributed: 5 primary tabs (Today, Rentals,
Reports, Cork Board, Inbox) + FAB speed-dial (New Task, Bulk add/edit,
Priorities, Submit report, Vault) + header (working-status, nudge,
Settings→How-to-guide).

### Proposal A — Conservative (4 primary tabs, one merge) — **recommended**

| Current | New destination |
|---|---|
| Today | Today (unchanged) |
| Rentals | Rentals (unchanged) |
| Cork Board | **Board** — merged with Inbox, as a segment within Board's existing `.period-tabs` row |
| Inbox | **Board** — same merged tab; Board's segments become All / Pins / Needs reply / Resolved / Submissions / Nudges |
| Reports | Reports (unchanged — kept as its own tab) |
| FAB speed-dial (New Task, Bulk add/edit, Priorities, Submit report, Vault) | Unchanged — still reached via the FAB, now shaped like a2's circular FAB instead of the current `.fab-new-task` |
| Header (working-status, nudge, Settings) | Unchanged — desktop keeps a shared Settings entry point (not duplicated per-route, unlike a2 — Section 4) |

**Why recommended**: the single lowest-risk merge (Cork Board and Inbox
already overlap conceptually — Section 2.2), achieves a2's cardinality (4
tabs) with the least product-behavior change, and was already the
direction conceptually agreed in an earlier, narrower planning pass for
this repo. Nothing loses its own screen; Board just gains one more segment
in a control pattern (`.period-tabs`) the app already uses for exactly
this purpose in five other places.

### Proposal B — Moderate (4 primary tabs, different grouping)

| Current | New destination |
|---|---|
| Today | Today (unchanged) |
| Rentals | Rentals (unchanged) |
| Inbox | **Inbox** — kept as its own standalone tab (its unread badge arguably deserves persistent top-level visibility, more than Cork Board does) |
| Reports, Cork Board, Vault | **More** — a new 4th tab, a simple list of destinations ("Reports", "Cork Board", "Vault"), each row navigating to that screen |
| FAB speed-dial (minus Vault, now under More) | New Task, Bulk add/edit, Priorities, Submit report |

**Trade-off**: Inbox stays maximally discoverable, and grouping
Reports/Cork Board/Vault under one "More" list (a well-understood mobile
pattern for exactly this situation) avoids forcing two different UIs
(Cork Board's freeform board, Inbox's activity feed) into one merged
screen the way Proposal A does. Costs one extra tap to reach Reports/Cork
Board/Vault, and moving Vault out of the FAB is itself a small behavior
change worth flagging on its own.

### Proposal C — Minimal (5 tabs kept, chrome-only redesign)

| Current | New destination |
|---|---|
| Today, Rentals, Reports, Cork Board, Inbox | **All five kept as separate primary tabs, unchanged** — reshaped only into a2's sidebar (desktop) / floating capsule (mobile) chrome |
| FAB speed-dial | Unchanged, reshaped to a2's circular FAB |

**Trade-off**: satisfies "adopt a2's mobile navigation shape" and
"improve mobile navigation" purely as an ergonomic/visual upgrade (bigger
touch targets, floating capsule instead of a flush bar, proper safe-area
handling) without any information-architecture change or feature
regrouping — no muscle-memory tab position changes at all. Does **not**
achieve the "~4-5 primary destinations" consolidation goal in the sense of
reducing tab count; five items in a capsule sized for four will also be
visibly tighter than a2's own spacing. Useful primarily as a fallback if,
after seeing Proposal A or B, the user decides they don't want a feature-
grouping change yet and would rather split navigation redesign from visual
redesign into two separate, later steps.

---

## 9. Migration rules

These apply to every step of the actual migration, once approved:

1. **Preserve functionality exactly.** No task/rental/report/vault/inbox
   business logic, Supabase query, or Realtime subscription changes as a
   side effect of a styling migration.
2. **Do not alter business logic unless explicitly required** by a
   specific, separately-called-out migration step (there should be none —
   this is a styling/navigation migration, not a logic migration).
3. **Do not perform unrelated refactors.** The three duplicated swipe
   gestures (Section 1.10) and the three duplicated "priority dot"
   implementations (Section 1.3) are real consolidation opportunities —
   leave them exactly as they are unless the user separately asks for that
   cleanup.
4. **Do not redesign desktop UI** beyond what's explicitly scoped (the nav
   shell) **unless explicitly requested.** Migrating a component's CSS
   engine to Tailwind should reproduce its current desktop appearance, not
   use the opportunity to also improve/change it.
5. **Mobile navigation redesign IS allowed and expected** — Section 8's
   consolidation is an intentional, requested UX change, not scope creep.
6. **Do not blindly translate CSS selectors into Tailwind classes.**
   Structural selectors (`:not(:first-child)`, `:last-child` — Section
   1.8) should become `divide-y`/`space-y-*` with the *same visual result*
   verified, not a literal per-element re-implementation of the original
   selector's mechanism.
7. **Preserve intentional responsive behavior** — the 900px breakpoint
   value (not a2's 768px default), the 480/640/641px density/modal-shape
   breakpoints, and which elements are JS-structural branches vs.
   pure-CSS responsive.
8. **Preserve touch/swipe behavior exactly**, including the specific,
   easy-to-lose `.task-list { min-height: 50vh }` dependency the day-swipe
   gesture relies on (Section 1.10) — verify with an actual swipe
   interaction test, not just a screenshot, on any step touching
   `TaskBoard.jsx` or `RentalsView.jsx`.
9. **Preserve accessibility behavior** — the `:focus-visible` ring
   treatment (richer than a2's own, do not downgrade it — Section 4), all
   36 `aria-label`s, `Modal.jsx`'s focus-trap/restore behavior, and
   `.visually-hidden` label associations.
10. **Do not delete `App.css`/`index.css`**, and do not delete any
    individual class from either file until every consumer of that class
    has been migrated **and** visually verified (Section 7) — verified
    class-by-class, not file-by-file or in bulk.
11. **Avoid unnecessary arbitrary Tailwind values.** a2's own sparing use
    of `text-[11px]`/`text-[10px]` (only when no default utility fits) is
    the right model — reach for a default scale value first, and only use
    an arbitrary value when a real, specific existing pixel value (e.g.
    Tandem's own `--radius-sm: 6px`) genuinely doesn't map onto one.
12. **Prefer shared design tokens/components over ad hoc utility strings.**
    Do not copy a2's own "no Button/Card/Modal component, just duplicate
    the utility string" pattern — Section 4/3.5 found this doesn't scale
    even for a2 (6-file and 12-file verbatim duplication), and Tandem
    already has a better foundation (`Modal.jsx`, shared class families)
    to build on instead of regress from.
13. **Do not use Tailwind merely for the sake of using Tailwind.** Genuinely
    complex, hard-to-reach-from-JSX CSS (the theme-transition
    `!important` kill-switch; the month-grid outline-collapse hairline
    trick; anything targeting a static document element like `html`/
    `body`/`#root`) should stay plain CSS if Tailwind utilities would make
    it worse or impossible to express, exactly as a2 itself does for its
    Tiptap-generated content (Section 3.12).
14. **Keep genuinely complex CSS where Tailwind would make the
    implementation worse** — same rule as #13, stated as a standing
    principle rather than a one-time check: this is an ongoing judgment
    call for every component, not a rule that stops mattering after the
    obvious cases in #13 are handled.
15. **Import Tailwind without Preflight** (`tailwindcss/theme.css` +
    `tailwindcss/utilities.css`) for the entire duration of the migration,
    per Section 6 — full Preflight is a separate, later, explicitly-
    approved decision, not a default assumed end state.
16. **Define Tandem's own `@theme` tokens** matching its *existing* pixel
    values (radius, shadow, breakpoint, color) rather than adopting a2's
    or Tailwind's defaults — see Section 4's full mapping table for which
    specific values to preserve vs. which conventions (type scale, spacing
    mechanism) to newly adopt.

---

## What I need you to approve before implementation

1. **Overall approach** — gradual, component-by-component migration in the
   order proposed in Section 5.2 (Shell → leaf components → shared
   primitives → mid-complexity forms → TaskBoard/Rentals/Vault last).
2. **Mobile navigation proposal** — which of Proposals A/B/C (Section 8),
   or a variant, to build toward. (Recommendation: A.)
3. **Token decisions** — confirm Tandem should keep its own existing
   color/radius/shadow/breakpoint values as custom `@theme` tokens (Section
   4) rather than adopting a2's values, and that a *separate*, explicitly
   requested step (not a side effect of this migration) would be needed if
   you ever do want Tandem's accent color/heading-ink shifted to look more
   like a2's.
4. **Preflight decision** — confirm importing Tailwind without Preflight
   for the full migration (Section 6), revisiting full Preflight only as
   its own later decision once every `App.css` class is gone.
5. **Visual regression setup** — whether to invest in the Playwright +
   fixture-data pipeline (Section 7.2), which requires deciding on a
   disposable/seeded Supabase project for deterministic screenshots, or to
   rely on Layer 1 (computed-style diffing) plus manual click-through only
   for now and add Playwright later.
6. **Where to start** — confirm the App Shell / navigation step as the
   actual first implementation PR, since it's the highest-visibility,
   lowest-logic-risk step and was already conceptually scoped in an
   earlier pass for this repo.

No code has been changed as part of this phase.
