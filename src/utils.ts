import { promises as fspromises, Stats } from 'fs';
import debug from 'debug';
import 'colors'; // side-effect import, in utils because this file is imported across entry-points
import * as path from 'path';

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

export interface ConverterOptions {
  converterInputPath: string;
  converterOutputPath: string;
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

// /** Custom Error to test for to re-try */
// export class DownloadFailedError extends Error {
//   constructor(public url: URL, public code: number, public response: IncomingMessage) {
//     super(`URL "${url.toString()}" failed with code "${code}"`);
//   }
// }

// /**
//  * Download given url, without extra processing to the URL
//  * @param url The URL to download
//  * @param extraOptions Extra Options to pass to https
//  * @param withRateLimit Check & Wait for a Rate Limit
//  * @returns Downloaded buffer
//  */
// export async function downloadDirect(url: URL, extraOptions?: https.RequestOptions, withRateLimit?: RateLimit): Promise<Buffer> {
//   return new Promise(async (res, rej) => {
//     if (!isNullOrUndefined(withRateLimit)) {
//       if (withRateLimit.currentCounter >= withRateLimit.options.maxCount) {
//         log(`Waiting for RateLimit for "${url.toString()}"`);
//         await withRateLimit.waitfn();
//         log(`Waiting for RateLimit Finished for "${url.toString()}"`);
//       }

//       withRateLimit.currentCounter += 1;
//     }

//     // Downloading statement put after ratelimit, to make more sense in the log
//     log(`Downloading: "${url.toString()}", with rateLimit: ${!isNullOrUndefined(withRateLimit)}`);

//     const httpsOptions = extraOptions ?? {};

//     const cr = https.get(url.toString(), httpsOptions as any, (response) => {
//       log('Download Status Code: ', response.statusCode);

//       if (response.statusCode !== 200) {
//         rej(new DownloadFailedError(url, response.statusCode || 0, response));

//         return;
//       }

//       const chunks: any = [];

//       response.on('data', (chunk) => {
//         chunks.push(chunk);
//       });

//       response.on('error', (err) => {
//         rej(err);
//       });

//       response.on('end', () => {
//         log(`Download finished for "${url.toString()}"`);
//         res(Buffer.concat(chunks));
//       });
//     });

//     cr.on('error', (err) => {
//       rej(err);
//     });
//   });
// }

// /**
//  * Main Download function, follows redirects (up to 5)
//  * @param url The url to download
//  * @param extraOptions Extra Options to pass to https
//  * @param withRateLimit Check & Wait for a Rate Limit
//  * @returns Downloaded buffer
//  */
// export async function download(url: URL, extraOptions?: https.RequestOptions, withRateLimit?: RateLimit): Promise<Buffer> {
//   let currentURLObj = url;
//   let depth = 0;
//   let dnsfailurecount = 0;

//   // act like rust's "loop"
//   while (true) {
//     if (depth >= 5 || depth < 0) {
//       throw new Error('Redirect Depth (5) reached');
//     }

//     const buff: Buffer | Error | undefined = await downloadDirect(currentURLObj, extraOptions, withRateLimit).catch((err) => {
//       if (err instanceof DownloadFailedError) {
//         switch (err.code) {
//           // all redirect codes
//           case 301:
//           case 302:
//           case 303:
//           case 307:
//           case 308:
//             const redirectUrl = err.response.headers['location'];
//             assertionDefined(redirectUrl, new Error('Expected Status 308 to have "Location" header'));
//             assertion(typeof redirectUrl === 'string', new Error(`Expected redirectUrl to be a string, got "${typeof redirectUrl}"`));
//             log(`Redirect happened from "${currentURLObj}" to "${redirectUrl}"`);

//             currentURLObj = new URL(redirectUrl);
//             currentURLObj.protocol = 'https:'; // always force https
//             depth += 1;

//             return undefined;
//         }
//       }

//       return err;
//     });

//     if (isNullOrUndefined(buff)) {
//       depth += 1;
//       continue;
//     }

//     if (buff instanceof Error) {
//       // code "EAI_AGAIN" means DNS failure, so try again after some waiting
//       if ((buff as any)?.code === 'EAI_AGAIN') {
//         dnsfailurecount += 1;
//         log('Error "EAI_AGAIN" (DNS Failure) happened, waiting and trying again');

//         if (dnsfailurecount > 0 && dnsfailurecount % 5 === 0) {
//           console.log(`DNS Failure happened multiple times, waiting and trying again (dns failure count: ${dnsfailurecount})`.red);
//         }

//         await sleep(1000 * 5); // 5 seconds

//         continue;
//       }

//       throw buff;
//     }

//     return buff;
//   }
// }

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

// /** Common options for the {@link RateLimit} class */
// export interface RateLimitOptions {
//   /**
//    * The number of max tries before a reset in the waiter will be called (current unused)
//    * @default 3
//    */
//   failCount: number;
//   /**
//    * The time to use for the `setInterval` time, in ms
//    * @default 5000 5 seconds
//    */
//   intervalTime: number;
//   /**
//    * The time to use for waiting between waiting tries, in ms
//    * @default 10000 10 seconds
//    */
//   sleepTime: number;
//   /**
//    * The number to decrement the counter by in the interval
//    * @default 1
//    */
//   decrementCount: number;
//   /**
//    * Set the max number to allow before having to wait
//    * @default 60
//    */
//   maxCount: number;
// }

// /**
//  * RateLimit, to enforce RateLimits
//  */
// export class RateLimit {
//   /** The Current Count of how many request have been made without reduction */
//   public currentCounter: number = 0;
//   /** The Timer instance for reduction */
//   public timer?: NodeJS.Timer = undefined;

//   /** The options set in the constructor */
//   public readonly options: RateLimitOptions;

//   constructor(opts: Partial<RateLimitOptions>) {
//     this.options = {
//       failCount: opts.failCount ?? 5,
//       intervalTime: opts.intervalTime ?? 1000 * 5, // 5 seconds
//       sleepTime: opts.sleepTime ?? 1000 * 10, // 10 seconds
//       decrementCount: opts.decrementCount ?? 1,
//       maxCount: opts.maxCount ?? 60,
//     };
//   }

//   /** The function to use to determine and wait until a free space is available */
//   public async waitfn() {
//     return defaultRateLimitFn.call(this, this.options.sleepTime, this.options.failCount);
//   }

//   /** Reset the current instance of the timer and start it again */
//   public async reset() {
//     console.log('RateLimit reset called'.red);

//     if (!isNullOrUndefined(this.timer)) {
//       clearInterval(this.timer);
//     }

//     await this.createTimer();
//   }

//   /** Start the reduction timer */
//   public async createTimer() {
//     this.timer = setInterval(() => {
//       if (this.currentCounter > 0) {
//         this.currentCounter -= this.options.decrementCount;
//       }
//     }, this.options.intervalTime);
//   }

//   /**
//    * Function to clear / stop the current reduction timer
//    * This function will wait until "currentCounter" is "0" again
//    */
//   public async clearTimer() {
//     if (isNullOrUndefined(this.timer)) {
//       return;
//     }

//     while (this.currentCounter > 0) {
//       await this.waitfn();
//     }

//     clearInterval(this.timer);
//   }
// }

// /**
//  * Basic RateLimit Function to wait for the rate limit (input) to lower
//  * @param this The RateLimit Object
//  * @param sleepTime The Time to wait between tries
//  * @param fail The Times it can fail, before calling "reset" on "rl" (unused)
//  */
// export async function defaultRateLimitFn(this: RateLimit, sleepTime: number, fail: number): Promise<void> {
//   if (isNullOrUndefined(this.timer)) {
//     await this.createTimer();
//   }

//   let tries = 0;
//   while (this.currentCounter > this.options.maxCount) {
//     await sleep(sleepTime);
//     tries += 1;

//     if (tries >= fail) {
//       // await this.reset();
//       tries = 0;
//     }
//   }
// }

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
