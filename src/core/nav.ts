import type { Router } from 'vue-router';

/**
 * 返回上一级。
 *
 * 设置二级页既可能从设置首页点进来，也可能从项目页、报告页直接跳进来
 * （例如「去配置模型」）。前者应回到设置首页，后者应原路返回，
 * 所以先看是否还有可后退的历史，没有才回落到 fallback。
 */
export function backOr(router: Router, fallback = '/settings') {
  const state = window.history.state as { back?: string | null } | null;
  if (state?.back) router.back();
  else router.push(fallback);
}
