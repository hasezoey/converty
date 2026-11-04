import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { existsSync, promises as fspromises } from 'fs';
import * as path from 'path';
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

    it('should return "false" for non-string inputs', () => {
      expect(utils.envToBool(null as any)).toBe(false);
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
      expect(utils.parseChapterInputToNumber('c')).toBeUndefined();
      expect(utils.parseChapterInputToNumber(undefined)).toBeUndefined();
    });

    it('should return "undefined" for non-string, non-number inputs', () => {
      expect(utils.parseChapterInputToNumber({} as any)).toBeUndefined();
    });

    it('should parse the leading number of a chapter input', () => {
      expect(utils.parseChapterInputToNumber('c12.5')).toBe(12);
      expect(utils.parseChapterInputToNumber(' 7 rest')).toBe(7);
    });
  });

  describe('assertion', () => {
    it('should not throw an error when the condition is true', () => {
      expect(() => utils.assertion(true)).not.toThrow();
    });

    it('should throw the default error when the condition is false', () => {
      expect(() => utils.assertion(false)).toThrow('No Error');
    });

    it('should throw a custom error when the condition is false', () => {
      expect(() => utils.assertion(false, new Error('Custom Assertion Error'))).toThrow('Custom Assertion Error');
    });
  });

  describe('assertionDefined', () => {
    it('should not throw an error when the value is defined', () => {
      expect(() => utils.assertionDefined('value')).not.toThrow();
    });

    it('should not throw an error when the value is defined but falsy', () => {
      expect(() => utils.assertionDefined('')).not.toThrow();
      expect(() => utils.assertionDefined(0)).not.toThrow();
      expect(() => utils.assertionDefined(false)).not.toThrow();
    });

    it('should throw an error when the value is undefined', () => {
      expect(() => utils.assertionDefined(undefined)).toThrow(/Expected 'val' to be defined/);
    });

    it('should throw an error when the value is null', () => {
      expect(() => utils.assertionDefined(null)).toThrow(/Expected 'val' to be defined/);
    });
  });

  describe('isNullOrUndefined', () => {
    it('should detect "null" and "undefined"', () => {
      expect(utils.isNullOrUndefined(null)).toBe(true);
      expect(utils.isNullOrUndefined(undefined)).toBe(true);
    });

    it('should not detect other values as nullish', () => {
      expect(utils.isNullOrUndefined(0)).toBe(false);
      expect(utils.isNullOrUndefined('')).toBe(false);
      expect(utils.isNullOrUndefined(false)).toBe(false);
    });
  });

  describe('sleep', () => {
    it('should resolve once the given wait time is over', async () => {
      await expect(utils.sleep(1)).resolves.toBeUndefined();
    });
  });

  describe('debugOutputEnabled', () => {
    afterEach(() => {
      delete process.env['DEBUG_OUTPUT'];
    });

    it('should return "true" when "DEBUG_OUTPUT" is enabled', () => {
      process.env['DEBUG_OUTPUT'] = '1';

      expect(utils.debugOutputEnabled()).toBe(true);
    });

    it('should return "false" when "DEBUG_OUTPUT" is disabled', () => {
      process.env['DEBUG_OUTPUT'] = '0';

      expect(utils.debugOutputEnabled()).toBe(false);
    });
  });

  describe('statPath', () => {
    it.concurrent('should return "undefined" for a path that does not exist', async () => {
      expect(await utils.statPath('/converty/does/not/exist')).toBeUndefined();
    });

    it.concurrent('should return the stats of an existing path', async () => {
      const stat = await utils.statPath(process.cwd());

      expect(stat).toBeDefined();
      expect(stat?.isDirectory()).toBe(true);
    });
  });

  describe('lstatPath', () => {
    const cleanupPaths: string[] = [];

    afterAll(async () => {
      for (const cleanupPath of cleanupPaths) {
        await utils.removeDir(cleanupPath);
      }
    });

    it.concurrent('should return "undefined" for a path that does not exist', async () => {
      expect(await utils.lstatPath('/converty/does/not/exist')).toBeUndefined();
    });

    it.concurrent('should return the stats without following symlinks', async () => {
      const tmpDir = await utils.createTmpDir('converty-test-');
      cleanupPaths.push(tmpDir);

      const targetPath = path.join(tmpDir, 'target.txt');
      const linkPath = path.join(tmpDir, 'link.txt');

      await fspromises.writeFile(targetPath, 'test');
      await fspromises.symlink(targetPath, linkPath);

      const linkStat = await utils.lstatPath(linkPath);

      expect(linkStat?.isSymbolicLink()).toBe(true);
    });
  });

  describe('pathExists', () => {
    it('should return "true" for existing paths', async () => {
      expect(await utils.pathExists(process.cwd())).toBe(true);
    });

    it('should return "false" for non-existing paths', async () => {
      expect(await utils.pathExists('/converty/does/not/exist')).toBe(false);
    });
  });

  describe('mkdir', () => {
    let tmpDir: string;

    afterEach(async () => {
      if (!utils.isNullOrUndefined(tmpDir)) {
        await utils.removeDir(tmpDir);
      }
    });

    it('should create nested directories', async () => {
      tmpDir = await utils.createTmpDir('converty-test-');
      const newPath = path.join(tmpDir, 'nested', 'deeper');

      await utils.mkdir(newPath);

      expect(await utils.pathExists(newPath)).toBe(true);
    });
  });

  describe('createTmpDir', () => {
    let tmpDir: string;

    afterEach(async () => {
      if (!utils.isNullOrUndefined(tmpDir)) {
        await utils.removeDir(tmpDir);
      }
    });

    it('should create a temporary directory', async () => {
      tmpDir = await utils.createTmpDir('converty-test-');

      expect(await utils.pathExists(tmpDir)).toBe(true);
    });

    it('should create the temporary directory in the given path', async () => {
      tmpDir = await utils.createTmpDir('converty-test-');
      const nestedTmpDir = await utils.createTmpDir('nested-', tmpDir);

      expect(await utils.pathExists(nestedTmpDir)).toBe(true);
      expect(path.dirname(nestedTmpDir)).toBe(tmpDir);
    });
  });

  describe('createTmpDirSync', () => {
    let tmpDir: string;

    afterEach(async () => {
      if (!utils.isNullOrUndefined(tmpDir)) {
        await utils.removeDir(tmpDir);
      }
    });

    it('should create a temporary directory synchronously', () => {
      tmpDir = utils.createTmpDirSync('converty-test-');

      expect(existsSync(tmpDir)).toBe(true);
    });

    it('should create the temporary directory in the given path', () => {
      tmpDir = utils.createTmpDirSync('converty-test-');
      const nestedTmpDir = utils.createTmpDirSync('nested-', tmpDir);

      expect(existsSync(nestedTmpDir)).toBe(true);
      expect(path.dirname(nestedTmpDir)).toBe(tmpDir);
    });
  });

  describe('removeDir', () => {
    let tmpDir: string;

    afterEach(async () => {
      if (!utils.isNullOrUndefined(tmpDir)) {
        await utils.removeDir(tmpDir);
      }
    });

    it('should remove an existing directory', async () => {
      tmpDir = await utils.createTmpDir('converty-test-');

      await utils.removeDir(tmpDir);

      expect(await utils.pathExists(tmpDir)).toBe(false);
    });

    it('should not throw for a path that does not exist', async () => {
      await expect(utils.removeDir('/converty/does/not/exist')).resolves.toBeUndefined();
    });

    it('should throw when the path is not a directory', async () => {
      tmpDir = await utils.createTmpDir('converty-test-');
      const filePath = path.join(tmpDir, 'file.txt');

      await fspromises.writeFile(filePath, 'test');

      await expect(utils.removeDir(filePath)).rejects.toThrow(/Given Path is not a directory/);
    });
  });

  describe('regexMatchGroup', () => {
    it('should return the matched named group', () => {
      const match = /(?<mygroup>Test)/.exec('Some Test Value');

      expect(utils.regexMatchGroup(match!, 'mygroup')).toBe('Test');
    });

    it('should return "undefined" if the named group did not match', () => {
      const match = /(?<othergroup>Test)/.exec('Some Test Value');

      expect(utils.regexMatchGroup(match!, 'mygroup')).toBeUndefined();
    });
  });

  describe('regexMatchGroupRequired', () => {
    it('should return the matched named group', () => {
      const match = /(?<mygroup>Test)/.exec('Some Test Value');

      expect(utils.regexMatchGroupRequired(match!, 'mygroup', 'some context')).toBe('Test');
    });

    it('should throw an error if the named group did not match', () => {
      const match = /(?<othergroup>Test)/.exec('Some Test Value');

      expect(() => utils.regexMatchGroupRequired(match!, 'mygroup', 'some context')).toThrow(
        /Expected Regex Group "mygroup" to be in the match/
      );
    });
  });

  describe('searchForFile', () => {
    const cleanupPaths: string[] = [];

    afterAll(async () => {
      for (const cleanupPath of cleanupPaths) {
        await utils.removeDir(cleanupPath);
      }
    });

    it.concurrent('should throw an error for an empty filename', async () => {
      await expect(utils.searchForFile(process.cwd(), '')).rejects.toThrow(/"filename" length needs to be 1 or above/);
    });

    it.concurrent('should return "undefined" for a depth of 0', async () => {
      expect(await utils.searchForFile(process.cwd(), 'package.json', 0)).toBeUndefined();
    });

    it.concurrent('should find a file within the search depth', async () => {
      const tmpDir = await utils.createTmpDir('converty-test-');
      cleanupPaths.push(tmpDir);

      const subDir = path.join(tmpDir, 'sub');

      await utils.mkdir(subDir);
      await fspromises.writeFile(path.join(subDir, 'combinerConfig.json'), '{}');

      const found = await utils.searchForFile(tmpDir, 'combinerConfig.json');

      expect(found).toHaveLength(1);
      expect(found?.[0]).toContain('combinerConfig.json');
    });

    it.concurrent('should find a file when the start path is the file itself', async () => {
      const tmpDir = await utils.createTmpDir('converty-test-');
      cleanupPaths.push(tmpDir);

      const filePath = path.join(tmpDir, 'combinerConfig.json');

      await fspromises.writeFile(filePath, '{}');

      expect(await utils.searchForFile(filePath, 'combinerConfig.json')).toEqual([filePath]);
    });

    it.concurrent('should return "undefined" when the start path is a different file', async () => {
      const tmpDir = await utils.createTmpDir('converty-test-');
      cleanupPaths.push(tmpDir);

      const filePath = path.join(tmpDir, 'other.json');

      await fspromises.writeFile(filePath, '{}');

      expect(await utils.searchForFile(filePath, 'combinerConfig.json')).toBeUndefined();
    });

    it.concurrent('should return "undefined" for a path that does not exist', async () => {
      expect(await utils.searchForFile('/converty/does/not/exist', 'combinerConfig.json')).toBeUndefined();
    });

    it.concurrent('should find multiple files within the search depth', async () => {
      const tmpDir = await utils.createTmpDir('converty-test-');
      cleanupPaths.push(tmpDir);

      const firstDir = path.join(tmpDir, 'first');
      const secondDir = path.join(tmpDir, 'second');

      await utils.mkdir(firstDir);
      await utils.mkdir(secondDir);
      await fspromises.writeFile(path.join(firstDir, 'combinerConfig.json'), '{}');
      await fspromises.writeFile(path.join(secondDir, 'combinerConfig.json'), '{}');

      const found = await utils.searchForFile(tmpDir, 'combinerConfig.json');

      expect(found).toHaveLength(2);
    });
  });
});
