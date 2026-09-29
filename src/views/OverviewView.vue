<script setup lang="ts">
import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import axios from 'axios'
import { useWorkshopStore } from '../stores/workshop'

const store = useWorkshopStore()
const { data: project } = useQuery({
  queryKey: ['project'],
  queryFn: async () => (await axios.get('/api/project')).data,
  enabled: import.meta.env.DEV,
  initialData: {
    name: '潮汐来信',
    venue: '上海大剧院 · 大剧场',
    rehearsalDate: '2026-10-08',
    company: '远岸剧团',
  },
})

const comments = computed(() => store.cues.reduce((total, cue) => total + cue.comments.filter((item) => !item.resolved).length, 0))
const totalMinutes = computed(() => Math.round(store.cues.reduce((sum, cue) => sum + cue.duration, 0) / 60))
const byDepartment = computed(() =>
  ['舞台', '灯光', '音响', '道具'].map((department) => ({
    department,
    count: store.cues.filter((cue) => cue.department === department).length,
  })),
)
const nextCues = computed(() => [...store.cues].sort((a, b) => a.time.localeCompare(b.time)).slice(0, 4))

const adapted = computed(() => store.activeAdaptedCues)
const dangerCueCount = computed(() => adapted.value.filter((item) => item.dangerNodes.length).length)
const suspendedScenes = computed(() => store.activeSceneStatuses.filter((status) => status.suspended))
const lockedScenes = computed(() => store.activeSceneStatuses.filter((status) => status.locked))
const staleCount = computed(() => adapted.value.filter((item) => item.stale).length)
const venueReady = computed(() =>
  store.activeSceneStatuses.length > 0 &&
  suspendedScenes.value.length === 0 &&
  staleCount.value === 0,
)
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div>
        <p class="eyebrow">TOUR CONTROL / 巡演控制</p>
        <h1>{{ project.name }} · 巡演总览</h1>
        <p class="muted">{{ project.company }} · 排练日 {{ project.rehearsalDate }} · 当前工作场地：{{ store.activeVenue.name }}（台口 {{ store.activeVenue.prosceniumWidth }}m × {{ store.activeVenue.stageDepth }}m）</p>
      </div>
      <div class="actions">
        <el-button @click="$router.push('/venues')">场地适配</el-button>
        <el-button @click="store.toggleOffline">{{ store.isOffline ? '恢复在线' : '模拟离线' }}</el-button>
        <el-button type="primary" @click="$router.push('/stage')">进入舞台工作区</el-button>
      </div>
    </div>

    <div class="venue-strip panel">
      <div class="venue-strip-head">
        <strong>场地执行版</strong>
        <el-select v-model="store.activeVenueId" size="small" style="width: 240px">
          <el-option
            v-for="venue in store.venues"
            :key="venue.id"
            :label="venue.name + (venue.baseline ? '（基线只读）' : '')"
            :value="venue.id"
          />
        </el-select>
        <el-tag :type="venueReady ? 'success' : 'warning'" effect="plain">
          {{ venueReady ? '执行版就绪' : `${suspendedScenes.length} 场景暂缓 / ${staleCount} 条待算` }}
        </el-tag>
      </div>
      <div class="venue-strip-grid">
        <div><span>台口宽 × 深</span><strong>{{ store.activeVenue.prosceniumWidth }} × {{ store.activeVenue.stageDepth }} m</strong></div>
        <div><span>升降台禁入区</span><strong>{{ store.activeVenue.zones.filter((z) => z.type === 'lift').length }} 处</strong></div>
        <div><span>乐池范围</span><strong>{{ store.activeVenue.zones.filter((z) => z.type === 'pit').length }} 处</strong></div>
        <div><span>已锁场景</span><strong>{{ lockedScenes.length }} / {{ store.activeSceneStatuses.length }}</strong></div>
      </div>
      <el-button v-if="!store.isBaselineActive && staleCount" type="warning" plain size="small" @click="$router.push('/venues')">
        去重算受影响场景
      </el-button>
    </div>

    <div class="metric-grid">
      <article class="metric">
        <span>脚本节点</span>
        <strong>{{ store.cues.length }}</strong>
        <small>覆盖三幕 {{ new Set(store.cues.map((cue) => cue.scene)).size }} 个场景</small>
      </article>
      <article class="metric">
        <span>危险区提示</span>
        <strong :class="dangerCueCount ? 'red' : ''">{{ dangerCueCount }}</strong>
        <small>{{ suspendedScenes.length }} 个场景暂缓锁定</small>
      </article>
      <article class="metric">
        <span>未解决留言</span>
        <strong class="red">{{ comments }}</strong>
        <small>跨部门协同处理中</small>
      </article>
      <article class="metric">
        <span>计划时长</span>
        <strong>{{ totalMinutes }}<small> 分</small></strong>
        <small>当前版本 {{ store.revision }}</small>
      </article>
    </div>

    <div class="overview-grid">
      <section class="panel">
        <div class="panel-head">
          <h3>下一组执行节点</h3>
          <span class="online">{{ store.isOffline ? '离线草稿' : '多人编辑中' }}</span>
        </div>
        <div class="cue-list">
          <button v-for="cue in nextCues" :key="cue.id" class="cue-row" @click="store.selectedId = cue.id; $router.push('/stage')">
            <time>{{ cue.time }}</time>
            <span>
              <strong>{{ cue.title }}</strong>
              <small>{{ cue.act }} / {{ cue.scene }} · {{ cue.owner }}</small>
            </span>
            <el-tag :type="cue.status === '已确认' ? 'success' : cue.status === '待确认' ? 'warning' : 'info'" effect="plain">
              {{ cue.status }}
            </el-tag>
          </button>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h3>部门负荷</h3>
          <span class="muted">按提示数</span>
        </div>
        <div class="dept-list">
          <div v-for="item in byDepartment" :key="item.department" class="dept-row">
            <span>{{ item.department }}</span>
            <div class="bar-track"><i :style="{ width: `${(item.count / store.cues.length) * 100}%` }" /></div>
            <strong>{{ item.count }}</strong>
          </div>
        </div>
        <div class="conflict-card" :class="{ ok: store.conflicts.length === 0 }">
          <strong>{{ store.conflicts.length ? `发现 ${store.conflicts.length} 项潜在冲突` : '未发现时间冲突' }}</strong>
          <p>{{ store.conflicts.length ? '同一场景存在同时触发的提示，请在舞台工作区核对优先级。' : '当前提示的时间与场景编排一致。' }}</p>
          <el-button v-if="store.conflicts.length" text type="warning" @click="$router.push('/stage')">定位冲突</el-button>
        </div>
        <div class="conflict-card" :class="{ ok: suspendedScenes.length === 0 }">
          <strong>{{ suspendedScenes.length ? `${suspendedScenes.length} 个场景在 ${store.activeVenue.shortName} 暂缓锁定` : `${store.activeVenue.shortName} 无危险区命中` }}</strong>
          <p>{{ suspendedScenes.length ? '入场、路线或退场节点落在升降台禁入区 / 乐池 / 台口外，需现场修正后再锁。' : '全部换算节点位于安全区域，可形成打印执行版。' }}</p>
          <el-button v-if="suspendedScenes.length || staleCount" text :type="suspendedScenes.length ? 'danger' : 'warning'" @click="$router.push('/venues')">
            {{ suspendedScenes.length ? '处理危险节点' : '重算受影响场景' }}
          </el-button>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.amber {
  color: #b77014 !important;
}

.red {
  color: #bd4b3f !important;
}

.venue-strip {
  margin-bottom: 14px;
  padding: 14px 16px;
}

.venue-strip-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.venue-strip-head strong {
  font-size: 14px;
}

.venue-strip-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.venue-strip-grid div {
  padding: 10px 12px;
  border: 1px solid #e6ebee;
  border-radius: 7px;
  background: #f8fafb;
}

.venue-strip-grid span {
  display: block;
  color: #7a8692;
  font-size: 11px;
}

.venue-strip-grid strong {
  display: block;
  margin-top: 3px;
  color: #173846;
  font-size: 15px;
}

.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.65fr);
  gap: 14px;
}

.cue-list {
  padding: 6px;
}

.cue-row {
  display: grid;
  width: 100%;
  grid-template-columns: 76px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 13px 10px;
  border: 0;
  border-bottom: 1px solid #edf0f2;
  text-align: left;
  background: transparent;
  cursor: pointer;
}

.cue-row:hover {
  background: #f5f8f8;
}

.cue-row time {
  color: #247c7c;
  font-family: ui-monospace, monospace;
  font-weight: 700;
}

.cue-row strong,
.cue-row small {
  display: block;
}

.cue-row small {
  margin-top: 4px;
  color: #7a8692;
}

.dept-list {
  display: grid;
  gap: 18px;
  padding: 20px;
}

.dept-row {
  display: grid;
  grid-template-columns: 48px 1fr 24px;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.bar-track {
  height: 8px;
  overflow: hidden;
  border-radius: 8px;
  background: #e7ecee;
}

.bar-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #2f8580;
}

.conflict-card {
  margin: 0 16px 16px;
  padding: 14px;
  border-left: 3px solid #d8912d;
  background: #fff8e8;
}

.conflict-card.ok {
  border-left-color: #4b9d72;
  background: #f0f8f3;
}

.conflict-card p {
  margin: 6px 0 0;
  color: #687582;
  font-size: 12px;
  line-height: 1.55;
}

.online {
  color: #2e8064;
  font-size: 12px;
}

@media (max-width: 1050px) {
  .overview-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 600px) {
  .cue-row {
    grid-template-columns: 64px 1fr;
  }

  .cue-row .el-tag {
    grid-column: 2;
    justify-self: start;
  }

  .venue-strip-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
