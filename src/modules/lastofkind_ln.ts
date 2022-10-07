import * as utils from '../utils.js';
import { getTemplate, applyTemplate } from '../helpers/template.js';
import * as xh from '../helpers/xml.js';
import * as epubh from '../helpers/epub.js';
import * as sh from '../helpers/string.js';
import { promises as fspromises } from 'fs';
import * as path from 'path';
import * as tmp from 'tmp';
import * as mime from 'mime-types';

const log = utils.createNameSpace('lastofkind_ln');

tmp.setGracefulCleanup();

// STATIC OPTIONS
const INPUT_MATCH_REGEX = /Reincarnated as the Last of My Kind/gim;
const SERIES_MATCH_REGEX = /^(?<series>.+?)(?: (?:Vol\.|Volume) (?<num>\d+))?$/gim;
/** Regex of files to filter out (to not include in the output) */
const FILES_TO_FILTER_OUT_REGEX = /^$/gim;
const COVER_XHTML_FILENAME = 'cover.xhtml';
const TITLES_TO_FILTER_OUT_REGEX = /other series/gim;
const CSSPATH_FOR_XHTML = '../Styles/stylesheet.css';
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

interface Trackers {
  /** global ordering tracker, stores the last used number */
  Global: number;
  /** tracker for what main chapter number currently on, stores the last used number */
  Chapter: number;
  /** tracker for what current insert (image) number is currently on, stores the last used number */
  Insert: number;
  /** tracker for what frontmatter number is currently on, stores the last used number  */
  Frontmatter: number;
  /** tracker for what backamtter number is currently on, stores the last used number  */
  Backmatter: number;
  /** tracker for the current sequence Index (ordering), stores the next to use number */
  CurrentSeq: number;
  /** tracker for the current sub-chapter something is on (naming), stores the next to use number */
  CurrentSubChapter: number;
  /**
   * tracker to determine if a image is in a text area or not
   * 0 = Frontmatter
   * 1 = Insert
   * 2 = Backmatter
   */
  ImgType: number;
  /**
   * Indicate what the last type processed was (currently only indicates image)
   * 0 = none
   * 1 = image
   */
  LastType: number;
}

type EpubContextTrackers = Record<keyof Trackers, number>;

/**
 * The Main Entry Point of this module to begin processing a file
 * @param options The Options from the main module
 * @returns The output filePath
 */
async function process(options: utils.ConverterOptions): Promise<string> {
  // read the input into a epubctx
  const epubctxInput = await epubh.getInputContext(options.fileInputPath);

  // create a output epubctx
  const epubctxOut = new epubh.EpubContext<EpubContextTrackers>({
    title: epubctxInput.title,
    trackers: {
      Global: 0,
      Chapter: 0,
      Insert: 0,
      CurrentSeq: 0,
      CurrentSubChapter: 0,
      ImgType: 0,
      LastType: 0,
      Backmatter: 0,
      Frontmatter: 0,
    },
  });

  // apply the common stylesheet
  const stylesheetpath = path.resolve(path.dirname(epubctxOut.contentPath), epubh.FileDir.Styles, 'stylesheet.css');
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
      } else if (elem.tagName === 'dc:rights') {
        newNode = document.createElementNS(xh.STATICS.DC_XML_NAMESPACE, 'dc:rights');
        utils.assertionDefined(elem.textContent, new Error('Expected "elem.textContent" to be defined'));
        newNode.appendChild(document.createTextNode(elem.textContent));
      } else if (elem.tagName === 'dc:description') {
        newNode = document.createElementNS(xh.STATICS.DC_XML_NAMESPACE, 'dc:description');
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

    // apply series metadata (to have automatic sorting already in things like calibre)
    {
      // Regex to extract the series title and if available the volume position
      const caps = SERIES_MATCH_REGEX.exec(epubctxOut.title);

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
async function processHTMLFile(filePath: string, epubctxOut: epubh.EpubContext<EpubContextTrackers>): Promise<void> {
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

  switch (entryType.type) {
    case EntryType.Image:
      await doImagePage(documentInput, entryType, epubctxOut, filePath);
      break;
    case EntryType.GenericText:
      await doGenericPage(documentInput, entryType, epubctxOut, filePath);
      break;
    default:
      log(`Unhandled Type \"${entryType.type}\" + "${entryType.title}"`.red);
      await doGenericPage(documentInput, entryType, epubctxOut, filePath, 0);
      break;
  }
}

/** Represents the Type of the Current File */
enum EntryType {
  Ignore,
  GenericText,
  Image,
}

/** Information about the Current File */
interface EntryInformation {
  type: EntryType;
  title: string;
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
  let type: EntryType = EntryType.GenericText;

  // test for the TOC in TOC header element
  {
    const h2Elem = document.querySelector('body > h2');

    if (!utils.isNullOrUndefined(h2Elem) && h2Elem.textContent?.toLowerCase() === 'table of contents') {
      type = EntryType.Ignore;
    }
  }

  if (lTitle === 'copyright') {
    type = EntryType.GenericText;
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

interface DoTextContentIMGID {
  /** id for sectionid, imgalt */
  id: string;
  /** Image Filename to store the file as (only basename) (the image itself, not the xhtml) */
  imgFilename: string;
  /** Filename (without extension) of the xhtml containing the image */
  xhtmlFilename: string;
  /** Image Type */
  imgtype: epubh.ImgClass;
}

interface DoTextContentOptions {
  /**
   * Generate the id (for sectionid, filename)
   * @param trackers EpubContextOutput LastStates
   * @param subnum Current SubChapter number
   */
  genID(trackers: Trackers, subnum: number): string;
  /**
   * Generate the image id & filename
   * @param trackers EpubContextOutput LastStates
   * @param inputimg the full file path for the input image
   */
  genIMGID(trackers: Trackers, inputimg: string): DoTextContentIMGID;
  /**
   * Generate the "h1" element's content
   * @param document The Current DOM Document
   * @param entryType The title object
   * @param h1Element The h1 header element (eg chapter)
   * @returns nothing, the "h1Element" input should be directly modified and that will be used
   */
  genChapterElementContent(document: Document, entryType: EntryInformation, h1Element: HTMLHeadingElement): void;

  /**
   * Custom define if a element should be skipped or kept
   * @param elem The Element to check
   * @returns "true" when it should be skipped
   */
  checkElement?(elem: Element): boolean;

  /** Set custom number of elements to skip */
  skipElements?: number;
}

/**
 * Handle everything related to the "Title.Chapter" type
 * @param documentInput The Input Document's "document.body"
 * @param entryType The Title Object
 * @param epubctxOut EPUB Context of the Output file
 * @param baseOutputPath Base Output path to output files to
 * @param currentInputFile Currently processing's Input file path
 */
async function doTextContent(
  documentInput: Document,
  entryType: EntryInformation,
  epubctxOut: epubh.EpubContext<EpubContextTrackers>,
  currentInputFile: string,
  options: DoTextContentOptions
): Promise<void> {
  // do resets because the last type was a image (type 1)
  if (epubctxOut.tracker['LastType'] === 1) {
    epubctxOut.tracker['LastType'] = 0; // reset the value

    // only increment "CurrentSubChapter" when "ImgType" is set to "Insert", because this indicates that it is still in a chapter
    if (epubctxOut.tracker['ImgType'] === 1) {
      epubctxOut.incTracker('CurrentSubChapter');
    }
  }

  /** Used as a reset condition for "CurrentSubChapter" */
  let hasTitle = false;

  // determine if the first elements have a heading element, which would indicate that it is a new chapter and not a continuation
  // if yes, it is used as a "reset condition"
  {
    const foundElem = Array.from(documentInput.querySelectorAll('body > p')).slice(0, TITLE_CHECK_NUMBER);

    const window = documentInput.defaultView;
    utils.assertionDefined(window, new Error('Expected to get a "window" from "defaultView"'));
    const bodyCompStyle = window.getComputedStyle(xh.queryDefinedElement(documentInput, 'body'));
    const bodyFontSizePx = parseInt(bodyCompStyle.fontSize);

    for (const elem of foundElem) {
      const newTitle = isTitle(documentInput, elem, entryType, { bodyFontSizePx, window });

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
  if (epubctxOut.tracker['ImgType'] !== 1 || hasTitle) {
    epubctxOut.tracker['CurrentSeq'] = 0;
    epubctxOut.tracker['CurrentSubChapter'] = 0;
    epubctxOut.tracker['ImgType'] = 1;

    // only increment "Chapter" tracker if the current document has a heading detected in the body
    if (hasTitle) {
      increasedChapter = true;
      epubctxOut.incTracker('Chapter');
    }
  }

  let currentBaseName: string | undefined = undefined;
  let useType: epubh.EpubContextNewFileXHTMLType;

  {
    const lTitle = entryType.title.toLowerCase();

    // extra handling for when encountering a "copyright", because it is somewhere between the cover and the frontmatter
    if (lTitle.includes('copyright')) {
      epubctxOut.tracker['ImgType'] = 0;

      if (increasedChapter) {
        epubctxOut.tracker['Chapter'] -= 1; // decrement from that count again, because "copyright" should not count towards that
      }

      currentBaseName = 'copyright';
      useType = {
        type: epubh.EpubContextFileXHTMLTypes.CREDITS,
      };
    } else {
      useType = {
        type: epubh.EpubContextFileXHTMLTypes.TEXT,
      };
    }
    if (lTitle.includes('afterword')) {
      epubctxOut.tracker['ImgType'] = 2;

      if (increasedChapter) {
        epubctxOut.tracker['Chapter'] -= 1; // decrement from that count again, because "copyright" should not count towards that
      }

      currentBaseName = 'afterword';
    }
  }

  if (utils.isNullOrUndefined(currentBaseName)) {
    currentBaseName = epubh.normalizeId(options.genID(epubctxOut.tracker, epubctxOut.tracker['CurrentSubChapter']));
  }

  const globState = epubctxOut.incTracker('Global');
  let { dom: currentDOM, document: documentNew, mainElem } = await createMAINDOM(entryType, currentBaseName);
  // create initial "h1" (header) element and add it
  {
    // dont add header if ImgType is "inChapter"
    if (epubctxOut.tracker['CurrentSubChapter'] === 0) {
      const h1element = documentNew.createElement('h1');
      options.genChapterElementContent(documentNew, entryType, h1element);
      mainElem.appendChild(h1element);
    }
  }
  /** Tracker to skip elements unconditionally */
  let toSkipNumber = 0;

  if (typeof options.skipElements === 'number') {
    toSkipNumber = options.skipElements;
  }

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
    if (elem.localName === 'p') {
      const imgNode = elem.querySelector('img');
      const skipSavingMainDOM = isElementEmpty(mainElem) || onlyhash1(mainElem);

      // finish current dom and save the found image and start the next dom
      if (!utils.isNullOrUndefined(imgNode)) {
        // dont save a empty dom
        if (!skipSavingMainDOM) {
          const xhtmlNameMain = `${currentBaseName}.xhtml`;
          await epubh.finishDOMtoFile(currentDOM, path.dirname(epubctxOut.contentPath), xhtmlNameMain, epubh.FileDir.Text, epubctxOut, {
            id: xhtmlNameMain,
            seqIndex: epubctxOut.tracker['CurrentSeq'],
            title: entryType.title,
            type: useType,
            globalSeqIndex: globState,
          });
          epubctxOut.incTracker('CurrentSubChapter');
          epubctxOut.incTracker('CurrentSeq');
        }

        const imgFromPath = path.resolve(path.dirname(currentInputFile), imgNode.src);
        const {
          imgtype,
          id: imgid,
          imgFilename: imgFilename,
          xhtmlFilename: imgXHTMLFileName,
        } = options.genIMGID(epubctxOut.tracker, imgFromPath);
        await copyImage(imgFromPath, epubctxOut, imgFilename, imgid);
        const { dom: imgDOM } = await createIMGDOM(entryType, imgid, imgtype, path.join('..', epubh.FileDir.Images, imgFilename));
        const xhtmlNameIMG = `${imgXHTMLFileName}.xhtml`;
        await epubh.finishDOMtoFile(imgDOM, path.dirname(epubctxOut.contentPath), xhtmlNameIMG, epubh.FileDir.Text, epubctxOut, {
          id: xhtmlNameIMG,
          seqIndex: epubctxOut.tracker['CurrentSeq'],
          title: entryType.title,
          type: {
            type: epubh.EpubContextFileXHTMLTypes.IMG,
            imgClass: epubh.ImgClass.Insert,
            imgType: epubh.ImgType.Insert,
          },
          globalSeqIndex: globState,
        });
        epubctxOut.incTracker('CurrentSeq');

        // dont create a new dom if the old one is still empty
        if (!skipSavingMainDOM) {
          currentBaseName = epubh.normalizeId(options.genID(epubctxOut.tracker, epubctxOut.tracker['CurrentSubChapter']));
          const nextchapter = await createMAINDOM(entryType, currentBaseName);
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
      const execIsTitle = epubctxOut.tracker['CurrentSubChapter'] === 0 && index < TITLE_CHECK_NUMBER;

      // skip the existing header elements
      if (execIsTitle && isTitle(documentInput, elem, entryType)) {
        continue;
      }

      mainElem.appendChild(generatePElement(elem, documentNew));
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
    const xhtmlNameMain = `${currentBaseName}.xhtml`;
    await epubh.finishDOMtoFile(currentDOM, path.dirname(epubctxOut.contentPath), xhtmlNameMain, epubh.FileDir.Text, epubctxOut, {
      id: xhtmlNameMain,
      seqIndex: epubctxOut.tracker['CurrentSeq'],
      title: entryType.title,
      type: useType,
      globalSeqIndex: globState,
    });
    epubctxOut.incTracker('CurrentSeq');
  } else {
    log('Not saving final DOM, because main element is empty');
  }
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
function isTitle(document: Document, elem: Element, entryType: EntryInformation, cache?: IsTitleCache): boolean | string {
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

  if (!utils.isNullOrUndefined(cache)) {
    bodyFontSize = cache.bodyFontSizePx;
    window = cache.window;
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
 * Check if it only has one element and that one element is the "h1"
 * Only returns "true" if there is one element and that one element is a "h1"
 * @param elem The Element to check
 * @returns "true" if there is one element and that one element is a "h1"
 */
function onlyhash1(elem: Element): boolean {
  return elem.children.length === 1 && elem.children[0].localName === 'h1';
}

/** Small Helper functions to consistently tell if a node has no children */
function isElementEmpty(elem: Element): boolean {
  return elem.childNodes.length === 0;
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
  epubctxOut: epubh.EpubContext<EpubContextTrackers>,
  currentInputFile: string,
  skipElements?: number
): Promise<void> {
  // just to make sure that the type is defined and correctly assumed
  await doTextContent(documentInput, entryType, epubctxOut, currentInputFile, {
    genID: function (trackers: Trackers, subnum: number): string {
      let baseName = 'chapter' + trackers.Chapter;

      // only add a subnumber when a subnumber is required (not in the first of the chapter)
      if (subnum > 0) {
        baseName += `_${subnum}`;
      }

      return baseName;
    },
    genIMGID: function (trackers: Trackers, inputimg: string): DoTextContentIMGID {
      const newState = epubctxOut.incTracker('Insert');
      const ext = path.extname(inputimg);
      const imgid = `insert${newState}${ext}`;
      const imgfilename = `Insert${newState}${ext}`;
      const xhtmlName = `insert${newState}`;

      return {
        imgFilename: imgfilename,
        id: imgid,
        imgtype: epubh.ImgClass.Insert,
        xhtmlFilename: xhtmlName,
      };
    },
    genChapterElementContent: function (document: Document, entryType: EntryInformation, h1Element: HTMLHeadingElement): void {
      h1Element.appendChild(document.createTextNode(entryType.title));
    },

    skipElements,
  });
}

/**
 * Handle everything related to the Frontmatter Title types
 * @param documentInput The Input Document's "document.body"
 * @param entryType The Title Object
 * @param epubctxOut EPUB Context of the Output file
 * @param currentInputFile Currently processing's Input file path
 */
async function doImagePage(
  documentInput: Document,
  entryType: EntryInformation,
  epubctxOut: epubh.EpubContext<EpubContextTrackers>,
  currentInputFile: string
): Promise<void> {
  const imgNodes = Array.from(xh.queryDefinedElementAll(documentInput, 'img')) as HTMLImageElement[];
  let globState: number;
  let seq = 0;

  // only increment the "Global" tracker when image type is not "insert", otherwise only read it
  // use the "CurrentSeq" tracker when image type is "insert"
  if (epubctxOut.tracker['ImgType'] === 1) {
    globState = epubctxOut.tracker['Global'];
    seq = epubctxOut.tracker['CurrentSeq'];
  } else {
    globState = epubctxOut.incTracker('Global');
  }

  for (const elem of imgNodes) {
    let numState: number;
    let isCover = false;

    const altAttr = elem.getAttribute('alt') || entryType.title;

    // determine if the current image processing is for the cover
    if (imgNodes.length === 1 && altAttr.trim().toLowerCase() === 'cover') {
      numState = 0;
      isCover = true;
    } else {
      // increment and use the correct tracker
      if (epubctxOut.tracker['ImgType'] === 0) {
        numState = epubctxOut.incTracker('Frontmatter');
      } else if (epubctxOut.tracker['ImgType'] === 2) {
        numState = epubctxOut.incTracker('Backmatter');
      } else {
        // in case of "1" and as fallback
        numState = epubctxOut.incTracker('Insert');
      }
    }

    const fromPath = path.resolve(path.dirname(currentInputFile), elem.src);
    const ext = path.extname(fromPath);

    let img: {
      imgId: string;
      imgFilename: string;
      xhtmlName: string;
    };

    if (isCover) {
      img = {
        imgId: `cover${ext}`,
        imgFilename: `Cover${ext}`,
        xhtmlName: COVER_XHTML_FILENAME,
      };
    } else {
      if (epubctxOut.tracker['ImgType'] === 0) {
        img = {
          imgId: `frontmatter${numState}${ext}`,
          imgFilename: `Frontmatter${numState}${ext}`,
          xhtmlName: `frontmatter${numState}.xhtml`,
        };
      } else if (epubctxOut.tracker['ImgType'] === 2) {
        img = {
          imgId: `backmatter${numState}${ext}`,
          imgFilename: `Backmatter${numState}${ext}`,
          xhtmlName: `backmatter${numState}.xhtml`,
        };
      } else {
        // in case of "1" and as fallback
        img = {
          imgId: `insert${numState}${ext}`,
          imgFilename: `Insert${numState}${ext}`,
          xhtmlName: `insert${numState}.xhtml`,
        };
      }
    }

    await copyImage(fromPath, epubctxOut, img.imgFilename, img.imgId);
    const { dom: imgDOM } = await createIMGDOM(
      entryType,
      img.imgId,
      epubh.ImgClass.Insert,
      path.join('..', epubh.FileDir.Images, img.imgFilename)
    );

    let useType = {
      type: epubh.EpubContextFileXHTMLTypes.IMG,
      imgClass: epubh.ImgClass.Insert,
      imgType: epubh.ImgType.Frontmatter,
    };

    if (isCover) {
      useType = {
        type: epubh.EpubContextFileXHTMLTypes.IMG,
        imgClass: epubh.ImgClass.Cover,
        imgType: epubh.ImgType.Cover,
      };
    }
    if (epubctxOut.tracker['ImgType'] === 1) {
      useType = {
        type: epubh.EpubContextFileXHTMLTypes.IMG,
        imgClass: epubh.ImgClass.Insert,
        imgType: epubh.ImgType.Insert,
      };
    }
    if (epubctxOut.tracker['ImgType'] === 2) {
      useType = {
        type: epubh.EpubContextFileXHTMLTypes.IMG,
        imgClass: epubh.ImgClass.Insert,
        imgType: epubh.ImgType.Backmatter,
      };
    }

    await epubh.finishDOMtoFile(imgDOM, path.dirname(epubctxOut.contentPath), img.xhtmlName, epubh.FileDir.Text, epubctxOut, {
      id: img.xhtmlName,
      seqIndex: seq,
      title: altAttr,
      type: useType,
      globalSeqIndex: globState,
    });

    seq += 1;

    // the following still needs to be done, because aliasing a number and adding to it does not change the alias'ed number
    if (epubctxOut.tracker['ImgType'] === 1) {
      epubctxOut.incTracker('CurrentSeq');
    } else {
      seq += 1;
    }
  }

  epubctxOut.tracker['LastType'] = 1;
}

/**
 * Copy a Image from input to the output and add it to the epubctx
 * @param fromPath The Path to copy from
 * @param epubctxOut The epubctx to add it to
 * @param filename The filename to use for the image
 * @param id The id to use for this iamge
 * @returns The copied-path
 */
async function copyImage(
  fromPath: string,
  epubctxOut: epubh.EpubContext<EpubContextTrackers>,
  filename: string,
  id: string
): Promise<string> {
  const copiedPath = path.resolve(path.dirname(epubctxOut.contentPath), epubh.FileDir.Images, filename);
  await utils.mkdir(path.dirname(copiedPath));
  await fspromises.copyFile(fromPath, copiedPath);

  const mimetype = mime.lookup(filename) || undefined;

  utils.assertionDefined(mimetype, new Error('Expected "mimetype" to be defined'));

  epubctxOut.addFile(
    new epubh.EpubContextFileBase({
      filePath: copiedPath,
      mediaType: mimetype,
      id: id,
    })
  );

  return copiedPath;
}

interface IcreateMAINDOM extends xh.INewJSDOMReturn {
  mainElem: Element;
}

/**
 * Create a dom from "xhtml-ln.xhtml" template easily
 * @param entryType The Title object
 * @param sectionid The id of the "section" element
 * @returns The DOM, document and mainelement
 */
async function createMAINDOM(entryType: EntryInformation, sectionid: string): Promise<IcreateMAINDOM> {
  const modXHTML = applyTemplate(await getTemplate('xhtml-ln.xhtml'), {
    '{{TITLE}}': entryType.title,
    '{{SECTIONID}}': sectionid,
    '{{EPUBTYPE}}': epubh.EPubType.BodyMatterChapter,
    '{{CSSPATH}}': CSSPATH_FOR_XHTML,
  });

  // set custom "contentType" to force it to output xhtml compliant html (like self-closing elements to have a "/")
  const ret = xh.newJSDOM(modXHTML, JSDOM_XHTML_OPTIONS);
  const mainElement = xh.queryDefinedElement(ret.document, 'div.main');

  return {
    ...ret,
    mainElem: mainElement,
  };
}

/**
 * Create a dom from the "img-ln.xhtml" template easily
 * @param entryType The Title object
 * @param sectionid The id of the "section" element, will also be used for the "imgalt"
 * @param imgclass The class the "img" element should have
 * @param imgsrc The source of the "img" element
 * @returns The DOM, document and mainelement
 */
async function createIMGDOM(
  entryType: EntryInformation,
  sectionid: string,
  imgclass: epubh.ImgClass,
  imgsrc: string
): Promise<ReturnType<typeof xh.newJSDOM>> {
  const modXHTML = applyTemplate(await getTemplate('img-ln.xhtml'), {
    '{{TITLE}}': entryType.title,
    '{{SECTIONID}}': sectionid,
    '{{EPUBTYPE}}': epubh.EPubType.BodyMatterChapter,
    '{{IMGALT}}': sectionid,
    '{{IMGCLASS}}': imgclass,
    '{{IMGSRC}}': imgsrc,
    '{{CSSPATH}}': CSSPATH_FOR_XHTML,
  });

  // set custom "contentType" to force it to output xhtml compliant html (like self-closing elements to have a "/")
  return xh.newJSDOM(modXHTML, JSDOM_XHTML_OPTIONS);
}

/**
 * Transform top-level "p" elements to new elements on the new document
 * @param origElem Original container element
 * @param documentNew The document to generate elements on
 * @returns The new Node to add
 */
function generatePElement(origElem: Element, documentNew: Document): Element {
  const topElem = documentNew.createElement('p');

  for (const elem of generatePElementInner(origElem, documentNew, topElem)) {
    topElem.appendChild(elem);
  }

  return topElem;
}

interface GeneratePElementInnerElem {
  topElem?: Node;
  currentElem?: Element;
}

/**
 * Helper Function for "generatePElementInner" to consistently update the elements
 * Updates the "obj" with the topElement if unset, and adds "newNode" to "currentElem" and re-assigns the "currentElem"
 * @param obj The Object to modify
 * @param newNode The new Node to add
 */
function helperAssignElem(obj: GeneratePElementInnerElem, newNode: Element) {
  // if "currentElem" is undefined, we can safely assume "topElem" is also undefined
  if (utils.isNullOrUndefined(obj.currentElem)) {
    obj.currentElem = newNode;
    obj.topElem = newNode;
  } else {
    obj.currentElem.appendChild(newNode);
    obj.currentElem = newNode;
  }
}

/**
 * Return formatted and only elements that are required
 * @param origNode The original node to process
 * @param documentNew The Document to create new nodes on
 * @param parentElem The Element the new nodes are added to (will not be applied by this function), required for testing and applying styles
 * @returns The array of new Nodes
 */
function generatePElementInner(origNode: Node, documentNew: Document, parentElem: Element): Node[] {
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

  const elemObj: GeneratePElementInnerElem = {};
  const origElemStyle = origElem.getAttribute('style');
  const window = origElem.ownerDocument.defaultView;
  utils.assertionDefined(window, new Error('Expected to get a "window" from "defaultView"'));
  const elemCompStyle = window.getComputedStyle(origElem);

  if (!parentHas(parentElem, 'strong') && elemCompStyle.fontWeight === 'bold') {
    helperAssignElem(elemObj, documentNew.createElement('strong'));
  }
  if (!parentHas(parentElem, 'em') && elemCompStyle.fontStyle === 'italic') {
    helperAssignElem(elemObj, documentNew.createElement('em'));
  }
  if (!parentHas(parentElem, 'sup') && elemCompStyle.verticalAlign === 'super') {
    helperAssignElem(elemObj, documentNew.createElement('sup'));
  }
  if (!parentHas(parentElem, 'sub') && elemCompStyle.verticalAlign === 'sub') {
    helperAssignElem(elemObj, documentNew.createElement('sub'));
  }
  if (elemCompStyle.textAlign === 'center') {
    parentElem.setAttribute('class', 'centerp section-marking');
  }
  if (elemCompStyle.textAlign === 'right') {
    parentElem.setAttribute('class', 'signature');
  }

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

  // ignore unhandled classes in this case, because they are generated with "could be different numbers"
  // const classesToIgnore: string[] = [];

  // if (origElem.className.length != 0 && !classesToIgnore.includes(origElem.className)) {
  //   console.log('encountered unknown class'.red, origElem.className);
  // }

  // if "currentElem" is not defined, loop over the original elements's children and return those children directly
  // because this means the current element is not needed
  if (utils.isNullOrUndefined(elemObj.currentElem)) {
    const listOfNodes: Node[] = [];
    for (const child of Array.from(origElem.childNodes)) {
      listOfNodes.push(...generatePElementInner(child, documentNew, parentElem));
    }

    return listOfNodes;
  }

  // loop over all original Element's children and add them to the currentElem as a child
  for (const child of Array.from(origElem.childNodes)) {
    for (const elem of generatePElementInner(child, documentNew, elemObj.currentElem)) {
      elemObj.currentElem.appendChild(elem);
    }
  }
  utils.assertionDefined(elemObj.topElem, new Error('Expected "elemObj.topElem" to be defined at this point'));

  return [elemObj.topElem];
}

/**
 * Check for a given element "tagName" upwards, until "until" is encountered upwards
 * @param startElem The element to start searching on
 * @param tagName The element name (tagName) to search for
 * @param until Search for "tagName" until "until" is encountered
 * @returns "true" if the given "tagName" is found, "false" otherwise
 */
function parentHas(startElem: Element, tagName: keyof HTMLElementTagNameMap, until: keyof HTMLElementTagNameMap = 'body'): boolean {
  for (const elem of traverseParent(startElem)) {
    // return if requested element is found
    if (elem.tagName === tagName) {
      return true;
    }
    // early return "false" if "until" has been found
    else if (elem.tagName === until) {
      return false;
    }

    continue;
  }

  return false; // base case
}

/**
 * Traverse a given "initElem" upwards (through "parentElement") until there is no parent anymore
 * @param initElem The Starting Element (will not be given as a output)
 * @returns A Generator to traverse a given element upwards
 */
function* traverseParent(initElem: Element): Generator<Element> {
  let currentElem: Element | null = initElem;

  while (!utils.isNullOrUndefined((currentElem = currentElem.parentElement))) {
    yield currentElem;
  }
}
