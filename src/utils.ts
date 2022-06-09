import * as https from 'https';
import { IncomingMessage } from 'http';
import { promises as fspromises, Stats } from 'fs';
import debug from 'debug';
import 'colors';
import path from 'path';
import { fileURLToPath } from 'url';

const log = createNameSpace('utils');

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

/** Custom Error to test for to re-try */
export class DownloadFailedError extends Error {
  constructor(public url: URL, public code: number, public response: IncomingMessage) {
    super(`URL "${url.toString()}" failed with code "${code}"`);
  }
}

/**
 * Download given url, without extra processing to the URL
 * @param url The URL to download
 * @param extraOptions Extra Options to pass to https
 * @param withRateLimit Check & Wait for a Rate Limit
 * @returns Downloaded buffer
 */
export async function downloadDirect(url: URL, extraOptions?: https.RequestOptions, withRateLimit?: RateLimit): Promise<Buffer> {
  return new Promise(async (res, rej) => {
    if (!isNullOrUndefined(withRateLimit)) {
      if (withRateLimit.currentCounter >= withRateLimit.maxCounter) {
        log(`Waiting for RateLimit for "${url.toString()}"`);
        await withRateLimit.waitfn();
        log(`Waiting for RateLimit Finished for "${url.toString()}"`);
      }

      withRateLimit.currentCounter += 1;
    }

    // Downloading statement put after ratelimit, to make more sense in the log
    log(`Downloading: "${url.toString()}", with rateLimit: ${!isNullOrUndefined(withRateLimit)}`);

    const httpsOptions = extraOptions ?? {};

    https.get(url.toString(), httpsOptions as any, (response) => {
      log('Download Status Code: ', response.statusCode);

      if (response.statusCode !== 200) {
        rej(new DownloadFailedError(url, response.statusCode || 0, response));

        return;
      }

      const chunks: any = [];

      response.on('data', (chunk) => {
        chunks.push(chunk);
      });

      response.on('error', (err) => {
        rej(err);
      });

      response.on('end', () => {
        log(`Download finished for "${url.toString()}"`);
        res(Buffer.concat(chunks));
      });
    });
  });
}

/**
 * Main Download function, follows redirects (up to 5)
 * @param url The url to download
 * @param extraOptions Extra Options to pass to https
 * @param withRateLimit Check & Wait for a Rate Limit
 * @returns Downloaded buffer
 */
export async function download(url: URL, extraOptions?: https.RequestOptions, withRateLimit?: RateLimit): Promise<Buffer> {
  const actualURL = url;
  let depth = 0;

  // act like rust's "loop"
  while (true) {
    if (depth >= 5 || depth < 0) {
      throw new Error('Redirect Depth (5) reached');
    }

    const buff: Buffer | Error | undefined = await downloadDirect(actualURL, extraOptions, withRateLimit).catch((err) => {
      if (err instanceof DownloadFailedError) {
        switch (err.code) {
          case 301:
          case 302:
          case 303:
          case 307:
          case 308:
            console.log('TEST REDIRECT'.red, err.response);

            throw new Error('Redirect unimplemented');

            return undefined;
        }
      }

      return err;
    });

    if (isNullOrUndefined(buff)) {
      depth += 1;
      continue;
    }

    if (buff instanceof Error) {
      throw buff;
    }

    return buff;
  }
}

/**
 * Apply a "args" to "input" string
 * @param input The Input which needs to be formatted
 * @param args The Arguments to format "input" with
 * @returns The Formatted input
 */
export function template(input: string, args: Record<string, any>): string {
  for (const { 0: key, 1: value } of Object.entries(args)) {
    log(`Template for key: "${key[0]}"`);
    input.replaceAll(`<${key.toUpperCase()}>`, value);
  }

  return input;
}

export async function mkdir(path: string): Promise<void> {
  await fspromises.mkdir(path, { recursive: true });
}

export async function write_file(file: string, content: string | Buffer): Promise<void> {
  await fspromises.writeFile(file, content);
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
 * Like "fs.existsSync" but async
 * uses "utils.statPath"
 * follows symlinks
 * @param path The Path to check for
 */
export async function pathExists(path: string): Promise<boolean> {
  return !isNullOrUndefined(await statPath(path));
}

/**
 * RateLimit, to enforce RateLimits
 */
export abstract class RateLimit {
  public currentCounter: number = 0;
  public abstract maxCounter: number;
  public timer?: NodeJS.Timer = undefined;

  public abstract waitfn(): Promise<void>;
  public abstract reset(): Promise<void>;
  public abstract createTimer(): Promise<void>;

  public async clearTimer() {
    if (isNullOrUndefined(this.timer)) {
      return;
    }

    while (this.currentCounter > 0) {
      await this.waitfn();
    }

    clearInterval(this.timer);
  }
}

/**
 * Basic RateLimit Function to wait for the rate limit (input) to lower
 * @param time The Time to wait between checks
 * @param reset The Times it can fail, before calling "reset" on "rl"
 * @param rl The RateLimit Object
 */
export async function defaultRateLimitFn(this: RateLimit, time: number, fail: number): Promise<void> {
  if (isNullOrUndefined(this.timer)) {
    await this.createTimer();
  }

  let tries = 0;
  while (this.currentCounter >= this.maxCounter) {
    await sleep(time);
    tries += 1;

    if (tries >= fail) {
      // await this.reset();
      tries = 0;
    }
  }
}

/**
 * Create a "debug" namespace, without extra imports
 * @param ns the namespace
 * @returns a debugger
 */
export function createNameSpace(ns: string): debug.Debugger {
  return debug(`scraper:${ns}`);
}

/**
 * Conver the input "import.meta.url" to the dirname
 * @param currentURL the file url, as returned by "import.meta.url"
 * @returns the dirname of "import.meta.url" and converted to path
 */
export function getCurrentModuleDirectory(currentURL: string): string {
  return path.dirname(fileURLToPath(currentURL));
}
