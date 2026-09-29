<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useWorkshopStore } from '../stores/workshop'
import { useVenueStore, BASELINE_VENUE_ID, type AdaptedCue } from '../stores/venues'

const route = useRoute()
const store = useWorkshopStore()
const venueStore = useVenueStore()
const includeNotes = ref(true)
const includeRoutes = ref(true)
const includeComments = ref(false)

const printVenueId = ref(typeof route.query.venue === 'string' ? route.query.venue : BASELINE_VENUE_ID)
const printVenue = computed(() => venueStore.venues.find((venue) => venue.id === printVenueId.value) ?? venueStore.baselineVenue)
const isBaseline = computed(() => printVenue.value.id === BASELINE_VENUE_ID)

/** 所选场地的执行版本：坐标已按该场地实际尺寸换算 */
const printScenes = computed(() => venueStore.buildScenesFor(printVenueId.value))
const adaptedMap = computed(() => {
  const map = new Map<string, AdaptedCue>()
  for (const scene of printScenes.value) {
    for (const cue of scene.cues) map.set(cue.cueId, cue)
  }
  return map
})
const sceneStatusMap = computed(() => {
  const map = new Map<string, string>()
  for (const scene of printScenes.value) map.set(scene.key, venueStore.sceneStatusFor(printVenueId.value, scene))
  return map
})
const dangerNodes = computed(() => printScenes.value.flatMap((scene) => scene.dangerNodes.map((node) => ({ ...node, scene: scene.key }))))

const rows = computed(() =>
  [...store.cues].sort((a, b) => a.time.localeCompare(b.time)).map((cue) => ({
    cue,
    adapted: adaptedMap.value.get(cue.id),
    sceneStatus: sceneStatusMap.value.get(`${cue.act}/${cue.scene}`),
  })),
)

function routeText(cueId: string) {
  const adapted = adaptedMap.value.get(cueId)
  if (!adapted) return ''
  return adapted.route
    .map((node, index) => {
      const label = `${index + 1}. ${node.point.x}/${node.point.y}`
      return isBaseline.value ? label : `${label}（${node.meters.x}m/${node.meters.y}m）`
    })
    .join(' → ')
}

function nodeDanger(cueId: string, index: number) {
  const adapted = adaptedMap.value.get(cueId)
  return adapted?.route[index]?.dangers.length ? adapted.route[index].dangers.join('、') : ''
}

function nodeMeters(cueId: string, index: number) {
  const node = adaptedMap.value.get(cueId)?.route[index]
  return node ? `（${node.meters.x}m/${node.meters.y}m）` : ''
}

function print() {
  window.print()
}

function exportCsv() {
  const data = [
    ['编号', '时间码', '场景', '提示', '部门', '责任', '路线节点', isBaseline.value ? '状态' : '场景锁定'],
    ...rows.value.map(({ cue, sceneStatus }) => [
      cue.id,
      cue.time,
      `${cue.act}/${cue.scene}`,
      cue.title,
      cue.department,
      cue.owner,
      routeText(cue.id),
      isBaseline.value ? cue.status : sceneStatus,
    ]),
  ]
  const csv = `\uFEFF${data.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')}`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `潮汐来信-走位表-${printVenue.value.name}-${store.revision}.csv`
  link.click()
  URL.revokeObjectURL(url)
  ElMessage.success('走位表已导出')
}
</script>

<template>
  <section class="page print-page">
    <div class="page-head no-print">
      <div>
        <p class="eyebrow">PRINT / 演出文档</p>
        <h1>走位表与执行清单</h1>
        <p class="muted">每个场地生成独立执行版本；原场地基线只读，目标场地坐标已按实际台口尺寸换算。</p>
      </div>
      <div class="actions">
        <el-button @click="exportCsv">导出 CSV</el-button>
        <el-button type="primary" @click="print">打印 / 导出 PDF</el-button>
      </div>
    </div>

    <div class="print-options panel no-print">
      <strong>场地版本</strong>
      <el-select v-model="printVenueId" size="small" style="width: 260px">
        <el-option v-for="venue in venueStore.venues" :key="venue.id" :label="`${venue.name}${venue.readonly ? '（基线 · 只读）' : ''}`" :value="venue.id" />
      </el-select>
      <el-divider direction="vertical" />
      <el-checkbox v-model="includeNotes">执行说明</el-checkbox>
      <el-checkbox v-model="includeRoutes">路线坐标</el-checkbox>
      <el-checkbox v-model="includeComments">未解决留言</el-checkbox>
      <span class="print-revision">版本 {{ store.revision }} · 生成于 {{ new Date().toLocaleString('zh-CN') }}</span>
    </div>

    <article class="print-sheet">
      <header class="sheet-head">
        <div>
          <span>远岸剧团 · STAGE MANAGEMENT</span>
          <h2>《潮汐来信》执行清单 · {{ printVenue.name }}</h2>
        </div>
        <dl>
          <div><dt>排练日</dt><dd>2026-10-08</dd></div>
          <div><dt>版本</dt><dd>{{ store.revision }}</dd></div>
          <div><dt>场地</dt><dd>{{ printVenue.name }}{{ isBaseline ? '（基线 · 只读）' : '（执行版本）' }}</dd></div>
          <div v-if="!isBaseline"><dt>台口</dt><dd>{{ printVenue.prosceniumWidth }}m × {{ printVenue.stageDepth }}m</dd></div>
        </dl>
      </header>

      <table>
        <thead>
          <tr>
            <th>时间码</th>
            <th>幕 / 场</th>
            <th>执行提示</th>
            <th>部门 / 责任</th>
            <th>时长</th>
            <th>{{ isBaseline ? '状态' : '场景锁定' }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="{ cue, sceneStatus } in rows" :key="cue.id">
            <td class="mono">{{ cue.time }}</td>
            <td>{{ cue.act }} / {{ cue.scene }}</td>
            <td>
              <strong>{{ cue.id }} · {{ cue.title }}</strong>
              <p v-if="includeNotes">{{ cue.note }}</p>
              <small v-if="includeRoutes">
                路线：
                <template v-for="(point, index) in cue.route" :key="index">
                  <span :class="{ 'danger-node': nodeDanger(cue.id, index) }" :title="nodeDanger(cue.id, index)">
                    {{ index + 1 }}. {{ point.x }}/{{ point.y }}{{ isBaseline ? '' : nodeMeters(cue.id, index) }}{{ nodeDanger(cue.id, index) ? ' ⚠' : '' }}
                  </span>
                  {{ index < cue.route.length - 1 ? ' → ' : '' }}
                </template>
              </small>
              <em v-if="includeComments && cue.comments.length">{{ cue.comments.filter((item) => !item.resolved).length }} 条未解决留言</em>
            </td>
            <td>{{ cue.department }}<br /><small>{{ cue.owner }}</small></td>
            <td>{{ cue.duration }} 秒</td>
            <td>
              <span v-if="isBaseline">{{ cue.status }}</span>
              <span v-else :class="{ 'deferred-tag': sceneStatus === '暂缓锁定' }">{{ sceneStatus }}</span>
            </td>
          </tr>
        </tbody>
      </table>

      <section v-if="dangerNodes.length" class="danger-appendix">
        <h3>危险区节点清单（{{ dangerNodes.length }}）</h3>
        <p class="muted">以下节点在「{{ printVenue.name }}」落入侧幕、升降台禁入区或乐池，所属场景已暂缓锁定，调整前请按基线版本执行。</p>
        <table>
          <thead>
            <tr>
              <th>场景</th>
              <th>提示</th>
              <th>节点</th>
              <th>实测位置</th>
              <th>命中区域</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(node, index) in dangerNodes" :key="index">
              <td>{{ node.scene }}</td>
              <td>{{ node.cueId }} · {{ node.cueTitle }}</td>
              <td>{{ node.nodeLabel }}</td>
              <td class="mono">{{ node.meters.x }}m / {{ node.meters.y }}m</td>
              <td>{{ node.dangers.join('、') }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <footer class="sheet-foot">
        <span>舞台监督：________________</span>
        <span>技术总监：________________</span>
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
  gap: 14px;
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
  margin: 0 auto;
  padding: 34px;
  background: #fff;
  box-shadow: 0 12px 34px rgb(35 54 65 / 12%);
}

.sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding-bottom: 18px;
  border-bottom: 3px solid #173846;
}

.sheet-head span {
  color: #697985;
  font-size: 10px;
  letter-spacing: 0.15em;
}

.sheet-head h2 {
  margin: 8px 0 0;
  font-size: 25px;
}

.sheet-head dl {
  display: flex;
  gap: 22px;
  margin: 0;
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

table {
  width: 100%;
  margin-top: 20px;
  border-collapse: collapse;
  font-size: 12px;
}

th {
  padding: 10px 8px;
  color: #fff;
  text-align: left;
  background: #1c4251;
}

td {
  padding: 11px 8px;
  border-bottom: 1px solid #dfe5e8;
  vertical-align: top;
}

td strong,
td small,
td em {
  display: block;
}

td p {
  margin: 5px 0 0;
  color: #56636d;
  line-height: 1.5;
}

td small {
  margin-top: 6px;
  color: #7e8991;
}

td em {
  margin-top: 5px;
  color: #b05a2b;
  font-style: normal;
}

.mono {
  color: #1d7371;
  font-family: ui-monospace, monospace;
  font-weight: 700;
}

.danger-node {
  color: #bd4b3f;
  font-weight: 700;
}

.deferred-tag {
  color: #bd4b3f;
  font-weight: 700;
}

.danger-appendix {
  margin-top: 26px;
  padding-top: 14px;
  border-top: 2px solid #c0503f;
}

.danger-appendix h3 {
  margin: 0 0 6px;
  color: #a03e2f;
  font-size: 15px;
}

.danger-appendix .muted {
  font-size: 12px;
}

.sheet-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 48px;
  padding-top: 14px;
  border-top: 1px solid #dce2e5;
  color: #69757e;
  font-size: 11px;
}

@media print {
  @page {
    size: A4 landscape;
    margin: 12mm;
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
    padding: 0;
    box-shadow: none;
  }

  th {
    color: #111;
    background: #e8ecee;
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
