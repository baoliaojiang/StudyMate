/**
 * Agent 注册表：内置 + 本地覆盖 + 自定义
 *
 * 本地库里同 id 的记录视为对内置 Agent 的覆盖（改提示词、模型、权限、超时都走这里）。
 * 删除覆盖即恢复内置默认，所以「改坏了」永远有退路。
 */
import { db } from '../core/db';
import { BUILTIN_AGENTS, getAgent as getBuiltin } from './definitions';
import type { AgentDefinition } from '../core/types';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** 内置 Agent 的默认值，用于「恢复默认」与字段兜底 */
export function builtinAgent(id: string): AgentDefinition | undefined {
  const a = getBuiltin(id);
  return a ? clone(a) : undefined;
}

export function builtinAgents(): AgentDefinition[] {
  return BUILTIN_AGENTS.map(clone);
}

/** 合并后的完整列表，按执行顺序排 */
export async function listAgents(opts: { includeDisabled?: boolean } = {}): Promise<AgentDefinition[]> {
  const [rows] = await Promise.all([db.customAgents.toArray()]);
  const map = new Map<string, AgentDefinition>();
  BUILTIN_AGENTS.forEach((a, i) => {
    map.set(a.id, { ...clone(a), order: a.order ?? (i + 1) * 10 });
  });
  for (const row of rows) {
    const base = map.get(row.id);
    map.set(row.id, { ...(base ?? row), ...clone(row), builtin: base ? true : !!row.builtin });
  }
  const list = [...map.values()]
    .map((a) => ({
      ...a,
      order: a.order ?? 999,
      budgetYuan: a.budgetYuan ?? 0,
      enabled: a.enabled !== false,
    }))
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name, 'zh'));
  return opts.includeDisabled ? list : list.filter((a) => a.enabled !== false);
}

export async function getAgentById(id: string): Promise<AgentDefinition | undefined> {
  const all = await listAgents({ includeDisabled: true });
  return all.find((a) => a.id === id);
}

/** 某个 Agent 是否被本地改过（用于界面标「已修改」） */
export async function isOverridden(id: string): Promise<boolean> {
  return !!(await db.customAgents.get(id));
}

export async function saveAgent(agent: AgentDefinition): Promise<AgentDefinition> {
  const row: AgentDefinition = {
    ...clone(agent),
    updatedAt: Date.now(),
    origin: agent.origin ?? (agent.builtin ? '本地修改' : '本地自定义'),
  };
  await db.customAgents.put(row);
  return row;
}

/** 新建自定义 Agent 的空白模板 */
export function blankAgent(): AgentDefinition {
  const stamp = Date.now().toString(36).slice(-4);
  return {
    id: `custom-${stamp}`,
    name: '新 Agent',
    description: '',
    systemPrompt: '',
    skills: ['research-norm'],
    tier: 'balanced',
    permission: { writeReport: false, useSearch: false, readSources: true },
    maxLoops: 1,
    timeoutMs: 90_000,
    builtin: false,
    order: 500,
    budgetYuan: 0,
    enabled: true,
    origin: '本地自定义',
    updatedAt: Date.now(),
  };
}

export async function deleteAgent(id: string): Promise<void> {
  const base = getBuiltin(id);
  if (base) throw new Error('内置 Agent 不能删除。要撤销修改，请用「恢复默认」。');
  await db.customAgents.delete(id);
}

/** 恢复默认：删掉本地覆盖即可 */
export async function resetAgent(id: string): Promise<void> {
  await db.customAgents.delete(id);
}

/** 工作流与入口用：只取参与执行的 Agent */
export async function activeAgents(): Promise<AgentDefinition[]> {
  return listAgents();
}
