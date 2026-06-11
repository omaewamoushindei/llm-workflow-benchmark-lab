import type { EvaluationCriterion } from './evaluation-criteria'
import type {
  BenchmarkConfig,
  ClinicalCase,
  EvaluationResponse,
  EvaluationWorkflow,
  PromptTemplate,
  RunControls,
} from './types'

export const WORKSPACE_EXPORT_VERSION = '1.0'
export const WORKSPACE_APP_NAME = 'PCT Stewardship Evaluator'
export const WORKSPACE_SCHEMA_VERSION = '1.0'
export const SCORING_VERSION = '1.0'
export const BENCHMARK_RUN_HISTORY_STORAGE_KEY = 'benchmarkRunHistory'

export type WorkspaceCategory =
  | 'customBenchmarkCases'
  | 'evaluationWorkflows'
  | 'promptTemplates'
  | 'evaluationCriteria'
  | 'evaluationSettings'
  | 'benchmarkRunHistory'
  | 'singleCaseResults'

export type WorkspaceConflictAction = 'keep_mine' | 'accept_imported' | 'keep_both' | 'skip_imported'

export type WorkspaceConflict = {
  id: string
  category: WorkspaceCategory
  itemType: 'prompt' | 'workflow' | 'case' | 'criteria' | 'run' | 'settings' | 'single_case'
  itemName: string
  itemId: string
  mineUpdatedAt?: string
  importedUpdatedAt?: string
  summary: string
  defaultAction: WorkspaceConflictAction
}

export type WorkspaceImportPreview = {
  valid: boolean
  version?: string
  error?: string
  counts: Record<WorkspaceCategory, number>
  apiKeysDetected: boolean
  exactDuplicateRunCount: number
  conflicts: WorkspaceConflict[]
}

export type WorkspaceMergeMode = 'merge' | 'replace'

export type WorkspaceImportOptions = {
  mode: WorkspaceMergeMode
  categories: Record<WorkspaceCategory, boolean>
  conflictActions: Record<string, WorkspaceConflictAction>
}

export type WorkspaceCustomCase = {
  id: string
  title: string
  sourceType?: string
  caseData: ClinicalCase
  expectedReferenceLabel?: string
  tags?: string[]
  createdAt?: string
  updatedAt?: string
}

export type BenchmarkCaseSnapshot = {
  caseId: string
  title: string
  sourceType: string
  tags: string[]
  caseData: ClinicalCase
  expectedReferenceLabel?: string
}

export type BenchmarkRunHistoryEntry = {
  schemaVersion: string
  scoringVersion: string
  appName: string
  contentHash?: string
  imported?: boolean
  importedAt?: string
  batchId: string
  createdAt: string
  providerId: 'openrouter' | 'groq'
  benchmarkConfigs?: BenchmarkConfig[]
  runControls?: RunControls
  criteriaSnapshot?: EvaluationCriterion[]
  promptTemplatesSnapshot?: PromptTemplate[]
  workflowsSnapshot?: EvaluationWorkflow[]
  casesSnapshot?: BenchmarkCaseSnapshot[]
  aggregate: Record<string, unknown>
  cases: Array<Record<string, unknown>>
  rawBatch: Record<string, unknown>
}

export type WorkspaceExportData = {
  customBenchmarkCases?: WorkspaceCustomCase[]
  evaluationWorkflows?: EvaluationWorkflow[]
  promptTemplates?: PromptTemplate[]
  evaluationCriteria?: EvaluationCriterion[]
  evaluationSettings?: Record<string, unknown>
  benchmarkRunHistory?: BenchmarkRunHistoryEntry[]
  latestBatchEvaluationResponse?: Record<string, unknown>
  latestSingleCaseExecutionResponse?: Record<string, unknown>
}

export type WorkspaceExport = {
  version: string
  appName: string
  exportedAt: string
  exportedBy: string
  data: WorkspaceExportData
}

const EMPTY_COUNTS: Record<WorkspaceCategory, number> = {
  customBenchmarkCases: 0,
  evaluationWorkflows: 0,
  promptTemplates: 0,
  evaluationCriteria: 0,
  evaluationSettings: 0,
  benchmarkRunHistory: 0,
  singleCaseResults: 0,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

function simpleHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function runContentHash(run: Partial<BenchmarkRunHistoryEntry> | Record<string, unknown>): string {
  const source = isRecord(run.rawBatch) ? run.rawBatch : run
  return simpleHash(
    stableStringify({
      batchId: source.batchId,
      createdAt: source.createdAt,
      providerId: source.providerId,
      benchmarkConfigs: source.benchmarkConfigs,
      cases: source.cases,
      aggregate: source.aggregate,
    }),
  )
}

function hashUnknown(value: unknown): string {
  return simpleHash(stableStringify(value))
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function configIdentityKey(args: {
  run?: BenchmarkRunHistoryEntry
  result?: Record<string, unknown>
  config?: BenchmarkConfig
}): string {
  const result = args.result ?? {}
  const config =
    args.config ??
    args.run?.benchmarkConfigs?.find((item) => item.configId === result.configId) ??
    undefined
  const configType = config?.configType ?? getString(result.configType) ?? 'unknown'
  const providerId = config?.providerId ?? args.run?.providerId ?? 'unknown'
  const label = config?.label ?? getString(result.configLabel) ?? getString(result.modelLabel) ?? getString(result.configId) ?? 'config'

  if (configType === 'workflow') {
    const workflowHash = config?.workflow ? hashUnknown(config.workflow) : undefined
    return [
      'workflow',
      providerId,
      config?.workflowId ?? config?.workflow?.id ?? getString(result.workflowName) ?? 'workflow',
      workflowHash ?? 'no-workflow-snapshot',
      label,
    ].join('|')
  }

  return [
    'model_only',
    providerId,
    config?.modelId ?? getString(result.modelLabel) ?? 'model',
    config?.promptTemplateId ?? 'prompt-unknown',
    label,
  ].join('|')
}

export function caseIdentityKey(caseResult: Record<string, unknown>): string {
  const caseId = getString(caseResult.caseId)
  if (caseId) return `caseId:${caseId}`
  return [
    'case',
    getString(caseResult.title) ?? 'untitled',
    getString(caseResult.sourceType) ?? 'unknown-source',
    getString(caseResult.expectedReferenceLabel) ?? 'unknown-expected',
  ].join('|')
}

export function caseConfigReplicateKey(args: {
  run?: BenchmarkRunHistoryEntry
  caseResult: Record<string, unknown>
  result: Record<string, unknown>
}): string {
  return `${caseIdentityKey(args.caseResult)}::${configIdentityKey({ run: args.run, result: args.result })}`
}

function uniqueId(base: string, existingIds: Set<string>): string {
  const safeBase = base.replace(/[^a-zA-Z0-9._-]/g, '-')
  let candidate = `${safeBase}-imported`
  let index = 2
  while (existingIds.has(candidate)) {
    candidate = `${safeBase}-imported-${index}`
    index += 1
  }
  existingIds.add(candidate)
  return candidate
}

function getItemId(value: unknown): string | undefined {
  return isRecord(value) && typeof value.id === 'string' ? value.id : undefined
}

function getItemName(value: unknown): string {
  if (!isRecord(value)) return 'Untitled'
  return typeof value.name === 'string'
    ? value.name
    : typeof value.title === 'string'
      ? value.title
      : typeof value.batchId === 'string'
        ? value.batchId
        : typeof value.id === 'string'
          ? value.id
          : 'Untitled'
}

function getUpdatedAt(value: unknown): string | undefined {
  return isRecord(value) && typeof value.updatedAt === 'string' ? value.updatedAt : undefined
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function readBenchmarkRunHistory(storage: Storage): BenchmarkRunHistoryEntry[] {
  return safeParse<BenchmarkRunHistoryEntry[]>(storage.getItem(BENCHMARK_RUN_HISTORY_STORAGE_KEY), []).filter(
    (run) => Boolean(run?.batchId),
  ).map((run) => ({ ...run, contentHash: run.contentHash ?? runContentHash(run) }))
}

export function writeBenchmarkRunHistory(storage: Storage, runs: BenchmarkRunHistoryEntry[]) {
  storage.setItem(BENCHMARK_RUN_HISTORY_STORAGE_KEY, JSON.stringify(runs))
}

export function toBenchmarkRunHistoryEntry(args: {
  batch: Record<string, unknown>
  criteriaSnapshot?: EvaluationCriterion[]
  promptTemplatesSnapshot?: PromptTemplate[]
  workflowsSnapshot?: EvaluationWorkflow[]
}): BenchmarkRunHistoryEntry {
  const batch = args.batch
  const cases = asArray<Record<string, unknown>>(batch.cases)
  const casesSnapshot = cases.map((caseResult) => ({
    caseId: typeof caseResult.caseId === 'string' ? caseResult.caseId : 'case',
    title: typeof caseResult.title === 'string' ? caseResult.title : 'Untitled case',
    sourceType: typeof caseResult.sourceType === 'string' ? caseResult.sourceType : 'unknown',
    tags: asArray<string>(caseResult.tags),
    caseData: caseResult.caseData as ClinicalCase,
    expectedReferenceLabel:
      typeof caseResult.expectedReferenceLabel === 'string' ? caseResult.expectedReferenceLabel : undefined,
  }))

  const entry: BenchmarkRunHistoryEntry = {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    scoringVersion: SCORING_VERSION,
    appName: WORKSPACE_APP_NAME,
    batchId: typeof batch.batchId === 'string' ? batch.batchId : `batch-${Date.now()}`,
    createdAt: typeof batch.createdAt === 'string' ? batch.createdAt : new Date().toISOString(),
    providerId: batch.providerId === 'groq' ? 'groq' : 'openrouter',
    benchmarkConfigs: asArray<BenchmarkConfig>(batch.benchmarkConfigs),
    runControls: isRecord(batch.runControls) ? (batch.runControls as unknown as RunControls) : undefined,
    criteriaSnapshot:
      args.criteriaSnapshot ?? asArray<EvaluationCriterion>((batch as { criteriaSettings?: unknown }).criteriaSettings),
    promptTemplatesSnapshot: args.promptTemplatesSnapshot,
    workflowsSnapshot: args.workflowsSnapshot,
    casesSnapshot,
    aggregate: isRecord(batch.aggregate) ? batch.aggregate : {},
    cases,
    rawBatch: batch,
  }
  return { ...entry, contentHash: runContentHash(entry) }
}

export function appendBenchmarkRunHistory(
  currentRuns: BenchmarkRunHistoryEntry[],
  nextRun: BenchmarkRunHistoryEntry,
): BenchmarkRunHistoryEntry[] {
  const nextRunWithHash = { ...nextRun, contentHash: nextRun.contentHash ?? runContentHash(nextRun) }
  if (currentRuns.some((run) => (run.contentHash ?? runContentHash(run)) === nextRunWithHash.contentHash)) {
    return currentRuns
  }
  const existing = currentRuns.find((run) => run.batchId === nextRun.batchId)
  if (!existing) return [...currentRuns, nextRunWithHash]

  const existingIds = new Set(currentRuns.map((run) => run.batchId))
  const duplicateId = uniqueId(nextRun.batchId, existingIds)
  return [
    ...currentRuns,
    { ...nextRunWithHash, batchId: duplicateId, imported: true, importedAt: new Date().toISOString() },
  ]
}

export function createWorkspaceExport(args: {
  customBenchmarkCases?: WorkspaceCustomCase[]
  evaluationWorkflows?: EvaluationWorkflow[]
  promptTemplates?: PromptTemplate[]
  evaluationCriteria?: EvaluationCriterion[]
  evaluationSettings?: Record<string, unknown>
  benchmarkRunHistory?: BenchmarkRunHistoryEntry[]
  latestBatchEvaluationResponse?: Record<string, unknown>
  latestSingleCaseExecutionResponse?: Record<string, unknown>
}): WorkspaceExport {
  return {
    version: WORKSPACE_EXPORT_VERSION,
    appName: WORKSPACE_APP_NAME,
    exportedAt: new Date().toISOString(),
    exportedBy: 'browser-user',
    data: {
      customBenchmarkCases: args.customBenchmarkCases ?? [],
      evaluationWorkflows: args.evaluationWorkflows ?? [],
      promptTemplates: args.promptTemplates ?? [],
      evaluationCriteria: args.evaluationCriteria ?? [],
      evaluationSettings: args.evaluationSettings,
      benchmarkRunHistory: args.benchmarkRunHistory ?? [],
      latestBatchEvaluationResponse: args.latestBatchEvaluationResponse,
      latestSingleCaseExecutionResponse: args.latestSingleCaseExecutionResponse,
    },
  }
}

export function parseWorkspaceExport(raw: string): WorkspaceExport | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed) || parsed.version !== WORKSPACE_EXPORT_VERSION || !isRecord(parsed.data)) return null
    return parsed as WorkspaceExport
  } catch {
    return null
  }
}

export function detectApiKeys(value: unknown): boolean {
  if (typeof value === 'string') {
    return /sk-|api[_-]?key|providerApiKeys|authorization/i.test(value)
  }
  if (Array.isArray(value)) return value.some(detectApiKeys)
  if (isRecord(value)) {
    return Object.entries(value).some(([key, nested]) => /api[_-]?key|providerApiKeys|authorization/i.test(key) || detectApiKeys(nested))
  }
  return false
}

function buildArrayConflicts(args: {
  category: WorkspaceCategory
  itemType: WorkspaceConflict['itemType']
  localItems: unknown[]
  importedItems: unknown[]
  nameField?: 'name' | 'title'
}): WorkspaceConflict[] {
  const conflicts: WorkspaceConflict[] = []
  const byId = new Map(args.localItems.map((item) => [getItemId(item), item]).filter(([id]) => Boolean(id)) as Array<[string, unknown]>)
  const byName = new Map(
    args.localItems
      .map((item) => [getItemName(item).toLowerCase(), item])
      .filter(([name]) => Boolean(name)) as Array<[string, unknown]>,
  )

  for (const imported of args.importedItems) {
    const importedId = getItemId(imported)
    const importedName = getItemName(imported)
    const conflictItemId = importedId ?? importedName
    const localById = importedId ? byId.get(importedId) : undefined
    if (localById && !valuesEqual(localById, imported)) {
      conflicts.push({
        id: `${args.category}-${conflictItemId}-id`,
        category: args.category,
        itemType: args.itemType,
        itemName: importedName,
        itemId: conflictItemId,
        mineUpdatedAt: getUpdatedAt(localById),
        importedUpdatedAt: getUpdatedAt(imported),
        summary: 'Same id exists locally with different content.',
        defaultAction: args.category === 'benchmarkRunHistory' ? 'keep_both' : 'keep_mine',
      })
      continue
    }

    const localByName = byName.get(importedName.toLowerCase())
    if (!localById && localByName && !valuesEqual(localByName, imported)) {
      conflicts.push({
        id: `${args.category}-${conflictItemId}-name`,
        category: args.category,
        itemType: args.itemType,
        itemName: importedName,
        itemId: conflictItemId,
        mineUpdatedAt: getUpdatedAt(localByName),
        importedUpdatedAt: getUpdatedAt(imported),
        summary: 'Same name/title exists locally with a different id or content.',
        defaultAction: 'keep_both',
      })
    }
  }

  return conflicts
}

function buildRunConflicts(localRuns: BenchmarkRunHistoryEntry[], importedRuns: BenchmarkRunHistoryEntry[]): WorkspaceConflict[] {
  const conflicts: WorkspaceConflict[] = []
  const localByBatchId = new Map(localRuns.map((run) => [run.batchId, run]))
  const localHashes = new Set(localRuns.map((run) => run.contentHash ?? runContentHash(run)))

  for (const importedRun of importedRuns) {
    const importedHash = importedRun.contentHash ?? runContentHash(importedRun)
    if (localHashes.has(importedHash)) continue

    const localRun = localByBatchId.get(importedRun.batchId)
    if (localRun && (localRun.contentHash ?? runContentHash(localRun)) !== importedHash) {
      conflicts.push({
        id: `benchmarkRunHistory-${importedRun.batchId}-id`,
        category: 'benchmarkRunHistory',
        itemType: 'run',
        itemName: importedRun.batchId,
        itemId: importedRun.batchId,
        mineUpdatedAt: localRun.createdAt,
        importedUpdatedAt: importedRun.createdAt,
        summary: 'Same batchId exists locally, but the run content hash differs.',
        defaultAction: 'keep_both',
      })
    }
  }

  return conflicts
}

export function buildWorkspaceImportPreview(args: {
  workspace: WorkspaceExport | null
  localData: WorkspaceExportData
}): WorkspaceImportPreview {
  if (!args.workspace) {
    return {
      valid: false,
      error: 'Invalid workspace JSON.',
      counts: EMPTY_COUNTS,
      apiKeysDetected: false,
      exactDuplicateRunCount: 0,
      conflicts: [],
    }
  }

  const data = args.workspace.data
  const localRunHashes = new Set((args.localData.benchmarkRunHistory ?? []).map((run) => run.contentHash ?? runContentHash(run)))
  const exactDuplicateRunCount = (data.benchmarkRunHistory ?? []).filter((run) =>
    localRunHashes.has(run.contentHash ?? runContentHash(run)),
  ).length
  const conflicts = [
    ...buildArrayConflicts({
      category: 'customBenchmarkCases',
      itemType: 'case',
      localItems: args.localData.customBenchmarkCases ?? [],
      importedItems: data.customBenchmarkCases ?? [],
    }),
    ...buildArrayConflicts({
      category: 'evaluationWorkflows',
      itemType: 'workflow',
      localItems: args.localData.evaluationWorkflows ?? [],
      importedItems: data.evaluationWorkflows ?? [],
    }),
    ...buildArrayConflicts({
      category: 'promptTemplates',
      itemType: 'prompt',
      localItems: args.localData.promptTemplates ?? [],
      importedItems: data.promptTemplates ?? [],
    }),
    ...buildArrayConflicts({
      category: 'evaluationCriteria',
      itemType: 'criteria',
      localItems: args.localData.evaluationCriteria ?? [],
      importedItems: data.evaluationCriteria ?? [],
    }),
    ...buildRunConflicts(args.localData.benchmarkRunHistory ?? [], data.benchmarkRunHistory ?? []),
  ]

  return {
    valid: true,
    version: args.workspace.version,
    counts: {
      customBenchmarkCases: data.customBenchmarkCases?.length ?? 0,
      evaluationWorkflows: data.evaluationWorkflows?.length ?? 0,
      promptTemplates: data.promptTemplates?.length ?? 0,
      evaluationCriteria: data.evaluationCriteria?.length ?? 0,
      evaluationSettings: data.evaluationSettings ? 1 : 0,
      benchmarkRunHistory: data.benchmarkRunHistory?.length ?? 0,
      singleCaseResults: data.latestSingleCaseExecutionResponse ? 1 : 0,
    },
    apiKeysDetected: detectApiKeys(args.workspace),
    exactDuplicateRunCount,
    conflicts,
  }
}

function mergeArrayById<T extends Record<string, unknown>>(args: {
  category: WorkspaceCategory
  localItems: T[]
  importedItems: T[]
  conflictActions: Record<string, WorkspaceConflictAction>
  itemType: WorkspaceConflict['itemType']
}): T[] {
  const existingIds = new Set(args.localItems.map((item) => String(item.id)).filter(Boolean))
  const next = [...args.localItems]

  for (const imported of args.importedItems) {
    const importedId = typeof imported.id === 'string' ? imported.id : undefined
    const importedName = getItemName(imported)
    const localIndex = importedId ? next.findIndex((item) => item.id === importedId) : -1
    const localByNameIndex = next.findIndex((item) => getItemName(item).toLowerCase() === importedName.toLowerCase())
    const conflictId =
      localIndex >= 0
        ? `${args.category}-${importedId}-id`
        : localByNameIndex >= 0
          ? `${args.category}-${importedId ?? importedName}-name`
          : undefined
    const action = conflictId ? args.conflictActions[conflictId] : undefined

    if (localIndex >= 0) {
      if (valuesEqual(next[localIndex], imported)) continue
      if (action === 'accept_imported') next[localIndex] = imported
      if (action === 'keep_both') next.push({ ...imported, id: uniqueId(importedId ?? importedName, existingIds) })
      continue
    }

    if (localByNameIndex >= 0 && !valuesEqual(next[localByNameIndex], imported)) {
      if (action === 'accept_imported' || action === 'keep_both') {
        next.push({ ...imported, id: uniqueId(importedId ?? importedName, existingIds) })
      }
      continue
    }

    next.push(importedId ? imported : { ...imported, id: uniqueId(importedName, existingIds) })
    if (importedId) existingIds.add(importedId)
  }

  return next
}

function mergeBenchmarkRuns(args: {
  localRuns: BenchmarkRunHistoryEntry[]
  importedRuns: BenchmarkRunHistoryEntry[]
  conflictActions: Record<string, WorkspaceConflictAction>
}): BenchmarkRunHistoryEntry[] {
  const existingIds = new Set(args.localRuns.map((run) => run.batchId))
  const next = args.localRuns.map((run) => ({ ...run, contentHash: run.contentHash ?? runContentHash(run) }))

  for (const imported of args.importedRuns) {
    const importedRun = {
      ...imported,
      imported: true,
      importedAt: imported.importedAt ?? new Date().toISOString(),
      contentHash: imported.contentHash ?? runContentHash(imported),
    }

    if (next.some((run) => (run.contentHash ?? runContentHash(run)) === importedRun.contentHash)) continue

    const localIndex = next.findIndex((run) => run.batchId === importedRun.batchId)
    if (localIndex >= 0) {
      const conflictId = `benchmarkRunHistory-${importedRun.batchId}-id`
      const action = args.conflictActions[conflictId] ?? 'keep_both'
      if (action === 'accept_imported') next[localIndex] = importedRun
      if (action === 'keep_both') {
        next.push({ ...importedRun, batchId: uniqueId(importedRun.batchId, existingIds) })
      }
      continue
    }

    existingIds.add(importedRun.batchId)
    next.push(importedRun)
  }

  return next
}

export function applyWorkspaceImport(args: {
  workspace: WorkspaceExport
  localData: WorkspaceExportData
  options: WorkspaceImportOptions
}): WorkspaceExportData {
  const { workspace, localData, options } = args
  const data = workspace.data
  const replace = options.mode === 'replace'

  return {
    customBenchmarkCases: options.categories.customBenchmarkCases
      ? replace
        ? data.customBenchmarkCases ?? []
        : mergeArrayById({
            category: 'customBenchmarkCases',
            itemType: 'case',
            localItems: (localData.customBenchmarkCases ?? []) as unknown as Record<string, unknown>[],
            importedItems: (data.customBenchmarkCases ?? []) as unknown as Record<string, unknown>[],
            conflictActions: options.conflictActions,
          }) as unknown as WorkspaceCustomCase[]
      : localData.customBenchmarkCases,
    evaluationWorkflows: options.categories.evaluationWorkflows
      ? replace
        ? data.evaluationWorkflows ?? []
        : mergeArrayById({
            category: 'evaluationWorkflows',
            itemType: 'workflow',
            localItems: (localData.evaluationWorkflows ?? []) as unknown as Record<string, unknown>[],
            importedItems: (data.evaluationWorkflows ?? []) as unknown as Record<string, unknown>[],
            conflictActions: options.conflictActions,
          }) as unknown as EvaluationWorkflow[]
      : localData.evaluationWorkflows,
    promptTemplates: options.categories.promptTemplates
      ? replace
        ? data.promptTemplates ?? []
        : mergeArrayById({
            category: 'promptTemplates',
            itemType: 'prompt',
            localItems: (localData.promptTemplates ?? []) as unknown as Record<string, unknown>[],
            importedItems: (data.promptTemplates ?? []) as unknown as Record<string, unknown>[],
            conflictActions: options.conflictActions,
          }) as unknown as PromptTemplate[]
      : localData.promptTemplates,
    evaluationCriteria: options.categories.evaluationCriteria
      ? replace
        ? data.evaluationCriteria ?? []
        : mergeArrayById({
            category: 'evaluationCriteria',
            itemType: 'criteria',
            localItems: (localData.evaluationCriteria ?? []) as unknown as Record<string, unknown>[],
            importedItems: (data.evaluationCriteria ?? []) as unknown as Record<string, unknown>[],
            conflictActions: options.conflictActions,
          }) as unknown as EvaluationCriterion[]
      : localData.evaluationCriteria,
    evaluationSettings: options.categories.evaluationSettings
      ? data.evaluationSettings ?? localData.evaluationSettings
      : localData.evaluationSettings,
    benchmarkRunHistory: options.categories.benchmarkRunHistory
      ? replace
        ? (data.benchmarkRunHistory ?? []).map((run) => ({
            ...run,
            imported: true,
            importedAt: run.importedAt ?? new Date().toISOString(),
            contentHash: run.contentHash ?? runContentHash(run),
          }))
        : mergeBenchmarkRuns({
            localRuns: localData.benchmarkRunHistory ?? [],
            importedRuns: data.benchmarkRunHistory ?? [],
            conflictActions: options.conflictActions,
          })
      : localData.benchmarkRunHistory,
    latestBatchEvaluationResponse: options.categories.benchmarkRunHistory
      ? data.latestBatchEvaluationResponse ?? localData.latestBatchEvaluationResponse
      : localData.latestBatchEvaluationResponse,
    latestSingleCaseExecutionResponse: options.categories.singleCaseResults
      ? data.latestSingleCaseExecutionResponse ?? localData.latestSingleCaseExecutionResponse
      : localData.latestSingleCaseExecutionResponse,
  }
}

export function isRunCompatible(run: BenchmarkRunHistoryEntry, criteria: EvaluationCriterion[]): boolean | null {
  if (run.schemaVersion !== WORKSPACE_SCHEMA_VERSION) return false
  if (run.scoringVersion && run.scoringVersion !== SCORING_VERSION) return false
  if (!run.criteriaSnapshot || run.criteriaSnapshot.length === 0) return null
  const localIds = criteria.filter((criterion) => !criterion.isReportOnly).map((criterion) => criterion.id).sort()
  const runIds = run.criteriaSnapshot.filter((criterion) => !criterion.isReportOnly).map((criterion) => criterion.id).sort()
  return valuesEqual(localIds, runIds)
}

export function buildMergedBatchFromRuns(runs: BenchmarkRunHistoryEntry[]): Record<string, unknown> | null {
  if (runs.length === 0) return null
  const cases: Array<Record<string, unknown>> = runs.flatMap((run) =>
    run.cases.map((caseResult, index) => ({
      ...caseResult,
      caseId: `${run.batchId}:${String(caseResult.caseId ?? index)}`,
      sourceBatchId: run.batchId,
    })),
  )
  const aggregateValues = runs.map((run) => run.aggregate)
  const average = (key: string) => {
    const values = aggregateValues
      .map((aggregate) => aggregate[key])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  }

  return {
    batchId: `merged-${runs.length}-runs`,
    createdAt: new Date().toISOString(),
    providerId: runs[0]?.providerId ?? 'openrouter',
    caseCount: cases.length,
    modelCount: 0,
    totalConfigCount: new Set(cases.flatMap((caseResult) => asArray<Record<string, unknown>>(caseResult.results).map((result) => result.configId))).size,
    cases,
    criteriaSettings: runs[0]?.criteriaSnapshot,
    aggregate: {
      averageRecommendationMatch: average('averageRecommendationMatch'),
      averageCriterionAlignment: average('averageCriterionAlignment'),
      averageSafety: average('averageSafety'),
      averageExplainability: average('averageExplainability'),
      totalSafetyWarnings: aggregateValues.reduce(
        (sum, aggregate) => sum + (typeof aggregate.totalSafetyWarnings === 'number' ? aggregate.totalSafetyWarnings : 0),
        0,
      ),
      failedModelCalls: aggregateValues.reduce(
        (sum, aggregate) => sum + (typeof aggregate.failedModelCalls === 'number' ? aggregate.failedModelCalls : 0),
        0,
      ),
    },
  }
}
