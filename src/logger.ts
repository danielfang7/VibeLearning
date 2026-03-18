import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

function getChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('VibeLearn');
  }
  return channel;
}

export const logger = {
  log: (msg: string) =>
    getChannel().appendLine(`[INFO]  ${new Date().toISOString()} ${msg}`),
  warn: (msg: string) =>
    getChannel().appendLine(`[WARN]  ${new Date().toISOString()} ${msg}`),
  error: (msg: string, err?: unknown) => {
    const detail = err instanceof Error ? err.message : String(err ?? '');
    getChannel().appendLine(`[ERROR] ${new Date().toISOString()} ${msg}${detail ? ` — ${detail}` : ''}`);
  },
  dispose: () => {
    channel?.dispose();
    channel = undefined;
  },
};
