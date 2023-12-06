import * as utils from '../utils.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const log = utils.createNameSpace('stringHelpers');

/**
 * Process "input" to read-able and consistent characters
 * @param input The input to process
 * @returns The processed input
 */
export function stringFixSpaces(input: string): string {
  return input
    .replaceAll(' ', ' ') // replace "no-break space" with normal spaces
    .replaceAll(/\s\s+/gim, ' ') // replace multiple spaces to one
    .trim();
}

/**
 * Convert input to filename consumable title
 * @param input The input to process
 */
export function stringToFilename(input: string): string {
  return stringFixSpaces(
    xmlToString(input)
      // do the following before "replaceAllForPlainText" because that function replaces multiple spaces to one
      .replaceAll(/\n|\\n/gim, ' ') // replace new lines with nothing
      .replaceAll(/\//gim, '⁄') // replace "/" with a character that looks similar (otherwise it would result in a directory)
      .trim()
  );
}

/**
 * Replace xml placeholders with actual characters
 * @param input The input to Process
 */
export function xmlToString(input: string): string {
  return input
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;"', '>')
    .replaceAll('&amp;', '&')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&#8217;', '’')
    .replaceAll('&#8220;', '“')
    .replaceAll('&#8221;', '”');
}
