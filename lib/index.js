// skills/frontend-page-builder/SKILL.md
var SKILL_default = "---\nname: frontend-page-builder\ndescription: Build or redesign polished frontend pages and components, then refine them from [frontend-feedback] DOM or area annotations. Use for initial UI implementation, visual/layout work, responsive behavior, accessibility, selector-specific iteration, or adding content inside a user-drawn region.\n---\n\n# Frontend Page Builder\n\nBuild a usable, visually coherent page in the project's existing frontend stack, then treat DOM annotations as precise follow-up requirements. Work directly in the current repository and finish with proportional verification.\n\n## Choose the workflow\n\n- If the user asks for a new page or substantial redesign, follow **Initial build**.\n- If the request contains `[frontend-feedback]`, CSS selectors, DOM paths, element text, or element rectangles, follow **Annotation refinement**.\n- If both appear, establish the initial page first, run its development preview, and then invite or consume annotations for a second focused pass.\n\n## Initial build\n\n1. Inspect the repository before choosing libraries or structure. Identify the framework, entry points, routing, component conventions, styling system, scripts, and existing design tokens.\n2. Convert the request into a compact page brief: purpose, audience, primary action, required sections, content hierarchy, states, and responsive behavior. Resolve minor gaps with sensible assumptions; ask only when a missing decision would materially change the product.\n3. Reuse the project's components, tokens, and dependencies. Do not replace the stack or add a large UI library merely to build one page.\n4. Establish a clear visual direction. Use deliberate typography, spacing, color, depth, and composition; avoid generic placeholder-heavy layouts or a collection of unrelated cards.\n5. Implement the full visible experience, including realistic content, empty/loading/error states when relevant, keyboard focus, semantic HTML, and mobile behavior.\n6. Run the narrowest relevant checks first, then a production build or the project's standard verification command when practical. Inspect the result in a browser when browser tooling is available.\n7. Tell the user what changed, how it was verified, and which local preview URL to open in the **\u9875\u9762\u8BC4\u6CE8** tab for iterative feedback.\n\n## Annotation refinement\n\n1. Distinguish `DOM \u5143\u7D20` annotations from `\u533A\u57DF\u6846\u9009` annotations. A DOM annotation targets an existing rendered element; an area annotation may request a new component where no DOM exists yet.\n2. For a DOM annotation, locate the owning source component using this evidence in order: unique selector or id, visible text, DOM path, nearby component structure, then viewport rectangle. Selectors from generated CSS or CSS Modules are hints, not guaranteed source identifiers.\n3. For an area annotation, use the suggested container and nearby selectors to find the owning layout component. The user may have moved and resized the retained selection before confirming it, so treat the final snapped four-corner coordinates as the strongest placement evidence and the raw coordinates as visual intent. Then inspect the component's Grid/Flex rules, siblings, breakpoints, spacing tokens, and content flow before deciding where to insert markup.\n4. Resolve imperfect area drawing by preferring, in order: an existing container boundary, shared sibling edge or center line, established grid track, design-system spacing, then the snapped rectangle. Use the raw rectangle only as secondary evidence. If two equally plausible placements would produce materially different UI, ask one focused question.\n5. Read the surrounding component and styles before editing. Determine whether the requested change belongs in markup, local styles, shared tokens, content data, or behavior.\n6. Batch compatible annotations by owning component. If two annotations conflict, prefer the more specific requirement and explicitly report the conflict rather than silently guessing.\n7. Make the smallest coherent source change that satisfies the feedback while preserving unmentioned behavior, responsiveness, accessibility, and the page's established visual system.\n8. Verify the changed state at relevant viewport sizes. Re-run targeted tests and the normal frontend build. If the preview server is running, ask the user to refresh and make another annotation pass when useful.\n\n## Quality bar\n\n- Preserve the project's architecture and state/data flow.\n- Prefer semantic elements and visible keyboard focus; maintain readable contrast and usable touch targets.\n- Avoid hard-coded viewport-specific coordinates. Element and area rectangles describe where the intent was observed, not where content must be absolutely positioned.\n- When adding content from an area selection, prefer normal document flow, Grid, or Flex. Use absolute positioning only when the surrounding component already establishes an intentional positioning context.\n- Avoid broad global CSS changes for a local comment unless the feedback clearly identifies a system-wide rule.\n- Keep copy specific and production-like. Do not leave lorem ipsum, unexplained placeholders, fake metrics presented as real data, or nonfunctional primary controls.\n- Do not claim visual verification unless the page was actually rendered or inspected. State any remaining verification gap plainly.\n\n## Expected handoff\n\nReport the implemented page or refinement, the main files changed, checks run, and the preview URL. For annotation work, map each completed comment to its source-level change in a short list.\n";

// src/annotator-script.ts
var ANNOTATOR_SCRIPT = String.raw`
(() => {
  if (window.__dshFrontendAnnotatorInstalled) return;
  window.__dshFrontendAnnotatorInstalled = true;

  const root = document.documentElement;
  const SNAP_THRESHOLD = 8;
  const GRID_SIZE = 8;
  const MIN_AREA_SIZE = 8;

  function ui(tag, name, css) {
    const node = document.createElement(tag);
    node.dataset.dshAnnotatorUi = name;
    node.style.cssText = css;
    root.appendChild(node);
    return node;
  }

  const elementOverlay = ui('div', 'element-overlay', 'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #77b98b;background:rgba(119,185,139,.14);border-radius:5px;display:none;box-sizing:border-box');
  const areaCapture = ui('div', 'area-capture', 'position:fixed;inset:0;z-index:2147483643;display:none;cursor:crosshair;touch-action:none;user-select:none;background:transparent');
  const areaOverlay = ui('div', 'area-overlay', 'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #73a9ff;background:rgba(78,135,230,.18);display:none;box-sizing:border-box;box-shadow:0 0 0 1px rgba(255,255,255,.72) inset;cursor:move;touch-action:none');
  const guideX = ui('div', 'guide-x', 'position:fixed;top:0;bottom:0;z-index:2147483645;pointer-events:none;width:1px;background:#ffcb6b;display:none;box-shadow:0 0 0 1px rgba(0,0,0,.18)');
  const guideY = ui('div', 'guide-y', 'position:fixed;left:0;right:0;z-index:2147483645;pointer-events:none;height:1px;background:#ffcb6b;display:none;box-shadow:0 0 0 1px rgba(0,0,0,.18)');
  const measure = ui('div', 'measure', 'position:fixed;z-index:2147483646;pointer-events:none;display:none;padding:5px 7px;border-radius:6px;background:rgba(15,24,20,.92);color:#eef7f0;font:600 11px/1.3 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.28);white-space:nowrap');
  const areaActions = ui('div', 'area-actions', 'position:fixed;z-index:2147483647;display:none;align-items:center;gap:6px;padding:5px;border:1px solid rgba(255,255,255,.45);border-radius:9px;background:rgba(20,28,39,.94);box-shadow:0 8px 24px rgba(0,0,0,.3);font:600 12px/1.2 system-ui,sans-serif;pointer-events:auto');
  const confirmAreaButton = document.createElement('button');
  confirmAreaButton.type = 'button';
  confirmAreaButton.textContent = '确认选区';
  confirmAreaButton.style.cssText = 'border:0;border-radius:6px;padding:7px 10px;background:#73a9ff;color:#10213b;font:700 12px/1 system-ui,sans-serif;cursor:pointer';
  areaActions.appendChild(confirmAreaButton);
  const cancelAreaButton = document.createElement('button');
  cancelAreaButton.type = 'button';
  cancelAreaButton.textContent = '取消';
  cancelAreaButton.style.cssText = 'border:1px solid rgba(255,255,255,.24);border-radius:6px;padding:6px 9px;background:transparent;color:#eef4ff;font:600 12px/1 system-ui,sans-serif;cursor:pointer';
  areaActions.appendChild(cancelAreaButton);

  const handleStyles = {
    nw: 'left:0;top:0;cursor:nwse-resize',
    n: 'left:50%;top:0;cursor:ns-resize',
    ne: 'left:100%;top:0;cursor:nesw-resize',
    e: 'left:100%;top:50%;cursor:ew-resize',
    se: 'left:100%;top:100%;cursor:nwse-resize',
    s: 'left:50%;top:100%;cursor:ns-resize',
    sw: 'left:0;top:100%;cursor:nesw-resize',
    w: 'left:0;top:50%;cursor:ew-resize'
  };
  for (const [handle, position] of Object.entries(handleStyles)) {
    const node = document.createElement('span');
    node.dataset.dshResizeHandle = handle;
    node.setAttribute('aria-hidden', 'true');
    node.style.cssText = 'position:absolute;z-index:2;width:11px;height:11px;border:2px solid #4f82d3;border-radius:3px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.3);transform:translate(-50%,-50%);touch-action:none;' + position;
    areaOverlay.appendChild(node);
  }
  const button = ui('button', 'toggle', 'position:fixed;right:22px;bottom:22px;z-index:2147483647;width:66px;height:66px;border:1px solid rgba(255,255,255,.5);border-radius:999px;background:linear-gradient(145deg,#dff3e4,#6f9c79);color:#17351f;box-shadow:0 14px 36px rgba(25,61,35,.3);font:700 13px/1.15 system-ui,sans-serif;white-space:pre-line;cursor:grab;user-select:none;touch-action:none');
  button.type = 'button';

  let mode = null;
  let preferredMode = 'element';
  let buttonPointerId = null;
  let buttonStartX = 0;
  let buttonStartY = 0;
  let buttonOriginLeft = 0;
  let buttonOriginTop = 0;
  let buttonMoved = false;
  let areaPointerId = null;
  let drawing = false;
  let rawStart = null;
  let snappedStart = null;
  let startGuides = [];
  let currentRaw = null;
  let currentSnapped = null;
  let currentGuides = [];
  let referenceElements = [];
  let referenceCandidates = { x: [], y: [] };
  let previousUserSelect = '';
  let areaInteraction = null;
  let interactionStartPoint = null;
  let interactionStartBounds = null;
  let resizeHandle = null;
  let draftRawBounds = null;
  let draftBounds = null;
  let draftGuides = [];

  const isUi = (node) => node instanceof Element && Boolean(node.closest('[data-dsh-annotator-ui]'));
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const round = (value) => Math.round(value);
  const round4 = (value) => Math.round(value * 10000) / 10000;
  const post = (message) => window.parent.postMessage(message, '*');
  const consume = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  function selectorFor(element) {
    if (element.id) return '#' + CSS.escape(element.id);
    const parts = [];
    let current = element;
    while (current instanceof Element && current !== root && parts.length < 6) {
      let part = current.localName;
      if (current.classList.length > 0) {
        part += '.' + Array.from(current.classList).slice(0, 2).map((name) => CSS.escape(name)).join('.');
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.localName === current.localName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(' > ');
  }

  function describeElement(element) {
    const bounds = element.getBoundingClientRect();
    const path = [];
    let current = element;
    while (current instanceof Element) {
      path.unshift(current.localName);
      current = current.parentElement;
    }
    return {
      kind: 'element',
      url: document.baseURI,
      tagName: element.localName,
      selector: selectorFor(element),
      domPath: path.join(' > '),
      text: (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 240),
      rect: {
        x: round(bounds.x),
        y: round(bounds.y),
        width: round(bounds.width),
        height: round(bounds.height)
      }
    };
  }

  function hideGuides() {
    guideX.style.display = 'none';
    guideY.style.display = 'none';
  }

  function renderState() {
    const active = mode !== null;
    button.textContent = mode === 'area' ? '结束\n框选' : mode === 'element' ? '结束\n元素' : '页面\n评注';
    button.style.background = active
      ? mode === 'area' ? 'linear-gradient(145deg,#d7e6ff,#5e8bd6)' : 'linear-gradient(145deg,#c8ecd2,#438a59)'
      : 'linear-gradient(145deg,#dff3e4,#6f9c79)';
    button.setAttribute('aria-label', active ? '结束' + (mode === 'area' ? '区域框选' : '元素评注') : '开启页面评注');
    areaCapture.style.display = mode === 'area' ? 'block' : 'none';
    if (mode !== 'element') elementOverlay.style.display = 'none';
    if (mode !== 'area') {
      cancelAreaInteraction();
      areaOverlay.style.display = 'none';
      areaActions.style.display = 'none';
      measure.style.display = 'none';
      hideGuides();
    } else if (draftBounds) {
      renderArea(draftBounds, draftGuides, draftGuides.length > 0, true);
    }
  }

  function setMode(next) {
    const normalized = next === 'element' || next === 'area' ? next : null;
    mode = normalized;
    if (normalized !== null) preferredMode = normalized;
    root.setAttribute('data-dsh-annotator-mode', normalized || 'browse');
    renderState();
    post({ type: 'dsh-frontend-feedback-active', active: normalized !== null, mode: normalized });
  }

  function requestNavigation(url) {
    post({ type: 'dsh-frontend-feedback-navigate', url });
  }

  function reportNavigationError(message) {
    post({ type: 'dsh-frontend-feedback-navigation-error', message });
  }

  function highlight(element) {
    if (mode !== 'element' || !(element instanceof Element) || element === root || element === document.body || isUi(element)) {
      elementOverlay.style.display = 'none';
      return;
    }
    const bounds = element.getBoundingClientRect();
    elementOverlay.style.display = 'block';
    elementOverlay.style.left = bounds.left + 'px';
    elementOverlay.style.top = bounds.top + 'px';
    elementOverlay.style.width = bounds.width + 'px';
    elementOverlay.style.height = bounds.height + 'px';
  }

  function visibleReferenceElements() {
    const result = [];
    const all = document.body ? document.body.querySelectorAll('*') : [];
    for (const element of all) {
      if (!(element instanceof HTMLElement) || isUi(element)) continue;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      const bounds = element.getBoundingClientRect();
      if (bounds.width < 2 || bounds.height < 2) continue;
      if (bounds.right < 0 || bounds.bottom < 0 || bounds.left > innerWidth || bounds.top > innerHeight) continue;
      result.push({
        element,
        selector: selectorFor(element),
        rect: {
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
          width: bounds.width,
          height: bounds.height
        }
      });
      if (result.length >= 800) break;
    }
    return result;
  }

  function alignmentCandidates(references) {
    const x = [];
    const y = [];
    for (const item of references) {
      x.push({ value: item.rect.left, anchor: 'left edge', sourceSelector: item.selector });
      x.push({ value: item.rect.left + item.rect.width / 2, anchor: 'horizontal center', sourceSelector: item.selector });
      x.push({ value: item.rect.right, anchor: 'right edge', sourceSelector: item.selector });
      y.push({ value: item.rect.top, anchor: 'top edge', sourceSelector: item.selector });
      y.push({ value: item.rect.top + item.rect.height / 2, anchor: 'vertical center', sourceSelector: item.selector });
      y.push({ value: item.rect.bottom, anchor: 'bottom edge', sourceSelector: item.selector });
    }
    return { x, y };
  }

  function snapCoordinate(value, axis, candidates, enabled) {
    if (!enabled) return { value, guide: null };
    let best = null;
    for (const candidate of candidates[axis]) {
      const distance = Math.abs(candidate.value - value);
      if (distance > SNAP_THRESHOLD || (best && distance >= best.distance)) continue;
      best = { candidate, distance };
    }
    if (best) {
      return {
        value: best.candidate.value,
        guide: {
          axis,
          coordinate: best.candidate.value,
          anchor: best.candidate.anchor,
          source: 'dom',
          sourceSelector: best.candidate.sourceSelector,
          distance: best.distance
        }
      };
    }
    const gridValue = Math.round(value / GRID_SIZE) * GRID_SIZE;
    return {
      value: gridValue,
      guide: {
        axis,
        coordinate: gridValue,
        anchor: GRID_SIZE + 'px grid',
        source: 'grid',
        distance: Math.abs(gridValue - value)
      }
    };
  }

  function snapPoint(raw, candidates, enabled) {
    const snappedX = snapCoordinate(raw.x, 'x', candidates, enabled);
    const snappedY = snapCoordinate(raw.y, 'y', candidates, enabled);
    return {
      point: { x: snappedX.value, y: snappedY.value },
      guides: [snappedX.guide, snappedY.guide].filter(Boolean)
    };
  }

  function rectangle(a, b) {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y)
    };
  }

  function corners(bounds) {
    return {
      topLeft: { x: round(bounds.x), y: round(bounds.y) },
      topRight: { x: round(bounds.x + bounds.width), y: round(bounds.y) },
      bottomRight: { x: round(bounds.x + bounds.width), y: round(bounds.y + bounds.height) },
      bottomLeft: { x: round(bounds.x), y: round(bounds.y + bounds.height) }
    };
  }

  function roundedRect(bounds) {
    return { x: round(bounds.x), y: round(bounds.y), width: round(bounds.width), height: round(bounds.height) };
  }

  function uniqueGuides(guides) {
    const result = [];
    const seen = new Set();
    for (const guide of guides) {
      const key = guide.axis + ':' + round(guide.coordinate) + ':' + guide.anchor + ':' + (guide.sourceSelector || guide.source);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        axis: guide.axis,
        coordinate: round(guide.coordinate),
        anchor: guide.anchor,
        source: guide.source,
        ...(guide.sourceSelector ? { sourceSelector: guide.sourceSelector } : {}),
        distance: round(guide.distance)
      });
    }
    return result;
  }

  function renderGuides(guides) {
    hideGuides();
    const x = [...guides].reverse().find((guide) => guide.axis === 'x');
    const y = [...guides].reverse().find((guide) => guide.axis === 'y');
    if (x) {
      guideX.style.display = 'block';
      guideX.style.left = x.coordinate + 'px';
    }
    if (y) {
      guideY.style.display = 'block';
      guideY.style.top = y.coordinate + 'px';
    }
  }

  function renderArea(bounds, guides, snapping, adjustable = false) {
    areaOverlay.style.display = 'block';
    areaOverlay.style.pointerEvents = adjustable ? 'auto' : 'none';
    areaOverlay.style.left = bounds.x + 'px';
    areaOverlay.style.top = bounds.y + 'px';
    areaOverlay.style.width = bounds.width + 'px';
    areaOverlay.style.height = bounds.height + 'px';
    measure.style.display = 'block';
    measure.style.left = clamp(bounds.x, 8, Math.max(8, innerWidth - 180)) + 'px';
    measure.style.top = clamp(bounds.y + bounds.height + 8, 8, Math.max(8, innerHeight - 32)) + 'px';
    measure.textContent = round(bounds.width) + ' × ' + round(bounds.height) + (adjustable ? ' · 可拖动调整' : snapping ? ' · 已吸附' : ' · 自由框选');
    if (adjustable) {
      areaActions.style.display = 'flex';
      const actionsWidth = 142;
      areaActions.style.left = clamp(bounds.x + bounds.width - actionsWidth, 8, Math.max(8, innerWidth - actionsWidth - 8)) + 'px';
      const above = bounds.y - 44;
      areaActions.style.top = (above >= 8
        ? above
        : clamp(bounds.y + bounds.height + 36, 8, Math.max(8, innerHeight - 42))) + 'px';
    } else {
      areaActions.style.display = 'none';
    }
    renderGuides(guides);
  }

  function squaredPoint(start, current) {
    const dx = current.x - start.x;
    const dy = current.y - start.y;
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    return {
      x: start.x + (dx < 0 ? -size : size),
      y: start.y + (dy < 0 ? -size : size)
    };
  }

  function updateAreaDrawing(event) {
    if (!drawing || rawStart === null || snappedStart === null) return null;
    currentRaw = {
      x: clamp(event.clientX, 0, innerWidth),
      y: clamp(event.clientY, 0, innerHeight)
    };
    const snapped = snapPoint(currentRaw, referenceCandidates, !event.altKey);
    currentSnapped = event.shiftKey ? squaredPoint(snappedStart, snapped.point) : snapped.point;
    currentGuides = event.shiftKey ? [] : snapped.guides;
    const guides = uniqueGuides([...startGuides, ...currentGuides]);
    const bounds = rectangle(snappedStart, currentSnapped);
    renderArea(bounds, guides, !event.altKey);
    return { bounds, guides };
  }

  function bestAxisAdjustment(anchors, axis, candidates, enabled) {
    if (!enabled) return { delta: 0, guide: null };
    let best = null;
    for (const anchor of anchors) {
      for (const candidate of candidates[axis]) {
        const distance = Math.abs(candidate.value - anchor.value);
        if (distance > SNAP_THRESHOLD || (best && distance >= best.distance)) continue;
        best = { anchor, candidate, distance };
      }
    }
    if (best) {
      return {
        delta: best.candidate.value - best.anchor.value,
        guide: {
          axis,
          coordinate: best.candidate.value,
          anchor: best.anchor.name,
          source: 'dom',
          sourceSelector: best.candidate.sourceSelector,
          distance: best.distance
        }
      };
    }
    const primary = anchors[0];
    const gridValue = Math.round(primary.value / GRID_SIZE) * GRID_SIZE;
    return {
      delta: gridValue - primary.value,
      guide: {
        axis,
        coordinate: gridValue,
        anchor: primary.name + ' to ' + GRID_SIZE + 'px grid',
        source: 'grid',
        distance: Math.abs(gridValue - primary.value)
      }
    };
  }

  function clampBounds(bounds) {
    const width = clamp(bounds.width, MIN_AREA_SIZE, innerWidth);
    const height = clamp(bounds.height, MIN_AREA_SIZE, innerHeight);
    return {
      x: clamp(bounds.x, 0, Math.max(0, innerWidth - width)),
      y: clamp(bounds.y, 0, Math.max(0, innerHeight - height)),
      width,
      height
    };
  }

  function moveBounds(start, point) {
    return clampBounds({
      x: start.x + point.x - interactionStartPoint.x,
      y: start.y + point.y - interactionStartPoint.y,
      width: start.width,
      height: start.height
    });
  }

  function snapMovedBounds(raw, enabled) {
    const x = bestAxisAdjustment([
      { value: raw.x, name: 'left edge' },
      { value: raw.x + raw.width / 2, name: 'horizontal center' },
      { value: raw.x + raw.width, name: 'right edge' }
    ], 'x', referenceCandidates, enabled);
    const y = bestAxisAdjustment([
      { value: raw.y, name: 'top edge' },
      { value: raw.y + raw.height / 2, name: 'vertical center' },
      { value: raw.y + raw.height, name: 'bottom edge' }
    ], 'y', referenceCandidates, enabled);
    return {
      bounds: clampBounds({ ...raw, x: raw.x + x.delta, y: raw.y + y.delta }),
      guides: [x.guide, y.guide].filter(Boolean)
    };
  }

  function resizeBounds(start, handle, point, square) {
    const dx = point.x - interactionStartPoint.x;
    const dy = point.y - interactionStartPoint.y;
    let left = start.x;
    let right = start.x + start.width;
    let top = start.y;
    let bottom = start.y + start.height;
    if (handle.includes('w')) left = clamp(start.x + dx, 0, right - MIN_AREA_SIZE);
    if (handle.includes('e')) right = clamp(start.x + start.width + dx, left + MIN_AREA_SIZE, innerWidth);
    if (handle.includes('n')) top = clamp(start.y + dy, 0, bottom - MIN_AREA_SIZE);
    if (handle.includes('s')) bottom = clamp(start.y + start.height + dy, top + MIN_AREA_SIZE, innerHeight);
    if (square && handle.length === 2) {
      const size = Math.max(right - left, bottom - top);
      if (handle.includes('w')) left = Math.max(0, right - size);
      else right = Math.min(innerWidth, left + size);
      if (handle.includes('n')) top = Math.max(0, bottom - size);
      else bottom = Math.min(innerHeight, top + size);
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function snapResizedBounds(raw, handle, enabled) {
    let left = raw.x;
    let right = raw.x + raw.width;
    let top = raw.y;
    let bottom = raw.y + raw.height;
    const guides = [];
    if (handle.includes('w')) {
      const snapped = snapCoordinate(left, 'x', referenceCandidates, enabled);
      left = Math.min(snapped.value, right - MIN_AREA_SIZE);
      if (snapped.guide) guides.push(snapped.guide);
    }
    if (handle.includes('e')) {
      const snapped = snapCoordinate(right, 'x', referenceCandidates, enabled);
      right = Math.max(snapped.value, left + MIN_AREA_SIZE);
      if (snapped.guide) guides.push(snapped.guide);
    }
    if (handle.includes('n')) {
      const snapped = snapCoordinate(top, 'y', referenceCandidates, enabled);
      top = Math.min(snapped.value, bottom - MIN_AREA_SIZE);
      if (snapped.guide) guides.push(snapped.guide);
    }
    if (handle.includes('s')) {
      const snapped = snapCoordinate(bottom, 'y', referenceCandidates, enabled);
      bottom = Math.max(snapped.value, top + MIN_AREA_SIZE);
      if (snapped.guide) guides.push(snapped.guide);
    }
    return {
      bounds: clampBounds({ x: left, y: top, width: right - left, height: bottom - top }),
      guides
    };
  }

  function updateAreaAdjustment(event) {
    if (!areaInteraction || areaInteraction === 'draw' || !interactionStartPoint || !interactionStartBounds) return null;
    const point = { x: event.clientX, y: event.clientY };
    const raw = areaInteraction === 'move'
      ? moveBounds(interactionStartBounds, point)
      : resizeBounds(interactionStartBounds, resizeHandle, point, event.shiftKey);
    const adjusted = areaInteraction === 'move'
      ? snapMovedBounds(raw, !event.altKey)
      : snapResizedBounds(raw, resizeHandle, !event.altKey);
    draftRawBounds = raw;
    draftBounds = adjusted.bounds;
    draftGuides = uniqueGuides(adjusted.guides);
    renderArea(draftBounds, draftGuides, !event.altKey, true);
    return draftBounds;
  }

  function distanceBetween(a, b) {
    const dx = Math.max(a.left - b.right, b.left - a.right, 0);
    const dy = Math.max(a.top - b.bottom, b.top - a.bottom, 0);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function intersects(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function contains(a, b) {
    return a.left <= b.left && a.top <= b.top && a.right >= b.right && a.bottom >= b.bottom;
  }

  function referenceDescription(item, relation, distance) {
    return {
      tagName: item.element.localName,
      selector: item.selector,
      relation,
      rect: {
        x: round(item.rect.left),
        y: round(item.rect.top),
        width: round(item.rect.width),
        height: round(item.rect.height)
      },
      distance: round(distance)
    };
  }

  function areaReferences(bounds) {
    const selected = {
      left: bounds.x,
      top: bounds.y,
      right: bounds.x + bounds.width,
      bottom: bounds.y + bounds.height,
      width: bounds.width,
      height: bounds.height
    };
    const containers = referenceElements
      .filter((item) => contains(item.rect, selected))
      .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height);
    const containerItem = containers[0];
    const container = containerItem ? referenceDescription(containerItem, 'container', 0) : undefined;
    const centerX = selected.left + selected.width / 2;
    const centerY = selected.top + selected.height / 2;
    const ranked = referenceElements
      .filter((item) => item !== containerItem)
      .map((item) => {
        const distance = distanceBetween(item.rect, selected);
        const centerInside = item.rect.left <= centerX && item.rect.right >= centerX && item.rect.top <= centerY && item.rect.bottom >= centerY;
        const relation = centerInside ? 'contains-center' : intersects(item.rect, selected) ? 'intersects' : 'nearby';
        const weight = relation === 'contains-center' ? 0 : relation === 'intersects' ? 1000 : 2000;
        return { item, distance, relation, score: weight + distance };
      })
      .filter((entry) => entry.relation !== 'nearby' || entry.distance <= 160)
      .sort((a, b) => a.score - b.score)
      .slice(0, 6)
      .map((entry) => referenceDescription(entry.item, entry.relation, entry.distance));
    return { container, nearby: ranked };
  }

  function describeArea(rawBounds, bounds, guides) {
    const roundedRaw = roundedRect(rawBounds);
    const rounded = roundedRect(bounds);
    const pageRect = {
      x: rounded.x + round(scrollX),
      y: rounded.y + round(scrollY),
      width: rounded.width,
      height: rounded.height
    };
    const references = areaReferences(bounds);
    const finalGuides = uniqueGuides(guides);
    return {
      kind: 'area',
      url: document.baseURI,
      coordinateSpace: 'viewport',
      rawRect: roundedRaw,
      rect: rounded,
      pageRect,
      rawCorners: corners(roundedRaw),
      corners: corners(rounded),
      pageCorners: corners(pageRect),
      viewport: {
        width: round(innerWidth),
        height: round(innerHeight),
        scrollX: round(scrollX),
        scrollY: round(scrollY),
        devicePixelRatio: devicePixelRatio || 1
      },
      normalized: {
        left: round4(rounded.x / Math.max(1, innerWidth)),
        top: round4(rounded.y / Math.max(1, innerHeight)),
        width: round4(rounded.width / Math.max(1, innerWidth)),
        height: round4(rounded.height / Math.max(1, innerHeight))
      },
      alignment: {
        snapped: finalGuides.length > 0,
        threshold: SNAP_THRESHOLD,
        guides: finalGuides
      },
      ...(references.container ? { container: references.container } : {}),
      nearby: references.nearby
    };
  }

  function cancelAreaInteraction() {
    drawing = false;
    areaInteraction = null;
    areaPointerId = null;
    rawStart = null;
    snappedStart = null;
    startGuides = [];
    currentRaw = null;
    currentSnapped = null;
    currentGuides = [];
    interactionStartPoint = null;
    interactionStartBounds = null;
    resizeHandle = null;
    referenceElements = [];
    referenceCandidates = { x: [], y: [] };
    if (document.body) document.body.style.userSelect = previousUserSelect;
  }

  function clearAreaDraft(notify = true) {
    cancelAreaInteraction();
    draftRawBounds = null;
    draftBounds = null;
    draftGuides = [];
    areaOverlay.style.display = 'none';
    areaOverlay.style.pointerEvents = 'none';
    areaActions.style.display = 'none';
    measure.style.display = 'none';
    hideGuides();
    confirmAreaButton.textContent = '确认选区';
    if (notify) post({ type: 'dsh-frontend-feedback-area-draft', active: false });
  }

  function notifyAreaDraft() {
    if (!draftBounds) return;
    post({
      type: 'dsh-frontend-feedback-area-draft',
      active: true,
      rect: roundedRect(draftBounds)
    });
  }

  function beginAreaAdjustment(event) {
    if (mode !== 'area' || !draftBounds || event.button !== 0) return;
    const handle = event.target instanceof Element ? event.target.closest('[data-dsh-resize-handle]') : null;
    areaInteraction = handle ? 'resize' : 'move';
    resizeHandle = handle?.dataset.dshResizeHandle || null;
    areaPointerId = event.pointerId;
    interactionStartPoint = { x: event.clientX, y: event.clientY };
    interactionStartBounds = { ...draftBounds };
    referenceElements = visibleReferenceElements();
    referenceCandidates = alignmentCandidates(referenceElements);
    previousUserSelect = document.body ? document.body.style.userSelect : '';
    if (document.body) document.body.style.userSelect = 'none';
    confirmAreaButton.textContent = '确认选区';
    notifyAreaDraft();
    consume(event);
  }

  function completeAreaInteraction(event) {
    if (event.pointerId !== areaPointerId) return;
    if (areaInteraction === 'draw') {
      const result = updateAreaDrawing(event);
      const rawEnd = currentRaw;
      const rawOrigin = rawStart;
      const snappedOrigin = snappedStart;
      cancelAreaInteraction();
      if (result === null || rawEnd === null || rawOrigin === null || snappedOrigin === null || result.bounds.width < MIN_AREA_SIZE || result.bounds.height < MIN_AREA_SIZE) {
        clearAreaDraft();
        post({ type: 'dsh-frontend-feedback-selection-error', message: '框选区域太小，请拖出至少 8 × 8 px 的区域。' });
        return;
      }
      draftRawBounds = rectangle(rawOrigin, rawEnd);
      draftBounds = result.bounds;
      draftGuides = uniqueGuides(result.guides);
    } else {
      updateAreaAdjustment(event);
      cancelAreaInteraction();
    }
    if (!draftBounds) return;
    renderArea(draftBounds, draftGuides, draftGuides.length > 0, true);
    notifyAreaDraft();
  }

  window.addEventListener('message', (event) => {
    if (event.data?.type === 'dsh-frontend-feedback-set-mode') setMode(event.data.mode);
    if (event.data?.type === 'dsh-frontend-feedback-set-active') setMode(event.data.active ? preferredMode : null);
  });

  document.addEventListener('mouseover', (event) => highlight(event.target), true);
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || isUi(event.target)) return;
    if (mode === 'element') {
      consume(event);
      post({ type: 'dsh-frontend-feedback-selected', payload: describeElement(event.target) });
      return;
    }
    if (mode === 'area') {
      consume(event);
      return;
    }
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('download')) return;
    let target;
    try {
      target = new URL(anchor.getAttribute('href') || '', document.baseURI);
    } catch {
      return;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return;
    consume(event);
    requestNavigation(target.href);
  }, true);

  document.addEventListener('submit', (event) => {
    if (!(event.target instanceof HTMLFormElement) || isUi(event.target)) return;
    if (mode !== null) {
      consume(event);
      return;
    }
    if (event.defaultPrevented) return;
    const form = event.target;
    const method = (form.method || 'get').toUpperCase();
    consume(event);
    if (method !== 'GET') {
      reportNavigationError('迷你浏览器当前仅支持 GET 表单跳转；POST、登录和上传提交暂不代理。');
      return;
    }
    try {
      const target = new URL(form.action || document.baseURI, document.baseURI);
      if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('只支持 http 或 https');
      target.search = '';
      const data = new FormData(form);
      const submitter = event.submitter;
      if (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) {
        if (submitter.name) data.append(submitter.name, submitter.value);
      }
      for (const [name, value] of data.entries()) {
        if (typeof value === 'string') target.searchParams.append(name, value);
      }
      requestNavigation(target.href);
    } catch (error) {
      reportNavigationError('无法打开表单目标：' + (error instanceof Error ? error.message : String(error)));
    }
  }, true);

  areaCapture.addEventListener('pointerdown', (event) => {
    if (mode !== 'area' || event.button !== 0) return;
    clearAreaDraft(false);
    areaInteraction = 'draw';
    areaPointerId = event.pointerId;
    drawing = true;
    referenceElements = visibleReferenceElements();
    referenceCandidates = alignmentCandidates(referenceElements);
    rawStart = { x: clamp(event.clientX, 0, innerWidth), y: clamp(event.clientY, 0, innerHeight) };
    const snapped = snapPoint(rawStart, referenceCandidates, !event.altKey);
    snappedStart = snapped.point;
    startGuides = snapped.guides;
    currentRaw = rawStart;
    currentSnapped = snappedStart;
    currentGuides = [];
    previousUserSelect = document.body ? document.body.style.userSelect : '';
    if (document.body) document.body.style.userSelect = 'none';
    renderArea(rectangle(snappedStart, snappedStart), startGuides, !event.altKey);
    post({ type: 'dsh-frontend-feedback-area-draft', active: true });
    consume(event);
  });

  areaOverlay.addEventListener('pointerdown', (event) => beginAreaAdjustment(event));

  window.addEventListener('pointermove', (event) => {
    if (event.pointerId !== areaPointerId || !areaInteraction) return;
    if (areaInteraction === 'draw') updateAreaDrawing(event);
    else updateAreaAdjustment(event);
    consume(event);
  }, true);

  window.addEventListener('pointerup', (event) => {
    if (event.pointerId !== areaPointerId || !areaInteraction) return;
    consume(event);
    completeAreaInteraction(event);
  }, true);

  window.addEventListener('pointercancel', (event) => {
    if (event.pointerId !== areaPointerId || !areaInteraction) return;
    const wasDrawing = areaInteraction === 'draw';
    cancelAreaInteraction();
    if (wasDrawing || !draftBounds) clearAreaDraft();
    else renderArea(draftBounds, draftGuides, draftGuides.length > 0, true);
  }, true);

  confirmAreaButton.addEventListener('click', (event) => {
    consume(event);
    if (!draftBounds || !draftRawBounds) return;
    referenceElements = visibleReferenceElements();
    const payload = describeArea(draftRawBounds, draftBounds, draftGuides);
    confirmAreaButton.textContent = '更新坐标';
    post({ type: 'dsh-frontend-feedback-selected', payload });
  });

  cancelAreaButton.addEventListener('click', (event) => {
    consume(event);
    clearAreaDraft();
  });

  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    buttonPointerId = event.pointerId;
    buttonStartX = event.clientX;
    buttonStartY = event.clientY;
    const bounds = button.getBoundingClientRect();
    buttonOriginLeft = bounds.left;
    buttonOriginTop = bounds.top;
    buttonMoved = false;
    button.setPointerCapture(buttonPointerId);
    button.style.cursor = 'grabbing';
    consume(event);
  });

  button.addEventListener('pointermove', (event) => {
    if (buttonPointerId !== event.pointerId) return;
    const dx = event.clientX - buttonStartX;
    const dy = event.clientY - buttonStartY;
    if (Math.abs(dx) + Math.abs(dy) > 4) buttonMoved = true;
    if (!buttonMoved) return;
    button.style.right = 'auto';
    button.style.bottom = 'auto';
    button.style.left = clamp(buttonOriginLeft + dx, 8, Math.max(8, innerWidth - button.offsetWidth - 8)) + 'px';
    button.style.top = clamp(buttonOriginTop + dy, 8, Math.max(8, innerHeight - button.offsetHeight - 8)) + 'px';
  });

  button.addEventListener('pointerup', (event) => {
    if (buttonPointerId !== event.pointerId) return;
    button.releasePointerCapture(buttonPointerId);
    buttonPointerId = null;
    button.style.cursor = 'grab';
    consume(event);
    if (!buttonMoved) setMode(mode === null ? preferredMode : null);
  });

  button.addEventListener('pointercancel', () => {
    buttonPointerId = null;
    buttonMoved = false;
    button.style.cursor = 'grab';
  });
  button.addEventListener('click', (event) => consume(event));

  renderState();
  post({ type: 'dsh-frontend-feedback-ready', url: document.baseURI, modes: ['element', 'area'] });
})();
`;

// src/preview.ts
var LOOPBACK_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);
function normalizeHost(host) {
  return host.trim().toLowerCase();
}
function isLoopbackHost(hostname) {
  const host = normalizeHost(hostname);
  return LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost");
}
function assertPreviewUrl(rawUrl, policy = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("\u9884\u89C8\u5730\u5740\u4E0D\u662F\u6709\u6548 URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("\u53EA\u652F\u6301 http \u6216 https \u9884\u89C8\u5730\u5740");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error("\u9884\u89C8\u5730\u5740\u4E0D\u80FD\u5305\u542B\u7528\u6237\u540D\u6216\u5BC6\u7801");
  }
  const allowed = new Set((policy.allowedHosts ?? []).map(normalizeHost));
  if (policy.allowRemoteHosts !== true && !isLoopbackHost(url.hostname) && !allowed.has(normalizeHost(url.hostname))) {
    throw new Error("\u9ED8\u8BA4\u53EA\u5141\u8BB8\u9884\u89C8\u672C\u673A\u5730\u5740\uFF1B\u8BF7\u5728\u63D2\u4EF6\u914D\u7F6E\u4E2D\u663E\u5F0F\u5141\u8BB8\u8FDC\u7A0B\u4E3B\u673A");
  }
  return url;
}
function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function buildPreviewHtml(html, targetUrl) {
  const baseTag = `<base href="${escapeHtml(targetUrl)}">`;
  const safeScript = ANNOTATOR_SCRIPT.replace(/<\/script/gi, "<\\/script");
  const scriptTag = `<script>${safeScript}</script>`;
  const withBase = /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`) : `${baseTag}${html}`;
  return /<\/body>/i.test(withBase) ? withBase.replace(/<\/body>/i, `${scriptTag}</body>`) : `${withBase}${scriptTag}`;
}
async function readHtmlWithLimit(response, maxBytes) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`\u9875\u9762\u8D85\u8FC7 ${maxBytes} \u5B57\u8282\u7684\u9884\u89C8\u4E0A\u9650`);
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`\u9875\u9762\u8D85\u8FC7 ${maxBytes} \u5B57\u8282\u7684\u9884\u89C8\u4E0A\u9650`);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

// src/shared.ts
var DEFAULT_PREVIEW_URL = "http://localhost:5173";
var MAX_PREVIEW_HISTORY_ENTRIES = 50;
var PREVIEW_URL_STORAGE_PREFIX = "dsh-frontend-feedback.preview-url:";
var PREVIEW_HISTORY_STORAGE_PREFIX = "dsh-frontend-feedback.preview-history:";
var LOOPBACK_PREVIEW_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);
function previewUrlStorageKey(sessionId) {
  return `${PREVIEW_URL_STORAGE_PREFIX}${encodeURIComponent(sessionId)}`;
}
function previewHistoryStorageKey(sessionId) {
  return `${PREVIEW_HISTORY_STORAGE_PREFIX}${encodeURIComponent(sessionId)}`;
}
function normalizePreviewUrl(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}
function resolvePersistedPreviewUrl(value) {
  return normalizePreviewUrl(value) ?? DEFAULT_PREVIEW_URL;
}
function currentPreviewUrl(navigation) {
  return navigation.entries[navigation.index] ?? DEFAULT_PREVIEW_URL;
}
function pushPreviewNavigation(navigation, targetUrl) {
  const normalizedTarget = normalizePreviewUrl(targetUrl);
  if (normalizedTarget === null) throw new Error("\u53EA\u652F\u6301\u6709\u6548\u7684 http \u6216 https \u5730\u5740");
  if (currentPreviewUrl(navigation) === normalizedTarget) return navigation;
  const entries = [...navigation.entries.slice(0, navigation.index + 1), normalizedTarget].slice(-MAX_PREVIEW_HISTORY_ENTRIES);
  return { entries, index: entries.length - 1 };
}
function movePreviewNavigation(navigation, delta) {
  const index = navigation.index + delta;
  return index < 0 || index >= navigation.entries.length ? null : { ...navigation, index };
}
function resolvePersistedPreviewNavigation(value, fallbackUrl = DEFAULT_PREVIEW_URL) {
  const fallback = resolvePersistedPreviewUrl(fallbackUrl);
  if (value === null || value === void 0 || value.trim().length === 0) {
    return { entries: [fallback], index: 0 };
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed.entries)) return { entries: [fallback], index: 0 };
    const requestedIndex = Number.isInteger(parsed.index) ? Number(parsed.index) : parsed.entries.length - 1;
    const normalized = [];
    let normalizedIndex = -1;
    parsed.entries.forEach((entry, sourceIndex) => {
      const url = normalizePreviewUrl(entry);
      if (url === null) return;
      normalized.push(url);
      if (sourceIndex <= requestedIndex) normalizedIndex = normalized.length - 1;
    });
    if (normalized.length === 0) return { entries: [fallback], index: 0 };
    const offset = Math.max(0, normalized.length - MAX_PREVIEW_HISTORY_ENTRIES);
    const entries = normalized.slice(offset);
    const index = Math.min(
      entries.length - 1,
      Math.max(0, (normalizedIndex < 0 ? 0 : normalizedIndex) - offset)
    );
    return { entries, index };
  } catch {
    return { entries: [fallback], index: 0 };
  }
}
function isLoopbackPreviewHost(hostname) {
  const host = hostname.toLowerCase();
  return LOOPBACK_PREVIEW_HOSTS.has(host) || host.endsWith(".localhost");
}
function effectivePort(url) {
  if (url.port.length > 0) return url.port;
  return url.protocol === "https:" ? "443" : "80";
}
function resolvePreviewFrameLocation(targetUrl, harnessUrl, revision = 0) {
  const target = new URL(targetUrl);
  const harness = new URL(harnessUrl);
  const bothLoopback = isLoopbackPreviewHost(target.hostname) && isLoopbackPreviewHost(harness.hostname);
  const targetIsHarness = bothLoopback && target.protocol === harness.protocol && effectivePort(target) === effectivePort(harness);
  let previewOrigin;
  let allowSameOrigin = false;
  if (targetIsHarness) {
    previewOrigin = new URL(target.origin);
    allowSameOrigin = true;
  } else if (harness.hostname === "localhost" || harness.hostname.endsWith(".localhost")) {
    previewOrigin = new URL(harness.origin);
    previewOrigin.hostname = "127.0.0.1";
    allowSameOrigin = true;
  } else if (harness.hostname === "127.0.0.1" || harness.hostname === "[::1]") {
    previewOrigin = new URL(harness.origin);
    previewOrigin.hostname = "localhost";
    allowSameOrigin = true;
  } else {
    previewOrigin = new URL(harness.origin);
  }
  const endpoint = new URL("/api/frontend-feedback/preview", previewOrigin);
  endpoint.searchParams.set("url", target.href);
  endpoint.searchParams.set("revision", String(revision));
  endpoint.hash = target.hash;
  return { src: endpoint.href, allowSameOrigin };
}
function line(label, value) {
  return `${label}: ${value.length > 0 ? value : "(empty)"}`;
}
function point(value) {
  return `(${value.x}, ${value.y})`;
}
function rect(value) {
  return `x=${value.x}, y=${value.y}, width=${value.width}, height=${value.height}`;
}
function formatAreaGuide(guide) {
  const target = guide.source === "grid" ? "8px grid" : guide.sourceSelector ?? "nearby DOM";
  return `${guide.axis}=${guide.coordinate} (${guide.anchor}, ${target}, delta=${guide.distance}px)`;
}
function formatReference(item) {
  return `${item.relation}: <${item.tagName}> ${item.selector}; ${rect(item.rect)}; distance=${item.distance}px`;
}
function formatElementComment(item, index) {
  return [
    `## \u8BC4\u6CE8 ${index + 1} \xB7 DOM \u5143\u7D20`,
    line("\u9875\u9762", item.url),
    line("\u5143\u7D20", `<${item.tagName}>`),
    line("CSS selector", item.selector),
    line("DOM path", item.domPath),
    line("\u5F53\u524D\u6587\u672C", item.text),
    `\u89C6\u53E3\u4F4D\u7F6E: ${rect(item.rect)}`,
    line("\u4FEE\u6539\u8981\u6C42", item.comment)
  ].join("\n");
}
function formatAreaComment(item, index) {
  const guides = item.alignment.guides.length === 0 ? "(none; infer alignment from the surrounding layout)" : item.alignment.guides.map(formatAreaGuide).join("; ");
  const nearby = item.nearby.length === 0 ? "(none)" : item.nearby.map(formatReference).join("\n- ");
  return [
    `## \u8BC4\u6CE8 ${index + 1} \xB7 \u533A\u57DF\u6846\u9009\uFF08\u53EF\u65B0\u589E DOM\uFF09`,
    line("\u9875\u9762", item.url),
    `\u89C6\u53E3: width=${item.viewport.width}, height=${item.viewport.height}, scrollX=${item.viewport.scrollX}, scrollY=${item.viewport.scrollY}, dpr=${item.viewport.devicePixelRatio}`,
    `\u539F\u59CB\u89C6\u53E3\u77E9\u5F62: ${rect(item.rawRect)}`,
    `\u539F\u59CB\u89C6\u53E3\u56DB\u70B9: top-left=${point(item.rawCorners.topLeft)}, top-right=${point(item.rawCorners.topRight)}, bottom-right=${point(item.rawCorners.bottomRight)}, bottom-left=${point(item.rawCorners.bottomLeft)}`,
    `\u89C6\u53E3\u77E9\u5F62: ${rect(item.rect)}`,
    `\u89C6\u53E3\u56DB\u70B9: top-left=${point(item.corners.topLeft)}, top-right=${point(item.corners.topRight)}, bottom-right=${point(item.corners.bottomRight)}, bottom-left=${point(item.corners.bottomLeft)}`,
    `\u9875\u9762\u77E9\u5F62: ${rect(item.pageRect)}`,
    `\u9875\u9762\u56DB\u70B9: top-left=${point(item.pageCorners.topLeft)}, top-right=${point(item.pageCorners.topRight)}, bottom-right=${point(item.pageCorners.bottomRight)}, bottom-left=${point(item.pageCorners.bottomLeft)}`,
    `\u76F8\u5BF9\u89C6\u53E3: left=${item.normalized.left}, top=${item.normalized.top}, width=${item.normalized.width}, height=${item.normalized.height}`,
    `\u5438\u9644\u4FE1\u606F: snapped=${item.alignment.snapped}, threshold=${item.alignment.threshold}px; ${guides}`,
    line("\u5EFA\u8BAE\u5BB9\u5668", item.container === void 0 ? "" : formatReference(item.container)),
    `\u9644\u8FD1\u5143\u7D20:
- ${nearby}`,
    line("\u4FEE\u6539\u8981\u6C42", item.comment)
  ].join("\n");
}
function buildAnnotationPrompt(comments) {
  if (comments.length === 0) throw new Error("\u81F3\u5C11\u9700\u8981\u4E00\u6761\u9875\u9762\u8BC4\u6CE8");
  const entries = comments.map((item, index) => item.kind === "area" ? formatAreaComment(item, index) : formatElementComment(item, index)).join("\n\n");
  return [
    "[frontend-feedback]",
    "\u8BF7\u4F7F\u7528 frontend-page-builder Skill \u5904\u7406\u4EE5\u4E0B\u524D\u7AEF\u9875\u9762\u8BC4\u6CE8\u3002",
    "\u5148\u5728\u5F53\u524D\u5DE5\u4F5C\u533A\u5B9A\u4F4D\u8FD9\u4E9B selector \u5BF9\u5E94\u7684\u7EC4\u4EF6\u548C\u6837\u5F0F\uFF0C\u518D\u5B9E\u65BD\u5C40\u90E8\u4FEE\u6539\uFF1B\u4E0D\u8981\u53EA\u8F93\u51FA\u5EFA\u8BAE\u3002",
    "\u201C\u533A\u57DF\u6846\u9009\u201D\u8868\u793A\u7528\u6237\u5E0C\u671B\u5728\u8BE5\u89C6\u89C9\u533A\u57DF\u65B0\u589E\u6216\u8C03\u6574\u5185\u5BB9\uFF1B\u5B83\u53EF\u80FD\u6CA1\u6709\u73B0\u6210 DOM\u3002\u8BF7\u7ED3\u5408\u5EFA\u8BAE\u5BB9\u5668\u3001\u9644\u8FD1\u5143\u7D20\u3001\u5BF9\u9F50\u53C2\u8003\u548C\u73B0\u6709\u5E03\u5C40\u7CFB\u7EDF\u786E\u5B9A\u6E90\u7801\u5F52\u5C5E\u3002",
    "\u533A\u57DF\u5750\u6807\u662F\u89C6\u89C9\u8BC1\u636E\u800C\u4E0D\u662F\u7EDD\u5BF9\u5B9A\u4F4D\u6307\u4EE4\u3002\u4F18\u5148\u4F7F\u7528\u73B0\u6709 Grid/Flex\u3001\u5BB9\u5668\u8FB9\u754C\u548C\u8BBE\u8BA1\u95F4\u8DDD\uFF1B\u82E5\u539F\u59CB\u6846\u9009\u7565\u6709\u504F\u5DEE\uFF0C\u4EE5\u4E00\u81F4\u7684\u8FB9\u7F18\u3001\u4E2D\u5FC3\u7EBF\u548C\u54CD\u5E94\u5F0F\u5E03\u5C40\u4E3A\u51C6\uFF0C\u907F\u514D\u673A\u68B0\u751F\u6210 viewport-specific absolute positioning\u3002",
    "\u4FDD\u6301\u672A\u88AB\u8BC4\u6CE8\u533A\u57DF\u7684\u884C\u4E3A\u548C\u89C6\u89C9\u5C42\u7EA7\uFF0C\u5B8C\u6210\u540E\u8FD0\u884C\u4E0E\u6539\u52A8\u76F8\u79F0\u7684\u6784\u5EFA\u6216\u6D4B\u8BD5\uFF0C\u5E76\u7B80\u8981\u8BF4\u660E\u9A8C\u8BC1\u7ED3\u679C\u3002",
    "",
    entries
  ].join("\n");
}
function isElementSelection(value) {
  if (value === null || typeof value !== "object") return false;
  const item = value;
  const rect2 = item.rect;
  return item.kind !== "area" && typeof item.url === "string" && typeof item.tagName === "string" && typeof item.selector === "string" && typeof item.domPath === "string" && typeof item.text === "string" && rect2 !== void 0 && isFiniteNumber(rect2.x) && isFiniteNumber(rect2.y) && isFiniteNumber(rect2.width) && isFiniteNumber(rect2.height);
}
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function isPoint(value) {
  if (value === null || typeof value !== "object") return false;
  const item = value;
  return isFiniteNumber(item.x) && isFiniteNumber(item.y);
}
function isRect(value) {
  if (value === null || typeof value !== "object") return false;
  const item = value;
  return isFiniteNumber(item.x) && isFiniteNumber(item.y) && isFiniteNumber(item.width) && isFiniteNumber(item.height);
}
function isAreaGuide(value) {
  if (value === null || typeof value !== "object") return false;
  const item = value;
  return (item.axis === "x" || item.axis === "y") && isFiniteNumber(item.coordinate) && typeof item.anchor === "string" && (item.source === "dom" || item.source === "grid") && (item.sourceSelector === void 0 || typeof item.sourceSelector === "string") && isFiniteNumber(item.distance);
}
function isAreaReference(value) {
  if (value === null || typeof value !== "object") return false;
  const item = value;
  return typeof item.tagName === "string" && typeof item.selector === "string" && (item.relation === "container" || item.relation === "contains-center" || item.relation === "intersects" || item.relation === "nearby") && isRect(item.rect) && isFiniteNumber(item.distance);
}
function isAreaSelection(value) {
  if (value === null || typeof value !== "object") return false;
  const item = value;
  const rawCorners = item.rawCorners;
  const corners = item.corners;
  const pageCorners = item.pageCorners;
  const viewport = item.viewport;
  const normalized = item.normalized;
  const alignment = item.alignment;
  return item.kind === "area" && typeof item.url === "string" && item.coordinateSpace === "viewport" && isRect(item.rawRect) && isRect(item.rect) && isRect(item.pageRect) && rawCorners !== void 0 && isPoint(rawCorners.topLeft) && isPoint(rawCorners.topRight) && isPoint(rawCorners.bottomRight) && isPoint(rawCorners.bottomLeft) && corners !== void 0 && isPoint(corners.topLeft) && isPoint(corners.topRight) && isPoint(corners.bottomRight) && isPoint(corners.bottomLeft) && pageCorners !== void 0 && isPoint(pageCorners.topLeft) && isPoint(pageCorners.topRight) && isPoint(pageCorners.bottomRight) && isPoint(pageCorners.bottomLeft) && viewport !== void 0 && isFiniteNumber(viewport.width) && isFiniteNumber(viewport.height) && isFiniteNumber(viewport.scrollX) && isFiniteNumber(viewport.scrollY) && isFiniteNumber(viewport.devicePixelRatio) && normalized !== void 0 && isFiniteNumber(normalized.left) && isFiniteNumber(normalized.top) && isFiniteNumber(normalized.width) && isFiniteNumber(normalized.height) && alignment !== void 0 && typeof alignment.snapped === "boolean" && isFiniteNumber(alignment.threshold) && Array.isArray(alignment.guides) && alignment.guides.length <= 8 && alignment.guides.every(isAreaGuide) && (item.container === void 0 || isAreaReference(item.container)) && Array.isArray(item.nearby) && item.nearby.length <= 8 && item.nearby.every(isAreaReference);
}
function isFeedbackSelection(value) {
  return isAreaSelection(value) || isElementSelection(value);
}

// src/index.ts
var name = "frontend-feedback";
var inject = ["webServer", "skills"];
var DEFAULT_MAX_HTML_BYTES = 5 * 1024 * 1024;
var DEFAULT_TIMEOUT_MS = 15e3;
var SKILL_DESCRIPTION = "Build or redesign polished frontend pages and components, then refine them from [frontend-feedback] DOM annotations. Use for initial UI implementation, visual/layout work, responsive behavior, accessibility, or selector-specific iteration requests.";
function markdownBody(source) {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
}
function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}
function buildPreviewErrorHtml(status, message) {
  const safeMessage = escapeHtml(message);
  const payload = JSON.stringify({
    type: "dsh-frontend-feedback-error",
    status,
    message
  }).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>\u9884\u89C8\u52A0\u8F7D\u5931\u8D25</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f8f7; color: #17231b; }
    main { width: min(560px, calc(100% - 48px)); padding: 28px; border: 1px solid #cbd8cf; border-radius: 14px; background: white; box-shadow: 0 18px 50px rgba(30, 60, 40, .12); }
    strong { display: block; color: #a33a3a; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 10px 0 12px; font-size: 22px; }
    p { margin: 0; color: #536259; line-height: 1.65; word-break: break-word; }
    code { display: inline-block; margin-top: 16px; padding: 5px 8px; border-radius: 6px; background: #edf2ee; color: #405047; }
  </style>
</head>
<body>
  <main><strong>HTTP ${status}</strong><h1>\u9884\u89C8\u52A0\u8F7D\u5931\u8D25</h1><p>${safeMessage}</p><code>frontend-feedback</code></main>
  <script>window.parent.postMessage(${payload}, '*')</script>
</body>
</html>`;
}
function sendPreviewError(res, status, message) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(buildPreviewErrorHtml(status, message));
}
async function handlePreview(req, res, config) {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    sendPreviewError(res, 405, "\u53EA\u652F\u6301 GET");
    return;
  }
  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  const rawTarget = requestUrl.searchParams.get("url");
  if (rawTarget === null || rawTarget.trim().length === 0) {
    sendPreviewError(res, 400, "\u7F3A\u5C11 url \u67E5\u8BE2\u53C2\u6570");
    return;
  }
  const policy = {
    allowRemoteHosts: config.allowRemoteHosts,
    allowedHosts: config.allowedHosts
  };
  let target;
  try {
    target = assertPreviewUrl(rawTarget, policy);
  } catch (error) {
    sendPreviewError(res, 400, describeError(error));
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const upstream = await fetch(target, {
      headers: { accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: controller.signal
    });
    if (!upstream.ok) {
      sendPreviewError(res, 502, `\u76EE\u6807\u9875\u9762\u8FD4\u56DE HTTP ${upstream.status}`);
      return;
    }
    try {
      assertPreviewUrl(upstream.url, policy);
    } catch (error) {
      sendPreviewError(res, 400, `\u91CD\u5B9A\u5411\u88AB\u62D2\u7EDD\uFF1A${describeError(error)}`);
      return;
    }
    const contentType = upstream.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      sendPreviewError(res, 415, `\u76EE\u6807\u5185\u5BB9\u4E0D\u662F HTML\uFF08${contentType || "\u672A\u77E5\u7C7B\u578B"}\uFF09`);
      return;
    }
    const html = await readHtmlWithLimit(upstream, config.maxHtmlBytes ?? DEFAULT_MAX_HTML_BYTES);
    const output = buildPreviewHtml(html, upstream.url);
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer"
    });
    res.end(output);
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "\u83B7\u53D6\u76EE\u6807\u9875\u9762\u8D85\u65F6" : `\u65E0\u6CD5\u83B7\u53D6\u76EE\u6807\u9875\u9762\uFF1A${describeError(error)}`;
    sendPreviewError(res, 502, message);
  } finally {
    clearTimeout(timeout);
  }
}
function apply(ctx, config = {}) {
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/api/frontend-feedback/preview",
    handler: (req, res) => handlePreview(req, res, config)
  }), "frontend-feedback: preview route");
  ctx.skills.register({
    name: "frontend-page-builder",
    description: SKILL_DESCRIPTION,
    source: "bundled",
    resourceBase: {
      kind: "opaque",
      description: "The skill is bundled into dsh-frontend-feedback and is self-contained."
    },
    content: markdownBody(SKILL_default)
  });
}
export {
  DEFAULT_PREVIEW_URL,
  MAX_PREVIEW_HISTORY_ENTRIES,
  apply,
  assertPreviewUrl,
  buildAnnotationPrompt,
  buildPreviewErrorHtml,
  buildPreviewHtml,
  currentPreviewUrl,
  inject,
  isAreaSelection,
  isElementSelection,
  isFeedbackSelection,
  movePreviewNavigation,
  name,
  normalizePreviewUrl,
  previewHistoryStorageKey,
  previewUrlStorageKey,
  pushPreviewNavigation,
  readHtmlWithLimit,
  resolvePersistedPreviewNavigation,
  resolvePersistedPreviewUrl,
  resolvePreviewFrameLocation
};
