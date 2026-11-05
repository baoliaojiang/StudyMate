import { describe, expect, it, vi } from 'vitest';
import {
  compareVersions,
  fetchLatestRelease,
  releaseApiUrl,
} from '../src/core/update-mirror';

const REPO = 'https://github.com/baoliaojiang/StudyMate';

function mockFetch(data: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => data })) as unknown as typeof fetch;
}

describe('GitHub Releases 版本查询', () => {
  it('从仓库地址解析出官方接口，不拼任何镜像地址', () => {
    expect(releaseApiUrl(REPO)).toBe('https://api.github.com/repos/baoliaojiang/StudyMate/releases/latest');
    expect(releaseApiUrl(`${REPO}/`)).toBe('https://api.github.com/repos/baoliaojiang/StudyMate/releases/latest');
    expect(releaseApiUrl('git@github.com:baoliaojiang/StudyMate.git')).toBe(
      'https://api.github.com/repos/baoliaojiang/StudyMate/releases/latest',
    );
  });

  it('不是 GitHub 仓库时不猜接口', () => {
    expect(releaseApiUrl('')).toBeNull();
    expect(releaseApiUrl('https://example.com/foo/bar')).toBeNull();
    expect(releaseApiUrl('https://github.com/baoliaojiang')).toBeNull();
  });

  it('版本号按数字段比较，v 前缀与预发布后缀不影响主版本', () => {
    expect(compareVersions('1.0.12', '1.0.11')).toBe(1);
    expect(compareVersions('v1.0.11', '1.0.11')).toBe(0);
    expect(compareVersions('1.0.9', '1.0.10')).toBe(-1);
    expect(compareVersions('1.1', '1.0.12')).toBe(1);
  });

  it('读取到真实 tag 时返回版本与下载页地址', async () => {
    const info = await fetchLatestRelease(
      REPO,
      mockFetch({
        tag_name: 'v1.0.12',
        html_url: 'https://github.com/baoliaojiang/StudyMate/releases/tag/v1.0.12',
        published_at: '2026-11-05T12:00:00Z',
        name: 'v1.0.12',
      }),
    );
    expect(info?.version).toBe('1.0.12');
    expect(info?.tag).toBe('v1.0.12');
    expect(info?.htmlUrl).toContain('/releases/tag/');
  });

  it('接口不可用、没有 tag、请求抛错时都返回 null，不编造版本', async () => {
    expect(await fetchLatestRelease(REPO, mockFetch({}, false))).toBeNull();
    expect(await fetchLatestRelease(REPO, mockFetch({ name: '没有 tag' }))).toBeNull();
    const boom = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await fetchLatestRelease(REPO, boom)).toBeNull();
    expect(await fetchLatestRelease('https://example.com/x/y', boom)).toBeNull();
  });

  it('没有 html_url 时回退到仓库的 Releases 页面', async () => {
    const info = await fetchLatestRelease(REPO, mockFetch({ tag_name: '1.0.12' }));
    expect(info?.htmlUrl).toBe(`${REPO}/releases`);
  });
});
