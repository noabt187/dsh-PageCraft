# PageCraft 任务进度与智能评注引导设计

日期：2026-08-24

目标分支：`lxy`

状态：待用户书面审阅

## 背景

PageCraft 已能把 DOM/区域评注、响应式上下文和截图发送给 DSH Agent，并记录修改前后视觉历史。真实使用中暴露了两个体验问题：

1. Agent 运行数十秒时，右侧只显示笼统的等待文案。用户无法判断任务是否已发送、正在定位源码、已经写入还是卡住。
2. 选择元素或框选区域后，输入框只提供一个占位提示。不了解前端实现或提示词写法的用户，不知道应该描述内容、视觉、布局、交互、响应式范围还是不可改变项。

本设计采用已确认的 `A1 + B1` 方向：右侧常驻真实进度时间线，以及根据选择上下文生成草稿的智能修改编辑器。

## 目标

- 让每个 PageCraft 批次在发送、排队、执行、验证和完成期间都有可理解、可恢复的真实状态。
- 使用 DSH 会话快照和 PageCraft 本地生命周期推导进度，不伪造百分比或不可观察的内部状态。
- 支持多个 PageCraft 批次按 DSH 队列顺序展示，不再用单一 `activeBatchId` 覆盖前一个任务。
- PageCraft 关闭或页面重新加载后，恢复未结束批次并在 Agent 已完成时补做刷新、截图和历史结算。
- 根据元素类型、区域操作、断点和响应范围生成高质量、可编辑、不会自动发送的修改草稿。
- 保持自由输入、键盘操作和现有 DOM/区域评注流程。

## 非目标

- 不修改 DeepSeek Harness 本体或会话协议。
- 不解析或展示模型的隐藏推理内容。
- 不根据时间伪造进度百分比。
- 不承诺精确剩余时间。
- 不自动接受模板、自动发送评注或自动停止 Agent。
- 不在本轮扩展主题中心、演示文稿生成或远程预览安全策略。

## 方案选择

### 等待体验

比较过三种布局：右侧常驻时间线、顶部紧凑状态条、底部任务抽屉。选择右侧常驻时间线，因为它复用当前评注栏，不遮挡预览，并能自然衔接前后比较和回滚。紧凑状态条可作为收起态，而不是主要呈现。

### 评注引导

比较过智能修改编辑器、三步向导和范例库。选择智能修改编辑器，因为它既能为新手生成完整草稿，又不会让连续评注被多步骤向导拖慢。范例能力作为智能编辑器中的快捷意图提供。

## 真实进度模型

### 会话快照扩展

当前客户端只把 Session 暴露为 `{ running?: boolean }`。实现将只读类型扩展为 PageCraft 所需的稳定子集：

```ts
interface PageCraftSessionSnapshot {
  running: boolean
  queue: readonly {
    preview: string
    placement: 'queued' | 'steering' | 'context'
  }[]
  runningCalls: readonly PageCraftRunningToolCall[]
  partial: { turn: number; step: number } | null
  promptError: { op: 'send' | 'stop'; error: { message?: string } } | null
}
```

`PageCraftRunningToolCall` 只保留工具名、参数文本、开始时间和嵌套子调用。所有读取均通过现有 `subscribe/getSnapshot`，不新增 DSH API。

### 批次进度阶段

```ts
type BatchProgressStage =
  | 'preparing'
  | 'queued'
  | 'thinking'
  | 'locating'
  | 'checkpointing'
  | 'editing'
  | 'verifying'
  | 'finalizing'
  | 'completed'
  | 'failed'
```

阶段含义：

- `preparing`：PageCraft 正在捕获修改前截图、整理评注和创建历史记录。
- `queued`：提示已被 DSH 接受，但仍出现在会话 queue 中，或前面存在其他任务。
- `thinking`：当前批次已运行，暂时没有可分类的工具调用。
- `locating`：正在读取、搜索、列举、定位源码或检查 DOM 线索。
- `checkpointing`：正在计算哈希、创建 `.pagecraft/history/<batchId>` 或记录回滚信息。
- `editing`：正在写入、替换、应用补丁或执行可识别的文件修改命令。
- `verifying`：正在运行测试、构建、类型检查、浏览器检查、截图或修改后哈希校验。
- `finalizing`：Agent 已停止，PageCraft 正在刷新预览、捕获修改后截图并比较结果。
- `completed`：历史结算完成，并标记视觉结果。
- `failed`：发送、Agent、捕获或结算发生可归属错误。

### 工具分类

`deriveBatchProgress()` 递归展开 `runningCalls` 与子调用，并按可验证的工具名和参数特征分类：

- `read`、`glob`、`search`、`find`、只读 `Get-Content/Select-String` → `locating`
- `Get-FileHash`、创建 `.pagecraft/history`、生成 manifest/revert patch → `checkpointing`
- `write`、`edit`、`apply_patch`、`str_replace`、可识别的写文件 PowerShell → `editing`
- `test`、`check`、`build`、`typecheck`、浏览器检查、截图、修改后哈希 → `verifying`
- 无法可靠识别 → 保持 `thinking`，文案为“Agent 正在执行”，不猜测具体动作

阶段显示采用单调进展。修改后再次读取源码时，归入验证而不是倒退到定位。时间线同时显示“当前真实动作”，它可以变化，但已完成步骤不会回退。

### 批次与队列匹配

每个 PageCraft 提示已经包含唯一 `batchId`。控制器通过 `queue[].preview` 中的 `batchId` 匹配排队批次：

- queue 中存在该 ID：明确显示排队，并计算它前面的消息数量。
- 会话正在运行、该 ID 不再位于 queue，且它是最早未结束 PageCraft 批次：标记为运行。
- 会话运行的是非 PageCraft 消息：PageCraft 批次仍显示排队，不抢占当前任务。
- 一个运行批次结束后，再按创建时间选择下一批次。

批次调度状态由历史记录集合推导，不再依赖单一可覆盖的 `activeBatchIdRef`。

## 进度界面

### 常驻时间线

右侧区域在存在未结束批次时显示：

- 批次短 ID、评注数量、当前断点和响应范围
- 从批次创建时间计算的累计耗时
- 八个用户可理解的时间线节点
- 当前真实动作，例如“正在读取螺丝机可视化配置器.html”
- 前面任务数量或“等待 Agent 开始”
- 收起按钮；收起后显示一行状态条

等待超过 60 秒时增加非错误提示：“任务仍在运行。可以收起 PageCraft 后继续工作，完成后会保留历史记录。”不显示假百分比和假剩余时间。

### 完成与结果

结算时比较修改前后截图与捕获状态，写入：

```ts
type VisualOutcome = 'changed' | 'unchanged' | 'unverified'
```

- `changed`：明确检测到修改前后视觉差异。
- `unchanged`：Agent 已完成且截图相同，提示可能是非视觉修改、浏览器缓存或未修改目标文件。
- `unverified`：截图失败或页面不可加载；任务本身可完成，但不声称视觉验证成功。

完成卡片提供“查看前后对比”“刷新预览”“再次评注”。失败卡片提供“恢复草稿”“重试发送”“查看错误”。已有安全回滚仍位于视觉历史面板。

## 关闭与重新打开后的恢复

未结束批次已经存储于 IndexedDB。打开 PageCraft 时执行一次 reconcile：

1. 读取当前 session 对应的 `queued/running` 历史记录。
2. 与会话 queue、running 和 promptError 对齐。
3. 若 Agent 仍在运行，恢复时间线与累计耗时。
4. 若历史显示运行、但 Agent 已空闲，进入 `finalizing`，刷新预览并捕获修改后截图。
5. 若批次在 DSH queue 中，保持排队。
6. 若既不在 queue、也无运行证据且无法安全判断，标记为失败并提示重新发送；不默认为成功。

关闭 PageCraft 只关闭界面，不取消 Agent。界面明确说明这一点。

## 智能修改编辑器

### 上下文分类

`buildGuidanceSuggestions(selection, viewport, scope)` 根据以下类别生成建议：

- 按钮、链接、导航项
- 标题、段落、标签等文字内容
- 输入框、选择框、表单
- 容器、卡片、列表、导航、表格
- 图片、视频、图标
- 框选区域

分类使用标准标签、ARIA role、选择器、可见文字和已有 `sourceHints`。无法识别时使用通用建议，不阻止自由输入。

### 快捷意图

元素选择默认提供四类：

- 修改内容：文字、图片、图标、数据展示
- 调整视觉：颜色、字号、间距、层级、状态
- 调整布局：位置、尺寸、对齐、响应式
- 增加交互：点击、展开、校验、动效、反馈

框选区域默认提供：

- 新增内容
- 重新布局
- 覆盖内容
- 替换区域

区域编辑器继续保留 `insert/overlay/replace`，但改为带说明的选择卡：

- 插入：参与正常文档流并推开后续内容
- 覆盖：浮在现有内容上，不改变文档流
- 替换：移除或重构框内现有内容

### 草稿生成

第一次点击快捷意图且输入框为空时，生成包含真实上下文的完整草稿，例如：

> 将按钮文字从“01 被控硬件”改为“[填写新文字]”，保留现有点击逻辑、类名和 `data-tab`；仅作用于当前 Mobile 断点，并确保文字不溢出。

输入框已有内容时，快捷项在光标处追加短建议，不覆盖用户文本。模板中的动态内容需长度受限并去除控制字符。

编辑器额外提供可点击约束：

- 保留现有业务逻辑
- 不改变数据格式
- 不影响其他断点
- 保持现有设计语言
- 完成后进行视觉验证

模板只生成草稿，不加入队列、不发送 Agent。`Ctrl/Cmd + Enter` 仍只执行“加入队列”。

## 组件边界

新增模块：

- `src/progress.ts`：阶段、工具分类、队列匹配、耗时与 reconcile 纯逻辑。
- `src/guidance.ts`：选择分类、快捷意图和模板生成纯逻辑。
- `src/client/progress.tsx`：时间线、收起态、完成与异常卡片。
- `src/client/guidance.tsx`：目标摘要、快捷意图、约束和区域操作说明。

`src/client/index.tsx` 只负责组合状态、调用截图/历史存储以及连接 DSH Session，不继续堆叠大段 UI 和分类逻辑。

## 错误处理

- 截图失败：继续发送文字工单，批次保留截图错误并显示降级原因。
- `session.prompt` 拒绝：批次标记失败，评注草稿不清空。
- `promptError`：归属当前运行批次并显示 DSH 错误信息；不暴露堆栈和敏感参数。
- 工具分类失败：显示通用执行状态，不影响任务。
- 重新打开后的状态冲突：优先相信 DSH queue/running，其次使用持久化历史；无法证明成功时不标记完成。
- 修改后截图相同：记录 `unchanged`，提供刷新与再次捕获，不自动回滚。
- IndexedDB 不可用：继续使用现有有界内存存储，并提示关闭页面后进度可能丢失。

## 可访问性与视觉规范

- 时间线使用文字和图标共同表达状态，不仅依赖颜色。
- 当前阶段使用 `aria-current="step"`，运行状态使用节制的动态指示并尊重 `prefers-reduced-motion`。
- 所有快捷意图为真实按钮，可键盘聚焦。
- 状态更新使用 `aria-live="polite"`；失败使用 `role="alert"`。
- 右侧面板在窄屏可滚动，按钮最小触控高度 36px，不引入横向滚动。
- 保持 PageCraft 现有深绿色视觉语言。

## 测试计划

### 单元测试

- 每类工具调用与嵌套子调用正确映射阶段。
- 阶段单调推进，修改后读取归入验证。
- queue 通过 batchId 匹配，多个批次保持 FIFO。
- 非 PageCraft 消息在前时正确显示等待数量。
- 关闭后 reconcile 的运行、排队、已结束和未知状态分支。
- `changed/unchanged/unverified` 结果分类。
- 耗时格式在秒、分钟、小时边界正确。
- 六类元素和区域生成正确快捷意图。
- Mobile、全部断点、保留逻辑等动态约束正确进入模板。
- 已有输入不会被快捷意图覆盖。
- 动态 DOM 文本经过长度与控制字符清理。

### 集成与浏览器测试

- 空闲会话发送一个真实 HTML 文字修改，观察完整时间线并验证文件改变。
- Agent 已在运行时发送第二批，显示前置任务数量并按 FIFO 结算。
- 运行中关闭并重开 PageCraft，进度和耗时恢复。
- Agent 在关闭期间完成，重开后自动捕获修改后截图。
- 无视觉变化、预览不可达、图片输入降级、Agent 失败均显示准确结果。
- 对按钮、表格、表单、容器和空白区域逐一生成并编辑模板。
- Desktop、Tablet、Mobile 与三种响应范围均可使用。
- 视觉历史比较和安全回滚仍正常。

## 验收标准

1. 发送评注后 300ms 内出现批次时间线与累计耗时。
2. DSH queue 中的批次明确显示排队位置，不再使用含糊的“等待前置批次”。
3. Agent 的读、备份、写和验证工具调用能实时映射到对应阶段；无法识别时不误报。
4. PageCraft 关闭并重开后，未结束批次可恢复；Agent 已结束的批次会重新结算。
5. 完成后区分有变化、无变化和无法验证，并提供相应操作。
6. 选择任意受支持元素或框选区域后，显示匹配的快捷意图和可编辑草稿。
7. 模板不会自动加入队列或发送，也不会覆盖已有输入。
8. 所有新增纯逻辑都有边界测试，完整 `npm run check` 通过。
9. 在 DSH 本地真实页面完成发送、进度、修改、刷新、比较和回滚冒烟测试。
10. 只修改并推送 `lxy`，不改变 `main` 或 `lwm_dev`。
