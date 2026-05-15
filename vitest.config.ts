import { defineConfig } from 'vitest/config'

// vsv runs runtime tests on `bun test`; vitest is here ONLY for type-level
// tests (`*.test-d.ts`). `typecheck.only` keeps vitest from touching the
// runtime suite. The checker is `tsgo` (`@typescript/native-preview`) — the
// repo's TypeScript toolchain; `tsc` is banned.
export default defineConfig({
  test: {
    typecheck: {
      only: true,
      include: ['src/**/*.test-d.ts'],
      tsconfig: './tsconfig.json',
      checker: 'tsgo',
    },
  },
})
