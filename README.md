# PageCraft

**English** · [简体中文](./README.zh-CN.md)

Visual feedback for frontend agents, built into DeepSeek Harness.

PageCraft brings a Codex-style visual annotation loop to DeepSeek Harness: open a page, point at what should change, and send precise feedback to the Agent that owns the code. It extends that workflow with editable free-form regions, multi-item feedback queues, draft recovery, a mini browser, and browser-based presentation support.

> PageCraft is an independent project. It is not affiliated with or endorsed by OpenAI or Codex.

![PageCraft overview](docs/screenshots/overview.png)

## Why PageCraft?

Frontend feedback loses information when it becomes a screenshot and a sentence like “move that card a little lower.” The Agent still has to guess the element, its container, the intended layout behavior, and the exact location.

PageCraft keeps that context attached to the feedback. It captures the selected DOM, its surrounding container, or an adjustable region with container-relative geometry, then sends a compact structured work order to the current Agent.

## Highlights

- **Point at real UI** — select rendered DOM elements instead of describing them from memory.
- **Draw what does not exist yet** — create, move, resize, and align a region where a new component should be added.
- **Refine pages and presentations** — use the same annotation workflow for normal web pages and interactive HTML/React slide decks.
- **Stay in the loop** — navigate with back, forward, and refresh; drafts and queues survive panel reloads and Harness restarts.
- **Send implementation-ready context** — batch multiple comments into structured JSON with DOM evidence, layout intent, slide identity, and precomputed geometry.
- **Build with dedicated Skills** — `frontend-page-builder` and `presentation-builder` keep page and deck generation rules separate from the annotation engine.

| DOM selection | Adjustable regions | Feedback queue |
| --- | --- | --- |
| ![DOM selection](docs/screenshots/element-selection.png) | Draw, move, resize, and snap regions where no DOM exists yet. | ![Feedback queue](docs/screenshots/feedback-queue.png) |

## Quick start

From the DeepSeek Harness source directory:

```powershell
pnpm dsh plugin --profile web add github:noabt187/dsh-PageCraft
pnpm dsh web
```

Open the Harness URL printed in the terminal, select a workspace, and choose **PageCraft** beside the composer controls. The repository includes compiled `lib/` output, so a GitHub installation does not require a separate plugin build.

## Use PageCraft

### Refine a web page

1. Start the frontend project and open its local URL in PageCraft, for example `http://localhost:5173`.
2. Choose **Select element** for existing UI or **Select area** for a component that does not exist yet.
3. Write one or more comments, add them to the queue, and select **Send to Agent**.
4. PageCraft reloads the preview when the Agent finishes while preserving any unsent work.

Area annotations support three explicit layout intents:

- **Insert** — add content to normal layout flow and move following content.
- **Overlay** — place content above the current layout without reflowing it.
- **Replace** — replace the DOM currently covered by the selected region.

### Build and refine a presentation

1. Switch PageCraft to **Presentation** and choose **Generate from document**.
2. Upload a PDF, DOCX, Markdown, or TXT file, or paste source text. Add the intended audience, target slide count, and speaking goal.
3. PageCraft extracts the source into the workspace. The Agent creates an editable outline first; reorder, rename, add, or remove slides before approving it.
4. After approval, the Agent generates slides in small batches. PageCraft persists the job, displays per-slide progress, and opens the preview URL as soon as it is available.
5. PageCraft discovers the rendered slides and lets you refine each one with DOM or adjustable-region annotations.

Document content is stored under `.pagecraft/presentations/` in the active workspace instead of being copied wholesale into one prompt. New decks use a restrained light visual system by default. The current workflow targets interactive HTML/React decks; PPTX/PDF export is not implemented yet.

## What the Agent receives

PageCraft sends concise work orders rather than screenshots alone. A region request can look like this:

```json
{
  "annotations": [
    {
      "id": 1,
      "type": "area",
      "operation": "insert",
      "target": {
        "container": { "selector": ".dashboard" },
        "position": {
          "x": 24,
          "y": 320,
          "width": 720,
          "height": 180,
          "corners": {
            "topLeft": [24, 320],
            "topRight": [744, 320],
            "bottomRight": [744, 500],
            "bottomLeft": [24, 500]
          }
        }
      },
      "request": "Add a statistics card here and keep it aligned with the cards above."
    }
  ]
}
```

The plugin performs the rectangle and container-offset calculations before the request reaches the model. The Agent can spend its reasoning on the source change and layout, not on reconstructing coordinates.

## How it works

```text
Target page
    │
    ▼
Harness preview proxy ── loads HTML and runtime resources
    │
    ▼
Isolated preview ── DOM selection, region editing, slide discovery
    │ structured feedback
    ▼
Current Agent + matching builder Skill
    │
    └──────────────► source update ► preview refresh
```

PageCraft has three main layers:

1. **Preview** — a small browser inside Harness with navigation and a host-side proxy for local or permitted remote pages.
2. **Annotation** — an injected script for DOM hit testing, adjustable rectangles, alignment guides, container discovery, and slide metadata.
3. **Agent handoff** — a queue that turns visual feedback into `[frontend-feedback]` or `[presentation-feedback]` work orders.

## Configuration

Localhost pages are always supported. Remote hosts can be enabled globally or allowed individually in the Harness profile:

```yaml
- id: frontend-feedback
  name: dsh-frontend-feedback
  config:
    allowRemoteHosts: false
    allowedHosts:
      - preview.example.com
    maxHtmlBytes: 5242880
    maxResourceBytes: 20971520
    requestTimeoutMs: 15000
```

Only preview hosts you trust. PageCraft executes target-page JavaScript inside an isolated iframe, but it is still designed primarily for local development and pages you control.

## Local development

```powershell
git clone https://github.com/noabt187/dsh-PageCraft.git
cd dsh-PageCraft
npm install
npm run check
```

Link the local directory from the DeepSeek Harness source tree:

```powershell
pnpm dsh plugin --profile web add <path-to-dsh-PageCraft>
pnpm dsh web
```

Run `npm run build` after source changes and refresh Harness. `npm run check` builds the plugin, runs the test suite, and validates the package contents.

## Limitations

- PageCraft works best with local development servers and applications you control.
- Authentication, target-domain cookies, strict CSP, Service Workers, file uploads, POST navigation, and some cross-origin modules may not work in the isolated preview.
- External sites may deliberately block embedding, automation, or proxied resources.
- Document import supports PDF, DOCX, Markdown, and UTF-8 text up to 25 MB. Scanned PDFs require OCR and are rejected in this version.
- Presentation mode currently creates and refines browser-based decks; native PPTX/PDF export and master-slide editing are future work.

## Roadmap

- Responsive breakpoint annotations and multi-region editing.
- Before/after visual comparison and annotation history.
- Optional cropped visual context for models that support images.
- Presentation templates, master layouts, and PPTX/PDF export.
