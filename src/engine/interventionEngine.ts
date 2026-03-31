import Anthropic from '@anthropic-ai/sdk';
import type { ArchitecturalDecision, CodebaseStoryEntry, FileDiff, Intervention, InterventionType, KnowledgeState, SessionContext } from '../types';

// One module, one API call per trigger.
// Three generation modes:
//   generateQuiz    — triggered by prompt_count, tests a concept from the session
//   generateDebrief — triggered by session_gap, explains what was built architecturally
//   generateExplain — triggered manually, gives a full codebase architectural briefing

export const ALL_QUIZ_TYPES: InterventionType[] = [
  'concept_check',
  'explain_it_back',
  'micro_reading',
  'spot_the_bug',
  'refactor_challenge',
  'analogy_prompt',
];

/**
 * How specific / granular assessments should be.
 *
 * - `architecture` (default) — Focus on WHY code was built, how decisions tie
 *   into the overall system design, and what problem they solve at a product level.
 * - `balanced` — Mix of architectural context and some implementation specifics.
 * - `implementation` — Code-level questions: specific functions, bugs, exact
 *   patterns. Best for developers who want low-level reinforcement.
 */
export type AssessmentDepth = 'architecture' | 'balanced' | 'implementation';

export interface QuizConfig {
  enabledTypes?: InterventionType[];
  minDifficulty?: number;
  maxDifficulty?: number;
  assessmentDepth?: AssessmentDepth;
}

const DIFF_CHAR_LIMIT = 8000; // ~2000 tokens @ 4 chars/token

export class InterventionEngine {
  private client: Anthropic;
  lastTokens = 0;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generateQuiz(
    context: SessionContext,
    knowledgeState: KnowledgeState,
    config?: QuizConfig
  ): Promise<Intervention> {
    const prompt = buildQuizPrompt(context, knowledgeState, config);
    const text = await this.callClaude(prompt);
    return parseIntervention(text, 'micro_reading');
  }

  async generateDebrief(
    context: SessionContext,
    priorStory: CodebaseStoryEntry[]
  ): Promise<Intervention> {
    const prompt = buildDebriefPrompt(context, priorStory);
    const text = await this.callClaude(prompt);
    return parseIntervention(text, 'session_narrative');
  }

  async generateExplain(
    context: SessionContext,
    fileStructure: string[]
  ): Promise<Intervention> {
    const prompt = buildExplainPrompt(context, fileStructure);
    const text = await this.callClaude(prompt);
    return parseIntervention(text, 'session_narrative');
  }

  /**
   * Pre-pass detector: given a single file diff, returns an ArchitecturalDecision
   * if the diff contains a pattern-level design choice (DI, observer, factory, etc.)
   * with confidence >= 0.8. Returns null otherwise.
   */
  async detectArchitecturalDecision(diff: FileDiff): Promise<ArchitecturalDecision | null> {
    const prompt = buildDetectPrompt(diff);
    let text: string;
    try {
      text = await this.callClaude(prompt);
    } catch {
      return null;
    }

    if (!text.trim()) return null;

    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    try {
      const parsed = JSON.parse(cleaned) as Partial<ArchitecturalDecision & { confidence: number }>;
      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
      if (confidence < 0.8) return null;
      if (!parsed.patternType || !parsed.decisionName || !parsed.tradeoffs || !parsed.counterfactual) return null;
      return {
        patternType: parsed.patternType,
        decisionName: parsed.decisionName,
        tradeoffs: parsed.tradeoffs,
        counterfactual: parsed.counterfactual,
        confidence,
      };
    } catch {
      return null;
    }
  }

  /**
   * Evaluates a developer's free-text explanation of an architectural decision.
   * Returns a score (0–1) and feedback string.
   * Score is from an LLM-as-judge — weight at 0.5x when writing to knowledgeState.
   */
  async evaluateExplanation(
    decision: ArchitecturalDecision,
    userAnswer: string
  ): Promise<{ score: number; feedback: string }> {
    const prompt = buildEvaluatePrompt(decision, userAnswer);
    let text: string;
    try {
      text = await this.callClaude(prompt);
    } catch {
      return { score: 0.5, feedback: `Here's what to know: ${decision.tradeoffs}` };
    }

    if (!text.trim()) return { score: 0.5, feedback: `Here's what to know: ${decision.tradeoffs}` };

    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    try {
      const parsed = JSON.parse(cleaned) as { score?: number; feedback?: string };
      const score = typeof parsed.score === 'number' ? Math.min(1, Math.max(0, parsed.score)) : 0.5;
      const feedback = typeof parsed.feedback === 'string' && parsed.feedback.trim()
        ? parsed.feedback
        : `Here's what to know: ${decision.tradeoffs}`;
      return { score, feedback };
    } catch {
      return { score: 0.5, feedback: `Here's what to know: ${decision.tradeoffs}` };
    }
  }

  private async callClaude(prompt: string): Promise<string> {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    this.lastTokens = response.usage.input_tokens + response.usage.output_tokens;
    const block = response.content[0];
    return block.type === 'text' ? block.text : '';
  }
}

// ── Prompt builders ──────────────────────────────────────────────────────────

function buildQuizPrompt(context: SessionContext, knowledgeState: KnowledgeState, config?: QuizConfig): string {
  const knowledgeSummary = Object.entries(knowledgeState.concepts)
    .map(([concept, record]) =>
      `- ${concept}: seen ${record.seenCount}x, avg score ${record.avgScore.toFixed(2)}, next review ${record.nextReview}`
    )
    .join('\n') || 'No prior history.';

  const diffSummary = buildDiffSummary(context.diffs);
  const commitSummary = context.recentCommits.slice(0, 5).join('\n') || 'No recent commits.';

  const enabledTypes = (config?.enabledTypes && config.enabledTypes.length > 0)
    ? config.enabledTypes
    : ALL_QUIZ_TYPES;
  const minDiff = config?.minDifficulty ?? 1;
  const maxDiff = Math.max(minDiff, config?.maxDifficulty ?? 5);

  const depth = config?.assessmentDepth ?? 'architecture';

  // Per-type instructions vary by depth level.
  // architecture (default): focus on WHY the code exists, product/system fit, design rationale.
  // balanced: mix of architectural context and some implementation detail.
  // implementation: current code-level behaviour (specific bugs, exact functions).
  const TYPE_INSTRUCTIONS: Record<AssessmentDepth, Record<string, string>> = {
    architecture: {
      concept_check: 'MCQ with exactly 4 options. Ask WHY this architectural decision was made — what problem does it solve, what trade-offs did it make, or how does it connect to the rest of the system? Options must require real system-level understanding, not just pattern recognition.',
      explain_it_back: 'Free text (no options). Ask them to explain WHY this component or design decision exists — what gap it fills in the system and how it serves the product goals. No answer field needed.',
      micro_reading: 'Free text (no options). Provide a 2-3 sentence explanation of the architectural decision or pattern and why it was the right choice for this system, then ask one follow-up question about how it fits the broader codebase. No answer field needed.',
      spot_the_bug: 'Describe a conceptual or architectural issue with the approach taken (not a specific code bug). MCQ with 4 options — each option should be a plausible architectural concern. The answer field is the most significant concern.',
      refactor_challenge: 'Challenge them to rethink the architectural approach: what would change if the requirements shifted, or how might this be redesigned to better serve the product goal? Free text (no options, no answer).',
      analogy_prompt: 'Ask them to complete a product/system-level analogy: "The way [component] relates to [other component] is like ___ because ___". Body should frame the relationship in system terms. Free text. Set answer to a strong sample completion.',
    },
    balanced: {
      concept_check: 'MCQ with exactly 4 options. Ask about the concept used — its purpose in this context AND a key implementation detail. Options must be plausible enough to require real understanding.',
      explain_it_back: 'Free text (no options). Ask them to explain a key function or module: what it does AND why it was designed that way. No answer field needed.',
      micro_reading: 'Free text (no options). Provide a 2-3 sentence explanation covering both what the pattern/concept does and why it was chosen here. Follow with one question that connects implementation to intent. No answer field needed.',
      spot_the_bug: 'Take a real code snippet from the diffs, introduce ONE subtle bug (off-by-one, wrong operator, missing await, swapped args, etc.), and put the BUGGY code in a markdown code fence in the body. MCQ with 4 options. After identifying the bug, ask why it matters architecturally. The answer field is the correct option text.',
      refactor_challenge: 'Take a real code snippet and challenge them to improve it — either fixing an implementation issue or better aligning it with the architectural intent. Put the original code in a markdown code fence in the body. Free text (no options, no answer).',
      analogy_prompt: 'Ask them to complete an analogy for a design pattern or concept that bridges implementation and system design. Body: "The [concept] is like ___ because ___". Free text. Set answer to a strong sample completion.',
    },
    implementation: {
      concept_check: 'MCQ with exactly 4 options. Options must be plausible enough to require real understanding.',
      explain_it_back: 'Free text (no options). Ask them to explain a specific function or pattern in 1-2 sentences. No answer field needed.',
      micro_reading: 'Free text (no options). Provide a 2-3 sentence explanation, then ask one follow-up question. No answer field needed.',
      spot_the_bug: 'Take a real code snippet from the diffs, introduce ONE subtle bug (off-by-one, wrong operator, missing await, swapped args, etc.), and put the BUGGY code in a markdown code fence in the body. MCQ with 4 options describing possible problems. The answer field is the correct option text.',
      refactor_challenge: 'Take a real code snippet and challenge them to rewrite it (e.g., using a different pattern, without a library, more functionally). Put the original code in a markdown code fence in the body. Free text response (no options, no answer).',
      analogy_prompt: 'Ask them to complete an analogy for a design pattern or concept. Body: "The [concept] is like ___ because ___". Free text. Set answer to a strong sample completion so it can be shown as feedback.',
    },
  };

  const depthInstructions = TYPE_INSTRUCTIONS[depth];
  const typeInstructions = `Format-specific requirements:\n${enabledTypes.map((t) => `- ${t}: ${depthInstructions[t] ?? t}`).join('\n')}`;

  const focusInstruction = depth === 'architecture'
    ? 'Identify the key architectural decision or design choice made in this session — focus on WHY it was built this way, not just what it does.'
    : depth === 'balanced'
      ? 'Identify the single most valuable concept to explore — consider both its purpose in the system and how it was implemented.'
      : 'Identify the single most valuable concept to test from this session.';

  const generalRules = depth === 'architecture'
    ? `General rules:
- Keep it short. Should take under 60 seconds to answer.
- Be conversational: "You just added X — why do you think this approach was chosen over Y?"
- Prioritize system-level understanding: product goals, design trade-offs, component relationships.
- Avoid asking about specific line numbers, syntax, or implementation minutiae.
- If the concept is advanced, prefer micro_reading over a hard quiz.
- Never repeat a concept with seenCount > 3 unless its nextReview date has passed.
- Pick a DIFFERENT concept and format than any recently seen intervention.
- difficultyScore must be between ${minDiff} and ${maxDiff}.`
    : `General rules:
- Keep it short. Should take under 60 seconds to answer.
- Be conversational, not academic. "Hey, you just used X — do you know how it differs from Y?"
- If the concept is advanced, prefer micro_reading over a hard quiz.
- Never repeat a concept with seenCount > 3 unless its nextReview date has passed.
- Pick a DIFFERENT concept and format than any recently seen intervention.
- difficultyScore must be between ${minDiff} and ${maxDiff}.`;

  return `You are a developer education assistant. A developer just finished an AI-assisted coding session.

Session timestamp: ${new Date(context.timestamp).toISOString()}

Session Summary:
- Concepts touched: ${context.concepts.join(', ') || 'unknown'}
- Languages/frameworks: ${context.languages.join(', ') || 'unknown'}
- Recent prompts: ${context.prompts.slice(-3).map((p) => `"${p}"`).join('; ')}
- Recent commits:
${commitSummary}
- Key changes (truncated):
${diffSummary}

Developer's prior knowledge state:
${knowledgeSummary}

Your job:
1. ${focusInstruction}
2. Choose the best intervention format from: ${enabledTypes.join(', ')}
3. Return ONLY a valid JSON object matching this schema (no markdown, no explanation):
{
  "type": "<intervention type>",
  "title": "<short title, conversational tone>",
  "body": "<the question or content — may include a markdown code fence for spot_the_bug/refactor_challenge>",
  "options": ["<option A>", "<option B>", "<option C>", "<option D>"],
  "answer": "<correct answer or sample answer for analogy_prompt>",
  "conceptTags": ["<tag1>", "<tag2>"],
  "difficultyScore": <${minDiff}-${maxDiff}>
}

${typeInstructions}

${generalRules}`;
}

function buildDebriefPrompt(context: SessionContext, priorStory: CodebaseStoryEntry[]): string {
  const diffSummary = buildDiffSummary(context.diffs);
  const commitSummary = context.recentCommits.slice(0, 5).join('\n') || 'No recent commits.';
  const priorStorySummary = priorStory.length > 0
    ? priorStory.map((e) => `[${e.timestamp.slice(0, 10)}] ${e.title}: ${e.summary}`).join('\n\n')
    : 'No prior sessions recorded — this is the first debrief.';
  const promptSummary = context.prompts.slice(-5).map((p) => `- "${p}"`).join('\n') || 'None.';

  return `You are a developer education assistant helping a developer understand what they just built.

Session timestamp: ${new Date(context.timestamp).toISOString()}
Languages/frameworks: ${context.languages.join(', ') || 'unknown'}

Recent prompts (what they asked the AI):
${promptSummary}

Recent commits:
${commitSummary}

Key code changes:
${diffSummary}

Prior codebase story (for continuity — do not repeat these sessions):
${priorStorySummary}

Write a 4–6 sentence narrative explaining:
1. What was built or changed in this session (use "you" language, plain English)
2. The key architectural decision or pattern used
3. How it fits into the existing codebase

Return ONLY a valid JSON object (no markdown, no explanation):
{
  "type": "session_narrative",
  "title": "<5–7 words: what was built>",
  "body": "<narrative, 4–6 sentences, under 120 words>",
  "conceptTags": ["<tag1>", "<tag2>"],
  "difficultyScore": 0
}

Rules:
- Be direct: start with "You just built..." or "You added..."
- Focus on what it DOES and why it matters architecturally, not implementation details
- Do not repeat concepts already covered in prior sessions unless they changed significantly`;
}

function buildExplainPrompt(context: SessionContext, fileStructure: string[]): string {
  const diffSummary = buildDiffSummary(context.diffs);
  const commitSummary = context.recentCommits.slice(0, 10).join('\n') || 'No commits yet.';
  const fileList = fileStructure.slice(0, 80).join('\n') || 'No tracked files found.';

  return `You are a developer education assistant. Explain this codebase to the developer who built it.

Tracked files:
${fileList}

Recent commits:
${commitSummary}

Key code changes:
${diffSummary}

Return ONLY a valid JSON object (no markdown, no explanation):
{
  "type": "session_narrative",
  "title": "Your Codebase Explained",
  "body": "<structured briefing — see format below>",
  "conceptTags": [],
  "difficultyScore": 0
}

The body must use exactly this format (use \\n for newlines):
**5 Defining Design Decisions:**\\n\\n1. **Decision name** — what pattern/choice was made and why it was the right call for this system\\n2. **Decision name** — what pattern/choice was made and why\\n3. **Decision name** — what pattern/choice was made and why\\n4. **Decision name** — what pattern/choice was made and why\\n5. **Decision name** — what pattern/choice was made and why\\n\\n**Road Not Taken:** For the most important decision above, what was the alternative approach, and why wasn't it chosen?\\n\\n**One Thing To Watch:** a design tension or tradeoff that may need revisiting as the system grows`;
}

// ── Shared utilities ─────────────────────────────────────────────────────────

function buildDiffSummary(diffs: Array<{ path: string; diff: string }>): string {
  if (diffs.length === 0) return '(no code changes detected)';
  return diffs
    .slice(0, 5)
    .map((d) => `[${d.path}]:\n${d.diff.slice(0, 400)}`)
    .join('\n\n');
}

function parseIntervention(text: string, defaultType: InterventionType): Intervention {
  // Empty response guard (critical gap fix)
  if (!text.trim()) {
    return {
      type: defaultType,
      title: 'Something to think about',
      body: defaultType === 'session_narrative'
        ? 'Take a moment to reflect on what you just built. What was the most interesting architectural decision you made?'
        : 'Review the code you just wrote. What does it do, and why did you write it that way?',
      conceptTags: [],
      difficultyScore: defaultType === 'session_narrative' ? 0 : 2,
    };
  }

  // Strip any accidental markdown fences
  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

  try {
    const parsed = JSON.parse(cleaned) as Partial<Intervention>;
    return {
      type: parsed.type ?? defaultType,
      title: parsed.title ?? 'Quick check',
      body: parsed.body ?? '',
      options: parsed.options,
      answer: parsed.answer,
      conceptTags: parsed.conceptTags ?? [],
      difficultyScore: parsed.difficultyScore ?? (defaultType === 'session_narrative' ? 0 : 3),
    };
  } catch {
    // Fallback: surface the raw text as a micro_reading / narrative
    return {
      type: defaultType,
      title: 'Something to think about',
      body: text.slice(0, 300),
      conceptTags: [],
      difficultyScore: defaultType === 'session_narrative' ? 0 : 2,
    };
  }
}

// ── Architectural decision detector ──────────────────────────────────────────

function buildDetectPrompt(diff: FileDiff): string {
  const diffContent = diff.diff.slice(0, DIFF_CHAR_LIMIT);

  return `You are an expert software architect reviewing a code diff. Determine whether this diff contains a significant architectural or design pattern decision.

A significant decision is a deliberate choice of a design pattern, structural abstraction, or architectural approach — not a variable rename, comment, or minor refactor.

Initial pattern set to look for: dependency-injection, observer/event-bus, factory, strategy, repository, facade, adapter, decorator, pub-sub, command, singleton.

TRUE POSITIVE examples (these ARE architectural decisions):
1. "Introduces EventEmitter to broadcast state changes to multiple listeners instead of calling them directly" → observer/event-bus
2. "Passes database client as constructor parameter instead of instantiating it inside the class" → dependency-injection
3. "Uses a factory function to create different parser types based on file extension" → factory
4. "Defines a common interface and switches between multiple strategy implementations at runtime" → strategy
5. "Creates a repository class that wraps all database queries behind domain-facing methods" → repository

FALSE POSITIVE examples (these are NOT architectural decisions):
1. "Renames variable x to userId for clarity" — NOT a pattern decision
2. "Adds a JSDoc comment block explaining an existing function" — NOT a pattern decision
3. "Fixes a typo in an error message string" — NOT a pattern decision

Diff to analyze:
[${diff.path}]:
${diffContent}

Return ONLY a valid JSON object (no markdown, no explanation):
{
  "patternType": "<pattern name, e.g. observer, dependency-injection, factory>",
  "decisionName": "<human-readable: e.g. Pub/Sub event bus via EventEmitter>",
  "tradeoffs": "<why this pattern was chosen for this context + when you'd choose differently>",
  "counterfactual": "<the alternative approach that wasn't chosen, and why>",
  "confidence": <0.0–1.0>
}

If no significant architectural decision is present, return:
{"confidence": 0.0, "patternType": "", "decisionName": "", "tradeoffs": "", "counterfactual": ""}

Rules:
- confidence >= 0.8 only for clear, unambiguous pattern-level decisions
- Be conservative — a false positive that gets dismissed is worse than a missed detection
- tradeoffs must be specific to this diff, not generic pattern description`;
}

function buildEvaluatePrompt(decision: ArchitecturalDecision, userAnswer: string): string {
  return `You are an expert software architect evaluating a developer's understanding of an architectural decision in their codebase.

The architectural decision:
- Pattern: ${decision.patternType}
- Decision: ${decision.decisionName}
- Expected understanding (tradeoffs): ${decision.tradeoffs}
- Road not taken (counterfactual): ${decision.counterfactual}

The developer's explanation:
"${userAnswer}"

Evaluate how well the developer's explanation captures:
1. Why this pattern was chosen over alternatives
2. The trade-offs involved
3. When a different approach would be better

Return ONLY a valid JSON object (no markdown, no explanation):
{
  "score": <0.0–1.0>,
  "feedback": "<2–3 sentences: acknowledge what they got right, correct/expand what they missed, end with one concrete insight>"
}

Scoring guide:
- 0.8–1.0: Captures the core tradeoff and shows genuine architectural judgment
- 0.5–0.79: Shows understanding but misses key nuances
- 0.2–0.49: Identifies the pattern but doesn't explain the tradeoff reasoning
- 0.0–0.19: Doesn't demonstrate understanding of why this choice was made

Be encouraging but honest. The goal is learning, not validation.`;
}

// ── Shared utilities ─────────────────────────────────────────────────────────

/**
 * Counts gross lines changed in a unified diff (added + deleted lines).
 * Excludes +++ and --- file header lines.
 * Used to skip trivial diffs before running the architectural decision detector.
 */
export function countGrossLines(diff: string): number {
  return diff.split('\n').filter(
    (l) => (l.startsWith('+') && !l.startsWith('+++')) || (l.startsWith('-') && !l.startsWith('---'))
  ).length;
}

// Export for testing
export { buildDiffSummary, parseIntervention, DIFF_CHAR_LIMIT, buildDetectPrompt, buildEvaluatePrompt };
