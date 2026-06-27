import type { BaziChart } from '@/bazi/types';
import {
  ENGINE_DEFINITIONS,
  type FortuneCategory,
  type PersonaEngine,
  type PersonaSkin,
  type ToneSettings
} from '@server-shared/persona';
import type { ChatMessage, SharedProfile } from '@/storage/types';

export type FortuneTask = 'bazi_full' | 'structured_report' | 'multi_school' | 'daily' | 'daily_lot' | 'follow_up';

export interface PromptBuildInput {
  persona: PersonaSkin;
  engine?: PersonaEngine;
  chart: BaziChart;
  task: FortuneTask;
  sharedProfile?: SharedProfile | null;
  roleHistory?: ChatMessage[];
  question?: string;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PersonaGenerationDraft {
  engine: Pick<PersonaEngine, 'name' | 'worldview' | 'promptRules'>;
  persona: {
    name: string;
    opening: string;
    customPrompt: string;
    tone: ToneSettings;
    categories: FortuneCategory[];
  };
}

export function toneToPromptRules(tone: ToneSettings): string[] {
  const directness =
    tone.directness >= 70
      ? '表达要直截了当，先说关键判断，再解释原因。'
      : tone.directness <= 35
        ? '表达要多鼓励与安顿情绪，尖锐判断需包裹在建设性建议中。'
        : '表达在坦诚与照顾感受之间保持平衡。';
  const detail =
    tone.detail >= 70
      ? '解读要详尽，给出结构、依据与分步骤建议。'
      : tone.detail <= 35
        ? '解读要简洁，避免铺陈，只保留最重要的判断和行动。'
        : '解读要适中，重点部分展开，次要部分点到为止。';
  return [directness, detail];
}

export function createChartFactLayer(chart: BaziChart): string {
  return JSON.stringify(chart.promptFacts, null, 2);
}

function createDeliveryLayer(task: FortuneTask): string {
  if (task === 'bazi_full') {
    return [
      '交付类型：命盘速览。',
      '产品定位：免费/低门槛体验，用于让用户快速理解命盘核心，不输出长篇正式报告。',
      '输出长度：控制在 800-1200 字。',
      '必须包含：基础档案、命局核心、优势与风险、事业财运、关系提醒、下一步建议。',
      '基础档案必须引用命理事实层.birthInfo 中的性别、历法、出生时间、出生地/经度和真太阳时状态。',
      '表达方式：保留当前大师口吻，但要清楚、短句、适合移动端阅读。'
    ].join('\n');
  }
  if (task === 'structured_report') {
    return [
      '交付类型：专业完整报告。',
      '产品定位：可作为付费交付主体，要求结构稳定、依据充分、可导出为正式文档。',
      '输出长度：建议 2200-3500 字，宁可分节清楚，不要堆砌玄学套话。',
      '必须包含：基础档案与排盘口径、摘要结论、命局底盘、事业与能力、财运与资源、关系与婚恋、健康与作息、大运流年、可执行清单。',
      '基础档案与排盘口径必须列明：性别、原始出生时间、出生地、经纬度、真太阳时、起运基准、子时规则。',
      '报告结论必须能追溯到命理事实层、个人档案或人生事件线。'
    ].join('\n');
  }
  if (task === 'multi_school') {
    return [
      '交付类型：多流派会诊。',
      '产品定位：专业进阶解读，用于展示不同命理体系的观察差异，适合作为高阶报告或命理师辅助。',
      '输出长度：建议 1800-2800 字。',
      '必须包含：会诊总览、四派观察、共识、分歧、最终取舍。',
      '每派都必须使用同一份命理事实层，不得因为流派差异改写性别、出生时间、四柱或大运。'
    ].join('\n');
  }
  if (task === 'daily') {
    return [
      '交付类型：每日运势。',
      '产品定位：轻量复访内容，用于提高用户每日打开频率。',
      '输出长度：控制在 500-900 字。',
      '必须包含：今日总体节奏、事业财运、关系沟通、健康作息、一个具体行动建议。'
    ].join('\n');
  }
  if (task === 'daily_lot') {
    return [
      '交付类型：今日灵签。',
      '产品定位：轻仪式感内容，用于增强互动和情绪价值。',
      '输出长度：控制在 400-700 字。',
      '签诗可以有文采，但解签必须回到命理事实层中的今日流日关系。'
    ].join('\n');
  }
  return [
    '交付类型：连续追问。',
    '产品定位：承接用户对已有报告或聊天结论的具体问题。',
    '输出长度：根据问题复杂度控制在 400-1200 字。',
    '回答必须延续本角色既有结论，并优先引用命理事实层.birthInfo 与最近对话。'
  ].join('\n');
}

function createTaskLayer(task: FortuneTask): string {
  const evidenceRule =
    '关键判断必须标注【依据：...】，依据只能来自命理事实层、个人档案或人生事件线；不能编造未提供的出生、经历或现实信息。';
  if (task === 'structured_report') {
    return [
      '任务：生成可交付的专业八字报告。报告要像命理师工作台导出的正式文档，而不是普通聊天回复。',
      evidenceRule,
      '输出必须使用 Markdown，结构依次为：',
      '## 基础档案与排盘口径：列出性别、出生时间、出生地、真太阳时、起运基准和子时规则',
      '## 摘要结论：用 5 条短句列出最重要判断',
      '## 命局底盘：日主、月令、五行旺衰、格局气势与关键干支关系',
      '## 事业与能力：优势、适合路径、风险点、未来三年的行动建议',
      '## 财运与资源：赚钱方式、守财习惯、合作风险',
      '## 关系与婚恋：关系模式、沟通提醒、择偶/相处建议',
      '## 健康与作息：只给生活方式建议，不做医学诊断',
      '## 大运流年：说明当前大运和近年节奏',
      '## 可执行清单：给 7 条具体行动',
      '每一节先讲判断，再讲依据，最后给行动。'
    ].join('\n');
  }
  if (task === 'multi_school') {
    return [
      '任务：生成多流派会诊。请同时模拟传统子平派、调候派、盲派倾向、心理现实派四个观察席。',
      evidenceRule,
      '输出必须使用 Markdown，结构依次为：',
      '## 会诊总览',
      '## 四派观察：每派给核心判断、证据、提醒',
      '## 共识：列出各派都认可的判断',
      '## 分歧：列出各派侧重点不同之处，并解释为什么会有差异',
      '## 最终取舍：给现实可执行的综合建议',
      '四派可以有不同口吻，但不得互相否定事实层。'
    ].join('\n');
  }
  if (task === 'daily') {
    return `任务：生成每日运势。必须基于命盘中的今日流日关系，输出今日总体节奏、事业财运、关系沟通、健康作息和一个具体行动建议。${evidenceRule}`;
  }
  if (task === 'daily_lot') {
    return [
      '任务：生成今日抽签。必须基于命盘中的今日流日关系和当前角色体系，给出一支今日灵签。',
      evidenceRule,
      '输出必须使用 Markdown，结构依次为：',
      '### 今日灵签：第X签 · 吉/中/凶',
      '**签诗**',
      '> 四句短签诗',
      '**解签**',
      '**今日宜**',
      '**今日忌**',
      '**一句行动**',
      '签位和签诗可以有仪式感，但不得随机编造事实层之外的出生信息，不可改写命盘事实。'
    ].join('\n');
  }
  if (task === 'follow_up') {
    return `任务：回答用户追问。允许开放式角色扮演聊天，但必须保持算命大师底色，并与本角色既有结论一致。${evidenceRule}`;
  }
  return [
    '任务：生成命盘速览。它不是完整付费报告，而是让用户快速建立信任的第一版解读。',
    evidenceRule,
    '输出必须使用 Markdown，结构依次为：',
    '## 基础档案：列出性别、出生时间、出生地与真太阳时状态',
    '## 核心判断：用 3-5 条短句概括命盘重点',
    '## 命局简析：说明日主、五行旺衰和关键关系',
    '## 现实提醒：分别给事业财运、关系沟通、健康作息的简短建议',
    '## 下一步：给 3 条最值得立刻执行的建议'
  ].join('\n');
}

function createDefaultQuestion(task: FortuneTask): string {
  if (task === 'structured_report') return '请生成一份可交付的专业八字报告。';
  if (task === 'multi_school') return '请用多流派会诊的方式分析这张命盘。';
  if (task === 'daily') return '请看我今天的运势。';
  if (task === 'daily_lot') return '请为我抽一支今日签。';
  return '请先为我生成一份命盘速览。';
}

export function buildPersonaGenerationMessages(direction: string, engines: PersonaEngine[]): LlmMessage[] {
  const engineSummary = engines
    .map((engine) => `- ${engine.name}（id: ${engine.id}）：${engine.worldview}`)
    .join('\n');
  return [
    {
      role: 'system',
      content: [
        '你是占卜产品的角色与体系设计师，擅长把一个创意方向设计成可运营的大师角色。',
        '请只返回一个 JSON 对象，不要 Markdown，不要解释，不要代码围栏。',
        'JSON 结构必须完全符合：',
        '{"engine":{"name":"体系名称","worldview":"体系世界观","promptRules":["体系提示规则1","体系提示规则2","体系提示规则3"]},"persona":{"name":"大师名字","opening":"开场白","customPrompt":"角色自定义提示词","tone":{"directness":50,"detail":70},"categories":["bazi","daily"]}}',
        '字段要求：name 不超过 40 字；opening 不超过 120 字；customPrompt 不超过 800 字；engine.name 不超过 30 字；worldview 不超过 300 字；promptRules 3-5 条，每条不超过 120 字。',
        'customPrompt 要写给模型执行，包含口吻、人设边界、表达禁忌、解读侧重点和与用户互动方式。',
        'tone.directness 与 tone.detail 为 0-100 的整数；categories 只能从 bazi、daily 中选择，通常两者都要包含。',
        '必须生成一个与角色匹配的新体系，不要复用已有体系名称；可以参考已有体系避免重复。',
        `已有体系：\n${engineSummary || '暂无'}`
      ].join('\n')
    },
    {
      role: 'user',
      content: `创意方向：${direction.trim()}`
    }
  ];
}

function createMemoryLayer(sharedProfile?: SharedProfile | null, roleHistory: ChatMessage[] = []) {
  return JSON.stringify(
    {
      sharedProfile: sharedProfile
        ? {
            facts: sharedProfile.facts,
            lifeEvents: sharedProfile.lifeEvents ?? [],
            updatedAt: sharedProfile.updatedAt
          }
        : null,
      recentRoleHistory: roleHistory.slice(-8)
    },
    null,
    2
  );
}

export function buildFortuneMessages(input: PromptBuildInput): LlmMessage[] {
  const engine =
    input.engine ??
    ENGINE_DEFINITIONS[input.persona.engineId] ??
    ENGINE_DEFINITIONS.realist ??
    Object.values(ENGINE_DEFINITIONS)[0];
  const customPrompt = input.persona.customPrompt?.trim();
  const roleLayer = [
    `你是${input.persona.name}，绑定体系：${engine.name}。`,
    `世界观：${engine.worldview}`,
    `角色开场白：${input.persona.opening}`,
    ...engine.promptRules,
    ...(customPrompt ? [`角色自定义提示词：\n${customPrompt}`] : []),
    ...toneToPromptRules(input.persona.tone),
    '不可重新排盘，不可改写命理事实层；如需要引用命盘，只能引用事实层中的结构化数据。',
    '命理事实层.birthInfo 中的性别、出生时间、出生地、真太阳时与起运基准是已知事实；涉及婚恋、事业、大运顺逆和人生建议时必须优先引用，不得说“无法确认性别”。',
    '可以给出不同视角与侧重，但不得声称自己掌握事实层之外的出生信息。',
    '涉及健康、投资、婚恋和重大人生决策时，只能提供参考和行动建议，不做绝对保证。'
  ].join('\n');

  return [
    {
      role: 'system',
      content: `【角色层】\n${roleLayer}\n\n【命理事实层】\n${createChartFactLayer(input.chart)}\n\n【交付规格层】\n${createDeliveryLayer(input.task)}\n\n【任务层】\n${createTaskLayer(input.task)}\n\n【记忆层】\n${createMemoryLayer(input.sharedProfile, input.roleHistory)}`
    },
    {
      role: 'user',
      content: input.question?.trim() || createDefaultQuestion(input.task)
    }
  ];
}
