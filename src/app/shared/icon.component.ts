import { Component, Input } from '@angular/core';

export type IconName =
  | 'dashboard' | 'truck' | 'map' | 'send' | 'inbox' | 'logout' | 'chevron-right'
  | 'check' | 'alert' | 'x' | 'refresh' | 'search' | 'plus' | 'eye' | 'copy'
  | 'expand' | 'collapse' | 'building' | 'users' | 'box' | 'package' | 'route'
  | 'sun' | 'moon' | 'monitor' | 'bell' | 'globe' | 'link' | 'chart';

const PATHS: Record<IconName, string> = {
  dashboard: 'M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z',
  truck: 'M3 4h11v10H3zM14 8h4l3 3v3h-7zM7 18a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM17 18a2 2 0 1 1 0-4 2 2 0 0 1 0 4z',
  map: 'M9 4 3 7v13l6-3 6 3 6-3V4l-6 3-6-3zM9 4v13M15 7v13',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  'chevron-right': 'M9 18l6-6-6-6',
  check: 'M20 6 9 17l-5-5',
  alert: 'M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
  x: 'M18 6 6 18M6 6l12 12',
  refresh: 'M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM21 21l-4.35-4.35',
  plus: 'M12 5v14M5 12h14',
  eye: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  copy: 'M9 9h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  expand: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
  collapse: 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7',
  building: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h6M9 13h6M9 17h6',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  box: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96 12 12.01l8.73-5.05M12 22.08V12',
  package: 'M16.5 9.4 7.55 4.24M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96 12 12.01l8.73-5.05M12 22.08V12',
  route: 'M6 19a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM18 5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM12 19h4a2 2 0 0 0 0-4h-8a2 2 0 0 1 0-4h4',
  sun: 'M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  chart: 'M3 3v18h18M8 17V9M13 17V5M18 17v-7',
};

@Component({
  selector: 'app-icon',
  standalone: true,
  template: `<svg xmlns="http://www.w3.org/2000/svg" [attr.width]="size" [attr.height]="size"
    viewBox="0 0 24 24" fill="none" stroke="currentColor" [attr.stroke-width]="strokeWidth"
    stroke-linecap="round" stroke-linejoin="round">
    <path [attr.d]="path"></path>
  </svg>`,
})
export class IconComponent {
  @Input({ required: true }) name!: IconName;
  @Input() size = 18;
  @Input() strokeWidth = 1.75;
  get path() { return PATHS[this.name] || ''; }
}
