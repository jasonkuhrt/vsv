import { Layer } from 'effect';
import { VSCodeHost } from '../runtime/vscode-host.ts';
import { registerMatchers } from './matchers.ts';
import * as vscodeMock from './vscode-mock.ts';

export class InstalledMock {
  readonly reset = vscodeMock.__state.reset;
  readonly state: typeof vscodeMock.__state = vscodeMock.__state;
  readonly layer = Layer.succeed(VSCodeHost, vscodeMock);
}

export const installVSCodeMock = (): InstalledMock => {
  registerMatchers();
  return new InstalledMock();
};
