import { createRouter, createWebHashHistory } from 'vue-router';
import { confirmLeave, hasRunningTask } from '../core/task-guard';

export const router = createRouter({
  // hash 路由：PWA / Electron / Capacitor 用 file:// 或本地协议都能直接跑
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('../views/Home.vue') },
    { path: '/discover', name: 'discover', component: () => import('../views/Discover.vue') },
    { path: '/records', name: 'records', component: () => import('../views/RecordsOverview.vue') },
    { path: '/library', name: 'library', component: () => import('../views/Library.vue') },
    { path: '/onboarding', name: 'onboarding', component: () => import('../views/Onboarding.vue') },
    // 法务文本独立成页：从设置里点进来只看文本，不重走引导
    { path: '/legal/:doc', name: 'legal', component: () => import('../views/LegalDoc.vue') },
    { path: '/new', name: 'new', component: () => import('../views/NewProject.vue') },
    { path: '/project/:id', name: 'project', component: () => import('../views/ProjectDetail.vue') },
    // 答辩演示稿：从项目页进下一层，返回时走反向转场
    { path: '/deck/:id', name: 'deck', component: () => import('../views/PptStudio.vue') },
    // 单篇研究记录：独立页面，不再是抽屉
    {
      path: '/project/:id/records/:index',
      name: 'record',
      component: () => import('../views/RecordEdit.vue'),
    },
    // 设置二级页走同一路由的可选参数，手机返回键与桌面浏览器后退行为一致
    { path: '/settings/:tab?', name: 'settings', component: () => import('../views/Settings.vue') },
    { path: '/dev', name: 'dev', component: () => import('../views/DevPanel.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

/**
 * 有任务在跑时，离开页面会中断这一步：先问一句再走。
 * 强制跳转（引导、法务全文）与同页跳转不拦，避免弹窗套弹窗。
 */
router.beforeEach(async (to, from) => {
  if (to.fullPath === from.fullPath || !hasRunningTask()) return true;
  if (to.name === 'onboarding' || to.name === 'legal') return true;
  return confirmLeave();
});
