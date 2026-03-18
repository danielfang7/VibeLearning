import fs from 'fs';
import path from 'path';
import type { CodebaseStoryEntry } from '../types';

// Dual-file approach:
//   .vibelearn/codebase-story.md   — human-readable, shareable
//   .vibelearn/codebase-story.json — structured entries for the engine/UI

export class CodebaseStoryStore {
  private readonly dir: string;
  private readonly mdPath: string;
  private readonly jsonPath: string;

  constructor(workspacePath: string) {
    this.dir = path.join(workspacePath, '.vibelearn');
    this.mdPath = path.join(this.dir, 'codebase-story.md');
    this.jsonPath = path.join(this.dir, 'codebase-story.json');
  }

  /**
   * Append a debrief entry. Returns true if this was the very first write
   * (so the caller can prompt the user about .gitignore).
   */
  append(entry: CodebaseStoryEntry): boolean {
    const isFirst = !fs.existsSync(this.jsonPath);
    fs.mkdirSync(this.dir, { recursive: true });

    // Update JSON store
    const entries = this.loadAll();
    entries.push(entry);
    fs.writeFileSync(this.jsonPath, JSON.stringify(entries, null, 2), 'utf-8');

    // Append to human-readable Markdown
    const mdBlock = formatMarkdownBlock(entry);
    fs.appendFileSync(this.mdPath, mdBlock, 'utf-8');

    return isFirst;
  }

  /** Returns the N most recent entries, newest first. */
  getRecentEntries(limit = 3): CodebaseStoryEntry[] {
    const all = this.loadAll();
    return all.slice(-limit).reverse();
  }

  /** Returns all entries, oldest first. */
  getAllEntries(): CodebaseStoryEntry[] {
    return this.loadAll();
  }

  /** Returns the full Markdown content of the story file. */
  getMarkdown(): string {
    try {
      return fs.readFileSync(this.mdPath, 'utf-8');
    } catch {
      return '';
    }
  }

  private loadAll(): CodebaseStoryEntry[] {
    try {
      const raw = fs.readFileSync(this.jsonPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

function formatMarkdownBlock(entry: CodebaseStoryEntry): string {
  const date = entry.timestamp.slice(0, 10); // YYYY-MM-DD
  const tags = entry.conceptTags.join(', ') || 'none';
  return `\n## ${date} — ${entry.title}\n\n${entry.summary}\n\n**Concepts:** ${tags}\n\n---\n`;
}
