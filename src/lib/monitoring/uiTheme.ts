export type MonitoringUiTheme = 'dark' | 'light';

export const MONITORING_UI_THEME_KEY = 'nusagis-monitoring-ui-theme';

export function loadMonitoringUiTheme(): MonitoringUiTheme {
  if (typeof window === 'undefined') return 'dark';
  try {
    const v = localStorage.getItem(MONITORING_UI_THEME_KEY);
    return v === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function saveMonitoringUiTheme(theme: MonitoringUiTheme): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(MONITORING_UI_THEME_KEY, theme);
  } catch {
    // ignore quota / private mode
  }
}