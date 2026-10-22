import { DEFAULT_SETTINGS } from './sources'
import type { CockpitConfig } from './sources'

// Neutral starter config: everything on, no hints, detours or startup texts.
// Written to ~/.claude/cockpit/cockpit.json by the first interactive session.
export const DEFAULT_CONFIG: CockpitConfig = {
  version: 3,
  settings: DEFAULT_SETTINGS,
  states: {},
  folders: {},
  hints: {},
  redirects: [],
  startupMarkers: {},
}
