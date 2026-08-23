---
name: frontend-page-builder
description: Build or redesign polished frontend pages and components, then refine them from [frontend-feedback] DOM or area annotations. Use for initial UI implementation, visual/layout work, responsive behavior, accessibility, selector-specific iteration, or adding content inside a user-drawn region.
---

# Frontend Page Builder

Build a usable, visually coherent page in the project's existing frontend stack, then treat DOM and area annotations as precise follow-up requirements. Work directly in the current repository and finish with proportional verification.

## Choose the workflow

- If the user asks for a new page or substantial redesign, follow **Initial build**.
- If the request contains `[frontend-feedback]` or its JSON `annotations` work order, follow **Annotation refinement**.
- If both appear, establish the initial page first, run its development preview, and then invite or consume annotations for a second focused pass.

## Initial build

1. Inspect the repository before choosing libraries or structure. Identify the framework, entry points, routing, component conventions, styling system, scripts, and existing design tokens.
2. Convert the request into a compact page brief: purpose, audience, primary action, required sections, content hierarchy, states, and responsive behavior. Resolve minor gaps with sensible assumptions; ask only when a missing decision would materially change the product.
3. Reuse the project's components, tokens, and dependencies. Do not replace the stack or add a large UI library merely to build one page.
4. Establish a clear visual direction. Use deliberate typography, spacing, color, depth, and composition; avoid generic placeholder-heavy layouts or a collection of unrelated cards. For a new standalone page without an explicit brand or color request, default to a light visual system with a bright neutral canvas, dark readable text, and one restrained accent. Do not interpret words such as "polished", "modern", "AI", or "technical" as permission to default to a near-black canvas.
5. Implement the full visible experience, including realistic content, empty/loading/error states when relevant, keyboard focus, semantic HTML, and mobile behavior.
6. Run the narrowest relevant checks first, then a production build or the project's standard verification command when practical. Inspect the result in a browser when browser tooling is available.
7. Tell the user what changed, how it was verified, and which local preview URL to open from the **页面评注** entry for iterative feedback.

## Annotation refinement

1. Distinguish `DOM 元素` annotations from `区域框选` annotations. A DOM annotation targets an existing rendered element; an area annotation may request a new component where no DOM exists yet.
2. For a `dom` annotation, use `target.selector`, `target.html`, and `target.container` as rendered-page evidence to locate the owning source component. The HTML is rendered DOM rather than guaranteed React/Vue/Svelte source, and generated selectors are hints rather than stable source identifiers.
3. For an `area` annotation, use `target.container` to locate the owning layout component. `target.position` is already expressed relative to the container's top-left corner and directly includes `x`, `y`, `width`, `height`, and all four corners; do not spend time recalculating this geometry.
4. Follow the declared operation: `insert` adds content in normal flow and pushes following content, `overlay` intentionally layers over existing content, and `replace` replaces the listed `affectedDom`. Inspect the container's Grid/Flex rules, siblings, breakpoints, spacing tokens, and content flow before editing.
5. Read the surrounding component and styles before editing. Determine whether the requested change belongs in markup, local styles, shared tokens, content data, or behavior.
6. Batch compatible annotations by owning component. If two annotations conflict, prefer the more specific requirement and explicitly report the conflict rather than silently guessing.
7. Make the smallest coherent source change that satisfies the feedback while preserving unmentioned behavior, responsiveness, accessibility, and the page's established visual system.
8. Verify the changed state at relevant viewport sizes. Re-run targeted tests and the normal frontend build. If the preview server is running, ask the user to refresh and make another annotation pass when useful.

## Quality bar

- Preserve the project's architecture and state/data flow.
- Prefer semantic elements and visible keyboard focus; maintain readable contrast and usable touch targets.
- Area geometry describes the requested size and placement inside the reported container. Preserve that intent through the container's existing layout system instead of recomputing the coordinates.
- For `insert`, prefer normal document flow, Grid, or Flex so following content moves naturally. Use absolute positioning for `overlay` only when the surrounding component establishes an intentional positioning context.
- Avoid broad global CSS changes for a local comment unless the feedback clearly identifies a system-wide rule.
- Keep copy specific and production-like. Do not leave lorem ipsum, unexplained placeholders, fake metrics presented as real data, or nonfunctional primary controls.
- Unless the user or the existing product explicitly requires dark mode, avoid large near-black or dark-navy surfaces, blue-purple gradients, neon glow, glassmorphism, and a page made almost entirely from rounded cards. A light page still needs hierarchy through typography, spacing, borders, imagery, and restrained color rather than decorative effects.
- Do not claim visual verification unless the page was actually rendered or inspected. State any remaining verification gap plainly.

## Expected handoff

Report the implemented page or refinement, the main files changed, checks run, and the preview URL. For annotation work, map each completed comment to its source-level change in a short list.
