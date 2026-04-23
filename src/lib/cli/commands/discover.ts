export const discover = (): number => {
  process.stdout.write(`\
vsv discover — manual workflow

To discover the live list of VSCode commands and context keys available in a
running extension host, do this by hand (v1 does not automate it):

1. Open your extension's workspace in VSCode
2. Press F5 to launch an Extension Development Host
3. In the dev host, open the Debug Console and run:

   await vscode.commands.getCommands(true)
   // → Array<string> of all registered command ids

4. For context keys:
   (vscode private API, inspect via Developer: Inspect Context Keys in the
    Command Palette of the dev host)

Paste the results into your manifest's builtin-catalog overrides, or submit a
PR to @jasonkuhrt/vsv to expand the default catalog.
`)
  return 0
}
