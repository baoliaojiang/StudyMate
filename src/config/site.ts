/**
 * 站点 / 维护者配置（发布前由维护者填写）
 *
 * 这里只放「链接与版本」，不放任何密钥。URL 全部通过 window.open 直接跳转用户浏览器，
 * 不经由任何中转服务。未填写的链接保持空串，界面显示「待补充」，绝不编造地址。
 *
 * 维护者清单（需求 V1.0）：
 *  - 作者主页（GitHub）：https://github.com/baoliaojiang（已填）
 *  - B 站主页：已填
 *  - 爱发电：已填
 *  - GitHub 仓库 / Releases / Issue：https://github.com/baoliaojiang/StudyMate（已填）
 *  - 夸克备用下载 / API 指引配置 / 更新 JSON / 应用图标：待维护者补充
 */
export const SITE = {
  appName: '研学帮 StudyMate',
  /** 当前版本，需与 package.json 保持一致 */
  version: '1.0.11',

  /** 作者主页（已填） */
  authorHome: 'https://github.com/baoliaojiang',

  /** 项目仓库：源码、下载与反馈都在这里 */
  github: 'https://github.com/baoliaojiang/StudyMate',
  releases: 'https://github.com/baoliaojiang/StudyMate/releases',
  issues: 'https://github.com/baoliaojiang/StudyMate/issues',

  /** B 站主页（已填） */
  bilibili: 'https://space.bilibili.com/525298385',

  /** 爱发电（已填） */
  afdian: 'https://afdian.com/a/dcr33550336',

  /** 以下待维护者补充，空串表示未配置 */
  quark: '', // 夸克备用下载分享链接
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
    { key: 'authorHome', label: '作者主页（GitHub）', url: SITE.authorHome, ok: !!SITE.authorHome },
    { key: 'github', label: 'GitHub 开源仓库', url: SITE.github, ok: !!SITE.github },
    { key: 'releases', label: 'GitHub Releases 下载', url: SITE.releases, ok: !!SITE.releases },
    { key: 'bilibili', label: 'B 站主页', url: SITE.bilibili, ok: !!SITE.bilibili },
    { key: 'afdian', label: '爱发电（自愿支持）', url: SITE.afdian, ok: !!SITE.afdian },
    { key: 'issues', label: '提交 Issue / 反馈', url: SITE.issues, ok: !!SITE.issues },
    { key: 'quark', label: '夸克备用下载', url: SITE.quark, ok: !!SITE.quark },
  ];
}
