import { mock } from 'bun:test'
import * as vscodeMock from './vscode-mock.ts'

export interface InstalledMock {
  reset: () => void
  state: typeof vscodeMock.__state
}

export const installVSCodeMock = (): InstalledMock => {
  void mock.module('vscode', () => vscodeMock)
  return {
    reset: (): void => {
      vscodeMock.__state.reset()
    },
    state: vscodeMock.__state,
  }
}
