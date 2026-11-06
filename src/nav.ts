/**
 * 唯一导航清单 —— 电脑侧栏与手机抽屉都读这一份。
 * 以前两边各写一遍，结果手机多出「发现 / 研究记录 / 资料库」，
 * 电脑上根本点不到；现在统一在这里改，两边一起变。
 */
export interface NavItem {
  key: string;
  label: string;
  to: string;
  icon: string;
  /** 手机上是否在主导航显示；电脑同样遵守，保持一致 */
  devOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'discover', label: '发现', to: '/discover', icon: 'compass' },
  { key: 'new', label: '新建项目', to: '/new', icon: 'plus' },
  { key: 'home', label: '对话', to: '/', icon: 'chat' },
  { key: 'library', label: '资料库', to: '/library', icon: 'box' },
  { key: 'settings', label: '设置', to: '/settings', icon: 'gear' },
];

/** 图标统一 20×20、1.6 描边，粗细与设置页一致 */
export const NAV_ICONS: Record<string, string> = {
  chat:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11.5c0 3.3-3.6 6-8 6-.9 0-1.8-.1-2.6-.35L5 19.5l1-3.2C4.75 15.1 4 13.4 4 11.5 4 8.2 7.6 5.5 12 5.5s8 2.7 8 6z"/></svg>',
  compass:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.4"/><path d="m15 9-1.7 4.3L9 15l1.7-4.3z"/></svg>',
  plus:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  folder:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.6 7.4A1.9 1.9 0 0 1 5.5 5.5h3.2l1.7 2h8.1a1.9 1.9 0 0 1 1.9 1.9v7.7a1.9 1.9 0 0 1-1.9 1.9H5.5a1.9 1.9 0 0 1-1.9-1.9z"/></svg>',
  clock:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.4"/><path d="M12 7.6V12l3 1.8"/></svg>',
  box:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.2 12 4l8 4.2v7.6L12 20l-8-4.2z"/><path d="M4 8.2 12 12.4l8-4.2M12 12.4V20"/></svg>',
  gear:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.1"/><path d="M12 3.6v2.1M12 18.3v2.1M4.8 7.7l1.8 1M17.4 15.3l1.8 1M4.8 16.3l1.8-1M17.4 8.7l1.8-1"/></svg>',
  search:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>',
  bell:
    '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 5 2 6 2 6H4.5s2-1 2-6z"/><path d="M10 19.5a2.2 2.2 0 0 0 4 0"/></svg>',
  menu:
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7.5h16M4 12h16M4 16.5h16"/></svg>',
  back:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6"/></svg>',
  fwd:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m10 6 6 6-6 6"/></svg>',
  theme:
    '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>',
  code:
    '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m9 8-4 4 4 4M15 8l4 4-4 4"/></svg>',
  chevron:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
};
