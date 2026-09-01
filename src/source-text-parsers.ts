import { parse as parseJavaScript } from '@babel/parser'
import { parseTree, type Node as JsonNode } from 'jsonc-parser'
import { parseFragment } from 'parse5'

export type SourceTextKind = 'markup-text' | 'string-literal' | 'json-value' | 'markdown-text'

export interface SourceTextCandidate {
  path: string
  kind: SourceTextKind
  value: string
  start: number
  end: number
  line: number
  tagName?: string
  attributeNames: string[]
  propertyPath?: string[]
  importSource?: string
  symbolName?: string
  sourceStyle?: 'html' | 'jsx-text' | 'single-quoted' | 'double-quoted' | 'template' | 'json' | 'markdown'
}

interface MarkupNode {
  nodeName?: string
  tagName?: string
  value?: string
  attrs?: Array<{ name: string; value: string }>
  childNodes?: MarkupNode[]
  content?: MarkupNode
  sourceCodeLocation?: {
    startOffset?: number
    endOffset?: number
  }
}

interface BabelNode {
  type: string
  start: number | null
  end: number | null
  [key: string]: unknown
}

interface StringBinding {
  value: string
  start: number
  end: number
  style: SourceTextCandidate['sourceStyle']
}

const SCRIPT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'])
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdx'])

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot).toLowerCase()
}

function sourceLine(source: string, offset: number): number {
  let line = 1
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1
  }
  return line
}

function normalizedVisibleText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function trimmedTextRange(source: string, start: number, end: number): { start: number; end: number } {
  const raw = source.slice(start, end)
  const leading = raw.match(/^\s*/)?.[0].length ?? 0
  const trailing = raw.match(/\s*$/)?.[0].length ?? 0
  return { start: start + leading, end: Math.max(start + leading, end - trailing) }
}

function quoteStyle(source: string, start: number): SourceTextCandidate['sourceStyle'] {
  const quote = source[start]
  if (quote === "'") return 'single-quoted'
  if (quote === '`') return 'template'
  return 'double-quoted'
}

function stringRange(node: BabelNode, source: string): StringBinding | null {
  if (node.start === null || node.end === null) return null
  if (node.type === 'StringLiteral') {
    return {
      value: String((node as unknown as { value: string }).value),
      start: node.start + 1,
      end: node.end - 1,
      style: quoteStyle(source, node.start),
    }
  }
  if (node.type === 'TemplateLiteral') {
    const template = node as unknown as { expressions: unknown[]; quasis: Array<{ value: { cooked?: string | null }; start: number | null; end: number | null }> }
    if (template.expressions.length > 0 || template.quasis.length !== 1) return null
    const quasi = template.quasis[0]
    if (quasi?.start === null || quasi?.start === undefined || quasi.end === null) return null
    return {
      value: quasi.value.cooked ?? source.slice(quasi.start, quasi.end),
      start: quasi.start,
      end: quasi.end,
      style: 'template',
    }
  }
  return null
}

function walkBabel(node: unknown, visit: (node: BabelNode, parent: BabelNode | null) => void, parent: BabelNode | null = null): void {
  if (node === null || typeof node !== 'object') return
  const candidate = node as Partial<BabelNode>
  if (typeof candidate.type === 'string') {
    visit(candidate as BabelNode, parent)
    for (const [key, value] of Object.entries(candidate)) {
      if (key === 'loc' || key === 'extra' || key === 'comments' || key === 'tokens') continue
      if (Array.isArray(value)) {
        for (const child of value) walkBabel(child, visit, candidate as BabelNode)
      } else {
        walkBabel(value, visit, candidate as BabelNode)
      }
    }
    return
  }
  for (const value of Object.values(candidate)) walkBabel(value, visit, parent)
}

function jsxName(node: unknown): string | undefined {
  if (node === null || typeof node !== 'object') return undefined
  const value = node as { type?: string; name?: unknown }
  return value.type === 'JSXIdentifier' && typeof value.name === 'string' ? value.name.toLowerCase() : undefined
}

function jsxAttributes(node: BabelNode): string[] {
  const attributes = (node as unknown as { attributes?: Array<{ type?: string; name?: { name?: unknown } }> }).attributes ?? []
  return attributes.flatMap(attribute => {
    if (attribute.type !== 'JSXAttribute' || typeof attribute.name?.name !== 'string') return []
    return [attribute.name.name === 'className' ? 'class' : attribute.name.name]
  })
}

function openingElement(parent: BabelNode | null): BabelNode | null {
  if (parent?.type === 'JSXElement') {
    return (parent as unknown as { openingElement: BabelNode }).openingElement
  }
  return null
}

function parseJavaScriptCandidates(path: string, source: string): SourceTextCandidate[] {
  const ast = parseJavaScript(source, {
    sourceType: 'unambiguous',
    errorRecovery: true,
    plugins: ['typescript', 'jsx', 'decorators-legacy', 'importAttributes'],
  })
  const bindings = new Map<string, StringBinding>()
  walkBabel(ast, (node, parent) => {
    if (node.type !== 'VariableDeclarator') return
    const declaration = node as unknown as { id: { type?: string; name?: string }; init?: BabelNode | null }
    if (declaration.id.type !== 'Identifier' || typeof declaration.id.name !== 'string' || declaration.init === null || declaration.init === undefined) return
    const value = stringRange(declaration.init, source)
    if (value !== null) bindings.set(declaration.id.name, value)
  })

  const candidates: SourceTextCandidate[] = []
  const seen = new Set<string>()
  function push(binding: StringBinding, tagName: string | undefined, attributeNames: string[], symbolName?: string): void {
    const value = normalizedVisibleText(binding.value)
    if (value.length === 0) return
    const range = binding.style === 'jsx-text'
      ? trimmedTextRange(source, binding.start, binding.end)
      : { start: binding.start, end: binding.end }
    const key = `${range.start}:${range.end}:${tagName ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    candidates.push({
      path,
      kind: binding.style === 'jsx-text' ? 'markup-text' : 'string-literal',
      value,
      start: range.start,
      end: range.end,
      line: sourceLine(source, range.start),
      tagName,
      attributeNames,
      ...(symbolName === undefined ? {} : { symbolName }),
      sourceStyle: binding.style,
    })
  }

  walkBabel(ast, (node, parent) => {
    if (node.type === 'JSXText' && node.start !== null && node.end !== null) {
      const element = openingElement(parent)
      push({
        value: source.slice(node.start, node.end),
        start: node.start,
        end: node.end,
        style: 'jsx-text',
      }, jsxName((element as unknown as { name?: unknown } | null)?.name), element === null ? [] : jsxAttributes(element))
      return
    }
    if (node.type !== 'JSXExpressionContainer' || parent?.type !== 'JSXElement') return
    const expression = (node as unknown as { expression?: BabelNode }).expression
    if (expression === undefined) return
    const element = openingElement(parent)
    const tagName = jsxName((element as unknown as { name?: unknown } | null)?.name)
    const attributeNames = element === null ? [] : jsxAttributes(element)
    const direct = stringRange(expression, source)
    if (direct !== null) {
      push(direct, tagName, attributeNames)
      return
    }
    if (expression.type === 'Identifier') {
      const symbolName = (expression as unknown as { name?: string }).name
      const binding = symbolName === undefined ? undefined : bindings.get(symbolName)
      if (binding !== undefined) push(binding, tagName, attributeNames, symbolName)
    }
  })
  return candidates
}

function parseMarkupCandidates(path: string, source: string): SourceTextCandidate[] {
  const document = parseFragment(source, { sourceCodeLocationInfo: true }) as unknown as MarkupNode
  const candidates: SourceTextCandidate[] = []

  function visit(node: MarkupNode, parent: MarkupNode | null): void {
    const parentTag = parent?.tagName?.toLowerCase()
    if (node.nodeName === '#text' && parentTag !== 'script' && parentTag !== 'style') {
      const start = node.sourceCodeLocation?.startOffset
      const end = node.sourceCodeLocation?.endOffset
      const value = normalizedVisibleText(node.value ?? '')
      if (start !== undefined && end !== undefined && value.length > 0) {
        const range = trimmedTextRange(source, start, end)
        candidates.push({
          path,
          kind: 'markup-text',
          value,
          start: range.start,
          end: range.end,
          line: sourceLine(source, range.start),
          tagName: parentTag,
          attributeNames: parent?.attrs?.map(attribute => attribute.name === 'classname' ? 'class' : attribute.name) ?? [],
          sourceStyle: 'html',
        })
      }
    }
    for (const child of node.childNodes ?? []) visit(child, node)
    if (node.content !== undefined) visit(node.content, node)
  }

  visit(document, null)
  return candidates
}

function parseJsonCandidates(path: string, source: string): SourceTextCandidate[] {
  const root = parseTree(source)
  if (root === undefined) return []
  const candidates: SourceTextCandidate[] = []

  function visit(node: JsonNode, propertyPath: string[]): void {
    if (node.type === 'object') {
      for (const property of node.children ?? []) {
        const [key, value] = property.children ?? []
        if (key?.type !== 'string' || value === undefined) continue
        visit(value, [...propertyPath, String(key.value)])
      }
      return
    }
    if (node.type === 'array') {
      for (const [index, child] of (node.children ?? []).entries()) visit(child, [...propertyPath, String(index)])
      return
    }
    if (node.type !== 'string') return
    const start = node.offset + 1
    const end = node.offset + node.length - 1
    candidates.push({
      path,
      kind: 'json-value',
      value: String(node.value),
      start,
      end,
      line: sourceLine(source, start),
      attributeNames: [],
      propertyPath,
      sourceStyle: 'json',
    })
  }

  visit(root, [])
  return candidates
}

function parseMarkdownCandidates(path: string, source: string): SourceTextCandidate[] {
  const candidates: SourceTextCandidate[] = []
  let offset = 0
  let fenced = false
  let frontMatter = source.startsWith('---\n') || source.startsWith('---\r\n')
  for (const [index, rawLine] of source.split(/(?<=\n)/).entries()) {
    const line = rawLine.replace(/\r?\n$/, '')
    const trimmed = line.trim()
    if (index === 0 && frontMatter) {
      offset += rawLine.length
      continue
    }
    if (frontMatter) {
      if (trimmed === '---') frontMatter = false
      offset += rawLine.length
      continue
    }
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      offset += rawLine.length
      continue
    }
    if (!fenced && trimmed.length > 0 && !/^\s*(?:!\[|\[.*\]:)/.test(line)) {
      const prefix = line.match(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)?/)?.[0] ?? ''
      const visible = line.slice(prefix.length).trimEnd()
      if (visible.length > 0 && !visible.includes('`')) {
        const start = offset + prefix.length
        candidates.push({
          path,
          kind: 'markdown-text',
          value: normalizedVisibleText(visible.replace(/\[(.*?)\]\([^)]*\)/g, '$1')),
          start,
          end: start + visible.length,
          line: index + 1,
          attributeNames: [],
          sourceStyle: 'markdown',
        })
      }
    }
    offset += rawLine.length
  }
  return candidates
}

function embeddedScripts(path: string, source: string): SourceTextCandidate[] {
  const candidates: SourceTextCandidate[] = []
  const scriptPattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi
  for (const match of source.matchAll(scriptPattern)) {
    if (match.index === undefined) continue
    const body = match[1] ?? ''
    const bodyOffset = match.index + match[0].indexOf(body)
    try {
      for (const candidate of parseJavaScriptCandidates(path, body)) {
        candidates.push({
          ...candidate,
          start: candidate.start + bodyOffset,
          end: candidate.end + bodyOffset,
          line: sourceLine(source, candidate.start + bodyOffset),
        })
      }
    } catch {
      // A malformed embedded script should not hide safely parseable template text.
    }
  }
  return candidates
}

export function parseSourceTextCandidates(path: string, source: string): SourceTextCandidate[] {
  const extension = extensionOf(path)
  try {
    if (extension === '.json' || extension === '.jsonc') return parseJsonCandidates(path, source)
    if (MARKDOWN_EXTENSIONS.has(extension)) return parseMarkdownCandidates(path, source)
    if (SCRIPT_EXTENSIONS.has(extension)) return parseJavaScriptCandidates(path, source)
    if (extension === '.vue' || extension === '.svelte') {
      return [...parseMarkupCandidates(path, source), ...embeddedScripts(path, source)]
    }
    if (extension === '.html' || extension === '.htm' || extension === '.svg' || extension === '.xml') {
      return parseMarkupCandidates(path, source)
    }
  } catch {
    return []
  }
  return []
}

function escapeHtmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapeJavaScript(value: string, quote: "'" | '"' | '`'): string {
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
  if (quote === '`') return escaped.replaceAll('`', '\\`').replaceAll('${', '\\${')
  return escaped.replaceAll(quote, `\\${quote}`)
}

export function encodeSourceTextReplacement(candidate: SourceTextCandidate, replacementText: string): string {
  if (candidate.sourceStyle === 'html') return escapeHtmlText(replacementText)
  if (candidate.sourceStyle === 'jsx-text') return escapeHtmlText(replacementText)
  if (candidate.sourceStyle === 'single-quoted') return escapeJavaScript(replacementText, "'")
  if (candidate.sourceStyle === 'template') return escapeJavaScript(replacementText, '`')
  if (candidate.sourceStyle === 'double-quoted') return escapeJavaScript(replacementText, '"')
  if (candidate.sourceStyle === 'json') return JSON.stringify(replacementText).slice(1, -1)
  return replacementText
}
