import * as utils from '../utils.js';
import { promises as fspromises } from 'fs';
import * as epubh from '../helpers/epub.js';
import * as sh from '../helpers/string.js';
import * as xh from '../helpers/xml.js';
import * as path from 'path';
import { getTemplate, applyTemplate } from '../helpers/template.js';
import * as mime from 'mime-types';

const log = utils.createNameSpace('htmlTextProcessing');

/** Represents the Type of the Current File */
export enum EntryType {
  Ignore,
  Text,
  Image,
}

/** Information about the Current File */
export interface EntryInformation {
  /** The Type of the Current File */
  type: EntryType;
  /** The Title of the Current File */
  title: string;
}

export interface DoTextContentOptionsGenImageData {
  /**
   * The Section id, which is used for the sectionid and as a image "alt"
   * @example This should output something like "insert1"
   */
  sectionId: string;
  /**
   * Filename of the Image file itself to store the file as (with extension)
   * @example This should output something like "Insert1.png"
   */
  imgFilename: string;
  /**
   * Filename (without extension) of the xhtml containing the image
   * @example This should output something like "insert1" (which later becomes "insert1.xhtml")
   */
  xhtmlFilename: string;
  /** The Image Class to use */
  imgClass: epubh.ImgClass;
}

export interface DoTextContentOptionsGenSectionId {
  /**
   * Generate the SectionId that is used for a Chapter
   * A SectionId is also used for the filename
   * @example This should output something like "chapter1_1"
   */
  sectionId: string;
  /**
   * Set which type this Text is meant to be
   * @default "EpubContextFileXHTMLTextType"
   * @example Change to "EpubContextFileXHTMLCreditsType" for the Credits Page
   */
  useType?: epubh.EpubContextNewFileXHTMLType;
}

export interface DoTextContentOptionsGenTextIdDataExtra {
  /**
   * This is "true" if before calling {@link DoTextContentOptions.genImageIdData} the {@link BaseTrackers.Chapter} Tracker has been incremented because of a title
   * otherwise "false"
   * Options not present when not being the first sub-chapter
   * @example When processing a "Credits" Page, the "Chapter" counter would need to be manually decremented again
   */
  increasedChapterWithTitle?: boolean;
}

export interface DoTextContentOptions<Options extends TextProcessingECOptions> {
  /**
   * Generate the SectionId that is used for a Chapter
   * A SectionId is also used for the filename
   * @example This should output something like "chapter1_1"
   * @param optionsClass The Options class with all Context
   * @param entryType The Entry Type with title
   * @param extra Some Extra Options to determine what has been done
   */
  genTextIdData(
    optionsClass: Options,
    entryType: EntryInformation,
    extra: DoTextContentOptionsGenTextIdDataExtra
  ): DoTextContentOptionsGenSectionId;
  /**
   * Generate Image data, like image id and filenames
   * @param optionsClass The Options class with all Context
   * @param inputImg the full file path for the input image
   */
  genImageIdData(optionsClass: Options, inputImg: string): DoTextContentOptionsGenImageData;
  /**
   * Generate the "h1" element's content
   * @param document The Current DOM Document
   * @param entryType The Entry Type with title
   * @param h1Element The h1 header element (eg chapter)
   * @returns nothing, the "h1Element" input should be directly modified and that will be used
   */
  genChapterHeaderContent(document: Document, entryType: EntryInformation, h1Element: HTMLHeadingElement): void;
  /**
   * Return formatted and only elements that are required
   * @param origNode The original node to process
   * @param documentNew The Document to create new nodes on
   * @param parentElem The Element the new nodes are added to (will not be applied by this function), required for testing and applying styles
   * @param optionsClass The Options class with all Context
   * @returns The array of new Nodes
   */
  genPElemText(origNode: Node, documentNew: Document, parentElem: Element, optionsClass: Options): Node[];
  /**
   * Define a custom condition for wheter a element should be skipped or kept
   * @param elem The Element to check
   * @returns "true" when it should be skipped
   */
  checkElement?(elem: Element): boolean;
  /**
   * Define a custom function to check if something is a heading
   * This is required for Epub's that dont use normal headings with "h1" or include the exact title in "head > title" (like a normal "p" with a class)
   * @param document The INPUT document
   * @param elem The Element to check
   * @param entryType The Entry Type with title already parsed from somewhere else
   * @param optionsClass The Options class with all Context
   * @returns "true" if a element is a title, or a string with a updated title (if string it always means "true")
   */
  isTitle?(document: Document, elem: Element, entryType: EntryInformation, optionsClass: Options): boolean | string;
  /**
   * Define a function to cache some things before calling "isTitle" in a loop
   * cached Options should be defined on "optionsClass"
   * @param document The INPUT document
   * @param optionsClass The Options class with all Context
   */
  cachedIsTitleOptions?(document: Document, optionsClass: Options): void;

  /**
   * Set a static number of elements to skip in the beginning regardless of what it is
   * Empty Elements count towards this counter
   * @default 0
   */
  skipElements?: number;
  /**
   * The number of initial elements to check for a heading
   * Empty Elements are also checked and count towards this counter
   * @default 5
   */
  headerSearchCount?: number;
}

export interface BaseTrackers extends epubh.BaseEpubContextTrackers {
  /**
   * Tracker for the Current Sequence number, stores the next to use number
   * Used to sort the Chapter itself (text and images)
   */
  CurrentSeq: number;
  /**
   * Tracker for what Chapter Number it currently is on, stores the last used number
   * Used for Text File naming, this values is used for "X" in "chapterX_0"
   */
  Chapter: number;
  /**
   * Tracker for what Sub-Chapter Number it currently is on, stores the next to use number
   * Used for Text File naming, this value is used for "X" in "chapter0_X"
   */
  CurrentSubChapter: number;
  /**
   * Tracker for what Insert (image) number it currently is on, stores the last used number
   * Used for Image file naming for in-chapter images
   */
  Insert: number;
  /**
   * Tracker for what Frontmatter (image) number it currently is on, stores the last used number
   * Used for Image file naming for Frontmatter images
   */
  Frontmatter: number;
  /**
   * Tracker for what Backmatter (image) number it currently is on, stores the last used number
   * Used for Image file naming for Backmatter images
   */
  Backmatter: number;
}

export enum LastProcessedType {
  None,
  Image,
}

export class TextProcessingECOptions<
  ExtraTrackers extends string | keyof BaseTrackers = keyof BaseTrackers
> extends epubh.BaseEpubOptions<ExtraTrackers> {
  /** Stores the implicit image type to use */
  protected _imgType: Omit<epubh.ImgType, 'Cover'> = epubh.ImgType.Frontmatter;
  /** Stores the last type processed */
  protected _lastType: LastProcessedType = LastProcessedType.None;

  /**
   * Get the Last Type Processed
   */
  get lastType() {
    return this._lastType;
  }

  /**
   * Get the Img Type to use if not explicit
   */
  get imgTypeImplicit() {
    return this._imgType;
  }

  /**
   * Set the "LastType" used
   * @param toType The Type to set to
   * @returns The type that was set
   */
  public setLastType(toType: TextProcessingECOptions['_lastType']) {
    this._lastType = toType;

    return this._lastType;
  }

  /**
   * Set the "ImgType" to use for implicit images
   * @param toType The Type to set to
   * @returns The type that was set
   */
  public setImgTypeImplicit(toType: TextProcessingECOptions['_imgType']) {
    this._imgType = toType;

    return this._imgType;
  }
}

/**
 * Handle everything related to the "Title.Chapter" type
 * @param documentInput The Input Document's "document.body"
 * @param entryType The Title Object
 * @param epubctx EPUB Context of the Output file
 * @param currentInputFile Currently processing's Input file path
 * @param options The Functions to use for this run
 */
export async function doTextContent<Options extends TextProcessingECOptions>(
  documentInput: Document,
  entryType: EntryInformation,
  epubctx: epubh.EpubContext<Options>,
  currentInputFile: string,
  options: DoTextContentOptions<Options>
): Promise<void> {
  // do resets because the last type was a image (type 1)
  if (epubctx.optionsClass.lastType === LastProcessedType.Image) {
    epubctx.optionsClass.setLastType(LastProcessedType.None); // reset the value

    // only increment "CurrentSubChapter" when "ImgType" is set to "Insert", because this indicates that it is still in a chapter
    if (epubctx.optionsClass.imgTypeImplicit === epubh.ImgType.Insert) {
      epubctx.optionsClass.incTracker('CurrentSubChapter');
    }
  }

  /** Used as a reset condition for "CurrentSubChapter" */
  let hasTitle = false;

  // determine if the first elements have a heading element, which would indicate that it is a new chapter and not a continuation
  // if yes, it is used as a "reset condition"
  {
    if (!utils.isNullOrUndefined(options.cachedIsTitleOptions)) {
      options.cachedIsTitleOptions(documentInput, epubctx.optionsClass);
    }

    options.headerSearchCount =
      !utils.isNullOrUndefined(options.headerSearchCount) && options.headerSearchCount >= 0
        ? options.headerSearchCount
        : STATICS.DEFAULT_HEADER_SEARCH_COUNT;

    options.isTitle = !utils.isNullOrUndefined(options.isTitle) ? options.isTitle : isH1Title;
    const foundElem = Array.from(documentInput.querySelectorAll('body > *')).slice(0, options.headerSearchCount);

    for (const elem of foundElem) {
      const newTitle = options.isTitle(documentInput, elem, entryType, epubctx.optionsClass);

      if (newTitle) {
        hasTitle = true;

        // in some cases, the "head>title" and the "body>heading" text do not match, in those cases use the "body>heading" text when available
        if (typeof newTitle === 'string') {
          entryType.title = newTitle;
        }

        break;
      }
    }
  }

  /** Flag to decrement the "Chapter" tracker again if later determined that it should not have (like copyright page) */
  let increasedChapter = false;

  // reset Trackers when either "hasTitle" (found a title in the body) or when "ImgType" is anything but "insert"
  if (epubctx.optionsClass.imgTypeImplicit !== epubh.ImgType.Insert || hasTitle) {
    epubctx.optionsClass.resetTracker('CurrentSeq');
    epubctx.optionsClass.resetTracker('CurrentSubChapter');
    epubctx.optionsClass.setImgTypeImplicit(epubh.ImgType.Insert);

    // only increment "Chapter" tracker if the current document has a heading detected in the body
    if (hasTitle) {
      increasedChapter = true;
      epubctx.optionsClass.incTracker('Chapter');
    }
  }

  let textIdData = callGenTextIdData(entryType, epubctx, options, {
    increasedChapterWithTitle: increasedChapter,
  });

  const globState = epubctx.optionsClass.incTracker('Global');
  let { dom: currentDOM, document: documentNew, mainElem } = await createXHTMLlnDOM(entryType, textIdData.sectionId, epubctx);
  // create initial "h1" (header) element and add it
  {
    // dont add header if ImgType is "inChapter"
    if (epubctx.optionsClass.getTracker('CurrentSubChapter') === 0) {
      const h1element = documentNew.createElement('h1');
      options.genChapterHeaderContent(documentNew, entryType, h1element);
      mainElem.appendChild(h1element);
    }
  }
  /** Tracker to skip elements unconditionally */
  let toSkipNumber =
    !utils.isNullOrUndefined(options.skipElements) && options.skipElements >= 0 ? options.skipElements : STATICS.DEFAULT_SKIP_ELEMENTS;

  const innerElements = Array.from(documentInput.querySelector('body')?.children ?? []);
  const customChecker = options.checkElement;
  for (const [index, elem] of innerElements.entries()) {
    // for this series, it is safe to assume that the first element is the chapter "p" element
    if (toSkipNumber > 0) {
      toSkipNumber -= 1;
      continue;
    }

    // skip elements when the customChecker deems it necessary
    if (!utils.isNullOrUndefined(customChecker) && customChecker(elem)) {
      continue;
    }

    const imgNode = elem.querySelector('img');

    // use this path if "p" which contains text data, or if a "imgNode" is found
    if (elem.localName === 'p' || !utils.isNullOrUndefined(imgNode)) {
      const skipSavingMainDOM = isElementEmpty(mainElem) || onlyhash1(mainElem);

      // finish current dom and save the found image and start the next dom
      if (!utils.isNullOrUndefined(imgNode)) {
        // dont save a empty dom
        if (!skipSavingMainDOM) {
          const xhtmlNameMain = `${textIdData.sectionId}.xhtml`;
          await epubh.finishDOMtoFile(currentDOM, epubctx.contentOPFDir, xhtmlNameMain, epubh.FileDir.Text, epubctx, {
            id: xhtmlNameMain,
            seqIndex: epubctx.optionsClass.getTracker('CurrentSeq'),
            title: entryType.title,
            type: textIdData.useType,
            globalSeqIndex: globState,
          });
          epubctx.optionsClass.incTracker('CurrentSubChapter');
          epubctx.optionsClass.incTracker('CurrentSeq');
        }

        const imgFromPath = path.resolve(path.dirname(currentInputFile), imgNode.src);
        const {
          imgClass: imgtype,
          sectionId: imgid,
          imgFilename: imgFilename,
          xhtmlFilename: imgXHTMLFileName,
        } = options.genImageIdData(epubctx.optionsClass, imgFromPath);
        await copyImage(imgFromPath, epubctx, imgFilename, imgid);
        const { dom: imgDOM } = await createIMGlnDOM(
          entryType,
          imgid,
          imgtype,
          path.join('..', epubh.FileDir.Images, imgFilename),
          epubctx
        );
        const xhtmlNameIMG = `${imgXHTMLFileName}.xhtml`;
        await epubh.finishDOMtoFile(imgDOM, epubctx.contentOPFDir, xhtmlNameIMG, epubh.FileDir.Text, epubctx, {
          id: xhtmlNameIMG,
          seqIndex: epubctx.optionsClass.getTracker('CurrentSeq'),
          title: entryType.title,
          type:
            // use "textIdData.useType" over static, because this might define a cover
            textIdData.useType.type === epubh.EpubContextFileXHTMLTypes.IMG
              ? textIdData.useType
              : {
                  type: epubh.EpubContextFileXHTMLTypes.IMG,
                  imgClass: epubh.ImgClass.Insert,
                  imgType: epubh.ImgType.Insert,
                },
          globalSeqIndex: globState,
        });
        epubctx.optionsClass.incTracker('CurrentSeq');

        // dont create a new dom if the old one is still empty
        if (!skipSavingMainDOM) {
          textIdData = callGenTextIdData(entryType, epubctx, options, {});
          const nextchapter = await createXHTMLlnDOM(entryType, textIdData.sectionId, epubctx);
          currentDOM = nextchapter.dom;
          documentNew = nextchapter.document;
          mainElem = nextchapter.mainElem;
        }

        continue;
      }

      // skip all elements that are empty when the mainElem does not contain anything yet or only the header
      if (skipSavingMainDOM && sh.xmlToString(elem.textContent ?? '')?.trim().length === 0) {
        continue;
      }

      // extra fast checks, because "isTitle" requires much computing and does not need to be executed so often
      const execIsTitle = epubctx.optionsClass.getTracker('CurrentSubChapter') === 0 && index < options.headerSearchCount;

      // skip the existing header elements
      if (execIsTitle && options.isTitle(documentInput, elem, entryType, epubctx.optionsClass)) {
        continue;
      }

      mainElem.appendChild(genPElem(elem, documentNew, options, epubctx));
      continue;
    }
    if (elem.localName === 'div') {
      // ignore all empty div elements
      if (elem.childNodes.length === 0) {
        continue;
      }
    }

    console.error(`Unhandled "localName": ${elem.localName}`.red);
  }

  // ignore DOM's that are empty or only have the chapter header
  if (!isElementEmpty(mainElem) && !onlyhash1(mainElem)) {
    const xhtmlNameMain = `${textIdData.sectionId}.xhtml`;
    await epubh.finishDOMtoFile(currentDOM, epubctx.contentOPFDir, xhtmlNameMain, epubh.FileDir.Text, epubctx, {
      id: xhtmlNameMain,
      seqIndex: epubctx.optionsClass.getTracker('CurrentSeq'),
      title: entryType.title,
      type: textIdData.useType,
      globalSeqIndex: globState,
    });
    epubctx.optionsClass.incTracker('CurrentSeq');
  } else {
    log('Not saving final DOM, because main element is empty');
  }
}

/**
 * Check if it only has one element and that one element is the "h1"
 * Only returns "true" if there is one element and that one element is a "h1"
 * @param elem The Element to check
 * @returns "true" if there is one element and that one element is a "h1"
 */
export function onlyhash1(elem: Element): boolean {
  return elem.children.length === 1 && elem.children[0].localName === 'h1';
}

/** Small Helper functions to consistently tell if a node has no children */
export function isElementEmpty(elem: Element): boolean {
  return elem.childNodes.length === 0;
}

/** Helper for consistent calling and processing of "genTextIdData" */
function callGenTextIdData<Options extends TextProcessingECOptions>(
  entryType: EntryInformation,
  epubctx: epubh.EpubContext<Options>,
  options: DoTextContentOptions<Options>,
  extra: DoTextContentOptionsGenTextIdDataExtra
): Required<DoTextContentOptionsGenSectionId> {
  const genTextIdData = options.genTextIdData(epubctx.optionsClass, entryType, extra);

  return {
    ...genTextIdData,
    sectionId: epubh.normalizeId(genTextIdData.sectionId),
    useType: genTextIdData.useType ?? {
      type: epubh.EpubContextFileXHTMLTypes.TEXT,
    },
  };
}

/** Default "isTitle" function to detect titles */
export function isH1Title(
  document: Document,
  elem: Element,
  entryType: EntryInformation,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _optionsClass: TextProcessingECOptions
): boolean | string {
  const processedTitle = sh.xmlToString(elem.textContent ?? '');

  // basic fast test if the content matches the parsed title
  // not using just "includes" because it is slower than directly checking
  if (processedTitle === entryType.title || processedTitle.includes(entryType.title)) {
    return processedTitle;
  }

  if (elem.localName === 'h1') {
    return elem.textContent ?? true;
  }

  return false;
}

/**
 * Transform top-level "p" elements to new elements on the new document
 * @param origElem Original container element
 * @param documentNew The document to generate elements on
 * @param options The Functions to use for this run
 * @param epubctx EPUB Context of the Output file
 * @returns The new Node to add
 */
function genPElem<Options extends TextProcessingECOptions>(
  origElem: Element,
  documentNew: Document,
  options: DoTextContentOptions<Options>,
  epubctx: epubh.EpubContext<Options>
): Element {
  const topElem = documentNew.createElement('p');

  for (const elem of options.genPElemText(origElem, documentNew, topElem, epubctx.optionsClass)) {
    topElem.appendChild(elem);
  }

  return topElem;
}

interface ICreateXHTMLlnDOM extends xh.INewJSDOMReturn {
  mainElem: Element;
}

/**
 * Create a dom from "xhtml-ln.xhtml" template easily
 * @param entryType The Title object
 * @param sectionId The id of the "section" element
 * @param epubctx The Epub Context
 * @param jsdomOptions Custom Options for JSDOM, by default will use {@link STATICS.JSDOM_XHTML_OPTIONS}
 * @returns The DOM, document and mainelement
 */
export async function createXHTMLlnDOM(
  entryType: EntryInformation,
  sectionId: string,
  epubctx: epubh.EpubContext<any, any>,
  jsdomOptions = STATICS.JSDOM_XHTML_OPTIONS
): Promise<ICreateXHTMLlnDOM> {
  const modXHTML = applyTemplate(await getTemplate('xhtml-ln.xhtml'), {
    '{{TITLE}}': entryType.title,
    '{{SECTIONID}}': sectionId,
    '{{EPUBTYPE}}': epubh.EPubType.BodyMatterChapter,
    '{{CSSPATH}}': path.join('..', epubctx.getRelCssPath(epubctx.contentOPFDir)),
  });

  // set custom "contentType" to force it to output xhtml compliant html (like self-closing elements to have a "/")
  const ret = xh.newJSDOM(modXHTML, jsdomOptions);
  const mainElement = xh.queryDefinedElement(ret.document, 'div.main');

  return {
    ...ret,
    mainElem: mainElement,
  };
}

/**
 * Create a dom from the "img-ln.xhtml" template easily
 * @param entryType The Title object
 * @param sectionId The id of the "section" element, will also be used for the "imgalt"
 * @param imgClass The class the "img" element should have
 * @param imgSrc The source of the "img" element
 * @param epubctx The Epub Context
 * @param jsdomOptions Custom Options for JSDOM, by default will use {@link STATICS.JSDOM_XHTML_OPTIONS}
 * @returns The DOM, document and mainelement
 */
export async function createIMGlnDOM(
  entryType: EntryInformation,
  sectionId: string,
  imgClass: epubh.ImgClass,
  imgSrc: string,
  epubctx: epubh.EpubContext<any, any>,
  jsdomOptions = STATICS.JSDOM_XHTML_OPTIONS
): Promise<ReturnType<typeof xh.newJSDOM>> {
  const modXHTML = applyTemplate(await getTemplate('img-ln.xhtml'), {
    '{{TITLE}}': entryType.title,
    '{{SECTIONID}}': sectionId,
    '{{EPUBTYPE}}': epubh.EPubType.BodyMatterChapter,
    '{{IMGALT}}': sectionId,
    '{{IMGCLASS}}': imgClass,
    '{{IMGSRC}}': imgSrc,
    '{{CSSPATH}}': path.join('..', epubctx.getRelCssPath(epubctx.contentOPFDir)),
  });

  // set custom "contentType" to force it to output xhtml compliant html (like self-closing elements to have a "/")
  return xh.newJSDOM(modXHTML, jsdomOptions);
}

/**
 * Copy a Image from input to the output and add it to the epubctx
 * @param fromPath The Path to copy from
 * @param epubctx The epubctx to add it to
 * @param filename The filename to use for the image
 * @param id The id to use for this iamge
 * @returns The copied-path
 */
export async function copyImage(fromPath: string, epubctx: epubh.EpubContext<any, any>, filename: string, id: string): Promise<string> {
  const copiedPath = path.resolve(epubctx.contentOPFDir, epubh.FileDir.Images, filename);
  await utils.mkdir(path.dirname(copiedPath));
  await fspromises.copyFile(fromPath, copiedPath);

  const mimetype = mime.lookup(filename) || undefined;

  utils.assertionDefined(mimetype, new Error('Expected "mimetype" to be defined'));

  epubctx.addFile(
    new epubh.EpubContextFileBase({
      filePath: copiedPath,
      mediaType: mimetype,
      id: id,
    })
  );

  return copiedPath;
}

export const STATICS = {
  /** Default JSDOM Options */
  JSDOM_XHTML_OPTIONS: { contentType: xh.STATICS.XHTML_MIMETYPE },
  /** The default header search count */
  DEFAULT_HEADER_SEARCH_COUNT: 5,
  /** The default amount of elements to skip regardless of what they are */
  DEFAULT_SKIP_ELEMENTS: 0,
};