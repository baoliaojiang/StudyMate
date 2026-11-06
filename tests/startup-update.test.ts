import { describe, expect, it } from 'vitest';
import {
  buildChangelogMd,
  decideStartupUpdate,
  isMandatoryVersion,
  pickAssetUrl,
} from '../src/core/startup-update';
import { UPDATE_POLICY } from '../src/config/site';
import type { ReleaseInfo, UpdateProbe } from '../src/core/update-mirror';

const SETUP = 'https://github.com/baoliaojiang/StudyMate/releases/download/v1.0.20/StudyMate-1.0.20-setup.exe';
const APK = 'https://github.com/baoliaojiang/StudyMate/releases/download/v1.0.20/StudyMate-1.0.20-release.apk';
const PAGE = 'https://github.com/baoliaojiang/StudyMate/releases/tag/v1.0.20';

function release(over: Partial<ReleaseInfo> = {}): ReleaseInfo {
  return {
    tag: 'v1.0.20',
    version: '1.0.20',
    htmlUrl: PAGE,
    publishedAt: '2026-11-06T10:00:00Z',
    body: '### 新增\n- 修好了备份导出',
    assets: [
      { name: 'StudyMate-1.0.20-setup.exe', url: SETUP },
      { name: 'StudyMate-1.0.20-release.apk', url: APK },
    ],
    ...over,
  };
}

const probes: UpdateProbe[] = [
  { url: 'https://github.com/baoliaojiang/StudyMate', host: 'github.com', via: 'repo', ok: true },
  { url: 'https://ghproxy.net/', host: 'ghproxy.net', via: 'mirror', ok: true },
];

describe('启动更新弹窗的决策', () => {
  it('发现新版本时默认保留「下次再说」，去更新走安装包直链', () => {
    const u = decideStartupUpdate(release(), probes, { currentVersion: '1.0.16', platform: 'desktop' });
    expect(u).not.toBeNull();
    expect(u?.version).toBe('1.0.20');
    expect(u?.allowLater).toBe(true);
    expect(u?.downloadUrl).toBe(SETUP);
    expect(u?.isDirectAsset).toBe(true);
    expect(u?.changelogMd).toContain('修好了备份导出');
    expect(u?.mirrorUrl).toBe(`https://ghproxy.net/${SETUP}`);
  });

  it('同版本或更旧版本不弹，读不到 Release 也不弹', () => {
    expect(decideStartupUpdate(release(), probes, { currentVersion: '1.0.20' })).toBeNull();
    expect(decideStartupUpdate(release({ version: '1.0.15', tag: 'v1.0.15' }), probes, { currentVersion: '1.0.16' })).toBeNull();
    expect(decideStartupUpdate(null, probes)).toBeNull();
  });

  it('点过「下次再说」本次会话不再弹', () => {
    expect(decideStartupUpdate(release(), probes, { currentVersion: '1.0.16', skipped: true })).toBeNull();
  });

  it('没有匹配附件时如实退回发布页，不编造直链', () => {
    const u = decideStartupUpdate(release({ assets: [] }), probes, { currentVersion: '1.0.16' });
    expect(u?.isDirectAsset).toBe(false);
    expect(u?.downloadUrl).toBe(PAGE);
  });

  it('发布页没写日志时给出兜底说明，不编造更新内容', () => {
    expect(buildChangelogMd(release({ body: '' }))).toContain('没有写更新日志');
    expect(buildChangelogMd(release({ body: '' }))).not.toContain('修复了');
  });

  it('安卓挑 APK，桌面挑 EXE', () => {
    const assets = release().assets!;
    expect(pickAssetUrl(assets, 'android')).toBe(APK);
    expect(pickAssetUrl(assets, 'desktop')).toBe(SETUP);
    expect(pickAssetUrl([], 'android')).toBeNull();
  });

  it('只有明确配置的版本才隐藏「下次再说」', () => {
    expect(isMandatoryVersion('1.0.20')).toBe(false);
    UPDATE_POLICY.mandatoryVersions.push('1.0.20');
    try {
      const u = decideStartupUpdate(release(), probes, {
        currentVersion: '1.0.16',
        skipped: true,
      });
      expect(u?.allowLater).toBe(false);
      expect(u).not.toBeNull(); // 强制版本不受「下次再说」跳过影响
    } finally {
      UPDATE_POLICY.mandatoryVersions.length = 0;
    }
  });
});
