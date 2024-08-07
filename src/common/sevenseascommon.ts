import * as utils from '../utils.js';
import { promises as fspromises } from 'fs';
import * as path from 'path';
import { getTemplate } from '../helpers/template.js';
import * as xh from '../helpers/xml.js';
import * as sh from '../helpers/string.js';
import * as epubh from '../helpers/epub.js';
import {
  EntryInformation,
  EntryType,
  TextProcessingECOptions,
  doTextContent,
  DoTextContentOptionsGenImageData,
  processCommonStyle,
  PElemTracker,
  STATICS,
  DoTextContentOptions,
  DoTextContentOptionsGenTextIdDataExtra,
  finishEpubctx,
  parentHas,
} from '../helpers/htmlTextProcessing.js';

const log = utils.createNameSpace('sevenseascommon');

// STATIC OPTIONS
/** Regex of files to filter out (to not include in the output) */
export const DEFAULT_FILES_TO_FILTER_OUT_REGEX = /newsletter|sevenseaslogo/gim;
/** Regex of titles to filter out (to not include in the output) */
export const DEFAULT_TITLES_TO_FILTER_OUT_REGEX = /newsletter/gim;
/** Regex for detecting the series in the ContentOPF */
export const SERIES_MATCH_REGEX = /^(?<series>.+?)( (?:Vol\.|Volume) (?<num>\d+))?$/im;
/** Cover file name (without extension) for the xhtml file */
export const COVER_XHTML_FILENAME = 'cover';

// CODE

// EXPORTS

export function matcher(inputRegex: RegExp): (name: string) => boolean {
  return function SevenSeasMatcher(name: string) {
    const ret = inputRegex.test(name);
    // reset regex after use, because they have a state, seemingly even with "test"
    inputRegex.lastIndex = 0;

    return ret;
  };
}

/** Base Config for SevenSeas processes */
export interface SevenSeasConfig {
  /** Define a custom "ContentOPFFn" */
  contentOPFHook?: epubh.ContentOPFFn;
  /** Define a custom "processHTMLFile" */
  processHTMLFile?: (filePath: string, epubctxOut: epubh.EpubContext<SevenSeasECOptions>, config: SevenSeasConfig) => Promise<void>;
  /** Define a custom ECOptions class */
  customECOptions?: typeof SevenSeasECOptions;
  /** Define a custom "doGenericPage" call */
  doGenericPage?: (
    documentInput: Document,
    entryType: EntryInformationExt,
    epubctxOut: epubh.EpubContext<SevenSeasECOptions>,
    currentInputFile: string,
    config: SevenSeasConfig,
    skipElements?: number
  ) => Promise<void>;
  /**
   * Define a custom "getTitle" function
   */
  getTitle?: typeof getTitle;
  /**
   * Define a hook for inside "getTitle"
   * Has no effect if a custom "getTitle" is set
   */
  getTitleHook?: GetTitleHook;
  /**
   * Define a custom "isTitle" function
   * Has no effect if a custom "doGenericPage" is set
   */
  isTitle?: DoTextContentOptions<SevenSeasECOptions>['isTitle'];
  /**
   * Define a custom "cachedIsTitleOptions" function
   * Has no effect if a custom "doGenericPage" is set
   */
  cachedIsTitleOptions?: DoTextContentOptions<SevenSeasECOptions>['cachedIsTitleOptions'];
  /**
   * Define a custom "genChapterHeaderContent" function
   * Has no effect if a custom "doGenericPage" is set
   */
  genChapterHeaderContent?: DoTextContentOptions<SevenSeasECOptions>['genChapterHeaderContent'];
  /**
   * Define a custom "genTextIdData" function
   * Has no effect if a custom "doGenericPage" is set
   */
  genTextIdData?: DoTextContentOptions<SevenSeasECOptions>['genTextIdData'];
  /**
   * Define a custom "checkElement" function
   * Has no effect if a custom "doGenericPage" is set
   */
  checkElement?: DoTextContentOptions<SevenSeasECOptions>['checkElement'];
  /**
   * Define a custom "genImgIdData" function
   * Has no effect if a custom "doGenericPage" is set
   */
  genImgIdData?: DoTextContentOptions<SevenSeasECOptions>['genImageIdData'];
  /**
   * Define a custom "generatePElementInner" function
   * Has no effect if a custom "doGenericPage" is set
   */
  generatePElementInner?: DoTextContentOptions<SevenSeasECOptions>['genPElemText'];
  /**
   * Define a custom function "determineReset" function
   */
  determineReset?: DoTextContentOptions<SevenSeasECOptions>['determineReset'];
  /**
   * Define a hook for inside the default "generatePElementInner" to apply extra styling
   * Has no effect if a custom "generatePElementInner" is defined
   * Has no effect if the default "generatePElementInner" is not used in "doGenericPage"
   */
  generatePElementInnerHook?: GeneratePElementInnerHook;
  /**
   * Define a hook to customize if the current element should be combined with the last element
   * Has no effect if a custom "generatePElementInner" is defined
   * Has no effect if the default "generatePElementInner" is not used in "doGenericPage"
   */
  generatePElementCombineHook?: GeneratePElementCombineHook;
  /** Define a custom title regex filter-out */
  TitlesToFilter?: RegExp;
  /** Define a custom files regex filter-out */
  FilesToFilter?: RegExp;
}

export async function process(options: utils.ConverterOptions, config: SevenSeasConfig): Promise<string> {
  const epubctxInput = await epubh.getInputContext(options.fileInputPath);

  const epubctxOut = new epubh.EpubContext<SevenSeasECOptions>({
    title: epubctxInput.title,
    optionsClass: new (config.customECOptions ?? SevenSeasECOptions)(),
  });

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

  for (const file of epubctxInput.files) {
    /** Alias to make it easier to handle */
    const filePath = file.filePath;

    if (new RegExp(config.FilesToFilter ?? DEFAULT_FILES_TO_FILTER_OUT_REGEX).test(filePath)) {
      log(`Skipping file "${file.id}" because it is in the filter regex`);
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
      await (config.processHTMLFile ?? processHTMLFile)(file.filePath, epubctxOut, config);
      continue;
    }

    console.error(`Unhandled "mimetype": ${mimetype}`.red);
  }

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

  return await finishEpubctx(epubctxOut, options, [epubctxInput], {
    contentOPF: config.contentOPFHook ?? contentOPFHook,
  });
}

// LOCAL

// extends, because otherwise it would complain about types being not correct in a alias
export class SevenSeasECOptions extends TextProcessingECOptions {
  public titleCache?: IsTitleCache;
  /** The {@link EntryInformationExt} of the last processed file */
  public lastEntryType?: EntryInformationExt;
}

/** Process a (X)HTML file from input to output */
export async function processHTMLFile(
  filePath: string,
  epubctxOut: epubh.EpubContext<SevenSeasECOptions>,
  config: SevenSeasConfig
): Promise<void> {
  const loadedFile = await fspromises.readFile(filePath);
  const { document: documentInput } = xh.newJSDOM(loadedFile, STATICS.JSDOM_XHTML_OPTIONS);

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

  const entryType = (config.getTitle ?? getTitle)(documentInput.title, config);

  // ignore all entries determined as a "Ignore" (like the toc.xhtml)
  if (entryType.type === EntryType.Ignore) {
    return;
  }

  // apply the type gottem from the title
  // excluding setting "Insert" as that is the default and should only be set by the body>title way
  if (entryType.imgType !== epubh.ImgType.Insert) {
    epubctxOut.optionsClass.setImgTypeImplicit(entryType.imgType);
  }

  // ignore everything that matches the regex
  if (new RegExp(config.TitlesToFilter ?? DEFAULT_TITLES_TO_FILTER_OUT_REGEX).test(entryType.firstLine)) {
    log(`Skipping file "${filePath}" because it is in the filter regex (titles)`);

    return;
  }

  await (config.doGenericPage ?? doGenericPage)(documentInput, entryType, epubctxOut, filePath, config);

  epubctxOut.optionsClass.lastEntryType = entryType;
}

/**
 * Handle Generic Title Types
 * @param documentInput The Input Document's "document.body"
 * @param entryType The Title Object
 * @param epubctxOut EPUB Context of the Output file
 * @param currentInputFile Currently processing's Input file path
 * @param skipElements Set how many elements to initally skip
 */
export async function doGenericPage(
  documentInput: Document,
  entryType: EntryInformationExt,
  epubctxOut: epubh.EpubContext<SevenSeasECOptions>,
  currentInputFile: string,
  config: SevenSeasConfig,
  skipElements?: number
): Promise<void> {
  // just to make sure that the type is defined and correctly assumed
  await doTextContent(documentInput, entryType, epubctxOut, currentInputFile, {
    genTextIdData: config.genTextIdData ?? genTextIdData,
    genImageIdData: config.genImgIdData ?? genImgIdData,
    genChapterHeaderContent: config.genChapterHeaderContent ?? genChapterHeaderContent,
    genPElemText:
      config.generatePElementInner ??
      function wrapGeneratePElementInner(...args) {
        return generatePElementInner(...args, config);
      },
    cachedIsTitleOptions: config.cachedIsTitleOptions ?? cachedIsTitleOptions,

    isTitle: config.isTitle ?? isTitle,
    checkElement: config.checkElement,
    determineReset: config.determineReset ?? determineReset,

    skipElements,
  });
}

/** Compare 2 {@link EntryInformationExt}, this is necessary as `==(=)` always seems to match false */
export function compareEntryInformationExt(a: EntryInformationExt, b: EntryInformationExt): boolean {
  return a.title === b.title && a.imgType === b.imgType && a.type === b.type;
}

/** Base Seven Seas determine reset function */
export function determineReset(document: Document, entryType: EntryInformationExt, optionsClass: SevenSeasECOptions): boolean {
  // handle the case where the Color Gallery (or other things) are split up in multiple files instead of one single file
  if (
    (entryType.imgType === epubh.ImgType.Frontmatter || entryType.imgType === epubh.ImgType.Backmatter) &&
    optionsClass.lastEntryType &&
    compareEntryInformationExt(optionsClass.lastEntryType, entryType)
  ) {
    return false;
  }

  // base case, let "htmlTextProcessing" handle it
  return true;
}

/** Base function for "genTextIdData" */
export function genTextIdData(
  optionsClass: SevenSeasECOptions,
  entryType: EntryInformation,
  extra: DoTextContentOptionsGenTextIdDataExtra
) {
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
      optionsClass.setImgTypeImplicit(epubh.ImgType.Frontmatter);

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
      optionsClass.setImgTypeImplicit(epubh.ImgType.Backmatter);

      decChapter = true;
      baseName = 'afterword';
    }
  }

  if (extra.increasedChapterWithTitle && decChapter) {
    optionsClass.decTracker('Chapter');
  }

  return {
    sectionId: baseName,
    useType,
  };
}

/** Base function for "genChapterHeaderContent" */
export function genChapterHeaderContent(document: Document, entryType: EntryInformation, h1Element: Element) {
  const title = entryType as EntryInformationExt;
  h1Element.appendChild(document.createTextNode(title.firstLine));

  if (!utils.isNullOrUndefined(title.secondLine)) {
    h1Element.appendChild(document.createElement('br'));
    h1Element.appendChild(document.createTextNode(title.secondLine));
  }
}

/** Base function for "cachedIsTitleOptions" */
export function cachedIsTitleOptions(document: Document, optionsClass: SevenSeasECOptions) {
  const window = document.defaultView;
  utils.assertionDefined(window, new Error('Expected to get a "window" from "defaultView"'));
  const bodyCompStyle = window.getComputedStyle(xh.queryDefinedElement(document, 'body'));
  const bodyFontSizePx = parseInt(bodyCompStyle.fontSize);
  optionsClass.titleCache = {
    bodyFontSizePx,
    window,
  };
}

/** Cache Object for {@link isTitle} */
export interface IsTitleCache {
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
export function isTitle(
  document: Document,
  elem: Element,
  entryType: EntryInformation,
  optionsClass: SevenSeasECOptions
): boolean | string {
  const processedTitle = sh.xmlToString(elem.textContent ?? '');

  // dont try to detect a title in a empty string
  if (processedTitle.length === 0) {
    return false;
  }

  // basic fast test if the content matches the parsed title
  // not using just "includes" first because it is slower than directly checking
  if (processedTitle === entryType.title || processedTitle.includes(entryType.title)) {
    return processedTitle;
  }

  // try to test if they are the same title with less variance
  if (convertTitleCompare(processedTitle).includes(convertTitleCompare(entryType.title))) {
    return true;
  }

  // seemingly all sevenseas headers have a "auto_bookmark_toc_("top"|number)" id in most books
  if (elem.id.includes('auto_bookmark_toc_')) {
    return true;
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

  if (elemFontSizePx >= bodyFontSize * 1.1) {
    return sh.xmlToString(useElem.textContent ?? '') || false;
  }

  return false;
}

/**
 * Helper function to convert a title to be compare to another with less variance
 * @param title The title to convert
 * @returns a less-variance string
 */
export function convertTitleCompare(title: string): string {
  return title.replaceAll(' ', '').replaceAll('…', '...');
}

/** Helper for consistent Image naming */
export function genImgIdData(
  optionsClass: SevenSeasECOptions,
  inputPath: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _imgNode: Element,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  entryType: EntryInformation
): DoTextContentOptionsGenImageData {
  const ext = path.extname(inputPath);

  // reset to frontmatter in case type is already set to cover
  if (optionsClass.imgTypeImplicit === epubh.ImgType.Cover) {
    optionsClass.setImgTypeImplicit(epubh.ImgType.Frontmatter);
  }

  // determine if the current image processing is for the cover
  if (isTitleCover(preProcessTitle(entryType.title))) {
    optionsClass.setImgTypeImplicit(epubh.ImgType.Cover);
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

export interface GeneratePElementInnerHookReturn {
  /** Extra classes that have been handled and dont need to be warned about */
  classesToIgnore?: string[];
  /** Extra styles that have been handled and dont need to be warned about */
  stylesToIgnore?: string[];
}

export type GeneratePElementInnerHook = () => GeneratePElementInnerHookReturn;
/**
 * Return "true" to skip combining, return "false" otherwise
 */
export type GeneratePElementCombineHook = (lastNode: Node, currentNodes: Node[]) => boolean;

/**
 * Wrapper for {@link generatePElementInnerTranslate} to move generated elements around to the previous element if required
 */
export function generatePElementInner(
  origNode: Node,
  documentNew: Document,
  parentElem: Element,
  optionsClass: SevenSeasECOptions,
  config: SevenSeasConfig
): Node[] {
  const elems = generatePElementInnerTranslate(origNode, documentNew, parentElem, optionsClass, config);

  const res = combineWithLastNode(documentNew, config, elems);

  return res ?? elems;
}

/** Helper for control flow */
function combineWithLastNode(documentNew: Document, config: SevenSeasConfig, elems: Node[]): Node[] | undefined {
  // quick end for when "elems" is empty or when the node is a separator
  if (elems.length === 0) {
    return undefined;
  }

  const lastmainnode = documentNew.querySelector('.main')?.lastChild;

  // find elements that end with a word character and a space, we can safely assume that those are meant to be combined (if current is not a control like br)
  // example: "<p>Some text </p><p>which is meant to be combined.</p>"
  // this exists because sevenseas texts somehow have this splitting on some first pages of a chapter
  if (lastmainnode && (lastmainnode.textContent?.length ?? 0) > 5 && lastmainnode.textContent?.match(/\w\s$/)) {
    const shouldNotCombine = !utils.isNullOrUndefined(config.generatePElementCombineHook)
      ? config.generatePElementCombineHook(lastmainnode, elems)
      : false;

    if (!shouldNotCombine) {
      log('generatePElementInner: Found previous node which did not end correctly, combining with current node');

      for (const child of elems) {
        // ignore "br" elements in while combining
        if (child.nodeName === 'br') {
          continue;
        }

        lastmainnode.appendChild(child);
      }

      return [];
    }

    log('generatePElementInner: Found previous node which did not end correctly, but custom hook prevented it');
  }

  return undefined;
}

/** Return formatted and only elements that are required */
export function generatePElementInnerTranslate(
  origNode: Node,
  documentNew: Document,
  parentElem: Element,
  optionsClass: SevenSeasECOptions,
  config: SevenSeasConfig
): Node[] {
  if (origNode.nodeType === documentNew.TEXT_NODE) {
    utils.assertionDefined(origNode.textContent, new Error('Expected "origElem.textContent" to be defined'));

    return [documentNew.createTextNode(origNode.textContent)];
  }

  if (origNode.nodeType !== documentNew.ELEMENT_NODE) {
    console.error('Encountered unhandled "nodeType":'.red, origNode.nodeType);

    return [];
  }

  const origElem = origNode as Element;

  const elemObj = new PElemTracker();
  const { elemCompStyle } = processCommonStyle(elemObj, parentElem, documentNew, origElem);

  // cover extra indentations, (P_Prose_Formatting__And__Left_Indent)
  if (parseInt(elemCompStyle.marginLeft) > 0) {
    parentElem.setAttribute('class', 'extra-indent');
  }

  // cover initial missing boldness but having big font-size (chapter start first letter after heading)
  if (!parentHas(elemObj.currentElem, 'strong') && elemCompStyle.fontSize === '3.00em') {
    elemObj.setNewElem(documentNew.createElement('strong'));
  }

  if (origElem.localName === 'br') {
    return [documentNew.createElement('br')];
  }

  // classes to ignore that are either unnecessary or are handled by different things (like "htmlTextProcessing"'s "processCommonStyle")
  // this is used to warn about new volume's different and maybe unhandled formatting
  const classesToIgnore: string[] = [
    // default formatting for p, ignored
    'P_Normal__And__Left_Indent__And__Spacing_After__And__Spacing_Before',
    'P_Prose_Formatting',
    'P_Normal',
    // default formatting for span, ignored
    'C_Current__And__Times_New_Roman',
    // random colored text, ignored
    'C_Current__And__Coloured_Text__And__Times_New_Roman',
    // name implies same as "C_Current__And__Times_New_Roman" but actually only sets text color to black, ignored
    'C_Current__And__Black_Text__And__Times_New_Roman',
    'C_Current__And__Properties__And__Black_Text__And__Times_New_Roman',
    // same as "C_Current__And__Black_Text__And__Times_New_Roman" in addition also setting letter-spacing (ignored) and font-size (ignored)
    'C_Current__And__Properties__And__Black_Text__And__Times_New_Roman__And__Small_Capitals',
    // same as "C_Current__And__Black_Text__And__Times_New_Roman" in addition also setting font-weight (handled)
    'C_Current__And__Black_Text__And__Times_New_Roman__And__Bold',
    // same as "C_Current__And__Black_Text__And__Times_New_Roman" in addition also setting font-style (handled)
    'C_Current__And__Black_Text__And__Times_New_Roman__And__Italic',
    'C_Current__And__Properties__And__Black_Text__And__Times_New_Roman__And__Italic',
    'C_Current__And__Black_Text__And__Times_New_Roman__And__Bold__And__Italic',
    // in addition to the previous things, also sets text-transform (handled)
    'C_Current__And__Black_Text__And__Times_New_Roman__And__Bold__And__Capitals',
    // default formatting for section markings, handled by "generatePElement"
    'P__STAR__STAR__STAR__page_break',
    'P_Prose_Formatting__And__Centre_Alignment',
    'P__STAR__STAR__STAR__page_break__And__Page_Break',
    'P_TEXTBODY_CENTERALIGN_PAGEBREAK',
    'P_TEXTBODY_CENTERALIGN',
    'P_TEXTBODY_CENTERALIGN__And__Page_Break',
    // class to mark some headings
    'P_Chapter_Header',
    // random change in letter-spacing following the chapter start big character, but before actual text, ignored
    'C_Current__And__Properties__And__Times_New_Roman',
    // transform all text to uppercase, ignored because all text is already uppercase
    'C_Nanomachines__And__Times_New_Roman__And__Capitals',
    'C_Current__And__Times_New_Roman__And__Capitals',
    // author signature (afterword), handled by "generatePElement"
    'P_Normal__And__Right_Alignment__And__Left_Indent__And__Spacing_After__And__Spacing_Before',
    'P_Prose_Formatting__And__Right_Alignment',
    'P_TEXTBODY_CENTERALIGN__And__Right_Alignment',
    // handled earlier in the function
    'C_Current__And__Times_New_Roman__And__Italic',
    'C_Current__And__Times_New_Roman__And__Bold__And__Italic',
    // extra indentation (and margin), handled by "generatePElement"
    'P_Prose_Formatting__And__Left_Indent',
    'P_Prose_Formatting__And__Left_Indent__OPENPAR_1_CLOSEPAR_',
    // this is always after a div with "page-break: always", but can be ignored
    'P_Prose_Formatting__And__Page_Break',
    // random change of font size for "About the Author" heading, ignored to keep same size
    'C_Current__And__Small_Capitals',
    // random class which is empty in space merc 9
    'C_No_Tail_Q__And__Times_New_Roman',
    // slightly lower letter-spacing (ignored) and setting italic (handled) in space merc 9
    'C_Current__And__Properties__And__Times_New_Roman__And__Italic',
  ];
  // styles that are directly on a element to ignore that are either unnecessary or are handled already (mostly in "htmlTextProcessing"'s "processCommonStyle")
  // like "<p style=\"HERE\" class=\"NOT HERE\">"
  const stylesToIgnore: string[] = [
    'font-style',
    'font-weight',
    'color',
    'font-size',
    'text-transform',
    'vertical-align',
    'letter-spacing',
    'text-decoration',
  ];

  if (!utils.isNullOrUndefined(config.generatePElementInnerHook)) {
    const ret = config.generatePElementInnerHook();

    if (!utils.isNullOrUndefined(ret.classesToIgnore)) {
      classesToIgnore.push(...ret.classesToIgnore);
    }
    if (!utils.isNullOrUndefined(ret.stylesToIgnore)) {
      stylesToIgnore.push(...ret.stylesToIgnore);
    }
  }

  const origElemStyle = origElem.getAttribute('style');

  const styleList = origElemStyle
    ?.split(';')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  const IGNORE_STYLE_REGEX = new RegExp(stylesToIgnore.join('|'), 'im');

  // warn against styles being unhandled
  if (!utils.isNullOrUndefined(styleList)) {
    for (const style of styleList) {
      if (IGNORE_STYLE_REGEX.test(style)) {
        continue;
      }

      console.error(`Unhandled Style found: \"${style}\"`.red);
    }
  }

  if (origElem.className.length != 0 && !classesToIgnore.includes(origElem.className)) {
    console.log('encountered unknown class'.red, origElem.className);
  }

  // if "currentElem" is not defined, loop over the original elements's children and return those children directly
  // because this means the current element is not needed
  if (utils.isNullOrUndefined(elemObj.currentElem)) {
    const listOfNodes: Node[] = [];
    for (const child of Array.from(origElem.childNodes)) {
      listOfNodes.push(...generatePElementInner(child, documentNew, parentElem, optionsClass, config));
    }

    return listOfNodes;
  }

  // loop over all original Element's children and add them to the currentElem as a child
  for (const child of Array.from(origElem.childNodes)) {
    for (const elem of generatePElementInner(child, documentNew, elemObj.currentElem, optionsClass, config)) {
      elemObj.currentElem.appendChild(elem);
    }
  }

  utils.assertionDefined(elemObj.topElem, new Error('Expected "elemObj.topElem" to be defined at this point'));

  return [elemObj.topElem];
}

/** A Extension of {@link EntryInformation} for SevenSeas sepcific things */
export interface EntryInformationExt extends EntryInformation {
  firstLine: string;
  secondLine?: string;
  imgType: epubh.ImgType;
}

export const GENERIC_TITLE_REGEX = /^\s*(?<type>.+?)(?: (?<num>\d+))?(?:: (?<title>.+?))?\s*$/im;

/** Helper function to process a array into lowercase and remove all spaces */
export function processTitles(arr: string[]): string[] {
  return arr.map((v) => v.toLowerCase().replaceAll(/\s/g, ''));
}

/** Basically {@link EntryInformationExt}, just without "title"(fullTitle) */
export type GetTitleTmpEIE = Omit<EntryInformationExt, 'title'>;
/** The Hook definition for inside the default {@link getTitle} */
export type GetTitleHook = (
  retObj: GetTitleTmpEIE,
  type: string,
  numString: string | undefined,
  title: string | undefined,
  headTitle: string
) => void;

/**
 * Function to get the title accurately
 * @param headTitle The Title to parse
 * @returns The Processed title
 */
export function getTitle(headTitle: string, config: SevenSeasConfig): EntryInformationExt {
  const matches = GENERIC_TITLE_REGEX.exec(headTitle);

  utils.assertionDefined(matches, new Error('Failed to get matches for Title'));

  const type = utils.regexMatchGroupRequired(matches, 'type', 'getTitle');
  const numString = utils.regexMatchGroup(matches, 'num');
  const title = utils.regexMatchGroup(matches, 'title');

  const retObj: GetTitleTmpEIE = {
    firstLine: '',
    secondLine: undefined,
    type: EntryType.Text,
    imgType: epubh.ImgType.Insert,
  };

  if (!utils.isNullOrUndefined(numString)) {
    retObj.firstLine = type + ` ${numString}`;
  } else {
    retObj.firstLine = type;
  }

  if (!utils.isNullOrUndefined(title)) {
    retObj.firstLine += ':';
    retObj.secondLine = title;
  }

  if (!utils.isNullOrUndefined(config.getTitleHook)) {
    config.getTitleHook(retObj, type, numString, title, headTitle);
  }

  // process it once
  const typeP = preProcessTitle(type);

  if (isTitleCover(typeP)) {
    retObj.imgType = epubh.ImgType.Cover;
  } else if (
    processTitles(['Copyrights and Credits', 'Table of Contents Page', 'Color Inserts', 'Color Gallery', 'Title Page']).includes(typeP)
  ) {
    retObj.imgType = epubh.ImgType.Frontmatter;
  } else if (processTitles(['Afterword']).includes(typeP)) {
    retObj.imgType = epubh.ImgType.Backmatter;
  } else if (processTitles(['table of contents']).includes(typeP)) {
    // ignore the TOC, because a new one will be generated
    retObj.type = EntryType.Ignore;
    // the following is from "Reincarnated as a Sword Vol. 4"
  } else if (processTitles(['Extra Chapter']).includes(typeP)) {
    retObj.imgType = epubh.ImgType.Backmatter;
  }

  const fullTitle = !utils.isNullOrUndefined(retObj.secondLine) ? retObj.firstLine + ' ' + retObj.secondLine : retObj.firstLine;

  return {
    ...retObj,
    title: fullTitle,
  };
}

/** Pre-process a title for {@link processTitles} */
export function preProcessTitle(title: string): string {
  return title.toLowerCase().replaceAll(/\s/g, '');
}

/**
 * Is the given title a cover page?
 *
 * Requires {@link preProcessTitle}
 */
export function isTitleCover(title: string): boolean {
  return processTitles(['Cover', 'Cover Page']).includes(title);
}
