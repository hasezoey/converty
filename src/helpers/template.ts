import path from 'path';
import { fileURLToPath } from 'url';
import * as utils from '../utils.js';
import { promises as fspromises } from 'fs';

const log = utils.createNameSpace('templateHelpers');

/**
 * Templates from "templates/"
 */
const templates: Map<string, string> = new Map();

/**
 * Handle getting templates from cache or from file
 * @param filename The filename in the "templates/" directory
 * @returns The loaded file
 * @throws {Error} If path does not exist
 * @throws {Error} If path is not a file
 */
export async function getTemplate(filename: string): Promise<string> {
  log(`Loading Template "${filename}"`);
  {
    const got = templates.get(filename);

    if (!utils.isNullOrUndefined(got)) {
      return got;
    }
  }

  const filePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../', 'templates', filename);
  const stat = await utils.statPath(filePath);

  if (utils.isNullOrUndefined(stat)) {
    throw new Error(`Could not find template path "${filePath}"`);
  }
  if (!stat.isFile()) {
    throw new Error(`Template Path is not a file! "${filePath}"`);
  }

  const loaded = (await fspromises.readFile(filePath)).toString();

  templates.set(filename, loaded);

  return loaded;
}

/**
 * Clear all current cached Templates
 */
export function clearTemplates(): void {
  templates.clear();
}

/**
 * Apply a "args" to "input" string
 * @param input The Input which needs to be formatted
 * @param args The Arguments to format "input" with
 * @returns The Formatted input
 */
export function applyTemplate(input: string, args: Record<string, any>): string {
  for (const [key, value] of Object.entries(args)) {
    log(`Template for key: "${key}"`);
    input = input.replaceAll(key, value);
  }

  return input;
}
