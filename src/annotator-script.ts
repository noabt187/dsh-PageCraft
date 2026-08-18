export const ANNOTATOR_SCRIPT = String.raw`
(() => {
  if (window.__dshFrontendAnnotatorInstalled) return;
  window.__dshFrontendAnnotatorInstalled = true;

  const root = document.documentElement;
  const overlay = document.createElement('div');
  overlay.dataset.dshAnnotatorUi = 'overlay';
  overlay.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #77b98b;background:rgba(119,185,139,.14);border-radius:5px;display:none;box-sizing:border-box';
  root.appendChild(overlay);

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.dshAnnotatorUi = 'toggle';
  button.setAttribute('aria-label', '开启元素评注');
  button.style.cssText = 'position:fixed;right:22px;bottom:22px;z-index:2147483647;width:66px;height:66px;border:1px solid rgba(255,255,255,.5);border-radius:999px;background:linear-gradient(145deg,#dff3e4,#6f9c79);color:#17351f;box-shadow:0 14px 36px rgba(25,61,35,.3);font:700 13px/1.15 system-ui,sans-serif;cursor:grab;user-select:none;touch-action:none';
  root.appendChild(button);

  let active = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;
  let moved = false;

  const isUi = (node) => node instanceof Element && Boolean(node.closest('[data-dsh-annotator-ui]'));
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  function renderState() {
    button.textContent = active ? '结束\n评注' : '元素\n评注';
    button.style.whiteSpace = 'pre-line';
    button.style.background = active
      ? 'linear-gradient(145deg,#c8ecd2,#438a59)'
      : 'linear-gradient(145deg,#dff3e4,#6f9c79)';
    button.setAttribute('aria-label', active ? '结束元素评注' : '开启元素评注');
    if (!active) overlay.style.display = 'none';
  }

  function setActive(next) {
    active = Boolean(next);
    root.toggleAttribute('data-dsh-annotator-active', active);
    renderState();
    window.parent.postMessage({ type: 'dsh-frontend-feedback-active', active }, '*');
  }

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

  function describe(element) {
    const rect = element.getBoundingClientRect();
    const path = [];
    let current = element;
    while (current instanceof Element) {
      path.unshift(current.localName);
      current = current.parentElement;
    }
    return {
      url: document.baseURI,
      tagName: element.localName,
      selector: selectorFor(element),
      domPath: path.join(' > '),
      text: (element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 240),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  }

  function highlight(element) {
    if (!active || !(element instanceof Element) || element === root || element === document.body || isUi(element)) {
      overlay.style.display = 'none';
      return;
    }
    const rect = element.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
  }

  window.addEventListener('message', (event) => {
    if (event.data?.type === 'dsh-frontend-feedback-set-active') setActive(event.data.active);
  });
  document.addEventListener('mouseover', (event) => highlight(event.target), true);
  document.addEventListener('click', (event) => {
    if (!active || !(event.target instanceof Element) || isUi(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    window.parent.postMessage({ type: 'dsh-frontend-feedback-selected', payload: describe(event.target) }, '*');
  }, true);

  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    const rect = button.getBoundingClientRect();
    originLeft = rect.left;
    originTop = rect.top;
    moved = false;
    button.setPointerCapture(pointerId);
    button.style.cursor = 'grabbing';
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener('pointermove', (event) => {
    if (pointerId !== event.pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    if (!moved) return;
    button.style.right = 'auto';
    button.style.bottom = 'auto';
    button.style.left = clamp(originLeft + dx, 8, Math.max(8, innerWidth - button.offsetWidth - 8)) + 'px';
    button.style.top = clamp(originTop + dy, 8, Math.max(8, innerHeight - button.offsetHeight - 8)) + 'px';
  });
  button.addEventListener('pointerup', (event) => {
    if (pointerId !== event.pointerId) return;
    button.releasePointerCapture(pointerId);
    pointerId = null;
    button.style.cursor = 'grab';
    event.preventDefault();
    event.stopPropagation();
    if (!moved) setActive(!active);
  });
  button.addEventListener('pointercancel', () => {
    pointerId = null;
    moved = false;
    button.style.cursor = 'grab';
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  renderState();
  window.parent.postMessage({ type: 'dsh-frontend-feedback-ready', url: document.baseURI }, '*');
})();
`
