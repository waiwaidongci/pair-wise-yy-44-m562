import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useWorkshopStore, type Cue, type Point } from './workshop'

/** 矩形区域，单位米，原点为台口平面左上角（x 向右，y 向观众席） */
export type Zone = {
  id: string
  label: string
  x: number
  y: number
  w: number
  h: number
}

export type Venue = {
  id: string
  name: string
  kind: '大剧场' | '小剧场'
  /** 台口宽（米） */
  prosceniumWidth: number
  /** 台口深（米） */
  stageDepth: number
  /** 侧幕安全距离（米），距两侧墙小于该值的节点视为贴幕 */
  wingMargin: number
  /** 升降台禁入区 */
  liftZones: Zone[]
  /** 乐池范围 */
  pitZone: Zone
  /** 原场地基线只读，不允许改尺寸 */
  readonly: boolean
}

export type AdaptedNode = {
  /** 换算到目标场地后的百分比坐标 */
  point: Point
  /** 目标场地内的实际米制坐标 */
  meters: Point
  /** 命中的危险区名称，空数组表示安全 */
  dangers: string[]
}

export type AdaptedCue = {
  cueId: string
  entry: AdaptedNode
  exit: AdaptedNode
  route: AdaptedNode[]
}

export type DangerNode = {
  cueId: string
  cueTitle: string
  nodeLabel: string
  meters: Point
  dangers: string[]
}

export type AdaptedScene = {
  key: string
  act: string
  scene: string
  cues: AdaptedCue[]
  dangerNodes: DangerNode[]
}

export const BASELINE_VENUE_ID = 'V-SH'

export const seedVenues: Venue[] = [
  {
    id: BASELINE_VENUE_ID,
    name: '上海大剧院 · 大剧场',
    kind: '大剧场',
    prosceniumWidth: 18,
    stageDepth: 21,
    wingMargin: 1.2,
    liftZones: [{ id: 'L1', label: '主升降台', x: 6.3, y: 6.3, w: 5.4, h: 5.2 }],
    pitZone: { id: 'P1', label: '乐池', x: 0, y: 19.6, w: 18, h: 1.4 },
    readonly: true,
  },
  {
    id: 'V-HZ',
    name: '杭州运河艺术中心 · 黑匣子',
    kind: '小剧场',
    prosceniumWidth: 9.6,
    stageDepth: 11,
    wingMargin: 0.8,
    liftZones: [
      { id: 'L1', label: '中央升降台', x: 3.4, y: 3.2, w: 2.8, h: 2.6 },
      { id: 'L2', label: '后区升降台', x: 6.6, y: 7.2, w: 2.2, h: 2 },
    ],
    pitZone: { id: 'P1', label: '乐池', x: 0, y: 9.9, w: 9.6, h: 1.1 },
    readonly: false,
  },
]

const round1 = (value: number) => Math.round(value * 10) / 10
const round2 = (value: number) => Math.round(value * 100) / 100

function inside(point: Point, zone: Zone) {
  return point.x >= zone.x && point.x <= zone.x + zone.w && point.y >= zone.y && point.y <= zone.y + zone.h
}

/** 百分比坐标 → 指定场地米制坐标 */
export function pointToMeters(point: Point, venue: Venue): Point {
  return { x: (point.x / 100) * venue.prosceniumWidth, y: (point.y / 100) * venue.stageDepth }
}

/** 米制坐标 → 指定场地百分比坐标 */
export function metersToPoint(meters: Point, venue: Venue): Point {
  return {
    x: round1((meters.x / venue.prosceniumWidth) * 100),
    y: round1((meters.y / venue.stageDepth) * 100),
  }
}

/** 检测米制坐标在目标场地中命中的危险区 */
export function dangersAt(meters: Point, venue: Venue): string[] {
  const dangers: string[] = []
  if (meters.x < 0 || meters.x > venue.prosceniumWidth || meters.y < 0 || meters.y > venue.stageDepth) {
    dangers.push('舞台边界外')
  }
  if (meters.x >= 0 && meters.x < venue.wingMargin) dangers.push('左侧幕区')
  if (meters.x > venue.prosceniumWidth - venue.wingMargin && meters.x <= venue.prosceniumWidth) dangers.push('右侧幕区')
  for (const zone of venue.liftZones) {
    if (inside(meters, zone)) dangers.push(`升降台禁入区 · ${zone.label}`)
  }
  if (inside(meters, venue.pitZone)) dangers.push('乐池范围')
  return dangers
}

/** 把基线场地的一个百分比坐标换算到目标场地，并做危险区检测 */
export function adaptPoint(point: Point, from: Venue, to: Venue): AdaptedNode {
  const meters = pointToMeters(point, from)
  return {
    point: metersToPoint(meters, to),
    meters: { x: round2(meters.x), y: round2(meters.y) },
    dangers: dangersAt(meters, to),
  }
}

export function adaptCue(cue: Cue, from: Venue, to: Venue): AdaptedCue {
  return {
    cueId: cue.id,
    entry: adaptPoint(cue.entry, from, to),
    exit: adaptPoint(cue.exit, from, to),
    route: cue.route.map((point) => adaptPoint(point, from, to)),
  }
}

/** 按场景分组换算一组提示，并汇总危险节点 */
export function buildScene(key: string, cues: Cue[], from: Venue, to: Venue): AdaptedScene {
  const dangerNodes: DangerNode[] = []
  const adapted = cues.map((cue) => {
    const adaptedCue = adaptCue(cue, from, to)
    adaptedCue.route.forEach((node, index) => {
      if (!node.dangers.length) return
      const nodeLabel = index === 0 ? '入场点' : index === adaptedCue.route.length - 1 ? '退场点' : `路线节点 ${index}`
      dangerNodes.push({ cueId: cue.id, cueTitle: cue.title, nodeLabel, meters: node.meters, dangers: node.dangers })
    })
    return adaptedCue
  })
  const [act, scene] = key.split('/')
  return { key, act, scene, cues: adapted, dangerNodes }
}

const STORAGE_KEY = 'stage-scheduler-venues-v1'

type VenueDraft = {
  venues?: Venue[]
  activeVenueId?: string
  sceneLocks?: Record<string, string[]>
}

export const useVenueStore = defineStore('venues', () => {
  const workshop = useWorkshopStore()
  const restored = (() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as VenueDraft | null
    } catch {
      return null
    }
  })()

  const venues = ref<Venue[]>(restored?.venues?.length ? restored.venues : structuredClone(seedVenues))
  const activeVenueId = ref(restored?.activeVenueId ?? 'V-HZ')
  /** 每个场地各自的场景锁定表：venueId -> 已锁定场景 key 列表 */
  const sceneLocks = ref<Record<string, string[]>>(restored?.sceneLocks ?? {})

  const baselineVenue = computed(() => venues.value.find((venue) => venue.id === BASELINE_VENUE_ID) ?? venues.value[0])
  const activeVenue = computed(() => venues.value.find((venue) => venue.id === activeVenueId.value) ?? baselineVenue.value)
  const isBaseline = computed(() => activeVenue.value.id === BASELINE_VENUE_ID)

  // ---- 增量重算：按场景签名缓存，演员/道具/路线变化只重算受影响场景 ----
  const sceneCache = new Map<string, { signature: string; result: AdaptedScene }>()
  const adaptedScenes = ref<AdaptedScene[]>([])
  /** 最近一次重算中实际被重算的场景 key（其余沿用缓存） */
  const lastRecomputed = ref<string[]>([])

  function sceneSignature(cues: Cue[], venue: Venue) {
    return JSON.stringify([cues, venue])
  }

  function recompute() {
    const from = baselineVenue.value
    const to = activeVenue.value
    const groups = new Map<string, Cue[]>()
    for (const cue of workshop.cues) {
      const key = `${cue.act}/${cue.scene}`
      const list = groups.get(key)
      if (list) list.push(cue)
      else groups.set(key, [cue])
    }
    const recomputed: string[] = []
    const scenes: AdaptedScene[] = []
    for (const [key, sceneCues] of groups) {
      const signature = sceneSignature(sceneCues, to)
      const cached = sceneCache.get(key)
      if (cached && cached.signature === signature) {
        scenes.push(cached.result)
        continue
      }
      const result = buildScene(key, sceneCues, from, to)
      sceneCache.set(key, { signature, result })
      scenes.push(result)
      recomputed.push(key)
    }
    adaptedScenes.value = scenes
    lastRecomputed.value = recomputed
  }

  watch([() => workshop.cues, venues, activeVenueId], recompute, { deep: true, immediate: true })

  const adaptedCueMap = computed(() => {
    const map = new Map<string, AdaptedCue>()
    for (const scene of adaptedScenes.value) {
      for (const cue of scene.cues) map.set(cue.cueId, cue)
    }
    return map
  })

  const dangerTotal = computed(() => adaptedScenes.value.reduce((total, scene) => total + scene.dangerNodes.length, 0))

  /** 场景在当前场地的锁定状态：已锁定 / 暂缓锁定（有危险节点）/ 待锁定 */
  function sceneStatus(scene: AdaptedScene): '已锁定' | '暂缓锁定' | '待锁定' {
    if ((sceneLocks.value[activeVenueId.value] ?? []).includes(scene.key)) return '已锁定'
    return scene.dangerNodes.length ? '暂缓锁定' : '待锁定'
  }

  /** 切换场景锁定；存在危险节点时拒绝锁定（暂缓），返回是否成功 */
  function toggleSceneLock(sceneKey: string) {
    if (isBaseline.value) return false
    const scene = adaptedScenes.value.find((item) => item.key === sceneKey)
    if (!scene) return false
    const list = (sceneLocks.value[activeVenueId.value] ??= [])
    const index = list.indexOf(sceneKey)
    if (index >= 0) {
      list.splice(index, 1)
      return true
    }
    if (scene.dangerNodes.length) return false
    list.push(sceneKey)
    return true
  }

  /** 供打印中心使用：为任意场地生成执行版本（不污染当前缓存） */
  function buildScenesFor(venueId: string) {
    const to = venues.value.find((venue) => venue.id === venueId)
    if (!to) return []
    const from = baselineVenue.value
    const groups = new Map<string, Cue[]>()
    for (const cue of workshop.cues) {
      const key = `${cue.act}/${cue.scene}`
      const list = groups.get(key)
      if (list) list.push(cue)
      else groups.set(key, [cue])
    }
    return [...groups.entries()].map(([key, sceneCues]) => buildScene(key, sceneCues, from, to))
  }

  function sceneStatusFor(venueId: string, scene: AdaptedScene) {
    if ((sceneLocks.value[venueId] ?? []).includes(scene.key)) return '已锁定'
    return scene.dangerNodes.length ? '暂缓锁定' : '待锁定'
  }

  function updateVenue(id: string, patch: Partial<Venue>) {
    const venue = venues.value.find((item) => item.id === id)
    if (!venue || venue.readonly) return
    Object.assign(venue, patch)
  }

  function addVenue(input: { name: string; kind: Venue['kind']; prosceniumWidth: number; stageDepth: number; wingMargin: number }) {
    const venue: Venue = {
      id: `V-${Date.now().toString(36).toUpperCase()}`,
      name: input.name,
      kind: input.kind,
      prosceniumWidth: input.prosceniumWidth,
      stageDepth: input.stageDepth,
      wingMargin: input.wingMargin,
      liftZones: [],
      pitZone: { id: 'P1', label: '乐池', x: 0, y: Math.max(input.stageDepth - 1, 0), w: input.prosceniumWidth, h: 1 },
      readonly: false,
    }
    venues.value.push(venue)
    activeVenueId.value = venue.id
  }

  watch(
    [venues, activeVenueId, sceneLocks],
    () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ venues: venues.value, activeVenueId: activeVenueId.value, sceneLocks: sceneLocks.value }),
      )
    },
    { deep: true },
  )

  return {
    venues,
    activeVenueId,
    activeVenue,
    baselineVenue,
    isBaseline,
    adaptedScenes,
    adaptedCueMap,
    dangerTotal,
    lastRecomputed,
    sceneLocks,
    sceneStatus,
    toggleSceneLock,
    buildScenesFor,
    sceneStatusFor,
    updateVenue,
    addVenue,
  }
})
