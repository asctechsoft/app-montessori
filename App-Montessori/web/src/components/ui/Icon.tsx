import type { SVGProps } from 'react';

const PATHS = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  'check-circle': 'M21 12a9 9 0 11-18 0 9 9 0 0118 0zM8 12.5l3 3 5-6',
  alert: 'M12 9v4m0 3.5h.01M10.3 3.9L2.6 17.5A2 2 0 004.3 20.5h15.4a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  'alert-circle': 'M21 12a9 9 0 11-18 0 9 9 0 0118 0zM12 8v4.5M12 16h.01',
  info: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0zM12 11v5M12 8h.01',
  x: 'M6 6l12 12M18 6L6 18',
  'x-circle': 'M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9 9l6 6M15 9l-6 6',
  minus: 'M6 12h12',
  clock: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0zM12 7v5l3 2',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M6 15l6-6 6 6',
  'chevron-left': 'M15 6l-6 6 6 6',
  'chevron-right': 'M9 6l6 6-6 6',
  'arrow-up-down': 'M8 4v16m0 0l-3-3m3 3l3-3M16 20V4m0 0l-3 3m3-3l3 3',
  menu: 'M4 7h16M4 12h16M4 17h16',
  bell: 'M18 9a6 6 0 10-12 0c0 6-2.5 7.5-2.5 7.5h17S18 15 18 9zM10 20a2 2 0 004 0',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4.5 20a7.5 7.5 0 0115 0',
  logout: 'M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 8l-4 4 4 4M6 12h10',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 11a8 8 0 00-14.5-4M4 4v4h4M4 13a8 8 0 0014.5 4M20 20v-4h-4',
  building: 'M4 21V5a1 1 0 011-1h9a1 1 0 011 1v16M15 9h4a1 1 0 011 1v11M3 21h18M8 8h3M8 12h3M8 16h3',
  lock: 'M7 11V8a5 5 0 0110 0v3M6 11h12a1 1 0 011 1v8a1 1 0 01-1 1H6a1 1 0 01-1-1v-8a1 1 0 011-1z',
  inbox: 'M4 13l2-8h12l2 8M4 13v6a1 1 0 001 1h14a1 1 0 001-1v-6M4 13h5l1 2h4l1-2h5',
  filter: 'M4 5h16l-6 8v6l-4-2v-4L4 5z',
  mail: 'M4 6h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1zM3.5 7.5L12 13l8.5-5.5',
  shield: 'M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6l7-3z',
  construction: 'M4 20h16M6 20V10l6-6 6 6v10M10 20v-5h4v5',
  copy: 'M9 9h10a1 1 0 011 1v10a1 1 0 01-1 1H9a1 1 0 01-1-1V10a1 1 0 011-1zM5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  swap: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
} as const;

export type IconName = keyof typeof PATHS;

interface Props extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  /** Nhãn đọc màn hình; bỏ trống = trang trí (aria-hidden). */
  label?: string;
}

export function Icon({ name, size = 20, label, ...rest }: Props) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
