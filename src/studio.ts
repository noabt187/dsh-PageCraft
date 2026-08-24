export type ThemePresetId = 'editorial-light' | 'product-neutral' | 'cinema-dark'
export type MotionPresetId =
  | 'layered-depth'
  | 'scroll-reveal'
  | 'subtle-parallax'
  | 'chapter-transition'
  | 'spotlight-mask'
  | 'film-texture'
  | 'cinematic-grade'
  | 'ambient-video'

export interface ThemePreset {
  id: ThemePresetId
  name: string
  description: string
  tokens: {
    color: string
    typography: string
    spacing: string
    radius: string
    shadow: string
    imagery: string
    motion: string
  }
}

export interface MotionPreset {
  id: MotionPresetId
  name: string
  description: string
  reducedMotion: string
  mobileFallback: string
  performanceBudget: {
    maxConcurrentAnimations: number
    maxMediaBytes: number
    mainThreadBudgetMs: number
  }
}

export interface StudioViewport {
  preset: string
  width: number
  height: number
  devicePixelRatio: number
}

export interface ScreenshotReference {
  id: string
  kind: 'viewport' | 'selection' | 'annotated' | 'before' | 'after'
  mimeType?: 'image/webp' | 'image/png'
  delivery: 'attached' | 'history-only' | 'unavailable'
  error?: string
}

export interface ThemeWorkOrder {
  batchId: string
  theme: ThemePresetId | 'custom' | 'extract-current'
  viewport?: StudioViewport
  screenshot?: ScreenshotReference
  customBrief?: string
  scope?: 'current-page' | 'current-component' | 'design-system'
}

export interface MotionWorkOrder {
  batchId: string
  preset: MotionPresetId
  viewport?: StudioViewport
  screenshot?: ScreenshotReference
  target?: string
  intensity?: 'subtle' | 'balanced' | 'cinematic'
}

export interface RollbackWorkOrder {
  batchId: string
  expectedPostHashes?: Record<string, string>
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: 'editorial-light',
    name: 'Editorial Light',
    description: '以排版、留白与内容节奏为主的明亮编辑风格。',
    tokens: {
      color: '温暖浅色画布、墨色正文、单一克制强调色',
      typography: '有辨识度的展示字体配高可读正文字体',
      spacing: '宽松章节间距与紧凑内容组',
      radius: '小圆角或直角',
      shadow: '少量、低对比阴影',
      imagery: '大幅裁切、图注与编辑式网格',
      motion: '短促淡入与轻微位移',
    },
  },
  {
    id: 'product-neutral',
    name: 'Product Neutral',
    description: '强调任务层级、状态清晰度和密集信息可读性的产品界面。',
    tokens: {
      color: '中性画布、可靠对比度、语义状态色',
      typography: '清晰无衬线字体与表格数字',
      spacing: '稳定的 4/8 像素节奏',
      radius: '适中的组件圆角',
      shadow: '边框优先、阴影辅助',
      imagery: '功能截图、图表与真实状态',
      motion: '状态反馈和空间连续性优先',
    },
  },
  {
    id: 'cinema-dark',
    name: 'Cinema Dark',
    description: '由影像、光影和章节推进构成的沉浸式深色叙事风格。',
    tokens: {
      color: '接近黑色的中性画布、暖白正文、场景化强调色',
      typography: '高对比标题配克制正文',
      spacing: '宽阔场景与聚焦内容岛',
      radius: '少量圆角，避免满屏玻璃卡片',
      shadow: '遮罩、景深和局部聚光',
      imagery: '全幅影像、电影比例裁切与一致色调',
      motion: '章节转场与分层运动，静态状态完整',
    },
  },
] as const

const DEFAULT_MOTION_BUDGET = {
  maxConcurrentAnimations: 4,
  maxMediaBytes: 8 * 1024 * 1024,
  mainThreadBudgetMs: 8,
} as const

export const MOTION_PRESETS: readonly MotionPreset[] = [
  ['layered-depth', '分层景深', '以前中后景建立空间层次。', '移除位移与模糊，保留清晰层级。', '减少为两个平面并关闭模糊。'],
  ['scroll-reveal', '滚动揭示', '内容进入视口时按阅读顺序显现。', '内容立即显示，不隐藏初始状态。', '仅使用短距离淡入。'],
  ['subtle-parallax', '克制视差', '用小幅差速增强画面深度。', '停用视差并固定在最终位置。', '停用背景视频并降低位移。'],
  ['chapter-transition', '章节转场', '在主要叙事段落间建立连续转场。', '直接切换到完整静态章节。', '缩短转场并禁用复杂遮罩。'],
  ['spotlight-mask', '聚光遮罩', '用局部光线和遮罩引导注意力。', '保持可读的最终明暗层级。', '降低遮罩层数和模糊半径。'],
  ['film-texture', '胶片纹理', '增加低强度噪点和质感。', '移除动画噪点，允许静态纹理。', '使用低分辨率静态纹理。'],
  ['cinematic-grade', '电影色调', '统一图像和视频的场景色调。', '保留静态调色但关闭过渡。', '降低滤镜复杂度和对比度。'],
  ['ambient-video', '氛围视频', '使用无声 WebM/MP4 作为非关键背景。', '显示语义等价的静态封面。', '默认使用封面，用户明确播放后再加载视频。'],
].map(([id, name, description, reducedMotion, mobileFallback]) => ({
  id: id as MotionPresetId,
  name,
  description,
  reducedMotion,
  mobileFallback,
  performanceBudget: { ...DEFAULT_MOTION_BUDGET },
}))

function requireBatchId(batchId: string): string {
  const value = batchId.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error('batchId 无效')
  }
  return value
}

function normalizeViewport(viewport?: StudioViewport): StudioViewport | undefined {
  if (!viewport) return undefined
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)
    || viewport.width < 240 || viewport.width > 7680
    || viewport.height < 240 || viewport.height > 7680
    || !Number.isFinite(viewport.devicePixelRatio)
    || viewport.devicePixelRatio < 0.5 || viewport.devicePixelRatio > 4) {
    throw new Error('viewport 尺寸或 devicePixelRatio 无效')
  }
  return {
    preset: viewport.preset.trim().slice(0, 40) || 'custom',
    width: Math.round(viewport.width),
    height: Math.round(viewport.height),
    devicePixelRatio: viewport.devicePixelRatio,
  }
}

function normalizeScreenshot(screenshot?: ScreenshotReference): ScreenshotReference | undefined {
  if (!screenshot) return undefined
  const id = screenshot.id.trim()
  if (!id || id.length > 160) throw new Error('screenshot id 无效')
  return { ...screenshot, id, error: screenshot.error?.trim().slice(0, 500) }
}

function prompt(marker: string, instruction: string, payload: unknown): string {
  return [marker, instruction, JSON.stringify(payload, null, 2)].join('\n')
}

export function buildThemePrompt(order: ThemeWorkOrder): string {
  const batchId = requireBatchId(order.batchId)
  if (order.theme === 'custom' && !order.customBrief?.trim()) {
    throw new Error('自定义主题需要 customBrief')
  }
  return prompt(
    '[frontend-theme]',
    '请使用 frontend-design 形成可执行设计 brief，再由 frontend-page-builder 将主题映射到项目现有设计令牌。先核对品牌与组件，保留内容、交互、响应式和无障碍；不要直接覆盖整页 CSS。完成后报告实际渲染验证和批次恢复材料。',
    {
      batchId,
      theme: order.theme,
      preset: THEME_PRESETS.find(item => item.id === order.theme),
      customBrief: order.customBrief?.trim() || undefined,
      scope: order.scope ?? 'current-page',
      viewport: normalizeViewport(order.viewport),
      screenshot: normalizeScreenshot(order.screenshot),
    },
  )
}

export function buildMotionPrompt(order: MotionWorkOrder): string {
  const batchId = requireBatchId(order.batchId)
  const preset = MOTION_PRESETS.find(item => item.id === order.preset)
  if (!preset) throw new Error('未知电影化动效预设')
  return prompt(
    '[frontend-motion]',
    '请使用 frontend-page-builder 把动效作为可关闭的渐进增强映射到现有页面。保持静态最终状态完整、键盘路径可用和正文可读；必须实现 prefers-reduced-motion 与移动端降级，并按工单预算验证媒体体积、并行动画和主线程负载。',
    {
      batchId,
      preset,
      target: order.target?.trim().slice(0, 500) || 'current-page',
      intensity: order.intensity ?? 'balanced',
      viewport: normalizeViewport(order.viewport),
      screenshot: normalizeScreenshot(order.screenshot),
    },
  )
}

export function buildRollbackPrompt(order: RollbackWorkOrder): string {
  const batchId = requireBatchId(order.batchId)
  const entries = Object.entries(order.expectedPostHashes ?? {})
  const expectedPostHashes: Record<string, string> = {}
  for (const [rawFile, hash] of entries) {
    const file = rawFile.trim().replaceAll('\\', '/')
    const segments = file.split('/')
    if (!file || file.startsWith('/') || /^[A-Za-z]:/.test(file)
      || segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
      throw new Error(`回滚文件路径无效: ${rawFile}`)
    }
    if (!/^[a-fA-F0-9]{40,128}$/.test(hash)) {
      throw new Error(`回滚文件哈希无效: ${rawFile}`)
    }
    if (expectedPostHashes[file]) throw new Error(`回滚文件路径重复: ${file}`)
    expectedPostHashes[file] = hash.toLowerCase()
  }
  return prompt(
    '[frontend-rollback]',
    '请使用 frontend-page-builder 执行受控批次恢复。读取 .pagecraft/history/<batchId>/manifest.json 和 revert.patch；如果工单未直接提供 expectedPostHashes，则必须从 manifest 读取修改后哈希。逐文件核对当前哈希，只有全部匹配才可应用逆向补丁。任一不匹配即停止自动覆盖并报告冲突。禁止 git reset --hard、清理未跟踪文件或覆盖批次前已有改动。恢复后运行原批次检查并刷新预览。',
    {
      batchId,
      expectedPostHashes,
      ...(entries.length === 0
        ? { expectedPostHashesSource: `.pagecraft/history/${batchId}/manifest.json` }
        : {}),
    },
  )
}
