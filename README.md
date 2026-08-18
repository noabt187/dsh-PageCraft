# dsh-PageCraft

面向 DeepSeek Harness Web 的前端构建与可视化评注插件。

它把“让 Agent 创建页面 → 在 Harness 中预览 → 点击 DOM 元素写评注 → Agent 修改源码”串成一条连续工作流，不需要在浏览器、截图工具和聊天窗口之间来回切换。

## 功能

- 在会话顶部注册独立的 `页面评注` 视图。
- 直接预览本地开发页面或允许访问的远程页面。
- 开启评注模式后，悬停并点击真实 DOM 元素。
- 自动采集 URL、CSS selector、DOM path、元素文本和位置。
- 批量整理多条评注，一次发送给当前 Agent。
- 内置 `frontend-page-builder` Skill，指导 Agent 初次构建页面并处理后续视觉反馈。
- 自动避开 Harness 底部任务栏和消息输入框，预览区与评注队列均可独立滚动。

## 界面截图

主截图建议展示：左侧页面预览、元素高亮、右侧评注编辑器和底部 Harness 输入区。

> 截图待补充：将图片保存为 `docs/screenshots/overview.png`，然后取消下面这一行的注释。

<!-- ![dsh-PageCraft 页面评注界面](docs/screenshots/overview.png) -->

还可以补充两张可选图片：

- `docs/screenshots/element-selection.png`：DOM 元素悬停和选中效果。
- `docs/screenshots/feedback-queue.png`：多条评注队列与滚动效果。

## 最快启动方式

下面以已经下载好的 DeepSeek Harness 源码为例。在 Harness 源码根目录执行：

```powershell
pnpm dsh plugin --profile web add github:noabt187/dsh-PageCraft
pnpm dsh web
```

打开终端输出的 Harness 地址，进入任意会话，顶部会出现 `页面评注` 标签。

这就是普通使用所需的全部启动步骤。插件已经提交构建后的 `lib/`，从 GitHub 安装时不需要再单独编译插件。

## 本地开发安装

如果你正在修改本插件，希望 Harness 直接读取本地源码：

```powershell
git clone https://github.com/noabt187/dsh-PageCraft.git
cd dsh-PageCraft
npm install
npm run build
```

然后回到 DeepSeek Harness 源码目录，把插件目录链接到 `web` profile：

```powershell
pnpm dsh plugin --profile web add D:\path\to\dsh-PageCraft
pnpm dsh web
```

每次修改插件后执行：

```powershell
npm run build
```

再刷新 Harness 网页即可。使用本地路径安装时，profile 会保留对插件目录的链接，因此通常不需要重复安装。

## 使用流程

1. 在普通对话中让 Agent 构建并启动一个前端页面。
2. 切换到 `页面评注`，输入页面地址，例如 `http://localhost:5173`。
3. 点击 `打开`，确认页面能够在中间预览区显示。
4. 点击 `开始评注`，再点击需要修改的页面元素。
5. 在右侧写下修改要求，并加入评注队列。
6. 可以继续选择其他元素；完成后点击 `发送给 Agent`。
7. Agent 修改源码后，点击刷新按钮查看结果并继续下一轮。

## 它是怎么工作的

```text
目标网页
   │
   ▼
Harness Host 预览路由 ── 获取 HTML、保留资源基址、注入评注脚本
   │
   ▼
沙箱 iframe ── 悬停高亮、DOM 选择、采集 selector/path/rect
   │ postMessage
   ▼
页面评注视图 ── 编辑和整理评注队列
   │ session.prompt(..., "queue")
   ▼
当前 Agent ── 加载 frontend-page-builder Skill、定位源码并修改
```

插件由三部分组成：

1. **客户端视图**：注册 `conversation.view`，提供地址栏、iframe、DOM 选择和评注队列。
2. **Host 预览路由**：获取目标 HTML，插入 `<base>` 和评注脚本，再返回给受控 iframe。
3. **Frontend Builder Skill**：把结构化的 `[frontend-feedback]` 数据转换为源码修改、验证和刷新流程。

评注发送给 Agent 时包含类似下面的证据：

```text
页面 URL: http://localhost:5173/
CSS selector: #hero-title
DOM path: html > body > main > section > h1
元素文本: Build faster
矩形位置: x=120, y=84, width=420, height=72
修改要求: 标题更醒目，并增加一行产品说明
```

坐标用于提供视觉上下文，Agent 仍会优先修改原有 React/Vue/HTML/CSS 结构，而不是机械地添加绝对定位样式。

## 配置

插件默认允许代理 HTTP/HTTPS 页面，并设置 5 MiB HTML 上限与 15 秒请求超时。可以在 Harness profile 中调整：

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

如果只评注本机页面，可将 `allowRemoteHosts` 设置为 `false`，并通过 `allowedHosts` 单独放行其他主机。

## 开发与验证

```powershell
npm install
npm run check
```

`npm run check` 会依次执行构建、自动化测试和 npm 包内容检查。构建产物位于 `lib/`。

## 已知限制

- 当前代理的是 HTML 入口，不是完整反向代理。依赖目标域 Cookie、Service Worker、严格 CSP 或特殊跨域 ES Module 的网站可能无法完整运行。
- 远程站点的部分接口和资源仍可能受到浏览器 CORS 策略限制。
- 页面跳转发生在 iframe 内；重新输入地址或点击刷新可返回开发服务器入口。
- DeepSeek Harness 仍处于 developer preview，升级 Harness 后建议重新执行 `npm run check`。

## Roadmap

- 空白区域拖拽框选，并发送四顶点、归一化坐标、最近容器和截图给 Agent。
- 在没有现成 DOM 元素的位置新增组件。
- HTML/CSS/JavaScript 交互式幻灯片生成与逐页评注。
- 移动、缩放、删除、多选和响应式断点评注。
- 修改前后视觉对比与评注历史。

