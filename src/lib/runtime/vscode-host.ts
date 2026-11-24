import { Context, Schema } from 'effect';
import type { Effect } from 'effect';
import type * as vscode from 'vscode';

export class VSCodeHostError extends Schema.TaggedError<VSCodeHostError, {}>()(
  'VSCodeHostError',
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export type HostEffect<A> = Effect.Effect<A, VSCodeHostError>;

type EffectOperations<Surface> = {
  [Key in keyof Surface]: Surface[Key] extends (
    ...args: infer Args
  ) => Thenable<infer Result>
    ? (...args: Args) => HostEffect<Result>
    : Surface[Key];
};

interface WorkspaceConfiguration {
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  update(
    key: string,
    value: unknown,
    target: vscode.ConfigurationTarget,
  ): HostEffect<void>;
  inspect<T>(key: string):
    | {
        readonly key: string;
        readonly defaultValue?: T;
        readonly globalValue?: T;
        readonly workspaceValue?: T;
        readonly workspaceFolderValue?: T;
      }
    | undefined;
}

interface VSCodeWorkspace extends Pick<
  typeof vscode.workspace,
  | 'onDidChangeConfiguration'
  | 'workspaceFolders'
  | 'onDidChangeWorkspaceFolders'
  | 'onDidChangeTextDocument'
  | 'updateWorkspaceFolders'
> {
  readonly applyEdit: (edit: vscode.WorkspaceEdit) => HostEffect<boolean>;
  readonly getConfiguration: (section?: string) => WorkspaceConfiguration;
  readonly openTextDocument: (
    target: string | vscode.Uri,
  ) => HostEffect<vscode.TextDocument>;
  readonly fs: EffectOperations<
    Pick<
      vscode.FileSystem,
      'stat' | 'readFile' | 'writeFile' | 'createDirectory' | 'rename'
    >
  > & {
    readonly readDirectory: (
      uri: vscode.Uri,
    ) => HostEffect<ReadonlyArray<[string, vscode.FileType]>>;
  };
}

interface VSCodeWindow extends Pick<typeof vscode.window, 'activeTextEditor'> {
  readonly showInputBox: (
    options?: vscode.InputBoxOptions,
  ) => HostEffect<string | undefined>;
  readonly showQuickPick: (
    items: ReadonlyArray<vscode.QuickPickItem>,
    options?: vscode.QuickPickOptions,
  ) => HostEffect<vscode.QuickPickItem | undefined>;
  readonly showInformationMessage: (
    message: string,
    ...actions: Array<string>
  ) => HostEffect<string | undefined>;
  readonly showWarningMessage: (
    message: string,
    ...actions: Array<string>
  ) => HostEffect<string | undefined>;
  readonly showErrorMessage: (
    message: string,
    ...actions: Array<string>
  ) => HostEffect<string | undefined>;
  readonly setStatusBarMessage: (
    text: string,
    timeout: number,
  ) => vscode.Disposable;
  readonly showOpenDialog: (
    options?: vscode.OpenDialogOptions,
  ) => HostEffect<ReadonlyArray<vscode.Uri> | undefined>;
  readonly tabGroups: {
    readonly all: ReadonlyArray<vscode.TabGroup>;
    readonly close: (
      tabs: vscode.Tab | Array<vscode.Tab>,
    ) => HostEffect<boolean>;
  };
}

export interface VSCodeHostApi {
  readonly commands: Pick<typeof vscode.commands, 'registerCommand'> & {
    readonly executeCommand: <A = unknown>(
      id: string,
      ...args: Array<unknown>
    ) => HostEffect<A>;
  };
  readonly workspace: VSCodeWorkspace;
  readonly window: VSCodeWindow;
  readonly env: { readonly clipboard: EffectOperations<vscode.Clipboard> };
  readonly Uri: Pick<typeof vscode.Uri, 'file'>;
  readonly ConfigurationTarget: Pick<
    typeof vscode.ConfigurationTarget,
    'Workspace'
  >;
  readonly EventEmitter: typeof vscode.EventEmitter;
  readonly Disposable: Pick<typeof vscode.Disposable, 'from'>;
}

export class VSCodeHost extends Context.Service<VSCodeHost, VSCodeHostApi>()(
  '@jasonkuhrt/vsv/lib/runtime/vscode-host/VSCodeHost',
) {}
