# 06 — Design and Aesthetics

Goal: products that look **intentional and distinct**, not like a default AI template, with lots of variety from few choices.

Variety = **direction** (one pick) × **knobs** (four sliders) × **brand** (optional) × **seed** (agent's variation within the direction). That gives many distinct outcomes from ≈ 5 inputs.

## 1. Design directions (catalogue)

Each direction is a folder `design/directions/<name>/` with `direction.md` (mood, rules, do/don't), `tokens.base.json`, and a preview card (HTML) for the form.

| Direction | In plain words | Typography | Colour | Shape & motion | Fits |
|---|---|---|---|---|---|
| **Swiss Minimal** | Calm, clean, lots of white space, grid | Neo-grotesque sans, strong size contrast | Near-monochrome + one accent | Sharp corners, almost no motion | Tools, portfolios, docs |
| **Editorial** | Like a good magazine | Serif headlines + quiet sans body | Paper tones, ink black, muted accent | Generous margins, subtle fades | Blogs, content, stories |
| **Playful** (verspielt) | Friendly, bouncy, hand-made touches | Rounded or quirky display font | Bright pastels, illustrated accents | Big radii, springy micro-animations | Games, kids, community |
| **Bold Pop** | Loud, colourful, confident | Heavy display sans, huge type | Saturated complementary colours, colour blocks | Hard shadows, snappy motion | Launches, events, campaigns |
| **Technical / Terminal** | Engineer-made, data-dense | Monospace + compact sans | Dark base, signal colours (green/amber) | Thin borders, no decoration, instant motion | Dev tools, dashboards |
| **Brutalist** | Raw, honest, deliberately unpolished | System or grotesque, oversized | Black/white + one harsh colour | No radius, visible structure, no easing | Art, statements, personal sites |
| **Soft / Organic** | Warm, calm, natural | Humanist sans or soft serif | Earth tones, low contrast backgrounds | Blobs, large radii, slow easing | Wellness, food, lifestyle |
| **Retro** | 80s/90s/Y2K or pixel nostalgia | Pixel or period display font | Period palette (CRT, neon, vaporwave) | Pixel borders, scanlines, playful motion | Games, fun side projects |
| **Corporate Clean** | Trustworthy, neutral, conventional | Robust sans | Brand blue/green, neutral greys | Medium radius, restrained motion | B2B, forms, admin |
| **Dark Futuristic** | Sleek, glowing, cinematic | Geometric sans | Deep dark + neon gradients used sparingly | Glows, glass layers, smooth motion | AI/tech showcases, games |

Option "surprise me": the agent proposes **three** contrasting directions as rendered previews with the user's real product name and copy; the user picks or mixes.

## 2. Knobs

| Knob | Values |
|---|---|
| Theme | light / dark / both (system) |
| Density | airy / balanced / compact |
| Motion | none / subtle / expressive (always honours `prefers-reduced-motion`) |
| Corner style | sharp / soft / round (defaults from direction) |

Plus **brand input** (optional): logo, colours, fonts. Brand overrides direction tokens; the direction still governs layout and rhythm.

## 3. Output in the project

```
design/
├── direction.md      # chosen direction, knobs, brand, do/don't list, reference links
├── tokens.json       # design tokens (colour, type scale, spacing, radius, shadow, motion)
└── baseline/         # approved screenshots per screen × viewport × theme
```

Tokens are generated into the stack's format: CSS custom properties (web), Tailwind theme extension (if Tailwind), Compose `Theme.kt` (Android), `theme.json` (WordPress block theme).

## 4. Anti-"AI look" rules (in `visual-review` checklist)

Avoid unless the direction explicitly asks for it:

- Default purple-to-blue gradients, glassmorphism everywhere, glowing blobs behind the hero.
- Inter/system font for everything with no type contrast.
- The template layout: centred hero → three identical feature cards with emoji icons → testimonial carousel → CTA.
- Uniform `rounded-2xl` + soft shadow on every element.
- Lorem ipsum or generic copy ("Unlock the power of…").
- Stock icon sets mixed in different styles.

Require:

- A deliberate type pairing and a modular scale from tokens.
- One clear accent strategy; contrast checked (WCAG AA).
- At least one distinctive layout or visual motif per direction (asymmetric grid, oversized numerals, illustration style, texture, etc.).
- Real or realistic content in screenshots.
- Consistent spacing rhythm from tokens; no magic numbers.

## 5. Visual review loop (UI gate)

```
change UI → just screenshot → visual-reviewer (multimodal subagent) → fix → repeat (max 3) → report
```

- `just screenshot`: routes/screens from `visual.yaml`, viewports (mobile 390, tablet 820, desktop 1440), light/dark. Web: Playwright. Android: Paparazzi/emulator. Output to `.artifacts/screenshots/`.
- `visual-reviewer` (read-only) scores against `design/direction.md` + anti-AI rules + a11y basics: hierarchy, alignment, spacing rhythm, contrast, overflow/clipping, responsive breakage, consistency with tokens. Output: findings with screenshot reference and concrete fix.
- `just check` (deterministic part): `axe` accessibility scan, visual regression diff against `design/baseline/` with a tolerance; updating baselines is an explicit `just screenshot --approve`.
- Claude Code: the kit can reference an existing frontend design skill/plugin if available (verify current Anthropic offerings); our `design-direction` skill stays the project's source of truth.
