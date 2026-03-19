import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InterventionEngine, parseIntervention, buildDiffSummary } from './interventionEngine';
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
