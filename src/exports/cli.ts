#!/usr/bin/env bun
import { runCli } from '#lib/cli/main'

const exitCode = await runCli(process.argv.slice(2))
process.exit(exitCode)
