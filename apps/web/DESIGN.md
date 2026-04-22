---
version: alpha
name: LobsterPay
description: Dark-first brutalist minimalism — monospace display + TASA Orbiter body on a warm near-black canvas. Inspired by x.ai.

# ── Colors ─────────────────────────────────────────────────────────────
# Tokens expose the SOLID base palette only. Opacity-based hierarchy
# (text/border/surface steps, hover dims) is implemented at runtime via
# rgba() in src/app/globals.css — see the prose Colors section below for
# the exact opacity ladder. The alpha-spec linter only accepts 6-digit
# hex, so any attempt to tokenize rgba values fails validation.
colors:
  background: "#1f2228"
  primary: "#ffffff"            # text + accent; every white foreground
  success: "#34d399"
  warning: "#fbbf24"
  danger: "#f87171"
  focus-ring: "#3b82f6"         # rendered at 50% alpha by CSS

# ── Typography ─────────────────────────────────────────────────────────
# Two roles with zero overlap:
#   mono = GeistMono → display, buttons, monospace labels, tx signatures
#   sans = TASA Orbiter → body, headings, forms, descriptions
typography:
  display-hero:
    fontFamily: GeistMono
    fontSize: 20rem
    fontWeight: 300
    lineHeight: 1.5
  section-heading:
    fontFamily: TASA Orbiter
    fontSize: 1.875rem
    fontWeight: 400
    lineHeight: 1.2
  body:
    fontFamily: TASA Orbiter
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: TASA Orbiter
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.5
  small:
    fontFamily: TASA Orbiter
    fontSize: 0.75rem
    fontWeight: 400
    lineHeight: 1.5
  button:
    fontFamily: GeistMono
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: 0.09em
  button-sm:
    fontFamily: GeistMono
    fontSize: 0.75rem
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: 0.09em
  label-mono:
    fontFamily: GeistMono
    fontSize: 0.625rem
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0.08em

# ── Rounded (radius scale) ─────────────────────────────────────────────
# Sharp corners are the brand. 0px everywhere; `subtle` at 4px is an
# escape hatch for rare secondary containers.
rounded:
  sharp: 0px
  sm: 0px
  md: 0px
  lg: 0px
  subtle: 4px

# ── Spacing (8px grid, sparse scale) ───────────────────────────────────
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
  xxl: 96px

# ── Components ─────────────────────────────────────────────────────────
# Each variant (hover, ghost, danger, sm) is a separate entry. Hover
# states that only differ by opacity are omitted from the tokens — see
# the CSS for the runtime dim values (documented in the prose below).
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    typography: "{typography.button}"
    rounded: "{rounded.sharp}"
    padding: 12px 24px
  button-primary-sm:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    typography: "{typography.button-sm}"
    rounded: "{rounded.sharp}"
    padding: 8px 16px

  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    typography: "{typography.button}"
    rounded: "{rounded.sharp}"
    padding: 12px 24px

  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    typography: "{typography.button}"
    rounded: "{rounded.sharp}"
    padding: 12px 24px

  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.danger}"
    typography: "{typography.button}"
    rounded: "{rounded.sharp}"
    padding: 12px 24px

  link:
    textColor: "{colors.primary}"
    typography: "{typography.body}"

  card:
    backgroundColor: "{colors.background}"
    rounded: "{rounded.sharp}"
    padding: 24px

  input:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    typography: "{typography.body}"
    rounded: "{rounded.sharp}"
    padding: 8px 12px

  badge:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    typography: "{typography.small}"
    rounded: "{rounded.sharp}"
    padding: 4px 8px

  # Status badges used in activity feed, payment states, form banners.
  # The CSS adds a 10%-alpha fill of the status color behind the solid
  # text color — that can't be expressed in the token schema, so the
  # background is left transparent at the token layer.
  badge-success:
    backgroundColor: "transparent"
    textColor: "{colors.success}"
    typography: "{typography.label-mono}"
    rounded: "{rounded.sharp}"
    padding: 3px 8px
  badge-warning:
    backgroundColor: "transparent"
    textColor: "{colors.warning}"
    typography: "{typography.label-mono}"
    rounded: "{rounded.sharp}"
    padding: 3px 8px
  badge-danger:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    typography: "{typography.label-mono}"
    rounded: "{rounded.sharp}"
    padding: 3px 8px

  nav:
    backgroundColor: "{colors.background}"
    height: 56px

  # Focus ring spec — applied globally to :focus-visible in CSS, not to
  # a specific element. Lives here so the focus-ring color is referenced.
  focus-indicator:
    backgroundColor: "transparent"
    textColor: "{colors.focus-ring}"
    rounded: "{rounded.sharp}"
---

# LobsterPay Design System

> Format: [google-labs-code/design.md](https://github.com/google-labs-code/design.md) (YAML tokens + prose).
> Lint: `node node_modules/@google/design.md/dist/index.js lint apps/web/DESIGN.md` (the CLI's stdout streams through the Windows `npx` wrapper silently; invoking via node works everywhere).
>
> The YAML frontmatter is authoritative for solid colors, typography,
> and component box-model. The **opacity ladder** (text hierarchy,
> borders, surfaces, hover dims) is intentionally outside the token
> layer — the alpha-spec linter rejects 8-digit hex / rgba, and alpha
> steps for white text don't blend cleanly to solid hex because text
> lives over varied surfaces. Opacity values are documented below and
> implemented in [`src/app/globals.css`](src/app/globals.css).
>
> When a token value here conflicts with the CSS, the CSS is the bug.

## Overview

Dark-first, monospace-driven brutalist minimalism. Inspired by x.ai.
The site anchors to a warm near-black (`#1f2228`) with pure white text.
No gradients, no decorative illustrations, no chromatic brand color.
Restraint is the point.

**Two typefaces.** Zero role overlap.

- **GeistMono** — display hero (weight 300, extreme scale), all button
  text, monospace labels, tx signatures, timestamps, anything that
  relies on fixed-width rhythm.
- **TASA Orbiter** (variable sans, self-hosted via `next/font/local`) —
  body, section headings, forms, descriptions.

**Depth through opacity, not shadow.** There are no `box-shadow`
elevations anywhere except the 2px blue focus ring (accessibility). Depth
is layered through opacity-based borders (`12%` → `22%` on hover),
surface opacity steps (`4%` → `8%`), and extreme type-scale contrast.

## Colors

The token layer has six solid colors:

| Token | Role |
|---|---|
| `background` `#1f2228` | Canvas, nav, card bodies |
| `primary` `#ffffff` | Every white foreground + the accent |
| `success` `#34d399` | Confirmed tx, healthy status |
| `warning` `#fbbf24` | Pending, partial |
| `danger` `#f87171` | Failed, revoked |
| `focus-ring` `#3b82f6` | `:focus-visible` ring (rendered at 50% alpha) |

**Opacity ladder** (NOT tokenized — implemented in globals.css):

| Level | rgba value | CSS var | Used for |
|---|---|---|---|
| text primary | `#ffffff` 100% | `--text-primary` | Body, headings |
| text secondary | `rgba(255,255,255,0.7)` | `--text-secondary` | Descriptions, caption |
| text tertiary | `rgba(255,255,255,0.5)` | `--text-tertiary` | Placeholders, timestamps |
| text ghost | `rgba(255,255,255,0.3)` | `--text-ghost` | Disabled, very muted |
| border subtle | `rgba(255,255,255,0.12)` | `--border-subtle` | Cards, dividers |
| border strong | `rgba(255,255,255,0.22)` | `--border-strong` | Active, hover emphasis |
| surface subtle | `rgba(255,255,255,0.04)` | `--bg-raised` | Barely-visible lift |
| surface card | `rgba(255,255,255,0.05)` | `--bg-card` | Card fills |
| surface hover | `rgba(255,255,255,0.08)` | `--bg-card-hover` | Card hover |
| status dim | status color @ ~10% | `--success-dim` etc. | Badge backgrounds |
| accent hover | `rgba(255,255,255,0.9)` | `--accent-hover` | Primary button hover |

**The accent is pure white.** Intentional — no chromatic brand color.
Interaction **dims to 90%** rather than brightens, which inverts the
usual hover convention.

## Typography

See `typography.*`. Two families, eight named scales:

| Token | Role |
|---|---|
| `display-hero` | 20rem weight 300 — the one place monospace goes big |
| `section-heading` | 30px TASA Orbiter weight 400 |
| `body` | 16px TASA Orbiter weight 400, line-height 1.5 |
| `label` | 14px TASA Orbiter |
| `small` | 12px TASA Orbiter — meta, timestamps |
| `button` | 14px GeistMono uppercase, tracked +0.09em |
| `button-sm` | 12px variant for nav / toolbar buttons |
| `label-mono` | 10px GeistMono uppercase, heavily tracked — badges |

**Non-negotiables.** Buttons are always uppercase GeistMono with the
button letter-spacing. Body text is always TASA Orbiter. Display
headlines use weight 300 — weight 400+ feels heavy at extreme sizes.
Never mix proportional fonts into buttons or monospace into body.

## Layout & Spacing

8px base grid with a deliberately sparse scale (`xs 4` / `sm 8` / `md
16` / `lg 24` / `xl 48` / `xxl 96`). Big jumps; no granular 10/12/14px
tweaks. Whitespace is the primary structural tool.

Max content width ~1200px. Hero takes full viewport height. Section
padding steps 96px desktop → 48px tablet → 24px mobile. Vertical
rhythm over horizontal density.

## Elevation & Depth

**Zero box-shadow for elevation.** Depth layers through:

1. **Opacity-based borders** — 12% → 22% on hover / active.
2. **Surface opacity steps** — transparent → 5% → 8%.
3. **Type-scale contrast** — the 320px display headline against 16px
   body creates typographic depth shadow-based systems can't match.

The only permitted shadow-like effect is the 2px blue focus ring, used
exclusively for `:focus-visible` accessibility.

## Shapes

`rounded.sharp` / `.sm` / `.md` / `.lg` are all **0px**. The
`rounded.subtle` escape hatch at 4px has no live consumers — sharp
corners are the brand.

## Components

See `components.*` tokens. Implemented one-to-one in
[`src/app/globals.css`](src/app/globals.css) under `.btn`, `.btn-*`,
`.card`, `.input`, `.nav`, `.feature-pill`, `.type-badge`,
`.badge-success` / `.badge-warning` / `.badge-danger`.

**Hover rule.** Primary dims background to 90% (`accent-hover`).
Ghost/secondary shifts surface to 5–8%. Links dim text to 50%. All
transitions are `0.15s ease`.

**Wallet adapter parity.** Solana's `WalletMultiButton` renders its own
base styles; `.wallet-adapter-button` is overridden in globals.css to
inherit `button-sm` box-model and `button-primary`-hover treatment so
the connected-wallet pill is visually indistinguishable from an
adjacent `.btn.btn-primary.btn-sm`.

## Do's and Don'ts

### Do
- Use `#1f2228` as the universal background — never pure `#000`.
- Apply `typography.button` to every interactive pill — GeistMono
  uppercase is the brand's voice of interaction.
- Express hierarchy through opacity, not through gray ramps.
- Dim to 0.9 (primary) or 0.5 (links) on hover — **reverse of the
  usual brighten-on-hover convention**.
- Keep corners sharp. `rounded.sharp` is the only default.
- Let whitespace do the layout work; avoid dividers inside generous
  sections.

### Don't
- Don't introduce `box-shadow` for elevation.
- Don't add chromatic brand colors beyond white + the three status
  slots.
- Don't use `font-weight` ≥ 600 for display text — weight 300–400
  only.
- Don't round corners past 4px.
- Don't brighten elements on hover.
- Don't mix proportional fonts into buttons or monospace into body
  copy.
- Don't hard-code hex values in components — reference `colors.*` so
  theming stays centralized.

## Responsive Behavior

Breakpoints: 480, 640, 768, 1024, 1280, 1536, 2000. The display hero
scales from 20rem desktop down to 3rem mobile. Nav tabs collapse to a
hamburger below 768px. Section padding steps 96px → 48px → 24px.
