# dsh-PageCraft

**English** | [简体中文](./README.zh-CN.md)

A frontend building and visual annotation plugin for DeepSeek Harness Web.

It connects the entire workflow—ask an Agent to create a page, preview it inside Harness, click real DOM elements to leave feedback, and let the Agent update the source code—without switching between a browser, screenshot tools, and a chat window.

## Features

- Registers a dedicated `Page Feedback` (`页面评注`) view at the top of each conversation.
- Previews local development pages and permitted remote pages directly inside Harness.
- Works like a mini browser with normal link navigation, GET search forms, back, forward, and refresh controls.
- Saves the preview URL and the latest 50 history entries per session, then restores them after switching views or refreshing Harness.
- Highlights and selects real DOM elements in annotation mode.
- Collects the page URL, CSS selector, DOM path, element text, and bounding rectangle automatically.
- Organizes multiple annotations into a queue and sends them to the current Agent in one batch.
- Bundles the `frontend-page-builder` Skill to guide the Agent through initial page creation and subsequent visual refinements.
- Avoids the Harness task bar and composer automatically; both the preview and feedback queue remain independently scrollable.

## Screenshots

### Page feedback overview

![dsh-PageCraft page feedback overview](docs/screenshots/overview.png)

### DOM element selection

![dsh-PageCraft DOM element selection](docs/screenshots/element-selection.png)

### Multi-item feedback queue

![dsh-PageCraft feedback queue](docs/screenshots/feedback-queue.png)

## Quick start

If you already have the DeepSeek Harness source code, run the following commands from its repository root:

```powershell
pnpm dsh plugin --profile web add github:noabt187/dsh-PageCraft
pnpm dsh web
```

Open the Harness URL printed in the terminal and enter any conversation. A `Page Feedback` (`页面评注`) tab will appear at the top.

That is all you need for normal use. The repository includes the compiled `lib/` output, so plugins installed from GitHub do not need a separate build step.

## Local development installation

To modify this plugin and let Harness read your local source directly:

```powershell
git clone https://github.com/noabt187/dsh-PageCraft.git
cd dsh-PageCraft
npm install
npm run build
```

Return to the DeepSeek Harness source directory and link the plugin into the `web` profile:

```powershell
pnpm dsh plugin --profile web add D:\path\to\dsh-PageCraft
pnpm dsh web
```

After changing the plugin, run:

```powershell
npm run build
```

Then refresh the Harness page. A local-path installation keeps a link to the plugin directory, so you normally do not need to reinstall it after every change.

## Usage

1. Ask the Agent in a normal conversation to build and start a frontend page.
2. Open `Page Feedback` (`页面评注`) and enter the page URL, for example `http://localhost:5173`.
3. Select `Open` (`打开`) and confirm that the page appears in the central preview area.
4. Select `Start Annotation` (`开始评注`), then click the page element you want to change.
5. Describe the requested change in the right sidebar and add it to the feedback queue.
6. Continue selecting other elements as needed, then select `Send to Agent` (`发送给 Agent`).
7. After the Agent updates the source code, refresh the preview and continue with another feedback pass.

## How it works

```text
Target page
   │
   ▼
Harness Host preview route ── fetch HTML, preserve the resource base, inject the annotator
   │
   ▼
Sandboxed iframe ── hover highlight, DOM selection, collect selector/path/rect
   │ postMessage
   ▼
Page Feedback view ── edit and organize the feedback queue
   │ session.prompt(..., "queue")
   ▼
Current Agent ── load the frontend-page-builder Skill, locate source files, apply changes
```

The plugin consists of three parts:

1. **Client view**: registers a `conversation.view` containing the address bar, iframe, DOM selector, and feedback queue.
2. **Host preview route**: fetches the target HTML, inserts a `<base>` element and the annotation script, then returns it to a controlled iframe. Links and GET forms are passed back to the plugin through `postMessage`, so subsequent pages are still loaded through the preview route and remain annotatable.
3. **Frontend Builder Skill**: turns structured `[frontend-feedback]` data into a source-editing, verification, and refresh workflow.

Feedback sent to the Agent contains evidence like this:

```text
Page URL: http://localhost:5173/
CSS selector: #hero-title
DOM path: html > body > main > section > h1
Element text: Build faster
Bounding rectangle: x=120, y=84, width=420, height=72
Requested change: Make the title more prominent and add a product description below it
```

Coordinates provide visual context. The Agent still prioritizes the existing React, Vue, HTML, and CSS source structure instead of mechanically adding absolute-positioned styles.

## Configuration

By default, the plugin can proxy HTTP and HTTPS pages, with a 5 MiB HTML limit and a 15-second request timeout. You can adjust these values in the Harness profile:

```yaml
- id: frontend-feedback
  name: dsh-frontend-feedback
  config:
    allowRemoteHosts: true
    allowedHosts:
      - preview.internal.example
    maxHtmlBytes: 5242880
    requestTimeoutMs: 15000
```

If you only annotate local pages, set `allowRemoteHosts` to `false` and use `allowedHosts` to permit individual additional hosts.

## Development and verification

```powershell
npm install
npm run check
```

`npm run check` runs the build, automated tests, and npm package-content validation in sequence. Compiled output is written to `lib/`.

## Known limitations

- The plugin proxies the HTML entry document, not the entire website. Sites that rely on target-domain cookies, Service Workers, strict CSP policies, or special cross-origin ES modules may not work completely.
- Some APIs and assets on remote sites may still be restricted by browser CORS policies.
- The mini browser supports normal HTTP/HTTPS links and GET forms. POST login, file uploads, `window.open`, Service Workers, and scripts that directly modify `location` are not proxied yet.
- DeepSeek Harness is still in developer preview. Run `npm run check` again after upgrading Harness.

## Roadmap

- Drag-select empty areas and send four corner points, normalized coordinates, the nearest container, and a screenshot to the Agent.
- Add new components where no existing DOM element is available.
- Generate interactive HTML/CSS/JavaScript slide decks and annotate individual slides.
- Move, resize, delete, multi-select, and annotate responsive breakpoints.
- Compare before-and-after visuals and retain annotation history.
