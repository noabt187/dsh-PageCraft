---
name: frontend-page-builder
description: Build or refine frontend pages from design briefs and structured [frontend-feedback], [frontend-theme], [frontend-motion], or [frontend-rollback] work orders. Use for source implementation, DOM-to-component localization, responsive changes, visual verification, batch recovery material, and safe rollback.
---

# Frontend Page Builder

Build a usable, visually coherent page in the project's existing frontend stack, then treat DOM and area annotations as precise follow-up requirements. Work directly in the current repository and finish with proportional verification.

## Choose the workflow

- If the user asks for a new page or substantial redesign, follow **Initial build**.
- If the request contains `[frontend-feedback]` or its JSON `annotations` work order, follow **Annotation refinement**.
- For `[frontend-theme]` or `[frontend-motion]`, follow **Theme and motion work orders**.
- For `[frontend-rollback]`, follow **Safe rollback** only; do not combine recovery with unrelated design edits.
- If both appear, establish the initial page first, run its development preview, and then invite or consume annotations for a second focused pass.

## Initial build

1. Inspect the repository before choosing libraries or structure. Identify the framework, entry points, routing, component conventions, styling system, scripts, and existing design tokens.
2. For a new page or substantial redesign, use `frontend-design` to produce the brief before implementation. For a small local change with an established visual system, keep the existing direction and skip a full redesign pass.
3. Reuse the project's components, tokens, and dependencies. Do not replace the stack or add a large UI library merely to build one page.
4. Establish a clear visual direction. Use deliberate typography, spacing, color, depth, and composition; avoid generic placeholder-heavy layouts or a collection of unrelated cards. For a new standalone page without an explicit brand or color request, default to a light visual system with a bright neutral canvas, dark readable text, and one restrained accent. Do not interpret words such as "polished", "modern", "AI", or "technical" as permission to default to a near-black canvas.
5. Implement the full visible experience, including realistic content, empty/loading/error states when relevant, keyboard focus, semantic HTML, and mobile behavior.
6. Run the narrowest relevant checks first, then a production build or the project's standard verification command when practical. Inspect the result in a browser when browser tooling is available.
7. Tell the user what changed, how it was verified, and which local preview URL to open from the **页面评注** entry for iterative feedback.

## Annotation refinement

1. Distinguish `DOM 元素` annotations from `区域框选` annotations. A DOM annotation targets an existing rendered element; an area annotation may request a new component where no DOM exists yet.
2. For a `dom` annotation, rank `sourceHints` evidence before falling back to `target.selector`, `target.html`, text, and `target.container`. Explicit `data-pagecraft-source`/component markers and framework file metadata are strong evidence; component names and owner chains are candidates. Read each candidate source and cross-check it against the rendered structure before editing. `confidence` measures collection evidence, not certainty: never edit an unread file solely because its hint is high, and treat low-confidence hints only as search narrowing.
3. For an `area` annotation, use `target.container` to locate the owning layout component. `target.position` is already expressed relative to the container's top-left corner and directly includes `x`, `y`, `width`, `height`, and all four corners; do not spend time recalculating this geometry.
4. Follow the declared operation: `insert` adds content in normal flow and pushes following content, `overlay` intentionally layers over existing content, and `replace` replaces the listed `affectedDom`. Inspect the container's Grid/Flex rules, siblings, breakpoints, spacing tokens, and content flow before editing.
5. Read the surrounding component and styles before editing. Determine whether the requested change belongs in markup, local styles, shared tokens, content data, or behavior.
6. Batch compatible annotations by owning component. If two annotations conflict, prefer the more specific requirement and explicitly report the conflict rather than silently guessing.
7. Make the smallest coherent source change that satisfies the feedback while preserving unmentioned behavior, responsiveness, accessibility, and the page's established visual system.
8. Honor each annotation's `viewport` and `scope`: `current-breakpoint` affects only that range, `current-and-smaller` includes narrower ranges, and `all-breakpoints` must preserve all defined presets. Express the change with existing media/container queries and tokens rather than hard-coding preview coordinates.
9. Treat screenshot metadata as supporting evidence. Inspect an attached image when available; if its delivery is `history-only`, `unavailable`, or capture failed, continue from DOM evidence and report the gap. Never ask for or paste large Base64 data into source or prompt text.
10. Verify the changed state at the requested viewport and representative Desktop/Tablet/Mobile sizes. Re-run targeted tests and the normal frontend build. If the preview server is running, refresh it for after-state capture.

## Batch evidence and recovery

For any work order with `batchId`, before editing:

1. Record the already-dirty files and content hashes. Do not attribute pre-existing user changes to PageCraft.
2. Create `.pagecraft/history/<batchId>/manifest.json` and a batch-scoped reverse patch containing only this batch's changes. Ensure `.pagecraft/` is ignored by the target project and excluded from product builds.
3. Record affected files, pre/post hashes, checks, preview URL, requested viewport, screenshot delivery, and validation result. Do not claim that a before/after image exists unless PageCraft captured it.

The recovery material is operational evidence, not a reason to commit generated history.

## Theme and motion work orders

- For `[frontend-theme]`, use `frontend-design` to interpret the preset or custom brief, then map its semantic tokens to the existing theme system. Preserve behavior and content; do not replace the stylesheet wholesale.
- For `[frontend-motion]`, implement progressive enhancement. The static final state must remain complete, keyboard focus and primary actions must not be obstructed, and `prefers-reduced-motion` plus the specified mobile fallback are mandatory.
- Enforce the supplied performance budget. Lazy-load optional video, provide a poster/static substitute, avoid scroll handlers that trigger layout work, and report evidence for media size and representative runtime behavior.

## Safe rollback

For `[frontend-rollback]`:

1. Load exactly `.pagecraft/history/<batchId>/manifest.json` and `revert.patch`; reject invalid or escaping paths.
2. Verify every current file hash against `expectedPostHashes` and the manifest before mutation.
3. If any hash differs or recovery material is incomplete, stop automatic recovery, change nothing, and report conflicting files with the smallest assisted recovery option.
4. Only when all checks match, apply the batch-scoped reverse patch. Never run `git reset --hard`, repository-wide checkout/clean, delete untracked files, or overwrite changes that predate the batch.
5. Run the original batch checks, report restored hashes, and refresh the preview so PageCraft can append a new rollback history event rather than rewriting the old record.

## Quality bar

- Preserve the project's architecture and state/data flow.
- Prefer semantic elements and visible keyboard focus; maintain readable contrast and usable touch targets.
- Area geometry describes the requested size and placement inside the reported container. Preserve that intent through the container's existing layout system instead of recomputing the coordinates.
- For `insert`, prefer normal document flow, Grid, or Flex so following content moves naturally. Use absolute positioning for `overlay` only when the surrounding component establishes an intentional positioning context.
- Avoid broad global CSS changes for a local comment unless the feedback clearly identifies a system-wide rule.
- Keep copy specific and production-like. Do not leave lorem ipsum, unexplained placeholders, fake metrics presented as real data, or nonfunctional primary controls.
- Unless the user or the existing product explicitly requires dark mode, avoid large near-black or dark-navy surfaces, blue-purple gradients, neon glow, glassmorphism, and a page made almost entirely from rounded cards. A light page still needs hierarchy through typography, spacing, borders, imagery, and restrained color rather than decorative effects.
- Do not claim visual verification unless the page was actually rendered or inspected. State any remaining verification gap plainly.
- A passing build is not visual verification. Inspect the rendered result at the work order's viewport and representative neighboring breakpoints; note capture/render failures explicitly.

## Expected handoff

Report the `batchId`, implemented page or refinement, comment-to-source mapping, files and hashes recorded, checks run, rendered viewports, screenshot/visual comparison status, recovery-material status, and preview URL.
