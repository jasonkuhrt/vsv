import { Effect, Layer } from 'effect';
import * as vscode from 'vscode';
import { VSCodeHost, VSCodeHostError } from './vscode-host.ts';

const hostCall = <A>(operation: string, run: () => Thenable<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => VSCodeHostError.make({ operation, cause }),
  });

export const VSCodeLive = Layer.succeed(VSCodeHost, {
  Uri: vscode.Uri,
  ConfigurationTarget: vscode.ConfigurationTarget,
  EventEmitter: vscode.EventEmitter,
  Disposable: vscode.Disposable,
  commands: {
    registerCommand: vscode.commands.registerCommand.bind(vscode.commands),
    executeCommand: <A>(id: string, ...args: Array<unknown>) =>
      hostCall(id, () => vscode.commands.executeCommand<A>(id, ...args)),
  },
  workspace: {
    get workspaceFolders() {
      return vscode.workspace.workspaceFolders;
    },
    getConfiguration: (section) => {
      const config = vscode.workspace.getConfiguration(section);
      return {
        get: config.get.bind(config),
        inspect: config.inspect.bind(config),
        update: (key, value, target) =>
          hostCall('updateConfiguration', () =>
            config.update(key, value, target),
          ),
      };
    },
    onDidChangeConfiguration: vscode.workspace.onDidChangeConfiguration,
    onDidChangeWorkspaceFolders: vscode.workspace.onDidChangeWorkspaceFolders,
    onDidChangeTextDocument: vscode.workspace.onDidChangeTextDocument,
    updateWorkspaceFolders: vscode.workspace.updateWorkspaceFolders,
    openTextDocument: (target) =>
      hostCall('openTextDocument', () =>
        typeof target === 'string'
          ? vscode.workspace.openTextDocument(target)
          : vscode.workspace.openTextDocument(target),
      ),
    applyEdit: (edit) =>
      hostCall('applyEdit', () => vscode.workspace.applyEdit(edit)),
    fs: {
      readDirectory: (uri) =>
        hostCall('readDirectory', () => vscode.workspace.fs.readDirectory(uri)),
      stat: (uri) => hostCall('stat', () => vscode.workspace.fs.stat(uri)),
      readFile: (uri) =>
        hostCall('readFile', () => vscode.workspace.fs.readFile(uri)),
      writeFile: (uri, bytes) =>
        hostCall('writeFile', () => vscode.workspace.fs.writeFile(uri, bytes)),
      createDirectory: (uri) =>
        hostCall('createDirectory', () =>
          vscode.workspace.fs.createDirectory(uri),
        ),
      rename: (source, target, options) =>
        hostCall('rename', () =>
          vscode.workspace.fs.rename(source, target, options),
        ),
    },
  },
  window: {
    get activeTextEditor() {
      return vscode.window.activeTextEditor;
    },
    showQuickPick: (items, options) =>
      hostCall('showQuickPick', () =>
        vscode.window.showQuickPick(items, options),
      ),
    showInputBox: (options) =>
      hostCall('showInputBox', () => vscode.window.showInputBox(options)),
    showInformationMessage: (message, ...actions) =>
      hostCall('showInformationMessage', () =>
        vscode.window.showInformationMessage(message, ...actions),
      ),
    showWarningMessage: (message, ...actions) =>
      hostCall('showWarningMessage', () =>
        vscode.window.showWarningMessage(message, ...actions),
      ),
    showErrorMessage: (message, ...actions) =>
      hostCall('showErrorMessage', () =>
        vscode.window.showErrorMessage(message, ...actions),
      ),
    setStatusBarMessage: vscode.window.setStatusBarMessage,
    showOpenDialog: (options) =>
      hostCall('showOpenDialog', () => vscode.window.showOpenDialog(options)),
    tabGroups: {
      get all() {
        return vscode.window.tabGroups.all;
      },
      close: (tabs) =>
        hostCall('closeTabs', () => vscode.window.tabGroups.close(tabs)),
    },
  },
  env: {
    clipboard: {
      readText: () =>
        hostCall('readClipboard', () => vscode.env.clipboard.readText()),
      writeText: (text) =>
        hostCall('writeClipboard', () => vscode.env.clipboard.writeText(text)),
    },
  },
});
