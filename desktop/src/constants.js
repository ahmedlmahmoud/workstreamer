/** @section constants */
export const ID = 'workstreamer'

export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'issues', label: 'Issues' },
  { id: 'adopted', label: 'Adopted' },
  { id: 'bare', label: 'Bare' },
]

export const STORAGE_KEYS = {
  filter: 'map.filter',
  selected: 'map.selected',
  pinned: 'chip.pinned',
}
