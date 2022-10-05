import * as utils from '../utils.js';
import { createWriteStream, promises as fspromises } from 'fs';
import * as path from 'path';
import * as tmp from 'tmp';
import yauzl from 'yauzl';
import * as mime from 'mime-types';
import { getTemplate, applyTemplate } from '../helpers/template.js';
import * as xh from '../helpers/xml.js';
import * as epubh from '../helpers/epub.js';

const log = utils.createNameSpace('average_ln_original');

tmp.setGracefulCleanup();

// STATIC OPTIONS
const INPUT_MATCH_REGEX = /Didn.{1}t I Say to Make My Abilities Average/gim;
/** Regex of files to filter out (to not include in the output) */
const FILES_TO_FILTER_OUT_REGEX = /newsletter|sevenseaslogo/gim;
const TITLES_TO_FILTER_OUT_REGEX = /newsletter/gim;
const COVER_XHTML_FILENAME = 'cover.xhtml';
const CSSPATH_FOR_XHTML = '../Styles/stylesheet.css';
const JSDOM_XHTML_OPTIONS = { contentType: xh.STATICS.XHTML_MIMETYPE };

// CODE

// EXPORTS
export default function averageLnOriginal(): utils.ConverterModule {
  return { matcher, process };
}

export function matcher(name: string): boolean {
  const ret = INPUT_MATCH_REGEX.test(name);
  // reset regex after use, because they have a state, seemingly even with "test"
  INPUT_MATCH_REGEX.lastIndex = 0;

  return ret;
}

type EpubContextTrackers = Record<keyof LastStates, number>;

export async function process(options: utils.ConverterOptions): Promise<string> {
  const { name: usePath, tmpdir: tmpdirInput } = await getInputPath(options.fileInputPath);

  const { context: epubContextInput, contentBody: contentBodyInput } = await getEpubContextForInput(usePath);

  const epubctxOut = new epubh.EpubContext<EpubContextTrackers>({
    title: epubContextInput.Title,
    trackers: {
      Global: 0,
      LastBonusStoryNum: 0,
      LastChapterNum: 0,
      LastFrontNum: 0,
      LastInsertNum: 0,
      LastInterludeNum: 0,
      LastShortStoryNum: 0,
      LastSideStoryNum: 0,
      LastGenericNum: 0,
      LastAfterwordNum: 0,
    },
  });

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

  for await (const file of recursiveDirRead(path.dirname(path.resolve(usePath, epubContextInput.ContentPath)))) {
    if (new RegExp(FILES_TO_FILTER_OUT_REGEX).test(file)) {
      log(`Skipping file "${file}" because it is in the filter regex`);
      continue;
    }

    // skip "content.opf" file, because it is handled outside of this loop
    if (/content\.opf/.test(file)) {
      continue;
    }

    const mimetype = mime.lookup(file);
    log(`Processing file "${file}", ${mimetype}`);

    utils.assertion(typeof mimetype === 'string', new Error('Expected "mimetype" to be of string'));

    if (/image/gim.test(mimetype)) {
      // ignore image files, because they will be copied when required
      continue;
    }
    if (mimetype === 'text/css') {
      // ignore css input files, because our own will be applied
      continue;
    }
    if (mimetype === 'text/html' || mimetype === xh.STATICS.XHTML_MIMETYPE) {
      await processHTMLFile(file, epubctxOut);
      continue;
    }
    if (mimetype === xh.STATICS.NCX_MIMETYPE) {
      utils.assertion(utils.isNullOrUndefined(epubContextInput.NCXPath), new Error('Expected "NCXPath" to still be undefined'));
      epubContextInput.NCXPath = file;
      continue;
    }

    console.error(`Unhandled "mimetype": ${mimetype}`.red);
  }

  function contentOPFHook({ document, idCounter, metadataElem }: Parameters<epubh.ContentOPFFn>[0]) {
    const packageElementOld = xh.queryDefinedElement(contentBodyInput, 'package');
    const metadataElementOld = xh.queryDefinedElement(contentBodyInput, 'metadata');

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
        const seriesTitleNoVolume = regexMatchGroupRequired(caps, 'series', 'contentOPFHook meta collection');
        const seriesPos = regexMatchGroup(caps, 'num');

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

  if (!utils.isNullOrUndefined(tmpdirInput)) {
    tmpdirInput.removeCallback();

    // somehow "tmp" is not reliable to remove the directory again
    if (!utils.isNullOrUndefined(await utils.statPath(epubctxOut.rootDir))) {
      log('"tmp" dir still existed after "removeCallback", manually cleaning');
      await fspromises.rm(epubctxOut.rootDir, { recursive: true, maxRetries: 1 });
    }
  }

  return finishedEpubPath;
}

// LOCAL

/** Context storing all important options */
interface EpubContextInput {
  /** Path to the "rootfile", relative to the root of the input file */
  ContentPath: string;
  /** Volume Title */
  Title: string;
  /** All files in the "content" */
  Files: EpubFile[];
  /** Path to the NCX Path, if existing */
  NCXPath?: string;
}

interface LastStates {
  Global: number;
  LastInsertNum: number;
  LastFrontNum: number;
  LastGenericNum: number;
  LastChapterNum: number;
  LastBonusStoryNum: number;
  LastInterludeNum: number;
  LastSideStoryNum: number;
  LastShortStoryNum: number;
  LastAfterwordNum: number;
}

interface EpubFile {
  /** Path to the file, either absolute or relative to the container file */
  Path: string;
  /** The mimetype of the file */
  MediaType: string;
  /** The ID to use for this file in the container */
  Id: string;
  /** Filename of the original file (input file), later used for sorting in the spine to keep the flow */
  OriginalFilename: string;
  /** Indicate that this file is the start of a chapter (used for toc generation) */
  Main: boolean;
  /** The Index in which this should be sorted if being part of a sequence (like chapter, insert) */
  IndexInSequence: number;
  /** Store the Title for use in TOC */
  Title?: Title;
}

/** Read a Directory recursively */
async function* recursiveDirRead(inputPath: string): AsyncGenerator<string> {
  const entries = await fspromises.readdir(inputPath, { withFileTypes: true });

  for (const ent of entries.sort()) {
    const resPath = path.resolve(inputPath, ent.name);

    if (ent.isDirectory()) {
      yield* recursiveDirRead(resPath);
    }

    yield resPath;
  }
}

/**
 * Get the Context for the input file
 * @param usePath The input directory path
 * @returns the context and the body to query for later transfer
 */
async function getEpubContextForInput(usePath: string): Promise<{ context: EpubContextInput; contentBody: Document }> {
  const containerBuffer = await fspromises.readFile(path.resolve(usePath, 'META-INF/container.xml'));
  const { document: containerBody } = xh.newJSDOM(containerBuffer, { contentType: xh.STATICS.XML_MIMETYPE });

  const contentPathNode = xh.queryDefinedElement(containerBody, 'container > rootfiles > rootfile');

  const contentPath = contentPathNode.getAttribute('full-path');

  utils.assertionDefined(contentPath, new Error('Expected "contentPath" to be defined'));

  const contentBuffer = await fspromises.readFile(path.resolve(usePath, contentPath));
  const { document: contentBody } = xh.newJSDOM(contentBuffer, { contentType: xh.STATICS.XML_MIMETYPE });

  const titleNode = xh.queryDefinedElement(contentBody, 'package > metadata > dc\\:title');

  const volumeTitle = titleNode.textContent;

  utils.assertionDefined(volumeTitle, new Error('Expected "volumeTitle" to be defined'));

  const context: EpubContextInput = {
    ContentPath: contentPath,
    Title: volumeTitle,
    Files: [],
  };

  return { context, contentBody };
}

/**
 * Get the Input path useable for reading (get directory and extract zips)
 * @param inputPath The Input path to check and convert
 * @returns a path that is useable to read from
 */
async function getInputPath(inputPath: string): Promise<{ name: string; tmpdir: tmp.DirResult | undefined }> {
  const stat = await utils.statPath(inputPath);

  if (utils.isNullOrUndefined(stat)) {
    throw new Error(`Could not get stat of "${inputPath}"`);
  }

  let usePath: string | undefined = undefined;
  let tmpdir: tmp.DirResult | undefined = undefined;

  if (stat.isDirectory()) {
    usePath = inputPath;
  } else if (stat.isFile()) {
    if (!(inputPath.endsWith('zip') || inputPath.endsWith('epub'))) {
      throw new Error(`File "${inputPath}" does not end with "zip" or "epub"`);
    }

    log('input is a epub/zip');

    tmpdir = tmp.dirSync({
      prefix: 'converty-in',
      unsafeCleanup: true,
    });

    const tmpdirName = tmpdir.name;

    await new Promise((res, rej) => {
      yauzl.open(inputPath, { lazyEntries: true }, (err, zip) => {
        if (err) {
          return rej(err);
        }

        zip.on('entry', (entry: yauzl.Entry) => {
          if (/\/$/.test(entry.fileName)) {
            // Diretories in a zip end with "/"

            // ignore all directories, because they will get created when a file needs it

            return zip.readEntry();
          }

          zip.openReadStream(entry, async (err, readStream) => {
            if (err) {
              return rej(err);
            }

            await utils.mkdir(path.resolve(tmpdirName, path.dirname(entry.fileName)));

            const writeStream = createWriteStream(path.resolve(tmpdirName, entry.fileName));

            writeStream.on('close', () => {
              zip.readEntry();
            });
            readStream.pipe(writeStream);
          });
        });
        zip.once('error', rej);
        zip.once('close', res);

        zip.readEntry();
      });
    });

    usePath = tmpdir.name;
  } else {
    throw new Error(`Path "${inputPath}" is not a Directory or a file!`);
  }

  if (utils.isNullOrUndefined(usePath)) {
    throw new Error('Could not determine a path to use');
  }

  return { name: usePath, tmpdir };
}

/** Process a (X)HTML file from input to output */
async function processHTMLFile(filePath: string, epubctxOut: epubh.EpubContext<EpubContextTrackers>): Promise<void> {
  const loadedFile = await fspromises.readFile(filePath);
  const { document: documentInput } = xh.newJSDOM(loadedFile, JSDOM_XHTML_OPTIONS);

  const title = getTitle(documentInput.title);

  // ignore the TOC, because a new one will be generated
  if (title.fullTitle.toLowerCase() === 'table of contents') {
    return;
  }

  // ignore everything that matches the regex
  if (new RegExp(TITLES_TO_FILTER_OUT_REGEX).test(title.fullTitle)) {
    log(`Skipping file "${filePath}" because it is in the filter regex (titles)`);

    return;
  }

  switch (title.titleType) {
    case TitleType.CoverPage:
      await doCoverPage(documentInput, title, epubctxOut, filePath);
      break;
    case TitleType.Afterword:
      await doAfterword(documentInput, title, epubctxOut, filePath);
      break;
    case TitleType.TitlePage:
    case TitleType.ColorInserts:
    case TitleType.CopyrightsAndCredits:
    case TitleType.TocImage:
    case TitleType.CastOfCharacters:
      await doFrontMatter(documentInput, title, epubctxOut, filePath);
      break;
    case TitleType.BonusStory:
      await doBonusStory(documentInput, title, epubctxOut, filePath);
      break;
    case TitleType.ShortStory:
      await doShortStory(documentInput, title, epubctxOut, filePath);
      break;
    case TitleType.SideStory:
      await doSideStory(documentInput, title, epubctxOut, filePath);
      break;
    case TitleType.Chapter:
      await doChapter(documentInput, title, epubctxOut, filePath);
      break;
    case TitleType.Interlude:
      await doInterlude(documentInput, title, epubctxOut, filePath);
      break;
    // the following will use the generic target
    case TitleType.Dedication:
    case TitleType.NamedSideStory:
      await doGeneric(documentInput, title, epubctxOut, filePath, 0);
      break;
    case TitleType.Previously:
    case TitleType.AboutAuthorAndIllust:
      await doGeneric(documentInput, title, epubctxOut, filePath);
      break;
    default:
      log(`Unhandled Type \"${title.titleType}\" + "${title.fullTitle}"`.red);
      await doGeneric(documentInput, title, epubctxOut, filePath, 0);
      break;
  }
}

interface IcreateMAINDOM extends xh.INewJSDOMReturn {
  mainElement: Element;
}

/**
 * Create a dom from the MAIN_BODY_TEMPLATE template easily
 * @param title The Title object
 * @param sectionid The id of the "section" element
 * @returns The DOM, document and mainelement
 */
async function createMAINDOM(title: Title, sectionid: string): Promise<IcreateMAINDOM> {
  const modXHTML = applyTemplate(await getTemplate('xhtml-ln.xhtml'), {
    '{{TITLE}}': title.fullTitle,
    '{{SECTIONID}}': sectionid,
    '{{EPUBTYPE}}': epubh.EPubType.BodyMatterChapter,
    '{{CSSPATH}}': CSSPATH_FOR_XHTML,
  });

  // set custom "contentType" to force it to output xhtml compliant html (like self-closing elements to have a "/")
  const ret = xh.newJSDOM(modXHTML, JSDOM_XHTML_OPTIONS);
  const mainElement = xh.queryDefinedElement(ret.document, 'div.main');

  return {
    ...ret,
    mainElement,
  };
}

/**
 * Create a dom from the JUST_IMAGE_TEMPLATE template easily
 * @param title The Title object
 * @param sectionid The id of the "section" element, will also be used for the "imgalt"
 * @param imgclass The class the "img" element should have
 * @param imgsrc The source of the "img" element
 * @returns The DOM, document and mainelement
 */
async function createIMGDOM(
  title: Title,
  sectionid: string,
  imgclass: epubh.ImgClass,
  imgsrc: string
): Promise<ReturnType<typeof xh.newJSDOM>> {
  const modXHTML = applyTemplate(await getTemplate('img-ln.xhtml'), {
    '{{TITLE}}': title.fullTitle,
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

async function copyImage(
  fromPath: string,
  epubctxOut: epubh.EpubContext<EpubContextTrackers>,
  filename: string,
  epubfileOptions: Omit<EpubFile, 'MediaType' | 'Path'>
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
      id: epubfileOptions.Id,
    })
  );

  return copiedPath;
}

/**
 * Handle everything related to the "Title.CoverPage" type
 * @param documentInput The Input Document's "document.body"
 * @param title The Title Object
 * @param epubctxOut EPUB Context of the Output file
 * @param currentInputFile Currently processing's Input file path
 */
async function doAfterword(
  documentInput: Document,
  title: Title,
  epubctxOut: epubh.EpubContext<EpubContextTrackers>,
  currentInputFile: string
): Promise<void> {
  // just to make sure that the type is defined and correctly assumed
  utils.assertion(title.titleType === TitleType.Afterword, new Error('Expected TitleType to be "Afterword"'));

  await doTextContent(documentInput, title, epubctxOut, currentInputFile, {
    genID: function (lastStates: LastStates, subnum: number): string {
      let baseName = 'afterword';

      // only add a subnumber when a subnumber is required (not in the first of the chapter)
      if (subnum > 0) {
        baseName += `_${subnum}`;
      }

      return baseName;
    },
    genIMGID: function (lastStates: LastStates, inputimg: string): DoTextContentIMGID {
      const newState = epubctxOut.incTracker('LastAfterwordNum');
      const ext = path.extname(inputimg);
      const imgid = `afterword_img${newState}${ext}`;
      const imgfilename = `Afterword${newState}${ext}`;
      const xhtmlName = `afterword_img${newState}`;

      return {
        imgFilename: imgfilename,
        id: imgid,
        imgtype: epubh.ImgClass.Insert,
        xhtmlFilename: xhtmlName,
      };
    },
    genChapterElementContent: function (document: Document, title: Title, h1Element: HTMLHeadingElement): void {
      h1Element.appendChild(document.createTextNode(`Afterword`));
    },
  });
}

/**
 * Handle everything related to the "Title.CoverPage" type
 * @param documentInput The Input Document's "document.body"
 * @param title The Title Object
 * @param epubctxOut EPUB Context of the Output file
 * @param currentInputFile Currently processing's Input file path
 */
async function doCoverPage(
  documentInput: Document,
  title: Title,
  epubctxOut: epubh.EpubContext<EpubContextTrackers>,
  currentInputFile: string
): Promise<void> {
  // just to make sure that the type is defined and correctly assumed
  utils.assertion(title.titleType === TitleType.CoverPage, new Error('Expected TitleType to be "CoverPage"'));

  const imgNode = xh.queryDefinedElement(documentInput, 'img');

  const imgNodeSrc = imgNode.getAttribute('src');

  utils.assertionDefined(imgNodeSrc, new Error('Expected "imgNodeSrc" to be defined'));

  const fromPath = path.resolve(path.dirname(currentInputFile), imgNodeSrc);
  const ext = path.extname(fromPath);
  const imgId = `cover${ext}`;
  const imgFilename = `Cover${ext}`;

  await copyImage(fromPath, epubctxOut, imgFilename, {
    Id: imgId,
    OriginalFilename: fromPath,
    Main: false,
    IndexInSequence: 0,
  });
  const { dom: imgDOM } = await createIMGDOM(title, imgId, epubh.ImgClass.Cover, `../Images/${imgFilename}`);

  await epubh.finishDOMtoFile(imgDOM, path.dirname(epubctxOut.contentPath), COVER_XHTML_FILENAME, epubh.FileDir.Text, epubctxOut, {
    seqIndex: 0,
    type: { type: epubh.EpubContextFileXHTMLTypes.IMG, imgClass: epubh.ImgClass.Cover, imgType: epubh.ImgType.Cover },
    id: COVER_XHTML_FILENAME,
    title: title.fullTitle,
    globalSeqIndex: 0,
  });
}

/**
 * Handle everything related to the Frontmatter Title types
 * @param documentInput The Input Document's "document.body"
 * @param title The Title Object
 * @param epubctxOut EPUB Context of the Output file
 * @param currentInputFile Currently processing's Input file path
 */
async function doFrontMatter(
  documentInput: Document,
  title: Title,
  epubctxOut: epubh.EpubContext<EpubContextTrackers>,
  currentInputFile: string
): Promise<void> {
  // just to make sure that the type is defined and correctly assumed
  utils.assertionDefined(title.titleType, new Error('Expected "title.titleType" to be defined'));

  const FRONT_TYPES: TitleType[] = [
    TitleType.ColorInserts,
    TitleType.CopyrightsAndCredits,
    TitleType.TitlePage,
    TitleType.TocImage,
    TitleType.CastOfCharacters,
  ];

  if (!FRONT_TYPES.includes(title.titleType)) {
    throw new Error(`Expected "title.titleType" to be a supported FONT_TYPE, got \"${TitleType[title.titleType]}\"`);
  }

  const imgNodes = xh.queryDefinedElementAll(documentInput, 'img');
  const globState = epubctxOut.incTracker('Global');

  let seq = 0;

  for (const elem of Array.from(imgNodes)) {
    const frontnum = epubctxOut.incTracker('LastFrontNum');
    const imgNodeSrc = elem.getAttribute('src');

    utils.assertionDefined(imgNodeSrc, new Error('Expected "imgNodeSrc" to be defined'));

    const fromPath = path.resolve(path.dirname(currentInputFile), imgNodeSrc);
    const ext = path.extname(fromPath);
    const imgId = `frontmatter${frontnum}${ext}`;
    const imgFilename = `Frontmatter${frontnum}${ext}`;

    await copyImage(fromPath, epubctxOut, imgFilename, {
      Id: imgId,
      OriginalFilename: fromPath,
      Main: false,
      IndexInSequence: 0,
    });
    const { dom: imgDOM } = await createIMGDOM(title, imgId, epubh.ImgClass.Insert, `../Images/${imgFilename}`);

    const xhtmlName = `frontmatter${frontnum}.xhtml`;
    await epubh.finishDOMtoFile(imgDOM, path.dirname(epubctxOut.contentPath), xhtmlName, epubh.FileDir.Text, epubctxOut, {
      id: xhtmlName,
      seqIndex: seq,
      title: title.fullTitle,
      type: {
        type: epubh.EpubContextFileXHTMLTypes.IMG,
        imgClass: epubh.ImgClass.Insert,
        imgType: epubh.ImgType.Frontmatter,
      },
      globalSeqIndex: globState, // should be automatically sorted to the front
    });

    seq += 1;
  }
}

/**
 * Handle everything related to the "Title.ShortStory" type
 * @param documentInput The Input Document's "document.body"
 * @param title The Title Object
 * @param epubctxOut EPUB Context of the Output file
 * @param currentInputFile Currently processing's Input file path
 */
async function doShortStory(
  documentInput: Document,
  title: Title,
  epubctxOut: epubh.EpubContext<EpubContextTrackers>,
  currentInputFile: string
): Promise<void> {
  // just to make sure that the type is defined and correctly assumed
  utils.assertion(title.titleType === TitleType.ShortStory, new Error('Expected TitleType to be "ShortStory"'));
  epubctxOut.incTracker('LastShortStoryNum');

  const bodyElement = xh.queryDefinedElement(documentInput, 'body');
  utils.assertionDefined(bodyElement, new Error('Expected "bodyElement" to exist'));

  let indexOfFirstNonBreakElement = Array.from(bodyElement.children).findIndex(
    (v) => !v.getAttribute('class')?.includes('P__STAR__STAR__STAR__page_break')
  );

  // fallback in case no index has been found
  if (indexOfFirstNonBreakElement < 0) {
    indexOfFirstNonBreakElement = 1;
  }

  if (indexOfFirstNonBreakElement > 3) {
    console.log('Encountered more than 3 Elements to skip in Short Stories ('.red + currentInputFile + ')'.red);
  }

  await doTextContent(documentInput, title, epubctxOut, currentInputFile, {
    genID: function (lastStates: LastStates, subnum: number): string {
      let baseName = 'shortstory' + lastStates.LastShortStoryNum;

      // only add a subnumber when a subnumber is required (not in the first of the chapter)
      if (subnum > 0) {
        baseName += `_${subnum}`;
      }

      return baseName;
    },
    genIMGID: function (lastStates: LastStates, inputimg: string): DoTextContentIMGID {
      const newState = epubctxOut.incTracker('LastInsertNum');
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
    genChapterElementContent: function (document: Document, title: Title, h1Element: HTMLHeadingElement): void {
      utils.assertionDefined(title.chapterTitle, new Error('Expected "title.chapterTitle" to be defined'));

      let chapterName: string;

      if (!utils.isNullOrUndefined(title.chapterNumber)) {
        chapterName = `Short Story ${title.chapterNumber}:`;
      } else {
        chapterName = `Short Story:`;
      }

      const firstElement = documentInput.querySelector('body > p');

      utils.assertionDefined(firstElement, new Error('Expected "firstElement" to be defined'));

      // for now it should be enough to just deal with 1 extra element
      if (!firstElement.textContent?.includes('Short Story')) {
        log('Encountered a Short Story which does not start with the chapter');

        utils.assertionDefined(firstElement.textContent, new Error('Expected "firstElement.textContent" to be defined'));
        h1Element.appendChild(document.createTextNode(firstElement.textContent));
        h1Element.appendChild(document.createElement('br'));
      }

      h1Element.appendChild(document.createTextNode(chapterName));
      h1Element.appendChild(document.createElement('br'));
      h1Element.appendChild(document.createTextNode(`${title.chapterTitle}`));
    },

    skipElements: indexOfFirstNonBreakElement,
  });
}

/**
 * Handle everything related to the "Title.SideStory" type
 * @param documentInput The Input Document's "document.body"
 * @param title The Title Object
 * @param epubctxOut EPUB Context of the Output file
 * @param currentInputFile Currently processing's Input file path
 */
async function doSideStory(
  documentInput: Document,
  title: Title,
  epubctxOut: epubh.EpubContext<EpubContextTrackers>,
  currentInputFile: string
): Promise<void> {
  // just to make sure that the type is defined and correctly assumed
  utils.assertion(title.titleType === TitleType.SideStory, new Error('Expected TitleType to be "SideStory"'));
  epubctxOut.incTracker('LastSideStoryNum');

  await doTextContent(documentInput, title, epubctxOut, currentInputFile, {
    genID: function (lastStates: LastStates, subnum: number): string {
      let baseName = 'sidestory' + lastStates.LastSideStoryNum;

      // only add a subnumber when a subnumber is required (not in the first of the chapter)
      if (subnum > 0) {
        baseName += `_${subnum}`;
      }

      return baseName;
    },
    genIMGID: function (lastStates: LastStates, inputimg: string): DoTextContentIMGID {
      const newState = epubctxOut.incTracker('LastInsertNum');
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
    genChapterElementContent: function (document: Document, title: Title, h1Element: HTMLHeadingElement): void {
      utils.assertionDefined(title.chapterTitle, new Error('Expected "title.chapterTitle" to be defined'));

      let chapterName: string;

      if (!utils.isNullOrUndefined(title.chapterNumber)) {
        chapterName = `Side Story ${title.chapterNumber}:`;
      } else {
        chapterName = `Side Story:`;
      }

      h1Element.appendChild(document.createTextNode(chapterName));
      h1Element.appendChild(document.createElement('br'));
      h1Element.appendChild(document.createTextNode(`${title.chapterTitle}`));
    },
  });
}

/**
 * Handle everything related to the "Title.BonusStory" type
 * @param documentInput The Input Document's "document.body"
 * @param title The Title Object
 * @param epubctxOut EPUB Context of the Output file
 * @param currentInputFile Currently processing's Input file path
 */
async function doBonusStory(
  documentInput: Document,
  title: Title,
  epubctxOut: epubh.EpubContext<EpubContextTrackers>,
  currentInputFile: string
): Promise<void> {
  // just to make sure that the type is defined and correctly assumed
  utils.assertion(title.titleType === TitleType.BonusStory, new Error('Expected TitleType to be "BonusStory"'));
  epubctxOut.incTracker('LastBonusStoryNum');

  await doTextContent(documentInput, title, epubctxOut, currentInputFile, {
    genID: function (lastStates: LastStates, subnum: number): string {
      let baseName = 'bonusstory' + lastStates.LastBonusStoryNum;

      // only add a subnumber when a subnumber is required (not in the first of the chapter)
      if (subnum > 0) {
        baseName += `_${subnum}`;
      }

      return baseName;
    },
    genIMGID: function (lastStates: LastStates, inputimg: string): DoTextContentIMGID {
      const newState = epubctxOut.incTracker('LastInsertNum');
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
    genChapterElementContent: function (document: Document, title: Title, h1Element: HTMLHeadingElement): void {
      utils.assertionDefined(title.chapterTitle, new Error('Expected "title.chapterTitle" to be defined'));

      let chapterName: string;

      if (!utils.isNullOrUndefined(title.chapterNumber)) {
        chapterName = `Bonus Story ${title.chapterNumber}:`;
      } else {
        chapterName = `Bonus Story:`;
      }

      h1Element.appendChild(document.createTextNode(chapterName));
      h1Element.appendChild(document.createElement('br'));
      h1Element.appendChild(document.createTextNode(`${title.chapterTitle}`));
    },
  });
}

/**
 * Handle everything related to the "Title.Interlude" type
 * @param documentInput The Input Document's "document.body"
 * @param title The Title Object
 * @param epubctxOut EPUB Context of the Output file
 * @param currentInputFile Currently processing's Input file path
 */
async function doInterlude(
  documentInput: Document,
  title: Title,
  epubctxOut: epubh.EpubContext<EpubContextTrackers>,
  currentInputFile: string
): Promise<void> {
  // just to make sure that the type is defined and correctly assumed
  utils.assertion(title.titleType === TitleType.Interlude, new Error('Expected TitleType to be "Interlude"'));
  epubctxOut.incTracker('LastInterludeNum');

  await doTextContent(documentInput, title, epubctxOut, currentInputFile, {
    genID: function (lastStates: LastStates, subnum: number): string {
      let baseName = 'interlude' + lastStates.LastInterludeNum;

      // only add a subnumber when a subnumber is required (not in the first of the chapter)
      if (subnum > 0) {
        baseName += `_${subnum}`;
      }

      return baseName;
    },
    genIMGID: function (lastStates: LastStates, inputimg: string): DoTextContentIMGID {
      const newState = epubctxOut.incTracker('LastInsertNum');
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
    genChapterElementContent: function (document: Document, title: Title, h1Element: HTMLHeadingElement): void {
      let chapterName: string;

      if (!utils.isNullOrUndefined(title.chapterNumber)) {
        chapterName = `Interlude ${title.chapterNumber}:`;
      } else {
        chapterName = `Interlude:`;
      }

      h1Element.appendChild(document.createTextNode(chapterName));

      if (!utils.isNullOrUndefined(title.chapterTitle)) {
        h1Element.appendChild(document.createElement('br'));
        h1Element.appendChild(document.createTextNode(`${title.chapterTitle}`));
      }
    },
  });
}

/**
 * Handle everything related to the "Title.Chapter" type
 * @param documentInput The Input Document's "document.body"
 * @param title The Title Object
 * @param epubctxOut EPUB Context of the Output file
 * @param currentInputFile Currently processing's Input file path
 */
async function doChapter(
  documentInput: Document,
  title: Title,
  epubctxOut: epubh.EpubContext<EpubContextTrackers>,
  currentInputFile: string
): Promise<void> {
  // just to make sure that the type is defined and correctly assumed
  utils.assertion(title.titleType === TitleType.Chapter, new Error('Expected TitleType to be "Chapter"'));
  epubctxOut.incTracker('LastChapterNum');

  await doTextContent(documentInput, title, epubctxOut, currentInputFile, {
    genID: function (lastStates: LastStates, subnum: number): string {
      let baseName = 'chapter' + lastStates.LastChapterNum;

      // only add a subnumber when a subnumber is required (not in the first of the chapter)
      if (subnum > 0) {
        baseName += `_${subnum}`;
      }

      return baseName;
    },
    genIMGID: function (lastStates: LastStates, inputimg: string): DoTextContentIMGID {
      const newState = epubctxOut.incTracker('LastInsertNum');
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
    genChapterElementContent: function (document: Document, title: Title, h1Element: HTMLHeadingElement): void {
      utils.assertionDefined(title.chapterNumber, new Error('Expected "title.chapterNumber" to be defined'));
      utils.assertionDefined(title.chapterTitle, new Error('Expected "title.chapterTitle" to be defined'));

      h1Element.appendChild(document.createTextNode(`Chapter ${title.chapterNumber}:`));
      h1Element.appendChild(document.createElementNS(xh.STATICS.XHTML_XML_NAMESPACE, 'br'));
      h1Element.appendChild(document.createTextNode(`${title.chapterTitle}`));
    },

    // skip all elements that have both "namedTitle" and "chapterTitle" in them, cannot be more easily done because the chapter header is contained like other text
    checkElement: function (elem: Element): boolean {
      return (
        (!utils.isNullOrUndefined(title.chapterNumber) &&
          !utils.isNullOrUndefined(title.chapterTitle) &&
          elem.textContent?.includes(`Chapter ${title.chapterNumber}:`) &&
          // the following has to be done, because the original has "br" directly without space, which will make it not matching
          elem.textContent.replaceAll(' ', '').includes(title.chapterTitle.replaceAll(' ', ''))) ??
        false
      );
    },

    skipElements: 0,
  });
}

/**
 * Handle Generic Title Types
 * @param documentInput The Input Document's "document.body"
 * @param title The Title Object
 * @param epubctxOut EPUB Context of the Output file
 * @param currentInputFile Currently processing's Input file path
 * @param skipElements Set how many elements to initally skip
 */
async function doGeneric(
  documentInput: Document,
  title: Title,
  epubctxOut: epubh.EpubContext<EpubContextTrackers>,
  currentInputFile: string,
  skipElements?: number
): Promise<void> {
  // just to make sure that the type is defined and correctly assumed
  await doTextContent(documentInput, title, epubctxOut, currentInputFile, {
    genID: function (lastStates: LastStates, subnum: number): string {
      // transform fullTitle to spaceless lowercase version
      let baseName = title.fullTitle.trim().replaceAll(/ /gim, '').toLowerCase();

      // only add a subnumber when a subnumber is required (not in the first of the chapter)
      if (subnum > 0) {
        baseName += `_${subnum}`;
      }

      return baseName;
    },
    genIMGID: function (lastStates: LastStates, inputimg: string): DoTextContentIMGID {
      const newState = epubctxOut.incTracker('LastGenericNum');
      const ext = path.extname(inputimg);
      const imgid = `generic${newState}${ext}`;
      const imgfilename = `Generic${newState}${ext}`;
      const xhtmlName = `generic${newState}`;

      return {
        imgFilename: imgfilename,
        id: imgid,
        imgtype: epubh.ImgClass.Insert,
        xhtmlFilename: xhtmlName,
      };
    },
    genChapterElementContent: function (document: Document, title: Title, h1Element: HTMLHeadingElement): void {
      if (!utils.isNullOrUndefined(title.namedTitle) && !utils.isNullOrUndefined(title.chapterTitle)) {
        h1Element.appendChild(document.createTextNode(`${title.namedTitle}:`));
        h1Element.appendChild(document.createElementNS(xh.STATICS.XHTML_XML_NAMESPACE, 'br'));
        h1Element.appendChild(document.createTextNode(`${title.chapterTitle}`));

        return;
      }

      h1Element.appendChild(document.createTextNode(title.fullTitle));
    },

    // skip all elements that have both "namedTitle" and "chapterTitle" in them, cannot be more easily done because the chapter header is contained like other text
    checkElement: function (elem: Element): boolean {
      return (
        (!utils.isNullOrUndefined(title.namedTitle) &&
          !utils.isNullOrUndefined(title.chapterTitle) &&
          elem.textContent?.includes(title.namedTitle) &&
          elem.textContent.includes(title.chapterTitle)) ??
        false
      );
    },

    skipElements,
  });
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
   * @param lastStates EpubContextOutput LastStates
   * @param subnum Current SubChapter number
   */
  genID(lastStates: LastStates, subnum: number): string;
  /**
   * Generate the image id & filename
   * @param lastStates EpubContextOutput LastStates
   * @param inputimg the full file path for the input image
   */
  genIMGID(lastStates: LastStates, inputimg: string): DoTextContentIMGID;
  /**
   * Generate the "h1" element's content
   * @param document The Current DOM Document
   * @param title The title object
   * @param h1Element The h1 header element (eg chapter)
   * @returns nothing, the "h1Element" input should be directly modified and that will be used
   */
  genChapterElementContent(document: Document, title: Title, h1Element: HTMLHeadingElement): void;

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
 * @param title The Title Object
 * @param epubctxOut EPUB Context of the Output file
 * @param baseOutputPath Base Output path to output files to
 * @param currentInputFile Currently processing's Input file path
 */
async function doTextContent(
  documentInput: Document,
  title: Title,
  epubctxOut: epubh.EpubContext<EpubContextTrackers>,
  currentInputFile: string,
  options: DoTextContentOptions
): Promise<void> {
  let currentSubChapter = 0;
  let currentBaseName = replaceID(options.genID(epubctxOut.tracker, currentSubChapter));
  const globState = epubctxOut.incTracker('Global');

  let { dom: currentDOM, document: documentNew, mainElement } = await createMAINDOM(title, currentBaseName);

  // create initial "h1" (header) element and add it
  {
    const h1element = documentNew.createElement('h1');
    options.genChapterElementContent(documentNew, title, h1element);
    mainElement.appendChild(h1element);
  }

  // tracker to know if the initial "p" element for the chapter was already skipped
  let toSkipNumber = 1;

  if (typeof options.skipElements === 'number') {
    toSkipNumber = options.skipElements;
  }

  const innerElements = documentInput.querySelector('body')?.children;

  utils.assertionDefined(innerElements);

  let sequenceCounter = 0;

  const customChecker = options.checkElement;

  for (const elem of Array.from(innerElements) as Element[]) {
    // for this series, it is safe to assume that the first element is the chapter "p" element
    if (toSkipNumber > 0) {
      toSkipNumber -= 1;
      continue;
    }

    // const innerTextTrimmed = elem.textContent?.trim() ?? '';

    // // skip all elements that are empty or only contain spaces or is a "nbsp"
    // if (innerTextTrimmed.length === 0) {
    //   continue;
    // }

    // skip elements when the customChecker deems it necessary
    if (!utils.isNullOrUndefined(customChecker) && customChecker(elem)) {
      continue;
    }

    if (elem.localName === 'p') {
      {
        const imgNode = elem.querySelector('img');

        const skipSavingMainDOM = isElementEmpty(mainElement) || onlyhash1(mainElement);

        if (!utils.isNullOrUndefined(imgNode)) {
          const imgNodeSrc = imgNode.src;

          // dont save a empty dom
          if (!skipSavingMainDOM) {
            const xhtmlNameMain = `${currentBaseName}.xhtml`;
            await epubh.finishDOMtoFile(currentDOM, path.dirname(epubctxOut.contentPath), xhtmlNameMain, epubh.FileDir.Text, epubctxOut, {
              id: xhtmlNameMain,
              seqIndex: sequenceCounter,
              title: title.fullTitle,
              type: {
                type: epubh.EpubContextFileXHTMLTypes.TEXT,
              },
              globalSeqIndex: globState,
            });
            currentSubChapter += 1;
            sequenceCounter += 1;
          }

          const fromPath = path.resolve(path.dirname(currentInputFile), imgNodeSrc);

          const {
            imgtype,
            id: imgid,
            imgFilename: imgFilename,
            xhtmlFilename: imgXHTMLFileName,
          } = options.genIMGID(epubctxOut.tracker, fromPath);

          await copyImage(fromPath, epubctxOut, imgFilename, {
            Id: imgid,
            OriginalFilename: fromPath,
            Main: false,
            IndexInSequence: 0,
          });
          const { dom: imgDOM } = await createIMGDOM(title, imgid, imgtype, `../Images/${imgFilename}`);

          const xhtmlNameIMG = `${imgXHTMLFileName}.xhtml`;
          await epubh.finishDOMtoFile(imgDOM, path.dirname(epubctxOut.contentPath), xhtmlNameIMG, epubh.FileDir.Text, epubctxOut, {
            id: xhtmlNameIMG,
            seqIndex: sequenceCounter,
            title: title.fullTitle,
            type: {
              type: epubh.EpubContextFileXHTMLTypes.IMG,
              imgClass: epubh.ImgClass.Insert,
              imgType: epubh.ImgType.Insert,
            },
            globalSeqIndex: globState,
          });
          sequenceCounter += 1;

          // dont create a new dom if the old one is still empty
          if (!skipSavingMainDOM) {
            currentBaseName = replaceID(options.genID(epubctxOut.tracker, currentSubChapter));
            const nextchapter = await createMAINDOM(title, currentBaseName);
            currentDOM = nextchapter.dom;
            documentNew = nextchapter.document;
            mainElement = nextchapter.mainElement;
          }

          continue;
        }
      }

      const newNode = generatePElement(elem, documentNew);

      mainElement.appendChild(newNode);
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
  if (!isElementEmpty(mainElement) && !onlyhash1(mainElement)) {
    const xhtmlNameMain = `${currentBaseName}.xhtml`;
    await epubh.finishDOMtoFile(currentDOM, path.dirname(epubctxOut.contentPath), xhtmlNameMain, epubh.FileDir.Text, epubctxOut, {
      id: xhtmlNameMain,
      seqIndex: sequenceCounter,
      title: title.fullTitle,
      type: {
        type: epubh.EpubContextFileXHTMLTypes.TEXT,
      },
      globalSeqIndex: globState,
    });
    sequenceCounter += 1;
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
function onlyhash1(elem: Element): boolean {
  return elem.children.length === 1 && elem.children[0].localName === 'h1';
}

/** Small Helper functions to consistently tell if a node has no children */
function isElementEmpty(elem: Element): boolean {
  return elem.childNodes.length === 0;
}

/** Generate "p" elements, with text and inner text */
function generatePElement(origElem: Element, documentNew: Document): Element {
  const topElem = documentNew.createElement('p');

  if (
    (origElem.className.includes('P__STAR__STAR__STAR__page_break') ||
      origElem.className.includes('P_Prose_Formatting__And__Centre_Alignment') ||
      origElem.className.includes('P__STAR__STAR__STAR__page_break__And__Page_Break')) &&
    // only allow elements to have this class when not being empty of text
    (origElem.textContent?.trim().length ?? 0) > 0
  ) {
    topElem.setAttribute('class', 'centerp section-marking');
  } else if (
    origElem.className.includes('P_Normal__And__Right_Alignment__And__Left_Indent__And__Spacing_After__And__Spacing_Before') ||
    origElem.className.includes('P_Prose_Formatting__And__Right_Alignment')
  ) {
    topElem.setAttribute('class', 'signature');
  } else if (origElem.className.includes('P_Prose_Formatting__And__Left_Indent')) {
    topElem.setAttribute('class', 'extra-indent');
  }

  for (const elem of generatePElementInner(origElem, documentNew)) {
    topElem.appendChild(elem);
  }

  return topElem;
}

interface GeneratePElementInnerElem {
  topElem?: Node;
  currentElem?: Node;
}

/**
 * Helper Function for "generatePElementInner" to consistently update the elements
 * Updates the "obj" with the topElement if unset, and adds "newNode" to "currentElem" and re-assigns the "currentElem"
 * @param obj The Object to modify
 * @param newNode The new Node to add
 */
function helperAssignElem(obj: GeneratePElementInnerElem, newNode: Node) {
  if (utils.isNullOrUndefined(obj.currentElem)) {
    obj.currentElem = newNode;
    obj.topElem = newNode;
  } else {
    obj.currentElem.appendChild(newNode);
    obj.currentElem = newNode;
  }
}

/** Return formatted and only elements that are required */
function generatePElementInner(origNode: Node, documentNew: Document): Node[] {
  if (origNode.nodeType === documentNew.TEXT_NODE) {
    utils.assertionDefined(origNode.textContent, new Error('Expected "origElem.textContent" to be defined'));

    return [documentNew.createTextNode(origNode.textContent)];
  }

  if (origNode.nodeType !== documentNew.ELEMENT_NODE) {
    console.error('Encountered unhandled "nodeType":'.red, origNode.nodeType);

    return [];
  }

  const origElem = origNode as Element;

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

  if (utils.isNullOrUndefined(elemObj.currentElem)) {
    const listOfNodes: Node[] = [];

    for (const child of Array.from(origElem.childNodes)) {
      listOfNodes.push(...generatePElementInner(child, documentNew));
    }

    return listOfNodes;
  }

  for (const child of Array.from(origElem.childNodes)) {
    for (const elem of generatePElementInner(child, documentNew)) {
      elemObj.currentElem.appendChild(elem);
    }
  }

  utils.assertionDefined(elemObj.topElem, new Error('Expected "elemObj.topElem" to be defined at this point'));

  return [elemObj.topElem];
}

enum TitleType {
  Chapter,
  BonusStory,
  ShortStory,
  SideStory,
  Interlude,
  Afterword,
  CoverPage,
  ColorInserts,
  TitlePage,
  CopyrightsAndCredits,
  TocImage,
  Dedication,
  Previously,
  CastOfCharacters,
  AboutAuthorAndIllust,
  NamedSideStory,
}

interface Title {
  /** Title Number, if existing */
  chapterNumber?: number;
  /** Unique Title, if existing */
  chapterTitle?: string;
  /** Type of Title, undefined if not matching a title */
  titleType?: TitleType;
  /** Full Title, on one line */
  fullTitle: string;
  /** Name of the Chapter, like unique named things */
  namedTitle?: string;
}

const GENERIC_TITLE_REGEX = /^\s*(?<type>.+?)(?: (?<num>\d+))?(?:: (?<title>.+?))?\s*$/gim;

/**
 * Function to get the title accurately
 * @param headTitle The Title to parse
 * @returns The Processed title
 */
function getTitle(headTitle: string): Title {
  const matches = GENERIC_TITLE_REGEX.exec(headTitle);

  // reset regex after use, because they have a state
  GENERIC_TITLE_REGEX.lastIndex = 0;

  utils.assertionDefined(matches, new Error('Failed to get matches for Title'));

  const type = regexMatchGroupRequired(matches, 'type', 'getTitle');
  const numString = regexMatchGroup(matches, 'num');
  const title = regexMatchGroup(matches, 'title');

  if (type === 'Copyrights and Credits') {
    return {
      fullTitle: headTitle.trim(),
      titleType: TitleType.CopyrightsAndCredits,
    };
  } else if (type === 'Table of Contents Page') {
    return {
      fullTitle: headTitle.trim(),
      titleType: TitleType.TocImage,
    };
  } else if (type === 'Cast of Characters') {
    return {
      fullTitle: headTitle.trim(),
      titleType: TitleType.CastOfCharacters,
    };
  } else if (type === 'About the Author and Illustrator') {
    return {
      fullTitle: headTitle.trim(),
      titleType: TitleType.AboutAuthorAndIllust,
    };
  } else if (type === 'Interlude' || type === 'Interludes') {
    let numMixed: number | undefined = undefined;

    if (!utils.isNullOrUndefined(numString)) {
      numMixed = parseInt(numString);
    }

    return {
      fullTitle: headTitle.trim(),
      titleType: TitleType.Interlude,
      chapterNumber: numMixed,
      chapterTitle: title,
    };
  } else if (/lenny recaps/gim.test(type)) {
    return {
      fullTitle: headTitle.trim(),
      titleType: TitleType.NamedSideStory,
      chapterTitle: title,
      namedTitle: type,
    };
  }

  const TypeForSwitch = TitleType[type.replaceAll(/\s/gim, '')];
  switch (TypeForSwitch) {
    case TitleType.Chapter:
      utils.assertionDefined(numString, new Error("Expected Regex Group 'num' to be defined for Type 'Chapter'"));
      utils.assertionDefined(title, new Error("Expected Regex Group 'title' to be defined for Type 'Chapter'"));

      const numChapter = parseInt(numString);

      return {
        fullTitle: headTitle.trim(),
        titleType: TitleType.Chapter,
        chapterNumber: numChapter,
        chapterTitle: title,
      };
    case TitleType.Dedication:
    case TitleType.Previously:
    case TitleType.Afterword:
    case TitleType.ColorInserts:
    case TitleType.CoverPage:
    case TitleType.TitlePage:
      return {
        fullTitle: headTitle.trim(),
        titleType: TypeForSwitch,
      };
    case TitleType.BonusStory:
    case TitleType.ShortStory:
    case TitleType.SideStory:
      utils.assertionDefined(title, new Error("Expected Regex Group 'title' to be defined for Type 'Chapter'"));
      let numMixed: number | undefined = undefined;

      if (!utils.isNullOrUndefined(numString)) {
        numMixed = parseInt(numString);
      }

      return {
        fullTitle: headTitle.trim(),
        titleType: TypeForSwitch,
        chapterNumber: numMixed,
        chapterTitle: title,
      };
    case TitleType.Interlude:
    case TitleType.CopyrightsAndCredits:
    case TitleType.TocImage:
    case TitleType.CastOfCharacters:
    case TitleType.AboutAuthorAndIllust:
      throw new Error('Unreachable');
    default:
      return {
        fullTitle: headTitle.trim(),
      };
  }
}

/** Helper to get regex match groups, which are required with consistent error */
function regexMatchGroupRequired(match: RegExpMatchArray, groupName: string, context: string): string {
  const group = match.groups?.[groupName];

  utils.assertionDefined(group, new Error(`Expected Regex Group "${groupName}" to be in the match (context: ${context})`));

  return group;
}

/** Helper to match the "Required" version, just without error (basically a alias) */
function regexMatchGroup(match: RegExpMatchArray, groupName: string): string | undefined {
  const group = match.groups?.[groupName];

  return group;
}

/**
 * Normalize a id (only allow supported characters)
 * @param inputid
 * @returns
 */
function replaceID(inputid: string): string {
  const replacedid = inputid.replaceAll(/^[^a-zA-Z]+|[^a-zA-Z0-9-_.]/gim, '');
  utils.assertion(replacedid.length > 0, new Error('Expected "replacedid" to have length > 0'));

  return replacedid;
}
