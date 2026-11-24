---
name: Munto
description: Every category is a jar of coins that fills as you spend, on a plain white page; local-first personal budgeting.
colors:
  paper: "#ece5ef"
  paper-2: "#e3d9e8"
  sheet: "#ffffff"
  band: "#f6f0f8"
  pot: "#ffffff"
  pot-edge: "#b7a3bf"
  ink: "#2a1633"
  ink-2: "#4f3d58"
  muted: "#6f6077"
  rule: "#e4d8e8"
  rule-strong: "#b7a3bf"
  in: "#1d7348"
  in-fill: "#2f9a63"
  in-wash: "#e3f4ea"
  need: "#a3364f"
  need-fill: "#ffa3ae"
  need-wash: "#ffe8eb"
  over: "#c4161c"
  over-fill: "#e0383a"
  over-wash: "#fde4e3"
  focus: "#7a3ea8"
  kraft: "#8a5aa8"
typography:
  figure:
    fontFamily: "Familjen Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(18px, 4.2cqi, 30px)"
    fontWeight: 650
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Familjen Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  section:
    fontFamily: "Familjen Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Familjen Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 650
    lineHeight: 1.45
  body:
    fontFamily: "Familjen Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Familjen Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 550
    lineHeight: 1.25
rounded:
  page: "28px"
  sheet: "18px"
  inner: "12px"
  control: "999px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "28px"
  section: "36px"
components:
  pot:
    backgroundColor: "{colors.pot}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "13px 14px 12px"
  pot-unsorted:
    backgroundColor: "{colors.need-fill}"
    textColor: "#2a1633"
    rounded: "{rounded.sheet}"
  ledger-left:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    padding: "12px 16px 14px"
  unsorted-panel:
    backgroundColor: "{colors.need-fill}"
    textColor: "#2a1633"
    rounded: "{rounded.sheet}"
    padding: "12px 14px 14px"
  button:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "36px"
  button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    height: "36px"
  button-need:
    backgroundColor: "{colors.need-fill}"
    textColor: "#2a1633"
    rounded: "{rounded.control}"
    height: "36px"
  over-badge:
    backgroundColor: "{colors.over-wash}"
    textColor: "{colors.over}"
    rounded: "{rounded.pill}"
---

# Design System: Munto

## Overview

**North Star: "Full jars, plain page"**

The month on one white page beside the nav, on a lilac ground. The numbers do the talking: the balance box (Income − Spent − Saved, with *Left* reversed under it), then every category as a **pot**, a card holding a jar of coins that fills as you spend. The jar's shoulder is the budget (or the usual, without one), a dashed line across it marks the usual (its amount shows on hover). Over budget, the lid no longer closes, coins pile up in the neck, and the figure turns red with a small *Over* badge. What needs you is salmon.

Everything else stays out of the way: one typeface, short labels in sentence case, no decoration that doesn't carry information.

**Key Characteristics:**
- One typeface, Familjen Grotesk, for words and amounts. Amounts use its tabular figures, cents at full size.
- Labels are short and in sentence case. A section's heading is a real heading (17px), never a tracked-capitals eyebrow.
- Plum ink carries the page and violet is only the brand; green means money in; salmon only means "needs you"; red only means over.
- One fixed colour and one line icon per category, used identically everywhere, including the coins in its jar.
- Round, not boxy: pill buttons, fields, tabs and chips; 18px cards; circular icon badges and legend keys. Hairline rules, 2px ink rules above rail sections. No gradients, no glass, no tilted or rotated elements.
- The jar is the motif: a pot card's big jar, a small jar on every budget row and savings goal, an empty jar in empty states.

## Colors

A cool lilac ground under a white page, plum ink, and three signal colours that never stand in for each other.

### Primary
- **Plum Ink** (ink): text, the active nav item, primary buttons, the reversed *Left* block, jar lids and the dashed usual line.

### Secondary
- **Green** (in, in-fill, in-wash): money in, paid back and put aside, always with a + sign. The same green as the Income pot. Violet stays out of it, so a + amount never reads as brand colour.

### Tertiary
- **Salmon** (need-fill, need for text on white, need-wash): only for what needs you. The Unsorted panel and pot, the Unsorted badge, AI suggestion buttons, text selection. Salmon in both themes, with plum text.
- **Red** (over, over-fill, over-wash): a pot over its budget, the *Over* badge, figures above usual, errors.

### Neutral
- **Ground** (paper) and **Deeper ground** (paper-2): behind the page, and wells.
- **Sheet** (sheet, pot): the page and the pot cards; **Band** (band): tint bands and jar glass.
- **Ink 2**, **Muted**: secondary text. **Rule**, **Strong Rule**: hairlines, card edges, control borders.
- **Focus** (violet): focus rings and the caret only.

Dark mode (prefers-color-scheme, overridable with data-theme) uses the same roles: ground #120a16, sheet #1d1323, ink #f4ebf7, in #7fd9a4, over #ff5d52 (a hot red, well clear of salmon); salmon stays salmon. Reversed blocks (*Left*, the current nav item) are not inverted to near-white in dark mode: they are a lifted plum (ink 14% into the sheet) with ink text and a strong-rule edge, so they never outshine the figures. Category colours are the same in both modes.

### Named Rules
**The Salmon Is Asking Rule.** Salmon appears only where the user has something to do. Never a highlight, a chart series or decoration.

**The Violet Is Munto Rule.** Violet is the brand: the ground, the ink, focus rings, the wants series on charts. It never marks money.

**The Sign Is The Signal Rule.** In and out are never colour alone: signed amounts carry a true minus or plus before the euro sign.

## Typography

**Familjen Grotesk** (self-hosted variable, 400–700, OFL) for everything. `.money` turns on tabular figures so amounts line up in columns; cents are the same size as the euros.

### Hierarchy
- **Figure** (650, tabular, −0.03em): the balance box, pot amounts (23px, 18px on phone), account balances.
- **Headline** (700, 28px, −0.02em; 24px on phone): one page title.
- **Section** (650, 17px): section headings (Pots, Savings, Trends, Money in).
- **Title** (650, 14.5px): pot names, payees, account names.
- **Body** (400, 15px, 1.45).
- **Label** (550, 13px, sentence case, muted): field labels, table heads, the terms of the balance box. Never uppercase, never tracked.

## Writing

Say it once, and short. A page title doesn't get a subtitle that restates it. A number doesn't get a sentence explaining what it is; the label does that. Empty states are one short line ("No funds yet."). Keep only text that changes what you'd do: a warning, a date, a privacy fact (what leaves this computer, and when).

## Layout

Desktop: the nav column (216px) on the ground, and the page beside it (margin 18px top and right, padding 28px 40px). Pages use the full width: no max-width on the overview or the Budget page. The balance box spreads Income, Spent and Saved across its width with *Left* under them full width. Pots sit in an auto-fill grid (min 232px, gap 12px). Budget rows sit in an auto-fill grid too (min 440px, two-up on a wide screen). Sections are 36px apart.

At 760px the nav becomes a bottom tab bar, the page fills the screen, the balance box becomes right-aligned rows with *Left* reversed at the bottom, and pots go two-up.

## Elevation & Depth

Flat. The page has one soft shadow on the ground. Pot cards are flat with a 1px edge that darkens to ink on hover, and lift 1px. Tooltips and toasts float with their own shadow.

## Shapes

Round, never boxy. Everything you press or type in is a pill (buttons, fields, segmented tabs, nav items, chips, badges). Cards, panels and the balance box have 18px corners (`--radius`); wells, notes and boxes inside a card 12px (`--radius-sm`); the page sheet 28px at the top. Category icons sit in a circular badge tinted with their colour; legend keys are dots. The jar: lid, neck, shoulder and a rounded body (80 × 100 viewBox), its coins a striped fill in the category colour, a 1.6px edge (red when over), and the usual as a dashed ink line across the glass, labelled "usual € …" on hover.

## Components

### Pot
Card: category icon and name; the jar on the right; the big figure (what's left of the budget, or with no budget what was spent); one meta line (spent of budget, or how it compares with the usual); a green *+€ paid back* line when money came back. Over budget: the lid pops, coins spill into the neck, the figure turns red with an *Over* badge. Hovering one pot fades the others. Unsorted is a salmon pot without a jar. Savings pots fill toward their plan in green.

### Balance box (ledger)
A 1px ink box: Income − Spent − Saved, a note under a figure only when it says something (who paid, what was paid back), then *Left* reversed in an ink block, then the split bar of category colours with its legend. The pace chart sits beside it on desktop.

### Budget rows
Each pot with a budget is a row: name, "spent of budget", a small jar, and a line. On the line the fill is what went out, a tinted stretch is the budget and a handle sits at the budget: a small upright pill with three grip dots, shown only while the row is hovered, focused or dragged (always on touch screens), so at rest an ink mark (white in dark mode) on the line shows where the budget is. Drag the handle (or use the arrow keys on it) to change the budget in €5 steps; the line runs past the budget so there is room to raise it, and the Save bar keeps the change.

### Unsorted panel
Salmon, plum text, dashed rules between merchants, white-washed buttons, and an ink *Sort all* button.

### Navigation
The coin and the name *Munto* in the same typeface; items with line icons; the current page as a solid ink bar. Unsorted carries a salmon count badge. Phone: bottom tab bar.

### The coin
One mark everywhere: the browser tab, the menu, the app icon (the coin on a plum square) and the menu bar (the same coin as a black outline, a macOS template image). A deep rose face (#a9505f) with a darker edge and inner ring (#7a3442) and a pale pink € (#fde8eb), the same in both themes: visible on light and dark tab bars without being the bright salmon of "needs you".

## Do's and Don'ts

### Do:
- **Do** print every amount with `Money`: tabular figures, a true minus or plus when signed.
- **Do** keep a category's colour and icon identical everywhere, including its jar's coins.
- **Do** call categories *pots* in the interface.
- **Do** cut a sentence before adding one.

### Don't:
- **Don't** use uppercase tracked labels or eyebrows above headings.
- **Don't** add a second typeface, a monospace for numbers, or raised cents.
- **Don't** tilt, rotate or "stick on" elements; no punched holes, stamps or other paper costume.
- **Don't** use salmon for anything that doesn't need the user, or red for anything that isn't over.
- **Don't** add gradients or glass panels.
- **Don't** bring back square corners on controls: a pill, or the card radius.
