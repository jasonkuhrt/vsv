// Side-effect-only module: registers the vscode mock via bun:test's
// mock.module() at preload time. Consumers add this path to their
// bunfig.toml [test] preload array so the mock is installed before any
// static import of 'vscode' resolves.
import '#lib/runtime-test/install-mock'
