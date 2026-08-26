import { useState } from 'react'
import type { Translate } from './contracts.js'
import { DropdownMenu, type DropdownMenuOption } from './dropdown-menu.js'
import {
  readSortDefault,
  writeSortDefault,
  type AutomationSortDirection,
  type AutomationSortKey,
  type SortPreferenceStorage,
} from './helpers.js'

const SORT_OPTIONS: readonly (readonly [AutomationSortKey, AutomationSortDirection])[] = [
  ['created', 'desc'],
  ['created', 'asc'],
  ['planned', 'asc'],
  ['planned', 'desc'],
]

/** 工作区自动化列表的排序菜单；当前选中行可一键保存为默认排序。 */
export function SortMenu({
  t,
  storage,
  storageKey,
  sortKey,
  sortDirection,
  onSelect,
}: {
  readonly t: Translate
  readonly storage?: SortPreferenceStorage
  readonly storageKey: string
  readonly sortKey: AutomationSortKey
  readonly sortDirection: AutomationSortDirection
  readonly onSelect: (key: AutomationSortKey, direction: AutomationSortDirection) => void
}): JSX.Element {
  const [saved, setSaved] = useState(() => readSortDefault(storage, storageKey))
  const options: DropdownMenuOption[] = SORT_OPTIONS.map(([key, direction]) => {
    const selected = sortKey === key && sortDirection === direction
    const isDefault = saved?.key === key && saved.direction === direction
    return {
      key: `${key}-${direction}`,
      label: t(key === 'planned' ? `sort.planned.${direction}` : `sort.created.${direction}`),
      selected,
      keepOpen: true,
      onSelect: () => onSelect(key, direction),
      ...(selected && storage !== undefined ? {
        trailing: {
          label: t('sort.default.saved'),
          active: isDefault,
          onSelect: () => {
            writeSortDefault(storage, storageKey, key, direction)
            setSaved({ key, direction })
          },
        },
      } : {}),
    }
  })
  return (
    <DropdownMenu
      ariaLabel={t('sort.by')}
      menuClassName="dsh-automation-dropdown-sort"
      options={options}
    />
  )
}
