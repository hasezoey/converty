import { describe, expect, it } from 'vitest';
import * as sh from '../../src/helpers/string.js';

describe('stringHelpers', () => {
  describe('stringFixSpaces', () => {
    it('should trim the input', () => {
      expect(sh.stringFixSpaces('  Hello World  ')).toBe('Hello World');
    });

    it('should replace multiple spaces with a single space', () => {
      expect(sh.stringFixSpaces('Hello    World')).toBe('Hello World');
    });

    it('should replace no-break spaces with normal spaces', () => {
      expect(sh.stringFixSpaces(`Hello\u00A0World`)).toBe('Hello World');
    });

    it('should combine all three behaviors', () => {
      expect(sh.stringFixSpaces(`  Hello\u00A0\u00A0   World  `)).toBe('Hello World');
    });

    it('should return an empty string for empty input', () => {
      expect(sh.stringFixSpaces('')).toBe('');
    });

    it('should combine trimming, no-break spaces and multiple whitespace', () => {
      expect(sh.stringFixSpaces('  \t Hello\u00A0\u00A0   World \t ')).toBe('Hello World');
    });
  });

  describe('xmlToString', () => {
    it('should decode basic xml entities', () => {
      expect(sh.xmlToString('a &amp; b')).toBe('a & b');
      expect(sh.xmlToString('5 &lt; 6')).toBe('5 < 6');
    });

    it('should decode numeric character references', () => {
      expect(sh.xmlToString(`It&#8217;s a &#8217;test&#8217;`)).toBe(`It\u2019s a \u2019test\u2019`);
      expect(sh.xmlToString('&#8220;quoted&#8221;')).toBe('\u201Cquoted\u201D');
    });
  });

  describe('stringToFilename', () => {
    it('should keep simple inputs cleaned up', () => {
      expect(sh.stringToFilename('Hello World')).toBe('Hello World');
    });

    it('should replace new lines with a space', () => {
      expect(sh.stringToFilename('Hello\nWorld')).toBe('Hello World');
    });

    it('should not keep path separators in the filename', () => {
      expect(sh.stringToFilename('Hello/Wor/ld')).not.toContain('/');
    });

    it('should replace path separators with a unicode fraction slash', () => {
      expect(sh.stringToFilename('Hello/Wor/ld')).toBe('Hello\u2044Wor\u2044ld');
    });

    it('should decode xml entities', () => {
      expect(sh.stringToFilename('A &amp; B')).toBe('A & B');
      expect(sh.stringToFilename('A &lt; B')).toBe('A < B');
    });
  });
});
