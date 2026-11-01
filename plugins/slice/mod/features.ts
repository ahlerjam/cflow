export type Feature = { id: string; title: string; steps: string[]; passes: boolean; ui?: boolean; issue?: number }
export type FeatureList = { features: Feature[] }

export const FEATURES_PATH = '.slice/features.json'

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

function parseFeature(raw: unknown, i: number): Feature | string {
  const at = `features[${i}]`
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return `${at} is not an object`
  const f = raw as Record<string, unknown>
  if (!isText(f.id)) return `${at}.id must be a non-empty string`
  if (!isText(f.title)) return `${at} (${f.id}): title must be a non-empty string`
  if (!Array.isArray(f.steps) || f.steps.length === 0 || !f.steps.every(isText)) {
    return `${at} (${f.id}): steps must be a non-empty array of non-empty strings`
  }
  if (typeof f.passes !== 'boolean') return `${at} (${f.id}): passes must be true or false`
  if (f.ui !== undefined && typeof f.ui !== 'boolean') return `${at} (${f.id}): ui must be a boolean`
  if (f.issue !== undefined && !(Number.isInteger(f.issue) && (f.issue as number) > 0)) {
    return `${at} (${f.id}): issue must be a positive integer`
  }
  return raw as Feature
}

export function parseFeatures(text: string): FeatureList | string {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return `${FEATURES_PATH} is not valid JSON` }
  const list = (raw as { features?: unknown } | null)?.features
  if (!Array.isArray(list) || list.length === 0) return `${FEATURES_PATH} needs a non-empty "features" array`
  const features: Feature[] = []
  for (const [i, item] of list.entries()) {
    const f = parseFeature(item, i)
    if (typeof f === 'string') return f
    if (features.some(x => x.id === f.id)) return `duplicate feature id "${f.id}"`
    features.push(f)
  }
  return { features }
}

// Compares everything except `passes`; either side invalid counts as changed
export function onlyPassesChanged(baseText: string, nowText: string): boolean {
  const [base, now] = [parseFeatures(baseText), parseFeatures(nowText)]
  if (typeof base === 'string' || typeof now === 'string') return false
  const strip = (l: FeatureList) => JSON.stringify(l.features.map(({ passes: _, ...rest }) => rest))
  return strip(base) === strip(now)
}

export function goalText({ maxTurns }: { maxTurns?: number } = {}): string {
  const turns = maxTurns ? ` You have at most ${maxTurns} turns; spend them on the features, not on polish.` : ''
  return [
    `/goal Done means: every feature in ${FEATURES_PATH} has passes true, and your final turns contain a full`,
    'E2E pass of every feature\'s steps, run with the verify skill against the running app, with the evidence',
    'shown in the conversation after the last code change.',
    'Follow the run routine of the slice skill (section "In a run session").',
    'Order per feature: build, verify with evidence, then set passes and commit.',
    `Never change anything in ${FEATURES_PATH} except passes.${turns}`,
  ].join(' ')
}
