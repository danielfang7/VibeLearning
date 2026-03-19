# TODOS

Deferred work from planning sessions. Each item has context for future pickup.

---

## ~~P2: Remaining Intervention Types~~ ✅ Done

Shipped. `spot_the_bug`, `refactor_challenge`, and `analogy_prompt` are now live. The engine selects from all 6 quiz types. `spot_the_bug` and `refactor_challenge` render code snippets in `<pre><code>` blocks via updated `renderMarkdown()`. `spot_the_bug` is graded (MCQ); the others are free-text. All types are user-configurable via `vibelearn.enabledInterventionTypes`.

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

## P2: Dev Seed Script — Debrief Scenario

**What:** Extend `scripts/seed-session.mjs` with a `--mode=debrief` flag that creates a seeded scenario with a short session gap, making local debrief testing fast.

**Why:** Without a debrief seed, locally testing the debrief flow requires waiting 10 real minutes for the session gap timer. That slows iteration on the debrief prompt significantly.

**Pros:** Fast local dev loop for debrief prompt tuning. Takes ~10min to implement.

**Cons:** Minor maintenance burden when seed schema changes.

**Context:** The current seed creates user prompt events in `~/.claude/projects/<workspace>/session.jsonl`. A debrief seed would also need to create some fake git diffs in the test workspace. Look at how `scripts/run-engine.mjs` constructs context — mirror that approach. A `--session-gap-minutes=1` flag in the extension settings is the fastest way to trigger the timer during local testing regardless.

**Effort:** S (human ~1hr / CC ~10min) | **Priority:** P2 | **Depends on:** The Debrief feature shipped
