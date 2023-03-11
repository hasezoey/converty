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
/**
 * Regex for testing if a file is meant to be a cover
 * Matches:
 * "Cover"
 * "Cover Page"
 * Does not match:
 * "Chapter 00: Something about cover"
 */
export const COVER_TITLE_TEST_REGEX = /^cover(\spage)?$/im;

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
export interface SevenSeasonConfig {
  /** Define a custom "ContentOPFFn" */
  contentOPFHook?: epubh.ContentOPFFn;
  /** Define a custom "processHTMLFile" */
  processHTMLFile?: (filePath: string, epubctxOut: epubh.EpubContext<SevenSeasECOptions>, config: SevenSeasonConfig) => Promise<void>;
  /** Define a custom ECOptions class */
  customECOptions?: typeof SevenSeasECOptions;
  /** Define a custom "doGenericPage" call */
  doGenericPage?: (
    documentInput: Document,
    entryType: EntryInformationExt,
    epubctxOut: epubh.EpubContext<SevenSeasECOptions>,
    currentInputFile: string,
    config: SevenSeasonConfig,
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
   * Define a hook for inside the default "generatePElementInner" to apply extra styling
   * Has no effect if a custom "generatePElementInner" is defined
   * Has no effect if the default "generatePElementInner" is not used in "doGenericPage"
   */
  generatePElementInnerHook?: GeneratePElementInnerHook;
  /** Define a custom title regex filter-out */
  TitlesToFilter?: RegExp;
  /** Define a custom files regex filter-out */
  FilesToFilter?: RegExp;
}

export async function process(options: utils.ConverterOptions, config: SevenSeasonConfig): Promise<string> {
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

  const outPath = await epubctxOut.finish({
    contentOPF: config.contentOPFHook ?? contentOPFHook,
  });

  const finishedEpubPath = path.resolve(options.converterOutputPath, `${epubctxOut.title}.epub`);

  await fspromises.copyFile(outPath, finishedEpubPath);

  // cleanup
  {
    await utils.removeDir(epubctxInput.rootDir);
    await utils.removeDir(epubctxOut.rootDir);
  }

  return finishedEpubPath;
}

// LOCAL

// extends, because otherwise it would complain about types being not correct in a alias
export class SevenSeasECOptions extends TextProcessingECOptions {
  public titleCache?: IsTitleCache;
}

/** Process a (X)HTML file from input to output */
export async function processHTMLFile(
  filePath: string,
  epubctxOut: epubh.EpubContext<SevenSeasECOptions>,
  config: SevenSeasonConfig
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

  const title = (config.getTitle ?? getTitle)(documentInput.title, config);

  // ignore the TOC, because a new one will be generated
  if (title.firstLine.toLowerCase() === 'table of contents') {
    return;
  }

  // ignore everything that matches the regex
  if (new RegExp(config.TitlesToFilter ?? DEFAULT_TITLES_TO_FILTER_OUT_REGEX).test(title.firstLine)) {
    log(`Skipping file "${filePath}" because it is in the filter regex (titles)`);

    return;
  }

  await (config.doGenericPage ?? doGenericPage)(documentInput, title, epubctxOut, filePath, config);
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
  config: SevenSeasonConfig,
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

    skipElements,
  });
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
  // not using just "includes" because it is slower than directly checking
  if (processedTitle === entryType.title || processedTitle.includes(entryType.title)) {
    return processedTitle;
  }

  if (processedTitle.replaceAll(' ', '').includes(entryType.title.replaceAll(' ', ''))) {
    return true;
  }

  // all headers have a "auto_bookmark_toc_top" id, in most books - the other checks are fallbacks
  if (elem.id.includes('auto_bookmark_toc_top')) {
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

/** Helper for consistent Image naming */
export function genImgIdData(
  optionsClass: SevenSeasECOptions,
  inputPath: string,
  imgNode: Element,
  entryType: EntryInformation
): DoTextContentOptionsGenImageData {
  const ext = path.extname(inputPath);

  // reset to frontmatter in case type is already set to cover
  if (optionsClass.imgTypeImplicit === epubh.ImgType.Cover) {
    optionsClass.setImgTypeImplicit(epubh.ImgType.Frontmatter);
  }

  // determine if the current image processing is for the cover
  if (COVER_TITLE_TEST_REGEX.test(entryType.title)) {
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

/** Return formatted and only elements that are required */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function generatePElementInner(
  origNode: Node,
  documentNew: Document,
  parentElem: Element,
  optionsClass: SevenSeasECOptions,
  config: SevenSeasonConfig
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

  if (origElem.localName === 'br') {
    return [documentNew.createElement('br')];
  }

  const classesToIgnore: string[] = [
    // default formatting for p, ignored
    'P_Normal__And__Left_Indent__And__Spacing_After__And__Spacing_Before',
    'P_Prose_Formatting',
    // default formatting for span, ignored
    'C_Current__And__Times_New_Roman',
    // default formatting for section markings, handled by "generatePElement"
    'P__STAR__STAR__STAR__page_break',
    'P_Prose_Formatting__And__Centre_Alignment',
    'P__STAR__STAR__STAR__page_break__And__Page_Break',
    'P_TEXTBODY_CENTERALIGN_PAGEBREAK',
    // transform all text to uppercase, ignored because all text is already uppercase
    'C_Nanomachines__And__Times_New_Roman__And__Capitals',
    'C_Current__And__Times_New_Roman__And__Capitals',
    // author signature (afterword), handled by "generatePElement"
    'P_Normal__And__Right_Alignment__And__Left_Indent__And__Spacing_After__And__Spacing_Before',
    'P_Prose_Formatting__And__Right_Alignment',
    // handled earlier in the function
    'C_Current__And__Times_New_Roman__And__Italic',
    'C_Current__And__Times_New_Roman__And__Bold__And__Italic',
    // extra indentation (and margin), handled by "generatePElement"
    'P_Prose_Formatting__And__Left_Indent',
    // this is always after a div with "page-break: always", but can be ignored
    'P_Prose_Formatting__And__Page_Break',
  ];
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
export function getTitle(headTitle: string, config: SevenSeasonConfig): EntryInformationExt {
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

  if (
    processTitles(['Copyrights and Credits', 'Table of Contents Page', 'Color Inserts', 'Title Page']).includes(
      type.toLowerCase().replaceAll(/\s/g, '')
    )
  ) {
    retObj.imgType = epubh.ImgType.Frontmatter;
  }

  if (processTitles(['Afterword']).includes(type.toLowerCase().replaceAll(/\s/g, ''))) {
    retObj.imgType = epubh.ImgType.Backmatter;
  }

  const fullTitle = !utils.isNullOrUndefined(retObj.secondLine) ? retObj.firstLine + ' ' + retObj.secondLine : retObj.firstLine;

  return {
    ...retObj,
    title: fullTitle,
  };
}
