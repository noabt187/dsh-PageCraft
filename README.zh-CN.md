# PageCraft

[English](./README.md) · **简体中文**

集成在 DeepSeek Harness 中的前端可视化评注工具。

PageCraft 把类似 Codex 的可视化评注工作流带到 DeepSeek Harness：打开页面，直接指出需要修改的位置，再把准确的上下文交给负责代码的 Agent。在此基础上，它还增加了可调整的自由框选、多条评注队列、草稿恢复、迷你浏览器和网页演示文稿支持。

> PageCraft 是独立项目，与 OpenAI 或 Codex 不存在隶属或官方合作关系。

![PageCraft 总览](docs/screenshots/overview.png)

## 为什么需要 PageCraft？

当一次前端修改被简化成截图和“把那个卡片往下挪一点”时，关键信息已经丢失。Agent 仍然需要猜测具体元素、所属容器、布局如何变化以及用户所指的位置。

PageCraft 会把这些上下文留在评注里：选择已有 DOM 时采集元素和容器；选择空白区域时记录可调整的矩形及其相对容器坐标；最后把多条要求整理成精简、结构化的工单交给当前 Agent。

## 核心能力

- **直接指出真实界面**：点击渲染后的 DOM，不再依赖截图和模糊描述。
- **描述尚不存在的组件**：在空白位置画框，继续移动、缩放和对齐，再要求 Agent 新增内容。
- **统一修改网页和演示文稿**：普通前端页面与 HTML/React 幻灯片共用一套评注方式。
- **保持连续工作流**：支持前进、后退和刷新；关闭面板或重启 Harness 后仍可恢复网址、选区、评论和队列。
- **提供可直接执行的上下文**：一次发送多条评注，并携带 DOM、布局意图、幻灯片身份及提前计算好的几何信息。
- **使用独立构建 Skill**：`frontend-page-builder` 与 `presentation-builder` 分别约束网页和演示文稿的生成与修改。

| DOM 选择 | 自由框选 | 评注队列 |
| --- | --- | --- |
| ![DOM 元素选择](docs/screenshots/element-selection.png) | 在没有 DOM 的位置画框，并移动、缩放和吸附对齐。 | ![多条评注队列](docs/screenshots/feedback-queue.png) |

## 快速开始

在 DeepSeek Harness 源码目录中执行：

```powershell
pnpm dsh plugin --profile web add github:noabt187/dsh-PageCraft
pnpm dsh web
```

打开终端输出的 Harness 地址，选择一个工作区，然后点击输入框控件旁的 **PageCraft**。仓库已经包含编译后的 `lib/`，从 GitHub 安装时不需要单独构建插件。

## 使用方式

### 修改前端页面

1. 启动前端项目，在 PageCraft 中打开本地地址，例如 `http://localhost:5173`。
2. 修改已有内容时点击“选择元素”；希望新增内容时点击“框选区域”。
3. 写下一个或多个要求，加入队列后点击“发送给 Agent”。
4. Agent 完成修改后，PageCraft 会重新加载预览，同时保留尚未发送的内容。

区域评注可以明确选择三种布局意图：

- **插入**：加入正常布局流，并让后续内容自然移动。
- **覆盖**：浮在当前布局上方，不改变原有文档流。
- **替换**：替换选区当前覆盖的 DOM。

### 创建和修改演示文稿

1. 将 PageCraft 切换到“演示文稿”，点击“上传文档生成”。
2. 上传 PDF、DOCX、Markdown、TXT，或直接粘贴资料；填写观众、目标页数和演讲目标。
3. PageCraft 先把内容提取到当前工作区，Agent 只生成一版可以编辑的目录。生成页面前可以调整顺序、修改标题、增加或删除页面。
4. 确认目录后，Agent 按小批次逐页生成。PageCraft 会持久保存任务、显示每页进度，并在预览地址就绪后自动打开。
5. PageCraft 识别渲染后的各张幻灯片，继续使用 DOM 或可调整区域进行逐页评注。

文档内容保存在当前工作区的 `.pagecraft/presentations/`，不会整篇复制进一次 Prompt。新演示文稿默认使用克制的浅色设计。当前模式面向交互式 HTML/React 演示文稿，暂未实现 PPTX/PDF 导出。

## Agent 收到什么？

PageCraft 发送的是精简工单，而不只是一张截图。例如，一条区域评注可以是：

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
      "request": "在这里新增统计卡片，并与上方卡片保持对齐。"
    }
  ]
}
```

矩形尺寸和容器偏移在发送前就由插件计算完成。Agent 可以把推理能力用于定位源码和调整布局，而不是重新猜测坐标。

## 工作原理

```text
目标网页
    │
    ▼
Harness 预览代理 ── 加载 HTML 与运行时资源
    │
    ▼
隔离预览 ── DOM 选择、区域调整、幻灯片识别
    │ 结构化评注
    ▼
当前 Agent + 对应 builder Skill
    │
    └──────────────► 修改源码 ► 刷新预览
```

PageCraft 主要由三层组成：

1. **预览层**：Harness 中的迷你浏览器，提供导航和 Host 代理，用于加载本地页面或明确允许的远程页面。
2. **评注层**：注入页面的脚本负责 DOM 命中、可调整矩形、对齐参考线、容器识别和幻灯片信息。
3. **Agent 交接层**：把队列内容转换为 `[frontend-feedback]` 或 `[presentation-feedback]` 工单。

## 配置

本机页面始终可用。远程页面可以全部放行，也可以在 Harness profile 中逐个允许：

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

只预览你信任的地址。PageCraft 会在隔离 iframe 中运行目标页面脚本，但它仍然主要面向本地开发环境和你能够控制的页面。

## 本地开发

```powershell
git clone https://github.com/noabt187/dsh-PageCraft.git
cd dsh-PageCraft
npm install
npm run check
```

然后在 DeepSeek Harness 源码目录中链接本地插件：

```powershell
pnpm dsh plugin --profile web add <你的-dsh-PageCraft-路径>
pnpm dsh web
```

修改源码后执行 `npm run build` 并刷新 Harness。`npm run check` 会完成构建、自动化测试和包内容检查。

## 已知限制

- PageCraft 最适合本地开发服务和你能够控制的应用。
- 登录状态、目标域 Cookie、严格 CSP、Service Worker、文件上传、POST 跳转及部分跨域模块可能无法在隔离预览中运行。
- 外部网站可能主动限制嵌入、自动化或代理资源。
- 文档导入支持不超过 25 MB 的 PDF、DOCX、Markdown 和 UTF-8 文本；扫描版 PDF 需要 OCR，当前版本会明确拒绝。
- 演示文稿模式目前创建和修改网页式幻灯片；原生 PPTX/PDF 导出和母版编辑属于后续功能。

## 路线图

- 响应式断点评注与多区域编辑。
- 修改前后视觉对比与评注历史。
- 为支持图片理解的模型附加可选区域截图。
- 演示文稿模板、母版布局及 PPTX/PDF 导出。
