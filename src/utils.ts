import { mkdtempSync, promises as fspromises, Stats } from 'fs';
import debug from 'debug';
import 'colors'; // side-effect import, in utils because this file is imported across entry-points
import * as path from 'path';
import { tmpdir } from 'node:os';

const log = createNameSpace('utils');

/** Default Search depth for recursive search-functions */
export const DEFAULT_SEARCH_DEPTH = 3;

export interface ConverterModuleStore extends ConverterModule {
  /** File Name of the module */
  name: string;
}

export interface ConverterModule {
  /**
   * Function to identify a input for a module
   * @param name The full path of the input path to match a module for
   * @return Wheter the current module is able to process the file
   */
  matcher(name: string): boolean;
  /** Function called when everything is ready (before processing any inputs) */
  ready?(): Promise<void>;
  /**
   * Function to process a input with a module
   * @param options The required input options
   * @returns The finished Path
   */
  process(options: ConverterOptions): Promise<string>;
}

/** Options provided on where the input path is and where paths should be output to */
export interface ConverterOptions {
  /** The General input path of the converty package (directory) */
  converterInputPath: string;
  /** The General output path of the converty package (directory) */
  converterOutputPath: string;
  /** The Path of the input that has been detected, either a directory or a file */
  fileInputPath: string;
}

/**
 * "setTimeout" promisified
 */
export async function sleep(waitTime: number): Promise<void> {
  return new Promise((res) => {
    log('sleep for', waitTime);
    setTimeout(res, waitTime);
  });
}

/**
 * Assert an condition, if "false" throw error
 * Note: it is not named "assert" to differentiate between node and jest types
 * @param cond The Condition to throw
 * @param error An Custom Error to throw
 */
export function assertion(cond: any, error?: Error): asserts cond {
  if (!cond) {
    throw error ?? new Error('No Error');
  }
}

/**
 * Assert that "val" is defined (combines "assertions" and "isNullOrUndefined")
 * @param val The Value to check
 * @param error Custom Error
 */
export function assertionDefined<T>(val: T | undefined | null, error?: Error): asserts val is NonNullable<T> {
  assertion(!isNullOrUndefined(val), error ?? new Error("Expected 'val' to be defined"));
}

/**
 * Because since node 4.0.0 the internal util.is* functions got deprecated
 * @param val Any value to test if null or undefined
 */
export function isNullOrUndefined(val: unknown): val is null | undefined {
  return val === null || val === undefined;
}

/**
 * FS Async mkdir with recursive already set
 * @param path The Path to recursively create
 */
export async function mkdir(path: string): Promise<void> {
  await fspromises.mkdir(path, { recursive: true });
}

/**
 * Run "fs.promises.stat", but return "undefined" if error is "ENOENT" or "EACCES"
 * follows symlinks
 * @param path The Path to Stat
 * @throws if the error is not "ENOENT" or "EACCES"
 */
export async function statPath(path: string): Promise<Stats | undefined> {
  return fspromises.stat(path).catch((err) => {
    // catch the error if the directory doesn't exist or permission is denied, without throwing an error
    if (['ENOENT', 'EACCES'].includes(err.code)) {
      return undefined;
    }

    throw err;
  });
}

/**
 * Run "fs.promises.lstat", but return "undefined" if error is "ENOENT" or "EACCES"
 * follows symlinks
 * @param path The Path to Stat
 * @throws if the error is not "ENOENT" or "EACCES"
 */
export async function lstatPath(path: string): Promise<Stats | undefined> {
  return fspromises.lstat(path).catch((err) => {
    // catch the error if the directory doesn't exist or permission is denied, without throwing an error
    if (['ENOENT', 'EACCES'].includes(err.code)) {
      return undefined;
    }

    throw err;
  });
}

/**
 * Like "fs.existsSync" but async
 * uses "utils.statPath"
 * follows symlinks
 * @param path The Path to check for
 */
export async function pathExists(path: string): Promise<boolean> {
  return !isNullOrUndefined(await statPath(path));
}

/**
 * Create a "debug" namespace, without extra imports
 * @param ns the namespace
 * @returns a debugger
 */
export function createNameSpace(ns: string): debug.Debugger {
  return debug(`converty:${ns}`);
}

/**
 * Consistently parse "cN"("c1") to a number without throwing
 * @param input The input to try to parse
 * @returns The Parsed number or undefined
 */
export function parseChapterInputToNumber(input: string | number | undefined): number | undefined {
  if (isNullOrUndefined(input)) {
    return undefined;
  }
  if (typeof input === 'number') {
    return input;
  }

  // just in case something other gets here
  if (typeof input !== 'string') {
    return undefined;
  }

  if (input.length === 0) {
    return undefined;
  }

  try {
    let int: number;

    // not all regex output will include a starting "c" but the number directly
    if (input.startsWith('c')) {
      int = parseInt(input.substring(1));
    } else {
      int = parseInt(input);
    }

    // specific to chapter handling
    if (Number.isNaN(int) || int < 0) {
      return undefined;
    }

    return int;
  } catch (err) {
    // ignore error
  }

  return undefined;
}

/**
 * Search for "combinerConfig.json" files to at most "currentDepth" deep
 * @param startPath The path to search at (recursive)
 * @param filename The filename to search for
 * @param currentDepth The depth to how much to search deep
 * @returns The array of found files or undefined
 */
export async function searchForFile(
  startPath: string,
  filename: string,
  currentDepth: number = DEFAULT_SEARCH_DEPTH
): Promise<string[] | undefined> {
  if (currentDepth <= 0) {
    return undefined;
  }

  if (!(filename.length > 0)) {
    throw new Error('"filename" length needs to be 1 or above');
  }

  const stat = await statPath(startPath);

  if (isNullOrUndefined(stat)) {
    return undefined;
  }
  if (stat.isFile()) {
    if (path.basename(startPath) === filename) {
      return [startPath];
    }
  }
  if (stat.isDirectory()) {
    const arr: string[] = [];
    for (const entry of await fspromises.readdir(startPath)) {
      const ret = await searchForFile(path.resolve(startPath, entry), filename, currentDepth - 1);

      if (isNullOrUndefined(ret)) {
        continue;
      }

      arr.push(...ret);
    }

    return arr.length > 0 ? arr : undefined;
  }

  return undefined;
}

/**
 * Helper to get regex match groups, which are required with consistent error
 * @param match The Regex Match output Array
 * @param groupName The Group to get
 * @returns The Match from the Group, or throws a Error that the group is required
 */
export function regexMatchGroupRequired(match: RegExpMatchArray, groupName: string, context: string): string {
  const group = regexMatchGroup(match, groupName);

  assertionDefined(group, new Error(`Expected Regex Group "${groupName}" to be in the match (context: ${context})`));

  return group;
}

/**
 * Helper to match the "Required" version, just without error (basically a alias)
 * @param match The Regex Match output Array
 * @param groupName The Group to get
 * @returns The Match from the Group, or undefined
 */
export function regexMatchGroup(match: RegExpMatchArray, groupName: string): string | undefined {
  return match.groups?.[groupName];
}

/**
 * Create a Temporary directory with prefix, and optionally at "atPath"
 * @param prefix The prefix to use to create the tmpdir
 * @param atPath Optionally set a custom path other than "os.tmpdir"
 * @returns The created Path
 */
export async function createTmpDir(prefix: string, atPath?: string): Promise<string> {
  const tmpPath = atPath ?? tmpdir();

  return fspromises.mkdtemp(path.join(tmpPath, prefix));
}

/**
 * Create a Temporary directory with prefix, and optionally at "atPath" using sync methods
 * @param prefix The prefix to use to create the tmpdir
 * @param atPath Optionally set a custom path other than "os.tmpdir"
 * @returns The created Path
 */
export function createTmpDirSync(prefix: string, atPath?: string): string {
  const tmpPath = atPath ?? tmpdir();

  return mkdtempSync(path.join(tmpPath, prefix));
}

/**
 * Removes the given "path", if it is a directory, and does not throw a error if not existing
 * @param dirPath The Directory Path to delete
 * @returns "true" if deleted, otherwise "false"
 */
export async function removeDir(dirPath: string): Promise<void> {
  const stat = await statPath(dirPath);

  if (isNullOrUndefined(stat)) {
    return;
  }

  if (!stat.isDirectory()) {
    throw new Error(`Given Path is not a directory! (Path: "${dirPath}")`);
  }

  // only since NodeJS 14
  await fspromises.rm(dirPath, { force: true, recursive: true });
}

/**
 * Convert "1, on, yes, true" to true (otherwise false)
 * @param env The String / Environment Variable to check
 */
export function envToBool(env: string = ''): boolean {
  if (typeof env !== 'string') {
    log('envToBool: input was not a string!');

    return false;
  }

  return ['1', 'on', 'yes', 'true'].indexOf(env.toLowerCase()) !== -1;
}

/**
 * Check whether debug inspect is enabled or not
 */
export function debugOutputEnabled(): boolean {
  return envToBool(process.env['DEBUG_OUTPUT']);
}
