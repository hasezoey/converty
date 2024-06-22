import * as utils from '../utils.js';
import * as epubh from '../helpers/epub.js';
import * as ssc from '../common/sevenseascommon.js';

const log = utils.createNameSpace('averbil_ln');

// STATIC OPTIONS
const INPUT_MATCH_REGEX = /Didn.{1}t I Say to Make My Abilities Average(?!: Everyday Misadventures)/gim;
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
    getTitleHook(retObj, type) {
      if (
        ssc
          .processTitles([
            // the following is already handled by "sevenseascommon"
            // 'Copyrights and Credits',
            // 'Table of Contents Page',
            // 'Color Inserts',
            // 'Title Page',
            'Cast of Characters',
            'Characters',
          ])
          .includes(type.toLowerCase().replaceAll(/\s/g, ''))
      ) {
        retObj.imgType = epubh.ImgType.Frontmatter;
      }
    },
    checkElement(elem, entryType) {
      if (entryType.title.includes('Short Story')) {
        if (elem.className.includes('P__STAR__STAR__STAR__page_break')) {
          return true;
        }
      }

      return false;
    },
    genChapterHeaderContent(document, entryType, h1Element, documentInput) {
      // extra handling for double-headings, see Volume 1 Short-Stories
      if (entryType.title.includes('Short Story')) {
        const firstElement = documentInput.querySelector('body > p');

        utils.assertionDefined(firstElement, new Error('Expected "firstElement" to be defined'));

        // for now it should be enough to just deal with 1 extra element
        if (!firstElement.textContent?.includes('Short Story')) {
          log('Encountered a Short Story which does not start with the chapter');

          utils.assertionDefined(firstElement.textContent, new Error('Expected "firstElement.textContent" to be defined'));
          h1Element.appendChild(document.createTextNode(firstElement.textContent));
          h1Element.appendChild(document.createElement('br'));
        }
      }

      ssc.genChapterHeaderContent(document, entryType, h1Element);
    },
    // custom hook to ignore some combining with previous elements, because for example volume 5 chapter 45
    // has some things which look the same as those that should be combined
    // and the only differentiator is that those nodes are not just plain text (wrapped in em)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    generatePElementCombineHook(lastnode, _elems) {
      for (const child of lastnode.childNodes) {
        if (child.nodeType !== lastnode.TEXT_NODE) {
          return true;
        }
      }

      return false;
    },
  });
}
