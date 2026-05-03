// Typed error channels for the Effect-native vsv runtime.
//
// Each error class is a `Data.TaggedError` — a discriminated tagged class
// suitable for `Effect.catchTag` / `Effect.catchTags` / `Match.tag`. The
// discrimination strategy:
//
//   1. **High-signal failure modes get distinct tags.** `FileNotFoundError`
//      and `UnsupportedSchemeError` are split out because consumers
//      routinely branch on them (existence check, programmer-error guard).
//   2. **Generic per-surface failures collapse to a catch-all.** `FsError`,
//      `WorkspaceEditError`, `DocumentOpenError`, etc. each absorb the
//      remaining failure modes with a `cause: unknown` field carrying the
//      original VSCode/Node error for diagnostics.
//
// Avoiding error-class proliferation: the runtime exposes ~9 surfaces; one
// catch-all error per surface plus 2 high-signal splits is the right
// granularity. Consumers that need finer-grained behavior can match on
// `cause` (e.g. `vscode.FileSystemError.code` or a `NodeJS.ErrnoException.code`).

import { Data } from 'effect'
import type * as vscode from 'vscode'

// ─────────────────────────────────────────────────────────────────────────────
// Filesystem
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A filesystem operation targeted a path that does not exist. Distinguished
 * from `FsError` because existence checks are the most common branch pattern
 * — consumers reach for `Effect.catchTag('FileNotFoundError', ...)` more often
 * than any other fs failure mode.
 *
 * Raised by: `rt.fs.readDirectory`, `rt.fs.stat`, `rt.fs.realpath` when the
 * underlying VSCode `FileSystemError` has `code === 'FileNotFound'` or the
 * Node `ErrnoException` has `code === 'ENOENT'`.
 */
export class FileNotFoundError extends Data.TaggedError('FileNotFoundError')<{
  readonly uri: vscode.Uri
  readonly operation: 'readDirectory' | 'stat' | 'realpath'
  readonly cause: unknown
}> {}

/**
 * A filesystem operation that requires a `file://` URI received a different
 * scheme. Currently raised only by `rt.fs.realpath`, which has no portable
 * implementation across virtual/remote filesystems and refuses non-file URIs
 * rather than silently misbehaving.
 *
 * This is a programmer error in practice — the consumer is calling a local-
 * only operation against a remote URI. Treating it as a typed error rather
 * than a panic lets test suites assert on it.
 */
export class UnsupportedSchemeError extends Data.TaggedError('UnsupportedSchemeError')<{
  readonly uri: vscode.Uri
  readonly operation: 'realpath'
  readonly expectedScheme: 'file'
}> {}

/**
 * Catch-all for filesystem errors that aren't `FileNotFoundError` or
 * `UnsupportedSchemeError` — permission denied, broken symlinks, IO errors,
 * not-a-directory, etc. The original error lives on `cause` (typically a
 * `vscode.FileSystemError` or a `NodeJS.ErrnoException`).
 */
export class FsError extends Data.TaggedError('FsError')<{
  readonly uri: vscode.Uri
  readonly operation: 'readDirectory' | 'stat' | 'realpath'
  readonly cause: unknown
}> {}

// ─────────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A command invoked through `rt.executeCommand`, `rt.executeExternalCommand`,
 * or `rt.executeCommandRaw` rejected at the VSCode boundary. Either the
 * command is unregistered (no handler), the handler threw, or the handler
 * returned a rejected Promise.
 *
 * No further split (e.g. `CommandNotFoundError`) — VSCode's
 * `commands.executeCommand` doesn't distinguish "no such command" from
 * "command threw" at the API boundary; both surface as a rejected Promise.
 * Consumers that care can inspect `cause`.
 */
export class CommandExecutionError extends Data.TaggedError('CommandExecutionError')<{
  readonly id: string
  readonly cause: unknown
}> {}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `rt.workspace.openTextDocument` failed to load the target — invalid URI
 * scheme without a registered file system provider, missing file, etc.
 */
export class DocumentOpenError extends Data.TaggedError('DocumentOpenError')<{
  readonly target: vscode.Uri | string
  readonly cause: unknown
}> {}

/**
 * `rt.workspace.applyEdit` itself rejected. **Note:** an edit that gets
 * accepted but rolled back (e.g. due to overlapping ranges or stale buffer
 * state) flows through the **success** channel as `Effect<boolean, ...>` with
 * `false`. This error is reserved for the API call throwing — malformed
 * edits, unsupported document types, etc.
 */
export class WorkspaceEditError extends Data.TaggedError('WorkspaceEditError')<{
  readonly cause: unknown
}> {}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `rt.defineConfig(...).update(...)` or `rt.defineForeignConfig(...).update(...)`
 * failed at the VSCode boundary. The most common cause: writing to a target
 * that doesn't exist (e.g. `WorkspaceFolder` outside a multi-root workspace).
 */
export class ConfigUpdateError extends Data.TaggedError('ConfigUpdateError')<{
  readonly key: string
  readonly target: vscode.ConfigurationTarget
  readonly cause: unknown
}> {}

// ─────────────────────────────────────────────────────────────────────────────
// State (memento)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `rt.defineState(...).set(...)` or `.delete(...)` failed at the memento
 * boundary. Memento writes are JSON-serialized; the most common cause is a
 * non-serializable value (function, circular reference).
 */
export class StateUpdateError extends Data.TaggedError('StateUpdateError')<{
  readonly key: string
  readonly operation: 'set' | 'delete'
  readonly cause: unknown
}> {}

// ─────────────────────────────────────────────────────────────────────────────
// Clipboard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `rt.clipboard.readText()` or `.writeText(...)` failed at the OS clipboard
 * boundary. Realistic on remote development connections where the clipboard
 * IPC can fail.
 */
export class ClipboardError extends Data.TaggedError('ClipboardError')<{
  readonly operation: 'readText' | 'writeText'
  readonly cause: unknown
}> {}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate union types — convenience for consumers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Union of every error type the runtime may raise across all surfaces. Useful
 * when a function spans multiple surfaces and the caller wants a single
 * widened channel.
 */
export type RuntimeError =
  | FileNotFoundError
  | UnsupportedSchemeError
  | FsError
  | CommandExecutionError
  | DocumentOpenError
  | WorkspaceEditError
  | ConfigUpdateError
  | StateUpdateError
  | ClipboardError
