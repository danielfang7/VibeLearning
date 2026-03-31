# VibeLearn

**A passive learning layer for AI-assisted development.**

You're using Cursor, Claude Code, or Copilot to ship features fast. That's great. But fast and understood are not the same thing. VibeLearn sits silently in the background, glances at what you just built with your AI, and asks you one targeted question before you forget it — turning every coding session into a micro-learning session without breaking your flow.

---

## The problem

When an AI writes 80% of your code, you can ship a feature without actually understanding it. You see the pattern, it works, you move on. But a week later you're cargo-culting the same pattern without knowing *why* it works — or worse, applying it in the wrong place.

VibeLearn is the friction between "AI built it" and "I understand it."

---

## How it works

```
You save a file  ──►  VibeLearn detects architectural pattern
                            │  (git diff HEAD, >= 10 gross lines)
                            ▼
                   Claude classifies the pattern
                   (observer, DI, factory…) at >= 0.8 confidence
                            │
                            ▼
                   "Do you own this decision?"
                   appears in sidebar  ──►  You explain it (< 60s)
                            │
                            ▼
                   Second Claude call evaluates your answer
                   Result → spaced repetition (at 0.5x weight)
```

```
You make 10 AI prompts  ──►  VibeLearn collects context
                                  │  (recent prompts + git diffs)
                                  ▼
                         Claude identifies the most
                         valuable concept to reinforce
                                  │
                                  ▼
                         One question appears in the
                         sidebar  ──►  You answer (< 60s)
                                  │
                                  ▼
                         Result stored  ──►  spaced repetition
                         adapts future questions
```

**Triggers** (all configurable):
- **File save** — architecture_check: detects pattern-level decisions in your diffs
- Every **10 AI prompts** — quiz on the concepts you just worked with
- After a **10-minute coding gap** — session debrief (what you built + why)

**One Claude API call per trigger.** No background polling, no constant monitoring.

---

## Intervention types

| Type | Trigger | What it does | Example |
|------|---------|-------------|---------|
| **Architecture Check** | File save | Detects when Claude made a design pattern decision — asks if you own it | *"Claude introduced the Observer pattern here. Explain the tradeoff in your own words."* |
| **Concept Check** | 10 prompts | Multiple-choice quiz on a pattern you just used | *"You used `Promise.all` — which of these best describes what happens if one promise rejects?"* |
| **Explain It Back** | 10 prompts | Free-text: explain what a function does in one sentence | *"In plain English, what does your `debounce` function actually do?"* |
| **Micro-Reading** | 10 prompts | 2–3 sentence explanation + docs link for an advanced concept | *"You used `infer` in a conditional type. Here's what it actually means…"* |
| **Session Debrief** | 10-min gap | Architectural narrative of what you built this session | *(generated from git history + recent prompts)* |
| **Spot the Bug** | 10 prompts | Mutated version of your code — find the bug | *(Phase 2)* |
| **Refactor Challenge** | 10 prompts | "How would you rewrite this without the AI?" | *(Phase 2)* |
| **Analogy Prompt** | 10 prompts | "This pattern is like ___ because ___" | *(Phase 2)* |

Interventions adapt over time using SM-2 spaced repetition. Concepts you've answered correctly get spaced further apart. Concepts you've struggled with resurface sooner. Architecture Check scores are weighted at 0.5x to avoid over-inflating confidence on architectural patterns.

---

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Set your Anthropic API key

In VS Code settings (`⌘,`), search for `VibeLearn` and paste your key into **Anthropic API Key**.

Or via settings.json:
```json
"vibelearn.anthropicApiKey": "sk-ant-..."
```

### 3. Run in the Extension Development Host

```bash
npm run build   # bundle first
```

Then press **F5** in VS Code and open `test-workspace/` (or any TypeScript project) in the Extension Development Host that opens. The VibeLearn sidebar panel appears in the activity bar.

### 4. Seed test data (optional but recommended)

```bash
npm run dev:seed   # creates a fake Claude Code session log for test-workspace
```

This populates `~/.claude/projects/` with realistic TypeScript prompts so the adapter has real context to work with the moment the dev host starts.

### 5. Test the engine standalone (no VS Code needed)

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run dev:engine
```

Reads the seeded prompts + current git diffs, calls Claude, and prints the generated intervention. Fast iteration loop for working on the engine without the F5 cycle.

---

## Configuration

All settings live under `vibelearn.*` in VS Code settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `vibelearn.anthropicApiKey` | `""` | Your Anthropic API key (required) |
| `vibelearn.promptTriggerCount` | `10` | AI prompts before a learning check |
| `vibelearn.sessionGapMinutes` | `10` | Inactivity gap before a session-end check |

---

## Architecture

```
┌──────────────────────────────────┐
│           UI Layer               │  VS Code sidebar (WebviewView)
├──────────────────────────────────┤
│       Intervention Engine        │  One Claude API call → structured Intervention
├──────────────────────────────────┤
│       Context Collector          │  Prompts from JSONL logs + git diffs
├──────────────────────────────────┤
│         Adapter Layer            │  ClaudeCodeAdapter (Cursor, Codex: Phase 2+)
└──────────────────────────────────┘
│         Knowledge Store          │  SQLite — spaced repetition state
└──────────────────────────────────┘
```

**Key principle:** All learning logic lives in the Intervention Engine. Adapters only collect data. Adding support for a new AI tool = one new adapter file, zero changes to the engine.

**Key files:**
- `src/extension.ts` — activation, trigger loop orchestration
- `src/adapters/claudeCode.ts` — watches `~/.claude/projects/` JSONL logs + git diff
- `src/engine/interventionEngine.ts` — builds the prompt, calls Claude, parses Intervention JSON
- `src/storage/knowledgeState.ts` — SQLite via `better-sqlite3`, spaced repetition records
- `src/ui/panel.ts` — WebviewViewProvider sidebar panel

---

## Build commands

```bash
npm run build        # bundle with esbuild → dist/extension.js
npm run watch        # rebuild on file changes
npm test             # run vitest unit tests
npm run test:watch   # vitest in watch mode
npm run dev:seed     # seed test-workspace JSONL session log
npm run dev:engine   # test engine end-to-end from CLI (requires ANTHROPIC_API_KEY)
npm run package      # produce .vsix via vsce
```

---

## Privacy

Your code context is sent to Anthropic's API to generate interventions. v1 ships with:

- **Explicit disclosure** — the extension does nothing silently; interventions tell you what concept they're based on
- **`.vibelearningignore`** support planned for Phase 2 — exclude sensitive paths
- **Token cap** — at most ~2,000 tokens of diff per trigger (5 files × 400 chars)
- **No backend** — all state (knowledge store, logs) lives locally

---

## Roadmap

**Phase 1 — MVP (current)**
- [x] VS Code extension scaffold
- [x] Claude Code adapter (JSONL log + git diff)
- [x] Intervention Engine: Concept Check, Explain It Back, Micro-Reading
- [x] Local knowledge state (SQLite + spaced repetition records)
- [x] Sidebar panel with MCQ + free-text answer + feedback

**Phase 2**
- [ ] Free-text answer scoring via Claude (currently scores 0.5 as placeholder)
- [ ] Cursor adapter
- [ ] Spot the Bug + Refactor Challenge intervention types
- [ ] Spaced repetition scheduling (surface forgotten concepts at the right interval)
- [ ] `.vibelearningignore` support

**Phase 3**
- [ ] Streak tracking + learning history view
- [ ] Concept map visualization
- [ ] Codex adapter
- [ ] Optional web dashboard sync

**Phase 4**
- [ ] Team mode (shared concept gaps, peer comparisons)
- [ ] Docs / internal wiki integration
- [ ] Custom curriculum injection
