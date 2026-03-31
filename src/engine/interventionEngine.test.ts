import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InterventionEngine, parseIntervention, buildDiffSummary, countGrossLines, buildDetectPrompt, buildEvaluatePrompt } from './interventionEngine';
import type { KnowledgeState, SessionContext } from '../types';

// ── Mock Anthropic SDK ────────────────────────────────────────────────────────

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseContext: SessionContext = {
  prompts: ['how do I use async/await?'],
  diffs: [{ path: 'src/foo.ts', diff: 'diff --git a/src/foo.ts b/src/foo.ts\n+const x = 1;' }],
  languages: ['TypeScript'],
  concepts: [],
  recentCommits: ['abc1234 Add foo module'],
  timestamp: Date.now(),
  triggerReason: 'prompt_count',
};

const baseKnowledgeState: KnowledgeState = {
  concepts: {},
  debriefRatings: [],
};

function mockResponse(text: string) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text }],
    usage: { input_tokens: 100, output_tokens: 50 },
  });
}

function quizJson(overrides?: object) {
  return JSON.stringify({
    type: 'concept_check',
    title: 'Do you know async/await?',
    body: 'What does await do?',
    options: ['A', 'B', 'C', 'D'],
    answer: 'A',
    conceptTags: ['async/await'],
    difficultyScore: 2,
    ...overrides,
  });
}

function debriefJson(overrides?: object) {
  return JSON.stringify({
    type: 'session_narrative',
    title: 'Added async utilities',
    body: 'You just added async helper functions to your codebase.',
    conceptTags: ['async/await'],
    difficultyScore: 0,
    ...overrides,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockCreate.mockReset();
});

describe('InterventionEngine', () => {
  describe('generateQuiz()', () => {
    it('returns a parsed Intervention on a valid JSON response', async () => {
      mockResponse(quizJson());
      const engine = new InterventionEngine('sk-test');
      const result = await engine.generateQuiz(baseContext, baseKnowledgeState);
      expect(result.type).toBe('concept_check');
      expect(result.title).toBe('Do you know async/await?');
      expect(result.options).toHaveLength(4);
    });

    it('calls the Claude API with the correct model', async () => {
      mockResponse(quizJson());
      const engine = new InterventionEngine('sk-test');
      await engine.generateQuiz(baseContext, baseKnowledgeState);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-sonnet-4-6' })
      );
    });

    it('uses micro_reading fallback type when response has malformed JSON', async () => {
      mockResponse('this is not json at all');
      const engine = new InterventionEngine('sk-test');
      const result = await engine.generateQuiz(baseContext, baseKnowledgeState);
      expect(result.type).toBe('micro_reading');
      expect(result.body).toContain('this is not json');
    });

    it('returns fallback narrative when response is empty string', async () => {
      mockResponse('');
      const engine = new InterventionEngine('sk-test');
      const result = await engine.generateQuiz(baseContext, baseKnowledgeState);
      expect(result.type).toBe('micro_reading');
      expect(result.body.length).toBeGreaterThan(0);
    });

    it('strips markdown code fences before parsing', async () => {
      mockResponse('```json\n' + quizJson() + '\n```');
      const engine = new InterventionEngine('sk-test');
      const result = await engine.generateQuiz(baseContext, baseKnowledgeState);
      expect(result.type).toBe('concept_check');
    });
  });

  describe('generateDebrief()', () => {
    it('returns a session_narrative intervention', async () => {
      mockResponse(debriefJson());
      const engine = new InterventionEngine('sk-test');
      const result = await engine.generateDebrief(baseContext, []);
      expect(result.type).toBe('session_narrative');
      expect(result.difficultyScore).toBe(0);
    });

    it('handles empty response with narrative fallback', async () => {
      mockResponse('');
      const engine = new InterventionEngine('sk-test');
      const result = await engine.generateDebrief(baseContext, []);
      expect(result.type).toBe('session_narrative');
      expect(result.body).toContain('reflect');
    });

    it('passes prior story context to the prompt', async () => {
      mockResponse(debriefJson());
      const engine = new InterventionEngine('sk-test');
      await engine.generateDebrief(baseContext, [
        { timestamp: '2026-03-17T00:00:00.000Z', title: 'Prior session', summary: 'Prior summary', conceptTags: [] },
      ]);
      const promptArg = mockCreate.mock.calls[0][0].messages[0].content as string;
      expect(promptArg).toContain('Prior session');
    });
  });

  describe('generateExplain()', () => {
    it('returns a session_narrative type', async () => {
      mockResponse(debriefJson({ title: 'Your Codebase Explained' }));
      const engine = new InterventionEngine('sk-test');
      const result = await engine.generateExplain(baseContext, ['src/foo.ts', 'src/bar.ts']);
      expect(result.type).toBe('session_narrative');
    });

    it('includes file structure in the prompt', async () => {
      mockResponse(debriefJson());
      const engine = new InterventionEngine('sk-test');
      await engine.generateExplain(baseContext, ['src/foo.ts', 'src/bar.ts']);
      const promptArg = mockCreate.mock.calls[0][0].messages[0].content as string;
      expect(promptArg).toContain('src/foo.ts');
      expect(promptArg).toContain('src/bar.ts');
    });
  });
});

describe('parseIntervention()', () => {
  it('defaults difficultyScore to 0 for session_narrative', () => {
    const result = parseIntervention(
      JSON.stringify({ type: 'session_narrative', title: 'T', body: 'B', conceptTags: [] }),
      'session_narrative'
    );
    expect(result.difficultyScore).toBe(0);
  });

  it('defaults difficultyScore to 3 for quiz types', () => {
    const result = parseIntervention(
      JSON.stringify({ type: 'micro_reading', title: 'T', body: 'B', conceptTags: [] }),
      'micro_reading'
    );
    expect(result.difficultyScore).toBe(3);
  });
});

describe('generateQuiz() with QuizConfig', () => {
  it('restricts prompt to only enabled types', async () => {
    mockResponse(quizJson({ type: 'spot_the_bug' }));
    const engine = new InterventionEngine('sk-test');
    await engine.generateQuiz(baseContext, baseKnowledgeState, {
      enabledTypes: ['spot_the_bug'],
    });
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('spot_the_bug');
    expect(prompt).not.toContain('concept_check');
    expect(prompt).not.toContain('explain_it_back');
  });

  it('uses ALL_QUIZ_TYPES when enabledTypes is empty', async () => {
    mockResponse(quizJson());
    const engine = new InterventionEngine('sk-test');
    await engine.generateQuiz(baseContext, baseKnowledgeState, { enabledTypes: [] });
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('concept_check');
    expect(prompt).toContain('spot_the_bug');
  });

  it('injects difficulty range into prompt', async () => {
    mockResponse(quizJson());
    const engine = new InterventionEngine('sk-test');
    await engine.generateQuiz(baseContext, baseKnowledgeState, {
      minDifficulty: 3,
      maxDifficulty: 4,
    });
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('3-4');
  });

  it('clamps maxDifficulty to minDifficulty when inverted', async () => {
    mockResponse(quizJson());
    const engine = new InterventionEngine('sk-test');
    await engine.generateQuiz(baseContext, baseKnowledgeState, {
      minDifficulty: 4,
      maxDifficulty: 2,
    });
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    // max is clamped to min=4, so range should be 4-4
    expect(prompt).toContain('4-4');
    expect(prompt).not.toContain('4-2');
  });

  it('only shows format instructions for enabled types', async () => {
    mockResponse(quizJson());
    const engine = new InterventionEngine('sk-test');
    await engine.generateQuiz(baseContext, baseKnowledgeState, {
      enabledTypes: ['concept_check', 'micro_reading'],
    });
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('- concept_check:');
    expect(prompt).toContain('- micro_reading:');
    expect(prompt).not.toContain('- spot_the_bug:');
    expect(prompt).not.toContain('- refactor_challenge:');
  });
});

describe('countGrossLines()', () => {
  it('returns 0 for an empty string', () => {
    expect(countGrossLines('')).toBe(0);
  });

  it('does not count +++ or --- header lines', () => {
    const headerOnly = '--- a/foo.ts\n+++ b/foo.ts\n';
    expect(countGrossLines(headerOnly)).toBe(0);
  });

  it('counts added and deleted lines', () => {
    const diff = '+const x = 1;\n-const y = 2;\n context line\n';
    expect(countGrossLines(diff)).toBe(2);
  });

  it('counts mixed diff with headers correctly', () => {
    const diff = '--- a/foo.ts\n+++ b/foo.ts\n+added\n-removed\n+another add\n context\n';
    expect(countGrossLines(diff)).toBe(3);
  });
});

describe('InterventionEngine.detectArchitecturalDecision()', () => {
  const validDecision = {
    patternType: 'observer',
    decisionName: 'Pub/Sub event bus via EventEmitter',
    tradeoffs: 'Decouples producers from consumers at the cost of harder debugging.',
    counterfactual: 'Direct function calls — simpler but tightly coupled.',
    confidence: 0.9,
  };

  it('returns null when confidence is below 0.8', async () => {
    mockResponse(JSON.stringify({ ...validDecision, confidence: 0.7 }));
    const engine = new InterventionEngine('sk-test');
    const result = await engine.detectArchitecturalDecision({ path: 'src/bus.ts', diff: '+emitter.on("change", handler);' });
    expect(result).toBeNull();
  });

  it('returns the decision struct when confidence is >= 0.8', async () => {
    mockResponse(JSON.stringify(validDecision));
    const engine = new InterventionEngine('sk-test');
    const result = await engine.detectArchitecturalDecision({ path: 'src/bus.ts', diff: '+emitter.on("change", handler);' });
    expect(result).not.toBeNull();
    expect(result?.patternType).toBe('observer');
    expect(result?.confidence).toBe(0.9);
  });

  it('returns null on malformed JSON response', async () => {
    mockResponse('not valid json {{{');
    const engine = new InterventionEngine('sk-test');
    const result = await engine.detectArchitecturalDecision({ path: 'src/foo.ts', diff: '+x' });
    expect(result).toBeNull();
  });

  it('returns null on empty response', async () => {
    mockResponse('');
    const engine = new InterventionEngine('sk-test');
    const result = await engine.detectArchitecturalDecision({ path: 'src/foo.ts', diff: '+x' });
    expect(result).toBeNull();
  });

  it('returned struct includes counterfactual', async () => {
    mockResponse(JSON.stringify(validDecision));
    const engine = new InterventionEngine('sk-test');
    const result = await engine.detectArchitecturalDecision({ path: 'src/bus.ts', diff: '+emitter.on("change", handler);' });
    expect(result?.counterfactual).toBeTruthy();
  });

  it('prompt includes few-shot true-positive examples', () => {
    const prompt = buildDetectPrompt({ path: 'src/foo.ts', diff: '+x' });
    expect(prompt).toMatch(/true[- ]positive|DETECT|patternType/i);
    // At least one concrete example of a real pattern
    expect(prompt).toMatch(/observer|singleton|dependency.inject|factory|strategy/i);
  });

  it('prompt includes false-positive examples', () => {
    const prompt = buildDetectPrompt({ path: 'src/foo.ts', diff: '+x' });
    expect(prompt).toMatch(/false[- ]positive|NOT a pattern|no architectural|routine/i);
  });

  it('prompt instructs model to use confidence threshold', () => {
    const prompt = buildDetectPrompt({ path: 'src/foo.ts', diff: '+x' });
    expect(prompt).toMatch(/confidence/i);
    expect(prompt).toMatch(/0\.8|80%/i);
  });
});

describe('InterventionEngine.evaluateExplanation()', () => {
  const decision = {
    patternType: 'observer',
    decisionName: 'Pub/Sub event bus',
    tradeoffs: 'Decouples producers and consumers.',
    counterfactual: 'Direct function calls.',
    confidence: 0.9,
  };

  it('returns score and feedback from a valid LLM response', async () => {
    mockResponse(JSON.stringify({ score: 0.8, feedback: 'Good understanding.' }));
    const engine = new InterventionEngine('sk-test');
    const result = await engine.evaluateExplanation(decision, 'It decouples things.');
    expect(result.score).toBe(0.8);
    expect(result.feedback).toBe('Good understanding.');
  });

  it('returns fallback score 0.5 on malformed JSON', async () => {
    mockResponse('not json');
    const engine = new InterventionEngine('sk-test');
    const result = await engine.evaluateExplanation(decision, 'some answer');
    expect(result.score).toBe(0.5);
    expect(result.feedback).toBeTruthy();
  });

  it('returns fallback score 0.5 on empty response', async () => {
    mockResponse('');
    const engine = new InterventionEngine('sk-test');
    const result = await engine.evaluateExplanation(decision, 'some answer');
    expect(result.score).toBe(0.5);
  });
});

describe('buildDiffSummary()', () => {
  it('returns a placeholder when diffs array is empty', () => {
    expect(buildDiffSummary([])).toBe('(no code changes detected)');
  });

  it('truncates individual diff content to 400 chars', () => {
    const longDiff = 'x'.repeat(1000);
    const summary = buildDiffSummary([{ path: 'a.ts', diff: longDiff }]);
    expect(summary.length).toBeLessThan(600);
  });
});
