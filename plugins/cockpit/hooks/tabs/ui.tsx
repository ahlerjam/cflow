import type { Color, RenderChildren } from 'claude-code'

import { fit } from '../actions'
import { confirmThen } from '../core'
import { t } from '../i18n'
import type { Eng } from '../state'
import type { State } from '../sources'

export type Table = ReturnType<Eng['ui']['resolve']>

export type Option = { value: string; label: string }

export type PaneView = {
  pending: string
  bodyColumns: number
  rows: number | undefined
}

export function heading(table: Table, text: string) {
  const { Text } = table
  return (
    <Text bold color="claude">
      {text}
    </Text>
  )
}

export function choice(
  table: Table,
  key: string,
  title: string,
  value: string,
  options: ReadonlyArray<Option>,
  pick: (v: string) => void,
) {
  const { Box, Button, Text } = table
  const Select = 'Select' in table ? table.Select : undefined
  return Select ? (
    <Select key={key} label={title} value={value} options={options} onSelect={v => pick(v)} />
  ) : (
    <Box key={key} flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Text dimColor>{title}:</Text>
      {options.map(o => (
        <Button
          key={`${key}-${o.value}`}
          label={o.label}
          variant={o.value === value ? 'primary' : 'secondary'}
          onPress={() => pick(o.value)}
        />
      ))}
    </Box>
  )
}

export function switchBtn(table: Table, key: string, title: string, isOn: boolean, flip: () => void) {
  const { Button } = table
  return <Button key={key} label={`${isOn ? '●' : '○'} ${title}`} variant={isOn ? 'primary' : 'secondary'} onPress={flip} />
}

export function section(table: Table, key: string, title: string, color: Color, children: RenderChildren, extra?: RenderChildren) {
  const { Box, Text } = table
  return (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
      <Box flexDirection="row" columnGap={1}>
        <Text bold color={color}>
          {title}
        </Text>
        <Box flexGrow={1} />
        {extra}
      </Box>
      {children}
    </Box>
  )
}

export function settingRow(table: Table, key: string, title: string, labelW: number, width: number, control: RenderChildren) {
  const { Box, Text } = table
  return (
    <Box key={key} flexDirection="row" columnGap={1}>
      <Box width={labelW} flexShrink={0}>
        <Text>{title}</Text>
      </Box>
      <Box width={Math.max(10, width - labelW - 1)} flexShrink={0} flexDirection="row" flexWrap="wrap" columnGap={1}>
        {control}
      </Box>
    </Box>
  )
}

export function segmented(table: Table, key: string, value: string, options: ReadonlyArray<Option>, pick: (v: string) => void) {
  const { Button } = table
  return options.map(o => (
    <Button
      key={`${key}-${o.value}`}
      label={o.value === value ? `● ${o.label}` : o.label}
      variant={o.value === value ? 'primary' : 'secondary'}
      onPress={() => pick(o.value)}
    />
  ))
}

export type Pill = { id: string; icon: string; label: string; color: Color; badge?: string }
export function pills(table: Table, key: string, value: string, options: ReadonlyArray<Pill>, pick: (id: string) => void) {
  const { Box, Button, Text } = table
  return (
    <Box key={key} flexDirection="row" flexWrap="wrap" columnGap={1}>
      {options.map(o => {
        const isOn = o.id === value
        return (
          <Box key={`${key}-box-${o.id}`} flexDirection="row" columnGap={1} borderStyle="round" borderColor={isOn ? o.color : 'inactive'} borderDimColor={!isOn} paddingX={1}>
            <Text color={isOn ? o.color : undefined} dimColor={!isOn} bold={isOn}>{o.icon}</Text>
            <Button
              key={`${key}-${o.id}`}
              plain
              label={o.label}
              variant={isOn ? 'primary' : 'secondary'}
              dimColor={!isOn}
              hover={{ color: o.color }}
              onPress={() => pick(o.id)}
            />
            {o.badge && <Text color={o.color} dimColor={!isOn}>{o.badge}</Text>}
          </Box>
        )
      })}
    </Box>
  )
}

// Widths include the button brackets; an inherited state is dimmed.
// Stored as on/off/never; the labels follow the locale.
export const STATE_LABEL: Record<State, string> = {
  get on() { return t('state.on') },
  get off() { return t('state.off') },
  get never() { return t('state.never') },
}
// Wide enough for both locales: on/an, off/aus, never/nie
export const STATE_COLS = [6, 7, 9] as const
export const STATE_W = STATE_COLS[0] + STATE_COLS[1] + STATE_COLS[2] + 2
export function stateButtons(table: Table, key: string, value: State, isInherited: boolean, pick: (v: State) => void) {
  const { Box, Button } = table
  const options: ReadonlyArray<State> = ['on', 'off', 'never']
  return options.map((v, i) => (
    <Box key={`${key}-col${i}`} width={STATE_COLS[i] ?? 7} flexShrink={0}>
      <Button key={`${key}-${v}`} label={STATE_LABEL[v]} variant={v === value ? 'primary' : 'secondary'} dimColor={isInherited && v === value} onPress={() => pick(v)} />
    </Box>
  ))
}

export function onOff(table: Table, key: string, isOn: boolean, flip: () => void) {
  return segmented(table, key, isOn ? 'on' : 'off', [{ value: 'on', label: STATE_LABEL.on }, { value: 'off', label: STATE_LABEL.off }], v => {
    if ((v === 'on') !== isOn) flip()
  })
}

export function textField(table: Table, key: string, title: string, value: string, placeholder: string, submit: (v: string) => void) {
  const { Text } = table
  const Input = 'Input' in table ? table.Input : undefined
  return Input ? (
    <Input key={key} label={title} value={value} placeholder={placeholder} submitLabel={t('common.save')} onSubmit={v => submit(v)} />
  ) : (
    <Text key={key} dimColor>
      {title}: {value || '–'}
    </Text>
  )
}

export function dangerBtn($: Eng, table: Table, pending: string, key: string, title: string, run: () => void) {
  const { Button } = table
  return (
    <Button
      key={key}
      label={pending === key ? t('common.confirm', { title }) : title}
      variant={pending === key ? 'primary' : 'secondary'}
      onPress={() => void confirmThen($, key, run)}
    />
  )
}

export type CardTitle = { icon?: string; tone?: Color; text: string; badge?: string }

// Card for detail views (runner, run, log, issue):
//   ┌ ✗ Title ─────────── Badge
//   │ Field   Value       Field   Value
//   │ "Subtitle"
//   └──────────────────────────────
export function card(
  table: Table,
  key: string,
  width: number,
  title: CardTitle,
  fields: ReadonlyArray<readonly [string, string]>,
  quote?: string,
  rows: readonly RenderChildren[] = [],
) {
  const { Box, Text } = table
  const W = Math.max(30, width)
  const half = Math.floor((W - 2) / 2)
  const labelW = 7
  const pairs: Array<ReadonlyArray<readonly [string, string]>> = []
  for (let i = 0; i < fields.length; i += 2) pairs.push(fields.slice(i, i + 2))
  const head = (title.icon ? title.icon.length + 1 : 0) + Math.min(title.text.length, W - 12) + 3 + (title.badge ? title.badge.length + 1 : 0)
  return (
    <Box key={key} flexDirection="column">
      <Box flexDirection="row">
        <Text dimColor>┌ </Text>
        {title.icon && <Text color={title.tone}>{title.icon} </Text>}
        <Text bold>{fit(title.text, Math.min(title.text.length, W - 12))}</Text>
        <Text dimColor> {'─'.repeat(Math.max(1, W - head))}</Text>
        {title.badge && <Text color="warning"> {title.badge}</Text>}
      </Box>
      {pairs.map((pair, i) => (
        <Box key={`${key}-r${i}`} flexDirection="row">
          <Text dimColor>│ </Text>
          {pair.map(([label, value], j) => (
            <Box key={`${key}-f${i}-${j}`} flexDirection="row">
              <Text dimColor>{fit(label, labelW)} </Text>
              <Text>{fit(value, half - labelW - 2)} </Text>
            </Box>
          ))}
        </Box>
      ))}
      {quote && (
        <Box flexDirection="row">
          <Text dimColor>│ </Text>
          <Text italic>{t('common.quote', { text: fit(quote, W - 6).trimEnd() })}</Text>
        </Box>
      )}
      {rows.map((row, i) => (
        <Box key={`${key}-x${i}`} flexDirection="row">
          <Text dimColor>│ </Text>
          {row}
        </Box>
      ))}
      <Text dimColor>└{'─'.repeat(W - 1)}</Text>
    </Box>
  )
}
