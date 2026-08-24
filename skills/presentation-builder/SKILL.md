---
name: presentation-builder
description: Create and refine browser-based HTML/React presentations from [presentation-create] briefs and structured [presentation-feedback] work orders, including sourceHints, batch recovery, breakpoint scope, screenshot context, and rendered visual verification.
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
2. Rank `sourceHints` evidence before DOM fallback. Explicit PageCraft source markers and framework file metadata are strong evidence; component/owner names remain candidates. Read and cross-check candidate source against the slide ID and rendered DOM before editing. Never treat `confidence` as proof.
3. For `dom` annotations, treat `target.html`, `target.selector`, text, and `target.container` as rendered evidence, not guaranteed source code.
4. For `area` annotations, use the provided container-relative position and four corners directly. Follow `insert`, `overlay`, or `replace` exactly, while expressing final placement through the slide's layout system when possible.
5. Honor `viewport` and `scope`. Keep the 16:9 composition intact while making smaller PageCraft panels inspectable; do not turn captured pixels into absolute layout values.
6. Inspect attached screenshots as supporting evidence. If capture is unavailable or `history-only`, continue from slide/DOM evidence and report that visual context was not delivered; never embed Base64 prompt data in source.
7. Make the smallest coherent change that satisfies the selected slide without silently changing the story or style of unrelated slides.
8. If feedback requests a deck-wide rule such as typography, color, footer, or spacing, change the shared theme/layout component and inspect representative slides for regressions.
9. Preserve stable `data-pagecraft-slide-id` values and keep all slides discoverable in DOM order.
10. Verify the edited slide at presentation size, the requested breakpoint, and adjacent slides for overflow, unexpected wrapping, style drift, and broken navigation.

## Batch and recovery protocol

When a work order contains `batchId`, record pre-existing dirty files before editing. Generate `.pagecraft/history/<batchId>/manifest.json` plus a reverse patch limited to this batch, and ignore `.pagecraft/` from commits/builds. The manifest records affected files, pre/post hashes, checks, viewport, screenshot delivery, and preview URL. Do not overwrite pre-existing user changes or call repository-wide reset/clean commands.

If a presentation recovery arrives as `[frontend-rollback]`, follow `frontend-page-builder`'s Safe rollback protocol: require recovery material, compare every expected post-hash, stop without mutation on any mismatch, apply only the batch reverse patch on a full match, and re-run the original checks.

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
- A successful build alone is not visual verification. State which slides and viewports were rendered and any screenshot/capture gap.

## Expected handoff

Report the batch ID, deck data file, rendering components, theme files, checks run, slides/viewports actually inspected, screenshot/comparison status, recovery material, and exact preview URL. For refinements, map each annotation to the slide ID and source-level change.
