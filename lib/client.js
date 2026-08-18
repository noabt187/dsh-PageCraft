window.__ModuleLoader__.load({ id: "dsh-frontend-feedback", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  FrontendFeedbackView: () => FrontendFeedbackView,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");

// src/shared.ts
var LOOPBACK_PREVIEW_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);
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

// src/client/index.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var inject = ["slots", "sessions"];
var colors = {
  panel: "#121816",
  panel2: "#19211e",
  border: "#2c3d34",
  text: "#edf5ef",
  muted: "#9aac9f",
  accent: "#88c99a",
  accentStrong: "#a9e2b7"
};
function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}
function commentFrom(selection, comment) {
  return { ...selection, comment: comment.trim() };
}
function cardTitle(item) {
  const text = item.text.trim();
  return text.length > 0 ? `${item.selector} \xB7 ${text.slice(0, 42)}` : item.selector;
}
function FrontendFeedbackView({ sendFeedback }) {
  const iframeRef = (0, import_react.useRef)(null);
  const [urlDraft, setUrlDraft] = (0, import_react.useState)("http://localhost:5173");
  const [loadedUrl, setLoadedUrl] = (0, import_react.useState)("http://localhost:5173");
  const [revision, setRevision] = (0, import_react.useState)(0);
  const [active, setActive] = (0, import_react.useState)(false);
  const [selection, setSelection] = (0, import_react.useState)(null);
  const [comment, setComment] = (0, import_react.useState)("");
  const [queued, setQueued] = (0, import_react.useState)([]);
  const [status, setStatus] = (0, import_react.useState)("\u6253\u5F00\u9875\u9762\u540E\uFF0C\u70B9\u51FB\u53F3\u4E0B\u89D2\u201C\u5143\u7D20\u8BC4\u6CE8\u201D\u5F00\u59CB\u9009\u62E9\u3002");
  const [sending, setSending] = (0, import_react.useState)(false);
  const previewFrame = (0, import_react.useMemo)(() => {
    return resolvePreviewFrameLocation(loadedUrl, window.location.href, revision);
  }, [loadedUrl, revision]);
  (0, import_react.useEffect)(() => {
    const listener = (event) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type === "dsh-frontend-feedback-active") {
        setActive(Boolean(event.data.active));
        return;
      }
      if (event.data?.type === "dsh-frontend-feedback-ready") {
        setStatus("\u9884\u89C8\u5DF2\u52A0\u8F7D\u3002\u9700\u8981\u9009\u62E9\u5143\u7D20\u65F6\u5F00\u542F\u8BC4\u6CE8\u6A21\u5F0F\u3002");
        return;
      }
      if (event.data?.type === "dsh-frontend-feedback-error") {
        const status2 = typeof event.data.status === "number" ? `HTTP ${event.data.status}\uFF1A` : "";
        const message = typeof event.data.message === "string" ? event.data.message : "\u672A\u77E5\u9519\u8BEF";
        setActive(false);
        setStatus(`\u9884\u89C8\u5931\u8D25\uFF1A${status2}${message}`);
        return;
      }
      if (event.data?.type !== "dsh-frontend-feedback-selected" || !isElementSelection(event.data.payload)) return;
      setSelection(event.data.payload);
      setComment("");
      setStatus(`\u5DF2\u9009\u62E9 ${event.data.payload.selector}`);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  const openPreview = () => {
    try {
      const parsed = new URL(urlDraft.trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("\u53EA\u652F\u6301 http \u6216 https");
      setLoadedUrl(parsed.href);
      setRevision((value) => value + 1);
      setSelection(null);
      setActive(false);
      setStatus("\u6B63\u5728\u52A0\u8F7D\u9884\u89C8\u2026");
    } catch (error) {
      setStatus(`\u5730\u5740\u65E0\u6548\uFF1A${describeError(error)}`);
    }
  };
  const setAnnotatorActive = (next) => {
    iframeRef.current?.contentWindow?.postMessage({
      type: "dsh-frontend-feedback-set-active",
      active: next
    }, "*");
  };
  const queueCurrent = () => {
    if (selection === null || comment.trim().length === 0) return;
    setQueued((items) => [...items, commentFrom(selection, comment)]);
    setSelection(null);
    setComment("");
    setStatus("\u8BC4\u6CE8\u5DF2\u52A0\u5165\u961F\u5217\uFF0C\u53EF\u7EE7\u7EED\u9009\u62E9\u5176\u4ED6\u5143\u7D20\u3002");
  };
  const sendAll = async () => {
    const comments = [...queued];
    if (selection !== null && comment.trim().length > 0) comments.push(commentFrom(selection, comment));
    if (comments.length === 0) return;
    setSending(true);
    try {
      await sendFeedback(buildAnnotationPrompt(comments));
      setQueued([]);
      setSelection(null);
      setComment("");
      setStatus(`\u5DF2\u628A ${comments.length} \u6761\u8BC4\u6CE8\u53D1\u9001\u5230\u5F53\u524D\u4F1A\u8BDD\u3002`);
    } catch (error) {
      setStatus(`\u53D1\u9001\u5931\u8D25\uFF1A${describeError(error)}`);
    } finally {
      setSending(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.root, "data-conversation-composer-overlay": "", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.toolbar, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.brand, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.brandDot }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { style: styles.title, children: "Frontend Feedback" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.subtitle, children: "\u9884\u89C8 \xB7 DOM \u9009\u62E9 \xB7 \u7CBE\u51C6\u5FAE\u8C03" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.addressBar, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            "aria-label": "\u9884\u89C8\u5730\u5740",
            value: urlDraft,
            onChange: (event) => setUrlDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === "Enter") openPreview();
            },
            style: styles.input,
            placeholder: "http://localhost:5173"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: openPreview, style: styles.secondaryButton, children: "\u6253\u5F00" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => setRevision((value) => value + 1), style: styles.iconButton, title: "\u5237\u65B0\u9884\u89C8", children: "\u21BB" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            onClick: () => setAnnotatorActive(!active),
            style: { ...styles.modeButton, ...active ? styles.modeButtonActive : {} },
            children: active ? "\u7ED3\u675F\u8BC4\u6CE8" : "\u5F00\u59CB\u8BC4\u6CE8"
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.workspace, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.previewShell, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "iframe",
        {
          ref: iframeRef,
          title: "\u524D\u7AEF\u9875\u9762\u8BC4\u6CE8\u9884\u89C8",
          src: previewFrame.src,
          sandbox: previewFrame.allowSameOrigin ? "allow-scripts allow-same-origin allow-forms allow-modals allow-popups" : "allow-scripts allow-forms allow-modals allow-popups",
          style: styles.iframe,
          onLoad: () => {
            setStatus("\u9884\u89C8\u6587\u6863\u5DF2\u54CD\u5E94\uFF0C\u6B63\u5728\u7B49\u5F85\u9875\u9762\u521D\u59CB\u5316\u2026");
            if (active) setAnnotatorActive(true);
          }
        }
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", { style: styles.sidebar, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.sidebarHeader, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "\u8BC4\u6CE8\u961F\u5217" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.count, children: queued.length })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...styles.statePill, ...active ? styles.statePillActive : {} }, children: active ? "\u6B63\u5728\u9009\u62E9" : "\u6D4F\u89C8\u6A21\u5F0F" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.sidebarScroller, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.scrollArea, children: [
            queued.map((item, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.commentCard, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.cardIndex, children: [
                "#",
                index + 1
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.cardBody, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { style: styles.cardTitle, children: cardTitle(item) }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.cardComment, children: item.comment })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "button",
                {
                  type: "button",
                  "aria-label": `\u5220\u9664\u7B2C ${index + 1} \u6761\u8BC4\u6CE8`,
                  onClick: () => setQueued((items) => items.filter((_, itemIndex) => itemIndex !== index)),
                  style: styles.removeButton,
                  children: "\xD7"
                }
              )
            ] }, `${item.selector}-${index}`)),
            queued.length === 0 && selection === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.emptyQueue, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.emptyIcon, children: "\u2301" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "\u8FD8\u6CA1\u6709\u8BC4\u6CE8" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u5F00\u542F\u8BC4\u6CE8\u6A21\u5F0F\uFF0C\u60AC\u505C\u5E76\u70B9\u51FB\u9875\u9762\u4E2D\u7684\u5143\u7D20\u3002" })
            ] }) : null
          ] }),
          selection !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.composer, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.selectedMeta, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.tag, children: selection.tagName }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { style: styles.selector, children: selection.selector })
            ] }),
            selection.text ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.selectedText, children: selection.text }) : null,
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "textarea",
              {
                autoFocus: true,
                value: comment,
                onChange: (event) => setComment(event.target.value),
                onKeyDown: (event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") queueCurrent();
                },
                placeholder: "\u8BF4\u660E\u5E0C\u671B\u600E\u6837\u4FEE\u6539\u8FD9\u4E2A\u5143\u7D20\u2026",
                style: styles.textarea
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.composerActions, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => setSelection(null), style: styles.ghostButton, children: "\u53D6\u6D88" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: comment.trim().length === 0, onClick: queueCurrent, style: styles.primaryButton, children: "\u52A0\u5165\u961F\u5217" })
            ] })
          ] }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.footer, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.status, children: status }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                disabled: sending || queued.length === 0 && (selection === null || comment.trim().length === 0),
                onClick: () => {
                  void sendAll();
                },
                style: styles.sendButton,
                children: sending ? "\u53D1\u9001\u4E2D\u2026" : "\u53D1\u9001\u7ED9 Agent"
              }
            )
          ] })
        ] })
      ] })
    ] })
  ] });
}
function apply(ctx) {
  ctx.slots.inject("conversation.view", () => ctx.slots.register({
    name: "conversation.view",
    id: "frontend-feedback",
    order: 20,
    label: () => "\u9875\u9762\u8BC4\u6CE8",
    inject: (sessionId) => {
      const session = ctx.sessions.binding(sessionId)?.session;
      if (session === void 0) throw new Error(`frontend-feedback: session "${sessionId}" is unavailable`);
      return {
        sendFeedback: async (text) => {
          const result = await session.prompt([{ type: "text", text }], "queue");
          if (!result.ok) throw new Error(result.error.message);
        }
      };
    }
  }, FrontendFeedbackView));
}
var styles = {
  root: { height: "100%", minHeight: 0, display: "flex", flexDirection: "column", color: colors.text, background: "#0e1311", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" },
  toolbar: { display: "flex", gap: 18, alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${colors.border}`, background: colors.panel, flexWrap: "wrap" },
  brand: { display: "flex", alignItems: "center", gap: 10, minWidth: 210 },
  brandDot: { width: 12, height: 12, borderRadius: 99, background: colors.accent, boxShadow: `0 0 18px ${colors.accent}` },
  title: { display: "block", fontSize: 14, letterSpacing: ".02em" },
  subtitle: { display: "block", marginTop: 3, color: colors.muted, fontSize: 11 },
  addressBar: { display: "flex", alignItems: "center", gap: 8, flex: "1 1 520px", justifyContent: "flex-end" },
  input: { minWidth: 180, maxWidth: 620, flex: 1, height: 36, padding: "0 12px", border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text, background: "#0a0f0d", outline: "none" },
  secondaryButton: { height: 36, padding: "0 14px", border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text, background: colors.panel2, cursor: "pointer" },
  iconButton: { width: 36, height: 36, border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text, background: colors.panel2, cursor: "pointer", fontSize: 18 },
  modeButton: { height: 36, padding: "0 15px", border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text, background: colors.panel2, cursor: "pointer", fontWeight: 700 },
  modeButtonActive: { color: "#122217", borderColor: colors.accent, background: colors.accentStrong },
  workspace: {
    flex: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 340px)",
    boxSizing: "border-box",
    overflow: "hidden",
    // ConversationRoot publishes the live height of its floating task/composer
    // seat. Reserve the same clearance for both preview and sidebar content.
    paddingBottom: "calc(var(--dsh-composer-height, 152px) + 16px)"
  },
  previewShell: { minWidth: 0, minHeight: 0, padding: 12, background: "#090d0b" },
  iframe: { display: "block", width: "100%", height: "100%", border: `1px solid ${colors.border}`, borderRadius: 10, background: "white" },
  sidebar: { minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", borderLeft: `1px solid ${colors.border}`, background: colors.panel },
  sidebarHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 14px 12px", borderBottom: `1px solid ${colors.border}`, fontSize: 13 },
  count: { display: "inline-flex", marginLeft: 7, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: 99, color: "#112117", background: colors.accent, fontSize: 11 },
  statePill: { padding: "5px 8px", borderRadius: 99, color: colors.muted, background: "#222b27", fontSize: 10 },
  statePillActive: { color: "#122217", background: colors.accentStrong },
  sidebarScroller: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflowX: "hidden", overflowY: "scroll", overscrollBehavior: "contain", scrollbarGutter: "stable", scrollbarColor: `${colors.accent} ${colors.panel}` },
  scrollArea: { flex: "1 0 auto", minHeight: 0, padding: 12 },
  commentCard: { display: "flex", gap: 9, padding: 10, marginBottom: 8, border: `1px solid ${colors.border}`, borderRadius: 9, background: colors.panel2 },
  cardIndex: { color: colors.accent, fontSize: 11, fontWeight: 800 },
  cardBody: { minWidth: 0, flex: 1 },
  cardTitle: { display: "block", overflow: "hidden", color: colors.text, fontSize: 11, textOverflow: "ellipsis", whiteSpace: "nowrap" },
  cardComment: { display: "block", marginTop: 5, color: colors.muted, fontSize: 12, lineHeight: 1.45 },
  removeButton: { alignSelf: "flex-start", border: 0, color: colors.muted, background: "transparent", cursor: "pointer", fontSize: 18 },
  emptyQueue: { height: "100%", minHeight: 180, display: "flex", flexDirection: "column", gap: 7, alignItems: "center", justifyContent: "center", padding: 24, color: colors.muted, textAlign: "center", fontSize: 12, lineHeight: 1.5 },
  emptyIcon: { color: colors.accent, fontSize: 30 },
  composer: { padding: 12, borderTop: `1px solid ${colors.border}`, background: colors.panel2 },
  selectedMeta: { display: "flex", gap: 7, alignItems: "center", minWidth: 0 },
  tag: { padding: "3px 6px", borderRadius: 5, color: "#112117", background: colors.accent, fontSize: 10, fontWeight: 800, textTransform: "uppercase" },
  selector: { minWidth: 0, overflow: "hidden", color: colors.muted, fontSize: 10, textOverflow: "ellipsis", whiteSpace: "nowrap" },
  selectedText: { maxHeight: 42, overflow: "hidden", margin: "9px 0", color: colors.muted, fontSize: 11, lineHeight: 1.45 },
  textarea: { width: "100%", minHeight: 84, resize: "vertical", boxSizing: "border-box", padding: 10, border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text, background: "#0c1210", font: "12px/1.5 inherit", outline: "none" },
  composerActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 },
  ghostButton: { height: 32, padding: "0 11px", border: 0, color: colors.muted, background: "transparent", cursor: "pointer" },
  primaryButton: { height: 32, padding: "0 12px", border: 0, borderRadius: 7, color: "#102016", background: colors.accentStrong, cursor: "pointer", fontWeight: 700 },
  footer: { padding: 12, borderTop: `1px solid ${colors.border}` },
  status: { display: "block", minHeight: 32, color: colors.muted, fontSize: 10, lineHeight: 1.4 },
  sendButton: { width: "100%", height: 38, marginTop: 8, border: `1px solid ${colors.accent}`, borderRadius: 8, color: "#102016", background: colors.accentStrong, cursor: "pointer", fontWeight: 800 }
};
return module.exports; } });
