import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { type TestContext } from 'node:test'
import {
  resolveDomTextSource,
  type DomTextSelection,
} from '../lib/index.js'

async function resolverFixture(t: TestContext, files: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'pagecraft-resolver-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(cwd, ...path.split('/'))
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, content)
  }
  return cwd
}

function selection(displayedText: string, overrides: Partial<DomTextSelection> = {}): DomTextSelection {
  return {
    pageUrl: 'http://localhost:5173/',
    framePath: [],
    selector: 'p',
    fingerprint: `p|${displayedText}`,
    displayedText,
    tagName: 'p',
    attributes: {},
    nearbyText: [],
    ...overrides,
  }
}

test('resolver handles PageCraft keys, JSX constants, Vue, Svelte, HTML, Markdown and JSON', async (t) => {
  const cwd = await resolverFixture(t, {
    'src/deck.json': '{"slides":[{"id":"slide-01","title":"旧标题"}]}\n',
    'src/App.tsx': 'const title = "产品介绍"; export function App(){ return <h1>{title}</h1> }\n',
    'src/Card.vue': '<template><h2>功能概览</h2></template>\n',
    'src/End.svelte': '<h2>谢谢观看</h2>\n',
    'src/index.html': '<p class="lead">欢迎使用</p>\n',
    'src/notes.md': '# 项目背景\n',
    'src/zh-CN.json': '{"hero.title":"智能制造"}\n',
  })

  const keyed = await resolveDomTextSource(
    cwd,
    'src',
    selection('旧标题', { textKey: 'slide-01.title', slideId: 'slide-01' }),
  )
  assert.deepEqual([keyed.path, keyed.kind], ['src/deck.json', 'json-value'])

  const jsx = await resolveDomTextSource(cwd, 'src', selection('产品介绍', { tagName: 'h1' }))
  assert.deepEqual([jsx.path, jsx.kind], ['src/App.tsx', 'string-literal'])

  for (const [text, path] of [
    ['功能概览', 'src/Card.vue'],
    ['谢谢观看', 'src/End.svelte'],
    ['欢迎使用', 'src/index.html'],
    ['项目背景', 'src/notes.md'],
    ['智能制造', 'src/zh-CN.json'],
  ]) {
    assert.equal((await resolveDomTextSource(cwd, 'src', selection(text))).path, path, text)
  }
})

test('resolver refuses ambiguous, dynamic and outside-folder text', async (t) => {
  const cwd = await resolverFixture(t, {
    'src/A.tsx': 'export const A=()=> <p>重复文字</p>\n',
    'src/B.tsx': 'export const B=()=> <p>重复文字</p>\n',
    'src/Api.tsx': 'export const Api=({value})=> <p>{value}</p>\n',
    'outside.tsx': 'export const Outside=()=> <p>外部文字</p>\n',
  })

  await assert.rejects(
    () => resolveDomTextSource(cwd, 'src', selection('重复文字')),
    (error: any) => error.code === 'TEXT_SOURCE_AMBIGUOUS',
  )
  await assert.rejects(
    () => resolveDomTextSource(cwd, 'src', selection('接口文字', {
      pageUrl: 'http://localhost:5173/Api',
      tagName: 'p',
    })),
    (error: any) => error.code === 'TEXT_SOURCE_DYNAMIC',
  )
  await assert.rejects(
    () => resolveDomTextSource(cwd, 'src', selection('外部文字')),
    (error: any) => error.code === 'TEXT_SOURCE_OUTSIDE_FOLDER',
  )
})

test('resolver reports the owning range without rewriting unrelated source', async (t) => {
  const source = 'export function App(){ return <h1 className="hero">旧标题</h1> }\n'
  const cwd = await resolverFixture(t, { 'src/App.tsx': source })
  const resolved = await resolveDomTextSource(cwd, 'src', selection('旧标题', {
    tagName: 'h1',
    attributes: { class: 'hero' },
  }))
  assert.equal(source.slice(resolved.start, resolved.end), '旧标题')
  assert.equal(resolved.line, 1)
})
