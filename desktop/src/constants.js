/** @section constants */
export const ID = 'workstreamer'

/** Match Hermes files-browser rail sizing to avoid sash snap-glitch. */
export const PANE_WIDTH = '237px'
export const PANE_MIN_WIDTH = '10rem'
export const PANE_MAX_WIDTH = '20rem'

export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'issues', label: 'Issues' },
  { id: 'adopted', label: 'Adopted' },
  { id: 'bare', label: 'Bare' },
]

export const STORAGE_KEYS = {
  filter: 'map.filter',
  selected: 'map.selected',
}
