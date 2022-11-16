import * as utils from '../utils.js';
import * as tmp from 'tmp';
import * as ssc from '../common/sevenseascommon.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _log = utils.createNameSpace('reassword_ln');

tmp.setGracefulCleanup();

// STATIC OPTIONS
const INPUT_MATCH_REGEX = /Reincarnated as a Sword/gim;
/** Regex of files to filter out (to not include in the output) */
const FILES_TO_FILTER_OUT_REGEX = ssc.DEFAULT_FILES_TO_FILTER_OUT_REGEX;
const TITLES_TO_FILTER_OUT_REGEX = ssc.DEFAULT_TITLES_TO_FILTER_OUT_REGEX;

// CODE

// EXPORTS
export const matcher = ssc.matcher(INPUT_MATCH_REGEX);

export default function averbil_ln(): utils.ConverterModule {
  return { matcher, process };
}

export async function process(options: utils.ConverterOptions): Promise<string> {
  return ssc.process(options, {
    FilesToFilter: FILES_TO_FILTER_OUT_REGEX,
    TitlesToFilter: TITLES_TO_FILTER_OUT_REGEX,
  });
}
