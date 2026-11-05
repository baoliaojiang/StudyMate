/**
 * 站点 / 维护者配置（发布前由维护者填写）
 *
 * 这里只放「链接与版本」，不放任何密钥。外链统一走 core/shell.ts 的 openExternal，
 * 安卓用系统浏览器、桌面/Electron 用新标签页，不经由任何中转服务。
 * 未填写的链接保持空串，界面显示「待补充」，绝不编造地址。
 *
 * 维护者清单：
 *  - 作者主页（GitHub）、B 站主页、爱发电：已填
 *  - 在线版（GitHub Pages）、GitHub 仓库 / Releases / Issue：已填
 *  - GitHub 反代镜像：只用于打开 Releases，版本号仍走官方接口
 *  - API 指引配置 / 更新 JSON：待维护者补充
 */
export const SITE = {
  appName: '研学帮 StudyMate',
  /** 当前版本，需与 package.json 保持一致 */
  version: '1.0.15',

  /** 作者主页（已填） */
  authorHome: 'https://github.com/baoliaojiang',

  /** 在线版：GitHub Pages 项目站点，免安装、数据只存在当前浏览器 */
  online: 'https://baoliaojiang.github.io/StudyMate/',

  /** 项目仓库：源码、下载与反馈都在这里 */
  github: 'https://github.com/baoliaojiang/StudyMate',
  releases: 'https://github.com/baoliaojiang/StudyMate/releases',
  issues: 'https://github.com/baoliaojiang/StudyMate/issues',

  /** B 站主页（已填） */
  bilibili: 'https://space.bilibili.com/525298385',

  /** 爱发电（已填） */
  afdian: 'https://afdian.com/a/dcr33550336',

  /**
   * 常用 GitHub 反代镜像（根地址）。检查更新时会全部并行探测一遍，
   * 只用于打开 Releases 页面；版本号仍以 GitHub 官方接口为准。
   */
  mirrors: ['https://ghproxy.net/', 'https://gh-proxy.com/', 'https://ghfast.top/'],

  /** 以下待维护者补充，空串表示未配置 */
  apiGuide: '', // 免费 API 指引配置文件地址
  updateJson: '', // 更新 JSON 地址
} as const;

export interface SiteLink {
  key: string;
  label: string;
  url: string;
  /** 是否可用（非空即可用） */
  ok: boolean;
}

/** 关于页要展示的外链，按顺序渲染；未配置的显示「待补充」且不可点 */
export function externalLinks(): SiteLink[] {
  return [
    { key: 'online', label: '在线版（免安装，打开即用）', url: SITE.online, ok: !!SITE.online },
    { key: 'authorHome', label: '作者主页（GitHub）', url: SITE.authorHome, ok: !!SITE.authorHome },
    { key: 'github', label: 'GitHub 开源仓库', url: SITE.github, ok: !!SITE.github },
    { key: 'releases', label: 'GitHub Releases 下载', url: SITE.releases, ok: !!SITE.releases },
    { key: 'bilibili', label: 'B 站主页', url: SITE.bilibili, ok: !!SITE.bilibili },
    { key: 'afdian', label: '爱发电（自愿支持）', url: SITE.afdian, ok: !!SITE.afdian },
    { key: 'issues', label: '提交 Issue / 反馈', url: SITE.issues, ok: !!SITE.issues },
  ];
}
