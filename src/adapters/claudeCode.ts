import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import type { FileDiff, SessionAdapter, SessionContext, TriggerReason } from '../types';
import { logger } from '../logger';
import { DIFF_CHAR_LIMIT } from '../engine/interventionEngine';

// Claude Code writes conversation logs under ~/.claude/projects/<encoded-path>/
// Each project directory contains JSONL files for each session.
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

export class ClaudeCodeAdapter implements SessionAdapter {
  readonly name = 'claude-code';

  private promptCount = 0;
  private promptCallbacks: Array<(prompt: string) => void> = [];
  private fileChangedCallbacks: Array<(diff: FileDiff) => void> = [];
  private watchers: fs.FSWatcher[] = [];
  // Track per-file line offsets so we don't re-parse the same lines
  private lastSeenLines = new Map<string, number>();
  // Track where we left off after each quiz so we only surface new prompts next time
  private lastQuizLineOffset = new Map<string, number>();

  constructor(private readonly workspacePath: string) {
    this.startWatching();
  }

  getPromptCount(): number {
    return this.promptCount;
  }

  onPromptSubmitted(cb: (prompt: string) => void): void {
    this.promptCallbacks.push(cb);
  }

  onFileChanged(cb: (diff: FileDiff) => void): void {
    this.fileChangedCallbacks.push(cb);
  }

  async getSessionContext(triggerReason: TriggerReason): Promise<SessionContext> {
    const recentPrompts = this.readRecentPrompts();
    const diffs = this.getGitDiffs();
    const languages = detectLanguages(diffs);
    const recentCommits = this.getRecentCommitMessages();

    return {
      prompts: recentPrompts,
      diffs,
      languages,
      concepts: [], // filled in by the Intervention Engine pre-pass
      recentCommits,
      timestamp: Date.now(),
      triggerReason,
    };
  }

  /** Call after each quiz so the next quiz only sees fresh prompts. */
  markQuizTriggered(): void {
    const projectDir = this.resolveProjectDir();
    if (!projectDir || !fs.existsSync(projectDir)) return;

    const files = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));
    for (const file of files) {
      const filePath = path.join(projectDir, file);
      try {
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
        this.lastQuizLineOffset.set(filePath, lines.length);
      } catch {
        // ignore unreadable files
      }
    }
  }

  dispose(): void {
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers = [];
  }

  // Watch the Claude Code session log for this workspace and emit prompt events.
  private startWatching(): void {
    const projectDir = this.resolveProjectDir();
    if (!projectDir || !fs.existsSync(projectDir)) {
      return;
    }

    // Watch for new/updated JSONL session files
    const watcher = fs.watch(projectDir, { persistent: false }, (event, filename) => {
      if (filename && filename.endsWith('.jsonl')) {
        this.processSessionFile(path.join(projectDir, filename));
      }
    });
    this.watchers.push(watcher);
  }

  // Claude Code encodes the workspace path as the project directory name.
  // Example: /Users/foo/myproject → -Users-foo-myproject
  private resolveProjectDir(): string | null {
    const encoded = this.workspacePath.replace(/\//g, '-');
    const candidate = path.join(CLAUDE_PROJECTS_DIR, encoded);
    return fs.existsSync(candidate) ? candidate : null;
  }

  // Parse new lines from the JSONL log and emit prompt events.
  // Actual Claude Code log format: { type: "user" | "assistant", isMeta?: bool, message: { role, content: string } }
  private processSessionFile(filePath: string): void {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      const lastSeen = this.lastSeenLines.get(filePath) ?? 0;

      for (let i = lastSeen; i < lines.length; i++) {
        try {
          const entry = JSON.parse(lines[i]);
          if (isUserPrompt(entry)) {
            const prompt = entry.message.content as string;
            this.promptCount++;
            for (const cb of this.promptCallbacks) cb(prompt);
          }
        } catch {
          // malformed line — skip
        }
      }
      this.lastSeenLines.set(filePath, lines.length);
    } catch {
      // file not readable yet — skip
    }
  }

  private readRecentPrompts(limit = 10): string[] {
    const projectDir = this.resolveProjectDir();
    if (!projectDir) return [];

    const files = fs
      .readdirSync(projectDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({
        file: f,
        filePath: path.join(projectDir, f),
        mtime: fs.statSync(path.join(projectDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    const prompts: string[] = [];
    for (const { filePath } of files) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        // Only read lines since the last quiz for this file
        const startLine = this.lastQuizLineOffset.get(filePath) ?? 0;
        const newLines = startLine > 0 ? lines.slice(startLine) : lines;

        for (const line of newLines) {
          try {
            const entry = JSON.parse(line);
            if (isUserPrompt(entry)) {
              prompts.push(entry.message.content as string);
            }
          } catch {
            // skip malformed lines
          }
        }
      } catch {
        // skip unreadable files
      }
      if (prompts.length >= limit) break;
    }

    // If no new prompts since last quiz, fall back to recent history so Claude has context
    if (prompts.length === 0) {
      for (const { filePath } of files) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          for (const line of content.split('\n').filter(Boolean)) {
            try {
              const entry = JSON.parse(line);
              if (isUserPrompt(entry)) prompts.push(entry.message.content as string);
            } catch {
              // skip
            }
          }
        } catch {
          // skip
        }
        if (prompts.length >= limit) break;
      }
    }

    return prompts.slice(-limit);
  }

  /**
   * Returns only uncommitted diffs (git diff HEAD).
   * Used by the architectural decision detector — intentionally skips the HEAD~5
   * fallback so detection only fires on changes the developer is actively making.
   */
  getUncommittedDiffs(): FileDiff[] {
    const ignorePatterns = this.readIgnorePatterns();
    try {
      const raw = execSync('git diff HEAD', {
        cwd: this.workspacePath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000, // 10s — prevents blocking extension host on slow git
      });
      if (!raw.trim()) return [];
      return parseDiffs(raw, DIFF_CHAR_LIMIT).filter(
        (d) => !isIgnored(d.path, ignorePatterns)
      );
    } catch {
      return [];
    }
  }

  getFileStructure(): string[] {
    try {
      const output = execSync('git ls-files --name-only', {
        cwd: this.workspacePath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  private getGitDiffs(): FileDiff[] {
    const ignorePatterns = this.readIgnorePatterns();
    try {
      // First try uncommitted changes
      const uncommitted = execSync('git diff HEAD', {
        cwd: this.workspacePath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (uncommitted.trim()) {
        return parseDiffs(uncommitted, DIFF_CHAR_LIMIT).filter(
          (d) => !isIgnored(d.path, ignorePatterns)
        );
      }

      // Fall back to last 5 commits when there's nothing uncommitted
      const committed = execSync('git diff HEAD~5 HEAD', {
        cwd: this.workspacePath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return parseDiffs(committed, DIFF_CHAR_LIMIT).filter(
        (d) => !isIgnored(d.path, ignorePatterns)
      );
    } catch {
      return [];
    }
  }

  /**
   * Reads .vibelearningignore from the workspace root.
   * Returns a list of non-empty, non-comment patterns.
   */
  private readIgnorePatterns(): string[] {
    const ignorePath = path.join(this.workspacePath, '.vibelearningignore');
    try {
      const content = fs.readFileSync(ignorePath, 'utf-8');
      return content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));
    } catch {
      return []; // file absent — no filtering
    }
  }

  private getRecentCommitMessages(limit = 10): string[] {
    try {
      const log = execSync(`git log --oneline -${limit}`, {
        cwd: this.workspacePath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return log.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }
}

// Guard for real user prompts — filters meta entries and slash-command messages.
// Actual format: { type: "user", isMeta?: bool, message: { role: "user", content: string } }
function isUserPrompt(entry: Record<string, unknown>): boolean {
  if (entry.type !== 'user') return false;
  if (entry.isMeta) return false;
  const content = (entry.message as Record<string, unknown> | undefined)?.content;
  if (typeof content !== 'string') return false;
  // Filter slash-command echoes and local-command caveats
  if (content.startsWith('<command-name>')) return false;
  if (content.startsWith('<local-command-caveat>')) return false;
  return content.trim().length > 0;
}

/**
 * Returns true if filePath should be excluded based on .vibelearningignore patterns.
 * Supports gitignore-style patterns:
 *   secrets/        → matches any file under that directory
 *   *.env           → matches any file with that extension (any depth)
 *   **\/*.secret    → same as *.secret but explicit
 *   exact/path.ts   → exact path match
 */
export function isIgnored(filePath: string, patterns: string[]): boolean {
  const normalized = filePath.replace(/^\//, '');
  for (const pattern of patterns) {
    const p = pattern.replace(/^\//, '');
    // Directory pattern: "secrets/" matches anything under secrets/
    if (p.endsWith('/')) {
      if (normalized.startsWith(p) || normalized === p.slice(0, -1)) return true;
      continue;
    }
    // **/*.ext or **/name → strip the **/ prefix and match as suffix
    if (p.startsWith('**/')) {
      const suffix = p.slice(3);
      if (matchesGlob(path.basename(normalized), suffix)) return true;
      continue;
    }
    // *.ext → match basename only
    if (p.startsWith('*.')) {
      if (matchesGlob(path.basename(normalized), p)) return true;
      continue;
    }
    // Exact match or simple glob (no **)
    if (matchesGlob(normalized, p)) return true;
  }
  return false;
}

/** Matches a string against a glob pattern containing * wildcards (single-segment). */
function matchesGlob(str: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`).test(str);
}

function parseDiffs(raw: string, charLimit?: number): FileDiff[] {
  const diffs: FileDiff[] = [];
  const fileBlocks = raw.split(/^diff --git /m).filter(Boolean);
  let totalChars = 0;

  for (const block of fileBlocks) {
    if (charLimit !== undefined && totalChars >= charLimit) {
      logger.warn(`parseDiffs: diff budget (${charLimit} chars) reached, ${fileBlocks.length - diffs.length} file(s) omitted`);
      break;
    }
    const match = block.match(/^a\/.+ b\/(.+)\n/);
    if (match) {
      diffs.push({ path: match[1], diff: block });
      totalChars += block.length;
    }
  }
  return diffs;
}

function detectLanguages(diffs: FileDiff[]): string[] {
  const extMap: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript',
    js: 'JavaScript',
    jsx: 'JavaScript',
    py: 'Python',
    rs: 'Rust',
    go: 'Go',
    rb: 'Ruby',
    java: 'Java',
    cs: 'C#',
    cpp: 'C++',
    c: 'C',
  };
  const found = new Set<string>();
  for (const { path: p } of diffs) {
    const ext = p.split('.').pop() ?? '';
    if (extMap[ext]) found.add(extMap[ext]);
  }
  return [...found];
}
