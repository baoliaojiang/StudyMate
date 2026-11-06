/**
 * 启动时的版本检查
 *
 * 每次进入应用都查一次：只认 GitHub 官方 Releases 接口读版本号，
 * 同时把官方仓库与配置里的镜像站全部并行探测一遍（镜像只用来打开下载页/直链，
 * 不冒充版本接口，也不自己下载安装任何东西）。
 *
 * 有新版本 → 交给强制模态展示 Markdown 更新日志 + 安装包直链。
 * 读不到、连不上、版本不比当前新 → 返回 null，界面照常用，不打扰用户。
 *
 * 「下次再说」默认一直保留；只有在 config/site.ts 的 UPDATE_POLICY 里
 * 明确写死版本号 / 起始版本时，才会隐藏它。没有配置就没有隐式强制。
 */
import { Capacitor } from '@capacitor/core';
import { SITE, UPDATE_POLICY } from '../config/site';
import {
  compareVersions,
  fetchLatestRelease,
  mirrorTarget,
  probeUpdateSources,
  type ReleaseAsset,
  type ReleaseInfo,
  type UpdateProbe,
} from './update-mirror';

export type PlatformKind = 'android' | 'desktop' | 'web';

export interface StartupUpdate {
  version: string;
  currentVersion: string;
  publishedAt: string;
  /** 更新日志 Markdown 原文（来自 Release body；读不到时如实说明） */
  changelogMd: string;
  /** 「去更新」要打开的直链；没有匹配附件时退回发布页 */
  downloadUrl: string;
  /** true 表示这是安装包直链，不是发布页 */
  isDirectAsset: boolean;
  /** 镜像站拼出来的备用地址，没有可达镜像时为 null */
  mirrorUrl: string | null;
  releaseUrl: string;
  /** false 时弹窗只留「去更新」 */
  allowLater: boolean;
}

export function platformKind(): PlatformKind {
  try {
    if (Capacitor.isNativePlatform()) return 'android';
  } catch {
    // 非 Capacitor 环境
  }
  if (typeof location !== 'undefined' && location.protocol === 'file:') return 'desktop';
  if (typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent)) return 'desktop';
  return 'web';
}

/** 按平台从 Release 附件里挑安装包直链；找不到返回 null */
export function pickAssetUrl(assets: ReleaseAsset[] = [], kind: PlatformKind): string | null {
  const find = (re: RegExp) => assets.find((a) => re.test(a.name))?.url ?? null;
  if (kind === 'android') return find(/-release\.apk$/i) ?? find(/\.apk$/i);
  if (kind === 'desktop') return find(/-setup\.exe$/i) ?? find(/-portable\.exe$/i) ?? find(/\.exe$/i);
  // 网页版本身无需安装包；给桌面安装包，方便用户顺手装完整版
  return find(/-setup\.exe$/i) ?? find(/\.apk$/i) ?? null;
}

/** 只有明确配置过的版本才不给「下次再说」 */
export function isMandatoryVersion(version: string): boolean {
  if (UPDATE_POLICY.mandatoryVersions.some((v) => compareVersions(v, version) === 0)) return true;
  return Boolean(UPDATE_POLICY.mandatoryFrom) && compareVersions(version, UPDATE_POLICY.mandatoryFrom) >= 0;
}

export function buildChangelogMd(rel: ReleaseInfo): string {
  const body = (rel.body ?? '').trim();
  if (body) return body;
  return [
    `### v${rel.version}`,
    '',
    '发布页这次没有写更新日志，完整内容请点「去更新」查看。',
    '',
    `当前版本 v${SITE.version} 的更新记录，可在「设置 → 更新日志」里查看。`,
  ].join('\n');
}

/** 纯决策：便于单测，不做任何网络请求 */
export function decideStartupUpdate(
  rel: ReleaseInfo | null,
  probes: UpdateProbe[] = [],
  opts: { currentVersion?: string; platform?: PlatformKind; skipped?: boolean } = {},
): StartupUpdate | null {
  if (!rel) return null;
  const current = opts.currentVersion ?? SITE.version;
  if (compareVersions(rel.version, current) <= 0) return null;

  const mandatory = isMandatoryVersion(rel.version);
  // 本次会话点过「下次再说」就不再弹；强制升级版本不受它影响
  if (opts.skipped && !mandatory) return null;

  const kind = opts.platform ?? platformKind();
  const direct = pickAssetUrl(rel.assets, kind);
  const official = rel.htmlUrl || SITE.releases;
  const mirror = probes.find((p) => p.via === 'mirror' && p.ok)?.url ?? null;

  return {
    version: rel.version,
    currentVersion: current,
    publishedAt: rel.publishedAt,
    changelogMd: buildChangelogMd(rel),
    downloadUrl: direct ?? official,
    isDirectAsset: Boolean(direct),
    mirrorUrl: mirror ? mirrorTarget(mirror, direct ?? SITE.releases) : null,
    releaseUrl: official,
    allowLater: !mandatory,
  };
}

const SKIP_PREFIX = 'studymate:update-later:';

export function markUpdateLater(version: string): void {
  try {
    sessionStorage.setItem(`${SKIP_PREFIX}${version}`, '1');
  } catch {
    // 隐私模式下 sessionStorage 可能不可用：只是不记住跳过，不影响其它功能
  }
}

function wasSkipped(version?: string): boolean {
  if (!version) return false;
  try {
    return sessionStorage.getItem(`${SKIP_PREFIX}${version}`) === '1';
  } catch {
    return false;
  }
}

/** 应用启动时调用一次；任何失败都静默返回 null，绝不阻塞启动 */
export async function checkStartupUpdate(): Promise<StartupUpdate | null> {
  try {
    const [rel, probes] = await Promise.all([
      fetchLatestRelease(SITE.github),
      probeUpdateSources([...SITE.mirrors], SITE.github),
    ]);
    return decideStartupUpdate(rel, probes, { skipped: wasSkipped(rel?.version) });
  } catch {
    return null;
  }
}
