<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useWorkshopStore } from '../stores/workshop'
import type { Venue } from '../stores/venues'

const store = useWorkshopStore()
const includeNotes = ref(true)
const includeRoutes = ref(true)
const includeComments = ref(false)
const includeWarnings = ref(true)

const selectedVenueIds = ref<string[]>([store.baselineVenue.id, ...store.tourVenues.map((venue) => venue.id)])

const sheets = computed(() =>
  store.venues
    .filter((venue) => selectedVenueIds.value.includes(venue.id))
    .map((venue) => buildSheet(venue)),
)

function buildSheet(venue: Venue) {
  const adapted = store.adaptedCuesFor(venue.id)
  const byId = new Map(adapted.map((item) => [item.cue.id, item]))
  const rows = [...store.cues]
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((cue) => {
      const item = byId.get(cue.id)!
      return { cue, item }
    })
  const statuses = store.sceneStatusesFor(venue.id)
  const suspendedScenes = statuses.filter((status) => status.suspended)
  const pendingScenes = new Set(adapted.filter((item) => item.pendingAdaptation).map((item) => item.scene))
  const staleScenes = new Set(
    adapted.filter((item) => item.stale && !item.pendingAdaptation).map((item) => item.scene),
  )
  return {
    venue,
    rows,
    statuses,
    suspendedScenes,
    pendingScenes,
    staleScenes,
    adaptedAt: store.adaptedAt[venue.id] as string | undefined,
  }
}

type Sheet = ReturnType<typeof buildSheet>

function print() {
  if (!sheets.value.length) {
    ElMessage.warning('请至少选择一个场地')
    return
  }
  window.print()
}

function exportCsv() {
  sheets.value.forEach((sheet) => {
    const rows = [
      ['编号', '时间码', '场景', '提示', '部门', '责任', '入场 x/d(m)', '退场 x/d(m)', '路线节点 x/d(m)', '危险区节点', '场景锁定状态', '换算状态', '状态'],
      ...sheet.rows.map(({ cue, item }) => [
        cue.id,
        cue.time,
        `${cue.act}/${cue.scene}`,
        cue.title,
        cue.department,
        cue.owner,
        formatPoint(item.nodes.find((node) => node.kind === 'entry')!.point),
        formatPoint(item.nodes.find((node) => node.kind === 'exit')!.point),
        item.nodes
          .filter((node) => node.kind === 'route')
          .map((node) => formatPoint(node.point))
          .join(' > '),
        item.dangerNodes.map((node) => `${node.label}:${node.hazards.map((hit) => hit.label).join('/')}`).join('；') || '—',
        sheet.suspendedScenes.some((status) => status.scene === item.scene)
          ? '暂缓锁定'
          : sheet.statuses.find((status) => status.scene === item.scene)?.locked
            ? '已锁定'
            : '未锁定',
        item.pendingAdaptation ? '待换算' : item.stale ? '待重算' : '已换算',
        cue.status,
      ]),
    ]
    const csv = `﻿${rows.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `潮汐来信-走位执行表-${fileSafe(sheet.venue)}-${store.revision}.csv`
    link.click()
    URL.revokeObjectURL(url)
  })
  ElMessage.success(`已导出 ${sheets.value.length} 个场地的执行表`)
}

function fileSafe(venue: Venue) {
  return venue.shortName.replace(/[·\s]/g, '')
}

function formatPoint(point: { x: number; d: number }) {
  return `${point.x.toFixed(1)}/${point.d.toFixed(1)}`
}

function sceneLockState(sheet: Sheet, scene: string) {
  const status = sheet.statuses.find((item) => item.scene === scene)
  if (status?.suspended) return { text: '暂缓锁定（危险区）', cls: 'suspended' }
  if (status?.locked) return { text: '执行版已锁定', cls: 'locked' }
  return { text: '未锁定', cls: '' }
}
</script>

<template>
  <section class="page print-page">
    <div class="page-head no-print">
      <div>
        <p class="eyebrow">PRINT / 演出文档</p>
        <h1>走位表与执行清单</h1>
        <p class="muted">基线场地与各巡演场地分别生成执行版；含实测坐标、危险区节点与场景锁定状态。</p>
      </div>
      <div class="actions">
        <el-button @click="exportCsv">导出 CSV（每场地一份）</el-button>
        <el-button type="primary" @click="print">打印 / 导出 PDF</el-button>
      </div>
    </div>

    <div class="print-options panel no-print">
      <strong>输出场地</strong>
      <el-checkbox-group v-model="selectedVenueIds">
        <el-checkbox v-for="venue in store.venues" :key="venue.id" :label="venue.id">
          {{ venue.shortName }}<template v-if="venue.baseline">（基线）</template>
        </el-checkbox>
      </el-checkbox-group>
      <el-divider direction="vertical" />
      <el-checkbox v-model="includeNotes">执行说明</el-checkbox>
      <el-checkbox v-model="includeRoutes">实测路线坐标</el-checkbox>
      <el-checkbox v-model="includeWarnings">侧幕预警</el-checkbox>
      <el-checkbox v-model="includeComments">未解决留言</el-checkbox>
      <span class="print-revision">版本 {{ store.revision }} · 生成于 {{ new Date().toLocaleString('zh-CN') }}</span>
    </div>

    <article v-for="sheet in sheets" :key="sheet.venue.id" class="print-sheet">
      <header class="sheet-head">
        <div>
          <span>远岸剧团 · STAGE MANAGEMENT · 场地执行版</span>
          <h2>《潮汐来信》执行清单 · {{ sheet.venue.name }}</h2>
          <p class="sheet-dims">
            台口宽 {{ sheet.venue.prosceniumWidth }}m · 台口深 {{ sheet.venue.stageDepth }}m ·
            升降台禁入区 {{ sheet.venue.zones.filter((z) => z.type === 'lift').length }} 处 ·
            乐池 {{ sheet.venue.zones.filter((z) => z.type === 'pit').length }} 处 ·
            侧幕余量 {{ sheet.venue.wingMargin }}m
            <template v-if="sheet.venue.baseline"> · 原场地基线（只读主数据）</template>
          </p>
        </div>
        <dl>
          <div><dt>版本</dt><dd>{{ store.revision }}</dd></div>
          <div><dt>换算时间</dt><dd>{{ sheet.adaptedAt ? new Date(sheet.adaptedAt).toLocaleDateString('zh-CN') : '未换算' }}</dd></div>
          <div><dt>场地</dt><dd>{{ sheet.venue.shortName }}</dd></div>
        </dl>
      </header>

      <section v-if="sheet.suspendedScenes.length" class="hazard-summary print-hazard">
        <h3>危险区节点单列（暂缓场景锁定）</h3>
        <div v-for="status in sheet.suspendedScenes" :key="status.scene" class="hazard-group">
          <strong>{{ status.scene }}</strong>
          <ul>
            <li v-for="entry in status.dangerNodes" :key="`${entry.cue.id}-${entry.node.kind}-${entry.node.index}`">
              {{ entry.cue.id }} {{ entry.node.label }}（{{ formatPoint(entry.node.point) }}m）：
              {{ entry.node.hazards.map((hit) => hit.label).join('、') }}
              <em v-if="entry.node.overridden">已现场修正</em>
            </li>
          </ul>
        </div>
      </section>

      <div v-if="sheet.pendingScenes.size || sheet.staleScenes.size" class="stale-banner print-hazard">
        <strong v-if="sheet.pendingScenes.size">⚠ {{ [...sheet.pendingScenes].join('、') }} 尚未按本场地换算；</strong>
        <strong v-if="sheet.staleScenes.size">{{ [...sheet.staleScenes].join('、') }} 的走位/演员/道具已变化，坐标待重算。</strong>
        本版坐标仅供排练参考，不可作为装台锁定依据。
      </div>

      <table>
        <thead>
          <tr>
            <th>时间码</th>
            <th>幕 / 场</th>
            <th>执行提示</th>
            <th>实测节点（x/d · 米）</th>
            <th>部门 / 责任</th>
            <th>时长</th>
            <th>场地状态</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="({ cue, item }) in sheet.rows"
            :key="cue.id"
            :class="{ 'row-danger': item.dangerNodes.length, 'row-stale': item.stale, 'row-locked': sceneLockState(sheet, item.scene).cls === 'locked' }"
          >
            <td class="mono">{{ cue.time }}</td>
            <td>{{ cue.act }} / {{ cue.scene }}</td>
            <td>
              <strong>{{ cue.id }} · {{ cue.title }}</strong>
              <p v-if="includeNotes">{{ cue.note }}</p>
              <ul v-if="item.dangerNodes.length" class="print-danger-list">
                <li v-for="node in item.dangerNodes" :key="`${node.kind}-${node.index}`">
                  ⛔ {{ node.label }} ({{ formatPoint(node.point) }}) {{ node.hazards.map((hit) => hit.label).join('、') }}
                </li>
              </ul>
              <ul v-else-if="includeWarnings && item.warningNodes.length" class="print-warning-list">
                <li v-for="node in item.warningNodes" :key="`${node.kind}-${node.index}`">
                  △ {{ node.label }} ({{ formatPoint(node.point) }}) 靠近侧幕
                </li>
              </ul>
              <em v-if="includeComments && cue.comments.length">{{ cue.comments.filter((c) => !c.resolved).length }} 条未解决留言</em>
            </td>
            <td class="mono small-cell">
              <template v-if="includeRoutes">
                <div v-for="node in item.nodes" :key="`${node.kind}-${node.index}`" :class="{ dn: node.danger, wn: node.warning && !node.danger }">
                  {{ node.label }} {{ formatPoint(node.point) }}<i v-if="node.overridden">改</i>
                </div>
              </template>
              <template v-else>
                入 {{ formatPoint(item.nodes.find((n) => n.kind === 'entry')!.point) }}<br />
                出 {{ formatPoint(item.nodes.find((n) => n.kind === 'exit')!.point) }}
              </template>
            </td>
            <td>{{ cue.department }}<br /><small>{{ cue.owner }}</small></td>
            <td>{{ cue.duration }} 秒</td>
            <td>
              <el-tag
                :type="sceneLockState(sheet, item.scene).cls === 'suspended' ? 'danger' : sceneLockState(sheet, item.scene).cls === 'locked' ? 'success' : 'info'"
                size="small"
                effect="plain"
              >{{ sceneLockState(sheet, item.scene).text }}</el-tag>
              <small v-if="item.pendingAdaptation" class="state-pending">待换算</small>
              <small v-else-if="item.stale" class="state-stale">待重算</small>
            </td>
          </tr>
        </tbody>
      </table>

      <footer class="sheet-foot">
        <span>舞台监督：________________</span>
        <span>技术总监：________________</span>
        <span>场地机械：________________</span>
        <span>制作人：________________</span>
      </footer>
    </article>
  </section>
</template>

<style scoped>
.print-page {
  background: #e8ecee;
}

.print-options {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 14px;
  padding: 12px 15px;
}

.print-revision {
  margin-left: auto;
  color: #74818c;
  font-size: 12px;
}

.print-sheet {
  max-width: 1180px;
  min-height: 600px;
  margin: 0 auto 22px;
  padding: 34px;
  background: #fff;
  box-shadow: 0 12px 34px rgb(35 54 65 / 12%);
  page-break-after: always;
}

.sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding-bottom: 16px;
  border-bottom: 3px solid #173846;
}

.sheet-head span {
  color: #697985;
  font-size: 10px;
  letter-spacing: 0.12em;
}

.sheet-head h2 {
  margin: 8px 0 4px;
  font-size: 22px;
}

.sheet-dims {
  margin: 0;
  color: #56636d;
  font-size: 12px;
}

.sheet-head dl {
  display: flex;
  gap: 22px;
  margin: 0;
  white-space: nowrap;
}

.sheet-head dt {
  color: #818c95;
  font-size: 10px;
}

.sheet-head dd {
  margin: 4px 0 0;
  font-size: 12px;
  font-weight: 700;
}

.hazard-summary {
  margin-top: 14px;
  padding: 12px 14px;
  border: 1px solid #e3a89f;
  border-radius: 6px;
  background: #fdf1ef;
}

.hazard-summary h3 {
  margin: 0 0 8px;
  color: #b03a2c;
  font-size: 13px;
}

.hazard-group {
  margin-bottom: 6px;
  font-size: 12px;
}

.hazard-group ul {
  margin: 4px 0 0;
  padding-left: 18px;
}

.hazard-group li {
  color: #8c3b31;
}

.hazard-group em {
  color: #2f8d88;
  font-style: normal;
}

.stale-banner {
  margin-top: 12px;
  padding: 10px 14px;
  border-radius: 6px;
  color: #8a5a10;
  background: #fdf4dd;
  font-size: 12px;
  line-height: 1.7;
}

table {
  width: 100%;
  margin-top: 16px;
  border-collapse: collapse;
  font-size: 12px;
}

th {
  padding: 9px 8px;
  color: #fff;
  text-align: left;
  background: #1c4251;
}

td {
  padding: 10px 8px;
  border-bottom: 1px solid #dfe5e8;
  vertical-align: top;
}

tr.row-danger td {
  background: #fdf0ee;
}

tr.row-stale td {
  background: #fff9ec;
}

tr.row-locked td:first-child {
  border-left: 3px solid #4b9d72;
}

td strong,
td small,
td em,
td small.cell {
  display: block;
}

td p {
  margin: 5px 0 0;
  color: #56636d;
  line-height: 1.5;
}

.print-danger-list,
.print-warning-list {
  margin: 5px 0 0;
  padding-left: 16px;
}

.print-danger-list li {
  color: #b03a2c;
}

.print-warning-list li {
  color: #94671d;
}

td em {
  margin-top: 5px;
  color: #b05a2b;
  font-style: normal;
}

.small-cell {
  font-size: 11px;
  line-height: 1.7;
}

.small-cell .dn {
  color: #c0392b;
  font-weight: 700;
}

.small-cell .wn {
  color: #9b6c1c;
}

.small-cell i {
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 3px;
  color: #fff;
  background: #2f8d88;
  font-size: 9px;
  font-style: normal;
}

.state-pending,
.state-stale {
  display: block;
  margin-top: 4px;
  font-weight: 700;
}

.state-pending {
  color: #6b7883;
}

.state-stale {
  color: #b0781c;
}

.mono {
  color: #1d7371;
  font-family: ui-monospace, monospace;
  font-weight: 700;
}

.sheet-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 36px;
  padding-top: 14px;
  border-top: 1px solid #dce2e5;
  color: #69757e;
  font-size: 11px;
}

@media print {
  @page {
    size: A4 landscape;
    margin: 10mm;
  }

  .no-print {
    display: none !important;
  }

  .print-page {
    padding: 0;
    background: #fff;
  }

  .print-sheet {
    max-width: none;
    margin: 0;
    padding: 0;
    box-shadow: none;
  }

  th {
    color: #111;
    background: #e8ecee;
  }

  .print-hazard {
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
}

@media (max-width: 760px) {
  .print-options {
    align-items: flex-start;
    flex-direction: column;
  }

  .print-revision {
    margin-left: 0;
  }

  .print-sheet {
    overflow-x: auto;
    padding: 18px;
  }

  .sheet-head {
    flex-direction: column;
  }

  .sheet-head dl {
    flex-wrap: wrap;
  }
}
</style>
