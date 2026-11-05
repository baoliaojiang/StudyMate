/**
 * Skill 注册表与导入校验
 *
 * 硬规则：Skill 只能声明「规则文本」，不能带可执行代码。
 * 导入前先跑 inspectImport，把来源、能力类型、允许与不允许做的事摆出来，
 * 用户确认后再入库；带 code / script / eval 字段的一律拒绝。
 */
import { db } from '../core/db';
import { BUILTIN_SKILLS, getSkill as getBuiltinSkill } from './definitions';
import type { SkillDefinition } from '../core/types';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** 出现这些字段就认为夹带了可执行内容 */
const CODE_KEYS = ['code', 'script', 'js', 'javascript', 'python', 'exec', 'eval', 'run', 'shell', 'command', 'import', 'require'];

export const CAPABILITY_LABEL: Record<SkillDefinition['capability'], string> = {
  prompt: '提示词规则',
  checklist: '检查清单',
  format: '格式规范',
};

export const CAPABILITY_NOTE: Record<SkillDefinition['capability'], string> = {
  prompt: '追加到系统提示词，改变写作与判断方式',
  checklist: '作为逐条核对项，输出问题时对照使用',
  format: '约束输出格式与排版参数，不改内容本身',
};

export interface SkillImportCheck {
  ok: boolean;
  errors: string[];
  skill?: SkillDefinition;
  /** 展示给用户看的来源，例如「粘贴导入」或文件名 */
  source: string;
  /** 会获得什么、不会获得什么 */
  permissions: string[];
  /** 是否检测到可执行内容 */
  codeBlocked: boolean;
}

export function builtinSkills(): SkillDefinition[] {
  return BUILTIN_SKILLS.map(clone);
}

export async function listSkills(): Promise<SkillDefinition[]> {
  const rows = await db.customSkills.toArray();
  const map = new Map<string, SkillDefinition>();
  BUILTIN_SKILLS.forEach((s) => map.set(s.id, clone(s)));
  for (const row of rows) {
    const base = map.get(row.id);
    map.set(row.id, { ...(base ?? row), ...clone(row), builtin: base ? true : !!row.builtin });
  }
  return [...map.values()].sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name, 'zh'));
}

/** 有本地覆盖记录（内置被改过，或自定义新增）的 id */
export async function overriddenIds(): Promise<string[]> {
  const rows = await db.customSkills.toArray();
  return rows.map((r) => r.id);
}

export async function getSkillById(id: string): Promise<SkillDefinition | undefined> {
  const all = await listSkills();
  return all.find((s) => s.id === id);
}

function slug(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return ascii || `x-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 检查一段待导入内容。支持两种形态：
 * - 单个对象 { name, rules, capability }
 * - 数组 / { skills: [...] }（逐个检查，由调用方决定导入哪个）
 */
export function inspectSkillImport(raw: string, source = '粘贴导入'): SkillImportCheck {
  const errors: string[] = [];
  const text = raw.trim();
  if (!text) {
    return { ok: false, errors: ['没有内容'], source, permissions: [], codeBlocked: false };
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['不是合法 JSON。Skill 必须是 JSON 对象，不能是脚本或 Markdown。'], source, permissions: [], codeBlocked: false };
  }

  const obj = Array.isArray(data) ? data[0] : (data as Record<string, unknown>)?.skills;
  const item = (Array.isArray(obj) ? obj[0] : data) as Record<string, unknown> | undefined;
  if (!item || typeof item !== 'object') {
    return { ok: false, errors: ['找不到 Skill 对象'], source, permissions: [], codeBlocked: false };
  }

  const badKeys = Object.keys(item).filter((k) => CODE_KEYS.includes(k.toLowerCase()));
  const codeBlocked = badKeys.length > 0;
  if (codeBlocked) {
    errors.push(`检测到可执行字段：${badKeys.join('、')}。本软件不执行任何导入的代码。`);
  }

  const name = String(item.name ?? '').trim();
  if (!name) errors.push('缺少 name（Skill 名称）');
  if (name.length > 40) errors.push('name 太长（最多 40 字）');

  const rules = String(item.rules ?? item.rule ?? '').trim();
  if (!rules) errors.push('缺少 rules（规则正文）');
  if (rules.length > 8000) errors.push('rules 太长（最多 8000 字）');

  const cap = String(item.capability ?? 'prompt');
  if (!['prompt', 'checklist', 'format'].includes(cap)) {
    errors.push(`capability 只能是 prompt / checklist / format，收到「${cap}」`);
  }

  const skill: SkillDefinition | undefined = errors.length
    ? undefined
    : {
        id: String(item.id ?? `imported-${slug(name)}`),
        name,
        description: String(item.description ?? '').slice(0, 160),
        capability: cap as SkillDefinition['capability'],
        rules,
        builtin: false,
        origin: String(item.origin ?? source),
        updatedAt: Date.now(),
      };

  return {
    ok: errors.length === 0,
    errors,
    skill,
    source: String(item.origin ?? source),
    codeBlocked,
    permissions: skill
      ? [
          `能力：${CAPABILITY_LABEL[skill.capability]} —— ${CAPABILITY_NOTE[skill.capability]}`,
          '会注入到 Agent 的系统提示词，影响生成内容',
          '不会执行代码、不联网、不读取文件、不接触 API Key',
          '可以随时删除，删除后立即从提示词里消失',
        ]
      : [],
  };
}

export async function importSkill(raw: string, source = '粘贴导入'): Promise<SkillDefinition> {
  const check = inspectSkillImport(raw, source);
  if (!check.ok || !check.skill) throw new Error(check.errors.join('；'));
  const existing = await db.customSkills.get(check.skill.id);
  await db.customSkills.put({ ...check.skill, updatedAt: Date.now(), origin: existing ? check.skill.origin : source });
  return check.skill;
}

export async function saveSkill(skill: SkillDefinition): Promise<void> {
  await db.customSkills.put({ ...clone(skill), updatedAt: Date.now() });
}

export async function deleteSkill(id: string): Promise<void> {
  if (getBuiltinSkill(id)) throw new Error('内置 Skill 不能删除，可以编辑后保存为覆盖版本。');
  await db.customSkills.delete(id);
}

export async function resetSkill(id: string): Promise<void> {
  await db.customSkills.delete(id);
}
