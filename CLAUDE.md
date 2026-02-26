# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**VibeLearn** - A passive learning layer for AI-assisted development.

Monitors AI coding sessions (Cursor, Claude Code, Codex) and surfaces targeted learning interventions based on what the developer just built — turning every coding session into a learning session without interrupting flow.

## Current Status

Early-stage. Scaffold not yet created. Starting with Phase 1 MVP (see Roadmap below).

## Tech Stack

| Layer | Choice |
|---|---|
| Extension | VS Code Extension (TypeScript) |
| AI | Anthropic Claude API (`claude-sonnet-4-6`) |
| Local DB | JSON file (upgrade to SQLite in Phase 2 if needed) |
| Bundler | `esbuild` |
| Testing | `vitest` |

> Note: The VS Code extension host covers Cursor and Windsurf as well — single codebase.

## Build / Run / Test Commands

```bash
npm install          # install dependencies
npm run build        # bundle with esbuild → dist/extension.js
npm run watch        # rebuild on file changes
npm test             # run vitest unit tests
npm run test:watch   # vitest in watch mode
npm run package      # produce .vsix via vsce
```

**Running in VS Code:** Press `F5` (with the extension host launch config) or use `Run Extension` from the Run panel.


## Architecture

```
┌──────────────────────────────────┐
│           UI Layer               │  VS Code sidebar panel
├──────────────────────────────────┤
│       Intervention Engine        │  Generates quizzes, explanations, etc.
├──────────────────────────────────┤
│       Context Collector          │  Diffs, prompt summaries, file changes
├──────────────────────────────────┤
│         Adapter Layer            │  Cursor | Claude Code | Codex | (future)
└──────────────────────────────────┘
```

**Key principle:** All learning logic lives in the Intervention Engine. Adapters only collect data. Adding a new tool = one new adapter file, zero changes to the engine.

## Core Interfaces

```typescript
interface SessionAdapter {
  name: string;                          // "cursor" | "claude-code" | "codex"
  getSessionContext(): Promise<SessionContext>;
  onPromptSubmitted(cb: (prompt: string) => void): void;
  onFileChanged(cb: (diff: FileDiff) => void): void;
  getPromptCount(): number;
}

interface SessionContext {
  prompts: string[];
  diffs: FileDiff[];
  languages: string[];
  concepts: string[];          // AI-extracted: "React hooks", "async/await", etc.
  timestamp: number;
  triggerReason: 'prompt_count' | 'session_gap' | 'manual';
}

interface Intervention {
  type: InterventionType;
  title: string;
  body: string;
  options?: string[];          // For MCQ
  answer?: string;
  conceptTags: string[];
  difficultyScore: number;     // 1–5
}
```

## Intervention Types

- **Concept Check** — MCQ or predict-output
- **Explain It Back** — "In one sentence, what does this function do?"
- **Spot the Bug** — Mutated version of their code
- **Micro-Reading** — 2–3 sentence explanation + docs link
- **Refactor Challenge** — "How would you rewrite this without the AI?"
- **Analogy Prompt** — "This design pattern is like ___ because ___"

## Learning Trigger Loop

Default: every **10 AI prompts** OR after a **10-minute session gap** (both user-configurable).

```
Dev makes X prompts → collect diffs/context → pre-pass extracts concepts (cheap)
→ Intervention Engine calls Claude (one API call) → UI panel surfaces intervention
→ Dev responds → result stored → future interventions adapt
```

## Local Knowledge State

Stored in SQLite (v1). No backend required.

```json
{
  "concepts": {
    "React.useCallback": {
      "seenCount": 3,
      "lastSeen": "2026-02-20",
      "avgScore": 0.67,
      "nextReview": "2026-02-23"
    }
  }
}
```

Used for spaced repetition: avoid repeating too soon, increase difficulty on familiar concepts, surface forgotten concepts at the right interval.

## Phased Roadmap

**Phase 1 — MVP (current)**
- [ ] VS Code extension scaffold
- [ ] Claude Code adapter
- [ ] Intervention Engine: Concept Check, Explain It Back, Micro-Reading
- [ ] Local knowledge state (SQLite)
- [ ] Basic VS Code sidebar panel

**Phase 2**
- [ ] Cursor adapter
- [ ] Remaining intervention types
- [ ] Spaced repetition scheduling
- [ ] Configurable trigger thresholds

**Phase 3**
- [ ] Streak tracking / learning history view
- [ ] Codex adapter
- [ ] Concept map visualization
- [ ] Optional web dashboard sync (first backend)

**Phase 4**
- [ ] Team mode
- [ ] Docs / internal wiki integration
- [ ] Custom curriculum injection

## Privacy

Diffs may contain sensitive code. v1 must include:
- Clear disclosure of what is sent to Claude API
- Support for `.vibelearningignore` to exclude paths
- Cap context at ~2000 tokens of diff per trigger
