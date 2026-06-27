<script setup lang="ts">
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import type { PropType } from 'vue';
import {
  CalendarDays,
  Check,
  Copy,
  Download,
  FileText,
  House,
  KeyRound,
  LayoutDashboard,
  Languages,
  Lock,
  MapPin,
  MessageCircle,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  ScrollText,
  Trash2,
  Upload,
  UserRound,
  Users,
  Wand2,
  X
} from 'lucide-vue-next';
import { createBaziChart } from '@/bazi/engine';
import { BIRTH_LOCATIONS, findBirthLocationById, getBirthLocationLabel, type BirthLocation } from '@/bazi/locations';
import { STEM_ELEMENTS } from '@/bazi/relations';
import { formatCivilDateTime, getTrueSolarCorrectionMinutes, normalizeCivilDateTime } from '@/bazi/solar-time';
import { localeStorageKey, normalizeLocale, translate, type Locale, type TranslationKey } from '@/i18n';
import type { BaziChart, BirthDateTimeInput, ChartFactor, FiveElement, LuckCycle, Pillar, PillarName } from '@/bazi/types';
import { buildFortuneMessages, buildPersonaGenerationMessages, type FortuneTask, type PersonaGenerationDraft } from '@/persona/prompt';
import { fetchPersonas } from '@/services/personas';
import { fetchAvailableModels, streamFortuneReading, testCredentials } from '@/services/proxy';
import {
  createAdminPersona,
  deleteAdminPersona,
  fetchAdminPersonas,
  type AdminSession,
  type PersonaPayload,
  updateAdminPersona,
  uploadRoleImage,
  verifyAdmin
} from '@/services/admin';
import { clearCredentials, getCredentials, normalizeCredentials, saveCredentials, validateCredentials } from '@/storage/credentials';
import {
  appendRoleMessage,
  clearRoleHistory,
  createMemoryWindow,
  deleteBirthProfile,
  deleteRoleMessage,
  getBirthProfiles,
  getRoleHistory,
  getSharedProfile,
  removeLifeEvent,
  removeSharedFact,
  saveBirthProfile,
  saveSharedChart,
  saveLifeEvent,
  saveSharedFact
} from '@/storage/indexed-db';
import type { BirthProfile, ChatMessage, LocalCredentials, RoleHistory, SharedProfile } from '@/storage/types';
import {
  type EngineId,
  type FortuneCategory,
  type PersonaEngine,
  type PersonaSkin,
  isBuiltinEngineId
} from '@server-shared/persona';

type Panel = 'reading' | 'settings' | 'admin';
type CropField = 'avatarFile' | 'backgroundFile' | 'mobileBackgroundFile';
type MobileTab = 'home' | 'chart' | 'reading' | 'mine';
type PaidFortuneTask = 'structured_report' | 'multi_school' | 'daily';
type ReportExportTask = Extract<FortuneTask, 'structured_report' | 'multi_school'>;
type MembershipPlanId = 'monthly' | 'yearly' | 'pro';
type CommercialAction = {
  task: FortuneTask;
  question?: string;
  mobile?: boolean;
};
type MarkdownInline = {
  type: 'text' | 'strong' | 'em' | 'code';
  text: string;
};
type MarkdownBlock =
  | { type: 'paragraph'; children: MarkdownInline[] }
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: MarkdownInline[] }
  | { type: 'blockquote'; children: MarkdownInline[] }
  | { type: 'list'; ordered: boolean; items: MarkdownInline[][] }
  | { type: 'code'; code: string; language: string }
  | { type: 'hr' };

const PILLAR_LABELS: Record<PillarName, string> = {
  year: '年柱',
  month: '月柱',
  day: '日柱',
  hour: '时柱'
};

const FIVE_ELEMENTS: FiveElement[] = ['木', '火', '土', '金', '水'];
const ELEMENT_VISUALS = {
  木: { color: '#16a34a', soft: '#dcfce7', tint: '#f0fdf4' },
  火: { color: '#dc2626', soft: '#fee2e2', tint: '#fff1f2' },
  土: { color: '#a16207', soft: '#fef3c7', tint: '#fffbeb' },
  金: { color: '#d97706', soft: '#ffedd5', tint: '#fff7ed' },
  水: { color: '#2563eb', soft: '#dbeafe', tint: '#eff6ff' }
} satisfies Record<FiveElement, { color: string; soft: string; tint: string }>;
const commercialStateKey = 'bazi-commercial-state.v1';
const freeFollowUpLimit = 2;
const productCatalog: Record<PaidFortuneTask, { title: string; price: string; memberFree?: boolean; description: string }> = {
  structured_report: {
    title: '专业报告',
    price: '¥9.9',
    description: '完整命局、事业财运、婚恋关系、大运流年和行动清单'
  },
  multi_school: {
    title: '流派会诊',
    price: '¥19.9',
    description: '传统子平、调候、盲派倾向、心理现实派四席共审'
  },
  daily: {
    title: '每日运势',
    price: '¥1.9',
    memberFree: true,
    description: '今日事业财运、关系沟通、健康作息和行动建议'
  }
};
const membershipPlans = [
  {
    id: 'monthly',
    title: '月卡',
    price: '¥19.9',
    period: '30 天',
    badge: '轻量体验',
    description: '适合短期集中咨询，解锁连续追问与每日运势。',
    features: ['连续追问不限 30 天', '每日运势会员免费', '适合单次阶段咨询'],
    months: 1
  },
  {
    id: 'yearly',
    title: '年卡',
    price: '¥99',
    period: '365 天',
    badge: '推荐',
    description: '适合长期跟踪流年、大运和关系事业变化。',
    features: ['全年连续追问', '每日运势全年免费', '后续报告权益优先承接'],
    months: 12
  },
  {
    id: 'pro',
    title: 'Pro',
    price: '¥199',
    period: '365 天',
    badge: '高阶',
    description: '面向深度用户，预留多命盘、报告折扣和高级权益。',
    features: ['包含年卡全部权益', '多命盘权益预留', '专业报告折扣预留'],
    months: 12
  }
] satisfies Array<{
  id: MembershipPlanId;
  title: string;
  price: string;
  period: string;
  badge: string;
  description: string;
  features: string[];
  months: number;
}>;
const membershipComparisonRows = [
  { label: '连续追问', monthly: '不限 30 天', yearly: '全年不限', pro: '全年不限' },
  { label: '每日运势', monthly: '会员免费', yearly: '全年免费', pro: '全年免费' },
  { label: '命盘管理', monthly: '当前命盘', yearly: '多命盘预留', pro: '多命盘优先' },
  { label: '报告权益', monthly: '原价购买', yearly: '折扣预留', pro: '高阶折扣预留' },
  { label: '适合人群', monthly: '短期咨询', yearly: '长期跟踪', pro: '深度使用' }
];
const membershipProduct = {
  title: '大师会员',
  price: membershipPlans[0].price,
  description: '解锁连续追问，每日运势免费，后续可承接报告折扣与多命盘权益'
};
const dailyLotProduct = {
  title: '今日抽签',
  price: '每日免费 1 次',
  description: '轻仪式感互动，用于每日复访和情绪安顿'
};
const appVersion = __APP_VERSION__;
const locale = ref<Locale>('zh-CN');

function t(key: TranslationKey, params?: Record<string, string | number>) {
  return translate(locale.value, key, params);
}

function toggleLocale() {
  locale.value = locale.value === 'zh-CN' ? 'en-US' : 'zh-CN';
  window.localStorage.setItem(localeStorageKey, locale.value);
  document.documentElement.lang = locale.value;
}

const personas = ref<PersonaSkin[]>([]);
const engines = ref<PersonaEngine[]>([]);
const selectedPersonaId = ref('');
const chart = ref<BaziChart | null>(null);
const sharedProfile = ref<SharedProfile | null>(null);
const roleHistory = ref<RoleHistory | null>(null);
const activePanel = ref<Panel>('reading');
const mobileTab = ref<MobileTab>('home');
const loading = ref(false);
const appMessage = ref('');
const readingText = ref('');
const streaming = ref(false);
const drawingLot = ref(false);
const followQuestion = ref('');
const answerBoxRef = ref<HTMLDivElement | null>(null);
const commercialState = reactive({
  memberUntil: '',
  memberPlan: '' as MembershipPlanId | '',
  purchases: {} as Record<string, string>,
  followUps: {} as Record<string, number>,
  dailyLots: {} as Record<string, string>
});
const purchaseDialog = reactive({
  open: false,
  task: null as PaidFortuneTask | 'membership' | 'follow_up' | null,
  action: null as CommercialAction | null,
  plan: 'monthly' as MembershipPlanId
});
const factDraft = ref('');
const eventYearDraft = ref(new Date().getFullYear());
const eventTitleDraft = ref('');
const eventNoteDraft = ref('');
const showOpeningAnimation = ref(true);
const openingAnimationClosing = ref(false);
const openingAnimationEntering = ref(false);
const masterModalOpen = ref(false);
const profileModalOpen = ref(false);
const historyModalOpen = ref(false);
const membershipModalOpen = ref(false);
const birthModalOpen = ref(false);
const birthProfiles = ref<BirthProfile[]>([]);
const editingBirthProfileId = ref('');
const birthProfileName = ref('');

function createDefaultBirthInput(): BirthDateTimeInput {
  return {
    calendarType: 'solar',
    year: 1995,
    month: 12,
    day: 18,
    hour: 10,
    minute: 28,
    gender: 'female',
    isLeapMonth: false,
    location: undefined,
    ziHourPolicy: 'lateZiNextDay',
    luckTimeBasis: 'clock',
    directPillars: {
      year: '',
      month: '',
      day: '',
      hour: ''
    }
  };
}

const birthForm = reactive<BirthDateTimeInput>(createDefaultBirthInput());

const latitudeDraft = ref<string | number>('');
const longitudeDraft = ref<string | number>('');
const locationSearch = ref('');
const selectedLocationId = ref('');
const selectedProvince = ref('');
const selectedCity = ref('');
const directPillarsText = ref('');

const credentialsDraft = reactive<LocalCredentials>({
  baseUrl: '',
  apiKey: '',
  model: ''
});
const credentialsStatus = ref('');
const testingCredentials = ref(false);
const loadingModels = ref(false);
const modelOptions = ref<string[]>([]);
const modelSource = ref<'upstream' | 'known' | ''>('');

const adminSession = reactive<AdminSession>({
  username: '',
  password: ''
});
const adminRememberStorageKey = 'soothsay.adminSession.v1';
const adminRemember = ref(false);
const adminAuthed = ref(false);
const adminMessage = ref('');
const adminPersonas = ref<PersonaSkin[]>([]);
const adminGeneratedHighlight = ref(false);
const avatarPreviewUrl = ref('');
const backgroundPreviewUrl = ref('');
const mobileBackgroundPreviewUrl = ref('');
const cropImageRef = ref<HTMLImageElement | null>(null);
const cropFrameRef = ref<HTMLDivElement | null>(null);
const adminGenerator = reactive({
  direction: '',
  generating: false
});
const adminForm = reactive({
  id: '',
  name: '',
  engineId: 'daoist' as EngineId,
  opening: '',
  customPrompt: '',
  avatarUrl: '/defaults/custom-avatar.svg',
  backgroundUrl: '/defaults/custom-bg.svg',
  mobileBackgroundUrl: '/defaults/custom-bg.svg',
  backgroundIntensity: 100,
  tone: {
    directness: 50,
    detail: 60
  },
  categories: ['bazi', 'daily'] as FortuneCategory[],
  avatarFile: null as File | null,
  backgroundFile: null as File | null,
  mobileBackgroundFile: null as File | null
});
const adminEngineForm = reactive({
  id: '',
  name: '',
  worldview: '',
  promptRulesText: ''
});
const cropSession = reactive({
  open: false,
  field: 'avatarFile' as CropField,
  sourceUrl: '',
  fileName: '',
  aspectRatio: 1,
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  baseWidth: 0,
  baseHeight: 0,
  naturalWidth: 0,
  naturalHeight: 0,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  dragOffsetX: 0,
  dragOffsetY: 0
});

const selectedPersona = computed(() => personas.value.find((persona) => persona.id === selectedPersonaId.value) ?? personas.value[0]);
const sceneIntensity = computed(() => clampPercent(selectedPersona.value?.backgroundIntensity, 100) / 100);
const sceneOpacity = computed(() => sceneIntensity.value.toFixed(2));
const sceneSaturation = computed(() => (0.24 + sceneIntensity.value * 0.66).toFixed(2));
const sceneContrast = computed(() => (0.96 + sceneIntensity.value * 0.08).toFixed(2));
const sceneSepia = computed(() => (0.16 - sceneIntensity.value * 0.1).toFixed(2));
const sceneWashTop = computed(() => (0.72 - sceneIntensity.value * 0.48).toFixed(2));
const sceneWashBottom = computed(() => (0.88 - sceneIntensity.value * 0.42).toFixed(2));
const sceneWashSideStart = computed(() => (0.97 - sceneIntensity.value * 0.49).toFixed(2));
const sceneWashSideEnd = computed(() => (0.9 - sceneIntensity.value * 0.5).toFixed(2));
const directPillars = computed(() => birthForm.directPillars!);
const savedFacts = computed(() => sharedProfile.value?.facts ?? []);
const savedLifeEvents = computed(() => [...(sharedProfile.value?.lifeEvents ?? [])].sort((left, right) => left.year - right.year));
const historyMessages = computed(() => roleHistory.value?.messages ?? []);
const activeBirthProfile = computed(
  () => birthProfiles.value.find((profile) => profile.id === sharedProfile.value?.activeBirthProfileId) ?? null
);
const commercialScopeId = computed(() => activeBirthProfile.value?.id ?? (chart.value ? 'current-chart' : 'no-chart'));
const isMember = computed(() => Boolean(commercialState.memberUntil && new Date(commercialState.memberUntil).getTime() > Date.now()));
const activeMembershipPlan = computed(() => (isMember.value && isMembershipPlanId(commercialState.memberPlan) ? getMembershipPlan(commercialState.memberPlan) : null));
const followUpsUsed = computed(() => commercialState.followUps[commercialScopeId.value] ?? 0);
const followUpsRemaining = computed(() => Math.max(0, freeFollowUpLimit - followUpsUsed.value));
const commercialTodayKey = computed(() => new Date().toISOString().slice(0, 10));
const dailyLotUsedToday = computed(() => commercialState.dailyLots[commercialScopeId.value] === commercialTodayKey.value);
const birthTriggerLabel = computed(() => activeBirthProfile.value?.name ?? t(chart.value ? 'home.currentChart' : 'nav.birthProfile'));
const adminEditingPersona = computed(() => adminPersonas.value.find((persona) => persona.id === adminForm.id) ?? null);
const adminEditingBuiltin = computed(() => Boolean(adminEditingPersona.value?.builtin));
const avatarPreview = computed(() => avatarPreviewUrl.value || adminForm.avatarUrl);
const backgroundPreview = computed(() => backgroundPreviewUrl.value || adminForm.backgroundUrl);
const mobileBackgroundPreview = computed(() => mobileBackgroundPreviewUrl.value || adminForm.mobileBackgroundUrl);
const cropTitle = computed(() => {
  if (cropSession.field === 'avatarFile') return '裁剪头像';
  return cropSession.field === 'backgroundFile' ? '裁剪电脑端背景' : '裁剪手机端背景';
});
const cropHint = computed(() => {
  if (cropSession.field === 'avatarFile') return '头像会按正方形保存。';
  return cropSession.field === 'backgroundFile' ? '电脑端背景会按 16:9 横幅保存。' : '手机端背景会按 9:16 竖图保存。';
});
const cropFrameStyle = computed(() => ({ aspectRatio: String(cropSession.aspectRatio) }));
const cropImageStyle = computed(() => ({
  width: `${cropSession.baseWidth}px`,
  height: `${cropSession.baseHeight}px`,
  transform: `translate(-50%, -50%) translate(${cropSession.offsetX}px, ${cropSession.offsetY}px) scale(${cropSession.zoom})`
}));
const cropMaxOffsetX = computed(() => {
  const frame = cropFrameRef.value;
  if (!frame) return 0;
  return Math.max(0, Math.round((cropSession.baseWidth * cropSession.zoom - frame.clientWidth) / 2));
});
const cropMaxOffsetY = computed(() => {
  const frame = cropFrameRef.value;
  if (!frame) return 0;
  return Math.max(0, Math.round((cropSession.baseHeight * cropSession.zoom - frame.clientHeight) / 2));
});
const selectedBirthLocation = computed(() => findBirthLocationById(selectedLocationId.value));
const locationProvinces = computed(() => uniqueValues(BIRTH_LOCATIONS.map((location) => location.province)));
const locationCities = computed(() =>
  selectedProvince.value
    ? uniqueValues(BIRTH_LOCATIONS.filter((location) => location.province === selectedProvince.value).map((location) => location.city))
    : []
);
const locationDistricts = computed(() =>
  selectedProvince.value && selectedCity.value
    ? BIRTH_LOCATIONS.filter((location) => location.province === selectedProvince.value && location.city === selectedCity.value)
    : []
);
const locationSearchResults = computed(() => {
  const keyword = locationSearch.value.trim().toLocaleLowerCase();
  if (!keyword) return [];
  return BIRTH_LOCATIONS.filter((location) => {
    const searchable = [location.province, location.city, location.district].join(' ').toLocaleLowerCase();
    return searchable.includes(keyword);
  }).slice(0, 8);
});
const trueSolarPreview = computed(() => {
  if (birthForm.calendarType === 'bazi') return '';
  const latitude = Number(String(latitudeDraft.value ?? '').trim());
  const longitude = Number(String(longitudeDraft.value ?? '').trim());
  if (!Number.isFinite(longitude)) return '未选择出生地时按北京时间排盘，未启用真太阳时校正';
  const civilTime = {
    year: Number(birthForm.year),
    month: Number(birthForm.month),
    day: Number(birthForm.day),
    hour: Number(birthForm.hour),
    minute: Number(birthForm.minute),
    second: 0
  };
  const correction = getTrueSolarCorrectionMinutes(civilTime, longitude);
  const corrected = normalizeCivilDateTime(civilTime, correction.totalCorrectionMinutes);
  const position = Number.isFinite(latitude) ? `北纬${formatCoordinate(latitude)} 东经${formatCoordinate(longitude)}` : `东经${formatCoordinate(longitude)}`;
  return `${position}，真太阳时 ${formatCivilDateTime(corrected).slice(0, 16)}，校正 ${formatSignedMinutes(correction.totalCorrectionMinutes)}`;
});
const activeReadingBlocks = computed(() => parseMarkdown(cleanVisibleReportContent(readingText.value)));
const selectedPersonaEngine = computed(() => (selectedPersona.value ? engineById(selectedPersona.value.engineId) : undefined));
const pillarRows = computed(() => {
  if (!chart.value) return [];
  const names: PillarName[] = ['year', 'month', 'day', 'hour'];
  return names.map((name) => chart.value!.pillars[name]);
});
const chartFactorRows = computed(() => {
  if (!chart.value) return [];
  return [
    { label: '胎元', value: formatChartFactor(chart.value.taiYuan) },
    { label: '胎息', value: formatChartFactor(chart.value.taiXi) },
    { label: '命宫', value: formatChartFactor(chart.value.mingGong) },
    { label: '身宫', value: formatChartFactor(chart.value.shenGong) }
  ];
});
const strengthRows = computed(() => {
  const strength = chart.value?.strength;
  if (!strength) return [];
  return FIVE_ELEMENTS.map((element) => ({
    element,
    energy: strength.weightedEnergy[element],
    percent: strength.percentages[element],
    state: strength.seasonalStates[element]
  }));
});
const chartRelationRows = computed(() => {
  const relations = chart.value?.chartRelations;
  if (!relations) return [];
  return [
    ...relations.stems.map((item) => ({
      key: `stem-${item.type}-${item.ganZhi.join('-')}-${item.name}`,
      type: item.type,
      description: item.description,
      pillars: formatRelationPillars(item.pillars)
    })),
    ...relations.branches.map((item) => ({
      key: `branch-${item.type}-${item.ganZhi.join('-')}-${item.name}`,
      type: item.type,
      description: item.description,
      pillars: formatRelationPillars(item.pillars)
    }))
  ];
});

function parseLuckDateTime(value: string | undefined, fallbackYear: number) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?/);
  if (!match) return new Date(fallbackYear, 0, 1);
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0)
  );
}

function findCurrentLuckCycle(cycles: LuckCycle[], now = new Date()) {
  const ordered = [...cycles].sort((a, b) => a.index - b.index);
  return (
    ordered.find((cycle, index) => {
      const start = parseLuckDateTime(cycle.startSolarDateTime, cycle.startYear);
      const next = ordered[index + 1] ? parseLuckDateTime(ordered[index + 1].startSolarDateTime, ordered[index + 1].startYear) : null;
      return now >= start && (!next || now < next);
    }) ?? ordered.find((cycle) => now.getFullYear() >= cycle.startYear && now.getFullYear() <= cycle.endYear)
  );
}

const currentLuckIndex = computed(() => {
  const cycles = chart.value?.luck.cycles ?? [];
  return findCurrentLuckCycle(cycles)?.index ?? cycles[0]?.index ?? 0;
});
const currentLuckCycle = computed(() => {
  const cycles = chart.value?.luck.cycles ?? [];
  return cycles.find((cycle) => cycle.index === currentLuckIndex.value) ?? cycles[0] ?? null;
});
const mobileActiveTab = computed<MobileTab>(() => (activePanel.value === 'reading' ? mobileTab.value : 'mine'));
const mobileGreeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 11) return t('greeting.morning');
  if (hour < 18) return t('greeting.afternoon');
  return t('greeting.evening');
});
const mobileDailyMeta = computed(() => {
  const daily = chart.value?.daily;
  if (!daily) return t('daily.pending');
  return t('daily.today', { ganZhi: daily.ganZhi, relation: daily.relationToDayMaster });
});
const mobileChartHighlights = computed(() => {
  if (!chart.value) return [];
  return [
    { label: '日主', value: `${chart.value.dayMaster.gan}${chart.value.dayMaster.element}` },
    { label: '旺衰', value: chart.value.strength?.dayMasterStrength.conclusion ?? '待定' },
    { label: '大运', value: currentLuckCycle.value?.ganZhi ?? chart.value.luck.startAgeText },
    { label: '关系', value: `${chartRelationRows.value.length}项` }
  ];
});
const latestAssistantMessage = computed(() => [...historyMessages.value].reverse().find((message) => message.role === 'assistant') ?? null);
const latestExportableReport = computed(() => {
  const message = latestAssistantMessage.value;
  return message && isExportableReportMessage(message) ? message : null;
});
const hasCredentials = computed(() => Boolean(credentialsDraft.baseUrl && credentialsDraft.apiKey && credentialsDraft.model));
const modelSelectOptions = computed(() => {
  const options = [...modelOptions.value];
  if (credentialsDraft.model && !options.includes(credentialsDraft.model)) options.unshift(credentialsDraft.model);
  return options;
});
const adminEditing = computed(() => Boolean(adminForm.id));
const adminEngineDraftActive = computed(
  () => Boolean(adminEngineForm.id) && adminForm.engineId === adminEngineForm.id && !isBuiltinEngineId(adminForm.engineId)
);

function showMobileTab(tab: MobileTab) {
  activePanel.value = 'reading';
  mobileTab.value = tab;
}

async function requestMobileReading(task: FortuneTask, question?: string) {
  showMobileTab('reading');
  await nextTick();
  await requestReading(task, question);
}

async function requestChartOverview() {
  showMobileTab('reading');
  await nextTick();
  await requestReading('bazi_full');
}

function handleFollowQuestionKeydown(event: KeyboardEvent, mobile = false) {
  if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  event.preventDefault();
  if (mobile) {
    void requestMobileReading('follow_up', followQuestion.value);
    return;
  }
  void requestReading('follow_up', followQuestion.value);
}

function resizeFollowQuestionInput(event: Event) {
  const element = event.target;
  if (!(element instanceof HTMLTextAreaElement)) return;
  element.style.height = 'auto';
  const maxHeight = Number.parseFloat(window.getComputedStyle(element).maxHeight);
  const nextHeight = Math.min(element.scrollHeight, Number.isFinite(maxHeight) ? maxHeight : element.scrollHeight);
  element.style.height = `${nextHeight}px`;
  element.style.overflowY = element.scrollHeight > nextHeight ? 'auto' : 'hidden';
}

async function resetFollowQuestionInputs() {
  await nextTick();
  document.querySelectorAll<HTMLTextAreaElement>('.follow-question-input').forEach((element) => {
    element.style.height = '';
    element.style.overflowY = '';
  });
}

async function requestMobileDailyLot() {
  showMobileTab('reading');
  await nextTick();
  await requestDailyLot();
}

function formatChartFactor(factor?: ChartFactor) {
  return factor?.value || factor?.note || '需出生时间';
}

function formatRelationPillars(names: PillarName[]) {
  return names.map((name) => PILLAR_LABELS[name]).join('、');
}

function elementVisualStyle(element: FiveElement) {
  const visual = ELEMENT_VISUALS[element];
  return {
    '--element-color': visual.color,
    '--element-soft': visual.soft,
    '--element-tint': visual.tint,
    '--element-label': `'${element}'`
  };
}

function strengthVisualStyle(element: FiveElement, percent: number) {
  return {
    ...elementVisualStyle(element),
    '--strength-percent': `${percent}%`
  };
}

function getStemElement(stem: string) {
  return STEM_ELEMENTS[stem] ?? '土';
}

function hiddenStemItems(pillar: Pick<Pillar, 'hiddenGan' | 'hiddenGanTenGods'>) {
  return pillar.hiddenGan.map((stem, index) => ({
    stem,
    tenGod: pillar.hiddenGanTenGods[index] ?? '',
    element: getStemElement(stem)
  }));
}

function formatEnergyValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function engineById(id: string) {
  return engines.value.find((engine) => engine.id === id);
}

function engineNameById(id: string) {
  return engineById(id)?.name ?? '未知体系';
}

function createClientEngineId() {
  return `engine-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function upsertLocalEngine(engine: PersonaEngine) {
  const index = engines.value.findIndex((item) => item.id === engine.id);
  if (index >= 0) {
    engines.value[index] = engine;
  } else {
    engines.value.push(engine);
  }
}

function clearAdminEngineDraft() {
  Object.assign(adminEngineForm, {
    id: '',
    name: '',
    worldview: '',
    promptRulesText: ''
  });
}

function setAdminEngineDraft(engine?: PersonaEngine) {
  if (!engine || isBuiltinEngineId(engine.id)) {
    clearAdminEngineDraft();
    return;
  }
  Object.assign(adminEngineForm, {
    id: engine.id,
    name: engine.name,
    worldview: engine.worldview,
    promptRulesText: engine.promptRules.join('\n')
  });
}

function onAdminEngineChange() {
  setAdminEngineDraft(engineById(adminForm.engineId));
}

function buildAdminEnginePayload(): PersonaEngine | undefined {
  if (!adminEngineDraftActive.value) return undefined;
  const promptRules = adminEngineForm.promptRulesText
    .split('\n')
    .map((rule) => rule.trim())
    .filter(Boolean);
  return {
    id: adminEngineForm.id,
    name: adminEngineForm.name.trim(),
    worldview: adminEngineForm.worldview.trim(),
    promptRules,
    builtin: false
  };
}

function readGeneratedText(value: unknown, fallback = '') {
  return String(value ?? fallback).trim();
}

function clampPercent(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(100, Math.max(0, Math.round(numeric)));
}

function clampGeneratedNumber(value: unknown, fallback: number) {
  return clampPercent(value, fallback);
}

function normalizeGeneratedCategories(value: unknown): FortuneCategory[] {
  if (!Array.isArray(value)) return ['bazi', 'daily'];
  const categories = value.filter((item): item is FortuneCategory => item === 'bazi' || item === 'daily');
  return categories.length ? [...new Set(categories)] : ['bazi', 'daily'];
}

function extractJsonObject(text: string) {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('AI 没有返回可解析的 JSON');
  return text.slice(first, last + 1);
}

function normalizeGeneratedDraft(raw: any): PersonaGenerationDraft {
  const engine = raw?.engine ?? {};
  const persona = raw?.persona ?? {};
  const promptRules = Array.isArray(engine.promptRules)
    ? engine.promptRules.map((rule: unknown) => readGeneratedText(rule)).filter(Boolean).slice(0, 8)
    : [];
  const draft: PersonaGenerationDraft = {
    engine: {
      name: readGeneratedText(engine.name).slice(0, 30),
      worldview: readGeneratedText(engine.worldview).slice(0, 500),
      promptRules
    },
    persona: {
      name: readGeneratedText(persona.name).slice(0, 40),
      opening: readGeneratedText(persona.opening).slice(0, 300),
      customPrompt: readGeneratedText(persona.customPrompt).slice(0, 1200),
      tone: {
        directness: clampGeneratedNumber(persona.tone?.directness, 50),
        detail: clampGeneratedNumber(persona.tone?.detail, 70)
      },
      categories: normalizeGeneratedCategories(persona.categories)
    }
  };

  if (!draft.engine.name || !draft.engine.worldview || draft.engine.promptRules.length === 0) {
    throw new Error('AI 返回的体系信息不完整');
  }
  if (!draft.persona.name || !draft.persona.opening || !draft.persona.customPrompt) {
    throw new Error('AI 返回的大师信息不完整');
  }
  return draft;
}

function parseGeneratedDraft(text: string) {
  return normalizeGeneratedDraft(JSON.parse(extractJsonObject(text)));
}

function triggerAdminGeneratedHighlight() {
  adminGeneratedHighlight.value = true;
  window.setTimeout(() => {
    adminGeneratedHighlight.value = false;
  }, 1500);
}

function setMessage(message: string) {
  appMessage.value = message;
  window.setTimeout(() => {
    if (appMessage.value === message) appMessage.value = '';
  }, 4000);
}

function isMembershipPlanId(value: unknown): value is MembershipPlanId {
  return typeof value === 'string' && membershipPlans.some((plan) => plan.id === value);
}

function getMembershipPlan(planId: MembershipPlanId) {
  return membershipPlans.find((plan) => plan.id === planId) ?? membershipPlans[0];
}

function loadCommercialState() {
  try {
    const raw = window.localStorage.getItem(commercialStateKey);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<typeof commercialState>;
    commercialState.memberUntil = typeof parsed.memberUntil === 'string' ? parsed.memberUntil : '';
    commercialState.memberPlan = isMembershipPlanId(parsed.memberPlan) ? parsed.memberPlan : '';
    commercialState.purchases = parsed.purchases && typeof parsed.purchases === 'object' ? { ...parsed.purchases } : {};
    commercialState.followUps = parsed.followUps && typeof parsed.followUps === 'object' ? { ...parsed.followUps } : {};
    commercialState.dailyLots = parsed.dailyLots && typeof parsed.dailyLots === 'object' ? { ...parsed.dailyLots } : {};
  } catch {
    window.localStorage.removeItem(commercialStateKey);
  }
}

function saveCommercialState() {
  window.localStorage.setItem(
    commercialStateKey,
    JSON.stringify({
      memberUntil: commercialState.memberUntil,
      memberPlan: commercialState.memberPlan,
      purchases: commercialState.purchases,
      followUps: commercialState.followUps,
      dailyLots: commercialState.dailyLots
    })
  );
}

function purchaseKey(task: PaidFortuneTask) {
  const suffix = task === 'daily' ? commercialTodayKey.value : 'lifetime';
  return `${commercialScopeId.value}:${task}:${suffix}`;
}

function hasPurchased(task: PaidFortuneTask) {
  return Boolean(commercialState.purchases[purchaseKey(task)]);
}

function productPriceLabel(task: FortuneTask) {
  if (task === 'bazi_full') return '免费';
  if (task === 'daily_lot') return dailyLotProduct.price;
  if (task === 'follow_up') return isMember.value ? '会员可用' : `免费 ${followUpsRemaining.value}/${freeFollowUpLimit}`;
  const product = productCatalog[task as PaidFortuneTask];
  if (!product) return '';
  if (task === 'daily' && isMember.value) return '会员免费';
  return product.price;
}

function productAccessLabel(task: FortuneTask) {
  if (task === 'bazi_full') return '免费体验';
  if (task === 'daily_lot') return dailyLotUsedToday.value ? '今日已抽' : '每日免费';
  if (task === 'follow_up') return isMember.value ? '会员连续追问' : `剩余 ${followUpsRemaining.value} 次`;
  if (task === 'daily' && isMember.value) return '会员已解锁';
  if ((task === 'structured_report' || task === 'multi_school' || task === 'daily') && hasPurchased(task)) return '已解锁';
  return productPriceLabel(task);
}

function openPurchaseDialog(task: PaidFortuneTask | 'membership' | 'follow_up', action: CommercialAction | null = null, plan: MembershipPlanId = 'monthly') {
  purchaseDialog.task = task;
  purchaseDialog.action = action;
  purchaseDialog.plan = plan;
  purchaseDialog.open = true;
}

function closePurchaseDialog() {
  purchaseDialog.open = false;
  purchaseDialog.task = null;
  purchaseDialog.action = null;
  purchaseDialog.plan = 'monthly';
}

function startMembershipPurchase(planId: MembershipPlanId) {
  membershipModalOpen.value = false;
  openPurchaseDialog('membership', null, planId);
}

function purchaseDialogTitle() {
  if (purchaseDialog.task === 'membership' || purchaseDialog.task === 'follow_up') return `${membershipProduct.title}${getMembershipPlan(purchaseDialog.plan).title}`;
  return purchaseDialog.task ? productCatalog[purchaseDialog.task].title : '';
}

function purchaseDialogPrice() {
  if (purchaseDialog.task === 'membership' || purchaseDialog.task === 'follow_up') return getMembershipPlan(purchaseDialog.plan).price;
  return purchaseDialog.task ? productCatalog[purchaseDialog.task].price : '';
}

function purchaseDialogDescription() {
  if (purchaseDialog.task === 'membership' || purchaseDialog.task === 'follow_up') return getMembershipPlan(purchaseDialog.plan).description;
  return purchaseDialog.task ? productCatalog[purchaseDialog.task].description : '';
}

function grantMembership(planId: MembershipPlanId = 'monthly') {
  const plan = getMembershipPlan(planId);
  const nextDate = new Date();
  nextDate.setMonth(nextDate.getMonth() + plan.months);
  commercialState.memberUntil = nextDate.toISOString();
  commercialState.memberPlan = plan.id;
  saveCommercialState();
  setMessage(`已模拟开通大师会员${plan.title}，有效期 ${plan.period}`);
}

function grantPurchase(task: PaidFortuneTask) {
  commercialState.purchases[purchaseKey(task)] = new Date().toISOString();
  saveCommercialState();
  setMessage(`${productCatalog[task].title}已模拟解锁`);
}

function ensureCommercialAccess(action: CommercialAction) {
  const { task } = action;
  if (task === 'bazi_full') return true;
  if (task === 'daily_lot') {
    if (!dailyLotUsedToday.value) return true;
    setMessage('今日抽签已使用，明天再来抽一支');
    return false;
  }
  if (task === 'follow_up') {
    if (isMember.value || followUpsRemaining.value > 0) return true;
    openPurchaseDialog('follow_up', action);
    return false;
  }
  if (task === 'daily' && isMember.value) return true;
  if (task === 'structured_report' || task === 'multi_school' || task === 'daily') {
    if (hasPurchased(task)) return true;
    openPurchaseDialog(task, action);
    return false;
  }
  return true;
}

async function confirmPurchaseDialog() {
  const task = purchaseDialog.task;
  const action = purchaseDialog.action;
  const plan = purchaseDialog.plan;
  if (!task) return;
  if (task === 'membership' || task === 'follow_up') {
    grantMembership(plan);
  } else {
    grantPurchase(task);
  }
  closePurchaseDialog();
  if (action) {
    if (action.mobile) {
      await requestMobileReading(action.task, action.question);
    } else {
      await requestReading(action.task, action.question);
    }
  }
}

function registerCommercialUsage(task: FortuneTask) {
  if (task === 'follow_up' && !isMember.value) {
    commercialState.followUps[commercialScopeId.value] = (commercialState.followUps[commercialScopeId.value] ?? 0) + 1;
    saveCommercialState();
  }
  if (task === 'daily_lot') {
    commercialState.dailyLots[commercialScopeId.value] = commercialTodayKey.value;
    saveCommercialState();
  }
}

function formatMessageTime(message: ChatMessage) {
  const date = new Date(message.createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return `${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())} ${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`;
}

async function openHistoryModal() {
  if (selectedPersonaId.value) {
    roleHistory.value = await getRoleHistory(selectedPersonaId.value);
  }
  historyModalOpen.value = true;
}

async function copyHistoryMessage(message: ChatMessage) {
  try {
    await navigator.clipboard.writeText(message.content);
    setMessage('消息已复制');
  } catch {
    setMessage('复制失败，请手动选择文本');
  }
}

async function removeHistoryMessage(message: ChatMessage) {
  if (!selectedPersonaId.value) return;
  if (!window.confirm('删除这条解读记录？')) return;
  roleHistory.value = await deleteRoleMessage(selectedPersonaId.value, message.id);
  setMessage('消息已删除');
}

async function clearCurrentHistory() {
  if (!selectedPersonaId.value || !selectedPersona.value) return;
  if (!window.confirm(`清空「${selectedPersona.value.name}」的全部解读记录？`)) return;
  await clearRoleHistory(selectedPersonaId.value);
  roleHistory.value = await getRoleHistory(selectedPersonaId.value);
  readingText.value = '';
  historyModalOpen.value = false;
  setMessage('解读记录已清空');
}

function parseMarkdownInline(text: string): MarkdownInline[] {
  const tokens: MarkdownInline[] = [];
  let index = 0;

  while (index < text.length) {
    if (text[index] === '`') {
      const end = text.indexOf('`', index + 1);
      if (end > index + 1) {
        tokens.push({ type: 'code', text: text.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    if (text.startsWith('**', index)) {
      const end = text.indexOf('**', index + 2);
      if (end > index + 2) {
        tokens.push({ type: 'strong', text: text.slice(index + 2, end) });
        index = end + 2;
        continue;
      }
    }

    if (text[index] === '*') {
      const end = text.indexOf('*', index + 1);
      if (end > index + 1) {
        tokens.push({ type: 'em', text: text.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    const nextSpecials = ['`', '**', '*']
      .map((marker) => text.indexOf(marker, index + 1))
      .filter((position) => position > -1);
    const next = nextSpecials.length ? Math.min(...nextSpecials) : text.length;
    tokens.push({ type: 'text', text: text.slice(index, next) });
    index = next;
  }

  return tokens;
}

function isMarkdownBlockStart(line: string) {
  return (
    /^```/.test(line) ||
    /^(#{1,6})\s+/.test(line) ||
    /^\s*(---|\*\*\*|___)\s*$/.test(line) ||
    /^>\s?/.test(line) ||
    /^\s*([-*])\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line)
  );
}

function parseMarkdown(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  const paragraphLines: string[] = [];

  const flushParagraph = () => {
    const content = paragraphLines.join('\n').trim();
    if (content) blocks.push({ type: 'paragraph', children: parseMarkdownInline(content) });
    paragraphLines.length = 0;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (/^```/.test(line)) {
      flushParagraph();
      const language = line.replace(/^```/, '').trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: 'code', code: codeLines.join('\n'), language });
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseMarkdownInline(heading[2].trim())
      });
      continue;
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flushParagraph();
      blocks.push({ type: 'hr' });
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushParagraph();
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: 'blockquote', children: parseMarkdownInline(quoteLines.join('\n').trim()) });
      continue;
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const orderedList = Boolean(ordered);
      const items: MarkdownInline[][] = [];
      while (index < lines.length) {
        const current = lines[index];
        const item = orderedList ? current.match(/^\s*\d+\.\s+(.+)$/) : current.match(/^\s*[-*]\s+(.+)$/);
        if (!item) break;
        items.push(parseMarkdownInline(item[1].trim()));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: 'list', ordered: orderedList, items });
      continue;
    }

    if (paragraphLines.length && isMarkdownBlockStart(line)) {
      flushParagraph();
    }
    paragraphLines.push(line);
  }

  flushParagraph();
  return blocks;
}

const MarkdownRenderer = defineComponent({
  name: 'MarkdownRenderer',
  props: {
    blocks: {
      type: Array as PropType<MarkdownBlock[]>,
      required: true
    }
  },
  setup(props) {
    const renderInline = (children: MarkdownInline[]) =>
      children.map((child, index) => {
        const key = `${child.type}-${index}`;
        if (child.type === 'strong') return h('strong', { key }, child.text);
        if (child.type === 'em') return h('em', { key }, child.text);
        if (child.type === 'code') return h('code', { key, class: 'md-inline-code' }, child.text);
        return h('span', { key }, child.text);
      });

    return () =>
      h(
        'div',
        { class: 'markdown-body' },
        props.blocks.map((block, index) => {
          if (block.type === 'heading') return h(`h${block.level}`, { key: index }, renderInline(block.children));
          if (block.type === 'blockquote') return h('blockquote', { key: index }, renderInline(block.children));
          if (block.type === 'list') {
            const tag = block.ordered ? 'ol' : 'ul';
            return h(tag, { key: index }, block.items.map((item, itemIndex) => h('li', { key: itemIndex }, renderInline(item))));
          }
          if (block.type === 'code') {
            return h('pre', { key: index, class: 'md-code-block' }, [
              h('code', { class: block.language ? `language-${block.language}` : undefined }, block.code)
            ]);
          }
          if (block.type === 'hr') return h('hr', { key: index });
          return h('p', { key: index }, renderInline(block.children));
        })
      );
  }
});

async function loadPersonas() {
  const response = await fetchPersonas();
  personas.value = response.personas;
  engines.value = response.engines;
  if (!selectedPersonaId.value && response.personas[0]) {
    selectedPersonaId.value = response.personas[0].id;
  }
}

async function switchToNextPersona() {
  await loadPersonas();
  if (personas.value.length < 2) {
    setMessage('当前只有一位大师可选');
    return;
  }
  const currentIndex = personas.value.findIndex((persona) => persona.id === selectedPersonaId.value);
  const nextPersona = personas.value[(currentIndex + 1) % personas.value.length];
  await selectPersona(nextPersona);
  await nextTick();
  setMessage(`已切换到${nextPersona.name}`);
}

async function loadLocalState() {
  sharedProfile.value = await getSharedProfile();
  await loadBirthProfiles();
  chart.value = sharedProfile.value?.chart ?? null;
  const activeProfile = birthProfiles.value.find((profile) => profile.id === sharedProfile.value?.activeBirthProfileId);
  if (activeProfile) {
    await activateBirthProfile(activeProfile, { silent: true });
  } else if (!chart.value && birthProfiles.value[0]) {
    await activateBirthProfile(birthProfiles.value[0], { silent: true });
  }
  const stored = getCredentials();
  if (stored) Object.assign(credentialsDraft, stored);
  if (selectedPersonaId.value) {
    roleHistory.value = await getRoleHistory(selectedPersonaId.value);
  }
}

async function selectPersona(persona: PersonaSkin) {
  selectedPersonaId.value = persona.id;
  activePanel.value = 'reading';
  roleHistory.value = await getRoleHistory(persona.id);
  readingText.value = '';
}

async function choosePersona(persona: PersonaSkin) {
  await selectPersona(persona);
  masterModalOpen.value = false;
  setMessage(`已选择${persona.name}`);
}

async function loadBirthProfiles() {
  birthProfiles.value = await getBirthProfiles();
}

function cloneBirthInput(input: BirthDateTimeInput): BirthDateTimeInput {
  const cloned = JSON.parse(JSON.stringify(input)) as BirthDateTimeInput;
  return {
    ...cloned,
    ziHourPolicy: cloned.ziHourPolicy ?? 'lateZiNextDay',
    luckTimeBasis: cloned.luckTimeBasis ?? 'clock'
  };
}

function syncBirthDraftFromInput(input: BirthDateTimeInput, name = '', id = '') {
  Object.assign(birthForm, cloneBirthInput(input));
  birthProfileName.value = name;
  editingBirthProfileId.value = id;
  latitudeDraft.value = input.location?.latitude === undefined ? '' : String(input.location.latitude);
  longitudeDraft.value = input.location?.longitude === undefined ? '' : String(input.location.longitude);
  syncSelectedLocationFromInput(input);
  locationSearch.value = '';
  directPillarsText.value = input.directPillars
    ? [input.directPillars.year, input.directPillars.month, input.directPillars.day, input.directPillars.hour].filter(Boolean).join(' ')
    : '';
}

function syncBirthDraftFromProfile(profile: BirthProfile) {
  syncBirthDraftFromInput(profile.input, profile.name, profile.id);
}

function resetBirthDraft() {
  syncBirthDraftFromInput(createDefaultBirthInput(), '', '');
}

function openBirthModal() {
  if (activeBirthProfile.value) {
    syncBirthDraftFromProfile(activeBirthProfile.value);
  } else if (!editingBirthProfileId.value) {
    resetBirthDraft();
  }
  birthModalOpen.value = true;
}

function createFallbackBirthName() {
  const index = editingBirthProfileId.value ? birthProfiles.value.findIndex((profile) => profile.id === editingBirthProfileId.value) + 1 : birthProfiles.value.length + 1;
  return `生辰档案 ${Math.max(index, 1)}`;
}

function padNumber(value: number) {
  return String(value).padStart(2, '0');
}

function formatBirthProfileMeta(profile: BirthProfile) {
  if (profile.input.calendarType === 'bazi') {
    const pillars = profile.input.directPillars;
    return `四柱 ${pillars?.year || '--'} ${pillars?.month || '--'} ${pillars?.day || '--'} ${pillars?.hour || '--'}`;
  }
  const calendar = profile.input.calendarType === 'solar' ? '公历' : '农历';
  return `${calendar} ${profile.input.year}-${padNumber(profile.input.month)}-${padNumber(profile.input.day)} ${padNumber(profile.input.hour)}:${padNumber(profile.input.minute)}`;
}

function formatLuckTimeBasis(basis?: BirthDateTimeInput['luckTimeBasis']) {
  return basis === 'trueSolar' ? '真太阳时' : '钟表时间';
}

function formatLuckSummary(luck: BaziChart['luck']) {
  if (luck.unavailableReason) return `起运 ${luck.unavailableReason}`;
  return [
    `起运 ${luck.startAgeText}`,
    luck.startSolarDateTime ? `交运 ${luck.startSolarDateTime}` : '',
    formatLuckTimeBasis(luck.timeBasis)
  ]
    .filter(Boolean)
    .join(' · ');
}

function formatLuckCycleRange(cycle: LuckCycle) {
  const startYear = cycle.displayStartYear ?? cycle.startYear;
  const endYear = cycle.displayEndYear ?? cycle.endYear;
  const startAge = cycle.displayStartAge ?? cycle.startAge;
  const endAge = cycle.displayEndAge ?? cycle.endAge;
  return `${startYear}-${endYear} · ${startAge}-${endAge}岁`;
}

function uniqueValues(values: string[]) {
  return [...new Set(values)];
}

function formatSignedMinutes(value: number) {
  const rounded = Math.round(value);
  if (rounded === 0) return '0分钟';
  return `${rounded > 0 ? '+' : ''}${rounded}分钟`;
}

function formatCoordinate(value: number) {
  return value.toFixed(4);
}

function normalizeCoordinateDraft(field: 'latitude' | 'longitude') {
  const draft = field === 'latitude' ? latitudeDraft : longitudeDraft;
  const value = Number(String(draft.value ?? '').trim());
  draft.value = Number.isFinite(value) ? formatCoordinate(value) : '';
}

function clearSelectedLocation() {
  selectedLocationId.value = '';
  selectedProvince.value = '';
  selectedCity.value = '';
  latitudeDraft.value = '';
  longitudeDraft.value = '';
  locationSearch.value = '';
  birthForm.location = undefined;
}

function setSelectedLocation(location: BirthLocation | undefined) {
  if (!location) {
    clearSelectedLocation();
    return;
  }
  selectedLocationId.value = location.id;
  selectedProvince.value = location.province;
  selectedCity.value = location.city;
  latitudeDraft.value = formatCoordinate(location.latitude);
  longitudeDraft.value = formatCoordinate(location.longitude);
  birthForm.location = {
    name: getBirthLocationLabel(location),
    latitude: location.latitude,
    longitude: location.longitude
  };
}

function syncSelectedLocationFromInput(input: BirthDateTimeInput) {
  const longitude = input.location?.longitude;
  if (longitude === undefined) {
    clearSelectedLocation();
    return;
  }
  const matched = BIRTH_LOCATIONS.find((location) => location.id !== 'unknown-beijing-time' && Math.abs(location.longitude - longitude) < 0.0001);
  if (matched) {
    setSelectedLocation(matched);
  } else {
    selectedLocationId.value = '';
    latitudeDraft.value = input.location?.latitude === undefined ? '' : formatCoordinate(input.location.latitude);
    longitudeDraft.value = formatCoordinate(longitude);
  }
}

function handleProvinceChange() {
  selectedCity.value = locationCities.value[0] ?? '';
  setSelectedLocation(locationDistricts.value[0]);
}

function handleCityChange() {
  setSelectedLocation(locationDistricts.value[0]);
}

function handleDistrictChange() {
  setSelectedLocation(findBirthLocationById(selectedLocationId.value));
}

async function activateBirthProfile(profile: BirthProfile, options: { silent?: boolean; closeModal?: boolean } = {}) {
  const birthInput = cloneBirthInput(profile.input);
  const nextChart = createBaziChart(birthInput);
  chart.value = nextChart;
  syncBirthDraftFromInput(birthInput, profile.name, profile.id);
  sharedProfile.value = await saveSharedChart(nextChart, profile.id);
  if (options.closeModal) birthModalOpen.value = false;
  if (!options.silent) setMessage(`已切换到 ${profile.name}`);
}

function updateLocation() {
  const rawLatitude = String(latitudeDraft.value ?? '').trim();
  const rawLongitude = String(longitudeDraft.value ?? '').trim();
  if (!rawLongitude) {
    birthForm.location = undefined;
    return;
  }
  const latitude = Number(rawLatitude);
  const longitude = Number(rawLongitude);
  const selected = selectedBirthLocation.value;
  birthForm.location = Number.isFinite(longitude)
    ? {
        name: selected ? getBirthLocationLabel(selected) : '出生地',
        latitude: Number.isFinite(latitude) ? latitude : selected?.latitude,
        longitude
      }
    : undefined;
}

async function submitBirthForm() {
  try {
    if (birthForm.calendarType === 'bazi') {
      applyDirectPillarsText();
    }
    updateLocation();
    const birthInput = cloneBirthInput(birthForm);
    const nextChart = createBaziChart(birthInput);
    const profile = await saveBirthProfile({
      id: editingBirthProfileId.value || undefined,
      name: birthProfileName.value.trim() || createFallbackBirthName(),
      birthInput,
      chart: nextChart
    });
    await loadBirthProfiles();
    chart.value = nextChart;
    sharedProfile.value = await saveSharedChart(nextChart, profile.id);
    syncBirthDraftFromProfile(profile);
    birthModalOpen.value = false;
    setMessage(`${profile.name} 已保存并切换`);
  } catch (error: any) {
    setMessage(error?.message ?? '生辰保存失败');
  }
}

function applyDirectPillarsText() {
  const parts = directPillarsText.value
    .replace(/[，,、/|]+/g, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length === 4 && birthForm.directPillars) {
    const names: PillarName[] = ['year', 'month', 'day', 'hour'];
    names.forEach((name, index) => {
      birthForm.directPillars![name] = parts[index];
    });
  }
}

async function removeBirthProfile(profile: BirthProfile, event?: Event) {
  event?.stopPropagation();
  if (!window.confirm(`删除「${profile.name}」？`)) return;
  const wasActive = sharedProfile.value?.activeBirthProfileId === profile.id;
  const wasEditing = editingBirthProfileId.value === profile.id;
  await deleteBirthProfile(profile.id);
  await loadBirthProfiles();
  if (wasActive) {
    const nextProfile = birthProfiles.value[0];
    if (nextProfile) {
      await activateBirthProfile(nextProfile, { silent: true });
      setMessage(`已删除并切换到 ${nextProfile.name}`);
    } else {
      chart.value = null;
      resetBirthDraft();
      sharedProfile.value = await saveSharedChart(null, null);
      setMessage('生辰档案已清空');
    }
    return;
  }
  if (wasEditing) resetBirthDraft();
  setMessage('生辰档案已删除');
}

async function addFact() {
  if (!factDraft.value.trim()) return;
  sharedProfile.value = await saveSharedFact(factDraft.value);
  factDraft.value = '';
  setMessage('档案已更新');
}

async function addLifeEvent() {
  const year = Number(eventYearDraft.value);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    setMessage('事件年份需要在 1900-2100 之间');
    return;
  }
  if (!eventTitleDraft.value.trim()) {
    setMessage('请填写事件标题');
    return;
  }
  sharedProfile.value = await saveLifeEvent({
    year,
    title: eventTitleDraft.value,
    note: eventNoteDraft.value
  });
  eventTitleDraft.value = '';
  eventNoteDraft.value = '';
  setMessage('人生事件已写入档案');
}

let openingCloseTimer: number | undefined;
let openingHideTimer: number | undefined;

function prefersReducedOpeningMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function clearOpeningTimers() {
  if (openingCloseTimer !== undefined) {
    window.clearTimeout(openingCloseTimer);
    openingCloseTimer = undefined;
  }
  if (openingHideTimer !== undefined) {
    window.clearTimeout(openingHideTimer);
    openingHideTimer = undefined;
  }
}

function finishOpeningAnimation(mode: 'collapse' | 'enter', hideDelay?: number) {
  if (!showOpeningAnimation.value || openingAnimationClosing.value) return;
  clearOpeningTimers();
  openingAnimationEntering.value = mode === 'enter';
  openingAnimationClosing.value = true;
  const reduced = prefersReducedOpeningMotion();
  const delay = hideDelay ?? (mode === 'enter' ? (reduced ? 180 : 680) : (reduced ? 320 : 620));
  openingHideTimer = window.setTimeout(() => {
    showOpeningAnimation.value = false;
    openingAnimationEntering.value = false;
    openingHideTimer = undefined;
  }, delay);
}

function startOpeningAnimation() {
  clearOpeningTimers();
  openingCloseTimer = window.setTimeout(() => {
    finishOpeningAnimation('collapse');
  }, prefersReducedOpeningMotion() ? 2200 : 3800);
}

function enterFromOpeningAnimation() {
  finishOpeningAnimation('enter');
}

function skipOpeningAnimation() {
  finishOpeningAnimation('enter');
}

async function removeFact(fact: string) {
  sharedProfile.value = await removeSharedFact(fact);
  setMessage('上下文已移除');
}

async function deleteLifeEvent(eventId: string) {
  sharedProfile.value = await removeLifeEvent(eventId);
  setMessage('人生事件已移除');
}

function latestAssistantReading() {
  return (
    cleanVisibleReportContent(readingText.value || latestAssistantMessage.value?.content || '') ||
    ''
  );
}

function cleanVisibleReportContent(content: string) {
  return content
    .replace(/[ \t]*【依据：[^】]*】/g, '')
    .replace(/[ \t]*\[依据：[^\]]*\]/g, '')
    .replace(/[ \t]*（依据：[^）]*）/g, '')
    .replace(/[ \t]*\(依据：[^)]*\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function reportTaskTitle(task: FortuneTask | string | undefined) {
  if (task === 'structured_report') return productCatalog.structured_report.title;
  if (task === 'multi_school') return productCatalog.multi_school.title;
  if (task === 'bazi_full') return t('home.fullReading');
  if (task === 'daily') return t('home.dailyFortune');
  if (task === 'daily_lot') return t('home.dailyLot');
  return '命理解读';
}

function isReportExportTask(task: FortuneTask | string | undefined): task is ReportExportTask {
  return task === 'structured_report' || task === 'multi_school';
}

function isExportableReportMessage(message: ChatMessage) {
  return message.role === 'assistant' && message.metadata?.exportable === true && isReportExportTask(message.metadata.task);
}

function sanitizeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 48) || 'bazi-report';
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMarkdownInlineHtml(children: MarkdownInline[]) {
  return children
    .map((child) => {
      const text = escapeHtml(child.text);
      if (child.type === 'strong') return `<strong>${text}</strong>`;
      if (child.type === 'em') return `<em>${text}</em>`;
      if (child.type === 'code') return `<code>${text}</code>`;
      return `<span>${text}</span>`;
    })
    .join('');
}

function renderMarkdownBlocksHtml(blocks: MarkdownBlock[]) {
  return blocks
    .map((block) => {
      if (block.type === 'heading') return `<h${block.level}>${renderMarkdownInlineHtml(block.children)}</h${block.level}>`;
      if (block.type === 'blockquote') return `<blockquote>${renderMarkdownInlineHtml(block.children)}</blockquote>`;
      if (block.type === 'list') {
        const tag = block.ordered ? 'ol' : 'ul';
        return `<${tag}>${block.items.map((item) => `<li>${renderMarkdownInlineHtml(item)}</li>`).join('')}</${tag}>`;
      }
      if (block.type === 'code') {
        return `<pre><code>${escapeHtml(block.code)}</code></pre>`;
      }
      if (block.type === 'hr') return '<hr />';
      return `<p>${renderMarkdownInlineHtml(block.children)}</p>`;
    })
    .join('\n');
}

function reportTemplateStyles() {
  return `
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #171512;
      background: #ece8df;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      line-height: 1.68;
    }
    .report-page {
      width: 1120px;
      margin: 0 auto;
      padding: 44px;
      background:
        radial-gradient(circle at 82% 0%, rgba(186, 140, 70, 0.16), transparent 30%),
        linear-gradient(135deg, #fbfaf6 0%, #f2efe7 100%);
    }
    .report-sheet {
      overflow: hidden;
      border: 1px solid #d4ccbd;
      border-radius: 22px;
      background: rgba(255, 253, 248, 0.96);
      box-shadow: 0 24px 70px rgba(51, 42, 28, 0.16);
    }
    .report-cover {
      position: relative;
      padding: 44px 48px 38px;
      color: #fffaf0;
      background:
        linear-gradient(135deg, rgba(20, 20, 19, 0.98), rgba(64, 50, 33, 0.94)),
        radial-gradient(circle at 80% 18%, rgba(236, 197, 102, 0.26), transparent 34%);
    }
    .report-cover::after {
      content: "";
      position: absolute;
      right: -72px;
      bottom: -96px;
      width: 260px;
      height: 260px;
      border: 1px solid rgba(236, 197, 102, 0.28);
      border-radius: 50%;
      box-shadow: inset 0 0 0 24px rgba(255, 253, 248, 0.04);
    }
    .report-brand {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 38px;
      font-size: 13px;
      letter-spacing: 0;
      opacity: 0.86;
    }

    .report-brand > span:first-child {
      min-width: 0;
    }

    .report-badge {
      display: inline-flex;
      min-width: 112px;
      height: 32px;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      padding: 6px 12px;
      border: 1px solid rgba(255, 250, 240, 0.28);
      border-radius: 999px;
      background: rgba(255, 250, 240, 0.08);
      line-height: 1;
    }
    .report-cover h1 {
      max-width: 760px;
      margin: 0;
      font-family: "Iowan Old Style", "Palatino Linotype", "Songti SC", "SimSun", serif;
      font-size: 44px;
      line-height: 1.1;
      font-weight: 700;
    }
    .report-cover p {
      max-width: 720px;
      margin: 16px 0 0;
      color: rgba(255, 250, 240, 0.76);
      font-size: 16px;
    }
    .report-meta {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      padding: 22px;
      border-bottom: 1px solid #ded8cc;
      background: #f7f4ed;
    }
    .report-meta span,
    .summary-card span {
      display: block;
      color: #8b857b;
      font-size: 12px;
      font-weight: 700;
    }
    .report-meta strong,
    .summary-card strong {
      display: block;
      margin-top: 4px;
      color: #1a1815;
      font-size: 16px;
    }
    .pillar-strip {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      padding: 24px 32px 8px;
    }
    .pillar-card,
    .summary-card {
      border: 1px solid #ded8cc;
      border-radius: 14px;
      background: #fffdf8;
    }
    .pillar-card {
      padding: 14px;
      text-align: center;
    }
    .pillar-card small {
      display: block;
      color: #8b857b;
      font-size: 12px;
      font-weight: 700;
    }
    .pillar-ganzhi {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 8px;
    }
    .pillar-char {
      display: grid;
      min-height: 62px;
      place-items: center;
      padding: 7px 6px;
      color: var(--element-color);
      border: 1px solid var(--element-soft);
      border-radius: 10px;
      background: var(--element-tint);
    }
    .pillar-char b {
      display: block;
      font-family: "Iowan Old Style", "Palatino Linotype", "Songti SC", "SimSun", serif;
      font-size: 34px;
      line-height: 0.96;
      letter-spacing: 0;
    }
    .pillar-char em {
      display: block;
      margin-top: 3px;
      font-size: 12px;
      font-style: normal;
      font-weight: 700;
      line-height: 1;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      padding: 16px 32px 28px;
    }
    .summary-card { padding: 16px; }
    .report-content {
      padding: 36px 48px 46px;
      background: #fffdf8;
    }
    .report-content h1,
    .report-content h2,
    .report-content h3 {
      margin: 30px 0 12px;
      color: #171512;
      line-height: 1.25;
    }
    .report-content h1 { font-size: 28px; }
    .report-content h2 { font-size: 23px; }
    .report-content h3 { font-size: 19px; }
    .report-content p,
    .report-content li,
    .report-content blockquote {
      color: #34312d;
      font-size: 15px;
    }
    .report-content p { margin: 0 0 14px; }
    .report-content ul,
    .report-content ol {
      margin: 8px 0 18px;
      padding-left: 24px;
    }
    .report-content li { margin: 6px 0; }
    .report-content strong { color: #111; }
    .report-content blockquote {
      margin: 18px 0;
      padding: 14px 18px;
      border-left: 4px solid #b78949;
      background: #f7f2e8;
    }
    .report-content hr {
      margin: 28px 0;
      border: 0;
      border-top: 1px solid #ded8cc;
    }
    .report-footer {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 32px;
      color: #8b857b;
      border-top: 1px solid #ded8cc;
      background: #f7f4ed;
      font-size: 12px;
    }
    @media print {
      body { background: #fff; }
      .report-page {
        width: auto;
        padding: 0;
        background: #fff;
      }
      .report-sheet {
        border: 0;
        border-radius: 0;
        box-shadow: none;
      }
      @page { margin: 12mm; size: A4; }
    }
  `;
}

function reportMetaItems(message: ChatMessage) {
  return [
    { label: '报告类型', value: reportTaskTitle(message.metadata?.task) },
    { label: '命盘档案', value: birthTriggerLabel.value },
    { label: '解读大师', value: selectedPersona.value?.name ?? t('home.masterFallback') },
    { label: '生成时间', value: new Date(message.createdAt).toLocaleString('zh-CN', { hour12: false }) }
  ];
}

function reportSummaryItems() {
  if (!chart.value) {
    return [
      { label: '日主', value: '未生成命盘' },
      { label: '当前大运', value: '待定' },
      { label: '真太阳时', value: '待定' }
    ];
  }
  const trueSolar = chart.value.trueSolarTime.enabled && chart.value.trueSolarTime.correctedTime
    ? `${formatCivilDateTime(chart.value.trueSolarTime.correctedTime).slice(0, 16)}`
    : '未启用';
  return [
    { label: '日主强弱', value: `${chart.value.dayMaster.gan}${chart.value.dayMaster.element} · ${chart.value.strength?.dayMasterStrength.conclusion ?? '待定'}` },
    { label: '当前大运', value: currentLuckCycle.value?.ganZhi ?? chart.value.luck.startAgeText },
    { label: '真太阳时', value: trueSolar }
  ];
}

function buildReportBody(message: ChatMessage) {
  const taskTitle = reportTaskTitle(message.metadata?.task);
  const title = `${birthTriggerLabel.value} · ${taskTitle}`;
  const metaHtml = reportMetaItems(message)
    .map((item) => `<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`)
    .join('');
  const pillarsHtml = pillarRows.value.length
    ? pillarRows.value
        .map((pillar) => {
          const ganVisual = ELEMENT_VISUALS[pillar.ganElement];
          const zhiVisual = ELEMENT_VISUALS[pillar.zhiElement];
          const ganStyle = `--element-color:${ganVisual.color};--element-soft:${ganVisual.soft};--element-tint:${ganVisual.tint};`;
          const zhiStyle = `--element-color:${zhiVisual.color};--element-soft:${zhiVisual.soft};--element-tint:${zhiVisual.tint};`;
          return `<div class="pillar-card"><small>${escapeHtml(pillar.label)}</small><div class="pillar-ganzhi"><span class="pillar-char" style="${ganStyle}"><b>${escapeHtml(pillar.gan)}</b><em>${escapeHtml(pillar.ganElement)}</em></span><span class="pillar-char" style="${zhiStyle}"><b>${escapeHtml(pillar.zhi)}</b><em>${escapeHtml(pillar.zhiElement)}</em></span></div></div>`;
        })
        .join('')
    : '<div class="pillar-card"><small>命盘</small><b>待生成</b></div>';
  const summaryHtml = reportSummaryItems()
    .map((item) => `<div class="summary-card"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`)
    .join('');
  const contentHtml = renderMarkdownBlocksHtml(parseMarkdown(cleanVisibleReportContent(message.content)));
  const subtitle =
    message.metadata?.task === 'multi_school'
      ? '以多流派交叉校验的方式呈现命局判断、分歧取舍与行动建议。'
      : '围绕命局底盘、事业财运、关系健康与阶段策略形成可阅读、可留存的专业报告。';

  return `
    <main class="report-page">
      <article class="report-sheet">
        <header class="report-cover">
          <div class="report-brand">
            <span>八字命理学 · 专业交付报告</span>
            <span class="report-badge">${escapeHtml(taskTitle)}</span>
          </div>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(subtitle)}</p>
        </header>
        <section class="report-meta">${metaHtml}</section>
        <section class="pillar-strip">${pillarsHtml}</section>
        <section class="summary-grid">${summaryHtml}</section>
        <section class="report-content">${contentHtml}</section>
        <footer class="report-footer">
          <span>本报告由八字命理学工作台生成，仅供命理研究与自我规划参考。</span>
          <span>${escapeHtml(new Date().toLocaleDateString('zh-CN'))}</span>
        </footer>
      </article>
    </main>
  `;
}

function buildReportDocument(message: ChatMessage) {
  return `<!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(`${birthTriggerLabel.value}-${reportTaskTitle(message.metadata?.task)}`)}</title>
        <style>${reportTemplateStyles()}</style>
      </head>
      <body>${buildReportBody(message)}</body>
    </html>`;
}

async function exportReportPdf() {
  const message = latestExportableReport.value;
  if (!message) {
    setMessage('请先生成专业报告或流派会诊，命盘速览不支持导出');
    return;
  }
  try {
    const reportCanvas = createReportCanvas(message);
    const pdfBlob = await createPdfFromReportCanvas(reportCanvas);
    downloadBlob(pdfBlob, `${sanitizeFilename(`${birthTriggerLabel.value}-${reportTaskTitle(message.metadata?.task)}`)}.pdf`);
    setMessage('PDF 报告已导出');
  } catch (error: any) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setMessage(error?.message ?? 'PDF 生成失败，请稍后重试');
      return;
    }
    printWindow.document.open();
    printWindow.document.write(buildReportDocument(message));
    printWindow.document.close();
    window.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 350);
    setMessage('PDF 直接生成失败，已打开打印页作为备用');
  }
}

type CanvasTextToken = { text: string; bold?: boolean; italic?: boolean; code?: boolean };

function flattenInlineText(children: MarkdownInline[]): CanvasTextToken[] {
  return children.map((child) => ({
    text: child.text,
    bold: child.type === 'strong',
    italic: child.type === 'em',
    code: child.type === 'code'
  }));
}

function setCanvasFont(context: CanvasRenderingContext2D, size: number, weight = 400, family = 'Microsoft YaHei, PingFang SC, Arial') {
  context.font = `${weight} ${size}px ${family}`;
}

function canvasRoundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function canvasFillRoundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number, fill: string) {
  canvasRoundRect(context, x, y, width, height, radius);
  context.fillStyle = fill;
  context.fill();
}

function canvasStrokeRoundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number, stroke: string) {
  canvasRoundRect(context, x, y, width, height, radius);
  context.strokeStyle = stroke;
  context.stroke();
}

function wrapCanvasTokens(context: CanvasRenderingContext2D, tokens: CanvasTextToken[], maxWidth: number, size: number) {
  const lines: CanvasTextToken[][] = [];
  let current: CanvasTextToken[] = [];
  let width = 0;
  const pushLine = () => {
    if (current.length) lines.push(current);
    current = [];
    width = 0;
  };

  for (const token of tokens) {
    const parts = token.text.split(/(\s+)/).flatMap((part) => {
      if (!part || /\s+/.test(part)) return part ? [part] : [];
      const chars = Array.from(part);
      return chars.length > 16 ? chars : [part];
    });
    for (const part of parts) {
      setCanvasFont(context, size, token.bold ? 700 : 400);
      const partWidth = context.measureText(part).width;
      if (width > 0 && width + partWidth > maxWidth) pushLine();
      current.push({ ...token, text: part });
      width += partWidth;
    }
  }
  pushLine();
  return lines;
}

function measureCanvasText(context: CanvasRenderingContext2D, tokens: CanvasTextToken[], maxWidth: number, size: number, lineHeight: number) {
  return Math.max(lineHeight, wrapCanvasTokens(context, tokens, maxWidth, size).length * lineHeight);
}

function drawCanvasText(
  context: CanvasRenderingContext2D,
  tokens: CanvasTextToken[],
  x: number,
  y: number,
  maxWidth: number,
  options: { size: number; lineHeight: number; color?: string; weight?: number }
) {
  const lines = wrapCanvasTokens(context, tokens, maxWidth, options.size);
  context.textBaseline = 'top';
  lines.forEach((line, lineIndex) => {
    let offsetX = 0;
    line.forEach((token) => {
      setCanvasFont(context, options.size, token.bold ? 700 : options.weight ?? 400);
      context.fillStyle = token.code ? '#7a5222' : options.color ?? '#34312d';
      context.fillText(token.text, x + offsetX, y + lineIndex * options.lineHeight);
      offsetX += context.measureText(token.text).width;
    });
  });
  return y + lines.length * options.lineHeight;
}

function estimateReportImageHeight(context: CanvasRenderingContext2D, message: ChatMessage, contentWidth: number) {
  let height = 44 + 230 + 92 + 138 + 104 + 76;
  for (const block of parseMarkdown(cleanVisibleReportContent(message.content))) {
    if (block.type === 'heading') {
      const size = block.level <= 2 ? 25 : 20;
      height += 22 + measureCanvasText(context, flattenInlineText(block.children), contentWidth, size, Math.round(size * 1.35));
    } else if (block.type === 'list') {
      for (const item of block.items) {
        height += measureCanvasText(context, flattenInlineText(item), contentWidth - 28, 16, 28) + 4;
      }
      height += 8;
    } else if (block.type === 'blockquote') {
      height += measureCanvasText(context, flattenInlineText(block.children), contentWidth - 34, 16, 28) + 28;
    } else if (block.type === 'code') {
      height += measureCanvasText(context, [{ text: block.code }], contentWidth - 28, 14, 24) + 24;
    } else if (block.type === 'hr') {
      height += 28;
    } else {
      height += measureCanvasText(context, flattenInlineText(block.children), contentWidth, 16, 29) + 10;
    }
  }
  return Math.ceil(height + 80);
}

function drawCanvasReport(context: CanvasRenderingContext2D, message: ChatMessage, width: number, height: number) {
  const pageX = 44;
  const sheetX = 44;
  const sheetY = 44;
  const sheetWidth = width - 88;
  const contentX = sheetX + 48;
  const contentWidth = sheetWidth - 96;
  const taskTitle = reportTaskTitle(message.metadata?.task);
  const title = `${birthTriggerLabel.value} · ${taskTitle}`;
  const subtitle =
    message.metadata?.task === 'multi_school'
      ? '以多流派交叉校验的方式呈现命局判断、分歧取舍与行动建议。'
      : '围绕命局底盘、事业财运、关系健康与阶段策略形成可阅读、可留存的专业报告。';

  context.fillStyle = '#ece8df';
  context.fillRect(0, 0, width, height);
  const bg = context.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#fbfaf6');
  bg.addColorStop(1, '#f2efe7');
  context.fillStyle = bg;
  context.fillRect(pageX, pageX, width - pageX * 2, height - pageX * 2);

  canvasFillRoundRect(context, sheetX, sheetY, sheetWidth, height - 88, 22, '#fffdf8');
  canvasStrokeRoundRect(context, sheetX, sheetY, sheetWidth, height - 88, 22, '#d4ccbd');

  const coverHeight = 230;
  const coverGradient = context.createLinearGradient(sheetX, sheetY, sheetX + sheetWidth, sheetY + coverHeight);
  coverGradient.addColorStop(0, '#141413');
  coverGradient.addColorStop(1, '#463720');
  canvasFillRoundRect(context, sheetX, sheetY, sheetWidth, coverHeight, 22, coverGradient as unknown as string);
  context.fillStyle = coverGradient;
  context.fillRect(sheetX, sheetY + 22, sheetWidth, coverHeight - 22);
  context.strokeStyle = 'rgba(236, 197, 102, 0.32)';
  context.lineWidth = 1;
  context.beginPath();
  context.arc(sheetX + sheetWidth - 80, sheetY + coverHeight - 10, 116, 0, Math.PI * 2);
  context.stroke();

  setCanvasFont(context, 14, 500);
  context.fillStyle = 'rgba(255, 250, 240, 0.86)';
  context.fillText('八字命理学 · 专业交付报告', contentX, sheetY + 38);
  const badgeWidth = Math.max(112, context.measureText(taskTitle).width + 28);
  const badgeX = contentX + contentWidth - badgeWidth;
  const badgeY = sheetY + 30;
  canvasFillRoundRect(context, badgeX, badgeY, badgeWidth, 32, 16, 'rgba(255, 250, 240, 0.10)');
  context.strokeStyle = 'rgba(255, 250, 240, 0.28)';
  context.stroke();
  context.fillStyle = '#fffaf0';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(taskTitle, badgeX + badgeWidth / 2, badgeY + 16);
  context.textAlign = 'left';
  context.textBaseline = 'top';

  drawCanvasText(context, [{ text: title, bold: true }], contentX, sheetY + 92, 760, {
    size: 42,
    lineHeight: 52,
    color: '#fffaf0',
    weight: 700
  });
  drawCanvasText(context, [{ text: subtitle }], contentX, sheetY + 154, 720, {
    size: 17,
    lineHeight: 29,
    color: 'rgba(255, 250, 240, 0.78)'
  });

  let y = sheetY + coverHeight;
  context.fillStyle = '#f7f4ed';
  context.fillRect(sheetX, y, sheetWidth, 92);
  const metaItems = reportMetaItems(message);
  const metaWidth = sheetWidth / 4;
  metaItems.forEach((item, index) => {
    const x = sheetX + index * metaWidth + 24;
    setCanvasFont(context, 12, 700);
    context.fillStyle = '#8b857b';
    context.fillText(item.label, x, y + 22);
    drawCanvasText(context, [{ text: item.value, bold: true }], x, y + 46, metaWidth - 38, {
      size: 16,
      lineHeight: 22,
      color: '#1a1815',
      weight: 700
    });
  });
  y += 116;

  const pillarGap = 12;
  const pillarWidth = (sheetWidth - 64 - pillarGap * 3) / 4;
  pillarRows.value.forEach((pillar, index) => {
    const x = sheetX + 32 + index * (pillarWidth + pillarGap);
    canvasFillRoundRect(context, x, y, pillarWidth, 104, 14, '#fffdf8');
    canvasStrokeRoundRect(context, x, y, pillarWidth, 104, 14, '#ded8cc');
    setCanvasFont(context, 12, 700);
    context.fillStyle = '#8b857b';
    context.textAlign = 'center';
    context.fillText(pillar.label, x + pillarWidth / 2, y + 14);
    const charGap = 8;
    const charWidth = (pillarWidth - 28 - charGap) / 2;
    const charY = y + 34;
    [
      { value: pillar.gan, element: pillar.ganElement, x: x + 14 },
      { value: pillar.zhi, element: pillar.zhiElement, x: x + 14 + charWidth + charGap }
    ].forEach((item) => {
      const visual = ELEMENT_VISUALS[item.element];
      canvasFillRoundRect(context, item.x, charY, charWidth, 58, 10, visual.tint);
      canvasStrokeRoundRect(context, item.x, charY, charWidth, 58, 10, visual.soft);
      setCanvasFont(context, 30, 700, '"Songti SC", SimSun, serif');
      context.fillStyle = visual.color;
      context.textBaseline = 'middle';
      context.fillText(item.value, item.x + charWidth / 2, charY + 24);
      setCanvasFont(context, 12, 700);
      context.fillText(item.element, item.x + charWidth / 2, charY + 47);
      context.textBaseline = 'top';
    });
    context.textAlign = 'left';
  });
  y += 122;

  const summaryItems = reportSummaryItems();
  const summaryGap = 12;
  const summaryWidth = (sheetWidth - 64 - summaryGap * 2) / 3;
  summaryItems.forEach((item, index) => {
    const x = sheetX + 32 + index * (summaryWidth + summaryGap);
    canvasFillRoundRect(context, x, y, summaryWidth, 76, 14, '#fffdf8');
    canvasStrokeRoundRect(context, x, y, summaryWidth, 76, 14, '#ded8cc');
    setCanvasFont(context, 12, 700);
    context.fillStyle = '#8b857b';
    context.fillText(item.label, x + 16, y + 14);
    drawCanvasText(context, [{ text: item.value, bold: true }], x + 16, y + 38, summaryWidth - 32, {
      size: 16,
      lineHeight: 22,
      color: '#1a1815',
      weight: 700
    });
  });
  y += 112;

  for (const block of parseMarkdown(cleanVisibleReportContent(message.content))) {
    if (block.type === 'heading') {
      const size = block.level <= 2 ? 25 : 20;
      y += 20;
      y = drawCanvasText(context, flattenInlineText(block.children).map((token) => ({ ...token, bold: true })), contentX, y, contentWidth, {
        size,
        lineHeight: Math.round(size * 1.35),
        color: '#171512',
        weight: 700
      });
      y += 10;
    } else if (block.type === 'list') {
      block.items.forEach((item, index) => {
        setCanvasFont(context, 16, 700);
        context.fillStyle = '#8f672e';
        context.fillText(block.ordered ? `${index + 1}.` : '•', contentX, y + 3);
        y = drawCanvasText(context, flattenInlineText(item), contentX + 28, y, contentWidth - 28, {
          size: 16,
          lineHeight: 28,
          color: '#34312d'
        }) + 4;
      });
      y += 6;
    } else if (block.type === 'blockquote') {
      const h = measureCanvasText(context, flattenInlineText(block.children), contentWidth - 34, 16, 28) + 28;
      canvasFillRoundRect(context, contentX, y, contentWidth, h, 10, '#f7f2e8');
      context.fillStyle = '#b78949';
      context.fillRect(contentX, y + 12, 4, h - 24);
      drawCanvasText(context, flattenInlineText(block.children), contentX + 18, y + 14, contentWidth - 34, {
        size: 16,
        lineHeight: 28,
        color: '#34312d'
      });
      y += h + 14;
    } else if (block.type === 'code') {
      const h = measureCanvasText(context, [{ text: block.code }], contentWidth - 28, 14, 24) + 24;
      canvasFillRoundRect(context, contentX, y, contentWidth, h, 10, '#f7f4ed');
      drawCanvasText(context, [{ text: block.code }], contentX + 14, y + 12, contentWidth - 28, {
        size: 14,
        lineHeight: 24,
        color: '#34312d'
      });
      y += h + 14;
    } else if (block.type === 'hr') {
      context.strokeStyle = '#ded8cc';
      context.beginPath();
      context.moveTo(contentX, y + 12);
      context.lineTo(contentX + contentWidth, y + 12);
      context.stroke();
      y += 28;
    } else {
      y = drawCanvasText(context, flattenInlineText(block.children), contentX, y, contentWidth, {
        size: 16,
        lineHeight: 29,
        color: '#34312d'
      }) + 10;
    }
  }

  context.fillStyle = '#f7f4ed';
  context.fillRect(sheetX, height - 88 - 56, sheetWidth, 56);
  setCanvasFont(context, 12, 400);
  context.fillStyle = '#8b857b';
  context.fillText('本报告由八字命理学工作台生成，仅供命理研究与自我规划参考。', sheetX + 32, height - 88 - 36);
  context.textAlign = 'right';
  context.fillText(new Date().toLocaleDateString('zh-CN'), sheetX + sheetWidth - 32, height - 88 - 36);
  context.textAlign = 'left';
}

function createReportCanvas(message: ChatMessage) {
  const width = 1120;
  const measureCanvas = document.createElement('canvas');
  const measureContext = measureCanvas.getContext('2d');
  if (!measureContext) throw new Error('浏览器不支持报告导出');
  const height = estimateReportImageHeight(measureContext, message, width - 184);
  if (height > 12000) throw new Error('报告内容较长，建议使用 PDF 打印页导出');
  const scale = window.devicePixelRatio > 1 ? 1.5 : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持报告导出');
  context.setTransform(scale, 0, 0, scale, 0, 0);
  drawCanvasReport(context, message, width, height);
  return {
    canvas,
    width,
    height,
    scale
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function dataUrlToBytes(dataUrl: string) {
  const base64 = dataUrl.split(',')[1] ?? '';
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function asciiBytes(value: string) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

function concatBytes(chunks: Uint8Array[]) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

async function createPdfFromReportCanvas(report: { canvas: HTMLCanvasElement; width: number; height: number; scale: number }) {
  const pageWidthPt = 595.28;
  const pageHeightPt = 841.89;
  const sourceWidth = report.canvas.width;
  const sourceHeight = report.canvas.height;
  const pagePixelHeight = Math.round(sourceWidth * (pageHeightPt / pageWidthPt));
  const pageCount = Math.ceil(sourceHeight / pagePixelHeight);
  const pageImages: Array<{ bytes: Uint8Array; width: number; height: number }> = [];

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = sourceWidth;
    pageCanvas.height = pagePixelHeight;
    const pageContext = pageCanvas.getContext('2d');
    if (!pageContext) throw new Error('浏览器不支持 PDF 生成');
    pageContext.fillStyle = '#ece8df';
    pageContext.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    const sourceY = pageIndex * pagePixelHeight;
    const sliceHeight = Math.min(pagePixelHeight, sourceHeight - sourceY);
    pageContext.drawImage(report.canvas, 0, sourceY, sourceWidth, sliceHeight, 0, 0, sourceWidth, sliceHeight);
    pageImages.push({
      bytes: dataUrlToBytes(pageCanvas.toDataURL('image/jpeg', 0.92)),
      width: pageCanvas.width,
      height: pageCanvas.height
    });
  }

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let byteLength = 0;
  const push = (chunk: string | Uint8Array) => {
    const bytes = typeof chunk === 'string' ? asciiBytes(chunk) : chunk;
    chunks.push(bytes);
    byteLength += bytes.length;
  };
  const addObject = (objectNumber: number, body: Array<string | Uint8Array>) => {
    offsets[objectNumber] = byteLength;
    push(`${objectNumber} 0 obj\n`);
    body.forEach(push);
    push('\nendobj\n');
  };

  const pageObjectNumbers = pageImages.map((_, index) => 3 + index * 3);
  const objectCount = 2 + pageImages.length * 3;
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  addObject(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  addObject(2, [`<< /Type /Pages /Kids [${pageObjectNumbers.map((objectNumber) => `${objectNumber} 0 R`).join(' ')}] /Count ${pageImages.length} >>`]);

  pageImages.forEach((image, index) => {
    const pageObject = 3 + index * 3;
    const contentObject = pageObject + 1;
    const imageObject = pageObject + 2;
    const imageName = `Im${index + 1}`;
    const content = `q\n${pageWidthPt} 0 0 ${pageHeightPt} 0 0 cm\n/${imageName} Do\nQ`;
    addObject(pageObject, [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidthPt} ${pageHeightPt}] /Resources << /XObject << /${imageName} ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`
    ]);
    addObject(contentObject, [`<< /Length ${asciiBytes(content).length} >>\nstream\n${content}\nendstream`]);
    addObject(imageObject, [
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
      image.bytes,
      '\nendstream'
    ]);
  });

  const xrefOffset = byteLength;
  push(`xref\n0 ${objectCount + 1}\n`);
  push('0000000000 65535 f \n');
  for (let objectNumber = 1; objectNumber <= objectCount; objectNumber += 1) {
    push(`${String(offsets[objectNumber]).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return new Blob([concatBytes(chunks)], { type: 'application/pdf' });
}

async function exportReportImage() {
  const message = latestExportableReport.value;
  if (!message) {
    setMessage('请先生成专业报告或流派会诊，命盘速览不支持导出');
    return;
  }
  try {
    const reportCanvas = createReportCanvas(message);
    const blob = await new Promise<Blob | null>((resolve) => reportCanvas.canvas.toBlob(resolve, 'image/png', 0.96));
    if (!blob) throw new Error('报告图片生成失败');
    downloadBlob(blob, `${sanitizeFilename(`${birthTriggerLabel.value}-${reportTaskTitle(message.metadata?.task)}`)}.png`);
    setMessage('报告长图已导出');
  } catch (error: any) {
    setMessage(error?.message ?? '报告图片生成失败，请改用 PDF 导出');
  }
}

function openSettings() {
  activePanel.value = 'settings';
}

function resetModelSelection() {
  credentialsDraft.model = '';
  modelOptions.value = [];
  modelSource.value = '';
}

function validateModelLookupCredentials() {
  if (!credentialsDraft.baseUrl.trim()) return '请先填写 base_url';
  if (!/^https?:\/\//i.test(credentialsDraft.baseUrl.trim())) return 'base_url 必须以 http:// 或 https:// 开头';
  if (!credentialsDraft.apiKey.trim()) return '请先填写 key';
  return null;
}

async function refreshModelOptions(silent = false) {
  Object.assign(credentialsDraft, normalizeCredentials(credentialsDraft));
  const error = validateModelLookupCredentials();
  if (error) {
    if (!silent) credentialsStatus.value = error;
    return false;
  }
  loadingModels.value = true;
  if (!silent) credentialsStatus.value = '正在解析可用模型...';
  try {
    const result = await fetchAvailableModels(credentialsDraft);
    modelOptions.value = result.models;
    modelSource.value = result.source;
    if (!modelOptions.value.length) {
      credentialsStatus.value = '没有解析到可用模型，请检查 base_url 和 key';
      return false;
    }
    if (!credentialsDraft.model || !modelOptions.value.includes(credentialsDraft.model)) {
      credentialsDraft.model = modelOptions.value[0];
    }
    if (!silent) {
      credentialsStatus.value = result.source === 'upstream' ? '已解析可用模型，请选择后保存' : '已根据官方服务商推荐模型，请选择后保存';
    }
    return true;
  } catch (error: any) {
    credentialsStatus.value = error?.message ?? '模型列表获取失败';
    return false;
  } finally {
    loadingModels.value = false;
  }
}

async function persistCredentials() {
  Object.assign(credentialsDraft, normalizeCredentials(credentialsDraft));
  if (!credentialsDraft.model && !(await refreshModelOptions(true))) return;
  const error = validateCredentials(credentialsDraft);
  if (error) {
    credentialsStatus.value = error;
    return;
  }
  saveCredentials(credentialsDraft);
  credentialsStatus.value = '凭据已保存到本机浏览器';
}

async function runCredentialTest() {
  Object.assign(credentialsDraft, normalizeCredentials(credentialsDraft));
  if (!credentialsDraft.model && !(await refreshModelOptions(true))) return;
  const error = validateCredentials(credentialsDraft);
  if (error) {
    credentialsStatus.value = error;
    return;
  }
  testingCredentials.value = true;
  credentialsStatus.value = '';
  try {
    await testCredentials(credentialsDraft);
    credentialsStatus.value = '连通性测试通过';
  } catch (error: any) {
    credentialsStatus.value = error?.message ?? '连通性测试失败';
  } finally {
    testingCredentials.value = false;
  }
}

function removeCredentials() {
  clearCredentials();
  credentialsDraft.baseUrl = '';
  credentialsDraft.apiKey = '';
  credentialsDraft.model = '';
  modelOptions.value = [];
  modelSource.value = '';
  credentialsStatus.value = '凭据已从本机浏览器移除';
}

async function scrollAnswerToBottom() {
  await nextTick();
  const element = answerBoxRef.value;
  if (element) {
    element.scrollTop = element.scrollHeight;
  }
}

async function requestReading(task: FortuneTask, question?: string) {
  if (!chart.value || !selectedPersona.value) {
    setMessage('请先选择大师并生成命盘');
    return;
  }
  if (task === 'follow_up' && !question?.trim()) {
    return;
  }
  if (!ensureCommercialAccess({ task, question })) {
    return;
  }
  const credentialError = validateCredentials(credentialsDraft);
  if (credentialError) {
    activePanel.value = 'settings';
    credentialsStatus.value = '请求解读前需要配置凭据；命盘仍可继续查看';
    return;
  }

  Object.assign(credentialsDraft, normalizeCredentials(credentialsDraft));
  streaming.value = true;
  readingText.value = '';
  const currentHistory = roleHistory.value ?? (await getRoleHistory(selectedPersona.value.id));
  const messages = buildFortuneMessages({
    persona: selectedPersona.value,
    engine: selectedPersonaEngine.value,
    chart: chart.value,
    task,
    sharedProfile: sharedProfile.value,
    roleHistory: createMemoryWindow(currentHistory),
    question
  });
  const userText = messages[messages.length - 1].content;

  try {
    roleHistory.value = await appendRoleMessage(selectedPersona.value.id, { role: 'user', content: userText });
    followQuestion.value = '';
    await resetFollowQuestionInputs();
    await scrollAnswerToBottom();
    const fullText = await streamFortuneReading({
      credentials: credentialsDraft,
      messages,
      onDelta(delta) {
        readingText.value += delta;
        void scrollAnswerToBottom();
      }
    });
    const visibleText = cleanVisibleReportContent(fullText);
    roleHistory.value = await appendRoleMessage(selectedPersona.value.id, {
      role: 'assistant',
      content: visibleText,
      metadata: {
        task,
        productTitle: reportTaskTitle(task),
        exportable: isReportExportTask(task)
      }
    });
    registerCommercialUsage(task);
    readingText.value = '';
    await scrollAnswerToBottom();
  } catch (error: any) {
    setMessage(error?.message ?? '解读失败');
  } finally {
    streaming.value = false;
  }
}

async function requestDailyLot() {
  if (drawingLot.value || streaming.value) return;
  if (!ensureCommercialAccess({ task: 'daily_lot' })) return;
  drawingLot.value = true;
  const animationMs = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 220 : 860;
  window.setTimeout(() => {
    drawingLot.value = false;
  }, animationMs);
  await requestReading('daily_lot');
}

async function loginAdmin() {
  adminMessage.value = '';
  try {
    await verifyAdmin(adminSession);
    saveRememberedAdminSession();
    adminAuthed.value = true;
    await reloadAdminPersonas();
  } catch (error: any) {
    adminMessage.value = error?.message ?? '登录失败';
  }
}

function loadRememberedAdminSession() {
  try {
    const raw = window.localStorage.getItem(adminRememberStorageKey);
    if (!raw) return;
    const remembered = JSON.parse(raw) as Partial<AdminSession>;
    adminSession.username = typeof remembered.username === 'string' ? remembered.username : '';
    adminSession.password = typeof remembered.password === 'string' ? remembered.password : '';
    adminRemember.value = Boolean(adminSession.username || adminSession.password);
  } catch {
    window.localStorage.removeItem(adminRememberStorageKey);
  }
}

function saveRememberedAdminSession() {
  if (!adminRemember.value) {
    window.localStorage.removeItem(adminRememberStorageKey);
    return;
  }
  window.localStorage.setItem(
    adminRememberStorageKey,
    JSON.stringify({
      username: adminSession.username,
      password: adminSession.password
    })
  );
}

async function reloadAdminPersonas() {
  adminPersonas.value = await fetchAdminPersonas(adminSession);
}

function resetAdminForm() {
  clearCropPreviews();
  clearAdminEngineDraft();
  Object.assign(adminForm, {
    id: '',
    name: '',
    engineId: 'daoist',
    opening: '',
    customPrompt: '',
    avatarUrl: '/defaults/custom-avatar.svg',
    backgroundUrl: '/defaults/custom-bg.svg',
    mobileBackgroundUrl: '/defaults/custom-bg.svg',
    backgroundIntensity: 100,
    tone: { directness: 50, detail: 60 },
    categories: ['bazi', 'daily'],
    avatarFile: null,
    backgroundFile: null,
    mobileBackgroundFile: null
  });
}

function editPersona(persona: PersonaSkin) {
  clearCropPreviews();
  setAdminEngineDraft(engineById(persona.engineId));
  Object.assign(adminForm, {
    id: persona.id,
    name: persona.name,
    engineId: persona.engineId,
    opening: persona.opening,
    customPrompt: persona.customPrompt ?? '',
    avatarUrl: persona.avatarUrl,
    backgroundUrl: persona.backgroundUrl,
    mobileBackgroundUrl: persona.mobileBackgroundUrl || persona.backgroundUrl,
    backgroundIntensity: clampPercent(persona.backgroundIntensity, 100),
    tone: { ...persona.tone },
    categories: [...persona.categories],
    avatarFile: null,
    backgroundFile: null,
    mobileBackgroundFile: null
  });
}

function clearCropPreviews() {
  if (avatarPreviewUrl.value) URL.revokeObjectURL(avatarPreviewUrl.value);
  if (backgroundPreviewUrl.value) URL.revokeObjectURL(backgroundPreviewUrl.value);
  if (mobileBackgroundPreviewUrl.value) URL.revokeObjectURL(mobileBackgroundPreviewUrl.value);
  avatarPreviewUrl.value = '';
  backgroundPreviewUrl.value = '';
  mobileBackgroundPreviewUrl.value = '';
}

function openCropper(file: File, field: CropField) {
  closeCropper();
  cropSession.open = true;
  cropSession.field = field;
  cropSession.sourceUrl = URL.createObjectURL(file);
  cropSession.fileName = file.name;
  cropSession.aspectRatio = field === 'avatarFile' ? 1 : field === 'backgroundFile' ? 16 / 9 : 9 / 16;
  cropSession.zoom = 1;
  cropSession.offsetX = 0;
  cropSession.offsetY = 0;
  cropSession.baseWidth = 0;
  cropSession.baseHeight = 0;
  cropSession.naturalWidth = 0;
  cropSession.naturalHeight = 0;
}

function setUpload(event: Event, field: CropField) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    adminMessage.value = '请上传图片文件';
    return;
  }
  openCropper(file, field);
}

function closeCropper() {
  if (cropSession.sourceUrl) URL.revokeObjectURL(cropSession.sourceUrl);
  cropSession.open = false;
  cropSession.sourceUrl = '';
  cropSession.fileName = '';
  cropSession.dragging = false;
}

function onCropImageLoad() {
  const image = cropImageRef.value;
  const frame = cropFrameRef.value;
  if (!image || !frame) return;
  cropSession.naturalWidth = image.naturalWidth;
  cropSession.naturalHeight = image.naturalHeight;
  const scale = Math.max(frame.clientWidth / image.naturalWidth, frame.clientHeight / image.naturalHeight);
  cropSession.baseWidth = image.naturalWidth * scale;
  cropSession.baseHeight = image.naturalHeight * scale;
  cropSession.zoom = 1;
  cropSession.offsetX = 0;
  cropSession.offsetY = 0;
}

function clampCropOffset() {
  cropSession.offsetX = Math.max(-cropMaxOffsetX.value, Math.min(cropMaxOffsetX.value, cropSession.offsetX));
  cropSession.offsetY = Math.max(-cropMaxOffsetY.value, Math.min(cropMaxOffsetY.value, cropSession.offsetY));
}

function startCropDrag(event: PointerEvent) {
  cropSession.dragging = true;
  cropSession.dragStartX = event.clientX;
  cropSession.dragStartY = event.clientY;
  cropSession.dragOffsetX = cropSession.offsetX;
  cropSession.dragOffsetY = cropSession.offsetY;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function moveCropDrag(event: PointerEvent) {
  if (!cropSession.dragging) return;
  cropSession.offsetX = cropSession.dragOffsetX + event.clientX - cropSession.dragStartX;
  cropSession.offsetY = cropSession.dragOffsetY + event.clientY - cropSession.dragStartY;
  clampCropOffset();
}

function endCropDrag() {
  cropSession.dragging = false;
}

function createCroppedFile(blob: Blob) {
  const fallbackName = cropSession.field === 'avatarFile' ? 'avatar' : cropSession.field === 'backgroundFile' ? 'background' : 'mobile-background';
  const baseName = cropSession.fileName.replace(/\.[^.]+$/, '') || fallbackName;
  return new File([blob], `${baseName}-cropped.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}

async function confirmCrop() {
  const image = cropImageRef.value;
  const frame = cropFrameRef.value;
  if (!image || !frame || !cropSession.naturalWidth || !cropSession.naturalHeight) return;

  const outputWidth = cropSession.field === 'avatarFile' ? 640 : cropSession.field === 'backgroundFile' ? 1440 : 1080;
  const outputHeight = Math.round(outputWidth / cropSession.aspectRatio);
  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    adminMessage.value = '图片裁剪失败';
    return;
  }

  const frameWidth = frame.clientWidth;
  const frameHeight = frame.clientHeight;
  const displayWidth = cropSession.baseWidth * cropSession.zoom;
  const displayHeight = cropSession.baseHeight * cropSession.zoom;
  const scaleX = outputWidth / frameWidth;
  const scaleY = outputHeight / frameHeight;

  context.fillStyle = '#fffdf8';
  context.fillRect(0, 0, outputWidth, outputHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    (outputWidth - displayWidth * scaleX) / 2 + cropSession.offsetX * scaleX,
    (outputHeight - displayHeight * scaleY) / 2 + cropSession.offsetY * scaleY,
    displayWidth * scaleX,
    displayHeight * scaleY
  );

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) {
    adminMessage.value = '图片裁剪失败';
    return;
  }

  const croppedFile = createCroppedFile(blob);
  adminForm[cropSession.field] = croppedFile;
  const previewUrl = URL.createObjectURL(croppedFile);
  if (cropSession.field === 'avatarFile') {
    if (avatarPreviewUrl.value) URL.revokeObjectURL(avatarPreviewUrl.value);
    avatarPreviewUrl.value = previewUrl;
    adminMessage.value = '头像已裁剪，保存角色后生效';
  } else if (cropSession.field === 'backgroundFile') {
    if (backgroundPreviewUrl.value) URL.revokeObjectURL(backgroundPreviewUrl.value);
    backgroundPreviewUrl.value = previewUrl;
    adminMessage.value = '电脑端背景已裁剪，保存角色后生效';
  } else {
    if (mobileBackgroundPreviewUrl.value) URL.revokeObjectURL(mobileBackgroundPreviewUrl.value);
    mobileBackgroundPreviewUrl.value = previewUrl;
    adminMessage.value = '手机端背景已裁剪，保存角色后生效';
  }
  closeCropper();
}

async function uploadIfNeeded(file: File | null, fallback: string) {
  return file ? uploadRoleImage(adminSession, file) : fallback;
}

async function generatePersonaDraft() {
  const direction = adminGenerator.direction.trim();
  if (!direction) {
    adminMessage.value = '先写一个大师方向';
    return;
  }
  const credentialError = validateCredentials(credentialsDraft);
  if (credentialError) {
    adminMessage.value = `请先在凭据设置里配置模型：${credentialError}`;
    return;
  }

  adminGenerator.generating = true;
  adminMessage.value = '';
  try {
    const text = await streamFortuneReading({
      credentials: credentialsDraft,
      messages: buildPersonaGenerationMessages(direction, engines.value),
      onDelta() {}
    });
    const draft = parseGeneratedDraft(text);
    const engine: PersonaEngine = {
      id: createClientEngineId(),
      name: draft.engine.name,
      worldview: draft.engine.worldview,
      promptRules: draft.engine.promptRules,
      builtin: false
    };
    upsertLocalEngine(engine);
    clearCropPreviews();
    setAdminEngineDraft(engine);
    Object.assign(adminForm, {
      id: '',
      name: draft.persona.name,
      engineId: engine.id,
      opening: draft.persona.opening,
      customPrompt: draft.persona.customPrompt,
      avatarUrl: '/defaults/custom-avatar.svg',
      backgroundUrl: '/defaults/custom-bg.svg',
      mobileBackgroundUrl: '/defaults/custom-bg.svg',
      backgroundIntensity: 100,
      tone: { ...draft.persona.tone },
      categories: [...draft.persona.categories],
      avatarFile: null,
      backgroundFile: null,
      mobileBackgroundFile: null
    });
    triggerAdminGeneratedHighlight();
    adminMessage.value = 'AI 已生成大师草稿，请检查后保存';
  } catch (error: any) {
    adminMessage.value = error?.message ?? 'AI 生成失败';
  } finally {
    adminGenerator.generating = false;
  }
}

async function savePersona() {
  adminMessage.value = '';
  try {
    const engine = buildAdminEnginePayload();
    const avatarUrl = await uploadIfNeeded(adminForm.avatarFile, adminForm.avatarUrl);
    const backgroundUrl = await uploadIfNeeded(adminForm.backgroundFile, adminForm.backgroundUrl);
    const mobileBackgroundUrl = await uploadIfNeeded(adminForm.mobileBackgroundFile, adminForm.mobileBackgroundUrl || backgroundUrl);
    const payload: PersonaPayload = {
      name: adminForm.name,
      engineId: adminForm.engineId,
      opening: adminForm.opening,
      customPrompt: adminForm.customPrompt,
      avatarUrl,
      backgroundUrl,
      mobileBackgroundUrl,
      backgroundIntensity: clampPercent(adminForm.backgroundIntensity, 100),
      tone: { ...adminForm.tone },
      categories: [...adminForm.categories],
      ...(engine ? { engine } : {})
    };
    if (adminForm.id) {
      await updateAdminPersona(adminSession, adminForm.id, payload);
      adminMessage.value = adminEditingBuiltin.value ? '内置角色资源已更新' : '角色已更新';
    } else {
      await createAdminPersona(adminSession, payload);
      adminMessage.value = '角色已创建';
    }
    resetAdminForm();
    await reloadAdminPersonas();
    await loadPersonas();
  } catch (error: any) {
    adminMessage.value = error?.message ?? '保存失败';
  }
}

async function removePersona(persona: PersonaSkin) {
  adminMessage.value = '';
  try {
    await deleteAdminPersona(adminSession, persona.id);
    adminMessage.value = '角色已删除';
    await reloadAdminPersonas();
    await loadPersonas();
  } catch (error: any) {
    adminMessage.value = error?.message ?? '删除失败';
  }
}

onMounted(async () => {
  locale.value = normalizeLocale(window.localStorage.getItem(localeStorageKey) ?? navigator.language);
  loadCommercialState();
  loadRememberedAdminSession();
  document.documentElement.lang = locale.value;
  startOpeningAnimation();
  loading.value = true;
  try {
    await loadPersonas();
    await loadLocalState();
  } catch (error: any) {
    setMessage(error?.message ?? '应用初始化失败');
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  clearOpeningTimers();
});
</script>

<template>
  <main
    class="app-shell"
    :class="{ 'mobile-workspace-shell': activePanel === 'reading' && (mobileTab === 'chart' || mobileTab === 'reading') }"
    :style="{
      '--scene-desktop': `url(${selectedPersona?.backgroundUrl ?? '/defaults/custom-bg.svg'})`,
      '--scene-mobile': `url(${selectedPersona?.mobileBackgroundUrl || selectedPersona?.backgroundUrl || '/defaults/custom-bg.svg'})`,
      '--scene-opacity': sceneOpacity,
      '--scene-saturation': sceneSaturation,
      '--scene-contrast': sceneContrast,
      '--scene-sepia': sceneSepia,
      '--scene-wash-top': sceneWashTop,
      '--scene-wash-bottom': sceneWashBottom,
      '--scene-wash-side-start': sceneWashSideStart,
      '--scene-wash-side-end': sceneWashSideEnd
    }"
  >
    <div class="scene-layer"></div>
    <div
      v-if="showOpeningAnimation"
      class="bagua-opening"
      :class="{ leaving: openingAnimationClosing, entering: openingAnimationEntering }"
      role="status"
      aria-live="polite"
      aria-label="八卦阵启动中"
    >
      <div class="opening-aura" aria-hidden="true"></div>
      <button class="bagua-stage" type="button" aria-label="进入主页" @click="enterFromOpeningAnimation">
        <div class="opening-spark-field" aria-hidden="true">
          <span
            v-for="spark in 16"
            :key="spark"
            class="opening-spark"
            :style="`--spark-angle: ${(spark - 1) * 22.5}deg; --spark-delay: ${spark * 38}ms`"
          ></span>
        </div>
        <div class="opening-runic-ring outer" aria-hidden="true"></div>
        <div class="opening-runic-ring inner" aria-hidden="true"></div>
        <div class="opening-sweep" aria-hidden="true"></div>
        <div class="bagua-ring" aria-hidden="true">
          <span class="bagua-symbol">☰</span>
          <span class="bagua-symbol">☱</span>
          <span class="bagua-symbol">☲</span>
          <span class="bagua-symbol">☳</span>
          <span class="bagua-symbol">☷</span>
          <span class="bagua-symbol">☶</span>
          <span class="bagua-symbol">☵</span>
          <span class="bagua-symbol">☴</span>
        </div>
        <div class="taiji-disc" aria-hidden="true"></div>
      </button>
      <p>乾坤启阵</p>
      <button class="opening-skip" type="button" @click="skipOpeningAnimation">跳过仪式</button>
    </div>
    <header class="topbar">
      <button class="brand-button" type="button" @click="showMobileTab('home')">
        <Wand2 :size="22" aria-hidden="true" />
        <span>命理工作台</span>
        <small>v{{ appVersion }}</small>
      </button>
      <nav class="top-actions" :aria-label="t('nav.main')">
        <button class="icon-button mobile-top-action" type="button" :title="t('nav.chooseMaster')" @click="masterModalOpen = true">
          <UserRound :size="20" aria-hidden="true" />
        </button>
        <button class="text-trigger" type="button" :title="t('nav.chooseMaster')" @click="masterModalOpen = true">
          <UserRound :size="18" aria-hidden="true" />
          <span>{{ selectedPersona?.name ?? t('nav.chooseMaster') }}</span>
        </button>
        <button class="text-trigger" type="button" :title="t('nav.profile')" @click="profileModalOpen = true">
          <Save :size="18" aria-hidden="true" />
          <span>{{ t('nav.profile') }} {{ savedFacts.length + savedLifeEvents.length }}</span>
        </button>
        <button class="text-trigger" type="button" :title="t('nav.history')" @click="openHistoryModal">
          <MessageCircle :size="18" aria-hidden="true" />
          <span>{{ t('nav.history') }} {{ historyMessages.length }}</span>
        </button>
        <button class="text-trigger membership-top-trigger" type="button" title="大师会员" @click="membershipModalOpen = true">
          <Lock :size="18" aria-hidden="true" />
          <span>大师会员</span>
          <small>{{ isMember ? activeMembershipPlan?.title ?? '已开通' : '月卡 / 年卡 / Pro' }}</small>
        </button>
        <button class="birth-trigger" type="button" :title="t('nav.birthProfile')" @click="openBirthModal">
          <CalendarDays :size="18" aria-hidden="true" />
          <span>{{ birthTriggerLabel }}</span>
        </button>
        <button class="icon-button language-toggle" type="button" :title="t('language.label')" :aria-label="t('language.label')" @click="toggleLocale">
          <Languages :size="20" aria-hidden="true" />
          <span>{{ locale === 'zh-CN' ? 'EN' : '中' }}</span>
        </button>
        <button class="icon-button" type="button" :title="t('nav.credentials')" @click="openSettings">
          <KeyRound :size="20" aria-hidden="true" />
        </button>
        <button class="icon-button desktop-admin-action" type="button" :title="t('nav.admin')" @click="activePanel = 'admin'">
          <ShieldCheck :size="20" aria-hidden="true" />
        </button>
      </nav>
    </header>

    <p v-if="appMessage" class="toast" role="status">{{ appMessage }}</p>

    <div v-if="masterModalOpen" class="modal-backdrop" @click.self="masterModalOpen = false">
      <section class="master-modal" role="dialog" aria-modal="true" aria-labelledby="master-modal-title">
        <header class="modal-heading">
          <div>
            <h2 id="master-modal-title">选择大师</h2>
            <p>切换后会清空当前解读文本，并沿用已选择的命盘。</p>
          </div>
          <div class="modal-actions">
            <button class="secondary-button" type="button" title="换位大师" @click="switchToNextPersona">
              <RefreshCw :size="17" aria-hidden="true" />
              换一位
            </button>
            <button class="secondary-button" type="button" @click="masterModalOpen = false">关闭</button>
          </div>
        </header>
        <div class="master-picker-grid">
          <button
            v-for="persona in personas"
            :key="persona.id"
            class="master-card"
            :class="{ active: persona.id === selectedPersonaId }"
            type="button"
            :aria-current="persona.id === selectedPersonaId ? 'true' : undefined"
            @click="choosePersona(persona)"
          >
            <img :src="persona.avatarUrl" :alt="persona.name" />
            <span class="master-name">{{ persona.name }}</span>
            <span class="master-opening">{{ persona.opening }}</span>
          </button>
          <p v-if="!personas.length" class="empty-state">还没有可选大师。</p>
        </div>
      </section>
    </div>

    <div v-if="profileModalOpen" class="modal-backdrop" @click.self="profileModalOpen = false">
      <section class="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-modal-title">
        <header class="modal-heading">
          <div>
            <h2 id="profile-modal-title">个人档案</h2>
            <p>已保存 {{ savedFacts.length }} 条现实上下文、{{ savedLifeEvents.length }} 条人生事件，后续解读会参考这些校验材料。</p>
          </div>
          <button class="secondary-button" type="button" @click="profileModalOpen = false">关闭</button>
        </header>
        <section class="memory-editor profile-memory" aria-label="个人档案维护">
          <div class="profile-subsection">
            <strong>现实上下文</strong>
            <span>职业、关系状态、当前困惑等可长期参考的信息。</span>
          </div>
          <div class="fact-row">
            <input v-model="factDraft" type="text" placeholder="补充现实情况" @keyup.enter="addFact" />
            <button class="icon-button" type="button" title="写入档案" @click="addFact">
              <Save :size="18" aria-hidden="true" />
            </button>
          </div>
          <ul v-if="savedFacts.length" class="fact-list" aria-label="已保存上下文">
            <li v-for="fact in savedFacts" :key="fact" class="fact-item">
              <span>{{ fact }}</span>
              <button class="icon-button danger" type="button" title="删除上下文" @click="removeFact(fact)">
                <Trash2 :size="16" aria-hidden="true" />
              </button>
            </li>
          </ul>
          <p v-else class="empty-state">还没有补充现实情况，保存后会参与后续解读。</p>
          <div class="profile-subsection event-subsection">
            <strong>人生事件线</strong>
            <span>用于回看大运流年是否应事，让报告更贴近真实经历。</span>
          </div>
          <div class="event-row">
            <input v-model.number="eventYearDraft" type="number" min="1900" max="2100" aria-label="事件年份" />
            <input v-model.trim="eventTitleDraft" type="text" maxlength="40" placeholder="事件，例如 换工作 / 搬家 / 分手" @keyup.enter="addLifeEvent" />
            <button class="icon-button" type="button" title="写入事件" @click="addLifeEvent">
              <Save :size="18" aria-hidden="true" />
            </button>
          </div>
          <textarea
            v-model.trim="eventNoteDraft"
            class="event-note-input"
            maxlength="160"
            rows="2"
            placeholder="补充细节，可选"
          ></textarea>
          <ul v-if="savedLifeEvents.length" class="event-list" aria-label="已保存人生事件">
            <li v-for="event in savedLifeEvents" :key="event.id" class="event-item">
              <span class="event-year">{{ event.year }}</span>
              <span class="event-copy">
                <strong>{{ event.title }}</strong>
                <small v-if="event.note">{{ event.note }}</small>
              </span>
              <button class="icon-button danger" type="button" title="删除事件" @click="deleteLifeEvent(event.id)">
                <Trash2 :size="16" aria-hidden="true" />
              </button>
            </li>
          </ul>
          <p v-else class="empty-state">还没有人生事件。补几条关键年份，报告会更像真正的复盘。</p>
        </section>
      </section>
    </div>

    <div v-if="historyModalOpen" class="modal-backdrop" @click.self="historyModalOpen = false">
      <section class="history-modal" role="dialog" aria-modal="true" aria-labelledby="history-modal-title">
        <header class="modal-heading">
          <div>
            <h2 id="history-modal-title">解读记录</h2>
            <p>{{ selectedPersona?.name ?? '当前大师' }} · 共 {{ historyMessages.length }} 条消息</p>
          </div>
          <div class="modal-actions">
            <button class="secondary-button danger-soft" type="button" :disabled="!historyMessages.length || streaming" @click="clearCurrentHistory">
              <Trash2 :size="17" aria-hidden="true" />
              清空
            </button>
            <button class="secondary-button" type="button" @click="historyModalOpen = false">关闭</button>
          </div>
        </header>

        <div class="history-list" aria-label="解读记录列表">
          <article v-for="message in historyMessages" :key="message.id" class="history-item">
            <div class="history-item-head">
              <div class="history-meta">
                <span class="history-role" :class="message.role">{{ message.role === 'user' ? '用户' : '大师' }}</span>
                <time>{{ formatMessageTime(message) }}</time>
              </div>
              <div class="history-actions">
                <button class="icon-button" type="button" title="复制消息" @click="copyHistoryMessage(message)">
                  <Copy :size="16" aria-hidden="true" />
                </button>
                <button class="icon-button danger" type="button" title="删除消息" :disabled="streaming" @click="removeHistoryMessage(message)">
                  <Trash2 :size="16" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div class="history-body">
              <MarkdownRenderer :blocks="parseMarkdown(cleanVisibleReportContent(message.content))" />
            </div>
          </article>
          <p v-if="!historyMessages.length" class="empty-state history-empty">还没有解读记录。完成一次解读或追问后会出现在这里。</p>
        </div>
      </section>
    </div>

    <div v-if="birthModalOpen" class="modal-backdrop" @click.self="birthModalOpen = false">
      <section class="birth-modal" role="dialog" aria-modal="true" aria-labelledby="birth-modal-title">
        <header class="modal-heading">
          <div>
            <h2 id="birth-modal-title">生辰档案</h2>
            <p>管理多个生辰，点击左侧档案即可切换当前命盘。</p>
          </div>
          <button class="secondary-button" type="button" @click="birthModalOpen = false">关闭</button>
        </header>

        <div class="birth-modal-body">
          <aside class="birth-profile-list" aria-label="生辰档案列表">
            <div class="birth-list-heading">
              <span>档案 {{ birthProfiles.length }}</span>
              <button class="secondary-button" type="button" @click="resetBirthDraft">新建</button>
            </div>
            <article
              v-for="profile in birthProfiles"
              :key="profile.id"
              class="birth-profile-item"
              :class="{ active: profile.id === sharedProfile?.activeBirthProfileId }"
              role="button"
              tabindex="0"
              @click="activateBirthProfile(profile)"
              @keyup.enter="activateBirthProfile(profile)"
              @keyup.space.prevent="activateBirthProfile(profile)"
            >
              <div>
                <strong>{{ profile.name }}</strong>
                <span>{{ formatBirthProfileMeta(profile) }}</span>
              </div>
              <span class="birth-active-mark">
                <Check v-if="profile.id === sharedProfile?.activeBirthProfileId" :size="17" aria-hidden="true" />
              </span>
              <button class="icon-button danger" type="button" title="删除生辰" @click="removeBirthProfile(profile, $event)">
                <Trash2 :size="16" aria-hidden="true" />
              </button>
            </article>
            <p v-if="!birthProfiles.length" class="empty-state">还没有生辰档案，先在右侧保存一个。</p>
          </aside>

          <form class="birth-editor" @submit.prevent="submitBirthForm">
            <div class="panel-title">
              <CalendarDays :size="18" aria-hidden="true" />
              <h2>{{ editingBirthProfileId ? '编辑生辰' : '新建生辰' }}</h2>
            </div>
            <label>
              档案名称
              <input v-model.trim="birthProfileName" type="text" maxlength="30" placeholder="例如 自己 / 家人 / 客户A" />
            </label>
            <div class="segmented">
              <button type="button" :class="{ active: birthForm.calendarType === 'solar' }" @click="birthForm.calendarType = 'solar'">
                公历
              </button>
              <button type="button" :class="{ active: birthForm.calendarType === 'lunar' }" @click="birthForm.calendarType = 'lunar'">
                农历
              </button>
              <button type="button" :class="{ active: birthForm.calendarType === 'bazi' }" @click="birthForm.calendarType = 'bazi'">
                四柱
              </button>
            </div>
            <div v-if="birthForm.calendarType !== 'bazi'" class="form-grid">
              <label>
                年
                <input v-model.number="birthForm.year" type="number" min="1" required />
              </label>
              <label>
                月
                <input v-model.number="birthForm.month" type="number" min="1" max="12" required />
              </label>
              <label>
                日
                <input v-model.number="birthForm.day" type="number" min="1" max="31" required />
              </label>
              <label>
                时
                <input v-model.number="birthForm.hour" type="number" min="0" max="23" required />
              </label>
              <label>
                分
                <input v-model.number="birthForm.minute" type="number" min="0" max="59" required />
              </label>
              <label>
                性别
                <select v-model="birthForm.gender">
                  <option value="female">女</option>
                  <option value="male">男</option>
                </select>
              </label>
            </div>
            <div v-else class="direct-bazi-fields">
              <label>
                粘贴四柱
                <input v-model="directPillarsText" type="text" placeholder="例如 甲子 乙丑 丙寅 丁卯" @blur="applyDirectPillarsText" />
              </label>
              <div class="form-grid">
                <label>
                  年柱
                  <input v-model.trim="directPillars.year" type="text" maxlength="2" placeholder="甲子" required />
                </label>
                <label>
                  月柱
                  <input v-model.trim="directPillars.month" type="text" maxlength="2" placeholder="乙丑" required />
                </label>
                <label>
                  日柱
                  <input v-model.trim="directPillars.day" type="text" maxlength="2" placeholder="丙寅" required />
                </label>
                <label>
                  时柱
                  <input v-model.trim="directPillars.hour" type="text" maxlength="2" placeholder="丁卯" required />
                </label>
              </div>
              <p class="note-line">直接四柱模式会计算藏干、十神、五行和今日流日关系；起运与大运需出生日期时间。</p>
            </div>
            <label v-if="birthForm.calendarType === 'lunar'" class="check-row">
              <input v-model="birthForm.isLeapMonth" type="checkbox" />
              闰月
            </label>
            <section v-if="birthForm.calendarType !== 'bazi'" class="birth-location-panel" aria-label="出生地">
              <div class="birth-location-heading">
                <div>
                  <span>出生地</span>
                  <small>用于获取经纬度并校正真太阳时</small>
                </div>
                <MapPin :size="18" aria-hidden="true" />
              </div>
              <button class="location-unknown-button" type="button" :class="{ active: !selectedBirthLocation && !longitudeDraft }" @click="clearSelectedLocation">
                未选择出生地（按北京时间）
              </button>
              <label class="location-search-field">
                <Search :size="17" aria-hidden="true" />
                <input v-model.trim="locationSearch" type="search" placeholder="搜索全国城市及地区" />
              </label>
              <div v-if="locationSearchResults.length" class="location-search-results">
                <button
                  v-for="location in locationSearchResults"
                  :key="location.id"
                  type="button"
                  @click="setSelectedLocation(location); locationSearch = ''"
                >
                  <span>{{ getBirthLocationLabel(location) }}</span>
                  <small>北纬{{ location.latitude.toFixed(2) }} 东经{{ location.longitude.toFixed(2) }}</small>
                </button>
              </div>
              <div class="location-select-grid">
                <label>
                  省份
                  <select v-model="selectedProvince" @change="handleProvinceChange">
                    <option value="" disabled>请选择省份</option>
                    <option v-for="province in locationProvinces" :key="province" :value="province">{{ province }}</option>
                  </select>
                </label>
                <label>
                  城市
                  <select v-model="selectedCity" :disabled="!selectedProvince" @change="handleCityChange">
                    <option value="" disabled>请选择城市</option>
                    <option v-for="city in locationCities" :key="city" :value="city">{{ city }}</option>
                  </select>
                </label>
                <label>
                  区县
                  <select v-model="selectedLocationId" :disabled="!selectedCity" @change="handleDistrictChange">
                    <option value="" disabled>请选择区县</option>
                    <option v-for="location in locationDistricts" :key="location.id" :value="location.id">{{ location.district }}</option>
                  </select>
                </label>
              </div>
              <div class="coordinate-grid">
                <label>
                  纬度微调
                  <input v-model="latitudeDraft" type="text" inputmode="decimal" placeholder="例如 39.9042" @blur="normalizeCoordinateDraft('latitude')" />
                </label>
                <label>
                  经度微调
                  <input v-model="longitudeDraft" type="text" inputmode="decimal" placeholder="例如 116.3970" @blur="normalizeCoordinateDraft('longitude')" />
                </label>
              </div>
              <div class="birth-location-summary">
                <span>{{ selectedBirthLocation ? getBirthLocationLabel(selectedBirthLocation) : (longitudeDraft ? '手动经纬度' : '未选择出生地') }}</span>
                <small v-if="longitudeDraft && latitudeDraft">
                  北纬{{ formatCoordinate(Number(latitudeDraft)) }} 东经{{ formatCoordinate(Number(longitudeDraft)) }}
                </small>
                <small v-else-if="longitudeDraft">
                  东经{{ formatCoordinate(Number(longitudeDraft)) }}
                </small>
                <small v-else>未提供出生地经度时，将按钟表时间排盘。</small>
              </div>
              <p class="true-solar-preview">{{ trueSolarPreview }}</p>
            </section>
            <label v-if="birthForm.calendarType !== 'bazi'">
              子时规则
              <select v-model="birthForm.ziHourPolicy">
                <option value="lateZiNextDay">晚子时换日</option>
                <option value="lateZiSameDay">晚子时不换日</option>
              </select>
            </label>
            <label v-if="birthForm.calendarType !== 'bazi'">
              起运基准
              <select v-model="birthForm.luckTimeBasis">
                <option value="clock">钟表时间（对齐常见排盘）</option>
                <option value="trueSolar">真太阳时</option>
              </select>
            </label>
            <div class="actions-row">
              <button class="primary-button" type="submit">
                <Save :size="18" aria-hidden="true" />
                保存并使用
              </button>
              <button class="secondary-button" type="button" @click="resetBirthDraft">清空新建</button>
            </div>
          </form>
        </div>
      </section>
    </div>

    <div v-if="cropSession.open" class="modal-backdrop crop-backdrop" @click.self="closeCropper">
      <section class="crop-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-title">
        <header class="modal-heading">
          <div>
            <h2 id="crop-title">{{ cropTitle }}</h2>
            <p>{{ cropHint }}</p>
          </div>
          <button class="secondary-button" type="button" @click="closeCropper">取消</button>
        </header>
        <div class="crop-body">
          <div
            ref="cropFrameRef"
            class="crop-viewport"
            :style="cropFrameStyle"
            @pointerdown="startCropDrag"
            @pointermove.prevent="moveCropDrag"
            @pointerup="endCropDrag"
            @pointercancel="endCropDrag"
            @pointerleave="endCropDrag"
          >
            <img
              ref="cropImageRef"
              class="crop-source"
              :src="cropSession.sourceUrl"
              :style="cropImageStyle"
              alt="待裁剪图片"
              draggable="false"
              @load="onCropImageLoad"
            />
            <div class="crop-grid" aria-hidden="true"></div>
          </div>
          <div class="crop-controls">
            <label>
              缩放
              <input v-model.number="cropSession.zoom" type="range" min="1" max="3" step="0.01" @input="clampCropOffset" />
            </label>
            <label>
              横向
              <input
                v-model.number="cropSession.offsetX"
                type="range"
                :min="-cropMaxOffsetX"
                :max="cropMaxOffsetX"
                step="1"
                :disabled="cropMaxOffsetX === 0"
                @input="clampCropOffset"
              />
            </label>
            <label>
              纵向
              <input
                v-model.number="cropSession.offsetY"
                type="range"
                :min="-cropMaxOffsetY"
                :max="cropMaxOffsetY"
                step="1"
                :disabled="cropMaxOffsetY === 0"
                @input="clampCropOffset"
              />
            </label>
          </div>
        </div>
        <footer class="crop-actions">
          <button class="secondary-button" type="button" @click="closeCropper">重新选择</button>
          <button class="primary-button" type="button" @click="confirmCrop">
            <Check :size="18" aria-hidden="true" />
            确认裁剪
          </button>
        </footer>
      </section>
    </div>

    <div v-if="purchaseDialog.open" class="modal-backdrop" role="presentation" @click.self="closePurchaseDialog">
      <section class="purchase-modal" role="dialog" aria-modal="true" aria-label="权益确认">
        <header class="modal-heading">
          <div>
            <span class="eyebrow">权益确认</span>
            <h2>{{ purchaseDialogTitle() }}</h2>
          </div>
          <button class="icon-button" type="button" aria-label="关闭" @click="closePurchaseDialog">
            <X :size="18" aria-hidden="true" />
          </button>
        </header>
        <div class="purchase-price-row">
          <strong>{{ purchaseDialogPrice() }}</strong>
          <span>{{ purchaseDialog.task === 'follow_up' ? '免费次数已用完' : purchaseDialog.task === 'membership' ? getMembershipPlan(purchaseDialog.plan).period : '一次性服务' }}</span>
        </div>
        <p>{{ purchaseDialogDescription() }}</p>
        <ul class="purchase-benefits">
          <li v-for="feature in purchaseDialog.task === 'membership' || purchaseDialog.task === 'follow_up' ? getMembershipPlan(purchaseDialog.plan).features : []" :key="feature">{{ feature }}</li>
          <li v-if="purchaseDialog.task === 'structured_report'">生成可导出的完整专业报告</li>
          <li v-if="purchaseDialog.task === 'multi_school'">获得四派会诊与最终取舍建议</li>
          <li v-if="purchaseDialog.task === 'daily'">解锁今日运势，本命盘当天有效</li>
        </ul>
        <footer class="purchase-actions">
          <button class="secondary-button" type="button" @click="closePurchaseDialog">稍后再说</button>
          <button class="primary-button" type="button" @click="confirmPurchaseDialog">
            <Check :size="18" aria-hidden="true" />
            模拟解锁
          </button>
        </footer>
      </section>
    </div>

    <div v-if="membershipModalOpen" class="modal-backdrop" role="presentation" @click.self="membershipModalOpen = false">
      <section class="membership-modal" role="dialog" aria-modal="true" aria-label="大师会员">
        <header class="modal-heading membership-modal-heading">
          <div>
            <span class="eyebrow">大师会员</span>
            <h2>选择适合你的命理解读权益</h2>
            <p>会员用于连续追问、每日运势和后续高级报告权益承接，先用清晰档位帮助用户理解价值。</p>
          </div>
          <button class="icon-button" type="button" aria-label="关闭" @click="membershipModalOpen = false">
            <X :size="18" aria-hidden="true" />
          </button>
        </header>

        <div class="membership-modal-body">
          <div class="membership-plan-grid membership-modal-plans">
            <button
              v-for="plan in membershipPlans"
              :key="plan.id"
              class="membership-plan-card membership-modal-plan"
              :class="{ recommended: plan.id === 'yearly', active: activeMembershipPlan?.id === plan.id }"
              type="button"
              @click="startMembershipPurchase(plan.id)"
            >
              <small>{{ plan.badge }}</small>
              <span>{{ plan.title }}</span>
              <strong>{{ plan.price }}</strong>
              <em>{{ plan.period }}</em>
              <p>{{ plan.description }}</p>
              <b>{{ activeMembershipPlan?.id === plan.id ? '当前权益' : '选择此档' }}</b>
            </button>
          </div>

          <section class="membership-compare" aria-label="会员权益横向对比">
            <div class="membership-compare-row membership-compare-head">
              <span>权益</span>
              <strong>月卡</strong>
              <strong>年卡</strong>
              <strong>Pro</strong>
            </div>
            <div v-for="row in membershipComparisonRows" :key="row.label" class="membership-compare-row">
              <span>{{ row.label }}</span>
              <strong>{{ row.monthly }}</strong>
              <strong>{{ row.yearly }}</strong>
              <strong>{{ row.pro }}</strong>
            </div>
          </section>
        </div>
      </section>
    </div>

    <section v-if="activePanel === 'reading' && mobileTab === 'home'" class="mobile-screen mobile-home-view" aria-label="移动端首页">
      <section class="mobile-hero-card">
        <div>
          <span class="mobile-hero-dot" aria-hidden="true"></span>
          <h1>{{ mobileGreeting }}</h1>
          <p>{{ mobileDailyMeta }}</p>
        </div>
      </section>

      <section class="mobile-card mobile-current-card">
        <div class="mobile-card-head">
          <div>
            <span class="mobile-eyebrow">{{ t('home.currentChart') }}</span>
            <h2>{{ birthTriggerLabel }}</h2>
          </div>
          <button class="ghost-button mobile-link-button" type="button" @click="showMobileTab('chart')">
            {{ t('home.viewFullChart') }}
          </button>
        </div>
        <div v-if="selectedPersona" class="mobile-master-card">
          <img :src="selectedPersona.avatarUrl" :alt="selectedPersona.name" />
          <div>
            <strong>{{ selectedPersona.name }}</strong>
            <span>{{ engineNameById(selectedPersona.engineId) }}</span>
            <p>{{ selectedPersona.opening }}</p>
          </div>
        </div>
        <div v-if="chart" class="mobile-pillar-strip">
          <span v-for="pillar in pillarRows" :key="pillar.name">
            <small>{{ pillar.label }}</small>
            <strong class="mobile-ganzhi">
              <b :style="elementVisualStyle(pillar.ganElement)">{{ pillar.gan }}</b>
              <b :style="elementVisualStyle(pillar.zhiElement)">{{ pillar.zhi }}</b>
            </strong>
            <em>
              <i :style="elementVisualStyle(pillar.ganElement)"></i>{{ pillar.ganElement }}
              <i :style="elementVisualStyle(pillar.zhiElement)"></i>{{ pillar.zhiElement }}
            </em>
          </span>
        </div>
        <div v-else class="mobile-empty-card">
          <p>{{ t('home.noBirthProfile') }}</p>
          <button class="secondary-button" type="button" @click="openBirthModal">{{ t('home.openBirthProfile') }}</button>
        </div>
        <div v-if="chart" class="mobile-highlight-row">
          <span v-for="item in mobileChartHighlights" :key="item.label">
            <small>{{ item.label }}</small>
            <strong>{{ item.value }}</strong>
          </span>
        </div>
      </section>

      <section class="mobile-card mobile-action-card">
        <div class="mobile-card-head">
          <div>
            <span class="mobile-eyebrow">{{ t('home.todayReading') }}</span>
            <h2>{{ t('home.askMaster', { master: selectedPersona?.name ?? t('home.masterFallback') }) }}</h2>
          </div>
          <button class="ghost-button mobile-link-button" type="button" @click="showMobileTab('reading')">
            {{ t('home.history') }}
          </button>
        </div>
        <div class="mobile-quick-grid">
          <button class="secondary-button commercial-action-button" type="button" :disabled="!chart || streaming" @click="requestMobileReading('bazi_full')">
            <Wand2 :size="17" aria-hidden="true" />
            <span>{{ t('home.fullReading') }}</span>
            <small>{{ productAccessLabel('bazi_full') }}</small>
          </button>
          <button class="secondary-button commercial-action-button" type="button" :disabled="!chart || streaming" @click="requestMobileReading('structured_report')">
            <FileText :size="17" aria-hidden="true" />
            <span>{{ t('home.professionalReport') }}</span>
            <small>{{ productAccessLabel('structured_report') }}</small>
          </button>
          <button class="secondary-button commercial-action-button" type="button" :disabled="!chart || streaming" @click="requestMobileReading('multi_school')">
            <Users :size="17" aria-hidden="true" />
            <span>{{ t('home.multiSchool') }}</span>
            <small>{{ productAccessLabel('multi_school') }}</small>
          </button>
          <button class="secondary-button commercial-action-button" type="button" :disabled="!chart || streaming" @click="requestMobileReading('daily')">
            <CalendarDays :size="17" aria-hidden="true" />
            <span>{{ t('home.dailyFortune') }}</span>
            <small>{{ productAccessLabel('daily') }}</small>
          </button>
          <button class="secondary-button commercial-action-button" type="button" :disabled="!chart || streaming || drawingLot || dailyLotUsedToday" @click="requestMobileDailyLot">
            <Sparkles :size="17" aria-hidden="true" />
            <span>{{ t('home.dailyLot') }}</span>
            <small>{{ productAccessLabel('daily_lot') }}</small>
          </button>
        </div>
        <div class="mobile-follow-card">
          <textarea
            v-model="followQuestion"
            class="follow-question-input"
            rows="1"
            :placeholder="t('home.askPlaceholder')"
            @input="resizeFollowQuestionInput"
            @focus="resizeFollowQuestionInput"
            @keydown="handleFollowQuestionKeydown($event, true)"
          ></textarea>
          <button
            class="composer-send"
            type="button"
            :title="t('home.sendFollowUp')"
            :aria-label="t('home.sendFollowUp')"
            :disabled="streaming || !followQuestion.trim()"
            @click="requestMobileReading('follow_up', followQuestion)"
          >
            <Send :size="18" aria-hidden="true" />
          </button>
        </div>
        <p class="commercial-hint">{{ productAccessLabel('follow_up') }} · 超出后开通{{ membershipProduct.title }}</p>
        <p class="note-line">{{ t('home.readingHint') }}</p>
      </section>

    </section>

    <section v-if="activePanel === 'reading' && mobileTab === 'mine'" class="mobile-screen mobile-mine-view" aria-label="移动端我的">
      <section class="mobile-card mobile-mine-card">
        <div class="mobile-menu-list">
          <button class="mobile-menu-item" type="button" @click="masterModalOpen = true">
            <UserRound :size="18" aria-hidden="true" />
            <span>{{ t('mine.chooseMaster') }}</span>
            <small>{{ selectedPersona?.name ?? t('mine.notSelected') }}</small>
          </button>
          <button class="mobile-menu-item" type="button" @click="openBirthModal">
            <CalendarDays :size="18" aria-hidden="true" />
            <span>{{ t('nav.birthProfile') }}</span>
            <small>{{ birthTriggerLabel }}</small>
          </button>
          <button class="mobile-menu-item" type="button" @click="profileModalOpen = true">
            <Save :size="18" aria-hidden="true" />
            <span>{{ t('nav.profile') }}</span>
            <small>{{ t('common.items', { count: savedFacts.length + savedLifeEvents.length }) }}</small>
          </button>
          <button class="mobile-menu-item" type="button" @click="openHistoryModal">
            <MessageCircle :size="18" aria-hidden="true" />
            <span>{{ t('nav.history') }}</span>
            <small>{{ t('common.items', { count: historyMessages.length }) }}</small>
          </button>
          <button class="mobile-menu-item" type="button" @click="membershipModalOpen = true">
            <Lock :size="18" aria-hidden="true" />
            <span>大师会员</span>
            <small>{{ isMember ? `已开通 ${activeMembershipPlan?.title ?? '会员'}` : '月卡 / 年卡 / Pro' }}</small>
          </button>
          <button class="mobile-menu-item" type="button" @click="openSettings">
            <KeyRound :size="18" aria-hidden="true" />
            <span>{{ t('nav.credentials') }}</span>
            <small>{{ hasCredentials ? t('mine.configured') : t('mine.notConfigured') }}</small>
          </button>
          <button class="mobile-menu-item" type="button" @click="activePanel = 'admin'">
            <ShieldCheck :size="18" aria-hidden="true" />
            <span>{{ t('nav.admin') }}</span>
            <small>{{ t('mine.roles') }}</small>
          </button>
        </div>
      </section>
    </section>

    <section v-if="activePanel === 'reading'" class="workspace" :class="`mobile-tab-${mobileTab}`">
      <section class="reading-stage" aria-live="polite">
        <section class="panel chart-panel">
          <div class="panel-title">
            <Wand2 :size="18" aria-hidden="true" />
            <h2>{{ t('nav.chart') }}</h2>
          </div>
          <div v-if="selectedPersona" class="chart-master-strip">
            <img class="chart-master-avatar" :src="selectedPersona.avatarUrl" :alt="selectedPersona.name" />
            <div class="chart-master-copy">
              <div class="chart-master-meta">
                <strong>{{ selectedPersona.name }}</strong>
                <span>{{ engineNameById(selectedPersona.engineId) }}</span>
              </div>
              <p :title="selectedPersona.opening">{{ selectedPersona.opening }}</p>
            </div>
          </div>
          <div v-if="chart" class="chart-content">
            <div class="pillar-grid" role="table" aria-label="四柱排盘">
              <div class="pillar-table-row pillar-table-head" role="row">
                <span class="pillar-row-label">日期</span>
                <strong v-for="pillar in pillarRows" :key="`${pillar.name}-head`">{{ pillar.label }}</strong>
              </div>
              <div class="pillar-table-row" role="row">
                <span class="pillar-row-label">主星</span>
                <span v-for="pillar in pillarRows" :key="`${pillar.name}-god`" class="pillar-ten-god">{{ pillar.tenGodOfGan }}</span>
              </div>
              <div class="pillar-table-row pillar-main-row" role="row">
                <span class="pillar-row-label">天干</span>
                <strong v-for="pillar in pillarRows" :key="`${pillar.name}-gan`" class="pillar-main-char" :style="elementVisualStyle(pillar.ganElement)">
                  <span class="pillar-char-tile">
                    <b>{{ pillar.gan }}</b>
                    <em>{{ pillar.ganElement }}</em>
                  </span>
                </strong>
              </div>
              <div class="pillar-table-row pillar-main-row" role="row">
                <span class="pillar-row-label">地支</span>
                <strong v-for="pillar in pillarRows" :key="`${pillar.name}-zhi`" class="pillar-main-char" :style="elementVisualStyle(pillar.zhiElement)">
                  <span class="pillar-char-tile">
                    <b>{{ pillar.zhi }}</b>
                    <em>{{ pillar.zhiElement }}</em>
                  </span>
                </strong>
              </div>
              <div class="pillar-table-row pillar-hidden-row" role="row">
                <span class="pillar-row-label">藏干</span>
                <span v-for="pillar in pillarRows" :key="`${pillar.name}-hidden`" class="hidden-stem-chips">
                  <b v-for="item in hiddenStemItems(pillar)" :key="`${pillar.name}-${item.stem}`" :style="elementVisualStyle(item.element)">
                    {{ item.stem }}<em v-if="item.tenGod">{{ item.tenGod }}</em>
                  </b>
                </span>
              </div>
            </div>
            <div class="pillar-info-table" role="table" aria-label="四柱辅助信息">
              <div class="pillar-info-row" role="row">
                <span class="pillar-row-label">纳音</span>
                <span v-for="pillar in pillarRows" :key="`${pillar.name}-nayin`" class="pillar-info-cell">
                  {{ pillar.naYin }}
                </span>
              </div>
              <div class="pillar-info-row" role="row">
                <span class="pillar-row-label">空亡</span>
                <span v-for="pillar in pillarRows" :key="`${pillar.name}-xunkong`" class="pillar-info-cell">
                  {{ pillar.xunKong || '—' }}
                </span>
              </div>
              <div class="pillar-info-row pillar-shensha-row" role="row">
                <span class="pillar-row-label">神煞</span>
                <span v-for="pillar in pillarRows" :key="`${pillar.name}-shensha`" class="pillar-info-cell">
                  <b v-for="item in pillar.shenSha ?? []" :key="`${pillar.name}-${item}`">{{ item }}</b>
                  <em v-if="!pillar.shenSha?.length">—</em>
                </span>
              </div>
            </div>
            <div class="stats-grid">
              <span v-for="item in strengthRows" :key="`stat-${item.element}`" :style="elementVisualStyle(item.element)">
                <i></i>
                {{ item.element }} {{ chart.fiveElementStats[item.element] }}
              </span>
            </div>
            <p class="note-line">日主 {{ chart.dayMaster.gan }}{{ chart.dayMaster.element }} · {{ formatLuckSummary(chart.luck) }}</p>
            <section class="chart-section">
              <div class="chart-section-title">
                <span>命盘要素</span>
              </div>
              <div class="chart-mini-grid">
                <span v-for="item in chartFactorRows" :key="item.label" class="chart-mini-item">
                  <small>{{ item.label }}</small>
                  <strong>{{ item.value }}</strong>
                </span>
              </div>
              <div class="term-line">
                <span>所在节气 {{ chart.birthSolarTerm?.current?.name ?? chart.birthSolarTerm?.note ?? '需出生时间' }}</span>
                <span v-if="chart.birthSolarTerm?.current?.dateTime">{{ chart.birthSolarTerm.current.dateTime }}</span>
                <span v-if="chart.birthSolarTerm?.next">下一节气 {{ chart.birthSolarTerm.next.name }} {{ chart.birthSolarTerm.next.dateTime }}</span>
              </div>
            </section>
            <section v-if="chart.strength" class="chart-section">
              <div class="chart-section-title">
                <span>五行旺衰</span>
                <strong>{{ chart.strength.dayMasterStrength.conclusion }}</strong>
              </div>
              <p class="note-line">
                司令 {{ chart.strength.monthCommand.stem }}{{ chart.strength.monthCommand.level }} · 日主{{ chart.strength.dayMasterState }} · {{ chart.strength.dayMasterStrength.score }}分
              </p>
              <div class="strength-card">
                <div class="strength-list">
                  <div v-for="item in strengthRows" :key="item.element" class="strength-row" :style="strengthVisualStyle(item.element, item.percent)">
                    <span class="strength-name">
                      <i></i>
                      {{ item.element }}
                    </span>
                    <div class="strength-bar" aria-hidden="true">
                      <i></i>
                      <b>{{ item.percent }}%</b>
                    </div>
                    <small>{{ item.state }} · {{ formatEnergyValue(item.energy) }}</small>
                  </div>
                </div>
                <div class="season-state-strip" aria-label="五行旺衰状态">
                  <span v-for="item in strengthRows" :key="`state-${item.element}`" :style="elementVisualStyle(item.element)">
                    <i></i>
                    {{ item.element }} <strong>{{ item.state }}</strong>
                  </span>
                </div>
              </div>
            </section>
            <section class="chart-section">
              <div class="chart-section-title">
                <span>命局关系</span>
                <strong>{{ chartRelationRows.length }}</strong>
              </div>
              <div v-if="chartRelationRows.length" class="relation-list">
                <span v-for="item in chartRelationRows" :key="item.key">
                  <strong>{{ item.type }}</strong>
                  <small>{{ item.pillars }}</small>
                  {{ item.description }}
                </span>
              </div>
              <p v-else class="note-line">未见明显干支关系。</p>
            </section>
            <section class="chart-section">
              <div class="chart-section-title">
                <span>大运流年</span>
                <strong>{{ chart.luck.cycles.length }}</strong>
              </div>
              <p v-if="!chart.luck.cycles.length" class="note-line">{{ chart.luck.unavailableReason ?? chart.luck.startAgeText }}</p>
              <div v-else class="luck-list">
                <details v-for="cycle in chart.luck.cycles" :key="cycle.index" class="luck-cycle" :open="cycle.index === currentLuckIndex">
                  <summary>
                    <span>{{ cycle.ganZhi }}</span>
                    <small>{{ formatLuckCycleRange(cycle) }}<template v-if="cycle.startSolarDateTime"> · 交运 {{ cycle.startSolarDateTime }}</template></small>
                  </summary>
                  <div class="liu-nian-grid">
                    <span v-for="liuNian in cycle.liuNian ?? []" :key="`${cycle.index}-${liuNian.year}`">
                      {{ liuNian.year }} {{ liuNian.ganZhi }}
                      <small>{{ liuNian.age }}岁</small>
                    </span>
                  </div>
                </details>
              </div>
              <div v-if="chart.luck.minorLuck?.length" class="minor-luck-line">
                <span>小运</span>
                <small>{{ chart.luck.minorLuck.map((item) => `${item.year}${item.ganZhi}`).join('、') }}</small>
              </div>
            </section>
            <p v-for="note in chart.notes" :key="note" class="note-line">{{ note }}</p>
            <div class="actions-row chart-service-actions">
              <button class="primary-button commercial-action-button chart-overview-action" type="button" :disabled="streaming" @click="requestChartOverview">
                <Wand2 :size="18" aria-hidden="true" />
                <span>{{ t('home.fullReading') }}</span>
                <small>{{ productAccessLabel('bazi_full') }}</small>
              </button>
              <button class="primary-button commercial-action-button" type="button" :disabled="streaming" @click="requestReading('structured_report')">
                <FileText :size="18" aria-hidden="true" />
                <span>{{ t('home.professionalReport') }}</span>
                <small>{{ productAccessLabel('structured_report') }}</small>
              </button>
              <button class="secondary-button commercial-action-button" type="button" :disabled="streaming" @click="requestReading('multi_school')">
                <Users :size="18" aria-hidden="true" />
                <span>{{ t('home.multiSchool') }}</span>
                <small>{{ productAccessLabel('multi_school') }}</small>
              </button>
              <button class="secondary-button commercial-action-button" type="button" :disabled="streaming" @click="requestReading('daily')">
                <CalendarDays :size="18" aria-hidden="true" />
                <span>{{ t('home.dailyFortune') }}</span>
                <small>{{ productAccessLabel('daily') }}</small>
              </button>
              <button
                class="secondary-button lot-button commercial-action-button"
                type="button"
                :class="{ drawing: drawingLot }"
                :disabled="streaming || drawingLot || dailyLotUsedToday"
                @click="requestDailyLot"
              >
                <Sparkles :size="18" aria-hidden="true" />
                <span>{{ t('home.dailyLot') }}</span>
                <small>{{ productAccessLabel('daily_lot') }}</small>
              </button>
            </div>
          </div>
          <div v-else class="empty-state chart-empty">
            <p>{{ t('home.noBirthProfile') }}</p>
            <button class="secondary-button" type="button" @click="openBirthModal">{{ t('home.openBirthProfile') }}</button>
          </div>
        </section>

        <section class="panel conversation-panel">
          <div class="reading-chat-header">
            <div class="reading-guide-card">
              <img v-if="selectedPersona" :src="selectedPersona.avatarUrl" :alt="selectedPersona.name" />
              <div v-else class="reading-guide-fallback" aria-hidden="true">
                <MessageCircle :size="20" />
              </div>
              <div>
                <span>{{ t('nav.reading') }}</span>
                <strong>{{ selectedPersona?.name ?? t('home.masterFallback') }}</strong>
                <small>{{ selectedPersona ? engineNameById(selectedPersona.engineId) : '' }} · {{ birthTriggerLabel }}</small>
              </div>
            </div>
            <div v-if="latestExportableReport" class="report-export-actions" aria-label="报告导出">
              <button class="ghost-button export-button" type="button" :disabled="streaming" @click="exportReportPdf">
                <FileText :size="16" aria-hidden="true" />
                PDF
              </button>
              <button class="ghost-button export-button" type="button" :disabled="streaming" @click="exportReportImage">
                <Download :size="16" aria-hidden="true" />
                图片
              </button>
            </div>
            <span v-else class="report-export-hint">专业报告/流派会诊可导出</span>
          </div>
          <div class="mobile-reading-prompts reading-prompt-strip" aria-label="快捷解读问题">
            <button class="secondary-button commercial-action-button" type="button" :disabled="!chart || streaming" @click="requestReading('bazi_full')">
              <Wand2 :size="16" aria-hidden="true" />
              <span>{{ t('home.fullReading') }}</span>
              <small>{{ productAccessLabel('bazi_full') }}</small>
            </button>
            <button class="secondary-button commercial-action-button" type="button" :disabled="!chart || streaming" @click="requestReading('structured_report')">
              <FileText :size="16" aria-hidden="true" />
              <span>{{ t('home.professionalReport') }}</span>
              <small>{{ productAccessLabel('structured_report') }}</small>
            </button>
            <button class="secondary-button commercial-action-button" type="button" :disabled="!chart || streaming" @click="requestReading('multi_school')">
              <Users :size="16" aria-hidden="true" />
              <span>{{ t('home.multiSchool') }}</span>
              <small>{{ productAccessLabel('multi_school') }}</small>
            </button>
            <button class="secondary-button commercial-action-button" type="button" :disabled="!chart || streaming" @click="requestReading('daily')">
              <CalendarDays :size="16" aria-hidden="true" />
              <span>{{ t('home.dailyFortune') }}</span>
              <small>{{ productAccessLabel('daily') }}</small>
            </button>
            <button class="secondary-button commercial-action-button" type="button" :disabled="!chart || streaming || drawingLot || dailyLotUsedToday" @click="requestDailyLot">
              <Sparkles :size="16" aria-hidden="true" />
              <span>{{ t('home.dailyLot') }}</span>
              <small>{{ productAccessLabel('daily_lot') }}</small>
            </button>
          </div>
          <div ref="answerBoxRef" class="answer-box chat-timeline">
            <template v-if="historyMessages.length || readingText">
              <article v-for="message in historyMessages.slice(-10)" :key="message.id" :class="['chat-message', `chat-${message.role}`]">
                <div class="chat-speaker">{{ message.role === 'user' ? '我' : selectedPersona?.name ?? t('home.masterFallback') }}</div>
                <div class="chat-bubble">
                  <MarkdownRenderer :blocks="parseMarkdown(cleanVisibleReportContent(message.content))" />
                </div>
              </article>
              <article v-if="readingText" class="chat-message chat-assistant chat-streaming">
                <div class="chat-speaker">{{ selectedPersona?.name ?? t('home.masterFallback') }}</div>
                <div class="chat-bubble">
                  <MarkdownRenderer :blocks="activeReadingBlocks" />
                  <span v-if="streaming" class="caret markdown-caret"></span>
                </div>
              </article>
            </template>
            <div v-else class="reading-empty-state">
              <MessageCircle :size="22" aria-hidden="true" />
              <strong>选择一个方向开始解读</strong>
              <p>可以先生成专业报告，也可以直接追问你关心的事业、感情或流年。</p>
            </div>
            <div v-if="streaming && !readingText" class="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
              {{ selectedPersona?.name ?? t('home.masterFallback') }}正在推演
            </div>
          </div>
          <div class="chat-composer-shell">
            <div class="follow-row" role="group" aria-label="追问输入">
              <textarea
                v-model="followQuestion"
                class="follow-question-input"
                rows="1"
                placeholder="向大师追问"
                @input="resizeFollowQuestionInput"
                @focus="resizeFollowQuestionInput"
                @keydown="handleFollowQuestionKeydown"
              ></textarea>
              <button
                class="composer-send"
                type="button"
                :title="t('home.sendFollowUp')"
                :aria-label="t('home.sendFollowUp')"
                :disabled="streaming || !followQuestion.trim()"
                @click="requestReading('follow_up', followQuestion)"
              >
                <Send :size="18" aria-hidden="true" />
              </button>
            </div>
            <p class="commercial-hint">{{ productAccessLabel('follow_up') }} · 会员解锁连续追问</p>
          </div>
        </section>
      </section>
    </section>

    <section v-else-if="activePanel === 'settings'" class="single-panel">
      <div class="panel settings-panel">
        <div class="panel-title">
          <KeyRound :size="18" aria-hidden="true" />
          <h2>凭据</h2>
        </div>
        <label>
          base_url
          <input v-model="credentialsDraft.baseUrl" type="url" placeholder="https://api.example.com/v1" @input="resetModelSelection" />
        </label>
        <label>
          key
          <input v-model="credentialsDraft.apiKey" type="password" autocomplete="off" @input="resetModelSelection" />
        </label>
        <div class="model-picker">
          <div class="model-picker-head">
            <span>模型</span>
            <button class="ghost-button" type="button" :disabled="loadingModels || !credentialsDraft.baseUrl.trim() || !credentialsDraft.apiKey.trim()" @click="refreshModelOptions()">
              <RefreshCw :size="16" aria-hidden="true" />
              {{ loadingModels ? '解析中' : '解析模型' }}
            </button>
          </div>
          <select v-model="credentialsDraft.model" :disabled="loadingModels || !modelSelectOptions.length">
            <option value="" disabled>{{ modelSelectOptions.length ? '请选择模型' : '填写 base_url 和 key 后解析模型' }}</option>
            <option v-for="model in modelSelectOptions" :key="model" :value="model">{{ model }}</option>
          </select>
          <small v-if="modelOptions.length" class="model-picker-note">
            {{ modelSource === 'upstream' ? '已从服务商接口解析模型列表' : '已根据官方服务商提供推荐模型' }}
          </small>
        </div>
        <p class="privacy-line">不存不记凭据：key 仅保存在本机浏览器，请求时随包透传，服务端不持久化、不记录请求正文。</p>
        <div class="actions-row">
          <button class="primary-button" type="button" @click="persistCredentials">
            <Save :size="18" aria-hidden="true" />
            保存
          </button>
          <button class="secondary-button" type="button" :disabled="testingCredentials" @click="runCredentialTest">
            <RefreshCw :size="18" aria-hidden="true" />
            测试
          </button>
          <button class="ghost-button" type="button" @click="removeCredentials">
            <Trash2 :size="18" aria-hidden="true" />
            清除
          </button>
        </div>
        <p v-if="credentialsStatus" class="note-line">{{ credentialsStatus }}</p>
      </div>
    </section>

    <section v-else class="single-panel admin-layout">
      <div v-if="!adminAuthed" class="panel admin-login">
        <div class="panel-title">
          <Lock :size="18" aria-hidden="true" />
          <h2>后台</h2>
        </div>
        <label>
          用户名
          <input v-model="adminSession.username" type="text" autocomplete="username" />
        </label>
        <label>
          密码
          <input v-model="adminSession.password" type="password" autocomplete="current-password" @keyup.enter="loginAdmin" />
        </label>
        <label class="check-row admin-remember">
          <input v-model="adminRemember" type="checkbox" @change="saveRememberedAdminSession" />
          记住后台账号和密码
        </label>
        <button class="primary-button" type="button" @click="loginAdmin">
          <Lock :size="18" aria-hidden="true" />
          登录
        </button>
        <p v-if="adminMessage" class="note-line">{{ adminMessage }}</p>
      </div>

      <div v-else class="admin-grid">
        <form class="panel admin-form" @submit.prevent="savePersona">
          <div class="panel-title">
            <UserRound :size="18" aria-hidden="true" />
            <h2>{{ adminEditingBuiltin ? '编辑内置资源' : adminEditing ? '编辑角色' : '创建角色' }}</h2>
          </div>
          <p v-if="adminEditingBuiltin" class="note-line">内置角色只能调整头像和网页背景，名字、体系与话术保持系统默认。</p>
          <div v-else class="ai-generator" :class="{ 'generated-highlight': adminGeneratedHighlight }">
            <div class="generator-heading">
              <Sparkles :size="18" aria-hidden="true" />
              <strong>AI 一键生成大师与体系</strong>
            </div>
            <div class="generator-row">
              <textarea
                v-model="adminGenerator.direction"
                maxlength="240"
                rows="2"
                placeholder="例如：精通紫微和心理咨询的温柔姐姐，擅长关系与职业选择"
                :disabled="adminGenerator.generating"
              ></textarea>
              <button
                class="secondary-button"
                type="button"
                :disabled="adminGenerator.generating || !adminGenerator.direction.trim()"
                @click="generatePersonaDraft"
              >
                <RefreshCw v-if="adminGenerator.generating" :size="18" aria-hidden="true" />
                <Sparkles v-else :size="18" aria-hidden="true" />
                {{ adminGenerator.generating ? '生成中' : '生成' }}
              </button>
            </div>
            <p v-if="!hasCredentials" class="note-line">需要先在凭据设置里配置 base_url、key 和模型。</p>
          </div>
          <label :class="{ 'generated-highlight': adminGeneratedHighlight }">
            名字
            <input v-model="adminForm.name" type="text" maxlength="40" :disabled="adminEditingBuiltin" required />
          </label>
          <label :class="{ 'generated-highlight': adminGeneratedHighlight }">
            体系
            <select v-model="adminForm.engineId" :disabled="adminEditingBuiltin" @change="onAdminEngineChange">
              <option v-for="engine in engines" :key="engine.id" :value="engine.id">{{ engine.name }}</option>
            </select>
          </label>
          <div v-if="adminEngineDraftActive" class="engine-draft" :class="{ 'generated-highlight': adminGeneratedHighlight }">
            <label>
              自定义体系名称
              <input v-model="adminEngineForm.name" type="text" maxlength="30" required />
            </label>
            <label>
              体系世界观
              <textarea v-model="adminEngineForm.worldview" maxlength="500" rows="3" required></textarea>
            </label>
            <label>
              体系提示规则
              <textarea v-model="adminEngineForm.promptRulesText" maxlength="1400" rows="4" placeholder="每行一条规则" required></textarea>
            </label>
          </div>
          <label :class="{ 'generated-highlight': adminGeneratedHighlight }">
            开场白
            <textarea v-model="adminForm.opening" maxlength="300" rows="4" :disabled="adminEditingBuiltin" required></textarea>
          </label>
          <label :class="{ 'generated-highlight': adminGeneratedHighlight }">
            角色自定义提示词
            <textarea
              v-model="adminForm.customPrompt"
              maxlength="1200"
              rows="5"
              :disabled="adminEditingBuiltin"
              placeholder="写给 AI 的角色执行规则，例如口吻、人设边界、解读侧重点、不能说的话。"
            ></textarea>
          </label>
          <label>
            直言程度
            <input v-model.number="adminForm.tone.directness" type="range" min="0" max="100" :disabled="adminEditingBuiltin" />
          </label>
          <label>
            详尽程度
            <input v-model.number="adminForm.tone.detail" type="range" min="0" max="100" :disabled="adminEditingBuiltin" />
          </label>
          <label class="range-field">
            <span>网页背景强度</span>
            <input v-model.number="adminForm.backgroundIntensity" type="range" min="0" max="100" />
            <small>{{ clampPercent(adminForm.backgroundIntensity, 100) }}%</small>
          </label>
          <div class="category-row">
            <label class="check-row"><input v-model="adminForm.categories" type="checkbox" value="bazi" :disabled="adminEditingBuiltin" />八字</label>
            <label class="check-row"><input v-model="adminForm.categories" type="checkbox" value="daily" :disabled="adminEditingBuiltin" />每日</label>
          </div>
          <label class="upload-field">
            头像
            <div class="upload-preview-row">
              <img class="upload-preview avatar" :src="avatarPreview" alt="头像预览" />
              <input type="file" accept="image/*" @change="setUpload($event, 'avatarFile')" />
            </div>
          </label>
          <label class="upload-field">
            电脑端网页背景
            <div class="upload-preview-row">
              <img class="upload-preview background" :src="backgroundPreview" alt="电脑端网页背景预览" />
              <input type="file" accept="image/*" @change="setUpload($event, 'backgroundFile')" />
            </div>
          </label>
          <label class="upload-field">
            手机端网页背景
            <div class="upload-preview-row">
              <img class="upload-preview mobile-background" :src="mobileBackgroundPreview" alt="手机端网页背景预览" />
              <input type="file" accept="image/*" @change="setUpload($event, 'mobileBackgroundFile')" />
            </div>
          </label>
          <div class="actions-row">
            <button class="primary-button" type="submit">
              <Save :size="18" aria-hidden="true" />
              保存
            </button>
            <button class="secondary-button" type="button" @click="resetAdminForm">重置</button>
          </div>
          <p v-if="adminMessage" class="note-line">{{ adminMessage }}</p>
        </form>

        <section class="panel admin-list">
          <div class="panel-title">
            <ShieldCheck :size="18" aria-hidden="true" />
            <h2>角色列表</h2>
          </div>
          <article v-for="persona in adminPersonas" :key="persona.id" class="admin-role">
            <img :src="persona.avatarUrl" :alt="persona.name" />
            <div>
              <strong>{{ persona.name }}</strong>
              <span>{{ engineNameById(persona.engineId) }} · {{ persona.builtin ? '内置' : '自定义' }}</span>
            </div>
            <button class="icon-button" type="button" :title="persona.builtin ? '编辑头像和背景' : '编辑'" @click="editPersona(persona)">
              <Upload :size="18" aria-hidden="true" />
            </button>
            <button class="icon-button danger" type="button" :title="persona.builtin ? '内置角色不可删除' : '删除'" :disabled="persona.builtin" @click="removePersona(persona)">
              <Trash2 :size="18" aria-hidden="true" />
            </button>
          </article>
        </section>
      </div>
    </section>

    <nav class="mobile-bottom-tabs" :aria-label="t('nav.mobile')">
      <button type="button" :class="{ active: mobileActiveTab === 'home' }" @click="showMobileTab('home')">
        <House :size="20" aria-hidden="true" />
        <span>{{ t('nav.home') }}</span>
      </button>
      <button type="button" :class="{ active: mobileActiveTab === 'chart' }" @click="showMobileTab('chart')">
        <LayoutDashboard :size="20" aria-hidden="true" />
        <span>{{ t('nav.chart') }}</span>
      </button>
      <button type="button" :class="{ active: mobileActiveTab === 'reading' }" @click="showMobileTab('reading')">
        <ScrollText :size="20" aria-hidden="true" />
        <span>{{ t('nav.reading') }}</span>
      </button>
      <button type="button" :class="{ active: mobileActiveTab === 'mine' }" @click="showMobileTab('mine')">
        <UserRound :size="20" aria-hidden="true" />
        <span>{{ t('nav.mine') }}</span>
      </button>
    </nav>

    <div v-if="loading" class="loading-mask">{{ t('common.loading') }}</div>
  </main>
</template>
