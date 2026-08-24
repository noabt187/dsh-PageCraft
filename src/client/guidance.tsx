import { useMemo } from 'react'
import { applyGuidanceDraft, buildGuidanceSuggestions, toggleConstraint } from '../guidance.ts'
import type { GuidanceContext } from '../guidance.ts'
import type { FeedbackSelection } from '../shared.ts'

interface GuidanceEditorProps {
  selection: FeedbackSelection
  context: GuidanceContext
  value: string
  onChange(value: string): void
  onQueue(): void
}

export function GuidanceEditor({ selection, context, value, onChange, onQueue }: GuidanceEditorProps) {
  const model = useMemo(
    () => buildGuidanceSuggestions(selection, context),
    [context.areaOperation, context.scope, context.viewport.height, context.viewport.id, context.viewport.label, context.viewport.width, selection],
  )
  return (
    <div style={styles.editor}>
      <div style={styles.intro}>
        <div>
          <strong style={styles.title}>{model.title}</strong>
          <span style={styles.target}>当前目标：{model.target}</span>
        </div>
        <span style={styles.tip}>点击建议会生成草稿，你仍可自由修改</span>
      </div>
      <div role="group" aria-label="快捷修改建议" style={styles.suggestions}>
        {model.suggestions.map(suggestion => (
          <button
            key={suggestion.id}
            type="button"
            onClick={() => onChange(applyGuidanceDraft(value, suggestion.draft))}
            title={suggestion.description}
            style={styles.suggestion}
          >
            <strong>{suggestion.label}</strong>
            <span>{suggestion.description}</span>
          </button>
        ))}
      </div>
      <textarea
        autoFocus
        aria-label="修改要求"
        value={value}
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') onQueue()
        }}
        placeholder="可以直接描述结果，或点击上方建议生成一份完整草稿…"
        style={styles.textarea}
      />
      <div style={styles.constraintRow}>
        <span style={styles.constraintLabel}>常用约束</span>
        {model.constraints.map(constraint => (
          <button
            key={constraint}
            type="button"
            aria-pressed={value.includes(constraint)}
            onClick={() => onChange(toggleConstraint(value, constraint))}
            style={{ ...styles.constraint, ...(value.includes(constraint) ? styles.constraintActive : {}) }}
          >+ {constraint}</button>
        ))}
      </div>
      <span style={styles.keyboard}>Ctrl / ⌘ + Enter 加入队列；草稿不会自动发送</span>
    </div>
  )
}

const styles: Record<string, any> = {
  editor: { display: 'grid', gap: 9, marginTop: 10 },
  intro: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  title: { display: 'block', color: '#edf5ef', fontSize: 12 },
  target: { display: 'block', maxWidth: 220, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#9aac9f', fontSize: 9 },
  tip: { maxWidth: 105, color: '#86a992', fontSize: 9, lineHeight: 1.35, textAlign: 'right' },
  suggestions: { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 6 },
  suggestion: { minWidth: 0, minHeight: 54, display: 'grid', gap: 3, alignContent: 'center', padding: '7px 8px', border: '1px solid #34483c', borderRadius: 8, color: '#dfeae3', background: '#111a16', textAlign: 'left', cursor: 'pointer', fontSize: 10 },
  textarea: { width: '100%', minHeight: 106, resize: 'vertical', boxSizing: 'border-box', padding: 10, border: '1px solid #42604e', borderRadius: 8, color: '#edf5ef', background: '#0c1210', font: '12px/1.55 inherit', outline: 'none' },
  constraintRow: { display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' },
  constraintLabel: { width: '100%', color: '#9aac9f', fontSize: 9 },
  constraint: { minHeight: 25, padding: '3px 7px', border: '1px solid #34463c', borderRadius: 99, color: '#9eb0a4', background: '#111815', cursor: 'pointer', fontSize: 9 },
  constraintActive: { borderColor: '#6b9e78', color: '#ccebd4', background: '#1b2c22' },
  keyboard: { color: '#708178', fontSize: 8 },
}
