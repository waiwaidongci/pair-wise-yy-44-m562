// 场地适配领域模型：
// - 每个场地登记台口宽深、升降台禁入区、乐池范围与侧幕安全余量
// - 原场地基线（上海大剧院）只读，走位主数据始终以基线归一化坐标（0~100）保存
// - 切换场地时按实测尺寸把入场点 / 路线节点 / 退场点换算为实际米制坐标
//
// 实测坐标系（米）：原点在台面上口中点（上场中线）
//   x：向右为正（观众视角左侧），台口内范围 [-W/2, W/2]
//   d：向观众方向为正，d=0 为上场边沿，d=D 为台口沿线；乐池 d > D

import type { Point } from './workshop'

export type PhysPoint = { x: number; d: number }

export type ZoneType = 'lift' | 'pit'
export type HazardLevel = 'danger' | 'warning'

export type HazardZone = {
  id: string
  label: string
  type: ZoneType
  level: HazardLevel
  /** 左边缘 x（米） */
  x: number
  /** 宽度（米，向舞台右方向） */
  width: number
  /** 上场侧边缘 d（米） */
  d: number
  /** 纵深（米，向观众方向） */
  depth: number
}

export type Venue = {
  id: string
  name: string
  shortName: string
  /** 基线场地：主数据的唯一来源，几何与勘测数据只读 */
  baseline?: boolean
  /** 台口宽（米） */
  prosceniumWidth: number
  /** 台口深：上场边沿到台口沿线（米） */
  stageDepth: number
  /** 侧幕安全余量：距台口边沿该距离内的节点给出靠近侧幕预警（米） */
  wingMargin: number
  zones: HazardZone[]
  note: string
}

export type HazardHit = {
  kind: 'lift' | 'pit' | 'wing' | 'offstage'
  level: HazardLevel
  label: string
  zoneId?: string
}

export const NODE_KINDS = {
  entry: '入场点',
  route: '路线节点',
  exit: '退场点',
} as const

/** 基线归一化坐标（0~100）-> 场地实测米制坐标 */
export function toPhysical(venue: Venue, point: Point): PhysPoint {
  return {
    x: round1((point.x / 100 - 0.5) * venue.prosceniumWidth),
    d: round1((point.y / 100) * venue.stageDepth),
  }
}

/** 场地实测米制坐标 -> 基线归一化坐标（在适配场地上补录节点时用） */
export function toNormalized(venue: Venue, point: PhysPoint): Point {
  return {
    x: clamp(Math.round(((point.x / venue.prosceniumWidth) + 0.5) * 100), 0, 100),
    y: clamp(Math.round((point.d / venue.stageDepth) * 100), 0, 100),
  }
}

function inZone(point: PhysPoint, zone: HazardZone) {
  // 包含判定向内收缩 1cm，容忍取整带来的贴边误差：外推到边界外的点按外部处理
  const eps = 0.02
  return (
    point.x >= zone.x + eps &&
    point.x <= zone.x + zone.width - eps &&
    point.d >= zone.d + eps &&
    point.d <= zone.d + zone.depth - eps
  )
}

function inOffstage(venue: Venue, point: PhysPoint) {
  const half = venue.prosceniumWidth / 2
  const eps = 0.02
  return Math.abs(point.x) > half + eps || point.d < -eps || point.d > venue.stageDepth + eps
}

/**
 * 判定节点相对危险区的位置：
 * 台口外 / 乐池 / 升降台为 danger（场景暂缓锁定），侧幕安全余量内为 warning（仅单列提示）。
 */
export function testHazards(venue: Venue, point: PhysPoint): HazardHit[] {
  const half = venue.prosceniumWidth / 2
  const hits: HazardHit[] = []

  const pitZones = venue.zones.filter((zone) => zone.type === 'pit')
  const liftZones = venue.zones.filter((zone) => zone.type === 'lift')

  const inPit = pitZones.find((zone) => inZone(point, zone))

  if (inPit) {
    hits.push({ kind: 'pit', level: inPit.level, label: inPit.label || '乐池范围', zoneId: inPit.id })
  } else if (inOffstage(venue, point)) {
    hits.push({ kind: 'offstage', level: 'danger', label: '台口外 / 侧幕盲区' })
  }

  if (!inPit) {
    const lift = liftZones.find((zone) => inZone(point, zone))
    if (lift) hits.push({ kind: 'lift', level: lift.level, label: lift.label || '升降台禁入区', zoneId: lift.id })
  }

  if (!inPit && !inOffstage(venue, point)) {
    const margin = venue.wingMargin
    if (margin > 0 && (Math.abs(point.x) > half - margin || point.d < margin)) {
      hits.push({ kind: 'wing', level: 'warning', label: '靠近侧幕 / 台口边沿' })
    }
  }

  return hits
}

export function hasDanger(hits: HazardHit[]) {
  return hits.some((hit) => hit.level === 'danger')
}

/**
 * 把节点移到最近的安全位置（台口内、避开乐池与升降台、退出侧幕余量带）。
 * 对每个危险区枚举四个轴向外推候选，选全局最近且对全部危险区安全的点；
 * 全部失败时回退到台面内侧边缘候选。
 */
export function nearestSafe(venue: Venue, point: PhysPoint): PhysPoint {
  const half = venue.prosceniumWidth / 2
  const eps = 0.05

  const dangerous = (candidate: PhysPoint) =>
    testHazards(venue, candidate).some((hit) => hit.kind !== 'wing')
  const inWing = (candidate: PhysPoint) =>
    testHazards(venue, candidate).some((hit) => hit.kind === 'wing')

  const candidates: PhysPoint[] = []
  venue.zones.forEach((zone) => {
    candidates.push(
      { x: zone.x - eps, d: point.d },
      { x: zone.x + zone.width + eps, d: point.d },
      { x: point.x, d: zone.d - eps },
      { x: point.x, d: zone.d + zone.depth + eps },
    )
  })
  // 台口外 / 乐池外伸入观众侧时的台面内夹回候选
  candidates.push(
    { x: clamp(point.x, -half + eps, half - eps), d: Math.min(point.d, venue.stageDepth - eps) },
    { x: clamp(point.x, -half + eps, half - eps), d: clamp(point.d, eps, venue.stageDepth - eps) },
  )

  const inside = (candidate: PhysPoint) =>
    Math.abs(candidate.x) <= half && candidate.d >= 0 && candidate.d <= venue.stageDepth

  let best: PhysPoint | null = null
  let bestDist = Number.POSITIVE_INFINITY
  candidates.forEach((candidate) => {
    if (!inside(candidate) || dangerous(candidate)) return
    let final = candidate
    if (inWing(final)) {
      const m = venue.wingMargin
      final = {
        x: clamp(final.x, -half + m + eps, half - m - eps),
        d: Math.max(final.d, m + eps),
      }
      if (dangerous(final)) return
    }
    const dist = Math.hypot(final.x - point.x, final.d - point.d)
    if (dist < bestDist) {
      bestDist = dist
      best = final
    }
  })

  if (!best) {
    // 兜底：台面中央偏上场，几何上必然在台面内且不在余量带
    best = { x: 0, d: Math.max(venue.wingMargin + eps, 1) }
  }
  return { x: round1(best.x), d: round1(best.d) }
}

export function formatPhys(point: PhysPoint) {
  return `${point.x.toFixed(1)} / ${point.d.toFixed(1)}`
}

export function sceneKey(act: string, scene: string) {
  return `${act} · ${scene}`
}

/** 乐池向观众侧的最大外伸，用于平面图取景 */
export function pitOverscan(venue: Venue) {
  return Math.max(
    0,
    ...venue.zones
      .filter((zone) => zone.type === 'pit')
      .map((zone) => zone.d + zone.depth - venue.stageDepth),
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function round1(value: number) {
  return Math.round(value * 10) / 10
}

// ---------------------------------------------------------------------------
// 场地登记：基线只读；小剧场按巡演技术勘测表登记
// ---------------------------------------------------------------------------

export const BASELINE_VENUE_ID = 'venue-shgrand'

export const seedVenues: Venue[] = [
  {
    id: BASELINE_VENUE_ID,
    name: '上海大剧院 · 大剧场',
    shortName: '上海大剧院',
    baseline: true,
    prosceniumWidth: 16,
    stageDepth: 12,
    wingMargin: 0.8,
    note: '原场地基线：走位主数据（0~100 归一化坐标）以本场地为准，勘测数据与几何只读。',
    zones: [
      {
        id: 'sh-lift-1',
        label: '主升降台禁入区',
        type: 'lift',
        level: 'danger',
        x: -2,
        width: 4,
        d: 1.6,
        depth: 3,
      },
      {
        id: 'sh-pit-1',
        label: '乐池范围',
        type: 'pit',
        level: 'danger',
        x: -3.2,
        width: 7.2,
        d: 10.4,
        depth: 2.2,
      },
    ],
  },
  {
    id: 'venue-blackbox',
    name: '巡演小剧场 · 窄台口',
    shortName: '巡演小剧场',
    prosceniumWidth: 11,
    stageDepth: 9.5,
    wingMargin: 1.5,
    note: '台口更窄、侧幕余量小；乐池抬升后沿侵入表演区，升降台位置偏上场左。',
    zones: [
      {
        id: 'bb-lift-1',
        label: '小剧场升降台禁入区',
        type: 'lift',
        level: 'danger',
        x: -2.6,
        width: 4,
        d: 0.8,
        depth: 2,
      },
      {
        id: 'bb-pit-1',
        label: '小剧场乐池范围',
        type: 'pit',
        level: 'danger',
        x: -4.4,
        width: 7.4,
        d: 7.6,
        depth: 2,
      },
    ],
  },
]
