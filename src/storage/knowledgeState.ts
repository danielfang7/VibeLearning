import fs from 'fs';
import path from 'path';
import type { ConceptRecord, KnowledgeState } from '../types';

// JSON-file-backed knowledge state. Simple and dependency-free.
// Stored at <VS Code globalStoragePath>/knowledge.json
export class KnowledgeStateStore {
  private filePath: string;
  private state: KnowledgeState;

  constructor(storagePath: string) {
    fs.mkdirSync(storagePath, { recursive: true });
    this.filePath = path.join(storagePath, 'knowledge.json');
    this.state = this.load();
  }

  getState(): KnowledgeState {
    return this.state;
  }

  recordResult(conceptId: string, score: number): void {
    const today = new Date().toISOString().split('T')[0];
    const existing = this.state.concepts[conceptId];

    if (existing) {
      const newSeenCount = existing.seenCount + 1;
      const newAvgScore = (existing.avgScore * existing.seenCount + score) / newSeenCount;
      this.state.concepts[conceptId] = {
        seenCount: newSeenCount,
        lastSeen: today,
        avgScore: newAvgScore,
        nextReview: this.calcNextReview(newSeenCount, score),
      };
    } else {
      this.state.concepts[conceptId] = {
        seenCount: 1,
        lastSeen: today,
        avgScore: score,
        nextReview: this.calcNextReview(1, score),
      };
    }

    this.save();
  }

  dispose(): void {
    // nothing to close
  }

  private load(): KnowledgeState {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw) as KnowledgeState;
    } catch {
      return { concepts: {} };
    }
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  // score < 0.5 → review tomorrow; score >= 0.5 → interval doubles with each repetition
  private calcNextReview(seenCount: number, score: number): string {
    const intervalDays = score >= 0.5 ? Math.pow(2, seenCount - 1) : 1;
    const next = new Date();
    next.setDate(next.getDate() + intervalDays);
    return next.toISOString().split('T')[0];
  }
}
