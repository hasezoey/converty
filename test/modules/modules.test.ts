import { describe, expect, it } from 'vitest';
import averbil_ln from '../../src/modules/averbil_ln.js';
import genericCopy_ln from '../../src/modules/genericCopy_ln.js';
import genericSevenSeas_ln from '../../src/modules/genericSevenSeas_ln.js';
import lastofkind_ln from '../../src/modules/lastofkind_ln.js';

describe('modules', () => {
  describe('module shape', () => {
    const modules = {
      averbil_ln,
      genericCopy_ln,
      genericSevenSeas_ln,
      lastofkind_ln,
    };

    for (const [name, moduleFn] of Object.entries(modules)) {
      it(`should return a valid module from "${name}"`, () => {
        const module = moduleFn();

        expect(typeof module.matcher).toBe('function');
        expect(typeof module.process).toBe('function');
      });
    }
  });

  describe('averbil_ln matcher', () => {
    const matcher = averbil_ln().matcher;

    it('should match supported series names', () => {
      expect(matcher("Didn't I Say to Make My Abilities Average Vol. 1")).toBe(true);
      expect(matcher('didn\u2019t i say to make my abilities average!')).toBe(true);
    });

    it('should not match the spin-off series', () => {
      expect(matcher("Didn't I Say to Make My Abilities Average: Everyday Misadventures")).toBe(false);
    });

    it('should not match unrelated names', () => {
      expect(matcher('Some Other Series Vol. 1')).toBe(false);
    });
  });

  describe('genericCopy_ln matcher', () => {
    const matcher = genericCopy_ln().matcher;

    it('should match supported series names', () => {
      expect(matcher('Death March to the Parallel World Rhapsody Vol. 1')).toBe(true);
      expect(matcher('High School Prodigies Have It Easy Even in Another World!')).toBe(true);
      expect(matcher('So You Want to Live the Slow Life? A Guide to Life in the Beastly Wilds')).toBe(true);
    });

    it('should not match unrelated names', () => {
      expect(matcher('Some Other Series Vol. 1')).toBe(false);
    });

    it('should reset the regex state after every check', () => {
      expect(matcher('Death March to the Parallel World Rhapsody Vol. 1')).toBe(true);
      expect(matcher('Death March to the Parallel World Rhapsody Vol. 1')).toBe(true);
    });
  });

  describe('genericSevenSeas_ln matcher', () => {
    const matcher = genericSevenSeas_ln().matcher;

    it('should match supported series names', () => {
      expect(matcher("I'm the Evil Lord of an Intergalactic Empire!")).toBe(true);
      expect(matcher('Reincarnated as a Sword Vol. 1')).toBe(true);
      expect(matcher('Modern Dungeon Capture Starting with Broken Skills')).toBe(true);
    });

    it('should not match unrelated names', () => {
      expect(matcher('Some Other Series Vol. 1')).toBe(false);
    });
  });

  describe('lastofkind_ln matcher', () => {
    const matcher = lastofkind_ln().matcher;

    it('should match supported series names', () => {
      expect(matcher('Reincarnated as the Last of My Kind Vol. 1')).toBe(true);
    });

    it('should not match unrelated names', () => {
      expect(matcher('Some Other Series Vol. 1')).toBe(false);
    });

    it('should reset the regex state after every check', () => {
      expect(matcher('Reincarnated as the Last of My Kind Vol. 1')).toBe(true);
      expect(matcher('Reincarnated as the Last of My Kind Vol. 1')).toBe(true);
    });
  });
});
