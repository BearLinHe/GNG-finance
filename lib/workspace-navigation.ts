export type AccountingModule = 'external' | 'sav' | 'oak-transport';
export type OakWorkspaceView = 'vehicles' | 'maintenance' | 'labor' | 'insurance' | 'income' | 'fuel' | 'other' | 'activities' | 'rules' | 'jobs' | 'settlements';
export type WorkspaceNavigation = {
  module: AccountingModule;
  tab: 'initial' | 'container' | 'fees';
  initialKind: 'unload' | 'direct_delivery';
  containerKind: 'unload' | 'direct_delivery';
  standardCategory: 'transport' | 'warehouse' | 'domestic';
  oakView: OakWorkspaceView;
};
export const workspaceNavigationKey = 'gng-workspace-navigation-v1';
const choices = {
  module: ['external', 'sav', 'oak-transport'], tab: ['initial', 'container', 'fees'],
  initialKind: ['unload', 'direct_delivery'], containerKind: ['unload', 'direct_delivery'],
  standardCategory: ['transport', 'warehouse', 'domestic'],
  oakView: ['vehicles', 'maintenance', 'labor', 'insurance', 'income', 'fuel', 'other', 'activities', 'rules', 'jobs', 'settlements']
} as const;
const defaults: WorkspaceNavigation = { module: 'external', tab: 'initial', initialKind: 'unload', containerKind: 'unload', standardCategory: 'transport', oakView: 'vehicles' };

export function readWorkspaceNavigation(search: string, stored: string | null = null): WorkspaceNavigation {
  let saved: Record<string, unknown> = {};
  try {
    const value: unknown = stored ? JSON.parse(stored) : null;
    if (value && typeof value === 'object' && !Array.isArray(value)) saved = value as Record<string, unknown>;
  } catch { /* Invalid browser preferences must not prevent opening a workspace. */ }
  const params = new URLSearchParams(search);
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as Array<keyof WorkspaceNavigation>) {
    const allowed: readonly unknown[] = choices[key];
    const candidate = allowed.includes(params.get(key)) ? params.get(key) : saved[key];
    if (allowed.includes(candidate)) Object.assign(result, { [key]: candidate });
  }
  return result;
}

export function workspaceNavigationUrl(href: string, state: WorkspaceNavigation): string {
  const url = new URL(href);
  for (const key of Object.keys(defaults)) url.searchParams.delete(key);
  url.searchParams.set('module', state.module);
  if (state.module === 'oak-transport') url.searchParams.set('oakView', state.oakView);
  if (state.module === 'external') {
    url.searchParams.set('tab', state.tab);
    if (state.tab === 'initial') url.searchParams.set('initialKind', state.initialKind);
    if (state.tab === 'container') url.searchParams.set('containerKind', state.containerKind);
    if (state.tab === 'fees') url.searchParams.set('standardCategory', state.standardCategory);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
