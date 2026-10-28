# Design system

ReadyState has two visual treatments over **one set of screens** (decision D7):
- **Style A, Journal:** [design brief](design-brief.md) §4.
- **Style B, Modern:** [Modern treatment](design-treatment-modern.md) §4.

Components use only semantic tokens, so the two styles differ in tokens alone. That's what makes the A/B test compare the treatment rather than the product.

## Switching styles

- The active style is `data-style="a"` or `"b"` on `<html>`, set before first paint by a small script in `app/layout.tsx`.
- `?style=a` or `?style=b` on any URL sets the style and remembers it in this browser.
- The footer's switcher does the same, for design review.
- With no choice made, the default is **A**. Random 50/50 assignment comes with the A/B test (work item F14, decision D10).

## Tokens

Defined in `app/globals.css` and used as Tailwind utilities (`bg-surface`, `text-ink-2`, `border-line-strong`, …).

| Token | Use | A, Journal | B, Modern |
| --- | --- | --- | --- |
| `canvas` | Page background | `#F6F2E9` paper | `#0B1422` |
| `surface` | Panels, cards | `#FFFCF6` page | `#111F30` |
| `raised` | Dialogs | `#FFFFFF` | `#182B3E` |
| `field` | Inputs | `#FFFCF6` | `#102235` |
| `line` | Decorative dividers only | `#D9D3C7` rule | `#294156` |
| `line-strong` | Input and control boundaries | `#857F73` | `#64819B` |
| `ink` / `ink-2` / `ink-3` | Primary, secondary, muted text | `#24342F` / `#58645D` / `#636B65` | `#F4F7FB` / `#B7C8DA` / `#91A7BC` |
| `action` / `action-hover` / `on-action` | Primary actions | `#245C50` forest teal / `#1B473E` / `#FFFCF6` | `#22D9E8` cyan / `#62E7F0` / `#071722` |
| `action-soft` | Selected and submitted backgrounds | `#E4EEE9` | `#0E3340` |
| `success`, `success-soft` | Feedback, saved, privacy | `#2B6A4F`, `#E6F0EA` | `#35D3B0`, `#0F3430` |
| `attention`, `attention-accent`, `attention-soft` | The current situation and decision | `#8A5711` (text), `#A66A16` amber (accents), `#F7ECD9` | `#F5BC59`, `#F5BC59`, `#33290F` |
| `error`, `error-soft` | Errors | `#A33D32` brick, `#F6E3DF` | `#FF8F96`, `#3A1C22` |
| `focus` | Keyboard focus outline | `#245C50` | `#9CEFFF` |

**Fonts:**
- **Style A:** Source Serif 4 for headings and Source Sans 3 for body text.
- **Style B:** Inter.

All are self-hosted by `next/font`, so the browser never contacts Google.

**Geometry:** `rounded-panel` is 12 px and `rounded-control` is 8 px. Controls are at least 44 px tall (AC01).

### Contrast

Every text and boundary pairing above passes WCAG AA in both styles: 23 of 23 pairs, 4.5:1 for text and 3:1 for boundaries and focus.
- **Changed from the brief:** its amber `#A66A16` is 3.9:1 on paper, so text uses a darker `#8A5711` and the original stays as an accent. The brief's decorative Rule color `#D9D3C7` never marks an input on its own; inputs use `line-strong`.

To re-check, compute the ratios for the pairs in the table, for example with any WCAG contrast calculator.

## Rules for components

- **Tokens only.** Use only token utilities: no `zinc-*`, `emerald-*` or other raw palette colors.
- **One primary action** per task area, using the default `Button` variant.
- **Status always has words.** Amber means the current exercise decision, never a real-world alert. Nothing pulses or blinks.
- **Label exercise content.** Use `SimulationLabel`, and "Hour 6 · Simulation" on turns.
- **Progress is a path** (`DecisionPath`), never a percentage.
- **Sentence case.** All caps only for brief labels such as "Simulation".
- **Marks:** each style shows its own concept (`Mark` in `components/brand.tsx`). A: an unfinished path through three points. B: dots gathering into a home. Neither is an approved logo (DS3).

## Pages

| Route | What |
| --- | --- |
| `/` | Public website: hero, how it works, exercises, the household and privacy, family (planned), run it yourself or hosted (in development) |
| `/exercise` | The app |
| `/exercise?sample=alex` | The fictional sample exercise from "Try a sample exercise" (any test household id works) |
| `/exercise?preview=1` | A recorded three-turn exercise for design review, with no model calls (`data/fixtures/preview-exercise.json`) |
