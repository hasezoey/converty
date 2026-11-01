import { describe, expect, it } from 'vitest';
import * as epubh from '../../src/helpers/epub.js';

describe('epubHelpers', () => {
  describe('normalizeId', () => {
    it('should strip invalid characters from the id', () => {
      expect(epubh.normalizeId('Hello World!')).toBe('HelloWorld');
      expect(epubh.normalizeId('  leading and trailing  ')).toBe('leadingandtrailing');
    });

    it('should keep valid characters like dashes, underscores and dots', () => {
      expect(epubh.normalizeId('Chapter_1 - The Beginning')).toBe('Chapter_1-TheBeginning');
    });

    it('should throw an error for ids that are completely invalid', () => {
      expect(() => epubh.normalizeId('!!!')).toThrowError(/Expected "replacedid" to have length > 0/);
    });
  });

  describe('BaseEpubOptions trackers', () => {
    interface ExtraTrackers extends epubh.BaseEpubContextTrackers {
      CurrentSeq: number;
    }

    it('should init trackers to "0" when being accessed', () => {
      const options = new epubh.BaseEpubOptions<ExtraTrackers>();

      expect(options.getTracker('Global')).toBe(0);
      expect(options.getTracker('CurrentSeq')).toBe(0);
    });

    it('should increment a tracker and return the new value', () => {
      const options = new epubh.BaseEpubOptions<ExtraTrackers>();

      expect(options.incTracker('Global')).toBe(1);
      expect(options.incTracker('Global')).toBe(2);
      expect(options.getTracker('Global')).toBe(2);
      expect(options.incTracker('CurrentSeq')).toBe(1);
    });

    it('should decrement a tracker and return the new value', () => {
      const options = new epubh.BaseEpubOptions<ExtraTrackers>();

      options.incTracker('Global');
      options.incTracker('Global');
      expect(options.decTracker('Global')).toBe(1);
      expect(options.getTracker('Global')).toBe(1);
      expect(options.decTracker('CurrentSeq')).toBe(0);
    });

    it('should reset a tracker to "0"', () => {
      const options = new epubh.BaseEpubOptions<ExtraTrackers>();

      options.incTracker('Global');
      options.incTracker('Global');
      expect(options.resetTracker('Global')).toBe(0);
      expect(options.getTracker('Global')).toBe(0);
    });

    it('should keep multiple trackers independent', () => {
      const options = new epubh.BaseEpubOptions<ExtraTrackers>();

      options.incTracker('Global');
      options.incTracker('CurrentSeq');

      expect(options.getTracker('Global')).toBe(1);
      expect(options.getTracker('CurrentSeq')).toBe(1);
    });
  });
});
