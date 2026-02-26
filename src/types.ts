// Core types for VibeLearn — derived from PRD §8, §9, §10, §11

export type TriggerReason = 'prompt_count' | 'session_gap' | 'manual';

export type InterventionType =
  | 'concept_check'     // MCQ or predict-output
  | 'explain_it_back'   // "In one sentence, what does this function do?"
  | 'spot_the_bug'      // Mutated version of their code
  | 'micro_reading'     // 2–3 sentence explanation + docs link
  | 'refactor_challenge'// "How would you rewrite this without the AI?"
  | 'analogy_prompt';   // "This design pattern is like ___ because ___"

export interface FileDiff {
  path: string;
  diff: string; // unified diff format
}

export interface SessionContext {
  prompts: string[];
  diffs: FileDiff[];
  languages: string[];
  concepts: string[];   // AI-extracted: "React hooks", "async/await", etc.
  timestamp: number;
  triggerReason: TriggerReason;
}

export interface Intervention {
  type: InterventionType;
  title: string;
  body: string;
  options?: string[];   // For MCQ / concept_check
  answer?: string;      // For MCQ / spot_the_bug
  conceptTags: string[];
  difficultyScore: number; // 1–5
}

export interface ConceptRecord {
  seenCount: number;
  lastSeen: string;     // ISO date string
  avgScore: number;     // 0–1
  nextReview: string;   // ISO date string
}

export interface KnowledgeState {
  concepts: Record<string, ConceptRecord>;
}

// PRD §9 — all adapters implement this interface
export interface SessionAdapter {
  name: string;
  getSessionContext(triggerReason: TriggerReason): Promise<SessionContext>;
  onPromptSubmitted(cb: (prompt: string) => void): void;
  onFileChanged(cb: (diff: FileDiff) => void): void;
  getPromptCount(): number;
  dispose(): void;
}
