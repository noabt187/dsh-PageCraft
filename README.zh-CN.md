# PageCraft

[English](./README.md) · **简体中文**

集成在 DeepSeek Harness 中的前端可视化评注与设计工作台。

PageCraft 0.4.0 把视觉意图一直带到源码修改环节：预览页面、点击元素或框选区域、记录当前响应式上下文，再把结构化工单交给负责代码的 Agent。新版增加真实任务进度时间线和智能修改引导，并保留源码定位线索、截图上下文、视觉历史、安全恢复、主题和电影化动效工单；PageCraft 本身不会绕过 Agent 直接改写目标仓库。

> PageCraft 是独立项目，与 OpenAI 或 Codex 不存在隶属或官方合作关系。

![PageCraft 总览](docs/screenshots/overview.png)

## 0.4.0 新功能

- **真实进度时间线**：发送后立即显示批次、累计耗时、排队位置以及准备、定位、检查点、修改、验证和同步等可观察阶段；不伪造百分比或剩余时间，超过 60 秒会说明可关闭面板继续工作。
- **智能修改引导**：按按钮、文字、表单、容器、媒体和框选区域提供四类快捷意图，生成包含真实目标、断点、响应范围和保留约束的可编辑草稿；不会自动发送或覆盖已有输入。
- **完成结果说明**：批次完成后区分“检测到视觉变化”“未检测到视觉变化”和“视觉结果未验证”，并直接进入比较与历史。
- **关闭后恢复**：重新打开 PageCraft 时用本地批次历史与 DSH 会话快照恢复仍在运行或等待结算的任务。

完整使用说明见 [任务进度与智能评注指南](./README.progress-guidance.zh-CN.md)。

## 0.3.0 功能

- **Studio 工作台**：集中提供页面画布、响应式断点、截图、视觉历史以及主题/动效入口。
- **DOM → 源码线索**：`SourceHints` 以尽力而为的方式采集 React、Vue、Svelte 和显式 `data-pagecraft-*` 元数据，包括组件名、owner 链、文件、行号、稳定 ID、证据和置信度。线索只用于缩小候选范围；Agent 仍须读取候选源码并与 DOM 交叉核对后才能修改。
- **响应式评注**：内置 Desktop（1440×900）、Laptop（1280×800）、Tablet（768×1024）、Mobile（390×844）以及 240–7680 px 自定义视口。每条评注都会携带当前 viewport 和 `current-breakpoint`、`current-and-smaller`、`all-breakpoints` 三种 scope 之一。
- **截图 + 文字发送**：PageCraft 会尝试把当前/修改前截图作为图像消息，与结构化文字工单一起发送。如果当前模型或适配器拒绝图像输入，会自动重试纯文字消息，把截图保留在视觉历史，并明确提示降级；不会把大段 Base64 塞进文本提示词。
- **视觉历史与比较**：每个批次可以在 IndexedDB 中保存 before、after 和 rollback 截图，并提供拖动分割线或并排比较。历史上限为 50 条、总计 25 MB、单张快照 5 MB；IndexedDB 不可用时降级为当前会话的内存历史。
- **安全恢复**：“恢复此批次”会发送 `[frontend-rollback]` 工单。builder Skill 要求先检查批次恢复材料和修改后文件哈希，不匹配即停止，并禁止仓库级 reset/clean。恢复由 Agent 执行，PageCraft 不会静默覆盖文件。
- **三个内置 Skill**：`frontend-design` 把意图转成设计 brief；`frontend-page-builder` 负责页面实现和验证；`presentation-builder` 负责浏览器演示文稿。
- **主题与电影化工单**：Studio 支持 Editorial Light、Product Neutral、Cinema Dark 和提取当前设计系统，也可请求分层景深、滚动揭示、克制视差、章节转场、聚光遮罩、胶片纹理、电影色调和氛围视频，并在工单中包含 reduced-motion、移动端降级和性能预算要求。
- **安全默认的预览代理**：远程和私网地址默认拒绝，并增加 DNS/IP 检查、重定向复检、来源控制、短期签名资源令牌、响应大小、超时和并发限制。

## 在 DeepSeek Harness 中快速部署

`lxy` 分支包含编译后的 `lib/`，从 GitHub 安装时不需要额外构建。在 DeepSeek Harness 源码目录执行：

```powershell
pnpm dsh plugin --profile web add github:noabt187/dsh-PageCraft#lxy
pnpm dsh web
```

打开终端输出的 Harness 地址，选择工作区，然后点击输入框控件旁的 **PageCraft**。

如需部署本地修改或尚未提交的版本，先在 PageCraft 目录运行 `npm run build`，再从 Harness 源码目录安装其绝对路径：

```powershell
pnpm dsh plugin --profile web add C:\你的绝对路径\dsh-PageCraft
pnpm dsh web
```

修改源码后需要重新运行 `npm run build`，并刷新或重启 Harness，使其加载更新后的 `lib/`。

## 使用方式

### 修改前端页面

1. 启动目标前端项目，在 PageCraft 中打开本地地址，例如 `http://localhost:5173`。
2. 选择 Desktop、Laptop、Tablet、Mobile 或自定义视口，并指定响应范围。
3. 修改已有内容时使用**选择元素**；新增尚不存在的内容时使用**框选区域**。
4. 选中后点击符合意图的修改建议，编辑自动生成的草稿并按需添加约束；也可以完全自由输入。
5. 可按需捕获截图，把一条或多条要求加入队列后选择**发送给 Agent**。
6. 右侧时间线实时说明排队、定位、修改、验证和同步状态；Agent 完成后可在**比较与历史**查看结果。

区域评注包含三种明确的布局意图：

- **插入**：加入正常布局流，让后续内容自然移动。
- **覆盖**：叠加在当前布局上，不改变原有文档流。
- **替换**：替换选区当前覆盖的 DOM。

### 使用主题和电影化动效

从断点工具栏打开**主题与动效**。选择主题或动效后，PageCraft 会发送结构化 `[frontend-theme]` 或 `[frontend-motion]` 工单，而不是把固定 CSS 直接粘贴到目标页面。内置 Skill 会要求 Agent 将意图映射到现有设计系统，保留功能与无障碍能力，提供移动端和 reduced-motion 降级，并验证真实渲染结果。

### 比较和恢复批次

打开**比较与历史**查看批次状态及 before/after 快照。需要恢复时选择**恢复此批次**。对应的 `[frontend-rollback]` 工单必须核对预期的修改后哈希，并且只能应用该批次生成的逆向补丁。如果文件在批次之后又发生变化，恢复会报告冲突，而不是覆盖更新的工作。

### 创建和修改演示文稿

把 PageCraft 切换到**演示文稿**，创建浏览器演示文稿并打开 Agent 返回的预览地址。PageCraft 会发现稳定的幻灯片 ID，并复用元素/区域选择、SourceHints、响应式、截图、历史和恢复协议。当前未实现原生 PPTX/PDF 导出。

## Agent 收到什么？

PageCraft 会在 `[frontend-feedback]`、`[presentation-feedback]`、`[frontend-theme]`、`[frontend-motion]` 和 `[frontend-rollback]` 等标记下发送精简 JSON 工单。例如：

```json
{
  "id": 1,
  "type": "element",
  "target": { "selector": ".stats-card" },
  "sourceHints": {
    "framework": "react",
    "component": "StatsCard",
    "owners": ["Dashboard", "StatsGrid", "StatsCard"],
    "file": "src/components/StatsCard.tsx",
    "evidence": ["react-debug-source"],
    "confidence": 0.92
  },
  "viewport": {
    "preset": "mobile",
    "width": 390,
    "height": 844,
    "devicePixelRatio": 2
  },
  "scope": "current-breakpoint",
  "screenshot": {
    "kind": "before",
    "width": 390,
    "height": 844,
    "mimeType": "image/webp"
  },
  "request": "把指标纵向排列，但不要改变桌面端布局。"
}
```

支持图像时，截图字节通过图像消息传输；JSON 提示词只包含截图元数据。`SourceHints.confidence` 表示采集证据的质量，不代表源码文件已被证明正确。

## 安全配置

随包提供的 profile 使用保守默认值：

```yaml
- id: frontend-feedback
  name: dsh-frontend-feedback
  config:
    allowRemoteHosts: false
    allowPrivateHosts: false
    allowedHosts: []
    allowedRequestOrigins: []
    maxHtmlBytes: 5242880
    maxResourceBytes: 20971520
    requestTimeoutMs: 15000
    maxConcurrentRequests: 8
    resourceTokenTtlMs: 60000
```

- 默认支持 `localhost`、`127.0.0.1` 和 `::1` 等 loopback 目标。
- 推荐把明确可信的公网域名加入 `allowedHosts`；只有确实需要放行公网目标时才设置 `allowRemoteHosts: true`，目标仍需通过 DNS/IP 检查。
- 只有需要局域网预览时才设置 `allowPrivateHosts: true`。metadata、链路本地、组播、文档保留地址等范围仍会被拒绝。
- `allowedRequestOrigins` 可把预览 API 调用者限制为指定 Harness origin。数组为空时，PageCraft 对带浏览器来源的请求仍检查其 Harness host/port 是否一致。
- `maxConcurrentRequests` 限制同时处理的代理请求数；`resourceTokenTtlMs` 控制签名资源令牌有效期，代码会把它限制在 1–300 秒。
- 跳转过程中会重新检查 host policy 和解析后的地址；HTML/资源大小限制及请求超时始终生效。

只预览可信页面。目标页面 JavaScript 虽然运行在 sandbox iframe 中，但 PageCraft 主要面向本地开发环境和你能控制的页面。

## 本地开发与检查

```powershell
git clone --branch lxy https://github.com/noabt187/dsh-PageCraft.git
cd dsh-PageCraft
npm install
npm run typecheck
npm run check
```

可用脚本：

- `npm run build`：将 Host 和浏览器端代码构建到 `lib/`。
- `npm run typecheck`：运行 `tsc --noEmit` 类型检查。
- `npm test`：先构建，再运行 Node 测试套件。
- `npm run check`：依次执行类型检查、包含构建的测试套件以及 `npm pack --dry-run` 包内容检查。

## 已知限制

- 截图依赖浏览器渲染能力；跨域图片/字体或不支持 SVG `foreignObject` 时可能失败。失败会被记录，不会伪装成成功的视觉证据。
- 视觉比较只能证明该 URL 和视口实际捕获的内容。构建通过不等于完成视觉验证，无法捕获时界面会明确显示。
- 安全恢复依赖 Agent 为对应批次创建 `.pagecraft/history/<batchId>` 恢复材料和文件哈希；材料不存在或不合法时必须停止恢复。
- 登录态、目标域 Cookie、严格 CSP、Service Worker、文件上传、POST 跳转和部分跨域模块可能无法在隔离预览中运行。
- 外部网站可能主动限制嵌入、自动化或代理资源。
- 演示文稿模式面向交互式 HTML/React 幻灯片；当前未实现原生 PPTX/PDF 导出。
