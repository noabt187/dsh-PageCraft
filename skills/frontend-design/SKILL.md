---
name: frontend-design
description: Define a distinctive, accessible visual direction and executable design brief for new pages, substantial redesigns, or [frontend-theme] work orders. Use before implementation when visual hierarchy, tokens, responsive behavior, imagery, or motion need deliberate design judgment; do not use for a small local annotation with an established design system.
---

# Frontend Design

Turn product intent and existing brand evidence into a compact brief that `frontend-page-builder` can implement. Make design decisions; do not replace the builder's source editing and verification work.

## Read the situation

Inspect the rendered page and the project's existing components, tokens, fonts, assets, and constraints. Establish:

- purpose, audience, primary action, content hierarchy, meaningful states, and responsive needs;
- what must remain recognizable from the current product;
- whether the request is a new direction, a theme mapping, or a restrained evolution.

For `[frontend-theme]`, treat the preset as direction rather than CSS to paste. Map it onto the project's theme mechanism. If `theme` is `extract-current`, describe the design system actually present. If screenshots are `history-only` or unavailable, say that visual evidence was not sent instead of pretending to inspect it.

## Choose one clear direction

Name the direction and state its central idea in one sentence. Define:

- typography roles and scale;
- canvas, foreground, muted, accent, and semantic colors with contrast intent;
- spacing rhythm, layout grid, density, radius, border, and shadow vocabulary;
- image treatment and one recognizable visual motif that serves the content;
- interaction feedback and motion character;
- desktop, tablet, mobile, keyboard, focus, and `prefers-reduced-motion` behavior.

Preserve an existing strong identity. When no identity exists, make a specific choice appropriate to the subject instead of defaulting to generic black technology surfaces, blue-purple gradients, glass cards, repeated rounded-card grids, excessive glow, or decorative motion.

## Produce an executable brief

Return a concise brief with: intent, information hierarchy, visual direction, token mapping, layout rules, component implications, responsive rules, motion rules, accessibility constraints, and acceptance checks. Distinguish observed facts from assumptions.

Before handoff, self-review hierarchy, contrast, rhythm, content fit, narrow-screen reflow, touch targets, keyboard focus, static motion fallback, and whether the signature element improves recognition rather than decoration. Revise weak choices before implementation.

Do not claim visual validation. The builder may claim it only after rendering and inspecting the result at the relevant viewports.

## Attribution

This PageCraft-specific skill was independently rewritten from general frontend art-direction principles and is inspired in part by Anthropic's public `frontend-design` skill. It does not reproduce that skill verbatim. See <https://github.com/anthropics/skills/tree/main/skills/frontend-design> for the upstream source and its repository licensing terms.
