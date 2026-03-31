# Changelog

All notable changes to VibeLearn are documented here.

## [0.1.0.1] - 2026-03-31

### Changed
- Removed `spot_the_bug`, `refactor_challenge`, and `analogy_prompt` from the default enabled intervention types. The default set is now `concept_check`, `explain_it_back`, and `micro_reading`. All types remain available in the enum and can be re-enabled via settings.

## [0.1.0.0] - 2026-03-31

### Added
- **Architecture Mode (Phase 1):** VibeLearn now watches your files as you code and detects when Claude makes an architectural pattern decision on your behalf. When it spots a real pattern (observer, dependency injection, factory, etc.) with >= 0.8 confidence, it surfaces an `architecture_check` intervention asking you to explain the decision in your own words.
- **LLM-as-judge evaluation:** After you explain an architectural decision, a second Claude call scores your answer 0.0–1.0 with targeted feedback. Your score is written to spaced repetition at 0.5x weight so architectural patterns are reinforced without overriding concept-check confidence.
- **"Road not taken" counterfactuals:** Every detected pattern includes the alternative path that wasn't chosen, so you learn not just what was built but why the other option was rejected.
- **Pending detection queue:** If a quiz or debrief is already showing when a pattern is detected, the detection is queued (max 1). It surfaces automatically when you dismiss the current intervention.
- **`countGrossLines()` utility:** Diffs with fewer than 10 gross added/deleted lines are skipped silently — no noise from trivial saves.
- **`getUncommittedDiffs()` on `ClaudeCodeAdapter`:** Detection path uses only `git diff HEAD` (no `HEAD~5` fallback) so it only fires on changes you're actively making.
- **15 new tests:** `detectArchitecturalDecision()` (8 cases), `evaluateExplanation()` (3 cases), `countGrossLines()` (4 cases), prompt content assertions included.

### Changed
- `InterventionType` union now includes `architecture_check`
- `Intervention` interface gains optional `archDecision?: ArchitecturalDecision` field
- `SessionAdapter` interface gains optional `getUncommittedDiffs?(): FileDiff[]`
- `AnalyticsEvent` gains optional `attempted?: boolean` for architecture engagement tracking
- `panel.onAnswer()` detects `architecture_check` type and runs async evaluation path
- `panel.onSkip()` clears `pendingArchDecision` and surfaces any queued detection
- `setupTriggerLoop()` wires a `FileSystemWatcher` with 5s debounce for detection
