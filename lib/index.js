// skills/frontend-page-builder/SKILL.md
var SKILL_default = "---\nname: frontend-page-builder\ndescription: Build or redesign polished frontend pages and components, then refine them from [frontend-feedback] DOM annotations. Use for initial UI implementation, visual/layout work, responsive behavior, accessibility, or selector-specific iteration requests.\n---\n\n# Frontend Page Builder\n\nBuild a usable, visually coherent page in the project's existing frontend stack, then treat DOM annotations as precise follow-up requirements. Work directly in the current repository and finish with proportional verification.\n\n## Choose the workflow\n\n- If the user asks for a new page or substantial redesign, follow **Initial build**.\n- If the request contains `[frontend-feedback]`, CSS selectors, DOM paths, element text, or element rectangles, follow **Annotation refinement**.\n- If both appear, establish the initial page first, run its development preview, and then invite or consume annotations for a second focused pass.\n\n## Initial build\n\n1. Inspect the repository before choosing libraries or structure. Identify the framework, entry points, routing, component conventions, styling system, scripts, and existing design tokens.\n2. Convert the request into a compact page brief: purpose, audience, primary action, required sections, content hierarchy, states, and responsive behavior. Resolve minor gaps with sensible assumptions; ask only when a missing decision would materially change the product.\n3. Reuse the project's components, tokens, and dependencies. Do not replace the stack or add a large UI library merely to build one page.\n4. Establish a clear visual direction. Use deliberate typography, spacing, color, depth, and composition; avoid generic placeholder-heavy layouts or a collection of unrelated cards.\n5. Implement the full visible experience, including realistic content, empty/loading/error states when relevant, keyboard focus, semantic HTML, and mobile behavior.\n6. Run the narrowest relevant checks first, then a production build or the project's standard verification command when practical. Inspect the result in a browser when browser tooling is available.\n7. Tell the user what changed, how it was verified, and which local preview URL to open in the **\u9875\u9762\u8BC4\u6CE8** tab for iterative feedback.\n\n## Annotation refinement\n\n1. Treat every annotation as a requirement tied to a concrete rendered element, not as a request to edit the DOM output directly.\n2. Locate the owning source component using this evidence in order: unique selector or id, visible text, DOM path, nearby component structure, then viewport rectangle. Selectors from generated CSS or CSS Modules are hints, not guaranteed source identifiers.\n3. Read the surrounding component and styles before editing. Determine whether the requested change belongs in markup, local styles, shared tokens, content data, or behavior.\n4. Batch compatible annotations by owning component. If two annotations conflict, prefer the more specific requirement and explicitly report the conflict rather than silently guessing.\n5. Make the smallest coherent source change that satisfies the feedback while preserving unmentioned behavior, responsiveness, accessibility, and the page's established visual system.\n6. Verify the changed state at relevant viewport sizes. Re-run targeted tests and the normal frontend build. If the preview server is running, ask the user to refresh and make another annotation pass when useful.\n\n## Quality bar\n\n- Preserve the project's architecture and state/data flow.\n- Prefer semantic elements and visible keyboard focus; maintain readable contrast and usable touch targets.\n- Avoid hard-coded viewport-specific coordinates. The annotation rectangle describes where the element was observed, not where it must be positioned.\n- Avoid broad global CSS changes for a local comment unless the feedback clearly identifies a system-wide rule.\n- Keep copy specific and production-like. Do not leave lorem ipsum, unexplained placeholders, fake metrics presented as real data, or nonfunctional primary controls.\n- Do not claim visual verification unless the page was actually rendered or inspected. State any remaining verification gap plainly.\n\n## Expected handoff\n\nReport the implemented page or refinement, the main files changed, checks run, and the preview URL. For annotation work, map each completed comment to its source-level change in a short list.\n";

// src/annotator-script.ts
var ANNOTATOR_SCRIPT = String.raw`
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
  button.style.cssText = 'position:fixed;right:22px;bottom:22px;z-index:2147483647;width:66px;height:66px;border:1px solid rgba(255,255,255,.5);border-radius:999px;background:linear-gradient(145deg,#dff3e4,#6f9c79);color:#17351f;box-shadow:0 14px 36px rgba(25,61,35,.3);font:700 13px/1.15 system-ui,sans-serif;white-space:pre-line;cursor:grab;user-select:none;touch-action:none';
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
  const post = (message) => window.parent.postMessage(message, '*');
  const consume = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  function renderState() {
    button.textContent = active ? '结束\n评注' : '元素\n评注';
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
    post({ type: 'dsh-frontend-feedback-active', active });
  }

  function requestNavigation(url) {
    post({ type: 'dsh-frontend-feedback-navigate', url });
  }

  function reportNavigationError(message) {
    post({ type: 'dsh-frontend-feedback-navigation-error', message });
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
    if (!(event.target instanceof Element) || isUi(event.target)) return;
    if (active) {
      consume(event);
      post({ type: 'dsh-frontend-feedback-selected', payload: describe(event.target) });
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
    if (active) {
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
    consume(event);
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
    consume(event);
    if (!moved) setActive(!active);
  });
  button.addEventListener('pointercancel', () => {
    pointerId = null;
    moved = false;
    button.style.cursor = 'grab';
  });
  button.addEventListener('click', (event) => {
    consume(event);
  });

  renderState();
  post({ type: 'dsh-frontend-feedback-ready', url: document.baseURI });
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
function buildAnnotationPrompt(comments) {
  if (comments.length === 0) throw new Error("\u81F3\u5C11\u9700\u8981\u4E00\u6761\u5143\u7D20\u8BC4\u6CE8");
  const entries = comments.map((item, index) => [
    `## \u8BC4\u6CE8 ${index + 1}`,
    line("\u9875\u9762", item.url),
    line("\u5143\u7D20", `<${item.tagName}>`),
    line("CSS selector", item.selector),
    line("DOM path", item.domPath),
    line("\u5F53\u524D\u6587\u672C", item.text),
    `\u89C6\u53E3\u4F4D\u7F6E: x=${item.rect.x}, y=${item.rect.y}, width=${item.rect.width}, height=${item.rect.height}`,
    line("\u4FEE\u6539\u8981\u6C42", item.comment)
  ].join("\n")).join("\n\n");
  return [
    "[frontend-feedback]",
    "\u8BF7\u4F7F\u7528 frontend-page-builder Skill \u5904\u7406\u4EE5\u4E0B\u524D\u7AEF\u9875\u9762\u8BC4\u6CE8\u3002",
    "\u5148\u5728\u5F53\u524D\u5DE5\u4F5C\u533A\u5B9A\u4F4D\u8FD9\u4E9B selector \u5BF9\u5E94\u7684\u7EC4\u4EF6\u548C\u6837\u5F0F\uFF0C\u518D\u5B9E\u65BD\u5C40\u90E8\u4FEE\u6539\uFF1B\u4E0D\u8981\u53EA\u8F93\u51FA\u5EFA\u8BAE\u3002",
    "\u4FDD\u6301\u672A\u88AB\u8BC4\u6CE8\u533A\u57DF\u7684\u884C\u4E3A\u548C\u89C6\u89C9\u5C42\u7EA7\uFF0C\u5B8C\u6210\u540E\u8FD0\u884C\u4E0E\u6539\u52A8\u76F8\u79F0\u7684\u6784\u5EFA\u6216\u6D4B\u8BD5\uFF0C\u5E76\u7B80\u8981\u8BF4\u660E\u9A8C\u8BC1\u7ED3\u679C\u3002",
    "",
    entries
  ].join("\n");
}
function isElementSelection(value) {
  if (value === null || typeof value !== "object") return false;
  const item = value;
  const rect = item.rect;
  return typeof item.url === "string" && typeof item.tagName === "string" && typeof item.selector === "string" && typeof item.domPath === "string" && typeof item.text === "string" && rect !== void 0 && typeof rect.x === "number" && typeof rect.y === "number" && typeof rect.width === "number" && typeof rect.height === "number";
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
  isElementSelection,
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
