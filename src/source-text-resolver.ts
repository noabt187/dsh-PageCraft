import { lstat, readFile, readdir } from 'node:fs/promises'
import { basename, extname, relative, resolve, sep } from 'node:path'
import {
  parseSourceTextCandidates,
  type SourceTextCandidate,
} from './source-text-parsers.ts'
import { resolveWorkspaceTarget } from './workspace-explorer.ts'
import { isWorkspaceTextFile } from './workspace.ts'
import type { DomTextSelection } from './workspace.ts'

export interface ResolvedSourceText extends SourceTextCandidate {
  confidence: 'high'
  replacement: string
}

export interface SourceTextResolverOptions {
  maxFiles?: number
  maxTotalBytes?: number
  maxFileBytes?: number
  timeoutMs?: number
}

interface IndexedSource {
  path: string
  absolutePath: string
  source: string
  candidates: SourceTextCandidate[]
}

interface RankedCandidate {
  candidate: SourceTextCandidate
  source: string
  score: number
}

const DEFAULT_MAX_FILES = 2_000
const DEFAULT_MAX_TOTAL_BYTES = 20 * 1024 * 1024
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 1_500
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.nuxt',
  'build',
  'coverage',
  'dist',
  'node_modules',
])

export class SourceTextResolverError extends Error {
  override readonly name = 'SourceTextResolverError'

  constructor(
    message: string,
    readonly code: 'TEXT_SOURCE_NOT_FOUND' | 'TEXT_SOURCE_AMBIGUOUS' | 'TEXT_SOURCE_DYNAMIC' | 'TEXT_SOURCE_LIMIT' | 'TEXT_SOURCE_OUTSIDE_FOLDER',
    readonly status = 409,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function relativePath(root: string, target: string): string {
  const path = relative(root, target).split(sep).join('/')
  return path.length === 0 ? '.' : path
}

function isIgnoredPath(path: string): boolean {
  const segments = path.split('/')
  if (segments.includes('.pagecraft') && segments.includes('workspace-history')) return true
  return segments.some(segment => IGNORED_DIRECTORIES.has(segment))
}

function isGeneratedFile(path: string): boolean {
  const name = basename(path).toLowerCase()
  return name.endsWith('.min.js') || name.endsWith('.min.css') || name.endsWith('.map')
}

function deadlineGuard(deadline: number): void {
  if (Date.now() > deadline) {
    throw new SourceTextResolverError('源码定位超时，没有修改任何文件', 'TEXT_SOURCE_LIMIT', 413)
  }
}

async function collectSources(
  root: string,
  start: string,
  deadline: number,
  options: Required<SourceTextResolverOptions>,
  excludedRoot?: string,
): Promise<IndexedSource[]> {
  const sources: IndexedSource[] = []
  let fileCount = 0
  let totalBytes = 0

  async function visit(directory: string): Promise<void> {
    deadlineGuard(deadline)
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      deadlineGuard(deadline)
      const absolutePath = resolve(directory, entry.name)
      if (excludedRoot !== undefined && (absolutePath === excludedRoot || absolutePath.startsWith(`${excludedRoot}${sep}`))) continue
      const path = relativePath(root, absolutePath)
      if (isIgnoredPath(path)) continue
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await visit(absolutePath)
        continue
      }
      if (!entry.isFile() || !isWorkspaceTextFile(path) || isGeneratedFile(path)) continue
      fileCount += 1
      if (fileCount > options.maxFiles) {
        throw new SourceTextResolverError('打开的文件夹过大，源码定位已安全停止', 'TEXT_SOURCE_LIMIT', 413)
      }
      const metadata = await lstat(absolutePath)
      if (metadata.size > options.maxFileBytes) continue
      totalBytes += metadata.size
      if (totalBytes > options.maxTotalBytes) {
        throw new SourceTextResolverError('可索引的源码总量超过限制，源码定位已安全停止', 'TEXT_SOURCE_LIMIT', 413)
      }
      const body = await readFile(absolutePath)
      if (body.includes(0)) continue
      const source = body.toString('utf8')
      sources.push({
        path,
        absolutePath,
        source,
        candidates: parseSourceTextCandidates(path, source),
      })
    }
  }

  await visit(start)
  return sources
}

function routeStem(pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl)
    const segment = url.pathname.split('/').filter(Boolean).at(-1)
    if (segment === undefined) return null
    return segment.replace(/\.[^.]+$/, '').toLowerCase()
  } catch {
    return null
  }
}

function fileStem(path: string): string {
  return basename(path, extname(path)).toLowerCase()
}

function textKeyField(textKey: string | undefined): string | null {
  if (textKey === undefined) return null
  return textKey.split('.').filter(Boolean).at(-1)?.replace(/\[\d+\]$/, '') ?? null
}

function isExplicitDeckCandidate(candidate: SourceTextCandidate, selection: DomTextSelection, source: string): boolean {
  if (selection.textKey === undefined || candidate.kind !== 'json-value' || candidate.propertyPath === undefined) return false
  const field = textKeyField(selection.textKey)
  if (field === null || candidate.propertyPath.at(-1) !== field) return false
  if (selection.slideId === undefined) return true
  const parentPath = candidate.propertyPath.slice(0, -1)
  try {
    let value: unknown = JSON.parse(source)
    for (const segment of parentPath) {
      if (value === null || typeof value !== 'object') return false
      value = (value as Record<string, unknown>)[segment]
    }
    return value !== null && typeof value === 'object' && (value as Record<string, unknown>).id === selection.slideId
  } catch {
    return source.includes(selection.slideId)
  }
}

function rankCandidate(
  candidate: SourceTextCandidate,
  source: string,
  selection: DomTextSelection,
): RankedCandidate | null {
  if (normalizeText(candidate.value) !== normalizeText(selection.displayedText)) return null
  if (isExplicitDeckCandidate(candidate, selection, source)) {
    return { candidate, source, score: 200 }
  }

  let score = 80
  if (candidate.tagName !== undefined && candidate.tagName === selection.tagName.toLowerCase()) score += 30
  const selectionAttributeNames = Object.keys(selection.attributes).map(name => name === 'className' ? 'class' : name.toLowerCase())
  if (selectionAttributeNames.some(name => candidate.attributeNames.includes(name))) score += 15
  const stem = routeStem(selection.pageUrl)
  if (stem !== null && fileStem(candidate.path) === stem) score += 25
  if (selection.slideId !== undefined && source.includes(selection.slideId)) score += 20
  if (selection.nearbyText.some(text => text.length > 0 && source.includes(text))) score += 10
  return { candidate, source, score }
}

function chooseUnique(matches: RankedCandidate[]): ResolvedSourceText {
  const sorted = matches.sort((left, right) => right.score - left.score || left.candidate.path.localeCompare(right.candidate.path))
  const first = sorted[0]
  if (first === undefined) {
    throw new SourceTextResolverError('没有在打开的文件夹中找到这段文字的安全源码位置', 'TEXT_SOURCE_NOT_FOUND', 404)
  }
  const second = sorted[1]
  if (first.score < 80 || (second !== undefined && first.score - second.score < 20)) {
    throw new SourceTextResolverError('有多个源码位置都可能生成这段文字，PageCraft 没有猜测或修改文件', 'TEXT_SOURCE_AMBIGUOUS')
  }
  return {
    ...first.candidate,
    confidence: 'high',
    replacement: first.source.slice(first.candidate.start, first.candidate.end),
  }
}

function isRouteRelated(path: string, selection: DomTextSelection): boolean {
  const stem = routeStem(selection.pageUrl)
  return stem !== null && fileStem(path) === stem
}

function hasDynamicVisibleText(source: string): boolean {
  return /<\s*[a-zA-Z][^>]*>\s*\{\s*(?:[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*|[a-zA-Z_$][\w$]*\([^)]*\))\s*\}\s*<\//.test(source)
    || /\{\{\s*[^}'"`]+\s*\}\}/.test(source)
}

function resolverOptions(options: SourceTextResolverOptions): Required<SourceTextResolverOptions> {
  return {
    maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
    maxTotalBytes: options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
    maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  }
}

export async function resolveDomTextSource(
  cwd: string,
  selectedFolder: string,
  selection: DomTextSelection,
  options: SourceTextResolverOptions = {},
): Promise<ResolvedSourceText> {
  const visibleText = normalizeText(selection.displayedText)
  if (visibleText.length === 0) {
    throw new SourceTextResolverError('空白内容不能自动追踪到源码', 'TEXT_SOURCE_NOT_FOUND', 404)
  }
  const limits = resolverOptions(options)
  const deadline = Date.now() + limits.timeoutMs
  const resolvedRoot = await resolveWorkspaceTarget(cwd, selectedFolder, selectedFolder, true)
  const sources = await collectSources(resolvedRoot.root, resolvedRoot.selectedRoot, deadline, limits)
  const matches = sources.flatMap(indexed => indexed.candidates.flatMap(candidate => {
    const ranked = rankCandidate(candidate, indexed.source, selection)
    return ranked === null ? [] : [ranked]
  }))

  if (matches.length > 0) return chooseUnique(matches)

  if (sources.some(indexed => isRouteRelated(indexed.path, selection) && hasDynamicVisibleText(indexed.source))) {
    throw new SourceTextResolverError('这段文字由运行时数据生成，PageCraft 没有直接修改本地源码', 'TEXT_SOURCE_DYNAMIC')
  }

  if (resolvedRoot.selectedRoot !== resolvedRoot.root) {
    const outsideSources = await collectSources(
      resolvedRoot.root,
      resolvedRoot.root,
      deadline,
      limits,
      resolvedRoot.selectedRoot,
    )
    const outsideMatches = outsideSources.flatMap(indexed => indexed.candidates.filter(candidate => {
      return normalizeText(candidate.value) === visibleText
    }))
    if (outsideMatches.length > 0) {
      throw new SourceTextResolverError(
        '源码位于当前打开文件夹之外，请打开它的父文件夹后重试',
        'TEXT_SOURCE_OUTSIDE_FOLDER',
        403,
        { paths: [...new Set(outsideMatches.map(candidate => candidate.path))].slice(0, 5) },
      )
    }
  }

  throw new SourceTextResolverError('没有找到能安全修改的本地源码，这段文字可能来自接口、运行时或生成文件', 'TEXT_SOURCE_NOT_FOUND', 404)
}
