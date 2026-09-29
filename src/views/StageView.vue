<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useWorkshopStore, type Cue, type Department, type NodeRef, type Point } from '../stores/workshop'
import { pitOverscan, toPhysical } from '../stores/venues'

const store = useWorkshopStore()
const commentText = ref('')
const showRouteEditor = ref(true)
const departments: Array<'全部' | Department> = ['全部', '舞台', '灯光', '音响', '道具']
const acts = ['全部', '第一幕', '第二幕', '第三幕']

const PAD = 2
const venue = computed(() => store.activeVenue)
const depthExt = computed(() => venue.value.stageDepth + pitOverscan(venue.value))
const viewW = computed(() => venue.value.prosceniumWidth + PAD * 2)
const viewH = computed(() => depthExt.value + PAD * 2)
const ticksX = computed(() => {
  const half = venue.value.prosceniumWidth / 2
  return Array.from({ length: Math.round(venue.value.prosceniumWidth) + 1 }, (_, i) => Math.round((-half + i) * 10) / 10)
})
const ticksD = computed(() => Array.from({ length: Math.floor(depthExt.value) + 1 }, (_, i) => i))

const sx = (x: number) => x + venue.value.prosceniumWidth / 2 + PAD
const sy = (d: number) => d + PAD

const adaptedMap = computed(() => new Map(store.activeAdaptedCues.map((item) => [item.cue.id, item])))
const cue = computed(() => store.selectedCue)
const adaptedCue = computed(() => (cue.value ? adaptedMap.value.get(cue.value.id) : undefined))
const conflictCues = computed(() => new Set(store.conflicts.map((item) => item.id)))
const dangerCueIds = computed(
  () => new Set(store.activeAdaptedCues.filter((item) => item.dangerNodes.length).map((item) => item.cue.id)),
)
const staleCueIds = computed(() => new Set(store.activeAdaptedCues.filter((item) => item.stale).map((item) => item.cue.id)))
const dangerScenes = computed(() => store.activeSceneStatuses.filter((status) => status.suspended))
const staleCount = computed(() => store.activeAdaptedCues.filter((item) => item.stale).length)
const pendingCount = computed(() => store.activeAdaptedCues.filter((item) => item.pendingAdaptation).length)
const neverAdapted = computed(
  () => !store.isBaselineActive && pendingCount.value === store.activeAdaptedCues.length && pendingCount.value > 0,
)
const sceneLockedActive = computed(() =>
  cue.value ? store.isSceneLocked(store.activeVenueId, cue.value.act, cue.value.scene) : false,
)

function refKey(refNode: NodeRef) {
  return refNode.kind === 'route' ? `route:${refNode.index}` : refNode.kind
}

function selectCue(item: Cue) {
  store.selectedId = item.id
}

function addWaypoint(event: MouseEvent) {
  if (!showRouteEditor.value) return
  if (store.locked) return
  if (cue.value && store.isSceneLocked(store.activeVenueId, cue.value.act, cue.value.scene)) return
  const target = event.currentTarget as SVGElement
  const rect = target.getBoundingClientRect()
  const px = ((event.clientX - rect.left) / rect.width) * viewW.value - PAD
  const py = ((event.clientY - rect.top) / rect.height) * viewH.value - PAD
  // 点击坐标先还原为场地实测坐标，再反算回基线归一化坐标后追加到主数据
  const normalized = {
    x: Math.round(((px / venue.value.prosceniumWidth) + 0.5) * 100),
    y: Math.round((py / venue.value.stageDepth) * 100),
  }
  normalized.x = Math.min(100, Math.max(0, normalized.x))
  normalized.y = Math.min(100, Math.max(0, normalized.y))
  store.addWaypoint(normalized)
  ElMessage.success('已按当前场地比例追加路线节点（写回基线主数据）')
}

function saveCue() {
  localStorage.setItem('stage-scheduler-last-action', new Date().toISOString())
  ElMessage.success(store.isOffline ? '已保存到离线草稿' : `已同步 ${store.revision}`)
}

function submitComment() {
  if (!commentText.value.trim()) return
  store.addComment(commentText.value.trim(), '制作人 · 陈曦')
  commentText.value = ''
  ElMessage.success('留言已加入待办')
}

function updateCue(key: keyof Cue, value: unknown) {
  store.updateCue({ [key]: value } as Partial<Cue>)
}

function adaptAll() {
  const count = store.adaptVenue(store.activeVenueId)
  ElMessage.success(`已按 ${venue.value.name} 实测尺寸换算 ${count} 个节点提示`)
}

function recompute() {
  const result = store.recomputeAffected(store.activeVenueId)
  if (!result.scenes.length) {
    ElMessage.info('没有需要重算的受影响场景')
  } else {
    ElMessage.success(`已重算 ${result.scenes.length} 个场景 / ${result.count} 条提示`)
  }
}

function lockActiveScene() {
  if (!cue.value) return
  if (!store.lockScene(store.activeVenueId, cue.value.act, cue.value.scene)) {
    ElMessage.error('该场景存在落在危险区的节点，已暂缓锁定')
    return
  }
  ElMessage.success('场景执行版本已锁定')
}

function unlockActiveScene() {
  if (!cue.value) return
  store.unlockScene(store.activeVenueId, cue.value.act, cue.value.scene)
}

function setOverride(refNode: NodeRef, axis: 'x' | 'd', value: number) {
  if (!cue.value) return
  const current = adaptedCue.value?.nodes.find((node) => node.kind === refNode.kind && node.index === refNode.index)
  store.setNodeOverride(store.activeVenueId, cue.value.id, refNode, {
    x: axis === 'x' ? value : current?.point.x ?? 0,
    d: axis === 'd' ? value : current?.point.d ?? 0,
  })
}

function hazardText(hazards: { label: string; level: string }[]) {
  return hazards.map((hit) => hit.label).join('、') || '—'
}

function toPhysLocal(point: Point) {
  return toPhysical(venue.value, point)
}
</script>

<template>
  <section class="page stage-page">
    <div class="page-head">
      <div>
        <p class="eyebrow">STAGING / 走位编排</p>
        <h1>舞台平面与执行提示</h1>
        <p class="muted">平面图按当前场地实测尺寸等比绘制；切换场地自动换算入场、路线与退场节点。</p>
      </div>
      <div class="actions">
        <el-button :disabled="!store.canUndo || store.locked" @click="store.undo()">撤销</el-button>
        <el-button :disabled="!store.canRedo || store.locked" @click="store.redo()">重做</el-button>
        <el-button type="primary" @click="saveCue">{{ store.isOffline ? '保存草稿' : '同步版本' }}</el-button>
      </div>
    </div>

    <div class="venue-bar panel">
      <div class="venue-switch">
        <span class="bar-label">当前场地</span>
        <el-select v-model="store.activeVenueId" size="small" style="width: 230px">
          <el-option
            v-for="item in store.venues"
            :key="item.id"
            :label="item.name + (item.baseline ? '（基线 · 只读）' : '')"
            :value="item.id"
          />
        </el-select>
        <el-tag v-if="venue.baseline" type="info" effect="plain">原场地基线</el-tag>
        <el-tag v-else type="warning" effect="plain">巡演执行版本</el-tag>
      </div>
      <div class="venue-meta">
        <span>台口宽 <strong>{{ venue.prosceniumWidth }}m</strong></span>
        <span>台口深 <strong>{{ venue.stageDepth }}m</strong></span>
        <span>升降台禁入区 <strong>{{ venue.zones.filter((z) => z.type === 'lift').length }}</strong></span>
        <span>乐池 <strong>{{ venue.zones.filter((z) => z.type === 'pit').length }}</strong></span>
        <span>侧幕余量 <strong>{{ venue.wingMargin }}m</strong></span>
      </div>
      <div class="venue-actions">
        <el-button v-if="!store.isBaselineActive && staleCount" size="small" type="warning" @click="recompute">
          重算受影响场景（{{ staleCount }} 条待重算）
        </el-button>
        <el-button v-if="neverAdapted" size="small" type="primary" @click="adaptAll">按实测尺寸换算全剧</el-button>
        <el-button size="small" @click="$router.push('/venues')">场地登记</el-button>
      </div>
    </div>

    <el-alert
      v-if="dangerScenes.length"
      class="conflict-alert"
      type="error"
      show-icon
      :closable="false"
      :title="`${venue.shortName}：${dangerScenes.length} 个场景存在落在危险区的节点，已暂缓锁定`"
    >
      <template #default>
        <span v-for="status in dangerScenes" :key="status.scene" class="hazard-chip">
          {{ status.scene }}（{{ status.dangerNodes.length }} 节点：{{ [...new Set(status.dangerNodes.map((n) => n.node.hazards[0]?.label))].join('、') }}）
        </span>
      </template>
    </el-alert>
    <el-alert
      v-else-if="staleCount && !store.isBaselineActive"
      class="conflict-alert"
      type="warning"
      show-icon
      :closable="false"
      :title="`演员/道具或走位有变化，${staleCount} 条提示的换算结果待重算`"
      description="几何仍显示上次换算版本；点击“重算受影响场景”后更新，基线主数据不受影响。"
    />

    <div class="toolbar panel">
      <div class="filter-group">
        <span>幕次</span>
        <el-select v-model="store.actFilter" size="small" style="width: 112px">
          <el-option v-for="act in acts" :key="act" :label="act" :value="act" />
        </el-select>
        <span>部门</span>
        <el-select v-model="store.departmentFilter" size="small" style="width: 112px">
          <el-option v-for="department in departments" :key="department" :label="department" :value="department" />
        </el-select>
      </div>
      <div class="zoom-control">
        <span>缩放 {{ store.zoom }}%</span>
        <el-slider v-model="store.zoom" :min="70" :max="150" :step="5" style="width: 150px" />
      </div>
      <el-switch v-model="showRouteEditor" active-text="路线编辑" />
      <el-button @click="store.addCue" :disabled="store.locked">新增提示</el-button>
      <el-tag :type="store.locked ? 'success' : 'info'" effect="plain">{{ store.locked ? '基线已锁定' : '草稿编辑中' }}</el-tag>
    </div>

    <div class="work-grid">
      <section class="panel stage-panel">
        <div class="panel-head">
          <h3>舞台平面图 · {{ venue.shortName }}</h3>
          <span class="muted">真实宽高比 {{ venue.prosceniumWidth }}m × {{ venue.stageDepth }}m · 坐标单位米（上场中线 x=0）</span>
        </div>
        <div class="stage-scroll">
          <div class="stage-canvas" :style="{ aspectRatio: `${viewW} / ${viewH}`, transform: `scale(${store.zoom / 100})` }">
            <svg class="stage-svg" :viewBox="`0 0 ${viewW} ${viewH}`" preserveAspectRatio="xMidYMid meet" @click="addWaypoint">
              <defs>
                <marker id="arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
                  <path d="M0,0 L5,2.5 L0,5 z" fill="#287d7c" />
                </marker>
              </defs>

              <!-- 米制网格 -->
              <g class="grid">
                <line v-for="x in ticksX" :key="`gx-${x}`" :x1="sx(x)" :x2="sx(x)" :y1="sy(0)" :y2="sy(depthExt)" />
                <line v-for="d in ticksD" :key="`gd-${d}`" :x1="sx(-venue.prosceniumWidth / 2)" :x2="sx(venue.prosceniumWidth / 2)" :y1="sy(d)" :y2="sy(d)" />
              </g>

              <!-- 乐池（含向观众侧外伸部分） -->
              <rect
                v-for="zone in venue.zones.filter((z) => z.type === 'pit')"
                :key="zone.id"
                :x="sx(zone.x)"
                :y="sy(zone.d)"
                :width="zone.width"
                :height="zone.depth"
                class="zone pit"
              />
              <text
                v-for="zone in venue.zones.filter((z) => z.type === 'pit')"
                :key="`${zone.id}-label`"
                :x="sx(zone.x + zone.width / 2)"
                :y="sy(Math.min(zone.d + zone.depth / 2, depthExt - 0.3))"
                class="zone-label"
              >乐池</text>

              <!-- 台面表演区 -->
              <rect :x="sx(-venue.prosceniumWidth / 2)" :y="sy(0)" :width="venue.prosceniumWidth" :height="venue.stageDepth" class="stage-floor" />

              <!-- 升降台禁入区 -->
              <rect
                v-for="zone in venue.zones.filter((z) => z.type === 'lift')"
                :key="zone.id"
                :x="sx(zone.x)"
                :y="sy(zone.d)"
                :width="zone.width"
                :height="zone.depth"
                class="zone lift"
              />

              <!-- 侧幕安全余量带 -->
              <rect :x="sx(-venue.prosceniumWidth / 2)" :y="sy(0)" :width="venue.wingMargin" :height="venue.stageDepth" class="wing-band" />
              <rect :x="sx(venue.prosceniumWidth / 2 - venue.wingMargin)" :y="sy(0)" :width="venue.wingMargin" :height="venue.stageDepth" class="wing-band" />
              <rect :x="sx(-venue.prosceniumWidth / 2)" :y="sy(0)" :width="venue.prosceniumWidth" :height="Math.min(venue.wingMargin, venue.stageDepth)" class="wing-band" />

              <line :x1="sx(0)" :y1="sy(0)" :x2="sx(0)" :y2="sy(venue.stageDepth)" class="center-line" />
              <line :x1="sx(-venue.prosceniumWidth / 2)" :y1="sy(venue.stageDepth)" :x2="sx(venue.prosceniumWidth / 2)" :y2="sy(venue.stageDepth)" class="proscenium-line" />

              <text :x="sx(0)" :y="sy(-1.1)" class="area-label" text-anchor="middle">上场 / LED 背景幕</text>
              <text :x="sx(0)" :y="sy(depthExt + 1.3)" class="area-label" text-anchor="middle">观众席 / 乐池</text>

              <template v-for="item in store.filteredCues" :key="item.id">
                <polyline
                  v-if="item.route.length > 1"
                  :points="item.route.map((p) => `${sx(toPhysLocal(p).x)},${sy(toPhysLocal(p).d)}`).join(' ')"
                  :class="['route', {
                    selected: item.id === store.selectedId,
                    conflict: conflictCues.has(item.id),
                    danger: dangerCueIds.has(item.id),
                    stale: staleCueIds.has(item.id),
                  }]"
                  marker-end="url(#arrow)"
                />
                <g class="cue-point" :class="{ selected: item.id === store.selectedId }" @click.stop="selectCue(item)">
                  <circle :cx="sx(toPhysLocal(item.entry).x)" :cy="sy(toPhysLocal(item.entry).d)" r="0.28" />
                  <text :x="sx(toPhysLocal(item.entry).x) + 0.32" :y="sy(toPhysLocal(item.entry).d) + 0.12">{{ item.id }}</text>
                </g>
              </template>

              <template v-if="adaptedCue">
                <template v-for="node in adaptedCue.nodes" :key="refKey(node)">
                  <circle
                    v-if="node.kind === 'route' && node.index !== 0 && node.index !== cue!.route.length - 1"
                    :cx="sx(node.point.x)"
                    :cy="sy(node.point.d)"
                    r="0.18"
                    :class="['waypoint', { hazard: node.danger }]"
                  />
                  <circle
                    v-if="node.kind === 'exit'"
                    :cx="sx(node.point.x)"
                    :cy="sy(node.point.d)"
                    r="0.26"
                    :class="['exit-point', { hazard: node.danger }]"
                  />
                  <circle v-if="node.danger" :cx="sx(node.point.x)" :cy="sy(node.point.d)" r="0.5" class="danger-ring" />
                </template>
              </template>
            </svg>
            <div class="stage-legend">
              <span><i class="entry" />入场</span>
              <span><i class="way" />路线</span>
              <span><i class="exit" />退场</span>
              <span><i class="lift-i" />升降台禁入区</span>
              <span><i class="pit-i" />乐池</span>
              <span><i class="wing-i" />侧幕余量带</span>
            </div>
          </div>
        </div>
      </section>

      <aside class="panel editor-panel">
        <div v-if="cue && adaptedCue" class="editor">
          <div class="editor-title">
            <div>
              <span>{{ cue.id }} · {{ cue.act }}</span>
              <h3>{{ cue.title }}</h3>
            </div>
            <el-tag :type="cue.status === '已确认' ? 'success' : 'warning'" effect="plain">{{ cue.status }}</el-tag>
          </div>

          <div class="scene-lock-row">
            <el-tag v-if="sceneLockedActive" type="success" effect="dark" size="small">
              {{ venue.shortName }} · 场景已锁定
            </el-tag>
            <el-tag v-else-if="adaptedCue.dangerNodes.length" type="danger" effect="dark" size="small">
              危险节点 {{ adaptedCue.dangerNodes.length }} · 暂缓锁定
            </el-tag>
            <el-tag v-else-if="adaptedCue.stale" type="warning" effect="plain" size="small">待重算</el-tag>
            <el-tag v-else type="info" effect="plain" size="small">可锁定</el-tag>
            <el-button
              v-if="sceneLockedActive"
              link
              type="primary"
              :disabled="!!venue.baseline"
              @click="unlockActiveScene"
            >解锁本场景</el-button>
            <el-button v-else link type="success" @click="lockActiveScene">锁定本场景执行版</el-button>
          </div>

          <el-alert
            v-if="adaptedCue.dangerNodes.length"
            class="node-alert"
            type="error"
            :closable="false"
            show-icon
            :title="`${adaptedCue.dangerNodes.length} 个节点落在危险区`"
          >
            <div v-for="node in adaptedCue.dangerNodes" :key="refKey(node)" class="hazard-line">
              <strong>{{ node.label }}</strong>
              <span>({{ node.point.x.toFixed(1) }}, {{ node.point.d.toFixed(1) }})m</span>
              <em>{{ hazardText(node.hazards) }}</em>
              <el-button v-if="!venue.baseline && !sceneLockedActive" link type="primary" @click="store.moveNodeToSafe(store.activeVenueId, cue.id, node)">
                移到最近安全点
              </el-button>
            </div>
          </el-alert>

          <el-form label-position="top" size="small" :disabled="store.locked">
            <div class="form-grid">
              <el-form-item label="场景">
                <el-input :model-value="cue.scene" @update:model-value="updateCue('scene', $event)" />
              </el-form-item>
              <el-form-item label="时间码">
                <el-input :model-value="cue.time" @update:model-value="updateCue('time', $event)" />
              </el-form-item>
              <el-form-item label="执行部门">
                <el-select :model-value="cue.department" @update:model-value="updateCue('department', $event)">
                  <el-option v-for="department in departments.slice(1)" :key="department" :label="department" :value="department" />
                </el-select>
              </el-form-item>
              <el-form-item label="责任角色">
                <el-input :model-value="cue.owner" @update:model-value="updateCue('owner', $event)" />
              </el-form-item>
            </div>
            <el-form-item label="执行说明">
              <el-input type="textarea" :rows="2" :model-value="cue.note" @update:model-value="updateCue('note', $event)" />
            </el-form-item>
          </el-form>

          <div class="node-table-wrap">
            <div class="node-table-head">
              <strong>实测坐标（{{ venue.shortName }} · 米）</strong>
              <el-tag v-if="adaptedCue.stale" type="warning" size="small">几何待重算</el-tag>
            </div>
            <table class="node-table">
              <thead>
                <tr><th>节点</th><th>x / d (m)</th><th>区域</th></tr>
              </thead>
              <tbody>
                <tr v-for="node in adaptedCue.nodes" :key="refKey(node)" :class="{ danger: node.danger, warning: node.warning && !node.danger, overridden: node.overridden }">
                  <td>{{ node.label }}<i v-if="node.overridden" class="override-mark">已现场修正</i></td>
                  <td>
                    <template v-if="!venue.baseline && !sceneLockedActive">
                      <el-input-number
                        :model-value="node.point.x"
                        :step="0.1"
                        :step-strictly="true"
                        size="small"
                        controls-position="right"
                        style="width: 86px"
                        @update:model-value="setOverride(node, 'x', $event ?? 0)"
                      />
                      <el-input-number
                        :model-value="node.point.d"
                        :step="0.1"
                        :step-strictly="true"
                        size="small"
                        controls-position="right"
                        style="width: 86px"
                        @update:model-value="setOverride(node, 'd', $event ?? 0)"
                      />
                    </template>
                    <template v-else>{{ node.point.x.toFixed(1) }} / {{ node.point.d.toFixed(1) }}</template>
                  </td>
                  <td>
                    <el-tag v-if="node.danger" type="danger" size="small">{{ hazardText(node.hazards) }}</el-tag>
                    <el-tag v-else-if="node.warning" type="warning" size="small">{{ hazardText(node.hazards) }}</el-tag>
                    <span v-else class="safe-text">安全</span>
                    <div v-if="!venue.baseline && !sceneLockedActive" class="node-ops">
                      <el-button link type="primary" size="small" @click="store.moveNodeToSafe(store.activeVenueId, cue.id, node)">移到安全点</el-button>
                      <el-button v-if="node.overridden" link type="info" size="small" @click="store.clearNodeOverride(store.activeVenueId, cue.id, node)">恢复比例换算</el-button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="comment-block">
            <div class="comment-head">
              <strong>部门留言 · {{ cue.comments.filter((item) => !item.resolved).length }} 待处理</strong>
            </div>
            <div class="comment-list">
              <div v-for="comment in cue.comments" :key="comment.id" class="comment" :class="{ resolved: comment.resolved }">
                <div>
                  <strong>{{ comment.author }}</strong>
                  <time>{{ comment.createdAt }}</time>
                </div>
                <p>{{ comment.content }}</p>
                <el-button link type="primary" @click="store.toggleComment(comment.id)">
                  {{ comment.resolved ? '重新打开' : '标记解决' }}
                </el-button>
              </div>
              <el-empty v-if="cue.comments.length === 0" description="暂无留言" :image-size="46" />
            </div>
            <div class="comment-input">
              <el-input v-model="commentText" placeholder="输入需其他部门处理的意见" @keyup.enter="submitComment" />
              <el-button type="primary" @click="submitComment">发送</el-button>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <section class="panel cue-strip">
      <div class="panel-head">
        <h3>脚本节点（{{ store.filteredCues.length }}）</h3>
        <span class="muted">按执行时间排序 · 危险/待重算角标来自当前场地换算</span>
      </div>
      <div class="cue-cards">
        <button
          v-for="item in [...store.filteredCues].sort((a, b) => a.time.localeCompare(b.time))"
          :key="item.id"
          class="cue-card"
          :class="{ active: item.id === store.selectedId, conflict: conflictCues.has(item.id), danger: dangerCueIds.has(item.id), stale: staleCueIds.has(item.id) }"
          @click="selectCue(item)"
        >
          <span>{{ item.id }} · {{ item.department }}</span>
          <strong>{{ item.title }}</strong>
          <small>{{ item.time }} · {{ item.duration }} 秒</small>
          <span class="card-badges">
            <i v-if="dangerCueIds.has(item.id)" class="badge danger">危险区</i>
            <i v-else-if="staleCueIds.has(item.id)" class="badge warn">待重算</i>
          </span>
        </button>
      </div>
    </section>
  </section>
</template>

<style scoped>
.stage-page {
  background: #eef2f4;
}

.venue-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 12px;
  padding: 10px 14px;
}

.venue-switch {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bar-label {
  color: #5d6b78;
  font-size: 12px;
  font-weight: 700;
}

.venue-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  color: #6b7883;
  font-size: 12px;
}

.venue-meta strong {
  color: #173846;
}

.venue-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.conflict-alert {
  margin-bottom: 12px;
}

.hazard-chip {
  display: inline-block;
  margin-right: 12px;
  font-size: 12px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 12px;
  padding: 10px 14px;
}

.filter-group,
.zoom-control {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #5d6b78;
  font-size: 12px;
}

.toolbar > :nth-last-child(2) {
  margin-left: auto;
}

.work-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(330px, 0.9fr);
  gap: 12px;
}

.stage-panel {
  min-width: 0;
}

.stage-scroll {
  overflow: auto;
  padding: 18px;
  background: #182633;
}

.stage-canvas {
  position: relative;
  width: 100%;
  min-width: 540px;
  transform-origin: left top;
  background: #eef1eb;
  box-shadow: 0 12px 30px rgb(0 0 0 / 24%);
}

.stage-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  cursor: crosshair;
}

.grid line {
  stroke: #d3dcda;
  stroke-width: 0.05;
}

.stage-floor {
  fill: #eef1eb;
  stroke: #5d727a;
  stroke-width: 0.12;
}

.zone {
  opacity: 0.7;
  stroke-width: 0.12;
  stroke-dasharray: 0.4 0.25;
}

.zone.lift {
  fill: rgb(204 79 66 / 28%);
  stroke: #cc4f42;
}

.zone.pit {
  fill: rgb(186 120 35 / 26%);
  stroke: #b06d1c;
}

.zone-label {
  fill: #8a5314;
  font-size: 0.5px;
  font-weight: 700;
  text-anchor: middle;
  pointer-events: none;
}

.area-label {
  fill: #67727a;
  font-size: 0.55px;
  letter-spacing: 0.1em;
}

.wing-band {
  fill: rgb(216 145 45 / 10%);
  stroke: none;
  pointer-events: none;
}

.center-line {
  stroke: #9aa6a2;
  stroke-width: 0.08;
  stroke-dasharray: 0.5 0.4;
}

.proscenium-line {
  stroke: #34424c;
  stroke-width: 0.18;
}

.route {
  fill: none;
  stroke: #4a8e8b;
  stroke-width: 0.14;
  stroke-linejoin: round;
}

.route.selected {
  stroke: #c36e23;
  stroke-width: 0.2;
}

.route.conflict {
  stroke: #cc4f42;
  stroke-dasharray: 0.6 0.3;
}

.route.danger {
  stroke: #c33;
  stroke-dasharray: 0.7 0.35;
  stroke-width: 0.22;
}

.route.stale {
  opacity: 0.55;
}

.cue-point circle {
  fill: #fff;
  stroke: #247d7b;
  stroke-width: 0.12;
}

.cue-point text {
  fill: #213d46;
  font-size: 0.5px;
  font-weight: 800;
  cursor: pointer;
}

.cue-point.selected circle {
  fill: #f7b54b;
  stroke: #9f4a17;
  stroke-width: 0.18;
}

.waypoint {
  fill: #f2a43c;
  stroke: #8a4d12;
  stroke-width: 0.08;
}

.waypoint.hazard,
.exit-point.hazard {
  fill: #cc4f42;
}

.exit-point {
  fill: #bb4d3e;
  stroke: #fff;
  stroke-width: 0.1;
}

.danger-ring {
  fill: none;
  stroke: #d83c2c;
  stroke-width: 0.12;
  animation: pulse 1.4s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}

.stage-legend {
  position: absolute;
  right: 1.5%;
  bottom: 2%;
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  max-width: 60%;
  padding: 6px 8px;
  color: #44515b;
  background: rgb(255 255 255 / 90%);
  font-size: 10px;
}

.stage-legend i {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 4px;
  border-radius: 2px;
}

.stage-legend .entry {
  border-radius: 50%;
  background: #247d7b;
}

.stage-legend .way {
  background: #f2a43c;
}

.stage-legend .exit {
  border-radius: 50%;
  background: #bb4d3e;
}

.stage-legend .lift-i {
  background: rgb(204 79 66 / 55%);
}

.stage-legend .pit-i {
  background: rgb(186 120 35 / 55%);
}

.stage-legend .wing-i {
  background: rgb(216 145 45 / 35%);
}

.editor-panel {
  max-height: 760px;
  overflow: auto;
}

.editor {
  padding: 16px;
}

.editor-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.editor-title span {
  color: #6b7883;
  font-size: 11px;
}

.editor-title h3 {
  margin: 4px 0 0;
  font-size: 18px;
}

.scene-lock-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.node-alert {
  margin-bottom: 12px;
}

.hazard-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 11px;
  margin-top: 4px;
}

.hazard-line em {
  color: #b03a2c;
  font-style: normal;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.node-table-wrap {
  margin: 4px 0 12px;
}

.node-table-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  font-size: 12px;
}

.node-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.node-table th {
  padding: 5px 6px;
  color: #fff;
  text-align: left;
  background: #33505e;
  font-weight: 600;
}

.node-table td {
  padding: 6px;
  border-bottom: 1px solid #e6eaec;
  vertical-align: top;
}

.node-table tr.danger td {
  background: #fdf0ee;
}

.node-table tr.warning td {
  background: #fdf7ea;
}

.node-table tr.overridden td:first-child {
  border-left: 3px solid #2f8d88;
}

.override-mark {
  display: block;
  margin-top: 2px;
  color: #2f8d88;
  font-size: 10px;
  font-style: normal;
}

.safe-text {
  color: #4b9d72;
}

.node-ops {
  margin-top: 4px;
  display: flex;
  gap: 8px;
}

.comment-block {
  padding-top: 12px;
  border-top: 1px solid #e4e9eb;
}

.comment-head {
  margin-bottom: 8px;
  font-size: 13px;
}

.comment-list {
  display: grid;
  gap: 8px;
  max-height: 190px;
  overflow: auto;
}

.comment {
  padding: 9px;
  border: 1px solid #e5eaec;
  border-radius: 6px;
  background: #f9fafa;
}

.comment.resolved {
  opacity: 0.65;
}

.comment div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
}

.comment time {
  color: #87929b;
}

.comment p {
  margin: 6px 0 3px;
  font-size: 12px;
  line-height: 1.5;
}

.comment-input {
  display: flex;
  gap: 7px;
  margin-top: 10px;
}

.cue-strip {
  margin-top: 12px;
}

.cue-cards {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 12px;
}

.cue-card {
  position: relative;
  min-width: 190px;
  padding: 11px;
  border: 1px solid #dce3e7;
  border-radius: 7px;
  text-align: left;
  background: #fff;
  cursor: pointer;
}

.cue-card.active {
  border-color: #2f8580;
  box-shadow: 0 0 0 2px rgb(47 133 128 / 14%);
}

.cue-card.conflict {
  border-left: 4px solid #cf5b3f;
}

.cue-card.danger {
  border-color: #d86c60;
  box-shadow: inset 0 0 0 1px rgb(204 79 66 / 35%);
}

.cue-card.stale:not(.danger) {
  opacity: 0.85;
}

.cue-card span,
.cue-card small {
  display: block;
  color: #76838e;
  font-size: 10px;
}

.cue-card strong {
  display: block;
  margin: 6px 0;
  font-size: 13px;
}

.card-badges {
  margin-top: 4px;
}

.badge {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-style: normal;
}

.badge.danger {
  color: #fff;
  background: #cc4f42;
}

.badge.warn {
  color: #7c5216;
  background: #f6ddab;
}

@media (max-width: 1080px) {
  .work-grid {
    grid-template-columns: 1fr;
  }

  .editor-panel {
    max-height: none;
  }
}

@media (max-width: 760px) {
  .toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .toolbar > :nth-last-child(2) {
    margin-left: 0;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }

  .venue-actions {
    margin-left: 0;
  }
}
</style>
