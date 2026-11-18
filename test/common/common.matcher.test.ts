import { describe, expect, it } from 'vitest';
import * as common from '../../src/common/common.js';

describe('common createMatcherRegex', () => {
  it('should convert strings to case-insensitive regexes and preserve regexes', () => {
    const existingRegex = /chapter/;
    const result = common.createMatcherRegex(['TITLE', existingRegex]);

    expect(result).toHaveLength(2);
    expect(result[0].flags).toContain('i');
    expect(result[0].test('title')).toBe(true);
    expect(result[1]).toBe(existingRegex);
  });
});

describe('common createCommonMatcher', () => {
  it('should return true when any regex matches and false when none match', () => {
    const matcher = common.createCommonMatcher([/^chapter/, /appendix$/]);

    expect(matcher('chapter-one')).toBe(true);
    expect(matcher('end-appendix')).toBe(true);
    expect(matcher('unrelated')).toBe(false);
  });

  it('should reset global regex state between calls', () => {
    const matcher = common.createCommonMatcher([/chapter/g]);

    expect(matcher('chapter-one')).toBe(true);
    expect(matcher('chapter-two')).toBe(true);
    expect(matcher('unrelated')).toBe(false);
  });
});
