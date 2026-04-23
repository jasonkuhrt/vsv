export { createTestExtensionContext } from '#lib/runtime-test/create-context'
export type { TestExtensionContext } from '#lib/runtime-test/create-context'
export { installVSCodeMock } from '#lib/runtime-test/install-mock'
export type { InstalledMock } from '#lib/runtime-test/install-mock'
export { spyOnCommands, withContextKeys } from '#lib/runtime-test/spies'
export type { CommandSpy } from '#lib/runtime-test/spies'

import '#lib/runtime-test/matchers'
