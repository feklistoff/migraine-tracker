import type { ReactElement, SVGProps } from 'react'

export type IconName = 'back' | 'check' | 'history' | 'plus' | 'settings' | 'statistics' | 'today' | 'chevron-right'

const paths: Record<IconName, ReactElement> = {
  back: <path d="m15 6-6 6 6 6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  history: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  statistics: <path d="M5 20v-8M12 20V5M19 20v-5" />,
  today: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </>
  ),
  'chevron-right': <path d="m9 6 6 6-6 6" />,
}

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  name: IconName
  label?: string
  size?: number
}

export function Icon({ name, label, size = 22, ...props }: IconProps) {
  return (
    <svg
      {...props}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={`icon ${props.className ?? ''}`.trim()}
      fill="none"
      focusable="false"
      height={size}
      role={label ? 'img' : undefined}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name]}
    </svg>
  )
}
