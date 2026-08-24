import type { AreaOperation, FeedbackSelection, ResponsiveScope } from './shared.ts'

export type GuidanceCategory = 'action' | 'text' | 'form' | 'container' | 'media' | 'area' | 'generic'

export interface GuidanceContext {
  viewport: { id: string; label?: string; width: number; height: number }
  scope: ResponsiveScope
  areaOperation?: AreaOperation
}

export interface GuidanceSuggestion {
  id: string
  label: string
  description: string
  draft: string
}

export interface GuidanceModel {
  category: GuidanceCategory
  title: string
  target: string
  suggestions: readonly GuidanceSuggestion[]
  constraints: readonly string[]
}

function clean(value: string | undefined, max = 54): string {
  return (value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

export function classifySelection(selection: FeedbackSelection): GuidanceCategory {
  if (selection.kind === 'area') return 'area'
  const tag = selection.tagName.toLowerCase()
  const evidence = `${tag} ${selection.selector} ${selection.html ?? ''}`.toLowerCase()
  if (/^(button|a)$/.test(tag) || /role=["']?(button|link)|nav|menu/.test(evidence)) return 'action'
  if (/^(h[1-6]|p|span|label|strong|em|blockquote)$/.test(tag)) return 'text'
  if (/^(input|textarea|select|option|form)$/.test(tag) || /role=["']?(textbox|combobox|checkbox|radio)/.test(evidence)) return 'form'
  if (/^(img|video|picture|svg|canvas|figure)$/.test(tag)) return 'media'
  if (/^(div|section|article|main|aside|header|footer|ul|ol|li|table|tr|td)$/.test(tag)) return 'container'
  return 'generic'
}

function scopeText(scope: ResponsiveScope, viewport: GuidanceContext['viewport']): string {
  const point = `${viewport.label ?? viewport.id}（${viewport.width}×${viewport.height}）`
  if (scope === 'current-breakpoint') return `仅作用于当前 ${point} 断点`
  if (scope === 'current-and-smaller') return `作用于 ${point} 及更小断点`
  return '适配全部响应式断点'
}

function targetText(selection: FeedbackSelection): string {
  if (selection.kind === 'area') return `框选区域 ${selection.rect.width}×${selection.rect.height}px`
  return clean(selection.text) || clean(selection.selector) || selection.tagName.toUpperCase()
}

function draftPrefix(selection: FeedbackSelection): string {
  if (selection.kind === 'area') return '在当前框选区域'
  const target = targetText(selection)
  return `将“${target}”`
}

const TITLES: Record<GuidanceCategory, string> = {
  action: '你想怎样调整这个操作元素？',
  text: '你想怎样修改这段内容？',
  form: '你想怎样优化这个表单控件？',
  container: '你想怎样调整这组内容？',
  media: '你想怎样处理这个媒体元素？',
  area: '你想在这个区域做什么？',
  generic: '描述你希望看到的修改',
}

export function buildGuidanceSuggestions(selection: FeedbackSelection, context: GuidanceContext): GuidanceModel {
  const category = classifySelection(selection)
  const prefix = draftPrefix(selection)
  const scope = scopeText(context.scope, context.viewport)
  const operation = context.areaOperation === 'overlay'
    ? '以覆盖层方式呈现，不推开现有内容'
    : context.areaOperation === 'replace'
      ? '替换框内现有内容并保持周围布局稳定'
      : '使用正常文档流插入，并自然推开后续内容'
  const suggestions: Record<GuidanceCategory, readonly GuidanceSuggestion[]> = {
    action: [
      { id: 'content', label: '修改文案', description: '改文字但保留点击逻辑', draft: `${prefix}的文案改为“填写新文案”，保留现有点击逻辑、图标和状态反馈；${scope}。` },
      { id: 'visual', label: '突出主操作', description: '增强层级和可点击感', draft: `${prefix}调整为更明确的主操作样式，强化对比度、悬停和按下反馈，同时保持现有设计语言；${scope}。` },
      { id: 'layout', label: '调整尺寸位置', description: '优化尺寸、间距和对齐', draft: `${prefix}调整尺寸、内边距和对齐方式，避免文字溢出并保持邻近元素间距一致；${scope}。` },
      { id: 'interaction', label: '增加交互', description: '补充反馈或轻量动效', draft: `${prefix}增加清晰的加载、成功和失败反馈，并加入克制的交互动效；保留现有业务逻辑；${scope}。` },
    ],
    text: [
      { id: 'content', label: '重写内容', description: '改写为更清晰的中文', draft: `${prefix}改写为“填写新内容”，语气清晰简洁，保持原有信息层级；${scope}。` },
      { id: 'visual', label: '优化排版', description: '调整字号、行高与对比度', draft: `${prefix}优化字号、字重、行高和颜色对比度，使内容更易扫读；保持当前设计语言；${scope}。` },
      { id: 'layout', label: '限制与截断', description: '处理长文本和溢出', draft: `${prefix}设置合理宽度和长文本换行策略，避免遮挡相邻内容；${scope}。` },
      { id: 'interaction', label: '展开阅读', description: '为长内容增加展开收起', draft: `${prefix}在内容过长时提供“展开/收起”，默认保持页面紧凑并支持键盘操作；${scope}。` },
    ],
    form: [
      { id: 'content', label: '完善提示', description: '标签、占位和帮助文字', draft: `${prefix}补充清晰的字段标签、占位示例和帮助文字，不改变当前数据字段；${scope}。` },
      { id: 'visual', label: '统一控件样式', description: '统一边框、焦点与状态', draft: `${prefix}统一边框、圆角、间距与焦点样式，并保证错误状态可辨识；${scope}。` },
      { id: 'layout', label: '优化表单布局', description: '改善标签和控件对齐', draft: `${prefix}调整标签与控件的对齐和间距，小屏改为纵向排列且不产生横向滚动；${scope}。` },
      { id: 'interaction', label: '增加校验反馈', description: '补充校验和提交状态', draft: `${prefix}增加即时但不打扰的校验反馈，并保留现有提交逻辑和字段名称；${scope}。` },
    ],
    container: [
      { id: 'content', label: '调整内容层级', description: '重组标题、正文与操作', draft: `${prefix}重新梳理标题、说明和操作区的信息层级，不删除现有业务内容；${scope}。` },
      { id: 'visual', label: '优化卡片视觉', description: '改善背景、边框和层次', draft: `${prefix}优化背景、边框、阴影和留白，增强分组层次但保持当前设计语言；${scope}。` },
      { id: 'layout', label: '重新布局', description: '调整网格、对齐和间距', draft: `${prefix}重新组织为稳定的网格或弹性布局，统一间距与对齐；${scope}。` },
      { id: 'interaction', label: '增加折叠筛选', description: '按内容补充轻交互', draft: `${prefix}根据内容增加折叠、筛选或切换交互，并提供明确的当前状态；${scope}。` },
    ],
    media: [
      { id: 'content', label: '替换素材', description: '更换图片、视频或图标', draft: `${prefix}替换为“描述新素材”，保持正确宽高比并补充可访问文本；${scope}。` },
      { id: 'visual', label: '优化呈现', description: '裁切、圆角和背景处理', draft: `${prefix}优化裁切、圆角、背景和加载占位，避免拉伸变形；${scope}。` },
      { id: 'layout', label: '调整尺寸位置', description: '控制比例和响应式尺寸', draft: `${prefix}调整尺寸和位置，在不同宽度下保持主体清晰且不溢出容器；${scope}。` },
      { id: 'interaction', label: '增加查看交互', description: '预览、播放或放大', draft: `${prefix}增加符合类型的预览、播放或放大交互，并支持键盘与减少动态效果设置；${scope}。` },
    ],
    area: [
      { id: 'content', label: '新增内容', description: '在选区中添加新模块', draft: `${prefix}新增“描述模块内容”，${operation}；与周围内容视觉一致，${scope}。` },
      { id: 'visual', label: '增加装饰', description: '添加背景或视觉强调', draft: `${prefix}增加与页面风格一致的背景和视觉强调，${operation}；不遮挡关键内容，${scope}。` },
      { id: 'layout', label: '重新布局', description: '重排框内及邻近元素', draft: `${prefix}重新组织内容布局和间距，${operation}；与参考线和周围元素对齐，${scope}。` },
      { id: 'interaction', label: '加入交互模块', description: '添加面板、筛选或操作区', draft: `${prefix}新增“描述交互模块”，${operation}；包含默认、悬停、加载和错误状态，${scope}。` },
    ],
    generic: [
      { id: 'content', label: '修改内容', description: '改变显示的信息', draft: `${prefix}的内容修改为“填写目标内容”，保留现有业务逻辑；${scope}。` },
      { id: 'visual', label: '调整视觉', description: '优化颜色、字体和层级', draft: `${prefix}优化颜色、字号、间距和视觉层级，保持现有设计语言；${scope}。` },
      { id: 'layout', label: '调整布局', description: '改变尺寸、位置和对齐', draft: `${prefix}调整尺寸、位置和对齐，避免影响相邻内容；${scope}。` },
      { id: 'interaction', label: '增加交互', description: '增加状态和操作反馈', draft: `${prefix}增加明确的操作反馈和必要状态，同时保持现有功能；${scope}。` },
    ],
  }
  return {
    category,
    title: TITLES[category],
    target: targetText(selection),
    suggestions: suggestions[category],
    constraints: [
      '保留现有业务逻辑',
      '不改变数据格式',
      context.scope === 'all-breakpoints' ? '适配全部断点' : '不影响其他断点',
      '保持现有设计语言',
      '完成后进行视觉验证',
    ],
  }
}

export function applyGuidanceDraft(current: string, draft: string): string {
  const existing = current.trim()
  if (existing.length === 0) return draft
  return `${existing}${/[。！？.!?]$/.test(existing) ? '' : '；'}${draft}`
}

export function toggleConstraint(current: string, constraint: string): string {
  if (current.includes(constraint)) return current
  return applyGuidanceDraft(current, constraint)
}
