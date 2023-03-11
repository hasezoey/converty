import * as utils from '../utils.js';
import { getTemplate } from '../helpers/template.js';
import * as xh from '../helpers/xml.js';
import * as epubh from '../helpers/epub.js';
import * as sh from '../helpers/string.js';
import { promises as fspromises } from 'fs';
import * as path from 'path';
import {
  doTextContent,
  DoTextContentOptionsGenImageData,
  EntryInformation,
  EntryType,
  PElemTracker,
  processCommonStyle,
  TextProcessingECOptions,
} from '../helpers/htmlTextProcessing.js';

const log = utils.createNameSpace('lastofkind_ln');

// STATIC OPTIONS
const INPUT_MATCH_REGEX = /Reincarnated as the Last of My Kind/gim;
const SERIES_MATCH_REGEX = /^(?<series>.+?)(?: (?:Vol\.|Volume) (?<num>\d+))?$/im;
/** Regex of files to filter out (to not include in the output) */
const FILES_TO_FILTER_OUT_REGEX = /^$/gim;
const COVER_XHTML_FILENAME = 'cover';
const TITLES_TO_FILTER_OUT_REGEX = /other series/gim;
const JSDOM_XHTML_OPTIONS = { contentType: xh.STATICS.XHTML_MIMETYPE };
/** How many elements to check at the beginning to be a title */
const TITLE_CHECK_NUMBER = 10;

// CODE

// EXPORTS
export default function lastofkind_ln(): utils.ConverterModule {
  return { matcher, process };
}

/**
 * The Matcher to determine if the given file is for this module
 * @param name The filename to test on
 * @returns "true" if the file is for this module, "false" otherwise
 */
function matcher(name: string): boolean {
  const ret = INPUT_MATCH_REGEX.test(name);
  // reset regex after use, because they have a state, seemingly even with "test"
  INPUT_MATCH_REGEX.lastIndex = 0;

  return ret;
}

// LOCAL CODE

class LastOfKindECOptions extends TextProcessingECOptions {
  public titleCache?: IsTitleCache;
}

/**
 * The Main Entry Point of this module to begin processing a file
 * @param options The Options from the main module
 * @returns The output filePath
 */
async function process(options: utils.ConverterOptions): Promise<string> {
  // read the input into a epubctx
  const epubctxInput = await epubh.getInputContext(options.fileInputPath);

  // create a output epubctx
  const epubctxOut = new epubh.EpubContext<LastOfKindECOptions>({
    title: epubctxInput.title,
    optionsClass: new LastOfKindECOptions(),
  });

  // apply the common stylesheet
  const stylesheetpath = path.resolve(epubctxOut.contentOPFDir, epubh.FileDir.Styles, 'stylesheet.css');
  await utils.mkdir(path.dirname(stylesheetpath));
  await fspromises.writeFile(stylesheetpath, await getTemplate('text-ln.css'));
  epubctxOut.addFile(
    new epubh.EpubContextFileBase({
      id: 'stylesheet',
      mediaType: epubh.STATICS.CSS_MIMETYPE,
      filePath: stylesheetpath,
    })
  );

  // process the files from input to output

  for (const file of epubctxInput.files) {
    /** Alias to make it easier to handle */
    const filePath = file.filePath;

    if (new RegExp(FILES_TO_FILTER_OUT_REGEX).test(filePath)) {
      log(`Skipping file "${file}" because it is in the filter regex`);
      continue;
    }

    // skip "content.opf" file, because it is handled outside of this loop
    if (/content\.opf/.test(filePath)) {
      continue;
    }
    // ignore all .ncx files (like toc.ncx)
    if (/\.ncx/.test(filePath)) {
      continue;
    }

    const mimetype = file.mediaType;
    log(`Processing file "${file.id}", ${mimetype}`);

    utils.assertion(typeof mimetype === 'string', new Error('Expected "mimetype" to be of string'));

    if (/image/gim.test(mimetype)) {
      // ignore image files, because they will be copied when required
      continue;
    }
    if (mimetype === epubh.STATICS.CSS_MIMETYPE) {
      // ignore css input files, because our own will be applied
      continue;
    }
    if (file instanceof epubh.EpubContextFileXHTML) {
      await processHTMLFile(file.filePath, epubctxOut);
      continue;
    }

    console.error(`Unhandled "mimetype": ${mimetype}`.red);
  }

  // apply metadata

  // check needs to be done, because it does not carry over from the function that defined it
  utils.assertionDefined(epubctxInput.customData, new Error('Expected "epubctxInput.customData" to be defined at this point'));
  const contentOPFInput = epubctxInput.customData.contentOPFDoc;

  function contentOPFHook({ document, idCounter, metadataElem }: Parameters<epubh.ContentOPFFn>[0]) {
    const packageElementOld = xh.queryDefinedElement(contentOPFInput, 'package');
    const metadataElementOld = xh.queryDefinedElement(contentOPFInput, 'metadata');

    const idCounterO: epubh.IdCounter = { c: idCounter };
    epubh.copyMetadata(document, Array.from(metadataElementOld.children), epubctxOut, metadataElem, packageElementOld, idCounterO);

    // Regex to extract the series title and if available the volume position
    const caps = SERIES_MATCH_REGEX.exec(epubctxOut.title);

    if (!utils.isNullOrUndefined(caps)) {
      const seriesTitleNoVolume = utils.regexMatchGroupRequired(caps, 'series', 'contentOPFHook meta collection');
      const seriesPos = utils.regexMatchGroup(caps, 'num');

      epubh.applySeriesMetadata(document, metadataElem, idCounterO, {
        name: seriesTitleNoVolume,
        volume: seriesPos ?? '1',
      });
    } else {
      log('Found no series captures for: "'.red + epubctxOut.title.grey + '"'.red);
    }
  }

  const outPath = await epubctxOut.finish({
    contentOPF: contentOPFHook,
  });

  // move epub to proper place

  const finishedEpubPath = path.resolve(options.converterOutputPath, `${epubctxOut.title}.epub`);

  await fspromises.copyFile(outPath, finishedEpubPath);

  // cleanup

  {
    // somehow "tmp" is not reliable to remove the directory again
    if (!utils.isNullOrUndefined(await utils.statPath(epubctxInput.rootDir))) {
      log('"epubctxInput.rootDir" dir still existed after "removeCallback", manually cleaning');
      await fspromises.rm(epubctxInput.rootDir, { recursive: true, maxRetries: 1 });
    }

    // somehow "tmp" is not reliable to remove the directory again
    if (!utils.isNullOrUndefined(await utils.statPath(epubctxOut.rootDir))) {
      log('"epubctxOut.rootDir" dir still existed after "removeCallback", manually cleaning');
      await fspromises.rm(epubctxOut.rootDir, { recursive: true, maxRetries: 1 });
    }
  }

  return finishedEpubPath;
}

/**
 * Process a (X)HTML file from input to output
 * @param filePath The file to process ((x)html)
 * @param epubctxOut The Epub Context to add new files to
 */
async function processHTMLFile(filePath: string, epubctxOut: epubh.EpubContext<LastOfKindECOptions>): Promise<void> {
  const loadedFile = await fspromises.readFile(filePath);
  const { document: documentInput } = xh.newJSDOM(loadedFile, JSDOM_XHTML_OPTIONS);

  // inject stylesheet as style, this is to ensure that no external resource aside from stylesheets are loaded
  // JSDOM actually provides a way to load the file directly (via the link element) and option "resources: 'usable'", but it does not seem to work
  {
    const linkElem = documentInput.querySelector('head > link[rel="stylesheet"]') as HTMLLinkElement | undefined;

    if (!utils.isNullOrUndefined(linkElem)) {
      const stylePath = path.resolve(path.dirname(filePath), linkElem.href);

      const styleElem = documentInput.createElement('style');
      styleElem.innerHTML = (await fspromises.readFile(stylePath)).toString();
      const headElem = xh.queryDefinedElement(documentInput, 'head');
      headElem.appendChild(styleElem);
    }
  }

  const entryType = determineType(documentInput);

  // ignore all entries determined as a "Ignore" (like the toc.xhtml)
  if (entryType.type === EntryType.Ignore) {
    return;
  }

  // ignore everything that matches the regex
  if (new RegExp(TITLES_TO_FILTER_OUT_REGEX).test(entryType.title)) {
    log(`Skipping file "${filePath}" because it is in the filter regex (titles)`);

    return;
  }

  await doGenericPage(documentInput, entryType, epubctxOut, filePath);
}

/**
 * Determine what type the input document is meant to be
 * @param document The Document to test
 * @returns The information on what the type is
 */
function determineType(document: Document): EntryInformation {
  const titleElem = xh.queryDefinedElement(document, 'head > title');
  const title = titleElem.textContent?.trim();
  utils.assertionDefined(title, new Error('Expected to find a title in the head'));
  const lTitle = title.toLowerCase();

  // generic covers
  let type: EntryType = EntryType.Text;

  // test for the TOC in TOC header element
  {
    const h2Elem = document.querySelector('body > h2');

    if (!utils.isNullOrUndefined(h2Elem) && h2Elem.textContent?.toLowerCase() === 'table of contents') {
      type = EntryType.Ignore;
    }
  }

  if (lTitle === 'copyright') {
    type = EntryType.Text;
  } else if (lTitle === 'table of contents') {
    type = EntryType.Ignore;
  } else {
    const imgsCount = document.querySelectorAll('img').length;
    const psCount = document.querySelectorAll('p').length;

    if (imgsCount > 0) {
      if (psCount === imgsCount || (imgsCount > 0 && psCount === 0)) {
        type = EntryType.Image;
      } else {
        log(`Found images, but p count did not match, imgs: ${imgsCount}, ps: ${psCount}`);
      }
    }
  }

  return {
    type,
    title,
  };
}

/** Cache Object for {@link isTitle} */
interface IsTitleCache {
  bodyFontSizePx: number;
  window: Window;
}

/**
 * Determine if the element is a Heading
 * @param document The Document to work on
 * @param elem The Element to check
 * @param entryType The Entry Information
 * @param cache Optional Cache to not compute styles too often when not required
 * @returns A String with the detected content of the element if a title, "false" otherwise
 */
function isTitle(document: Document, elem: Element, entryType: EntryInformation, optionsClass: LastOfKindECOptions): boolean | string {
  const processedTitle = sh.xmlToString(elem.textContent ?? '');

  // basic fast test if the content matches the parsed title
  // not using just "includes" because it is slower than directly checking
  if (processedTitle === entryType.title || processedTitle.includes(entryType.title)) {
    return processedTitle;
  }

  // below is a alternative way of detecting a heading by using fontsize
  // works in this case because fonsize is 150% (1.5 the size)

  let bodyFontSize: number;
  let window: Window;

  if (!utils.isNullOrUndefined(optionsClass.titleCache)) {
    bodyFontSize = optionsClass.titleCache.bodyFontSizePx;
    window = optionsClass.titleCache.window;
  } else {
    const windowTMP = document.defaultView;
    utils.assertionDefined(windowTMP, new Error('Expected to get a "window" from "defaultView"'));
    window = windowTMP;
    const bodyCompStyle = window.getComputedStyle(xh.queryDefinedElement(document, 'body'));
    bodyFontSize = parseInt(bodyCompStyle.fontSize);
  }

  const innerElem = elem.querySelector(':first-child');

  // use first inner elements, because headers are wrapped in a span that has the font-size style
  const useElem = innerElem ? innerElem : elem;

  const elemCompStyle = window.getComputedStyle(useElem);
  let elemFontSizePx: number;

  {
    const elemFontSizePxTMP = parseInt(elemCompStyle.fontSize);
    elemFontSizePx = Number.isNaN(elemFontSizePxTMP) ? bodyFontSize : elemFontSizePxTMP;
  }

  if (elemFontSizePx >= bodyFontSize * 1.5) {
    return sh.xmlToString(useElem.textContent ?? '') || false;
  }

  return false;
}

/**
 * Handle Generic Title Types
 * @param documentInput The Input Document's "document.body"
 * @param entryType The Title Object
 * @param epubctxOut EPUB Context of the Output file
 * @param currentInputFile Currently processing's Input file path
 * @param skipElements Set how many elements to initally skip
 */
async function doGenericPage(
  documentInput: Document,
  entryType: EntryInformation,
  epubctxOut: epubh.EpubContext<LastOfKindECOptions>,
  currentInputFile: string,
  skipElements?: number
): Promise<void> {
  // just to make sure that the type is defined and correctly assumed
  await doTextContent(documentInput, entryType, epubctxOut, currentInputFile, {
    genTextIdData(optionsClass, entryType, extra) {
      let baseName = 'chapter' + optionsClass.getTracker('Chapter');
      const subnum = optionsClass.getTracker('CurrentSubChapter');
      let useType: epubh.EpubContextNewFileXHTMLType;

      // only add a subnumber when a subnumber is required (not in the first of the chapter)
      if (subnum > 0) {
        baseName += `_${subnum}`;
      }

      /** Keep track of wheter to decrement "Chapter" again (deduplicate) */
      let decChapter = false;

      {
        const lTitle = entryType.title.toLowerCase();

        // extra handling for when encountering a "copyright", because it is somewhere between the cover and the frontmatter
        if (lTitle.includes('copyright')) {
          epubctxOut.optionsClass.setImgTypeImplicit(epubh.ImgType.Frontmatter);

          decChapter = true;
          baseName = 'copyright';
          useType = {
            type: epubh.EpubContextFileXHTMLTypes.CREDITS,
          };
        } else {
          useType = {
            type: epubh.EpubContextFileXHTMLTypes.TEXT,
          };
        }
        if (lTitle.includes('afterword')) {
          epubctxOut.optionsClass.setImgTypeImplicit(epubh.ImgType.Backmatter);

          decChapter = true;
          baseName = 'afterword';
        }
      }

      if (extra.increasedChapterWithTitle && decChapter) {
        epubctxOut.optionsClass.decTracker('Chapter');
      }

      return {
        sectionId: baseName,
        useType,
      };
    },
    genImageIdData: genImgIdData,
    genChapterHeaderContent(document, entryType, h1Element) {
      h1Element.appendChild(document.createTextNode(entryType.title));
    },
    genPElemText: generatePElementInner,
    cachedIsTitleOptions(document, optionsClass) {
      const window = documentInput.defaultView;
      utils.assertionDefined(window, new Error('Expected to get a "window" from "defaultView"'));
      const bodyCompStyle = window.getComputedStyle(xh.queryDefinedElement(documentInput, 'body'));
      const bodyFontSizePx = parseInt(bodyCompStyle.fontSize);

      optionsClass.titleCache = {
        bodyFontSizePx,
        window,
      };
    },
    isTitle: isTitle,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    determineReset(document, entryType, _optionsClass) {
      // custom reset-condition for multiple frontmatter pages
      // for example for "Character Page X" to be grouped into just one "Character Page" TOC entry
      if (/character page \d+/im.test(entryType.title)) {
        return false;
      }

      return true;
    },

    skipElements,
    headerSearchCount: TITLE_CHECK_NUMBER,
  });
}

/** Helper for consistent Image naming */
function genImgIdData(
  optionsClass: LastOfKindECOptions,
  inputPath: string,
  imgNode: Element,
  entryType: EntryInformation
): DoTextContentOptionsGenImageData {
  const ext = path.extname(inputPath);

  const altAttr = imgNode.getAttribute('alt') || entryType.title;

  // determine if the current image processing is for the cover
  if (altAttr.trim().toLowerCase() === 'cover') {
    optionsClass.setImgTypeImplicit(epubh.ImgType.Cover);
  } else if (altAttr.trim().toLowerCase().includes('cover')) {
    entryType.title = altAttr;
  }

  if (optionsClass.imgTypeImplicit === epubh.ImgType.Frontmatter) {
    const frontmatterNum = optionsClass.incTracker('Frontmatter');

    return {
      imgClass: epubh.ImgClass.Insert,
      sectionId: `frontmatter${frontmatterNum}${ext}`,
      imgFilename: `Frontmatter${frontmatterNum}${ext}`,
      xhtmlFilename: `frontmatter${frontmatterNum}`,
      useType: {
        type: epubh.EpubContextFileXHTMLTypes.IMG,
        imgClass: epubh.ImgClass.Insert,
        imgType: epubh.ImgType.Frontmatter,
      },
    };
  } else if (optionsClass.imgTypeImplicit === epubh.ImgType.Backmatter) {
    const backmatterNum = optionsClass.incTracker('Backmatter');

    return {
      imgClass: epubh.ImgClass.Insert,
      sectionId: `backmatter${backmatterNum}${ext}`,
      imgFilename: `Backmatter${backmatterNum}${ext}`,
      xhtmlFilename: `backmatter${backmatterNum}`,
      useType: {
        type: epubh.EpubContextFileXHTMLTypes.IMG,
        imgClass: epubh.ImgClass.Insert,
        imgType: epubh.ImgType.Backmatter,
      },
    };
  } else if (optionsClass.imgTypeImplicit === epubh.ImgType.Cover) {
    return {
      imgClass: epubh.ImgClass.Cover,
      sectionId: `cover${ext}`,
      imgFilename: `Cover${ext}`,
      xhtmlFilename: COVER_XHTML_FILENAME,
      useType: {
        type: epubh.EpubContextFileXHTMLTypes.IMG,
        imgClass: epubh.ImgClass.Cover,
        imgType: epubh.ImgType.Cover,
      },
    };
  }

  const insertNum = optionsClass.incTracker('Insert');

  // in case of "1" and as fallback
  return {
    imgClass: epubh.ImgClass.Insert,
    sectionId: `insert${insertNum}${ext}`,
    imgFilename: `Insert${insertNum}${ext}`,
    xhtmlFilename: `insert${insertNum}`,
    useType: {
      type: epubh.EpubContextFileXHTMLTypes.IMG,
      imgClass: epubh.ImgClass.Insert,
      imgType: epubh.ImgType.Insert,
    },
  };
}

/**
 * Return formatted and only elements that are required
 * @param origNode The original node to process
 * @param documentNew The Document to create new nodes on
 * @param parentElem The Element the new nodes are added to (will not be applied by this function), required for testing and applying styles
 * @returns The array of new Nodes
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function generatePElementInner(origNode: Node, documentNew: Document, parentElem: Element, _optionsClass: LastOfKindECOptions): Node[] {
  // if node is text, return as text
  if (origNode.nodeType === documentNew.TEXT_NODE) {
    utils.assertionDefined(origNode.textContent, new Error('Expected "origElem.textContent" to be defined'));

    return [documentNew.createTextNode(origNode.textContent)];
  }
  // dont do anything if the node is not a Element
  if (origNode.nodeType !== documentNew.ELEMENT_NODE) {
    console.error('Encountered unhandled "nodeType":'.red, origNode.nodeType);

    return [];
  }

  /** Alias with proper type, because typescript cannot infer it */
  const origElem = origNode as Element;

  // let "br" elements stay where they were
  if (origElem.localName === 'br') {
    return [documentNew.createElement('br')];
  }

  const origElemStyle = origElem.getAttribute('style');
  const elemObj = new PElemTracker();
  processCommonStyle(elemObj, parentElem, documentNew, origElem);

  // warn on unhandled styles that are set on the element directly, unless they are ignored ones
  const styleList = origElemStyle
    ?.split(';')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  const IGNORE_STYLE_REGEX = /font-style|font-weight|vertical-align|color|text-align/gim;

  // warn against styles being unhandled
  if (!utils.isNullOrUndefined(styleList)) {
    for (const style of styleList) {
      // reset regex after use, because they have a state
      IGNORE_STYLE_REGEX.lastIndex = 0;

      if (IGNORE_STYLE_REGEX.test(style)) {
        continue;
      }

      console.error(`Unhandled Style found: \"${style}\"`.red);
    }
  }

  // if "currentElem" is not defined, loop over the original elements's children and return those children directly
  // because this means the current element is not needed
  if (utils.isNullOrUndefined(elemObj.currentElem)) {
    const listOfNodes: Node[] = [];
    for (const child of Array.from(origElem.childNodes)) {
      listOfNodes.push(...generatePElementInner(child, documentNew, parentElem, _optionsClass));
    }

    return listOfNodes;
  }

  // loop over all original Element's children and add them to the currentElem as a child
  for (const child of Array.from(origElem.childNodes)) {
    for (const elem of generatePElementInner(child, documentNew, elemObj.currentElem, _optionsClass)) {
      elemObj.currentElem.appendChild(elem);
    }
  }
  utils.assertionDefined(elemObj.topElem, new Error('Expected "elemObj.topElem" to be defined at this point'));

  return [elemObj.topElem];
}
