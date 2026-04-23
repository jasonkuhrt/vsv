import { expect, test } from 'bun:test'
import { VERSION } from './index.ts'

test('VERSION is exported', () => {
  expect(VERSION).toBe('0.0.0')
})
