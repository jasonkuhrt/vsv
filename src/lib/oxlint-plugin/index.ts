import { noUnregisteredCommand } from './rules/no-unregistered-command.ts'
import { noUnregisteredContextKey } from './rules/no-unregistered-context-key.ts'

export const plugin = {
  meta: {
    name: '@jasonkuhrt/vsv',
    version: '0.0.0',
  },
  rules: {
    'no-unregistered-command': noUnregisteredCommand,
    'no-unregistered-context-key': noUnregisteredContextKey,
  },
} as const

export { noUnregisteredCommand, noUnregisteredContextKey }
