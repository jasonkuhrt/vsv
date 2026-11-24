import { Effect } from 'effect';
import { drift } from './drift.ts';
import { lint } from './lint.ts';
import { test } from './test.ts';
import { typecheck } from './typecheck.ts';

export const check = Effect.fnUntraced(function* () {
  for (const command of [lint, typecheck, test]) {
    const code = yield* command();
    if (code !== 0) return code;
  }
  return yield* drift();
});
