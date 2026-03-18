import Anthropic from '@anthropic-ai/sdk';
import type { CodebaseStoryEntry, Intervention, InterventionType, KnowledgeState, SessionContext } from '../types';

// One module, one API call per trigger.
// Three generation modes:
//   generateQuiz    — triggered by prompt_count, tests a concept from the session
//   generateDebrief — triggered by session_gap, explains what was built architecturally
//   generateExplain — triggered manually, gives a full codebase architectural briefing

const PHASE_1_QUIZ_TYPES: InterventionType[] = [
  'concept_check',
  'explain_it_back',
  'micro_reading',
];

const DIFF_CHAR_LIMIT = 8000; // ~2000 tokens @ 4 chars/token

export class InterventionEngine {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generateQuiz(
    context: SessionContext,
    knowledgeState: KnowledgeState
  ): Promise<Intervention> {
    const prompt = buildQuizPrompt(context, knowledgeState);
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

  private async callClaude(prompt: string): Promise<string> {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = response.content[0];
    return block.type === 'text' ? block.text : '';
  }
}

// ── Prompt builders ──────────────────────────────────────────────────────────

function buildQuizPrompt(context: SessionContext, knowledgeState: KnowledgeState): string {
  const knowledgeSummary = Object.entries(knowledgeState.concepts)
    .map(([concept, record]) =>
      `- ${concept}: seen ${record.seenCount}x, avg score ${record.avgScore.toFixed(2)}, next review ${record.nextReview}`
    )
    .join('\n') || 'No prior history.';

  const diffSummary = buildDiffSummary(context.diffs);
  const commitSummary = context.recentCommits.slice(0, 5).join('\n') || 'No recent commits.';
  const availableFormats = PHASE_1_QUIZ_TYPES.join(', ');

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
1. Identify the single most valuable concept to test from this session.
2. Choose the best intervention format from: ${availableFormats}
3. Return ONLY a valid JSON object matching this schema (no markdown, no explanation):
{
  "type": "<intervention type>",
  "title": "<short title, conversational tone>",
  "body": "<the question or content, under 150 words>",
  "options": ["<option A>", "<option B>", "<option C>", "<option D>"],
  "answer": "<correct answer>",
  "conceptTags": ["<tag1>", "<tag2>"],
  "difficultyScore": <1-5>
}

Rules:
- Keep it short. Should take under 60 seconds to answer.
- Be conversational, not academic. "Hey, you just used X — do you know how it differs from Y?"
- If the concept is advanced, prefer micro_reading over a hard quiz.
- Never repeat a concept with seenCount > 3 unless its nextReview date has passed.
- IMPORTANT: Pick a DIFFERENT concept and format than any recently seen intervention.`;
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
**Purpose:** one sentence about what this codebase does\\n\\n**Major Components:**\\n- Component: what it does\\n- Component: what it does\\n\\n**Data Flow:** how data moves through the system (1–2 sentences)\\n\\n**Key Patterns:** design patterns or architectural decisions (1–2 sentences)\\n\\n**Open Questions:** 1–2 things that might need attention`;
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

// Export for testing
export { buildDiffSummary, parseIntervention, DIFF_CHAR_LIMIT };
