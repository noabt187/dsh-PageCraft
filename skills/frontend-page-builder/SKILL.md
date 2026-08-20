---
name: frontend-page-builder
description: Build or redesign polished frontend pages and components, then refine them from [frontend-feedback] DOM or area annotations. Use for initial UI implementation, visual/layout work, responsive behavior, accessibility, selector-specific iteration, or adding content inside a user-drawn region.
---

# Frontend Page Builder

Build a usable, visually coherent page in the project's existing frontend stack, then treat DOM annotations as precise follow-up requirements. Work directly in the current repository and finish with proportional verification.

## Choose the workflow

- If the user asks for a new page or substantial redesign, follow **Initial build**.
- If the request contains `[frontend-feedback]`, CSS selectors, DOM paths, element text, or element rectangles, follow **Annotation refinement**.
- If both appear, establish the initial page first, run its development preview, and then invite or consume annotations for a second focused pass.

## Initial build

1. Inspect the repository before choosing libraries or structure. Identify the framework, entry points, routing, component conventions, styling system, scripts, and existing design tokens.
2. Convert the request into a compact page brief: purpose, audience, primary action, required sections, content hierarchy, states, and responsive behavior. Resolve minor gaps with sensible assumptions; ask only when a missing decision would materially change the product.
3. Reuse the project's components, tokens, and dependencies. Do not replace the stack or add a large UI library merely to build one page.
4. Establish a clear visual direction. Use deliberate typography, spacing, color, depth, and composition; avoid generic placeholder-heavy layouts or a collection of unrelated cards.
5. Implement the full visible experience, including realistic content, empty/loading/error states when relevant, keyboard focus, semantic HTML, and mobile behavior.
6. Run the narrowest relevant checks first, then a production build or the project's standard verification command when practical. Inspect the result in a browser when browser tooling is available.
7. Tell the user what changed, how it was verified, and which local preview URL to open in the **页面评注** tab for iterative feedback.

## Annotation refinement

1. Distinguish `DOM 元素` annotations from `区域框选` annotations. A DOM annotation targets an existing rendered element; an area annotation may request a new component where no DOM exists yet.
2. For a DOM annotation, locate the owning source component using this evidence in order: unique selector or id, visible text, DOM path, nearby component structure, then viewport rectangle. Selectors from generated CSS or CSS Modules are hints, not guaranteed source identifiers.
3. For an area annotation, use the suggested container and nearby selectors to find the owning layout component. The user may have moved and resized the retained selection before confirming it, so treat the final snapped four-corner coordinates as the strongest placement evidence and the raw coordinates as visual intent. Then inspect the component's Grid/Flex rules, siblings, breakpoints, spacing tokens, and content flow before deciding where to insert markup.
4. Resolve imperfect area drawing by preferring, in order: an existing container boundary, shared sibling edge or center line, established grid track, design-system spacing, then the snapped rectangle. Use the raw rectangle only as secondary evidence. If two equally plausible placements would produce materially different UI, ask one focused question.
5. Read the surrounding component and styles before editing. Determine whether the requested change belongs in markup, local styles, shared tokens, content data, or behavior.
6. Batch compatible annotations by owning component. If two annotations conflict, prefer the more specific requirement and explicitly report the conflict rather than silently guessing.
7. Make the smallest coherent source change that satisfies the feedback while preserving unmentioned behavior, responsiveness, accessibility, and the page's established visual system.
8. Verify the changed state at relevant viewport sizes. Re-run targeted tests and the normal frontend build. If the preview server is running, ask the user to refresh and make another annotation pass when useful.

## Quality bar

- Preserve the project's architecture and state/data flow.
- Prefer semantic elements and visible keyboard focus; maintain readable contrast and usable touch targets.
- Avoid hard-coded viewport-specific coordinates. Element and area rectangles describe where the intent was observed, not where content must be absolutely positioned.
- When adding content from an area selection, prefer normal document flow, Grid, or Flex. Use absolute positioning only when the surrounding component already establishes an intentional positioning context.
- Avoid broad global CSS changes for a local comment unless the feedback clearly identifies a system-wide rule.
- Keep copy specific and production-like. Do not leave lorem ipsum, unexplained placeholders, fake metrics presented as real data, or nonfunctional primary controls.
- Do not claim visual verification unless the page was actually rendered or inspected. State any remaining verification gap plainly.

## Expected handoff

Report the implemented page or refinement, the main files changed, checks run, and the preview URL. For annotation work, map each completed comment to its source-level change in a short list.
