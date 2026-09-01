export const ANNOTATOR_SCRIPT = String.raw`
(() => {
  if (window.__dshFrontendAnnotatorInstalled) return;
  window.__dshFrontendAnnotatorInstalled = true;

  const root = document.documentElement;
  const SNAP_THRESHOLD = 8;
  const GRID_SIZE = 8;
  const MIN_AREA_SIZE = 8;
  const MAX_ELEMENT_HTML = 1600;
  const MAX_CONTAINER_HTML = 2400;
  const MAX_REFERENCE_HTML = 900;

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
  const imageSlotOverlay = ui('div', 'image-slot-overlay', 'position:fixed;z-index:2147483644;pointer-events:none;display:none;border:2px dashed #88c99a;border-radius:7px;box-sizing:border-box;background:rgba(136,201,154,.08)');
  const imageSlotBadge = ui('div', 'image-slot-badge', 'position:fixed;z-index:2147483645;pointer-events:none;display:none;padding:5px 8px;border-radius:6px;background:#eff9f1;color:#173d24;font:700 11px/1.2 system-ui,sans-serif;box-shadow:0 3px 12px rgba(0,0,0,.22);white-space:nowrap');
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
  let mode = null;
  let areaPointerId = null;
  let rawStart = null;
  let snappedStart = null;
  let startGuides = [];
  let currentRaw = null;
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
  let assetBindings = new Map();
  let assetApplyFrame = null;
  let hoveredImageSlot = null;
  const imageStates = new WeakMap();
  const slotStates = new WeakMap();

  const isUi = (node) => node instanceof Element && Boolean(node.closest('[data-dsh-annotator-ui]'));
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const round = (value) => Math.round(value);
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

  function htmlSnippet(element, maxLength) {
    if (!(element instanceof Element)) return '';
    const clone = element.cloneNode(true);
    if (!(clone instanceof Element)) return '';
    for (const node of [clone, ...clone.querySelectorAll('*')]) {
      if (node.matches('script, style, noscript, template, [data-dsh-annotator-ui]')) {
        if (node !== clone) node.remove();
        continue;
      }
      for (const attribute of Array.from(node.attributes)) {
        const name = attribute.name.toLowerCase();
        if (name.startsWith('on') || name === 'srcdoc' || name === 'nonce' || name === 'integrity') {
          node.removeAttribute(attribute.name);
        }
      }
      if (node instanceof HTMLInputElement) node.removeAttribute('value');
      if (node instanceof HTMLTextAreaElement) node.textContent = '';
      const src = node.getAttribute('src');
      if (src && (src.startsWith('data:') || src.startsWith('blob:'))) node.setAttribute('src', '[embedded-resource]');
    }
    return clone.outerHTML.trim().replace(/\s+/g, ' ').slice(0, maxLength);
  }

  function domSnapshot(element, maxLength) {
    return {
      tagName: element.localName,
      selector: selectorFor(element),
      html: htmlSnippet(element, maxLength)
    };
  }

  function containerForElement(element) {
    let current = element.parentElement;
    const semanticContainers = new Set(['main', 'section', 'article', 'form', 'nav', 'header', 'footer', 'aside']);
    while (current && current !== document.body) {
      const display = getComputedStyle(current).display;
      if (semanticContainers.has(current.localName) || current.id || current.classList.length > 0 || display === 'flex' || display === 'grid') {
        return current;
      }
      current = current.parentElement;
    }
    return document.body || element.parentElement || element;
  }

  function presentationSlides() {
    return Array.from(document.querySelectorAll('[data-pagecraft-slide-id]'))
      .filter((element) => element instanceof HTMLElement && !isUi(element))
      .slice(0, 100);
  }

  function imageSlotFor(target) {
    if (!(target instanceof Element)) return null;
    const slot = target.closest('[data-pagecraft-image-slot]');
    if (!(slot instanceof HTMLElement) || isUi(slot)) return null;
    const slotId = slot.getAttribute('data-pagecraft-image-slot');
    return slotId && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(slotId) ? slot : null;
  }

  function rememberSlot(slot) {
    let state = slotStates.get(slot);
    if (state) return state;
    state = {
      outline: slot.style.outline,
      outlineOffset: slot.style.outlineOffset,
      cursor: slot.style.cursor,
      title: slot.getAttribute('title')
    };
    slotStates.set(slot, state);
    return state;
  }

  function rememberImage(image, created) {
    let state = imageStates.get(image);
    if (state) return state;
    state = {
      created,
      src: image.getAttribute('src'),
      width: image.style.width,
      height: image.style.height,
      display: image.style.display,
      objectFit: image.style.objectFit,
      objectPosition: image.style.objectPosition
    };
    imageStates.set(image, state);
    return state;
  }

  function restoreImage(image) {
    const state = imageStates.get(image);
    if (!state) return;
    if (state.created) {
      image.remove();
      return;
    }
    if (state.src === null) image.removeAttribute('src');
    else image.setAttribute('src', state.src);
    image.style.width = state.width;
    image.style.height = state.height;
    image.style.display = state.display;
    image.style.objectFit = state.objectFit;
    image.style.objectPosition = state.objectPosition;
    image.removeAttribute('data-pagecraft-asset-id');
  }

  function applyImageSlot(slot) {
    const slotId = slot.getAttribute('data-pagecraft-image-slot');
    if (!slotId) return;
    const binding = assetBindings.get(slotId);
    const slotState = rememberSlot(slot);
    let image = slot instanceof HTMLImageElement ? slot : slot.querySelector('img');
    if (!binding) {
      if (image instanceof HTMLImageElement) restoreImage(image);
      slot.removeAttribute('data-pagecraft-asset-id');
      slot.setAttribute('data-pagecraft-slot-state', 'empty');
      slot.style.outline = '2px dashed rgba(136, 201, 154, .72)';
      slot.style.outlineOffset = '-2px';
      slot.style.cursor = 'pointer';
      if (slotState.title === null) slot.setAttribute('title', '点击选择图片素材');
      return;
    }
    if (!(image instanceof HTMLImageElement)) {
      image = document.createElement('img');
      image.alt = slot.getAttribute('data-pagecraft-slot-label') || '演示文稿图片';
      slot.appendChild(image);
      rememberImage(image, true);
    } else {
      rememberImage(image, false);
    }
    image.src = binding.url;
    image.style.width = '100%';
    image.style.height = '100%';
    image.style.display = 'block';
    image.style.objectFit = binding.fit;
    image.style.objectPosition = Math.round(binding.focalPoint.x * 100) + '% ' + Math.round(binding.focalPoint.y * 100) + '%';
    image.setAttribute('data-pagecraft-asset-id', binding.assetId);
    slot.setAttribute('data-pagecraft-asset-id', binding.assetId);
    slot.setAttribute('data-pagecraft-slot-state', 'filled');
    slot.style.outline = slotState.outline;
    slot.style.outlineOffset = slotState.outlineOffset;
    slot.style.cursor = 'pointer';
    if (slotState.title === null) slot.setAttribute('title', '点击替换或调整图片');
  }

  function applyAllImageSlots() {
    for (const slot of document.querySelectorAll('[data-pagecraft-image-slot]')) {
      if (slot instanceof HTMLElement && !isUi(slot)) applyImageSlot(slot);
    }
    if (hoveredImageSlot && !hoveredImageSlot.isConnected) hoveredImageSlot = null;
  }

  function scheduleAssetApplication() {
    if (assetApplyFrame !== null) cancelAnimationFrame(assetApplyFrame);
    assetApplyFrame = requestAnimationFrame(() => {
      assetApplyFrame = null;
      applyAllImageSlots();
    });
  }

  function updateImageSlotOverlay(target) {
    const slot = mode === null ? imageSlotFor(target) : null;
    hoveredImageSlot = slot;
    if (!slot) {
      imageSlotOverlay.style.display = 'none';
      imageSlotBadge.style.display = 'none';
      return;
    }
    const bounds = slot.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    imageSlotOverlay.style.display = 'block';
    imageSlotOverlay.style.left = bounds.left + 'px';
    imageSlotOverlay.style.top = bounds.top + 'px';
    imageSlotOverlay.style.width = bounds.width + 'px';
    imageSlotOverlay.style.height = bounds.height + 'px';
    imageSlotBadge.textContent = slot.getAttribute('data-pagecraft-slot-label') || '图片槽位';
    imageSlotBadge.style.display = 'block';
    imageSlotBadge.style.left = clamp(bounds.left + 6, 6, Math.max(6, innerWidth - 150)) + 'px';
    imageSlotBadge.style.top = clamp(bounds.top + 6, 6, Math.max(6, innerHeight - 30)) + 'px';
  }

  function presentationSlideTitle(element, index) {
    const explicit = element.getAttribute('data-pagecraft-slide-title') || element.getAttribute('aria-label');
    if (explicit && explicit.trim()) return explicit.trim().slice(0, 120);
    const heading = element.querySelector('h1, h2, h3, [data-pagecraft-slide-heading]');
    const text = heading && (heading.innerText || heading.textContent || '').trim();
    return text ? text.replace(/\s+/g, ' ').slice(0, 120) : '幻灯片 ' + (index + 1);
  }

  function presentationContextFor(element) {
    if (!(element instanceof Element)) return null;
    const slide = element.closest('[data-pagecraft-slide-id]');
    if (!(slide instanceof HTMLElement)) return null;
    const slides = presentationSlides();
    const index = slides.indexOf(slide);
    const slideId = slide.getAttribute('data-pagecraft-slide-id');
    if (!slideId || index < 0) return null;
    return {
      slideId,
      slideTitle: presentationSlideTitle(slide, index),
      slideIndex: index
    };
  }

  function areaPresentationContext(bounds) {
    const x = clamp(bounds.x + bounds.width / 2, 0, innerWidth - 1);
    const y = clamp(bounds.y + bounds.height / 2, 0, innerHeight - 1);
    const target = document.elementsFromPoint(x, y).find((element) => !isUi(element));
    return presentationContextFor(target);
  }

  let lastDeckSignature = '';
  let deckNotifyFrame = null;

  function notifyDeckState(force = false) {
    const elements = presentationSlides();
    const slides = elements.map((element, index) => ({
      id: element.getAttribute('data-pagecraft-slide-id'),
      title: presentationSlideTitle(element, index),
      index
    })).filter((slide) => Boolean(slide.id));
    let activeSlideId = null;
    let closestDistance = Infinity;
    for (const element of elements) {
      const bounds = element.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) continue;
      const distance = Math.abs(bounds.top + bounds.height / 2 - innerHeight / 2);
      if (distance >= closestDistance) continue;
      closestDistance = distance;
      activeSlideId = element.getAttribute('data-pagecraft-slide-id');
    }
    const signature = JSON.stringify({ slides, activeSlideId });
    if (!force && signature === lastDeckSignature) return;
    lastDeckSignature = signature;
    post({ type: 'dsh-frontend-feedback-deck-state', slides, activeSlideId });
  }

  function scheduleDeckState(force = false) {
    if (deckNotifyFrame !== null) cancelAnimationFrame(deckNotifyFrame);
    deckNotifyFrame = requestAnimationFrame(() => {
      deckNotifyFrame = null;
      notifyDeckState(force);
    });
  }

  function selectPresentationSlide(slideId) {
    const slide = presentationSlides().find((element) => element.getAttribute('data-pagecraft-slide-id') === slideId);
    if (!slide) return;
    window.dispatchEvent(new CustomEvent('pagecraft:select-slide', { detail: { slideId } }));
    slide.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
    scheduleDeckState(true);
  }

  function describeElement(element) {
    const bounds = element.getBoundingClientRect();
    const path = [];
    let current = element;
    while (current instanceof Element) {
      path.unshift(current.localName);
      current = current.parentElement;
    }
    const presentation = presentationContextFor(element);
    const textOwner = element.closest('[data-pagecraft-text-key]');
    return {
      kind: 'element',
      url: document.baseURI,
      tagName: element.localName,
      selector: selectorFor(element),
      domPath: path.join(' > '),
      text: (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 240),
      ...(textOwner ? { textKey: textOwner.getAttribute('data-pagecraft-text-key') || undefined } : {}),
      ...(textOwner ? { editableText: (textOwner.textContent || '').trim().slice(0, 5000) } : {}),
      html: htmlSnippet(element, MAX_ELEMENT_HTML),
      container: domSnapshot(containerForElement(element), MAX_CONTAINER_HTML),
      rect: {
        x: round(bounds.x),
        y: round(bounds.y),
        width: round(bounds.width),
        height: round(bounds.height)
      },
      ...(presentation ? { presentation } : {})
    };
  }

  function normalizedText(element, maxLength = 2000) {
    return (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
  }

  function textTargetFor(element) {
    const keyed = element.closest('[data-pagecraft-text-key]');
    if (keyed instanceof HTMLElement && !isUi(keyed)) return keyed;
    let current = element;
    for (let depth = 0; depth < 5 && current instanceof Element && current !== document.body; depth += 1) {
      if (!current.matches('script, style, noscript, template, input, textarea, select, canvas, svg') && normalizedText(current).length > 0) return current;
      current = current.parentElement;
    }
    return null;
  }

  function safeTextAttributes(element) {
    const attributes = {};
    const allowed = ['id', 'name', 'role', 'data-testid', 'data-pagecraft-slide-id', 'data-pagecraft-text-key'];
    for (const name of allowed) {
      const value = element.getAttribute(name);
      if (value) attributes[name] = value.slice(0, 500);
    }
    if (element.classList.length > 0) attributes.class = Array.from(element.classList).slice(0, 4).join(' ').slice(0, 500);
    return attributes;
  }

  function nearbyTextFor(element) {
    const candidates = [];
    const parent = element.parentElement;
    if (parent) {
      for (const sibling of Array.from(parent.children)) {
        if (sibling === element || isUi(sibling)) continue;
        const text = normalizedText(sibling, 120);
        if (text && !candidates.includes(text)) candidates.push(text);
        if (candidates.length >= 4) break;
      }
    }
    return candidates;
  }

  function textFingerprint(element, textKey, presentation) {
    if (textKey) return 'text-key|' + textKey;
    const parent = element.parentElement;
    const siblingIndex = parent ? Array.from(parent.children).indexOf(element) : 0;
    return [presentation?.slideId || '', element.localName, selectorFor(element), siblingIndex].join('|').slice(0, 1000);
  }

  function describeText(element) {
    const target = textTargetFor(element);
    if (!target) return null;
    const presentation = presentationContextFor(target);
    const textKey = target.getAttribute('data-pagecraft-text-key') || undefined;
    return {
      pageUrl: document.baseURI,
      framePath: [],
      selector: selectorFor(target),
      fingerprint: textFingerprint(target, textKey, presentation),
      displayedText: normalizedText(target),
      tagName: target.localName,
      attributes: safeTextAttributes(target),
      nearbyText: nearbyTextFor(target),
      ...(presentation ? { slideId: presentation.slideId } : {}),
      ...(textKey ? { textKey } : {})
    };
  }

  function findTextVerificationTarget(selection) {
    if (!selection || typeof selection !== 'object') return null;
    if (typeof selection.textKey === 'string' && selection.textKey) {
      const keyed = document.querySelector('[data-pagecraft-text-key="' + CSS.escape(selection.textKey) + '"]');
      if (keyed instanceof Element) return keyed;
    }
    if (typeof selection.selector !== 'string' || !selection.selector) return null;
    try {
      const target = document.querySelector(selection.selector);
      return target instanceof Element ? target : null;
    } catch {
      return null;
    }
  }

  function hideGuides() {
    guideX.style.display = 'none';
    guideY.style.display = 'none';
  }

  function renderState() {
    areaCapture.style.display = mode === 'area' ? 'block' : 'none';
    if (mode !== 'element') elementOverlay.style.display = 'none';
    if (mode !== null) {
      imageSlotOverlay.style.display = 'none';
      imageSlotBadge.style.display = 'none';
    }
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
    const normalized = next === 'element' || next === 'area' || next === 'text' ? next : null;
    mode = normalized;
    root.setAttribute('data-dsh-annotator-mode', normalized || 'browse');
    renderState();
  }

  function requestNavigation(url) {
    post({ type: 'dsh-frontend-feedback-navigate', url });
  }

  function reportNavigationError(message) {
    post({ type: 'dsh-frontend-feedback-navigation-error', message });
  }

  function highlight(element) {
    if ((mode !== 'element' && mode !== 'text') || !(element instanceof Element) || element === root || element === document.body || isUi(element)) {
      elementOverlay.style.display = 'none';
      return;
    }
    const highlighted = mode === 'text' ? textTargetFor(element) : element;
    if (!(highlighted instanceof Element)) {
      elementOverlay.style.display = 'none';
      return;
    }
    const bounds = highlighted.getBoundingClientRect();
    elementOverlay.style.display = 'block';
    elementOverlay.style.left = bounds.left + 'px';
    elementOverlay.style.top = bounds.top + 'px';
    elementOverlay.style.width = bounds.width + 'px';
    elementOverlay.style.height = bounds.height + 'px';
  }

  function visibleReferenceElements() {
    const result = [];
    function collect(element) {
      if (!(element instanceof HTMLElement) || isUi(element)) return;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
      const bounds = element.getBoundingClientRect();
      if (bounds.width < 2 || bounds.height < 2) return;
      if (bounds.right < 0 || bounds.bottom < 0 || bounds.left > innerWidth || bounds.top > innerHeight) return;
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
    }
    if (document.body) collect(document.body);
    const all = document.body ? document.body.querySelectorAll('*') : [];
    for (const element of all) {
      collect(element);
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
    if (areaInteraction !== 'draw' || rawStart === null || snappedStart === null) return null;
    currentRaw = {
      x: clamp(event.clientX, 0, innerWidth),
      y: clamp(event.clientY, 0, innerHeight)
    };
    const snapped = snapPoint(currentRaw, referenceCandidates, !event.altKey);
    const currentSnapped = event.shiftKey ? squaredPoint(snappedStart, snapped.point) : snapped.point;
    const currentGuides = event.shiftKey ? [] : snapped.guides;
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
      html: htmlSnippet(item.element, relation === 'container' ? MAX_CONTAINER_HTML : MAX_REFERENCE_HTML),
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
    const references = areaReferences(bounds);
    const finalGuides = uniqueGuides(guides);
    const presentation = areaPresentationContext(bounds);
    return {
      kind: 'area',
      url: document.baseURI,
      coordinateSpace: 'viewport',
      rawRect: roundedRaw,
      rect: rounded,
      viewport: {
        width: round(innerWidth),
        height: round(innerHeight),
        scrollX: round(scrollX),
        scrollY: round(scrollY),
        devicePixelRatio: devicePixelRatio || 1
      },
      alignment: {
        threshold: SNAP_THRESHOLD,
        guides: finalGuides
      },
      ...(references.container ? { container: references.container } : {}),
      nearby: references.nearby,
      ...(presentation ? { presentation } : {})
    };
  }

  function cancelAreaInteraction() {
    areaInteraction = null;
    areaPointerId = null;
    rawStart = null;
    snappedStart = null;
    startGuides = [];
    currentRaw = null;
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
      cancelAreaInteraction();
      if (result === null || rawEnd === null || rawOrigin === null || result.bounds.width < MIN_AREA_SIZE || result.bounds.height < MIN_AREA_SIZE) {
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
    if (event.data?.type === 'dsh-frontend-feedback-set-mode') {
      setMode(event.data.mode);
      return;
    }
    if (event.data?.type === 'dsh-frontend-feedback-clear-area') {
      clearAreaDraft(false);
      return;
    }
    if (event.data?.type === 'dsh-pagecraft-verify-text' && typeof event.data.transactionId === 'string') {
      const target = findTextVerificationTarget(event.data.selection);
      post({
        type: 'dsh-pagecraft-text-verification',
        transactionId: event.data.transactionId,
        found: target instanceof Element,
        observedText: target instanceof Element ? normalizedText(target, 10000) : undefined
      });
      return;
    }
    if (event.data?.type === 'dsh-pagecraft-convert-text-selection') {
      const target = findTextVerificationTarget(event.data.selection);
      if (target instanceof Element) {
        post({ type: 'dsh-frontend-feedback-selected', payload: describeElement(target) });
      } else {
        post({ type: 'dsh-frontend-feedback-selection-error', message: '原来的文字位置已经变化，请重新选择元素。' });
      }
      return;
    }
    if (event.data?.type === 'dsh-frontend-feedback-restore-area') {
      const rect = event.data.rect;
      if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return;
      const restored = clampBounds(rect);
      draftRawBounds = { ...restored };
      draftBounds = { ...restored };
      draftGuides = [];
      setMode('area');
      renderArea(draftBounds, draftGuides, false, true);
      return;
    }
    if (event.data?.type === 'dsh-pagecraft-asset-bindings' && Array.isArray(event.data.bindings)) {
      const nextBindings = new Map();
      for (const binding of event.data.bindings.slice(0, 500)) {
        if (!binding || typeof binding.slotId !== 'string' || typeof binding.assetId !== 'string' || typeof binding.url !== 'string') continue;
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(binding.slotId)) continue;
        let target;
        try {
          target = new URL(binding.url, document.baseURI);
        } catch {
          continue;
        }
        if (target.protocol !== 'http:' && target.protocol !== 'https:') continue;
        const point = binding.focalPoint && typeof binding.focalPoint === 'object' ? binding.focalPoint : {};
        nextBindings.set(binding.slotId, {
          assetId: binding.assetId,
          url: target.href,
          fit: binding.fit === 'contain' ? 'contain' : 'cover',
          focalPoint: {
            x: clamp(Number.isFinite(point.x) ? point.x : 0.5, 0, 1),
            y: clamp(Number.isFinite(point.y) ? point.y : 0.5, 0, 1)
          }
        });
      }
      assetBindings = nextBindings;
      scheduleAssetApplication();
      return;
    }
    if (event.data?.type === 'dsh-frontend-feedback-request-deck-state') notifyDeckState(true);
    if (event.data?.type === 'dsh-frontend-feedback-select-slide' && typeof event.data.slideId === 'string') selectPresentationSlide(event.data.slideId);
  });

  document.addEventListener('mouseover', (event) => {
    highlight(event.target);
    updateImageSlotOverlay(event.target);
  }, true);
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || isUi(event.target)) return;
    if (mode === 'element') {
      consume(event);
      post({ type: 'dsh-frontend-feedback-selected', payload: describeElement(event.target) });
      return;
    }
    if (mode === 'text') {
      consume(event);
      const payload = describeText(event.target);
      if (payload) post({ type: 'dsh-pagecraft-text-selected', payload });
      else post({ type: 'dsh-frontend-feedback-selection-error', message: '这里没有可直接修改的文字，请选择文字所在的标题或段落。' });
      return;
    }
    if (mode === 'area') {
      consume(event);
      return;
    }
    const imageSlot = imageSlotFor(event.target);
    if (imageSlot) {
      consume(event);
      const presentation = presentationContextFor(imageSlot);
      post({
        type: 'dsh-pagecraft-image-slot-selected',
        slotId: imageSlot.getAttribute('data-pagecraft-image-slot'),
        imageKey: imageSlot.getAttribute('data-pagecraft-image-key') || undefined,
        label: imageSlot.getAttribute('data-pagecraft-slot-label') || '图片槽位',
        assetId: imageSlot.getAttribute('data-pagecraft-asset-id') || undefined,
        ...(presentation ? { slideId: presentation.slideId } : {})
      });
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
    referenceElements = visibleReferenceElements();
    referenceCandidates = alignmentCandidates(referenceElements);
    rawStart = { x: clamp(event.clientX, 0, innerWidth), y: clamp(event.clientY, 0, innerHeight) };
    const snapped = snapPoint(rawStart, referenceCandidates, !event.altKey);
    snappedStart = snapped.point;
    startGuides = snapped.guides;
    currentRaw = rawStart;
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

  const deckObserver = new MutationObserver(() => {
    scheduleDeckState();
    scheduleAssetApplication();
  });
  deckObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-pagecraft-slide-id', 'data-pagecraft-slide-title', 'data-pagecraft-image-slot', 'data-pagecraft-image-key', 'data-pagecraft-slot-label']
  });
  document.addEventListener('scroll', () => {
    scheduleDeckState();
    updateImageSlotOverlay(hoveredImageSlot);
  }, true);
  window.addEventListener('resize', () => {
    scheduleDeckState();
    updateImageSlotOverlay(hoveredImageSlot);
  });

  renderState();
  scheduleDeckState(true);
  scheduleAssetApplication();
  post({ type: 'dsh-frontend-feedback-ready', url: document.baseURI, modes: ['element', 'area', 'text'] });
})();
`
