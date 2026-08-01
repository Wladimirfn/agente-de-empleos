import { describe, expect, it } from 'vitest';
import { estimateMessagesTokens, estimateTokens, resolveModelContext } from './model-context.js';

describe('model-context registry', () => {
  describe('resolveModelContext', () => {
    it('returns the spec for a known model', () => {
      const spec = resolveModelContext('minimax', 'MiniMax-M3');
      expect(spec.context).toBe(1_000_000);
      expect(spec.compactAt).toBe(500_000);
      expect(spec.provider).toBe('minimax');
    });

    it('matches by provider when the exact model is unknown', () => {
      const spec = resolveModelContext('openai', 'gpt-99-future');
      expect(spec.provider).toBe('openai');
      expect(spec.context).toBeGreaterThan(0);
    });

    it('falls back to a conservative default when nothing matches', () => {
      const spec = resolveModelContext('unknown-provider', 'unknown-model');
      expect(spec.context).toBeLessThanOrEqual(32_000);
    });
  });

  describe('token estimation', () => {
    it('estimates tokens from string length using a 4-chars-per-token heuristic', () => {
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens('abcd')).toBe(1);
      expect(estimateTokens('a'.repeat(100))).toBe(25);
      expect(estimateTokens('a'.repeat(101))).toBe(26);
    });

    it('adds a per-message overhead to message estimates', () => {
      const tokens = estimateMessagesTokens([
        { role: 'user', content: 'a'.repeat(40) }, // 10 content + 4 overhead
        { role: 'assistant', content: 'b'.repeat(80) }, // 20 content + 4 overhead
      ]);
      expect(tokens).toBe(10 + 4 + 20 + 4);
    });
  });
});
