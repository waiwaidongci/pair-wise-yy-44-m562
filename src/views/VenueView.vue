<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useWorkshopStore } from '../stores/workshop'
import { useVenueStore, type AdaptedScene, type Venue } from '../stores/venues'

const router = useRouter()
const workshop = useWorkshopStore()
const store = useVenueStore()

const showCreate = ref(false)
const createForm = reactive({
  name: '',
  kind: '小剧场' as Venue['kind'],
  prosceniumWidth: 12,
  stageDepth: 10,
  wingMargin: 0.8,
})

const venue = computed(() => store.activeVenue)
const isBaseline = computed(() => store.isBaseline)

/** 把米制区域换算为当前场地百分比，用于平面图绘制 */
function zoneRect(zone: { x: number; y: number; w: number; h: number }) {
  return {
    x: (zone.x / venue.value.prosceniumWidth) * 100,
    y: (zone.y / venue.value.stageDepth) * 100,
    w: (zone.w / venue.value.prosceniumWidth) * 100,
    h: (zone.h / venue.value.stageDepth) * 100,
  }
}

const wingLeft = computed(() => (venue.value.wingMargin / venue.value.prosceniumWidth) * 100)
const wingRight = computed(() => 100 - wingLeft.value)
const pitRect = computed(() => zoneRect(venue.value.pitZone))
const liftRects = computed(() => venue.value.liftZones.map((zone) => ({ ...zoneRect(zone), label: zone.label })))

const dangerNodes = computed(() => store.adaptedScenes.flatMap((scene) => scene.dangerNodes.map((node) => ({ ...node, scene: scene.key }))))

function switchVenue(id: string) {
  store.activeVenueId = id
}

function locate(cueId: string) {
  workshop.selectedId = cueId
  router.push('/stage')
}

function statusType(scene: AdaptedScene) {
  const status = store.sceneStatus(scene)
  return status === '已锁定' ? 'success' : status === '暂缓锁定' ? 'danger' : 'info'
}

function toggleLock(scene: AdaptedScene) {
  if (!store.toggleSceneLock(scene.key)) {
    ElMessage.warning(isBaseline.value ? '原场地基线只读，请在目标场地执行锁定' : `「${scene.key}」存在危险区节点，已暂缓锁定，请先调整路线`)
  }
}

function printVenue() {
  router.push({ path: '/print', query: { venue: store.activeVenueId } })
}

function patchVenue(patch: Partial<Venue>) {
  store.updateVenue(venue.value.id, patch)
}

/** 数字输入兜底：清空或非法输入时保持原值，避免 NaN 进入场地尺寸 */
function num(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function patchPit(patch: Partial<Venue['pitZone']>) {
  patchVenue({ pitZone: { ...venue.value.pitZone, ...patch } })
}

function addLiftZone() {
  const zones = venue.value.liftZones
  patchVenue({
    liftZones: [
      ...zones,
      { id: `zone${Date.now().toString(36)}`, label: `新禁入区 ${zones.length + 1}`, x: 1, y: 1, w: 2, h: 2 },
    ],
  })
}

function removeLiftZone(id: string) {
  patchVenue({ liftZones: venue.value.liftZones.filter((zone) => zone.id !== id) })
}

function createVenue() {
  if (!createForm.name.trim()) {
    ElMessage.warning('请填写场地名称')
    return
  }
  store.addVenue({ ...createForm, name: createForm.name.trim() })
  showCreate.value = false
  createForm.name = ''
  ElMessage.success('场地已登记，走位已按实际尺寸换算')
}
</script>

<template>
  <section class="page venue-page">
    <div class="page-head">
      <div>
        <p class="eyebrow">VENUE / 场地适配</p>
        <h1>按实际场地尺寸换算走位</h1>
        <p class="muted">原场地基线只读；切换场地后入场点、路线节点与退场点按台口实际宽深换算，危险区节点单独列出。</p>
      </div>
      <div class="actions">
        <el-button @click="showCreate = true">登记新场地</el-button>
        <el-button type="primary" @click="printVenue">打印当前场地执行版本</el-button>
      </div>
    </div>

    <div class="venue-cards">
      <button
        v-for="item in store.venues"
        :key="item.id"
        class="venue-card"
        :class="{ active: item.id === store.activeVenueId }"
        @click="switchVenue(item.id)"
      >
        <div class="venue-card-head">
          <strong>{{ item.name }}</strong>
          <el-tag v-if="item.readonly" type="info" effect="plain" size="small">基线 · 只读</el-tag>
          <el-tag v-else-if="item.id === store.activeVenueId" type="success" effect="plain" size="small">当前场地</el-tag>
        </div>
        <div class="venue-specs">
          <span>台口 {{ item.prosceniumWidth }}m × {{ item.stageDepth }}m</span>
          <span>侧幕安全 {{ item.wingMargin }}m</span>
          <span>升降台禁入区 {{ item.liftZones.length }} 处</span>
          <span>乐池 {{ item.pitZone.w }}m × {{ item.pitZone.h }}m</span>
        </div>
      </button>
    </div>

    <el-alert
      v-if="!isBaseline && store.dangerTotal"
      class="danger-alert"
      type="error"
      show-icon
      :closable="false"
      :title="`${store.dangerTotal} 个节点落入危险区，涉及场景已暂缓锁定`"
      description="以下节点换算后靠近侧幕、升降台禁入区或乐池，请在舞台工作区调整路线后再锁定场景。"
    />

    <div class="venue-grid">
      <section class="panel plan-panel">
        <div class="panel-head">
          <h3>{{ venue.name }} · 换算后平面图</h3>
          <span class="muted">台口 {{ venue.prosceniumWidth }}m × {{ venue.stageDepth }}m</span>
        </div>
        <div class="plan-scroll">
          <div class="plan-canvas">
            <div class="plan-label top">LED 背景幕</div>
            <div class="plan-label bottom">观众席</div>
            <svg class="plan-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
              <defs>
                <pattern id="venue-grid" width="5" height="5" patternUnits="userSpaceOnUse">
                  <path d="M 5 0 L 0 0 0 5" fill="none" stroke="#cbd6da" stroke-width="0.15" />
                </pattern>
                <pattern id="lift-hatch" width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="2.4" height="2.4" fill="#fbe9e5" />
                  <line x1="0" y1="0" x2="0" y2="2.4" stroke="#d9705b" stroke-width="0.35" />
                </pattern>
              </defs>
              <rect width="100" height="100" fill="url(#venue-grid)" />
              <rect :x="0" :y="0" :width="wingLeft" height="100" class="wing" />
              <rect :x="wingRight" :y="0" :width="wingLeft" height="100" class="wing" />
              <rect v-bind="pitRect" class="pit" />
              <g v-for="rect in liftRects" :key="rect.label">
                <rect v-bind="rect" class="lift" />
                <text :x="rect.x + rect.w / 2" :y="rect.y + rect.h / 2" class="lift-label">{{ rect.label }}</text>
              </g>
              <line x1="50" y1="0" x2="50" y2="100" class="center-line" />
              <template v-for="scene in store.adaptedScenes" :key="scene.key">
                <template v-for="cue in scene.cues" :key="cue.cueId">
                  <polyline
                    v-if="cue.route.length > 1"
                    :points="cue.route.map((node) => `${node.point.x},${node.point.y}`).join(' ')"
                    class="route"
                  />
                  <g v-for="(node, index) in cue.route" :key="index">
                    <circle v-if="node.dangers.length" :cx="node.point.x" :cy="node.point.y" r="1.9" class="node-danger" />
                    <circle v-else :cx="node.point.x" :cy="node.point.y" r="1.1" class="node-safe" />
                  </g>
                </template>
              </template>
            </svg>
            <div class="plan-legend">
              <span><i class="lg-wing" />侧幕区</span>
              <span><i class="lg-lift" />升降台禁入区</span>
              <span><i class="lg-pit" />乐池</span>
              <span><i class="lg-danger" />危险节点</span>
            </div>
          </div>
        </div>
      </section>

      <aside class="side-column">
        <section class="panel">
          <div class="panel-head">
            <h3>危险区节点（{{ dangerNodes.length }}）</h3>
            <span class="muted">单独列出</span>
          </div>
          <div class="danger-list">
            <div v-for="(node, index) in dangerNodes" :key="index" class="danger-item">
              <div class="danger-item-head">
                <strong>{{ node.cueId }} · {{ node.nodeLabel }}</strong>
                <span class="muted">{{ node.scene }}</span>
              </div>
              <p>{{ node.cueTitle }} · 实测 ({{ node.meters.x }}m, {{ node.meters.y }}m)</p>
              <div class="danger-tags">
                <el-tag v-for="danger in node.dangers" :key="danger" type="danger" effect="plain" size="small">{{ danger }}</el-tag>
              </div>
              <el-button size="small" text type="primary" @click="locate(node.cueId)">定位并调整路线</el-button>
            </div>
            <el-empty v-if="!dangerNodes.length" description="当前场地无危险区节点" :image-size="52" />
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h3>场景锁定 · {{ venue.name }}</h3>
            <el-tag v-if="isBaseline" type="info" effect="plain" size="small">基线只读</el-tag>
          </div>
          <div class="scene-list">
            <div v-for="scene in store.adaptedScenes" :key="scene.key" class="scene-row">
              <div>
                <strong>{{ scene.key }}</strong>
                <small>{{ scene.cues.length }} 个提示<span v-if="scene.dangerNodes.length" class="scene-danger"> · {{ scene.dangerNodes.length }} 个危险节点</span></small>
              </div>
              <el-tag :type="statusType(scene)" effect="plain" size="small">{{ store.sceneStatus(scene) }}</el-tag>
              <el-button
                size="small"
                :disabled="isBaseline || store.sceneStatus(scene) === '暂缓锁定'"
                @click="toggleLock(scene)"
              >
                {{ store.sceneStatus(scene) === '已锁定' ? '解锁' : '锁定' }}
              </el-button>
            </div>
          </div>
          <p class="recompute-note">
            增量重算：{{ store.lastRecomputed.length ? store.lastRecomputed.join('、') : '无' }} 已重算，其余场景沿用缓存。
          </p>
        </section>
      </aside>
    </div>

    <section class="panel registry-panel">
      <div class="panel-head">
        <h3>场地登记 · {{ venue.name }}</h3>
        <span class="muted">{{ isBaseline ? '原场地基线只读，不可修改' : '修改尺寸后自动重新换算并检测危险区' }}</span>
      </div>
      <el-form label-position="top" size="small" :disabled="isBaseline" class="registry-form">
        <div class="registry-grid">
          <el-form-item label="台口宽（米）">
            <el-input-number
              :model-value="venue.prosceniumWidth"
              :min="4"
              :max="40"
              :step="0.1"
              @update:model-value="patchVenue({ prosceniumWidth: num($event, venue.prosceniumWidth) })"
            />
          </el-form-item>
          <el-form-item label="台口深（米）">
            <el-input-number
              :model-value="venue.stageDepth"
              :min="4"
              :max="40"
              :step="0.1"
              @update:model-value="patchVenue({ stageDepth: num($event, venue.stageDepth) })"
            />
          </el-form-item>
          <el-form-item label="侧幕安全距离（米）">
            <el-input-number
              :model-value="venue.wingMargin"
              :min="0"
              :max="3"
              :step="0.1"
              @update:model-value="patchVenue({ wingMargin: num($event, venue.wingMargin) })"
            />
          </el-form-item>
          <el-form-item label="乐池前沿深度（米）">
            <el-input-number
              :model-value="venue.pitZone.y"
              :min="0"
              :max="venue.stageDepth"
              :step="0.1"
              @update:model-value="patchPit({ y: num($event, venue.pitZone.y) })"
            />
          </el-form-item>
          <el-form-item label="乐池高度（米）">
            <el-input-number
              :model-value="venue.pitZone.h"
              :min="0"
              :max="5"
              :step="0.1"
              @update:model-value="patchPit({ h: num($event, venue.pitZone.h) })"
            />
          </el-form-item>
        </div>

        <div class="lift-head">
          <strong>升降台禁入区</strong>
          <el-button size="small" @click="addLiftZone">新增禁入区</el-button>
        </div>
        <el-table :data="venue.liftZones" size="small">
          <el-table-column label="名称" min-width="130">
            <template #default="{ row }">
              <el-input :model-value="row.label" @update:model-value="row.label = String($event)" />
            </template>
          </el-table-column>
          <el-table-column v-for="field in ['x', 'y', 'w', 'h']" :key="field" :label="{ x: 'X（米）', y: 'Y（米）', w: '宽（米）', h: '高（米）' }[field]" width="110">
            <template #default="{ row }">
              <el-input-number :model-value="row[field]" :min="0" :max="40" :step="0.1" size="small" @update:model-value="row[field] = num($event, row[field])" />
            </template>
          </el-table-column>
          <el-table-column width="70">
            <template #default="{ row }">
              <el-button size="small" text type="danger" @click="removeLiftZone(row.id)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-form>
    </section>

    <el-dialog v-model="showCreate" title="登记新场地" width="420px">
      <el-form label-position="top" size="small">
        <el-form-item label="场地名称">
          <el-input v-model="createForm.name" placeholder="如：广州实验剧场 · 小剧场" />
        </el-form-item>
        <el-form-item label="场地类型">
          <el-segmented v-model="createForm.kind" :options="['大剧场', '小剧场']" />
        </el-form-item>
        <div class="dialog-grid">
          <el-form-item label="台口宽（米）">
            <el-input-number v-model="createForm.prosceniumWidth" :min="4" :max="40" :step="0.1" />
          </el-form-item>
          <el-form-item label="台口深（米）">
            <el-input-number v-model="createForm.stageDepth" :min="4" :max="40" :step="0.1" />
          </el-form-item>
          <el-form-item label="侧幕安全距离（米）">
            <el-input-number v-model="createForm.wingMargin" :min="0" :max="3" :step="0.1" />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" @click="createVenue">登记并切换</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.venue-page {
  background: #eef2f4;
}

.venue-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.venue-card {
  padding: 14px;
  border: 1px solid #dce3e7;
  border-radius: 10px;
  text-align: left;
  background: #fff;
  cursor: pointer;
}

.venue-card.active {
  border-color: #2f8580;
  box-shadow: 0 0 0 2px rgb(47 133 128 / 15%);
}

.venue-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.venue-specs {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 14px;
  margin-top: 10px;
  color: #68747f;
  font-size: 12px;
}

.danger-alert {
  margin-bottom: 14px;
}

.venue-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(320px, 0.9fr);
  gap: 12px;
}

.plan-scroll {
  overflow: auto;
  padding: 18px;
  background: #182633;
}

.plan-canvas {
  position: relative;
  min-width: 520px;
  aspect-ratio: 16 / 10;
  background: #eef1eb;
}

.plan-label {
  position: absolute;
  z-index: 2;
  left: 50%;
  transform: translateX(-50%);
  color: #67727a;
  font-size: 10px;
  letter-spacing: 0.2em;
}

.plan-label.top {
  top: 2%;
}

.plan-label.bottom {
  bottom: 1.5%;
}

.plan-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.wing {
  fill: #c9cfd2;
  opacity: 0.55;
}

.pit {
  fill: #b9d2e8;
  opacity: 0.8;
}

.lift {
  fill: url(#lift-hatch);
  stroke: #d9705b;
  stroke-width: 0.3;
}

.lift-label {
  fill: #a84a38;
  font-size: 2.4px;
  text-anchor: middle;
}

.center-line {
  stroke: #9aa6a2;
  stroke-width: 0.2;
  stroke-dasharray: 1 1;
}

.route {
  fill: none;
  stroke: #4a8e8b;
  stroke-width: 0.6;
  stroke-linejoin: round;
}

.node-safe {
  fill: #fff;
  stroke: #247d7b;
  stroke-width: 0.5;
}

.node-danger {
  fill: #d64541;
  stroke: #fff;
  stroke-width: 0.5;
}

.plan-legend {
  position: absolute;
  right: 2%;
  bottom: 3%;
  z-index: 3;
  display: flex;
  gap: 10px;
  padding: 6px 8px;
  color: #44515b;
  background: rgb(255 255 255 / 88%);
  font-size: 10px;
}

.plan-legend i {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 4px;
  border-radius: 2px;
}

.lg-wing {
  background: #aab3b8;
}

.lg-lift {
  background: #e8a396;
}

.lg-pit {
  background: #9dc0de;
}

.lg-danger {
  border-radius: 50%;
  background: #d64541;
}

.side-column {
  display: grid;
  align-content: start;
  gap: 12px;
}

.danger-list {
  display: grid;
  gap: 8px;
  max-height: 320px;
  overflow: auto;
  padding: 12px;
}

.danger-item {
  padding: 10px;
  border: 1px solid #f0d5cf;
  border-left: 3px solid #cf5b3f;
  border-radius: 6px;
  background: #fdf6f4;
}

.danger-item-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}

.danger-item p {
  margin: 6px 0;
  color: #6a5a55;
  font-size: 12px;
}

.danger-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.scene-list {
  display: grid;
}

.scene-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  border-bottom: 1px solid #edf0f2;
}

.scene-row strong,
.scene-row small {
  display: block;
}

.scene-row small {
  margin-top: 3px;
  color: #7c8892;
}

.scene-danger {
  color: #c0503f;
}

.recompute-note {
  margin: 0;
  padding: 10px 14px;
  color: #7c8892;
  font-size: 11px;
  line-height: 1.6;
}

.registry-panel {
  margin-top: 12px;
}

.registry-form {
  padding: 14px;
}

.registry-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0 16px;
}

.lift-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.dialog-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 12px;
}

@media (max-width: 1080px) {
  .venue-grid {
    grid-template-columns: 1fr;
  }
}
</style>
