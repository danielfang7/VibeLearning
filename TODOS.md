# TODOS

Deferred work from planning sessions. Each item has context for future pickup.

---

## P2: Architecture Literacy Score

**What:** A 0-100 score visible in the VS Code status bar — "Arch: 73" — showing architecture ownership across this codebase. Derived from: number of architectural decisions detected, engagement rate (not dismissed), average explanation score, and recency of review.

**Why:** Makes the abstract tangible. Motivates return usage. "I went from 41 to 78 this sprint" is the kind of number developers share. Natural community hook.

**Pros:** Status bar integration already exists. Reads from `knowledge.json` concepts records (same data architecture_check writes). Effort is tiny once data exists. High engagement-to-effort ratio.

**Cons:** Score calibration is tricky — needs to feel meaningful, not arbitrary. Requires enough Phase 1/2 data to compute a meaningful number. Cold start: 0-score on fresh install could feel discouraging.

**Context:** Build after Phase 3 has accumulated data. Formula sketch: `(engagementRate * 0.4) + (avgScore * 0.4) + (recencyFactor * 0.2)` where recencyFactor decays if no sessions in 7+ days. Status bar item already registered in `extension.ts` — update it with the score string.

**Effort:** S (human ~3 days / CC ~30min) | **Priority:** P2 | **Depends on:** Phase 3 shipped + data accumulated

---

## P2: Cross-Session Pattern Tracking

**What:** Surface insights from the SM-2 knowledge state: "You've encountered the observer pattern 5 times with 20% engagement. Want to work on this?" Shows which architecture patterns you own vs which keep surprising you.

**Why:** The SM-2 data already sits in `knowledge.json`. This feature makes it visible instead of letting it accumulate silently. Turns passive tracking into active insight delivery. Zero new data infrastructure required.

**Pros:** Near-zero implementation effort. High insight-to-effort ratio. Natural content for the idle view and weekly digest.

**Cons:** Cold start — needs at least 10 architecture_check events to surface meaningful patterns. Could feel noisy if surfaced too eagerly.

**Context:** Query `knowledgeState.concepts` for patterns where `seenCount >= 3` and `avgScore < 0.5` (recurring struggle) or `seenCount >= 5` and `avgScore >= 0.8` (fully owned). Surface in the idle view as a "pattern insight" card. Also include in weekly digest. Start with a simple read of existing data.

**Effort:** XS (human ~1 day / CC ~20min) | **Priority:** P2 | **Depends on:** Phase 1 shipped + ~10 architecture_check events recorded

---

## P2: Framework-Aware Detection

**What:** Extend the implicit decision detector to recognize framework-specific patterns in addition to generic ones. Examples: "You're using React Context — do you know when you'd use Zustand instead?" / "This Prisma relation could produce N+1 queries — do you know why?"

**Why:** Generic patterns (observer, factory) are architecturally correct but can feel abstract. Framework-specific questions are immediately relevant to what the developer is building. Higher perceived value for the most common use cases.

**Pros:** Same detection infrastructure — just extend the prompt with framework-specific few-shot examples. Dramatically increases relevance for React/Next.js/Prisma users.

**Cons:** Framework taxonomy is larger. Need to detect which frameworks are in use first (read `package.json` dependencies). False positive risk is higher for framework-specific patterns.

**Context:** Step 1: read `package.json` at session start, build a framework context string. Step 2: include it in the `detectArchDecision()` prompt alongside generic examples. Initial framework set: React (Context, hooks, server/client components), Next.js (App Router, SSR/SSG), Prisma (relations, N+1), Express (middleware, routing). Expand based on what's most common in user sessions.

**Effort:** S (human ~1 week / CC ~1hr) | **Priority:** P2 | **Depends on:** Phase 1 generic detection proven accurate (dismiss rate < 50%)

---

## P3: Cursor Adapter

**What:** Implement `CursorAdapter` implementing the `SessionAdapter` interface.

**Why:** Cursor is one of the most popular AI coding tools. Doubles the addressable user base. The `SessionAdapter` interface was specifically designed to make this a one-file addition.

**Pros:** Huge user base reach. Architecture already supports it — no core changes.

**Cons:** Requires research to determine Cursor's local conversation storage format and path. May change between Cursor versions.

**Context:** Start by running Cursor and inspecting `~/Library/Application Support/Cursor/` or equivalent on Windows/Linux. Look for JSONL or SQLite files containing conversation history. The adapter needs to implement `startWatching()`, `readRecentPrompts()`, and `getPromptCount()`. Reference `ClaudeCodeAdapter` as the canonical example.

**Effort:** M (human ~3 days / CC ~30 min once format known) | **Priority:** P3 | **Depends on:** The Debrief shipped and proven on Claude Code

---

## P2: Spaced Repetition Improvements

**What:** Improve the `calcNextReview()` algorithm in `KnowledgeStateStore` beyond simple exponential doubling. Consider SM-2 algorithm or a simplified variant.

**Why:** The current algorithm (`Math.pow(2, seenCount - 1)`) is too aggressive — after 4 correct answers the interval jumps to 8 days. Real spaced repetition should factor in consecutive correct answers and time since last review.

**Pros:** Better learning retention. Standard SM-2 is well-understood and has decades of research behind it.

**Cons:** Adds complexity to `KnowledgeStateStore`. Might not matter much until the product has many concepts tracked.

**Context:** SM-2 inputs: previous interval, easiness factor, response quality (0-5). Current system uses score (0-1) and seenCount. Would need to add `easinessFactor` and `interval` fields to `ConceptRecord` in `src/types.ts`. See: https://www.supermemo.com/en/blog/application-of-a-computer-to-improve-the-results-obtained-in-working-with-the-supermemo-method

**Effort:** S (human ~4 hours / CC ~20 min) | **Priority:** P2 | **Depends on:** Rating data from Debrief Quality Ratings feature

---

## P3: Concept Map Visualization

**What:** Visual graph showing concepts the developer has encountered, their relationships, and their mastery level.

**Why:** The Codebase Story (to be shipped) is the linear narrative. The concept map is the spatial/relational view. Lets developers see "I know auth well, but I've never touched caching."

**Pros:** High "wow factor." Makes the knowledge state tangible and motivating.

**Cons:** Requires a graph rendering library (D3, vis.js) in the webview. Significantly more complex UI than current plain HTML approach.

**Context:** The data already exists in `knowledge.json` — `concepts` is a flat dict. Relationships between concepts would need to come from the Debrief prompt (Claude could output `relatedConcepts` alongside the narrative). Build the data model first (extend Debrief output), then the visualization.

**Effort:** L (human ~1 week / CC ~1 hour) | **Priority:** P3 | **Depends on:** Codebase Story + Debrief shipping and accumulating data



---

## ~~P2: Local Analytics — Intervention Engagement Tracking~~ ✓ DONE

**What:** Add a lightweight local event log (`~/.vibelearn/analytics.jsonl` or VS Code globalStorage) recording each intervention event: type shown, whether answered or skipped, API response time, and approximate token cost.

**Why:** The product currently has zero visibility into whether interventions are engaging or effective. Without this, every prioritization decision (Cursor adapter, SM-2, new types) is a guess. Even a local log with no backend answers: what % of interventions do users engage with? Which types get skipped? What's the Claude API cost per session?

**Pros:** Directly informs next feature decisions. Costs nothing to store locally. No backend or privacy concerns — stays on device.

**Cons:** Adds a small logging overhead to `triggerIntervention()`. Requires a reader (either a panel view or a CLI script) to be useful.

**Context:** Log structure: `{ timestamp, interventionType, triggerReason, answered: bool, skipped: bool, score: number|null, apiLatencyMs: number, approxTokens: number }`. Append to a JSONL file in `context.globalStoragePath`. A companion `npm run dev:analytics` script could summarize the log. Integrate into `extension.ts` in `triggerIntervention()` and `onAnswer()` / `skip` message handler.

**Effort:** S (human ~2hrs / CC ~15min) | **Priority:** P2 | **Depends on:** Nothing — can ship standalone

---

## ~~P2: Idle View — "No concepts yet" placeholder~~ ✓ DONE

**What:** When the idle view renders the "Last reinforced" concept card but no concepts have been recorded yet (fresh install, no answered quizzes), show a motivating placeholder instead of an empty space.

**Why:** First-time users open the panel, answer zero quizzes, and see a blank slot. A hint like "Answer your first quiz to start tracking concepts" turns an empty state into a CTA.

**Pros:** Removes the cold-start blank state. Reinforces the product's value prop on first open.

**Cons:** Minor — the absence of the widget is already handled (widget only renders if `lastConcept` is set), so no bug. This is purely a polish improvement.

**Context:** In `src/ui/views/idle.ts`, `lastConceptHtml` is `''` when `lastConcept` is undefined. Add a fallback div: `<div class="last-concept"><p class="hint">Answer your first quiz to start tracking concepts.</p></div>`.

**Effort:** XS (human ~15min / CC ~5min) | **Priority:** P2 | **Depends on:** Nothing

---

## P3: DESIGN.md — Extension design system documentation

**What:** Create a `DESIGN.md` that documents the design decisions for VibeLearn as a living reference: token system (`shared.ts` CSS vars), icon rationale, status bar format, command naming conventions, copywriting voice.

**Why:** As the product grows (more views, potential contributor), the design decisions in `shared.ts` become invisible tribal knowledge. DESIGN.md makes them explicit and debatable.

**Pros:** Enables consistent design across future views. Useful for onboarding contributors. Makes `/plan-design-review` calibrate against documented decisions.

**Cons:** Maintenance overhead if design evolves quickly. Premature for a solo-authored extension.

**Context:** The de-facto design system already exists in `src/ui/views/shared.ts`. DESIGN.md would be a prose explanation of the choices made there: VS Code token usage, 2px border-radius convention, `--vscode-charts-green/red` for feedback colors, `$(zap)` codicon for status bar, `Cmd+Shift+L` keybinding rationale.

**Effort:** XS (human ~1hr / CC ~20min) | **Priority:** P3 | **Depends on:** Nothing
