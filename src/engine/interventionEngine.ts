import Anthropic from '@anthropic-ai/sdk';
import type { Intervention, InterventionType, KnowledgeState, SessionContext } from '../types';

// PRD §10 — one module, one API call per trigger.
// Receives SessionContext + KnowledgeState, returns an Intervention.

const INTERVENTION_TYPES: InterventionType[] = [
  'concept_check',
  'explain_it_back',
  'spot_the_bug',
  'micro_reading',
  'refactor_challenge',
  'analogy_prompt',
];

// Phase 1 supports 3 types. Others unlock in Phase 2.
const PHASE_1_TYPES: InterventionType[] = [
  'concept_check',
  'explain_it_back',
  'micro_reading',
];

export class InterventionEngine {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(
    context: SessionContext,
    knowledgeState: KnowledgeState
  ): Promise<Intervention> {
    const prompt = buildPrompt(context, knowledgeState);

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text =
      response.content[0].type === 'text' ? response.content[0].text : '';

    return parseIntervention(text);
  }
}

function buildPrompt(context: SessionContext, knowledgeState: KnowledgeState): string {
  const knowledgeSummary = Object.entries(knowledgeState.concepts)
    .map(([concept, record]) =>
      `- ${concept}: seen ${record.seenCount}x, avg score ${record.avgScore.toFixed(2)}, next review ${record.nextReview}`
    )
    .join('\n') || 'No prior history.';

  const diffSummary = context.diffs
    .slice(0, 5)
    .map((d) => `[${d.path}]:\n${d.diff.slice(0, 400)}`)
    .join('\n\n');

  const availableFormats = PHASE_1_TYPES.join(', ');

  const commitSummary = context.recentCommits.slice(0, 5).join('\n') || 'No recent commits.';
  const sessionTimestamp = new Date(context.timestamp).toISOString();

  return `You are a developer education assistant. A developer just finished an AI-assisted coding session.

Session timestamp: ${sessionTimestamp}

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
  "options": ["<option A>", "<option B>", "<option C>", "<option D>"],  // only for concept_check
  "answer": "<correct answer>",  // only for concept_check
  "conceptTags": ["<tag1>", "<tag2>"],
  "difficultyScore": <1-5>
}

Rules:
- Keep it short. Should take under 60 seconds to answer.
- Be conversational, not academic. "Hey, you just used X — do you know how it differs from Y?"
- If the concept is advanced, prefer micro_reading over a hard quiz.
- Never repeat a concept with seenCount > 3 unless its nextReview date has passed.
- IMPORTANT: Pick a DIFFERENT concept and format than any recently seen intervention. Vary the question each time — rotate through different aspects of the codebase, different language features, and different intervention formats.`;
}

function parseIntervention(text: string): Intervention {
  // Strip any accidental markdown code fences
  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

  try {
    const parsed = JSON.parse(cleaned) as Partial<Intervention>;
    return {
      type: parsed.type ?? 'micro_reading',
      title: parsed.title ?? 'Quick check',
      body: parsed.body ?? '',
      options: parsed.options,
      answer: parsed.answer,
      conceptTags: parsed.conceptTags ?? [],
      difficultyScore: parsed.difficultyScore ?? 3,
    };
  } catch {
    // Fallback if Claude returns malformed JSON
    return {
      type: 'micro_reading',
      title: 'Something to think about',
      body: text.slice(0, 300),
      conceptTags: [],
      difficultyScore: 2,
    };
  }
}
