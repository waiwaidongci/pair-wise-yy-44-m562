<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useWorkshopStore } from '../stores/workshop'
import type { HazardZone, Venue } from '../stores/venues'

const store = useWorkshopStore()
const activeId = ref(store.activeVenueId)

const venue = computed(() => store.venues.find((item) => item.id === activeId.value) ?? store.baselineVenue)
const statuses = computed(() => store.sceneStatusesFor(venue.value.id))
const adapted = computed(() => store.adaptedCuesFor(venue.value.id))
const pendingCount = computed(() => adapted.value.filter((item) => item.pendingAdaptation).length)
const staleStatuses = computed(() => statuses.value.filter((status) => status.stale && !status.pendingAdaptation))
const suspended = computed(() => statuses.value.filter((status) => status.suspended))
const lockedCount = computed(() => statuses.value.filter((status) => status.locked).length)
const venueLogs = computed(() => store.logs.filter((log) => log.venueId === venue.value.id).slice(0, 8))
const adaptedAt = computed(() => (store.adaptedAt as Record<string, string | undefined>)[venue.value.id])

const draftZone = ref<Omit<HazardZone, 'id'>>({
  label: '',
  type: 'lift',
  level: 'danger',
  x: -2,
  width: 3,
  d: 2,
  depth: 2,
})

function activate() {
  store.setActiveVenue(activeId.value)
  ElMessage.success(`已切换到 ${venue.value.name}`)
}

function adaptAll() {
  const count = store.adaptVenue(venue.value.id)
  ElMessage.success(`已完成全剧 ${count} 条提示的实测尺寸换算`)
}

function recomputeOne(scene: string) {
  const count = store.recomputeScene(venue.value.id, scene)
  ElMessage.success(`已重算「${scene}」${count} 条提示`)
}

function recomputeAll() {
  const result = store.recomputeAffected(venue.value.id)
  if (!result.scenes.length) ElMessage.info('没有待重算场景')
  else ElMessage.success(`已重算 ${result.scenes.length} 个场景 / ${result.count} 条提示`)
}

function lockScene(scene: string, cues: { act: string; scene: string }[]) {
  const first = cues[0]
  if (!first) return
  if (!store.lockScene(venue.value.id, first.act, first.scene)) {
    ElMessage.error(`「${scene}」仍有危险区节点，保持暂缓锁定`)
    return
  }
  ElMessage.success(`「${scene}」${venue.value.shortName}执行版已锁定`)
}

function unlockScene(scene: string, cues: { act: string; scene: string }[]) {
  const first = cues[0]
  if (first) store.unlockScene(venue.value.id, first.act, first.scene)
}

function updateField(key: 'prosceniumWidth' | 'stageDepth' | 'wingMargin' | 'name' | 'note', value: number | string) {
  store.updateVenueSurvey(venue.value.id, { [key]: value } as Partial<Venue>)
}

function addZone() {
  if (!draftZone.value.label.trim()) {
    ElMessage.warning('请先填写区域名称')
    return
  }
  store.addVenueZone(venue.value.id, { ...draftZone.value, id: `zone-${Date.now()}` })
  draftZone.value.label = ''
  ElMessage.success('危险区已登记，全部场景标记为待重算')
}

function removeZone(zoneId: string) {
  store.removeVenueZone(venue.value.id, zoneId)
}

async function removeVenue() {
  if (venue.value.baseline) return
  await ElMessageBox.confirm(`删除场地「${venue.value.name}」及其执行版本与锁定记录？基线主数据不受影响。`, '确认删除', {
    type: 'warning',
  })
  store.removeVenue(venue.value.id)
  activeId.value = store.activeVenueId
}

function hazardNames(status: { dangerNodes: Array<{ node: { hazards: HazardHitLike[] } }> }) {
  const names = new Set(status.dangerNodes.flatMap((item) => item.node.hazards.map((hit) => hit.label)))
  return [...names].join('、')
}

type HazardHitLike = { label: string }
</script>

<template>
  <section class="page venues-page">
    <div class="page-head">
      <div>
        <p class="eyebrow">VENUE FIT / 场地适配</p>
        <h1>场地登记与走位换算</h1>
        <p class="muted">
          原场地基线（上海大剧院）只读；为每个巡演场地登记台口宽深、升降台禁入区与乐池范围，
          切换时按实测尺寸换算入场点、路线节点与退场点。
        </p>
      </div>
      <div class="actions">
        <el-button type="primary" @click="$router.push('/print')">前往打印执行版</el-button>
      </div>
    </div>

    <div class="venue-tabs">
      <button
        v-for="item in store.venues"
        :key="item.id"
        class="venue-tab"
        :class="{ active: item.id === activeId }"
        @click="activeId = item.id"
      >
        <strong>{{ item.shortName }}</strong>
        <small>{{ item.prosceniumWidth }}m × {{ item.stageDepth }}m</small>
        <i v-if="item.baseline" class="tag">基线只读</i>
      </button>
      <el-button plain class="switch-btn" @click="activate">切换为当前工作场地</el-button>
    </div>

    <div class="venue-grid">
      <div class="left-col">
        <section class="panel survey">
          <div class="panel-head">
            <h3>勘测登记 · {{ venue.name }}</h3>
            <el-tag v-if="venue.baseline" type="info" effect="plain">基线只读</el-tag>
            <el-tag v-else type="warning" effect="plain">巡演场地可编辑</el-tag>
          </div>
          <div class="survey-body">
            <div class="survey-row">
              <label>场地名称</label>
              <el-input
                :model-value="venue.name"
                size="small"
                :disabled="!!venue.baseline"
                @update:model-value="updateField('name', $event)"
              />
            </div>
            <div class="survey-row three">
              <label>台口宽（米）</label>
              <el-input-number
                :model-value="venue.prosceniumWidth"
                :min="4"
                :max="30"
                :step="0.1"
                size="small"
                :disabled="!!venue.baseline"
                @update:model-value="updateField('prosceniumWidth', $event ?? 0)"
              />
              <label>台口深（米）</label>
              <el-input-number
                :model-value="venue.stageDepth"
                :min="4"
                :max="30"
                :step="0.1"
                size="small"
                :disabled="!!venue.baseline"
                @update:model-value="updateField('stageDepth', $event ?? 0)"
              />
              <label>侧幕安全余量（米）</label>
              <el-input-number
                :model-value="venue.wingMargin"
                :min="0"
                :max="5"
                :step="0.1"
                size="small"
                :disabled="!!venue.baseline"
                @update:model-value="updateField('wingMargin', $event ?? 0)"
              />
            </div>
            <div class="survey-row">
              <label>技术备注</label>
              <el-input
                type="textarea"
                :rows="2"
                :model-value="venue.note"
                :disabled="!!venue.baseline"
                @update:model-value="updateField('note', $event)"
              />
            </div>
          </div>
        </section>

        <section class="panel zones">
          <div class="panel-head">
            <h3>禁入区与乐池范围（实测米制，原点上场中线）</h3>
          </div>
          <table class="zone-table">
            <thead>
              <tr>
                <th>区域</th>
                <th>类型</th>
                <th>左缘 x</th>
                <th>宽</th>
                <th>上场缘 d</th>
                <th>纵深</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="zone in venue.zones" :key="zone.id" :class="zone.type">
                <td><strong>{{ zone.label }}</strong></td>
                <td>{{ zone.type === 'lift' ? '升降台禁入区' : '乐池范围' }}</td>
                <td>{{ zone.x }}m</td>
                <td>{{ zone.width }}m</td>
                <td>{{ zone.d }}m</td>
                <td>{{ zone.depth }}m</td>
                <td>
                  <el-button v-if="!venue.baseline" link type="danger" size="small" @click="removeZone(zone.id)">删除</el-button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="!venue.baseline" class="zone-add">
            <el-select v-model="draftZone.type" size="small" style="width: 130px">
              <el-option label="升降台禁入区" value="lift" />
              <el-option label="乐池范围" value="pit" />
            </el-select>
            <el-input v-model="draftZone.label" size="small" placeholder="区域名称" style="width: 150px" />
            <el-input-number v-model="draftZone.x" :step="0.5" size="small" controls-position="right" style="width: 104px" />
            <el-input-number v-model="draftZone.width" :min="0.5" :step="0.5" size="small" controls-position="right" style="width: 104px" />
            <el-input-number v-model="draftZone.d" :min="0" :step="0.5" size="small" controls-position="right" style="width: 104px" />
            <el-input-number v-model="draftZone.depth" :min="0.5" :step="0.5" size="small" controls-position="right" style="width: 104px" />
            <el-button type="primary" size="small" @click="addZone">登记区域</el-button>
          </div>
          <p class="muted hint">输入顺序：左缘 x（米）/ 宽度（米）/ 上场侧边缘 d（米）/ 纵深（米，向观众方向）</p>
        </section>

        <section class="panel scene-panel">
          <div class="panel-head">
            <h3>场景锁定状态</h3>
            <div class="head-ops">
              <el-tag type="danger" effect="plain" size="small">暂缓 {{ suspended.length }}</el-tag>
              <el-tag type="success" effect="plain" size="small">已锁 {{ lockedCount }} / {{ statuses.length }}</el-tag>
            </div>
          </div>
          <div class="scene-list">
            <article v-for="status in statuses" :key="status.scene" class="scene-card" :class="{ danger: status.suspended, locked: status.locked }">
              <div class="scene-card-head">
                <strong>{{ status.scene }}</strong>
                <div class="scene-tags">
                  <el-tag v-if="status.pendingAdaptation" type="info" effect="plain" size="small">待换算</el-tag>
                  <el-tag v-else-if="status.stale" type="warning" effect="plain" size="small">待重算</el-tag>
                  <el-tag v-if="status.suspended" type="danger" effect="dark" size="small">暂缓锁定</el-tag>
                  <el-tag v-else-if="status.locked" type="success" effect="dark" size="small">执行版已锁</el-tag>
                  <el-tag v-else type="info" effect="plain" size="small">可锁定</el-tag>
                </div>
              </div>
              <div v-if="status.suspended" class="danger-list">
                <p v-for="item in status.dangerNodes" :key="`${item.cue.id}-${item.node.kind}-${item.node.index}`">
                  <strong>{{ item.cue.id }} {{ item.node.label }}</strong>
                  实测 ({{ item.node.point.x.toFixed(1) }}, {{ item.node.point.d.toFixed(1) }})m ·
                  {{ item.node.hazards.map((h) => h.label).join('、') }}
                  <el-button
                    v-if="!venue.baseline && !status.locked"
                    link
                    type="primary"
                    size="small"
                    @click="store.moveNodeToSafe(venue.id, item.cue.id, item.node)"
                  >移到最近安全点</el-button>
                </p>
              </div>
              <div v-else-if="status.warningNodes.length" class="warning-list">
                侧幕预警 {{ status.warningNodes.length }} 节点（不阻止锁定）：
                {{ status.warningNodes.map((item) => `${item.cue.id} ${item.node.label}`).join('、') }}
              </div>
              <div v-else class="ok-line">全部节点位于安全区域</div>
              <div class="scene-ops">
                <el-button v-if="status.stale && !status.pendingAdaptation" size="small" type="warning" @click="recomputeOne(status.scene)">
                  重算该场景
                </el-button>
                <el-button v-if="status.locked" size="small" :disabled="!!venue.baseline" @click="unlockScene(status.scene, status.cues)">解锁</el-button>
                <el-button
                  v-else-if="!status.suspended && !status.pendingAdaptation"
                  size="small"
                  type="success"
                  plain
                  @click="lockScene(status.scene, status.cues)"
                >锁定执行版</el-button>
                <el-button v-else size="small" disabled>先{{ status.pendingAdaptation ? '完成换算' : '清除危险节点' }}</el-button>
              </div>
            </article>
          </div>
        </section>
      </div>

      <aside class="right-col">
        <section class="panel convert-panel">
          <div class="panel-head"><h3>换算控制</h3></div>
          <div class="convert-body">
            <template v-if="venue.baseline">
              <el-alert type="info" :closable="false" show-icon title="基线场地无需换算" description="主数据归一化坐标即以本场地 16m × 12m 台口为基准；基线锁定后主数据只读。" />
            </template>
            <template v-else>
              <p class="kv"><span>最近换算</span><strong>{{ adaptedAt ? new Date(adaptedAt).toLocaleString('zh-CN') : '尚未换算' }}</strong></p>
              <el-button type="primary" style="width: 100%" @click="adaptAll">
                {{ pendingCount ? `按实测尺寸初次换算（${pendingCount} 条预览）` : '按当前勘测重新换算全剧' }}
              </el-button>
              <el-button
                type="warning"
                plain
                style="width: 100%"
                :disabled="!staleStatuses.length"
                @click="recomputeAll"
              >只重算受影响场景（{{ staleStatuses.length }}）</el-button>
              <p class="muted small">演员、道具或走位变化后，仅受影响场景会被标记；危险区/尺寸修改影响全剧。</p>
            </template>
          </div>
        </section>

        <section class="panel summary-panel">
          <div class="panel-head"><h3>危险区命中汇总</h3></div>
          <div class="summary-body">
            <div v-for="status in statuses" :key="status.scene" class="summary-row">
              <strong>{{ status.scene }}</strong>
              <span :class="status.suspended ? 'red' : status.warningNodes.length ? 'amber' : 'green'">
                {{ status.suspended ? `${status.dangerNodes.length} 节点 · ${hazardNames(status)}` : status.warningNodes.length ? `${status.warningNodes.length} 个侧幕预警` : '安全' }}
              </span>
            </div>
          </div>
        </section>

        <section class="panel log-panel">
          <div class="panel-head"><h3>换算 / 重算记录</h3></div>
          <div class="log-body">
            <div v-for="log in venueLogs" :key="log.id" class="log-row">
              <strong>{{ log.reason }}</strong>
              <small>{{ log.at }}</small>
              <p>{{ log.scenes.join('、') }} · {{ log.cueCount }} 条提示</p>
            </div>
            <el-empty v-if="!venueLogs.length" description="暂无换算记录" :image-size="50" />
          </div>
        </section>

        <el-button v-if="!venue.baseline" type="danger" plain style="width: 100%" @click="removeVenue">删除该巡演场地</el-button>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.venue-tabs {
  display: flex;
  align-items: stretch;
  gap: 10px;
  margin-bottom: 14px;
}

.venue-tab {
  position: relative;
  min-width: 180px;
  padding: 10px 14px;
  border: 1px solid #d5dee3;
  border-radius: 9px;
  text-align: left;
  background: #fff;
  cursor: pointer;
}

.venue-tab.active {
  border-color: #2f8580;
  box-shadow: 0 0 0 2px rgb(47 133 128 / 15%);
}

.venue-tab strong,
.venue-tab small {
  display: block;
}

.venue-tab small {
  margin-top: 3px;
  color: #7d8a95;
}

.venue-tab .tag {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 1px 6px;
  border-radius: 3px;
  color: #6b7883;
  background: #edf1f3;
  font-size: 10px;
  font-style: normal;
}

.switch-btn {
  margin-left: auto;
  align-self: center;
}

.venue-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.6fr);
  gap: 14px;
  align-items: start;
}

.survey-body {
  display: grid;
  gap: 12px;
  padding: 14px;
}

.survey-row {
  display: grid;
  grid-template-columns: 150px 1fr;
  align-items: center;
  gap: 10px;
}

.survey-row.three {
  grid-template-columns: 90px 1fr 70px 1fr 110px 1fr;
}

.survey-row label {
  color: #5d6b78;
  font-size: 12px;
}

.zone-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.zone-table th {
  padding: 8px;
  color: #fff;
  text-align: left;
  background: #33505e;
  font-weight: 600;
}

.zone-table td {
  padding: 8px;
  border-bottom: 1px solid #e6eaec;
}

.zone-table tr.lift td:first-child {
  border-left: 3px solid #cc4f42;
}

.zone-table tr.pit td:first-child {
  border-left: 3px solid #b06d1c;
}

.zone-add {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 14px;
}

.hint {
  padding: 0 14px 12px;
  font-size: 11px;
}

.scene-panel {
  margin-top: 14px;
}

.head-ops {
  display: flex;
  gap: 6px;
}

.scene-list {
  display: grid;
  gap: 10px;
  padding: 14px;
}

.scene-card {
  padding: 12px;
  border: 1px solid #e3e9ec;
  border-radius: 8px;
  background: #fafbfc;
}

.scene-card.danger {
  border-color: #e3aaa4;
  background: #fdf4f3;
}

.scene-card.locked {
  border-color: #9fcab3;
  background: #f2f9f5;
}

.scene-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.scene-tags {
  display: flex;
  gap: 6px;
}

.danger-list {
  margin-top: 8px;
}

.danger-list p {
  margin: 4px 0;
  padding: 6px 8px;
  border-radius: 5px;
  color: #8c3b31;
  background: rgb(204 79 66 / 8%);
  font-size: 12px;
}

.warning-list {
  margin-top: 8px;
  color: #94671d;
  font-size: 12px;
}

.ok-line {
  margin-top: 8px;
  color: #3d8a63;
  font-size: 12px;
}

.scene-ops {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.right-col {
  display: grid;
  gap: 14px;
}

.convert-body,
.summary-body,
.log-body {
  padding: 14px;
}

.convert-body {
  display: grid;
  gap: 10px;
}

.kv {
  display: flex;
  justify-content: space-between;
  margin: 0;
  font-size: 12px;
}

.kv span {
  color: #7a8791;
}

.small {
  font-size: 11px;
  line-height: 1.6;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid #eef2f3;
  font-size: 12px;
}

.summary-row .red {
  color: #c0392b;
}

.summary-row .amber {
  color: #9b6c1c;
}

.summary-row .green {
  color: #3d8a63;
}

.log-row {
  padding: 9px 0;
  border-bottom: 1px solid #eef2f3;
}

.log-row strong,
.log-row small,
.log-row p {
  display: block;
}

.log-row strong {
  font-size: 12px;
}

.log-row small {
  color: #8b969e;
}

.log-row p {
  margin: 3px 0 0;
  color: #5e6d79;
  font-size: 11px;
}

@media (max-width: 1080px) {
  .venue-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .venue-tabs {
    flex-wrap: wrap;
  }

  .switch-btn {
    margin-left: 0;
  }

  .survey-row,
  .survey-row.three {
    grid-template-columns: 1fr;
  }
}
</style>
