import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function IconFrame({ children, ...props }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  )
}

export function AutomationIcon(props: IconProps): JSX.Element {
  return <IconFrame {...props}><circle cx="12" cy="12" r="8.25" /><path d="M12 7.7v4.7l3.15 1.85" /><path d="M5.6 4.9 4.2 6.3M18.4 4.9l1.4 1.4" /></IconFrame>
}

export function PlusIcon(props: IconProps): JSX.Element {
  return <IconFrame {...props}><path d="M12 5v14M5 12h14" /></IconFrame>
}

export function RefreshIcon(props: IconProps): JSX.Element {
  return <IconFrame {...props}><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></IconFrame>
}

export function PlayIcon(props: IconProps): JSX.Element {
  return <IconFrame {...props}><path d="m9 7 8 5-8 5V7Z" /></IconFrame>
}

export function PauseIcon(props: IconProps): JSX.Element {
  return <IconFrame {...props}><path d="M9 7v10M15 7v10" /></IconFrame>
}

export function TrashIcon(props: IconProps): JSX.Element {
  return <IconFrame {...props}><path d="M5.5 7.5h13M9 7.5V5.7h6v1.8M8 10.5l.5 7h7l.5-7" /></IconFrame>
}

export function PencilIcon(props: IconProps): JSX.Element {
  return <IconFrame {...props}><path d="m5 16.5-.7 3.2 3.2-.7L18 8.5 15.5 6 5 16.5Z" /><path d="m13.8 7.7 2.5 2.5" /></IconFrame>
}

export function ShieldIcon(props: IconProps): JSX.Element {
  return <IconFrame {...props}><path d="M12 3.8 19 6v5.1c0 4.3-2.6 7.4-7 9.1-4.4-1.7-7-4.8-7-9.1V6l7-2.2Z" /><path d="m9.4 12 1.7 1.7 3.7-4" /></IconFrame>
}

export function CalendarIcon(props: IconProps): JSX.Element {
  return <IconFrame {...props}><rect x="4" y="5.5" width="16" height="14" rx="2" /><path d="M8 3.8v3.4M16 3.8v3.4M4 9.5h16" /></IconFrame>
}

export function CheckIcon(props: IconProps): JSX.Element {
  return <IconFrame {...props}><path d="m5.5 12.5 4 4 9-9" /></IconFrame>
}

export function AlertIcon(props: IconProps): JSX.Element {
  return <IconFrame {...props}><path d="M12 4.2 21 19H3L12 4.2Z" /><path d="M12 9v4.5M12 16.5h.01" /></IconFrame>
}

export function ChevronIcon(props: IconProps): JSX.Element {
  return <IconFrame {...props}><path d="m8.5 10 3.5 3.5 3.5-3.5" /></IconFrame>
}

export function ArchiveIcon(props: IconProps): JSX.Element {
  return <IconFrame {...props}><rect x="4" y="4.2" width="16" height="4.8" rx="1" /><path d="M6.2 9v9.6h11.6V9M9.8 12.6h4.4" /></IconFrame>
}

export function GlobeIcon(props: IconProps): JSX.Element {
  return <IconFrame {...props}><circle cx="12" cy="12" r="8.25" /><path d="M3.75 12h16.5" /><path d="M12 3.75c2.6 2.55 3.9 5.55 3.9 8.25s-1.3 5.7-3.9 8.25c-2.6-2.55-3.9-5.55-3.9-8.25S9.4 6.3 12 3.75Z" /></IconFrame>
}

export function GearIcon(props: IconProps): JSX.Element {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </IconFrame>
  )
}
