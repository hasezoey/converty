import * as utils from '../utils.js';
import * as ssc from '../common/sevenseascommon.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _log = utils.createNameSpace('genericSevenSeas_ln');

// STATIC OPTIONS
const VERIFIED_MATCH_LIST = [
  'I.{1}m the Evil Lord of an Intergalactic Empire!',
  '(?:Trapped in a Dating Sim.{1} The )?World of Otome Games is Tough for Mobs',
  'Reincarnated as a Sword',
  'Reborn as a Space Mercenary.{1} I Woke Up Piloting the Strongest Starship!',
];
const INPUT_MATCH_REGEX = new RegExp(VERIFIED_MATCH_LIST.join('|'), 'i');
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
