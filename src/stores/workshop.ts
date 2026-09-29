import { computed, ref, toRaw, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  BASELINE_VENUE_ID,
  hasDanger,
  nearestSafe,
  sceneKey,
  seedVenues,
  testHazards,
  toPhysical,
  type HazardHit,
  type PhysPoint,
  type Venue,
} from './venues'

export type Department = '舞台' | '灯光' | '音响' | '道具'
export type Point = { x: number; y: number }

export type Comment = {
  id: string
  author: string
  content: string
  createdAt: string
  resolved: boolean
}

export type Cue = {
  id: string
  act: string
  scene: string
  time: string
  title: string
  department: Department
  owner: string
  duration: number
  entry: Point
  exit: Point
  route: Point[]
  note: string
  status: '草稿' | '待确认' | '已确认'
  comments: Comment[]
}

export const seedProject = {
  name: '潮汐来信',
  venue: '上海大剧院 · 大剧场',
  rehearsalDate: '2026-10-08',
  company: '远岸剧团',
}

export const seedMovers = [
  { id: 'M-01', alias: '林默', role: '父亲', group: '主要演员', color: '#d96b45' },
  { id: 'M-02', alias: '周予', role: '女儿', group: '主要演员', color: '#2f8d88' },
  { id: 'M-03', alias: '顾川', role: '灯塔守望者', group: '主要演员', color: '#4f6fb0' },
  { id: 'M-04', alias: '群演甲组', role: '旅客', group: '群演', color: '#ba8c2f' },
  { id: 'M-05', alias: '群演乙组', role: '码头工人', group: '群演', color: '#735ca8' },
]

export const seedCues: Cue[] = [
  {
    id: 'C-01',
    act: '第一幕',
    scene: '启航前夜',
    time: '00:04:20',
    title: '林默从左侧门入场',
    department: '舞台',
    owner: '林默 / 周予',
    duration: 95,
    entry: { x: 10, y: 70 },
    exit: { x: 64, y: 38 },
    route: [{ x: 10, y: 70 }, { x: 35, y: 60 }, { x: 64, y: 38 }],
    note: '灯位切换后 2 秒入场，停在码头箱前。',
    status: '已确认',
    comments: [
      { id: 'c1', author: '王灯控', content: '面光需要延长 4 秒，保证转身动作可见。', createdAt: '2026-09-27 14:20', resolved: false },
    ],
  },
  {
    id: 'C-02',
    act: '第一幕',
    scene: '启航前夜',
    time: '00:06:10',
    title: '信件道具交接',
    department: '道具',
    owner: '周予 / 道具组',
    duration: 40,
    entry: { x: 28, y: 30 },
    exit: { x: 55, y: 47 },
    route: [{ x: 28, y: 30 }, { x: 44, y: 40 }, { x: 55, y: 47 }],
    note: '使用 B 版信封，背台侧完成交接。',
    status: '待确认',
    comments: [],
  },
  {
    id: 'C-03',
    act: '第二幕',
    scene: '风暴',
    time: '00:21:35',
    title: '升降台上升 / 码头位移',
    department: '舞台',
    owner: '舞台机械',
    duration: 120,
    entry: { x: 72, y: 82 },
    exit: { x: 42, y: 50 },
    route: [{ x: 72, y: 82 }, { x: 60, y: 70 }, { x: 42, y: 50 }],
    note: '先确认演员离开危险半径，再启动升降台。',
    status: '草稿',
    comments: [],
  },
  {
    id: 'C-04',
    act: '第二幕',
    scene: '风暴',
    time: '00:23:05',
    title: '爆闪与低频重音',
    department: '灯光',
    owner: '王灯控 / 声场',
    duration: 18,
    entry: { x: 50, y: 12 },
    exit: { x: 50, y: 12 },
    route: [{ x: 50, y: 12 }],
    note: '与机械动作互锁，机械未到位禁止触发。',
    status: '待确认',
    comments: [],
  },
  {
    id: 'C-05',
    act: '第三幕',
    scene: '守望',
    time: '00:37:42',
    title: '三人灯塔调度',
    department: '舞台',
    owner: '主要演员组',
    duration: 70,
    entry: { x: 18, y: 82 },
    exit: { x: 82, y: 18 },
    route: [{ x: 18, y: 82 }, { x: 45, y: 66 }, { x: 68, y: 35 }, { x: 82, y: 18 }],
    note: '群演保持第二条对角线，不遮挡主视线。',
    status: '草稿',
    comments: [],
  },
  {
    id: 'C-06',
    act: '第三幕',
    scene: '守望',
    time: '00:39:10',
    title: '救生艇推入',
    department: '道具',
    owner: '道具组 / 群演乙组',
    duration: 50,
    entry: { x: 88, y: 64 },
    exit: { x: 70, y: 44 },
    route: [{ x: 88, y: 64 }, { x: 80, y: 54 }, { x: 70, y: 44 }],
    note: '与演员横穿路线冲突，需调整优先权。',
    status: '待确认',
    comments: [],
  },
]

// ---------------------------------------------------------------------------
// 草稿持久化：v2 增加场地 / 锁定 / 场地修正 / 重算日志
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'stage-scheduler-draft-v2'
const LEGACY_STORAGE_KEY = 'stage-scheduler-draft-v1'

export type NodeRef = { kind: 'entry' | 'exit' | 'route'; index: number }
export type AdaptedNode = NodeRef & {
  label: string
  master: Point
  point: PhysPoint
  hazards: HazardHit[]
  danger: boolean
  warning: boolean
  overridden: boolean
}
export type AdaptedCue = {
  cue: Cue
  scene: string
  nodes: AdaptedNode[]
  dangerNodes: AdaptedNode[]
  warningNodes: AdaptedNode[]
  /** 从未执行初次换算 */
  pendingAdaptation: boolean
  /** 已换算但主数据/勘测变化，受影响场景待重算 */
  stale: boolean
}
export type RecomputeLogEntry = {
  id: string
  venueId: string
  venueName: string
  scenes: string[]
  cueCount: number
  reason: string
  at: string
}

type PersistedDraft = {
  cues?: Cue[]
  revision?: number
  venues?: Venue[]
  activeVenueId?: string
  locks?: Record<string, Record<string, boolean>>
  overrides?: Record<string, Record<string, PhysPoint>>
  dirtyScenes?: Record<string, string[]>
  logs?: RecomputeLogEntry[]
  adaptedAt?: Record<string, string>
}

function nodeKey(ref: NodeRef) {
  return ref.kind === 'route' ? `route:${ref.index}` : ref.kind
}

function nodeLabel(ref: NodeRef) {
  if (ref.kind === 'entry') return '入场点'
  if (ref.kind === 'exit') return '退场点'
  return `路线节点 ${ref.index + 1}`
}

export const useWorkshopStore = defineStore('workshop', () => {
  const restored: PersistedDraft | null = (() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        return JSON.parse(raw) as PersistedDraft
      } catch {
        return null
      }
    }
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    return legacy ? (JSON.parse(legacy) as { cues?: Cue[]; revision?: number }) : null
  })()

  const cues = ref<Cue[]>(restored?.cues?.length ? restored.cues : structuredClone(seedCues))

  // 场地登记：基线场地恒取种子定义（只读），其余场地恢复本地勘测修改
  const venues = ref<Venue[]>([
    seedVenues[0],
    ...((restored?.venues ?? seedVenues.slice(1)).filter((venue) => !venue.baseline)),
  ])
  const activeVenueId = ref(
    restored?.activeVenueId && venues.value.some((venue) => venue.id === restored.activeVenueId)
      ? restored.activeVenueId
      : BASELINE_VENUE_ID,
  )

  // 分场景锁定：locks[场地id][场景键]
  const locks = ref<Record<string, Record<string, boolean>>>(restored?.locks ?? {})
  // 场地专属节点修正（米制实测坐标），不回写基线主数据
  const overrides = ref<Record<string, Record<string, PhysPoint>>>(restored?.overrides ?? {})
  // 待重算场景（演员 / 道具 / 走位变化后登记）
  const dirtyScenes = ref<Record<string, string[]>>(restored?.dirtyScenes ?? {})
  const logs = ref<RecomputeLogEntry[]>(restored?.logs ?? [])
  // 场地首次换算时间（持久化）；换算缓存只在运行期保留，刷新后按已持久化数据静默重建
  const adaptedAt = ref<Record<string, string>>(restored?.adaptedAt ?? {})

  // 换算缓存（运行期）：cacheV2[场地id][提示id] = { sig, nodes }
  const adaptationCache = ref<Record<string, Record<string, { sig: string; nodes: AdaptedNode[] }>>>({})

  const selectedId = ref('C-01')
  const zoom = ref(100)
  const actFilter = ref('全部')
  const departmentFilter = ref('全部')
  const rev = ref(restored?.revision ?? 12)
  const revision = computed(() => `R${rev.value}`)
  const lastSaved = ref('刚刚自动保存')
  const isOffline = ref(false)
  const undoStack = ref<Cue[][]>([])
  const redoStack = ref<Cue[][]>([])

  const activeVenue = computed(
    () => venues.value.find((venue) => venue.id === activeVenueId.value) ?? venues.value[0],
  )
  const baselineVenue = computed(() => venues.value.find((venue) => venue.baseline)!)
  const tourVenues = computed(() => venues.value.filter((venue) => !venue.baseline))
  const isBaselineActive = computed(() => activeVenue.value.baseline === true)

  const selectedCue = computed(() => cues.value.find((cue) => cue.id === selectedId.value) ?? cues.value[0])
  const filteredCues = computed(() =>
    cues.value.filter(
      (cue) =>
        (actFilter.value === '全部' || cue.act === actFilter.value) &&
        (departmentFilter.value === '全部' || cue.department === departmentFilter.value),
    ),
  )
  const conflicts = computed(() =>
    cues.value.filter((cue, index) =>
      cues.value.some((other, otherIndex) => otherIndex !== index && other.time === cue.time && other.scene === cue.scene),
    ),
  )

  // 基线全锁定时沿用旧版“锁定基线”开关语义
  const locked = computed(() => {
    const baselineLocks = locks.value[BASELINE_VENUE_ID] ?? {}
    return new Set(cues.value.map((cue) => sceneKey(cue.act, cue.scene))).size > 0
      && allScenes(cues.value).every((scene) => baselineLocks[scene])
  })

  function persistDraft() {
    const draft: PersistedDraft = {
      cues: cues.value,
      revision: rev.value,
      venues: venues.value.filter((venue) => !venue.baseline),
      activeVenueId: activeVenueId.value,
      locks: locks.value,
      overrides: overrides.value,
      dirtyScenes: dirtyScenes.value,
      logs: logs.value.slice(0, 30),
      adaptedAt: adaptedAt.value,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
    localStorage.removeItem(LEGACY_STORAGE_KEY)
    lastSaved.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  watch(
    [cues, rev, isOffline, venues, activeVenueId, locks, overrides, dirtyScenes, logs, adaptedAt],
    persistDraft,
    { deep: true, flush: 'sync' },
  )

  // 初始化即落盘：v1 草稿迁移后立刻升级为 v2，并清理旧 key
  persistDraft()

  function allScenes(list: Cue[]) {
    return [...new Set(list.map((cue) => sceneKey(cue.act, cue.scene)))]
  }

  // -- 换算 ----------------------------------------------------------------

  function signature(cue: Cue, venue: Venue) {
    return JSON.stringify({
      g: [cue.entry, cue.exit, cue.route],
      owner: cue.owner,
      dep: cue.department,
      scene: sceneKey(cue.act, cue.scene),
      v: {
        w: venue.prosceniumWidth,
        d: venue.stageDepth,
        wing: venue.wingMargin,
        zones: venue.zones,
      },
    })
  }

  function nodeRefs(cue: Cue): NodeRef[] {
    const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y
    const refs: NodeRef[] = [{ kind: 'entry', index: 0 }]
    cue.route.forEach((point, index) => {
      // 路线首尾通常与入场/退场重合：去重，避免同一物理位置被重复判危险
      const isFirst = index === 0 && same(point, cue.entry)
      const isLast = index === cue.route.length - 1 && same(point, cue.exit)
      if (!isFirst && !isLast) refs.push({ kind: 'route', index })
    })
    if (!same(cue.exit, cue.entry)) refs.push({ kind: 'exit', index: 0 })
    // 入出同点（如灯光/音响定位提示）时保留入场即可
    return refs
  }

  function masterPoint(cue: Cue, refNode: NodeRef): Point {
    if (refNode.kind === 'entry') return cue.entry
    if (refNode.kind === 'exit') return cue.exit
    return cue.route[refNode.index]
  }

  function buildNodes(venue: Venue, cue: Cue): AdaptedNode[] {
    const venueOverrides = overrides.value[venue.id] ?? {}
    return nodeRefs(cue).map((refNode) => {
      const master = masterPoint(cue, refNode)
      const key = `${cue.id}:${nodeKey(refNode)}`
      const physical = venueOverrides[key] ?? toPhysical(venue, master)
      const hazards = testHazards(venue, physical)
      return {
        ...refNode,
        label: nodeLabel(refNode),
        master,
        point: physical,
        hazards,
        danger: hasDanger(hazards),
        warning: hazards.some((hit) => hit.level === 'warning'),
        overridden: key in venueOverrides,
      }
    })
  }

  /**
   * 读取某场地下的换算结果：
   * - 基线场地：主数据即结果，始终实时计算
   * - 巡演场地：取最近一次“换算 / 重算”缓存；从未换算时实时计算但标记 stale
   *   （待初次换算），签名不一致时保留旧几何并标记 stale（待重算受影响场景）
   */
  function adaptedCuesFor(venueId: string): AdaptedCue[] {
    const venue = venues.value.find((item) => item.id === venueId)
    if (!venue) return []
    const cache = adaptationCache.value[venue.id]
    const dirty = new Set(dirtyScenes.value[venue.id] ?? [])
    const adapted = Boolean(venue.baseline) || Boolean(adaptedAt.value[venue.id])
    return cues.value.map((cue) => {
      const sig = signature(cue, venue)
      const cached = cache?.[cue.id]
      const pendingAdaptation = venue.baseline !== true && !adapted
      const nodes = venue.baseline || !adapted || !cached ? buildNodes(venue, cue) : cached.nodes
      const scene = sceneKey(cue.act, cue.scene)
      return {
        cue,
        scene,
        nodes,
        dangerNodes: nodes.filter((node) => node.danger),
        warningNodes: nodes.filter((node) => node.warning),
        pendingAdaptation,
        // 已换算但主数据/勘测变化 -> 受影响场景待重算；未换算 -> 待初次换算
        stale: venue.baseline !== true && (pendingAdaptation || dirty.has(scene) || Boolean(cached && cached.sig !== sig)),
      }
    })
  }

  /** 刷新后按已持久化数据静默重建换算缓存，保持打印版与几何连续 */
  function warmAdaptationCache() {
    tourVenues.value.forEach((venue) => {
      if (!adaptedAt.value[venue.id]) return
      const cache: Record<string, { sig: string; nodes: AdaptedNode[] }> = {}
      cues.value.forEach((cue) => {
        cache[cue.id] = { sig: signature(cue, venue), nodes: buildNodes(venue, cue) }
      })
      adaptationCache.value[venue.id] = cache
    })
  }
  warmAdaptationCache()

  const activeAdaptedCues = computed(() => adaptedCuesFor(activeVenueId.value))
  const activeSceneStatuses = computed(() => sceneStatusesFor(activeVenueId.value))

  function sceneStatusesFor(venueId: string) {
    const adapted = adaptedCuesFor(venueId)
    const venue = venues.value.find((item) => item.id === venueId)
    const byScene = new Map<string, AdaptedCue[]>()
    adapted.forEach((item) => {
      byScene.set(item.scene, [...(byScene.get(item.scene) ?? []), item])
    })
    return [...byScene.entries()].map(([scene, items]) => {
      const dangerNodes = items.flatMap((item) =>
        item.dangerNodes.map((node) => ({ cue: item.cue, node })),
      )
      const warningNodes = items.flatMap((item) =>
        item.warningNodes.map((node) => ({ cue: item.cue, node })),
      )
      return {
        venueId,
        scene,
        locked: Boolean(locks.value[venueId]?.[scene]),
        suspended: dangerNodes.length > 0,
        stale: items.some((item) => item.stale),
        pendingAdaptation: items.some((item) => item.pendingAdaptation),
        dangerNodes,
        warningNodes,
        cues: items.map((item) => item.cue),
        baseline: venue?.baseline === true,
      }
    })
  }

  // -- 换算 / 重算 ----------------------------------------------------------

  function adaptVenue(venueId: string, reason = '初次按实测尺寸换算'): number {
    const venue = venues.value.find((item) => item.id === venueId)
    if (!venue || venue.baseline) return 0
    const cache: Record<string, { sig: string; nodes: AdaptedNode[] }> = {}
    cues.value.forEach((cue) => {
      cache[cue.id] = { sig: signature(cue, venue), nodes: buildNodes(venue, cue) }
    })
    adaptationCache.value = { ...adaptationCache.value, [venue.id]: cache }
    dirtyScenes.value = { ...dirtyScenes.value, [venue.id]: [] }
    adaptedAt.value = { ...adaptedAt.value, [venue.id]: new Date().toISOString() }
    pushLog(venue, allScenes(cues.value), cues.value.length, reason)
    return cues.value.length
  }

  function recomputeScene(venueId: string, scene: string, reason = '受影响场景重算') {
    const venue = venues.value.find((item) => item.id === venueId)
    if (!venue || venue.baseline) return 0
    const affected = cues.value.filter((cue) => sceneKey(cue.act, cue.scene) === scene)
    if (!affected.length) return 0
    const cache = (adaptationCache.value[venue.id] ??= {})
    affected.forEach((cue) => {
      cache[cue.id] = { sig: signature(cue, venue), nodes: buildNodes(venue, cue) }
    })
    const remaining = (dirtyScenes.value[venue.id] ?? []).filter((key) => key !== scene)
    dirtyScenes.value = { ...dirtyScenes.value, [venue.id]: remaining }
    pushLog(venue, [scene], affected.length, reason)
    return affected.length
  }

  function recomputeAffected(venueId: string): { scenes: string[]; count: number } {
    const venue = venues.value.find((item) => item.id === venueId)
    if (!venue || venue.baseline) return { scenes: [], count: 0 }
    const staleScenes = new Set<string>()
    const cache = adaptationCache.value[venue.id] ?? {}
    cues.value.forEach((cue) => {
      const entry = cache[cue.id]
      if (!entry || entry.sig !== signature(cue, venue)) {
        staleScenes.add(sceneKey(cue.act, cue.scene))
      }
    })
    ;(dirtyScenes.value[venue.id] ?? []).forEach((scene) => staleScenes.add(scene))
    let count = 0
    staleScenes.forEach((scene) => {
      count += recomputeScene(venue.id, scene)
    })
    return { scenes: [...staleScenes], count }
  }

  function pushLog(venue: Venue, scenes: string[], cueCount: number, reason: string) {
    logs.value = [
      {
        id: `log-${Date.now()}-${Math.round(Math.random() * 1000)}`,
        venueId: venue.id,
        venueName: venue.shortName,
        scenes,
        cueCount,
        reason,
        at: new Date().toLocaleString('zh-CN', { hour12: false }),
      },
      ...logs.value,
    ].slice(0, 30)
  }

  // -- 变更登记：演员 / 道具 / 走位变化后，只把受影响场景标为待重算 -----------

  function markAffected(cue: Cue) {
    const scene = sceneKey(cue.act, cue.scene)
    const next = { ...dirtyScenes.value }
    tourVenues.value.forEach((venue) => {
      const set = new Set(next[venue.id] ?? [])
      set.add(scene)
      next[venue.id] = [...set]
    })
    dirtyScenes.value = next
  }

  function snapshot() {
    undoStack.value.push(structuredClone(toRaw(cues.value)))
    if (undoStack.value.length > 20) undoStack.value.shift()
    redoStack.value = []
  }

  function baselineSceneLocked(cue: Cue) {
    return Boolean(locks.value[BASELINE_VENUE_ID]?.[sceneKey(cue.act, cue.scene)])
  }

  function updateCue(patch: Partial<Cue>, addRevision = true) {
    if (locked.value) return
    const index = cues.value.findIndex((cue) => cue.id === selectedId.value)
    if (index < 0) return
    if (baselineSceneLocked(cues.value[index])) return
    snapshot()
    cues.value[index] = { ...cues.value[index], ...patch }
    markAffected(cues.value[index])
    if (addRevision) rev.value += 1
  }

  function addWaypoint(point: Point) {
    const cue = selectedCue.value
    if (!cue || baselineSceneLocked(cue)) return
    updateCue({ route: [...cue.route, point] })
  }

  function addCue() {
    if (locked.value) return
    snapshot()
    const next = cues.value.length + 1
    const cue: Cue = {
      id: `C-${String(next).padStart(2, '0')}`,
      act: '第一幕',
      scene: '新场景',
      time: '00:00:00',
      title: '新执行提示',
      department: '舞台',
      owner: '待指派',
      duration: 30,
      entry: { x: 10, y: 50 },
      exit: { x: 90, y: 50 },
      route: [{ x: 10, y: 50 }, { x: 90, y: 50 }],
      note: '',
      status: '草稿',
      comments: [],
    }
    cues.value.push(cue)
    selectedId.value = cue.id
    markAffected(cue)
    rev.value += 1
  }

  function undo() {
    const previous = undoStack.value.pop()
    if (!previous) return
    redoStack.value.push(structuredClone(toRaw(cues.value)))
    cues.value = previous
    markAllDirty()
    rev.value += 1
  }

  function redo() {
    const next = redoStack.value.pop()
    if (!next) return
    undoStack.value.push(structuredClone(toRaw(cues.value)))
    cues.value = next
    markAllDirty()
    rev.value += 1
  }

  function markAllDirty() {
    const updated = { ...dirtyScenes.value }
    tourVenues.value.forEach((venue) => {
      updated[venue.id] = allScenes(cues.value)
    })
    dirtyScenes.value = updated
  }

  function addComment(content: string, author = '当前用户') {
    const cue = selectedCue.value
    if (!cue) return
    snapshot()
    cue.comments.push({
      id: `local-${Date.now()}`,
      author,
      content,
      createdAt: new Date().toLocaleString('zh-CN'),
      resolved: false,
    })
    rev.value += 1
  }

  function toggleComment(commentId: string) {
    const comment = selectedCue.value?.comments.find((item) => item.id === commentId)
    if (comment) comment.resolved = !comment.resolved
  }

  // -- 锁定 ----------------------------------------------------------------

  function isSceneLocked(venueId: string, act: string, scene: string) {
    return Boolean(locks.value[venueId]?.[sceneKey(act, scene)])
  }

  /** 锁定闸门：按当前主数据 + 场地修正实时判定危险区，缓存过期也不能漏判 */
  function sceneDangerCueIds(venueId: string, scene: string) {
    const venue = venues.value.find((item) => item.id === venueId)
    if (!venue) return []
    return cues.value
      .filter((cue) => sceneKey(cue.act, cue.scene) === scene)
      .filter((cue) => buildNodes(venue, cue).some((node) => node.danger))
      .map((cue) => cue.id)
  }

  function lockScene(venueId: string, act: string, scene: string): boolean {
    const key = sceneKey(act, scene)
    if (sceneDangerCueIds(venueId, key).length > 0) return false // 危险区节点未清零，暂缓锁定
    locks.value = {
      ...locks.value,
      [venueId]: { ...(locks.value[venueId] ?? {}), [key]: true },
    }
    return true
  }

  function unlockScene(venueId: string, act: string, scene: string) {
    const key = sceneKey(act, scene)
    const map = { ...(locks.value[venueId] ?? {}) }
    delete map[key]
    locks.value = { ...locks.value, [venueId]: map }
  }

  function lockBaseline() {
    const map: Record<string, boolean> = {}
    allScenes(cues.value).forEach((scene) => {
      map[scene] = true
    })
    locks.value = { ...locks.value, [BASELINE_VENUE_ID]: map }
    cues.value.forEach((cue) => {
      cue.status = '已确认'
    })
    rev.value += 1
  }

  function unlockBaseline() {
    locks.value = { ...locks.value, [BASELINE_VENUE_ID]: {} }
    rev.value += 1
  }

  // -- 场地切换 / 勘测登记 ---------------------------------------------------

  function setActiveVenue(venueId: string) {
    if (!venues.value.some((venue) => venue.id === venueId)) return
    activeVenueId.value = venueId
  }

  function updateVenueSurvey(venueId: string, patch: Partial<Venue>) {
    const venue = venues.value.find((item) => item.id === venueId)
    if (!venue || venue.baseline) return
    Object.assign(venue, patch)
    // 勘测尺寸 / 危险区变化影响全部场景，等待重新换算
    dirtyScenes.value = { ...dirtyScenes.value, [venueId]: allScenes(cues.value) }
  }

  function addVenueZone(venueId: string, zone: Venue['zones'][number]) {
    const venue = venues.value.find((item) => item.id === venueId)
    if (!venue || venue.baseline) return
    venue.zones.push(zone)
    dirtyScenes.value = { ...dirtyScenes.value, [venueId]: allScenes(cues.value) }
  }

  function removeVenueZone(venueId: string, zoneId: string) {
    const venue = venues.value.find((item) => item.id === venueId)
    if (!venue || venue.baseline) return
    venue.zones = venue.zones.filter((zone) => zone.id !== zoneId)
    dirtyScenes.value = { ...dirtyScenes.value, [venueId]: allScenes(cues.value) }
  }

  function addVenue(venue: Venue) {
    if (venues.value.some((item) => item.id === venue.id)) return
    venues.value.push(venue)
    dirtyScenes.value = { ...dirtyScenes.value, [venue.id]: allScenes(cues.value) }
  }

  function removeVenue(venueId: string) {
    if (venueId === BASELINE_VENUE_ID) return
    venues.value = venues.value.filter((venue) => venue.id !== venueId)
    if (activeVenueId.value === venueId) activeVenueId.value = BASELINE_VENUE_ID
    const nextLocks = { ...locks.value }
    delete nextLocks[venueId]
    locks.value = nextLocks
    const nextOverrides = { ...overrides.value }
    delete nextOverrides[venueId]
    overrides.value = nextOverrides
    const nextDirty = { ...dirtyScenes.value }
    delete nextDirty[venueId]
    dirtyScenes.value = nextDirty
  }

  // -- 场地专属节点修正（不改基线） ------------------------------------------

  function activeSceneUnlocked(venueId: string, cue: Cue) {
    return !isSceneLocked(venueId, cue.act, cue.scene)
  }

  function setNodeOverride(venueId: string, cueId: string, refNode: NodeRef, point: PhysPoint) {
    const venue = venues.value.find((item) => item.id === venueId)
    const cue = cues.value.find((item) => item.id === cueId)
    if (!venue || venue.baseline || !cue) return
    if (!activeSceneUnlocked(venueId, cue)) return
    const key = `${cueId}:${nodeKey(refNode)}`
    overrides.value = {
      ...overrides.value,
      [venueId]: { ...(overrides.value[venueId] ?? {}), [key]: point },
    }
    rebuildCacheEntry(venue, cue)
  }

  function nudgeNode(venueId: string, cueId: string, refNode: NodeRef, axis: 'x' | 'd', delta: number) {
    const adapted = adaptedCuesFor(venueId).find((item) => item.cue.id === cueId)
    const node = adapted?.nodes.find(
      (item) => item.kind === refNode.kind && item.index === refNode.index,
    )
    if (!node) return
    setNodeOverride(venueId, cueId, refNode, {
      ...node.point,
      [axis]: Math.round((node.point[axis] + delta) * 10) / 10,
    })
  }

  function moveNodeToSafe(venueId: string, cueId: string, refNode: NodeRef) {
    const venue = venues.value.find((item) => item.id === venueId)
    const adapted = adaptedCuesFor(venueId).find((item) => item.cue.id === cueId)
    const node = adapted?.nodes.find(
      (item) => item.kind === refNode.kind && item.index === refNode.index,
    )
    if (!venue || !node) return
    setNodeOverride(venueId, cueId, refNode, nearestSafe(venue, node.point))
  }

  function clearNodeOverride(venueId: string, cueId: string, refNode: NodeRef) {
    const cue = cues.value.find((item) => item.id === cueId)
    const venue = venues.value.find((item) => item.id === venueId)
    if (!cue || !venue || venue.baseline) return
    if (!activeSceneUnlocked(venueId, cue)) return
    const key = `${cueId}:${nodeKey(refNode)}`
    const map = { ...(overrides.value[venueId] ?? {}) }
    delete map[key]
    overrides.value = { ...overrides.value, [venueId]: map }
    rebuildCacheEntry(venue, cue)
  }

  function rebuildCacheEntry(venue: Venue, cue: Cue) {
    const cache = (adaptationCache.value[venue.id] ??= {})
    cache[cue.id] = { sig: signature(cue, venue), nodes: buildNodes(venue, cue) }
  }

  function toggleOffline() {
    isOffline.value = !isOffline.value
  }

  return {
    // 状态
    cues,
    venues,
    activeVenueId,
    activeVenue,
    baselineVenue,
    tourVenues,
    isBaselineActive,
    selectedId,
    selectedCue,
    filteredCues,
    conflicts,
    zoom,
    actFilter,
    departmentFilter,
    revision,
    lastSaved,
    isOffline,
    locked,
    locks,
    overrides,
    dirtyScenes,
    logs,
    adaptedAt,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    // 换算
    activeAdaptedCues,
    activeSceneStatuses,
    adaptedCuesFor,
    sceneStatusesFor,
    adaptVenue,
    recomputeScene,
    recomputeAffected,
    // 编辑
    updateCue,
    addWaypoint,
    addCue,
    undo,
    redo,
    addComment,
    toggleComment,
    // 锁定
    isSceneLocked,
    lockScene,
    unlockScene,
    lockBaseline,
    unlockBaseline,
    // 场地
    setActiveVenue,
    updateVenueSurvey,
    addVenueZone,
    removeVenueZone,
    addVenue,
    removeVenue,
    // 节点修正
    setNodeOverride,
    nudgeNode,
    moveNodeToSafe,
    clearNodeOverride,
    toggleOffline,
  }
})
