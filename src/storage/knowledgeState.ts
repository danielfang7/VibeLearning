import fs from 'fs';
import path from 'path';
import type { ConceptRecord, DebriefRating, KnowledgeState, PatternInsight } from '../types';

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
      const { ef, interval, nextReview } = this.sm2(
        score,
        existing.easinessFactor ?? 2.5,
        existing.interval ?? 1,
        newSeenCount
      );
      this.state.concepts[conceptId] = {
        seenCount: newSeenCount,
        lastSeen: today,
        avgScore: newAvgScore,
        nextReview,
        easinessFactor: ef,
        interval,
      };
    } else {
      const { ef, interval, nextReview } = this.sm2(score, 2.5, 1, 1);
      this.state.concepts[conceptId] = {
        seenCount: 1,
        lastSeen: today,
        avgScore: score,
        nextReview,
        easinessFactor: ef,
        interval,
      };
    }

    this.save();
  }

  recordRating(stars: number, conceptTags: string[]): void {
    const rating: DebriefRating = {
      timestamp: new Date().toISOString(),
      stars,
      conceptTags,
    };
    if (!this.state.debriefRatings) {
      this.state.debriefRatings = [];
    }
    this.state.debriefRatings.push(rating);
    this.save();
  }

  /** Return cross-session pattern insights from accumulated concept data. */
  getPatternInsights(): PatternInsight[] {
    const insights: PatternInsight[] = [];
    for (const [tag, r] of Object.entries(this.state.concepts)) {
      if (r.seenCount >= 3 && r.avgScore < 0.5) {
        insights.push({
          tag,
          seenCount: r.seenCount,
          avgScore: r.avgScore,
          kind: 'struggle',
          message: `You've seen ${tag} ${r.seenCount} times with ${Math.round(r.avgScore * 100)}% avg. Want to work on this?`,
        });
      } else if (r.seenCount >= 5 && r.avgScore >= 0.8) {
        insights.push({
          tag,
          seenCount: r.seenCount,
          avgScore: r.avgScore,
          kind: 'owned',
          message: `You've nailed ${tag} across ${r.seenCount} sessions. This one's yours.`,
        });
      }
    }
    // Show struggles first, then owned — most actionable at top
    return insights.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'struggle' ? -1 : 1;
      return b.seenCount - a.seenCount;
    });
  }

  dispose(): void {
    // nothing to close
  }

  private load(): KnowledgeState {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as KnowledgeState;
      // Ensure debriefRatings exists for older knowledge.json files
      return { debriefRatings: [], ...parsed };
    } catch {
      return { concepts: {}, debriefRatings: [] };
    }
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  // SM-2 spaced repetition algorithm.
  // score (0–1) is mapped to quality q (0–5): q = round(score * 5)
  // q < 3 → failed, interval resets to 1 day
  // q >= 3 → interval grows: 1 → 6 → round(prev * EF) on subsequent reviews
  // EF (easiness factor) adjusts per answer quality, clamped to min 1.3
  private sm2(
    score: number,
    prevEF: number,
    prevInterval: number,
    seenCount: number
  ): { ef: number; interval: number; nextReview: string } {
    const q = Math.round(score * 5); // 0–5
    const ef = Math.max(1.3, prevEF + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));

    let interval: number;
    if (q < 3) {
      interval = 1;
    } else if (seenCount <= 1) {
      interval = 1;
    } else if (seenCount === 2) {
      interval = 6;
    } else {
      interval = Math.round(prevInterval * ef);
    }

    const next = new Date();
    next.setDate(next.getDate() + interval);
    return { ef, interval, nextReview: next.toISOString().split('T')[0] };
  }
}
