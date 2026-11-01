import { describe, expect, it } from 'vitest';
import * as utils from '../src/utils.js';

describe('utils', () => {
  describe('envToBool', () => {
    it('should return "true" for truthy input values', () => {
      expect(utils.envToBool('1')).toBe(true);
      expect(utils.envToBool('true')).toBe(true);
      expect(utils.envToBool('yes')).toBe(true);
      expect(utils.envToBool('on')).toBe(true);
    });

    it('should return "false" for falsy input values', () => {
      expect(utils.envToBool('0')).toBe(false);
      expect(utils.envToBool('false')).toBe(false);
      expect(utils.envToBool('no')).toBe(false);
      expect(utils.envToBool('off')).toBe(false);
      expect(utils.envToBool('')).toBe(false);
    });
  });

  describe('parseChapterInputToNumber', () => {
    it('should parse a chapter input number', () => {
      expect(utils.parseChapterInputToNumber('c1')).toBe(1);
      expect(utils.parseChapterInputToNumber('42')).toBe(42);
      expect(utils.parseChapterInputToNumber(3)).toBe(3);
    });

    it('should return "undefined" for invalid chapter inputs', () => {
      expect(utils.parseChapterInputToNumber('invalid')).toBeUndefined();
      expect(utils.parseChapterInputToNumber('c-1')).toBeUndefined();
      expect(utils.parseChapterInputToNumber('')).toBeUndefined();
      expect(utils.parseChapterInputToNumber(undefined)).toBeUndefined();
    });
  });
});
