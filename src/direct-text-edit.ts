import { randomUUID } from 'node:crypto'
import {
  encodeSourceTextReplacement,
} from './source-text-parsers.ts'
import { resolveDomTextSource } from './source-text-resolver.ts'
import {
  WorkspaceExplorerError,
  readWorkspaceFile,
  saveWorkspaceFile,
} from './workspace-explorer.ts'
import type {
  DirectTextEditResult,
  DirectTextEditStart,
  DirectTextEditVerification,
  DomTextSelection,
  WorkspaceFile,
} from './workspace.ts'

export interface DirectTextEditOptions {
  verificationTimeoutMs?: number
  retentionMs?: number
}

interface PendingDirectTextEdit {
  transactionId: string
  cwd: string
  selectedFolder: string
  path: string
  line: number
  originalContent: string
  originalHash: string
  writtenHash: string
  expectedText: string
  expiresAt: number
}

const DEFAULT_VERIFICATION_TIMEOUT_MS = 8_000
const DEFAULT_RETENTION_MS = 120_000
const MAX_REPLACEMENT_CHARACTERS = 10_000

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function validateReplacementText(value: string): void {
  if (value.length > MAX_REPLACEMENT_CHARACTERS) {
    throw new WorkspaceExplorerError(
      `替换文字不能超过 ${MAX_REPLACEMENT_CHARACTERS} 个字符`,
      413,
      'TEXT_REPLACEMENT_TOO_LARGE',
    )
  }
  if (value.includes('\u0000')) {
    throw new WorkspaceExplorerError('替换文字包含无效字符', 400, 'TEXT_REPLACEMENT_INVALID')
  }
}

function committedResult(transaction: PendingDirectTextEdit, file: WorkspaceFile): DirectTextEditResult {
  return {
    status: 'committed',
    path: transaction.path,
    line: transaction.line,
    message: '文字已写入本地源码，并通过页面验证。',
    file,
  }
}

function conflictResult(transaction: PendingDirectTextEdit): DirectTextEditResult {
  return {
    status: 'conflict',
    path: transaction.path,
    line: transaction.line,
    message: '验证期间文件又被其他程序修改。PageCraft 没有覆盖较新的内容，请检查当前文件。',
  }
}

export class DirectTextEditService {
  private readonly verificationTimeoutMs: number
  private readonly retentionMs: number
  private readonly pending = new Map<string, PendingDirectTextEdit>()
  private readonly sweepTimer: ReturnType<typeof setInterval>

  constructor(options: DirectTextEditOptions = {}) {
    this.verificationTimeoutMs = options.verificationTimeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS
    this.sweepTimer = setInterval(() => {
      void this.sweepExpired()
    }, Math.min(5_000, this.verificationTimeoutMs))
    this.sweepTimer.unref?.()
  }

  async start(
    cwd: string,
    selectedFolder: string,
    selection: DomTextSelection,
    replacementText: string,
  ): Promise<DirectTextEditStart> {
    validateReplacementText(replacementText)
    const target = await resolveDomTextSource(cwd, selectedFolder, selection)
    const original = await readWorkspaceFile(cwd, selectedFolder, target.path)
    const currentRange = original.content.slice(target.start, target.end)
    if (currentRange !== target.replacement) {
      throw new WorkspaceExplorerError(
        '定位完成后源码又发生了变化，请重新选择这段文字',
        409,
        'TEXT_SELECTION_STALE',
      )
    }
    const encodedReplacement = encodeSourceTextReplacement(target, replacementText)
    const nextContent = `${original.content.slice(0, target.start)}${encodedReplacement}${original.content.slice(target.end)}`
    const written = await saveWorkspaceFile(cwd, selectedFolder, target.path, nextContent, original.hash)
    const transactionId = randomUUID()
    const expiresAt = Date.now() + Math.max(this.verificationTimeoutMs, this.retentionMs)
    const transaction: PendingDirectTextEdit = {
      transactionId,
      cwd,
      selectedFolder,
      path: target.path,
      line: target.line,
      originalContent: original.content,
      originalHash: original.hash,
      writtenHash: written.hash,
      expectedText: replacementText,
      expiresAt,
    }
    this.pending.set(transactionId, transaction)
    return {
      transactionId,
      path: target.path,
      line: target.line,
      previousText: selection.displayedText,
      replacementText,
      writtenHash: written.hash,
      expiresAt: new Date(expiresAt).toISOString(),
    }
  }

  async verify(cwd: string, verification: DirectTextEditVerification): Promise<DirectTextEditResult> {
    const transaction = this.pending.get(verification.transactionId)
    if (transaction === undefined || transaction.cwd !== cwd) {
      throw new WorkspaceExplorerError('文字修改事务不存在或已经结束', 404, 'TEXT_EDIT_TRANSACTION_NOT_FOUND')
    }
    this.pending.delete(transaction.transactionId)
    const observedText = verification.observedText ?? ''
    if (verification.verified && normalizeText(observedText) === normalizeText(transaction.expectedText)) {
      const current = await readWorkspaceFile(cwd, transaction.selectedFolder, transaction.path)
      if (current.hash !== transaction.writtenHash) return conflictResult(transaction)
      return committedResult(transaction, current)
    }
    return this.rollback(transaction)
  }

  dispose(): void {
    clearInterval(this.sweepTimer)
    const transactions = [...this.pending.values()]
    this.pending.clear()
    void Promise.allSettled(transactions.map(transaction => this.rollback(transaction)))
  }

  private async rollback(transaction: PendingDirectTextEdit): Promise<DirectTextEditResult> {
    try {
      const current = await readWorkspaceFile(transaction.cwd, transaction.selectedFolder, transaction.path)
      if (current.hash !== transaction.writtenHash) return conflictResult(transaction)
      const restored = await saveWorkspaceFile(
        transaction.cwd,
        transaction.selectedFolder,
        transaction.path,
        transaction.originalContent,
        transaction.writtenHash,
      )
      return {
        status: 'rolled_back',
        path: transaction.path,
        line: transaction.line,
        message: '页面没有显示新的文字，PageCraft 已把源码恢复到修改前。',
        file: restored,
      }
    } catch (error) {
      if (error instanceof WorkspaceExplorerError && error.code === 'WORKSPACE_FILE_CONFLICT') {
        return conflictResult(transaction)
      }
      throw error
    }
  }

  private async sweepExpired(): Promise<void> {
    const now = Date.now()
    const expired = [...this.pending.values()].filter(transaction => transaction.expiresAt <= now)
    for (const transaction of expired) this.pending.delete(transaction.transactionId)
    await Promise.allSettled(expired.map(transaction => this.rollback(transaction)))
  }
}
