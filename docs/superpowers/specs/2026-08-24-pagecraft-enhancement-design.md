# PageCraft 全面增强设计规格

日期：2026-08-24  
目标分支：`lxy`  
目标仓库：`noabt187/dsh-PageCraft`

## 1. 目标与约束

本次改造将 PageCraft 从页面评注插件扩展为完整的视觉开发闭环：采集真实页面上下文，将视觉意图映射到源码组件，通过专用 Skill 驱动 Agent 修改源码，对修改前后进行视觉验证，并提供可审计的批次历史与安全回滚。

实施必须遵守以下约束：

1. 只修改、提交和推送 `lxy` 分支，不修改或推送 `main`、`lwm_dev` 等其他远端分支。
2. 首先在 `lxy` 内合并 `lwm_dev` 当前基线，保留双方提交历史并解决冲突。
3. PageCraft 仍是 DeepSeek Harness 插件。它负责预览、上下文采集、工单编排和历史展示；实际目标项目源码修改由当前 Agent 执行。
4. 高级视觉和电影化能力不得牺牲可读性、无障碍、移动端体验或性能。
5. 回滚不得使用 `git reset --hard` 等仓库级破坏性操作，只恢复由指定 PageCraft 批次产生且能够安全验证的改动。

## 2. 范围

本次交付包含：

- 安全对齐 `lwm_dev`。
- 新增并注册 `frontend-design` Skill。
- 优化 `frontend-page-builder` Skill 的设计、实现和验证流程。
- 加固预览与资源代理的默认安全策略。
- 提高 DOM 到源码组件的定位准确率。
- 增加评注批次、修改前后视觉比较、历史列表和一键回滚。
- 增加响应式断点预览与断点级评注。
- 增加视口/选区截图上下文。
- 增加 Studio 工作台界面、主题中心、电影化动效和高级视觉能力。
- 增加类型检查、单元测试、浏览器测试、视觉快照测试和 DSH 冒烟测试。
- 将构建产物随源码更新，并把增强版部署到本机 DSH `web` profile。
- 最终仅推送远端 `lxy`。

原生 PPTX/PDF 导出不在本次范围内；现有演示文稿模式继续以 HTML/React deck 为基础。

## 3. 总体架构

系统拆为六个边界清晰的子系统：

1. **Preview Gateway**：验证 URL、DNS/IP 和重定向，代理 HTML/资源并注入 PageCraft runtime。
2. **Context Collector**：在 iframe 内采集 DOM、区域、框架组件、断点和截图上下文。
3. **Work Order Compiler**：把上下文压缩为带批次 ID 的结构化工单。
4. **Agent Skills**：`frontend-design` 负责视觉方向，`frontend-page-builder` 负责源码实现、验证和批次恢复。
5. **Visual History**：保存 before/after 快照、评注摘要、断点、URL 和执行状态。
6. **Studio UI**：提供预览、检查器、评注队列、断点、比较、历史、主题和动效入口。

关键数据流：

```text
打开 URL
  -> Preview Gateway 安全校验与代理
  -> iframe 注入 Context Collector
  -> 用户选择 DOM 或区域并添加评注
  -> 捕获 sourceHints + viewport + screenshot
  -> 创建 batchId 与 before 快照
  -> Work Order Compiler 生成反馈工单
  -> 当前 Agent + Skills 修改并验证源码
  -> Agent 完成后刷新预览
  -> 捕获 after 快照并生成历史记录
  -> 用户比较、继续评注或恢复指定批次
```

## 4. 分支对齐策略

采用合并而非重置或逐提交拣选：

1. 获取远端 `lwm_dev` 最新提交，只读该分支。
2. 保持当前检出分支为 `lxy`。
3. 在 `lxy` 执行合并，保留完整历史。
4. 对 README、Skill、构建产物等冲突，以 `lwm_dev` 的演示文稿和结构化评注能力为功能基线，同时保留 `lxy` 独有文档信息。
5. 合并后运行现有检查，建立增强开发的可验证起点。
6. 所有后续提交和唯一远端推送目标均为 `lxy`。

## 5. Preview Gateway 安全设计

### 5.1 默认策略

默认配置：

```yaml
allowRemoteHosts: false
allowPrivateHosts: false
allowedHosts: []
maxHtmlBytes: 5242880
maxResourceBytes: 20971520
requestTimeoutMs: 15000
```

规则：

- 默认允许 loopback 地址。
- 非 loopback 地址必须进入标准化后的 `allowedHosts`，或在明确开启 `allowRemoteHosts` 后通过公网地址校验。
- 私网、链路本地、组播、保留地址、云 metadata 地址默认拒绝。
- 局域网预览只能通过显式 `allowPrivateHosts: true` 开启；该选项不得隐式开启 metadata 地址。
- 禁止 URL 用户名和密码，仅允许 HTTP/HTTPS。

### 5.2 DNS 与重定向

- 首次请求和每一次重定向都执行 URL、hostname 和解析后 IP 校验。
- 同时检查 IPv4 与 IPv6，拒绝混合结果中存在受限地址的主机。
- 限制最多五次重定向。
- 在建立连接前保留并使用已校验的解析结果，缩小 DNS rebinding 窗口；若宿主 fetch 接口无法绑定解析结果，则在响应后再次核验并记录限制。

### 5.3 代理滥用防护

- `/preview` 和 `/resource` 只接受允许的方法。
- 检查 fetch metadata、Origin/Referer 与 Harness host 的一致性；缺少可信浏览器来源时拒绝或按兼容配置降级。
- 资源 URL 使用服务器签发、短期有效且与目标 origin 绑定的令牌。
- 令牌采用常量时间比较，过期、签名错误或 origin 不一致时拒绝。
- 对单次响应大小、总读取字节数、超时和并发请求设置上限。
- 返回 `no-store`、`nosniff` 与严格 referrer policy。

## 6. DOM 到源码组件定位

新增 `SourceHints`：

```ts
interface SourceHints {
  framework?: 'react' | 'vue' | 'svelte' | 'unknown'
  component?: string
  owners?: string[]
  file?: string
  line?: number
  column?: number
  stableId?: string
  evidence: string[]
  confidence: number
}
```

定位按以下优先级执行：

1. 显式稳定标记：`data-pagecraft-source`、`data-pagecraft-component`、框架测试 ID 或用户项目已有映射标记。
2. 框架开发信息：React Fiber owner/source、Vue 组件实例 `type.__file`、Svelte 开发元数据。
3. DOM 与交互证据：selector、DOM path、精简 HTML、文本、事件元素、最近语义容器和布局容器。
4. Agent 源码检索：根据文件提示、组件链、文本、class 与结构进行候选排序。

`confidence` 只表达采集证据强度。低置信度不能被 Skill 当作确定文件；修改前必须读取候选源码并与 DOM 证据交叉验证。

`frontend-page-builder` 应鼓励生成和保留稳定的 `data-pagecraft-source`，但不得为了定位而污染生产页面；构建系统允许时应只在开发环境输出。

## 7. 批次、视觉历史与回滚

### 7.1 批次模型

每次发送创建唯一 `batchId`，记录：

- 创建时间、会话 ID、工作模式和页面 URL；
- 评注列表、断点和 sourceHints；
- before/after 快照；
- Agent 执行状态与验证摘要；
- 涉及文件、前后哈希和受控逆向补丁信息。

浏览器侧历史保存在 IndexedDB，不使用 localStorage 保存大图。历史和图片分别设置记录数、单项大小和总容量上限，并采用最旧优先淘汰。删除历史时同时清理关联 Blob。

源码恢复材料由 Agent 写入目标项目的 `.pagecraft/history/<batchId>/`：`manifest.json` 保存文件、哈希、检查和批次元数据，`revert.patch` 保存只属于该批次的逆向补丁。首次使用时将 `.pagecraft/` 加入目标项目的忽略规则；这些本地恢复材料不得进入产品构建或 PageCraft 插件仓库提交。

### 7.2 视觉比较

比较界面支持：

- before/after 并排；
- 拖动滑杆；
- 当前断点、URL 和评注列表；
- 快照缺失、捕获失败和页面无法稳定渲染时的明确状态；
- 回滚完成后生成新的历史事件，而不是改写旧记录。

### 7.3 安全回滚协议

`frontend-page-builder` 在应用批次前记录当前脏文件清单和内容哈希，只把本批次新增的差异纳入恢复清单。批次完成后生成逆向补丁与后置哈希。

点击恢复时发送：

```text
[frontend-rollback]
{ "batchId": "...", "expectedPostHashes": { ... } }
```

Agent 必须：

1. 找到该批次清单。
2. 比较当前文件与 `expectedPostHashes`。
3. 完全匹配时应用逆向补丁。
4. 不匹配时停止自动覆盖，并报告冲突文件；可提出最小人工/Agent 辅助恢复方案。
5. 运行与原批次相称的检查。
6. 报告恢复结果并触发预览刷新。

禁止使用仓库整体重置、清理用户未跟踪文件或覆盖批次之前已有的脏改动。

## 8. 响应式断点评注

内置预设：

- Desktop：1440×900
- Laptop：1280×800
- Tablet：768×1024
- Mobile：390×844
- Custom：用户输入宽高

iframe 放在可缩放设备画布中，切换断点不改变目标 URL。评注增加 `viewport` 和 `scope`：

```ts
interface AnnotationViewport {
  preset: string
  width: number
  height: number
  devicePixelRatio: number
}

type ResponsiveScope = 'current-breakpoint' | 'current-and-smaller' | 'all-breakpoints'
```

工单明确要求 Agent 使用项目现有媒体查询、容器查询和设计令牌表达意图，不把预览像素坐标直接硬编码为绝对定位。

发送前和修改后均可运行 Desktop/Tablet/Mobile 三档预览矩阵。每档失败独立显示，不阻塞其他档位。

## 9. 截图上下文

捕获类型：

- 当前视口；
- DOM 元素裁剪；
- 区域选区裁剪；
- 带编号和高亮的上下文图；
- before/after 快照。

截图由 iframe 内 runtime 生成，排除 PageCraft 自身覆盖层。输出优先为 WebP，不支持时使用 PNG；限制最长边、质量和字节数。跨域图片、字体或复杂 CSS 导致捕获失败时，保留 DOM 上下文并显示失败原因。

对 Agent 的发送采用能力适配：

1. 若当前 Harness `session.prompt` 支持图像内容块，则发送压缩图像块。
2. 若不支持，则只发送结构化文本工单，并在 UI 显示“截图仅保存在视觉历史，未发送给模型”。
3. 禁止把大段 Base64 作为普通文本塞入 Prompt。

## 10. Skill 设计

### 10.1 frontend-design

新增独立并可自动发现的 `frontend-design` Skill。它只负责设计判断，不直接取代 builder：

- 将请求转成页面 brief：用途、受众、主要动作、信息层级、状态和响应式要求。
- 根据现有品牌、组件和设计令牌选择视觉方向。
- 定义排版、色彩、间距、深度、图像与动效规则。
- 设置一个有辨识度且服务内容的核心视觉元素。
- 避免通用 AI 风格：无目的黑底、蓝紫渐变、霓虹、玻璃卡片和重复卡片网格。
- 输出可执行设计 brief，并进行层级、对比、节奏、响应式、键盘和 reduced-motion 自检。

Skill 应基于公开 `frontend-design` 思路重新组织为适合 DSH/PageCraft 的精简、自包含说明，保留必要的来源与许可证信息，不无授权复制不兼容内容。

### 10.2 frontend-page-builder

优化后的 builder：

- 新建或大改页面时先使用 `frontend-design` 产出 brief，再实现。
- 局部评注默认只执行最小修改，不重复完整设计流程。
- 使用 sourceHints 但验证其真实性。
- 理解断点 scope、截图和批次协议。
- 修改前建立恢复清单，修改后报告文件、检查、预览 URL 和批次结果。
- 需要实际渲染后才能声称视觉验证通过。
- 回滚模式遵守哈希与冲突停止规则。

`presentation-builder` 保持现有职责，并接入断点、截图、批次与视觉验证协议。

## 11. Studio UI、主题中心与电影化能力

默认采用 Studio 工作台：深色工具框架承载目标页面画布，保证页面本身的色彩不被工具外壳干扰。主要区域：

- 顶部：地址、前进/后退/刷新、断点、截图、比较与模式切换。
- 左侧窄栏：元素、区域、幻灯片、历史、主题和动效工具。
- 中央：设备画布和目标页面。
- 右侧检查器：sourceHints、选区、响应式 scope、评论、队列和发送状态。
- 比较模式：替换中央画布，显示并排或滑杆。

### 11.1 主题中心

主题中心管理目标页面设计 brief 和设计令牌，不直接强制覆盖页面 CSS。内置：

- Editorial Light
- Product Neutral
- Cinema Dark
- 自定义品牌主题
- 从当前页面提取主题

主题包含颜色、字体、间距、圆角、阴影、图像处理和动效曲线。应用主题会生成结构化 `[frontend-theme]` 工单，由 Agent 将令牌映射到项目现有主题系统。

### 11.2 电影化动效

预设包括分层景深、滚动揭示、视差、章节转场、聚光/遮罩、纹理/噪点、画面色调和视频/WebM 背景。

约束：

- 默认关闭，用户主动选择后才生成工单。
- 必须提供 `prefers-reduced-motion` 静态状态。
- 移动端降低层数、模糊、视频和视差强度。
- 不得阻挡正文、键盘焦点和主要操作。
- 设定同时动画数量、媒体体积和主线程工作预算。
- 静态最终状态必须完整可理解。

## 12. 错误处理与降级

- 预览安全拒绝：显示具体规则与可修复配置，不暴露内部敏感信息。
- sourceHints 缺失：降级为 DOM 证据和 Agent 候选检索。
- 截图失败：保留文本评注，不阻塞发送。
- IndexedDB 不可用：历史降级为会话内存，并提示关闭页面后会丢失。
- 图像消息不支持：只发送结构化文本，UI 明示降级。
- Agent 执行失败：保留 before 快照、评注和批次失败状态，可重试但不自动重复提交。
- after 页面未稳定：允许手动重新捕获，不把旧图标记为最新结果。
- 回滚哈希冲突：停止自动恢复，绝不覆盖后续修改。
- 高级动效能力不支持：保留静态主题与内容层级。

## 13. 测试策略

### 13.1 静态与构建

- 增加 `tsconfig.json` 和 `npm run typecheck`。
- `npm run check` 至少运行构建、类型检查、单元测试和 package dry-run。
- 校验发布包包含三个 Skill、Host/Client 构建产物和配置。

### 13.2 单元测试

- URL 标准化、白名单、DNS/IP 分类、metadata 和重定向逐跳校验。
- 签名令牌签发、过期、篡改、origin 绑定和常量时间比较。
- SourceHints 校验与工单序列化。
- 断点预设、自定义尺寸、scope 和历史持久化上限。
- 批次状态机、快照缺失与回滚冲突协议。
- 三个 Skill 注册、内容和触发标记。

### 13.3 浏览器与视觉测试

- 预览导航、元素选择、区域框选和 sourceHints 采集。
- 断点切换不丢失评注。
- 截图捕获、压缩、失败提示和图像能力降级。
- before/after 并排与滑杆。
- 历史选择和回滚工单发送。
- Studio 关键视口视觉快照。
- 键盘焦点、ARIA、触控目标与 reduced-motion。

### 13.4 DSH 冒烟测试

在本机 DSH `web` profile 中：

1. 链接安装本地 `lxy` 插件。
2. 启动 DSH web。
3. 打开可信本地前端页面。
4. 完成 DOM 评注、区域评注和移动断点评注。
5. 发送带/不带截图的批次。
6. 等待 Agent 完成并验证自动刷新和 after 捕获。
7. 打开比较与历史。
8. 恢复一个无冲突批次，并验证冲突批次会安全停止。
9. 应用一个主题和一个电影化预设，验证静态降级。

## 14. 部署与交付

1. 完成全部自动检查。
2. 构建并提交 `lib/index.js`、`lib/client.js`。
3. 将本地 `lxy` 工作树链接安装到用户的 DSH `web` profile。
4. 记录实际启动命令、访问地址和冒烟结果。
5. 检查 `git diff`、提交历史和远端目标。
6. 仅执行 `git push origin lxy`。
7. 最终报告功能、文件、检查、部署状态、已知限制和远端提交 SHA。

## 15. 完成标准

只有以下证据全部成立才算完成：

- `lxy` 已包含 `lwm_dev` 基线，其他远端分支没有被修改。
- 默认代理安全配置关闭任意远程访问，DNS/IP/重定向测试通过。
- 工单包含经过校验的 sourceHints、viewport、scope 和 batchId。
- Studio 中能切换断点、捕获截图、查看 before/after、浏览历史并发送恢复请求。
- `frontend-design` 已注册；builder 已接入设计、定位、批次、截图、响应式和恢复协议。
- 主题中心和电影化预设能生成可执行工单，并具有移动端与 reduced-motion 降级。
- 类型检查、构建、单元测试、浏览器/视觉测试和 package dry-run 通过。
- 增强版已安装到本机 DSH 并完成约定的冒烟流程。
- 最终提交已仅推送到远端 `lxy`，并能从远端读取到对应 SHA。
