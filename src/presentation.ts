export type PageCraftMode = 'webpage' | 'presentation'
export type PresentationColorMode = 'light' | 'inherit' | 'dark'

export interface PresentationBrief {
  title: string
  audience: string
  goal: string
  slideCount: number
  style: string
  colorMode: PresentationColorMode
  requirements: string
}

export interface PresentationSlideSummary {
  id: string
  title: string
  index: number
}

export const DEFAULT_PRESENTATION_BRIEF: PresentationBrief = {
  title: '',
  audience: '',
  goal: '',
  slideCount: 8,
  style: 'editorial',
  colorMode: 'light',
  requirements: '',
}

export function buildPresentationCreationPrompt(brief: PresentationBrief): string {
  const title = brief.title.trim()
  if (title.length === 0) throw new Error('演示文稿标题不能为空')
  const slideCount = Math.min(30, Math.max(3, Math.round(brief.slideCount)))
  return [
    '[presentation-create]',
    '请使用 presentation-builder Skill，在当前工作区创建一套可在浏览器中运行和评注的 HTML/React 演示文稿。',
    '先检查现有项目和依赖，再建立 deck.json（内容单一来源）与渲染页面；不要把全部内容硬编码进一个无法维护的 HTML 字符串。',
    '每张幻灯片的根元素必须带 data-pagecraft-slide-id 和 data-pagecraft-slide-title，所有幻灯片应保留在 DOM 中，以便 PageCraft 发现、切换和评注。',
    '使用统一主题、设计变量和可复用布局组件。完成后运行必要检查，启动或说明本地预览命令，并明确给出预览 URL。',
    brief.colorMode === 'light'
      ? '本次默认使用浅色设计：使用明亮画布、深色正文和克制的品牌强调色；不要使用大面积黑色/深蓝背景、蓝紫渐变、霓虹发光或玻璃拟态。'
      : brief.colorMode === 'dark'
        ? '本次明确使用深色设计，但仍需避免廉价的蓝紫渐变、过度发光和满屏玻璃卡片。'
        : '颜色模式应继承当前项目已经存在的品牌主题，不要另行套用通用 AI 科技风。',
    '',
    JSON.stringify({
      presentation: {
        title,
        audience: brief.audience.trim(),
        goal: brief.goal.trim(),
        slideCount,
        style: brief.style,
        colorMode: brief.colorMode,
        requirements: brief.requirements.trim(),
      },
    }),
  ].join('\n')
}

export function isPresentationSlideSummary(value: unknown): value is PresentationSlideSummary {
  if (value === null || typeof value !== 'object') return false
  const item = value as Partial<PresentationSlideSummary>
  return typeof item.id === 'string'
    && item.id.length > 0
    && typeof item.title === 'string'
    && Number.isInteger(item.index)
    && Number(item.index) >= 0
}

export function resolvePresentationSlides(value: unknown): PresentationSlideSummary[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value
    .filter(isPresentationSlideSummary)
    .filter((slide) => {
      if (seen.has(slide.id)) return false
      seen.add(slide.id)
      return true
    })
    .slice(0, 100)
}
