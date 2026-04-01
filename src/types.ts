// Core types for VibeLearn — derived from PRD §8, §9, §10, §11

export type TriggerReason = 'prompt_count' | 'session_gap' | 'manual' | 'file_change';

export type InterventionType =
  | 'concept_check'      // MCQ or predict-output
  | 'explain_it_back'    // "In one sentence, what does this function do?"
  | 'spot_the_bug'       // Mutated version of their code
  | 'micro_reading'      // 2–3 sentence explanation + docs link
  | 'refactor_challenge' // "How would you rewrite this without the AI?"
  | 'analogy_prompt'     // "This design pattern is like ___ because ___"
  | 'session_narrative'  // Post-session architectural debrief or on-demand explain
  | 'architecture_check';// Mid-session: AI made an architectural decision — do you own it?

/** A design pattern decision detected in a diff. */
export interface ArchitecturalDecision {
  patternType: string;    // e.g. "observer", "dependency-injection"
  decisionName: string;   // human-readable: "Pub/Sub event bus via EventEmitter"
  tradeoffs: string;      // why this was chosen + when you'd choose differently (canonical source)
  counterfactual: string; // the alternative path and why it wasn't chosen
  confidence: number;     // 0–1; only surface if >= 0.8
}

export interface FileDiff {
  path: string;
  diff: string; // unified diff format
}

export interface SessionContext {
  prompts: string[];
  diffs: FileDiff[];
  languages: string[];
  concepts: string[];   // AI-extracted: "React hooks", "async/await", etc.
  recentCommits: string[]; // recent git commit messages for richer context
  timestamp: number;
  triggerReason: TriggerReason;
}

export interface Intervention {
  type: InterventionType;
  title: string;
  body: string;
  options?: string[];      // For MCQ / concept_check
  answer?: string;         // For MCQ / spot_the_bug
  conceptTags: string[];
  difficultyScore: number; // 1–5
  archDecision?: ArchitecturalDecision; // Populated for architecture_check only
}

export interface ConceptRecord {
  seenCount: number;
  lastSeen: string;        // ISO date string
  avgScore: number;        // 0–1
  nextReview: string;      // ISO date string
  easinessFactor?: number; // SM-2: starts at 2.5, min 1.3; absent in legacy records
  interval?: number;       // SM-2: days until next review; absent in legacy records
}

export interface DebriefRating {
  timestamp: string;    // ISO date string
  stars: number;        // 1–5
  conceptTags: string[];
}

export interface KnowledgeState {
  concepts: Record<string, ConceptRecord>;
  debriefRatings?: DebriefRating[];
}

export interface CodebaseStoryEntry {
  timestamp: string;    // ISO date string
  title: string;        // Short title from the debrief
  summary: string;      // Narrative body
  conceptTags: string[];
}

/** Cross-session pattern insight derived from knowledge state. */
export interface PatternInsight {
  tag: string;               // concept name
  seenCount: number;
  avgScore: number;          // 0–1
  kind: 'struggle' | 'owned'; // recurring struggle vs fully owned
  message: string;           // human-readable insight
}

// PRD §9 — all adapters implement this interface
export interface SessionAdapter {
  name: string;
  getSessionContext(triggerReason: TriggerReason): Promise<SessionContext>;
  onPromptSubmitted(cb: (prompt: string) => void): void;
  onFileChanged(cb: (diff: FileDiff) => void): void;
  getPromptCount(): number;
  dispose(): void;
  /** Optional: advance the session window so the next quiz only sees fresh prompts. */
  markQuizTriggered?(): void;
  /** Optional: return a list of tracked files for codebase explain. */
  getFileStructure?(): string[];
  /** Optional: return only uncommitted diffs (no HEAD~5 fallback). Used by arch detector. */
  getUncommittedDiffs?(): FileDiff[];
}
