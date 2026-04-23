import { lint } from './lint.ts'
import { test } from './test.ts'
import { typecheck } from './typecheck.ts'

export const check = async (): Promise<number> => {
  const lintCode = await lint()
  if (lintCode !== 0) return lintCode
  const typecheckCode = await typecheck()
  if (typecheckCode !== 0) return typecheckCode
  return test()
}
