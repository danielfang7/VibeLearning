# TODOS

Deferred work from planning sessions. Each item has context for future pickup.

---

## P2: Cursor Adapter

**What:** Implement `CursorAdapter` implementing the `SessionAdapter` interface.

**Why:** Cursor is one of the most popular AI coding tools. Doubles the addressable user base. The `SessionAdapter` interface was specifically designed to make this a one-file addition.

**Pros:** Huge user base reach. Architecture already supports it — no core changes.

**Cons:** Requires research to determine Cursor's local conversation storage format and path. May change between Cursor versions.

**Context:** Start by running Cursor and inspecting `~/Library/Application Support/Cursor/` or equivalent on Windows/Linux. Look for JSONL or SQLite files containing conversation history. The adapter needs to implement `startWatching()`, `readRecentPrompts()`, and `getPromptCount()`. Reference `ClaudeCodeAdapter` as the canonical example.

**Effort:** M (human ~3 days / CC ~30 min once format known) | **Priority:** P2 | **Depends on:** The Debrief shipped and proven on Claude Code

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

## P2: Local Analytics — Intervention Engagement Tracking

**What:** Add a lightweight local event log (`~/.vibelearn/analytics.jsonl` or VS Code globalStorage) recording each intervention event: type shown, whether answered or skipped, API response time, and approximate token cost.

**Why:** The product currently has zero visibility into whether interventions are engaging or effective. Without this, every prioritization decision (Cursor adapter, SM-2, new types) is a guess. Even a local log with no backend answers: what % of interventions do users engage with? Which types get skipped? What's the Claude API cost per session?

**Pros:** Directly informs next feature decisions. Costs nothing to store locally. No backend or privacy concerns — stays on device.

**Cons:** Adds a small logging overhead to `triggerIntervention()`. Requires a reader (either a panel view or a CLI script) to be useful.

**Context:** Log structure: `{ timestamp, interventionType, triggerReason, answered: bool, skipped: bool, score: number|null, apiLatencyMs: number, approxTokens: number }`. Append to a JSONL file in `context.globalStoragePath`. A companion `npm run dev:analytics` script could summarize the log. Integrate into `extension.ts` in `triggerIntervention()` and `onAnswer()` / `skip` message handler.

**Effort:** S (human ~2hrs / CC ~15min) | **Priority:** P2 | **Depends on:** Nothing — can ship standalone

---

## P2: Idle View — "No concepts yet" placeholder

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
