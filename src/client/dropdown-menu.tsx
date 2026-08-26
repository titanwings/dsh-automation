import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { CheckIcon, ChevronIcon } from './icons.js'

export interface DropdownMenuOption {
  readonly key: string
  readonly label: string
  readonly selected: boolean
  readonly onSelect: () => void
  readonly keepOpen?: boolean
  readonly trailing?: {
    readonly label: string
    readonly active: boolean
    readonly onSelect: () => void
  }
}

/** 工作区自动化视图的紧凑下拉菜单：显示当前选中项，支持点击外部与 Escape 关闭。 */
export function DropdownMenu({
  ariaLabel,
  className,
  menuClassName,
  options,
}: {
  readonly ariaLabel: string
  readonly className?: string
  readonly menuClassName?: string
  readonly options: readonly DropdownMenuOption[]
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const selectedLabel = options.find(option => option.selected)?.label ?? options[0]?.label ?? ariaLabel
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent): void => {
      if (root.current !== null && root.current.contains(event.target as Node)) return
      if (menuRef.current?.contains(event.target as Node) === true) return
      setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])
  useLayoutEffect(() => {
    if (!open) return
    const update = (): void => {
      const button = root.current?.querySelector('.dsh-automation-dropdown-btn')
      const rect = button?.getBoundingClientRect()
      if (rect === undefined) return
      const height = menuRef.current?.offsetHeight ?? 220
      const margin = 8
      let top = rect.bottom + 6
      if (top + height > window.innerHeight - margin) top = Math.max(margin, rect.top - height - 6)
      const right = Math.max(margin, window.innerWidth - rect.right)
      setMenuStyle(current => current.top === top && current.right === right ? current : { position: 'fixed', top, right })
    }
    const onScroll = (event: Event): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      update()
    }
    update()
    window.addEventListener('resize', update)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', update)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [open, selectedLabel])

  const menu = open && typeof document !== 'undefined'
    ? (
      <div ref={menuRef} className={`dsh-automation-dropdown-menu is-float${menuClassName === undefined ? '' : ` ${menuClassName}`}`} style={menuStyle}>
        {options.map(option => (
          <DropdownRow
            key={option.key}
            label={option.label}
            selected={option.selected}
            trailing={option.trailing}
            onSelect={() => {
              if (option.keepOpen !== true) setOpen(false)
              option.onSelect()
            }}
          />
        ))}
      </div>
    )
    : null
  return (
    <div className={`dsh-automation-dropdown${className === undefined ? '' : ` ${className}`}`} ref={root}>
      <button type="button" className={`dsh-automation-dropdown-btn${open ? ' is-open' : ''}`} aria-label={ariaLabel} aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span className="dsh-automation-dropdown-label">{selectedLabel}</span>
        <ChevronIcon width={10} height={10} className="dsh-automation-dropdown-chevron" />
      </button>
      {menu}
    </div>
  )
}

function DropdownRow({
  label,
  selected,
  trailing,
  onSelect,
}: {
  readonly label: string
  readonly selected: boolean
  readonly trailing?: DropdownMenuOption['trailing']
  readonly onSelect: () => void
}): JSX.Element {
  return (
    <div
      className={`dsh-automation-dropdown-row${selected ? ' is-selected' : ''}${trailing === undefined ? '' : ' has-trailing'}`}
      role="menuitemradio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      <span className="dsh-automation-dropdown-label-cell">{label}</span>
      {trailing !== undefined && (
        <button
          type="button"
          className={`dsh-automation-dropdown-default${trailing.active ? ' is-on' : ''}`}
          disabled={trailing.active}
          onClick={(event) => {
            event.stopPropagation()
            trailing.onSelect()
          }}
        >{trailing.label}</button>
      )}
      <span className="dsh-automation-dropdown-spacer" />
      <span className="dsh-automation-dropdown-check">
        {selected ? <CheckIcon width={16} height={16} /> : <span className="dsh-automation-sort-tick" />}
      </span>
    </div>
  )
}
