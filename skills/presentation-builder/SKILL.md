---
name: presentation-builder
description: Create, redesign, and refine browser-based HTML/React presentations from [presentation-create] briefs and [presentation-feedback] slide annotations. Use for slide-deck story structure, reusable layouts, themes, responsive 16:9 rendering, per-slide PageCraft metadata, and visual verification.
---

# Presentation Builder

Build a coherent browser-based presentation that PageCraft can discover, navigate, annotate, and refine. Treat the deck as a designed story rather than a collection of unrelated cards.

## Choose the workflow

- For `[presentation-create]`, follow **Create a deck**.
- For `[presentation-feedback]`, follow **Refine a deck** and change the specifically identified slides.
- Preserve the current project stack. Add a small presentation route or app inside the existing workspace instead of replacing unrelated code.

## Create a deck

1. Inspect the current repository, framework, scripts, styling system, and available assets before choosing implementation details.
2. Turn the brief into a narrative outline before writing slide markup. Each slide must have one job and one memorable point. Prefer an opening, problem/context, evidence, solution, implications, and close when appropriate; adapt this structure to the audience and goal.
3. Keep content in a maintainable `deck.json`, TypeScript data module, or equivalent single source of truth. Keep rendering components and theme tokens separate from content.
4. Build reusable 16:9 slide layouts such as title, section, statement, image-story, comparison, process, data, quote, and closing. Use the smallest layout set that fits the story; do not force every slide into the same card grid.
5. Every rendered slide root must remain in the DOM and include unique metadata:

   ```html
   <section
     data-pagecraft-slide-id="slide-01"
     data-pagecraft-slide-title="Opening"
   >...</section>
   ```

   Use stable IDs from the deck data. Render slides in document order so PageCraft can discover them and scroll between them.
6. Establish one deliberate visual system with CSS variables or theme tokens: canvas, foreground, muted text, one primary accent, one secondary accent, heading/body fonts, spacing scale, and a limited radius/shadow vocabulary. Honor `presentation.colorMode`. When it is absent or `light`, use a bright neutral canvas, dark readable text, and restrained accents; never silently switch to a near-black technology theme. Use dark mode only when explicitly requested or when `colorMode` is `dark`.
7. Avoid generic AI presentation habits: repeated rounded-card grids, decorative gradients without purpose, emoji as primary illustration, excessive glow/glass effects, tiny body copy, placeholder metrics, and identical layouts on every slide.
8. Use realistic content and available brand assets. When facts or images are unavailable, clearly label placeholders instead of inventing evidence. Prefer diagrams, charts, screenshots, or one strong visual over decorative filler.
9. Make the deck work at a normal 16:9 presentation viewport and remain inspectable in a smaller browser panel. Prevent clipping and horizontal overflow; keep body copy readable and avoid putting essential content outside the slide canvas.
10. Add keyboard or button navigation only when it does not remove inactive slides from the DOM. A scroll-snap vertical deck is a reliable default for PageCraft interoperability.
11. Run the relevant build and tests. Start the local preview when practical and report the exact URL for PageCraft.

## Refine a deck

1. Each annotation may include `slide.id`, `slide.title`, and `slide.index`. Use the stable slide ID to locate the deck data and owning layout component before using DOM selectors as supporting evidence.
2. For `dom` annotations, treat `target.html`, `target.selector`, and `target.container` as rendered evidence, not guaranteed source code.
3. For `area` annotations, use the provided container-relative position and four corners directly. Follow `insert`, `overlay`, or `replace` exactly, while expressing final placement through the slide's layout system when possible.
4. Make the smallest coherent change that satisfies the selected slide without silently changing the story or style of unrelated slides.
5. If feedback requests a deck-wide rule such as typography, color, footer, or spacing, change the shared theme/layout component and inspect representative slides for regressions.
6. Preserve stable `data-pagecraft-slide-id` values and keep all slides discoverable in DOM order.
7. Verify the edited slide at presentation size and check nearby slides for overflow, unexpected wrapping, style drift, and broken navigation.

## Visual quality rules

- Begin with hierarchy: one dominant idea, a clear reading path, and intentional negative space.
- Use a small number of strong alignments. Avoid arbitrary coordinates when Grid or Flex expresses the relationship.
- Keep titles concise. Reduce content before shrinking type.
- Vary composition across the story while preserving the same theme.
- Use data graphics only when the data supports them; label units and sources when known.
- Treat animations as optional enhancement. The static final state must remain understandable and exportable.
- Avoid the stereotypical AI deck look: large black or dark-navy backgrounds, blue-purple gradients, neon glow, glass panels, and repeated floating rounded cards. Light editorial, business, academic, and minimal decks should gain character from typography, composition, negative space, imagery, diagrams, and a controlled palette.
- A separate `deck.json` is encouraged as the content source, but the browser preview must not depend on a cross-origin runtime request that fails inside PageCraft. Prefer bundler-supported JSON imports or a small generated data module; if runtime `fetch()` is used, verify it through the PageCraft preview rather than only in a direct browser tab.
- Do not claim visual verification unless the rendered deck was actually inspected.

## Expected handoff

Report the deck data file, rendering components, theme files, checks run, number of slides, and the exact preview URL. For refinements, map each annotation to the slide ID and source-level change.
