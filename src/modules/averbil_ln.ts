import * as utils from '../utils.js';
import { promises as fspromises } from 'fs';
import * as path from 'path';
import * as tmp from 'tmp';
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
} from '../helpers/htmlTextProcessing.js';

const log = utils.createNameSpace('averbil_ln');

tmp.setGracefulCleanup();

// STATIC OPTIONS
const INPUT_MATCH_REGEX = /Didn.{1}t I Say to Make My Abilities Average/gim;
/** Regex of files to filter out (to not include in the output) */
const FILES_TO_FILTER_OUT_REGEX = /newsletter|sevenseaslogo/gim;
const TITLES_TO_FILTER_OUT_REGEX = /newsletter/gim;
const COVER_XHTML_FILENAME = 'cover';
const JSDOM_XHTML_OPTIONS = { contentType: xh.STATICS.XHTML_MIMETYPE };

// CODE

// EXPORTS
export default function averbil_ln(): utils.ConverterModule {
  return { matcher, process };
}

export function matcher(name: string): boolean {
  const ret = INPUT_MATCH_REGEX.test(name);
  // reset regex after use, because they have a state, seemingly even with "test"
  INPUT_MATCH_REGEX.lastIndex = 0;

  return ret;
}

export async function process(options: utils.ConverterOptions): Promise<string> {
  const epubctxInput = await epubh.getInputContext(options.fileInputPath);

  const epubctxOut = new epubh.EpubContext<AverbnilECOptions>({
    title: epubctxInput.title,
    optionsClass: new AverbnilECOptions(),
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
    log(`Processing file "${file}", ${mimetype}`);

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

  // check needs to be done, because it does not carry over from the function that defined it
  utils.assertionDefined(epubctxInput.customData, new Error('Expected "epubctxInput.customData" to be defined at this point'));
  const contentOPFInput = epubctxInput.customData.contentOPFDoc;

  function contentOPFHook({ document, idCounter, metadataElem }: Parameters<epubh.ContentOPFFn>[0]) {
    const packageElementOld = xh.queryDefinedElement(contentOPFInput, 'package');
    const metadataElementOld = xh.queryDefinedElement(contentOPFInput, 'metadata');

    // copy metadata from old to new
    // using "children" to exclude text nodes
    for (const elem of Array.from(metadataElementOld.children)) {
      // special handling for "cover", just to be sure
      if (elem.localName === 'meta' && elem.getAttribute('name') === 'cover') {
        const coverImgId = epubctxOut.files.find((v) => v.id.includes('cover') && v.mediaType != xh.STATICS.XHTML_MIMETYPE);
        utils.assertionDefined(coverImgId, new Error('Expected "coverImgId" to be defined'));
        const newCoverNode = document.createElementNS(metadataElem.namespaceURI, 'meta');
        newCoverNode.setAttribute('name', 'cover');
        newCoverNode.setAttribute('content', coverImgId.id);
        metadataElem.appendChild(newCoverNode);
        continue;
      }

      let newNode: Element | undefined = undefined;

      if (elem.tagName === 'dc:title') {
        // ignore title element, because its already added in generateContentOPF
        continue;
      } else if (elem.tagName === 'dc:publisher') {
        newNode = document.createElementNS(xh.STATICS.DC_XML_NAMESPACE, 'dc:publisher');
        utils.assertionDefined(elem.textContent, new Error('Expected "elem.textContent" to be defined'));
        newNode.appendChild(document.createTextNode(elem.textContent));
      } else if (elem.tagName === 'dc:language') {
        newNode = document.createElementNS(xh.STATICS.DC_XML_NAMESPACE, 'dc:language');
        utils.assertionDefined(elem.textContent, new Error('Expected "elem.textContent" to be defined'));
        newNode.appendChild(document.createTextNode(elem.textContent));
      } else if (elem.tagName === 'dc:creator') {
        idCounter += 1;
        newNode = document.createElementNS(xh.STATICS.DC_XML_NAMESPACE, 'dc:creator');
        utils.assertionDefined(elem.textContent, new Error('Expected "elem.textContent" to be defined'));
        newNode.appendChild(document.createTextNode(elem.textContent));
        newNode.setAttribute('id', `id-${idCounter}`);
      } else if (elem.tagName === 'dc:date') {
        newNode = document.createElementNS(xh.STATICS.DC_XML_NAMESPACE, 'dc:date');
        utils.assertionDefined(elem.textContent, new Error('Expected "elem.textContent" to be defined'));
        newNode.appendChild(document.createTextNode(elem.textContent));
      } else if (elem.tagName === 'dc:identifier') {
        newNode = document.createElementNS(xh.STATICS.DC_XML_NAMESPACE, 'dc:identifier');
        utils.assertionDefined(elem.textContent, new Error('Expected "elem.textContent" to be defined'));
        newNode.appendChild(document.createTextNode(elem.textContent));
        {
          const packageUniqueID = packageElementOld.getAttribute('unique-identifier');
          const elemID = elem.getAttribute('id');

          if (!utils.isNullOrUndefined(packageUniqueID) && !utils.isNullOrUndefined(elemID) && packageUniqueID === elemID) {
            newNode.setAttribute('id', 'pub-id');
          }
        }

        if (elem.getAttribute('opf:scheme') === 'calibre') {
          newNode.setAttribute('opf:scheme', 'calibre');
        }
      }

      if (!utils.isNullOrUndefined(newNode)) {
        metadataElem.appendChild(newNode);
      }
    }

    // apply series metadata (to have automatic sorting already)
    {
      // Regex to extract the series title and if available the volume position
      const caps = /^(?<series>.+?)( (?:Vol\.|Volume) (?<num>\d+))?$/gim.exec(epubctxOut.title);

      if (!utils.isNullOrUndefined(caps)) {
        const seriesTitleNoVolume = utils.regexMatchGroupRequired(caps, 'series', 'contentOPFHook meta collection');
        const seriesPos = utils.regexMatchGroup(caps, 'num');

        idCounter += 1;
        const metaCollectionId = `id-${idCounter}`;
        const metaCollectionElem = document.createElementNS(xh.STATICS.OPF_XML_NAMESPACE, 'meta');
        const metaTypeElem = document.createElementNS(xh.STATICS.OPF_XML_NAMESPACE, 'meta');
        const metaPositionElem = document.createElementNS(xh.STATICS.OPF_XML_NAMESPACE, 'meta');

        xh.applyAttributes(metaCollectionElem, {
          property: 'belongs-to-collection',
          id: metaCollectionId,
        });
        metaCollectionElem.appendChild(document.createTextNode(seriesTitleNoVolume));

        xh.applyAttributes(metaTypeElem, {
          refines: `#${metaCollectionId}`,
          property: 'collection-type',
        });
        metaTypeElem.appendChild(document.createTextNode('series'));

        xh.applyAttributes(metaPositionElem, {
          refines: `#${metaCollectionId}`,
          property: 'group-position',
        });
        // default to "1" in case it does not have a volume id (like a spinoff)
        metaPositionElem.appendChild(document.createTextNode(seriesPos ?? '1'));

        metadataElem.appendChild(metaCollectionElem);
        metadataElem.appendChild(metaTypeElem);
        metadataElem.appendChild(metaPositionElem);
      } else {
        log('Found no series captures for: "'.red + epubctxOut.title.grey + '"'.red);
      }
    }
  }

  const outPath = await epubctxOut.finish({
    contentOPF: contentOPFHook,
  });

  const finishedEpubPath = path.resolve(options.converterOutputPath, `${epubctxOut.title}.epub`);

  await fspromises.copyFile(outPath, finishedEpubPath);

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

// LOCAL

// extends, because otherwise it would complain about types being not correct in a alias
class AverbnilECOptions extends TextProcessingECOptions {
  public titleCache?: IsTitleCache;
}

/** Process a (X)HTML file from input to output */
async function processHTMLFile(filePath: string, epubctxOut: epubh.EpubContext<AverbnilECOptions>): Promise<void> {
  const loadedFile = await fspromises.readFile(filePath);
  const { document: documentInput } = xh.newJSDOM(loadedFile, JSDOM_XHTML_OPTIONS);

  const title = getTitle(documentInput.title);

  // ignore the TOC, because a new one will be generated
  if (title.firstLine.toLowerCase() === 'table of contents') {
    return;
  }

  // ignore everything that matches the regex
  if (new RegExp(TITLES_TO_FILTER_OUT_REGEX).test(title.firstLine)) {
    log(`Skipping file "${filePath}" because it is in the filter regex (titles)`);

    return;
  }

  await doGenericPage(documentInput, title, epubctxOut, filePath);
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
  entryType: Title2,
  epubctxOut: epubh.EpubContext<AverbnilECOptions>,
  currentInputFile: string,
  skipElements?: number
): Promise<void> {
  const checkElemIndex = 0;
  const title = entryType;

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
      // extra handling for double-headings, see Volume 1 Short-Stories
      if (title.firstLine.includes('Short Story')) {
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

      h1Element.appendChild(document.createTextNode(title.firstLine));

      if (!utils.isNullOrUndefined(title.secondLine)) {
        h1Element.appendChild(document.createElement('br'));
        h1Element.appendChild(document.createTextNode(title.secondLine));
      }
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
    // custom checkElem to skip multi-"p" headers, see Volume 1 Short-Stories
    checkElement(elem) {
      if (checkElemIndex < 3 && title.firstLine.includes('Short Story')) {
        if (elem.className.includes('P__STAR__STAR__STAR__page_break')) {
          return true;
        }
      }

      return false;
    },

    skipElements,
    // headerSearchCount: TITLE_CHECK_NUMBER,
  });
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
function isTitle(document: Document, elem: Element, entryType: EntryInformation, optionsClass: AverbnilECOptions): boolean | string {
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
function genImgIdData(
  optionsClass: AverbnilECOptions,
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
  if (entryType.title.trim().toLowerCase().includes('cover')) {
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

interface GeneratePElementInnerElem {
  topElem?: Element;
  currentElem?: Element;
}

/**
 * Helper Function for "generatePElementInner" to consistently update the elements
 * Updates the "obj" with the topElement if unset, and adds "newNode" to "currentElem" and re-assigns the "currentElem"
 * @param obj The Object to modify
 * @param newNode The new Node to add
 */
function helperAssignElem(obj: GeneratePElementInnerElem, newNode: Element) {
  if (utils.isNullOrUndefined(obj.currentElem)) {
    obj.currentElem = newNode;
    obj.topElem = newNode;
  } else {
    obj.currentElem.appendChild(newNode);
    obj.currentElem = newNode;
  }
}

/** Return formatted and only elements that are required */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function generatePElementInner(origNode: Node, documentNew: Document, parentElem: Element, _optionsClass: AverbnilECOptions): Node[] {
  if (origNode.nodeType === documentNew.TEXT_NODE) {
    utils.assertionDefined(origNode.textContent, new Error('Expected "origElem.textContent" to be defined'));

    return [documentNew.createTextNode(origNode.textContent)];
  }

  if (origNode.nodeType !== documentNew.ELEMENT_NODE) {
    console.error('Encountered unhandled "nodeType":'.red, origNode.nodeType);

    return [];
  }

  const origElem = origNode as Element;

  if (origElem.localName === 'p') {
    if (
      (origElem.className.includes('P__STAR__STAR__STAR__page_break') ||
        origElem.className.includes('P_Prose_Formatting__And__Centre_Alignment') ||
        origElem.className.includes('P__STAR__STAR__STAR__page_break__And__Page_Break') ||
        origElem.className.includes('P_TEXTBODY_CENTERALIGN_PAGEBREAK')) &&
      // only allow elements to have this class when not being empty of text
      (origElem.textContent?.trim().length ?? 0) > 0
    ) {
      parentElem.setAttribute('class', 'centerp section-marking');
    } else if (
      origElem.className.includes('P_Normal__And__Right_Alignment__And__Left_Indent__And__Spacing_After__And__Spacing_Before') ||
      origElem.className.includes('P_Prose_Formatting__And__Right_Alignment')
    ) {
      parentElem.setAttribute('class', 'signature');
    } else if (origElem.className.includes('P_Prose_Formatting__And__Left_Indent')) {
      parentElem.setAttribute('class', 'extra-indent');
    }
  }

  if (origElem.localName === 'br') {
    return [documentNew.createElement('br')];
  }

  const elemObj: GeneratePElementInnerElem = {};

  const origElemStyle = origElem.getAttribute('style');

  if (
    origElem.className.includes('C_Current__And__Times_New_Roman__And__Italic') ||
    origElem.className.includes('C_Current__And__Times_New_Roman__And__Bold__And__Italic') ||
    origElemStyle?.includes('font-style: italic')
  ) {
    helperAssignElem(elemObj, documentNew.createElement('em'));
  }
  if (
    origElemStyle?.includes('font-weight: bold') ||
    origElem.className.includes('C_Current__And__Times_New_Roman__And__Bold__And__Italic')
  ) {
    helperAssignElem(elemObj, documentNew.createElement('strong'));
  }
  if (origElemStyle?.includes('vertical-align: super') && origElemStyle?.includes('font-size')) {
    helperAssignElem(elemObj, documentNew.createElement('sup'));
  }
  if (origElemStyle?.includes('vertical-align: sub') && origElemStyle?.includes('font-size')) {
    helperAssignElem(elemObj, documentNew.createElement('sub'));
  }

  const styleList = origElemStyle
    ?.split(';')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  const IGNORE_STYLE_REGEX = /font-style|font-weight|color|font-size|text-transform|vertical-align|letter-spacing|text-decoration/gim;

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

  if (origElem.className.length != 0 && !classesToIgnore.includes(origElem.className)) {
    console.log('encountered unknown class'.red, origElem.className);
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

interface Title2 extends EntryInformation {
  firstLine: string;
  secondLine?: string;
  imgType: epubh.ImgType;
}

const GENERIC_TITLE_REGEX = /^\s*(?<type>.+?)(?: (?<num>\d+))?(?:: (?<title>.+?))?\s*$/im;

/** Helper function to process a array into lowercase and remove all spaces */
function processTitles(arr: string[]): string[] {
  return arr.map((v) => v.toLowerCase().replaceAll(/\s/g, ''));
}

/**
 * Function to get the title accurately
 * @param headTitle The Title to parse
 * @returns The Processed title
 */
function getTitle(headTitle: string): Title2 {
  const matches = GENERIC_TITLE_REGEX.exec(headTitle);

  utils.assertionDefined(matches, new Error('Failed to get matches for Title'));

  const type = utils.regexMatchGroupRequired(matches, 'type', 'getTitle');
  const numString = utils.regexMatchGroup(matches, 'num');
  const title = utils.regexMatchGroup(matches, 'title');

  let firstLine: string;
  let secondLine: string | undefined = undefined;

  if (!utils.isNullOrUndefined(numString)) {
    firstLine = type + ` ${numString}`;
  } else {
    firstLine = type;
  }

  if (!utils.isNullOrUndefined(title)) {
    firstLine += ':';
    secondLine = title;
  }

  let imgType = epubh.ImgType.Insert;

  if (
    processTitles([
      'Copyrights and Credits',
      'Table of Contents Page',
      'Cast of Characters',
      'Color Inserts',
      'Title Page',
      'Cast Of Characters',
      'Table of Contents Page',
    ]).includes(type.toLowerCase().replaceAll(/\s/g, ''))
  ) {
    imgType = epubh.ImgType.Frontmatter;
  }

  if (processTitles(['Afterword']).includes(type.toLowerCase().replaceAll(/\s/g, ''))) {
    imgType = epubh.ImgType.Backmatter;
  }

  const fullTitle = !utils.isNullOrUndefined(secondLine) ? firstLine + ' ' + secondLine : firstLine;

  return {
    imgType,
    title: fullTitle,
    firstLine,
    secondLine,
    type: EntryType.Text,
  };
}
