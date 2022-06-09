import * as utils from '../utils.js';
import { createWriteStream, promises as fspromises } from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import * as tmp from 'tmp';
import debug from 'debug';
import yauzl from 'yauzl';
import yazl from 'yazl';
import * as mime from 'mime-types';

const log = debug('converter:average_ln_original');

tmp.setGracefulCleanup();

// STATIC OPTIONS
const INPUT_MATCH_REGEX = /Didn.{1}t I Say to Make My Abilities Average/gim;
/** Regex of files to filter out (to not include in the output) */
const FILES_TO_FILTER_OUT_REGEX = /newsletter|sevenseaslogo/gim;
const TITLES_TO_FILTER_OUT_REGEX = /newsletter/gim;
const XHTML_MIMETYPE = 'application/xhtml+xml';
const XML_MIMETYPE = 'application/xml';
const DC_XML_NAMESPACE = 'http://purl.org/dc/elements/1.1/';
const OPF_XML_NAMESPACE = 'http://www.idpf.org/2007/opf';
const NCX_XML_NAMESPACE = 'http://www.daisy.org/z3986/2005/ncx/';
const XHTML_XML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
/**
 * The Template to use for each document, except special
 * available options to be replaced:
 * "{{TITLE}}": will be replaced with the document title (header) (oneline)
 * "{{SECTIONID}}": will be replaced with the section id for the body
 * "{{EPUBTYPE}}": will be replaced with the EPUB Type, use enum "EPubType"
 */
const MAIN_BODY_TEMPLATE: string = `<?xml version='1.0' encoding='utf-8'?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:xml="http://www.w3.org/XML/1998/namespace" lang="en" xml:lang="en">
  <head>
    <title>{{TITLE}}</title>
    <meta content="application/xhtml+xml;charset=utf-8" http-equiv="Content-Type"/>
    <link href="../Styles/stylesheet.css" rel="stylesheet" type="text/css"/>
  </head>
  <body>
    <section epub:type="{{EPUBTYPE}}" id="{{SECTIONID}}">
      <div class="main"></div>
    </section>
  </body>
</html>
`;
/**
 * The Template to use for each document, except special
 * available options to be replaced:
 * "{{TITLE}}": will be replaced with the document title (header) (oneline)
 * "{{SECTIONID}}": will be replaced with the section id for the body
 * "{{EPUBTYPE}}": will be replaced with the EPUB Type, use enum "EPubType"
 * "{{IMGALT}}": will be replaced with the image ALT name
 * "{{IMGCLASS}}": will be replaced with the image Class, use enum "ImgClass"
 * "{{IMGSRC}}": will be replaced with the image Source
 */
const JUST_IMAGE_TEMPLATE: string = `<?xml version='1.0' encoding='utf-8'?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:xml="http://www.w3.org/XML/1998/namespace" lang="en" xml:lang="en">
  <head>
    <title>{{TITLE}}</title>
    <meta content="application/xhtml+xml;charset=utf-8" http-equiv="Content-Type"/>
    <link href="../Styles/stylesheet.css" rel="stylesheet" type="text/css"/>
  </head>
  <body class="nomargin center">
    <section epub:type="{{EPUBTYPE}}" id="{{SECTIONID}}">
      <img alt="{{IMGALT}}" class="{{IMGCLASS}}" src="{{IMGSRC}}"/>
    </section>
  </body>
</html>
`;
/**
 * The Template to use for each document
 */
const TOC_XHTML_TEMPLATE: string = `<?xml version='1.0' encoding='utf-8'?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:xml="http://www.w3.org/XML/1998/namespace" lang="en" xml:lang="en">
  <head>
    <title>Table Of Contents</title>
    <meta content="application/xhtml+xml;charset=utf-8" http-equiv="Content-Type"/>
    <link href="../Styles/stylesheet.css" rel="stylesheet" type="text/css"/>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1 class="toc-title">Table of Contents</h1>
      <ol class="none" epub:type="list"></ol>
    </nav>

    <nav epub:type="landmarks" id="landmarks" hidden="">
      <h1>Landmarks</h1>
      <ol>
        <li><a epub:type="toc" href="../Text/toc.xhtml">Table of Contents</a></li>
      </ol>
    </nav>
  </body>
</html>
`;
/**
 * The Template to use for each document, except special
 * available options to be replaced:
 * "{{TITLE}}": will be replaced with the document title (header) (oneline)
 */
const TOC_NCX_TEMPLATE: string = `<?xml version="1.0" encoding="utf-8" ?>
<ncx version="2005-1" xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <head>
    <meta content="1" name="dtb:depth"/>
    <meta content="0" name="dtb:totalPageCount"/>
    <meta content="0" name="dtb:maxPageNumber"/>
  </head>
  <docTitle>
    <text>{{TITLE}}</text>
  </docTitle>
  <navMap></navMap>
</ncx>
`;
/**
 * The Template to use for each document
 */
const CONTENTOPF_TEMPLATE: string = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"></metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="toc.xhtml" href="Text/toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover.xhtml" href="Text/cover.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx" page-progression-direction="ltr">
    <itemref idref="cover.xhtml"/>
    <itemref idref="toc.xhtml" linear="yes"/>
  </spine>
  <guide>
    <reference type="toc" title="Table of Contents" href="Text/toc.xhtml"/>
  </guide>
</package>
`;
/**
 * The Template to use for each document
 */
const CONTAINER_TEMPLATE: string = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
    <rootfiles>
        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
   </rootfiles>
</container>
`;
/** StyleSheet copied to the output */
const STYLESHEET: string = (
  await fspromises.readFile(path.resolve(utils.getCurrentModuleDirectory(import.meta.url), '../../templates', 'averbil_ln.css'))
).toString();

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

export async function process(options: utils.ConverterOptions): Promise<void> {
  const { name: usePath, tmpdir: tmpdirInput } = await getInputPath(options.fileInputPath);

  const { context: epubContextInput, contentBody: contentBodyInput } = await getEpubContextForInput(usePath);

  const tmpdirOutput = tmp.dirSync({ prefix: 'converty-out' });
  const tmpdirOutputName = tmpdirOutput.name;

  const outputContentPath = 'OEBPS/content.opf';
  const baseOutputPath = path.resolve(tmpdirOutputName, path.dirname(outputContentPath));
  await utils.mkdir(baseOutputPath);
  // await fspromises.writeFile(path.resolve(tmpdirOutputName, outputContentPath), '');
  // write the "mimetype" file, because it will not be modifed again
  await fspromises.writeFile(path.resolve(tmpdirOutputName, 'mimetype'), 'application/epub+zip');
  const containerPath = path.resolve(tmpdirOutputName, 'META-INF/container.xml');
  await utils.mkdir(path.dirname(containerPath));
  // write the "META-INF/container.xml" file, because it will not change
  await fspromises.writeFile(containerPath, CONTAINER_TEMPLATE);

  const epubContextOutput: OutputEpubContext = {
    Files: [],
    Title: epubContextInput.Title,
    ContentPath: outputContentPath,
    LastStates: {
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
  };

  const stylesheetpath = path.resolve(baseOutputPath, 'Styles', 'stylesheet.css');
  await utils.mkdir(path.dirname(stylesheetpath));
  await fspromises.writeFile(stylesheetpath, STYLESHEET);
  epubContextOutput.Files.push({
    Id: 'stylesheet',
    // this function creates the path, so it will be added here
    Path: stylesheetpath,
    // ensure it is the XHTML mimetype, because this function only writes the dom to file
    MediaType: 'text/css',
    // ensure only the basename is added, not the full path
    OriginalFilename: '',
    Main: false,
    IndexInSequence: 0,
  });

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
    if (mimetype === 'text/html' || mimetype === XHTML_MIMETYPE) {
      await processHTMLFile(file, epubContextInput, epubContextOutput, baseOutputPath);
      continue;
    }
    if (mimetype === 'application/x-dtbncx+xml') {
      utils.assertion(utils.isNullOrUndefined(epubContextInput.NCXPath), new Error('Expected "NCXPath" to still be undefined'));
      epubContextInput.NCXPath = file;
      continue;
    }
  }

  await generateContentOPF(contentBodyInput, epubContextInput, epubContextOutput, baseOutputPath);

  await generateTocXHTML(contentBodyInput, epubContextInput, epubContextOutput, baseOutputPath);
  await generateTocNCX(contentBodyInput, epubContextInput, epubContextOutput, baseOutputPath);

  const finishedEpubPath = await writeEpubFile(epubContextOutput, tmpdirOutputName, options);

  if (!utils.isNullOrUndefined(tmpdirInput)) {
    tmpdirInput.removeCallback();
  }
}

// LOCAL

/** Possible values for "epub:type" */
enum EPubType {
  Cover = 'cover',
  BackMatter = 'backmatter',
  BodyMatterChapter = 'bodymatter chapter',
}

/** Possible values for the img-class option */
enum ImgClass {
  Cover = 'cover',
  Insert = 'insert',
}

/** Context storing all important options */
interface EpubContext {
  /** Path to the "rootfile", relative to the root of the input file */
  ContentPath: string;
  /** Volume Title */
  Title: string;
  /** All files in the "content" */
  Files: EpubFile[];
  /** Path to the NCX Path, if existing */
  NCXPath?: string;
}

interface OutputEpubContext extends EpubContext {
  /** States of the numbering */
  LastStates: LastStates;
}

interface LastStates {
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

/**
 * Package all files to a EPUB+zip to the output directory
 * @param epubContextOutput EPUB Context of the Output file
 * @param baseOutputPath Base Output path to output files to
 * @param options The Options provided by the main file
 * @returns The Finished EPUB file Path
 */
async function writeEpubFile(
  epubContextOutput: OutputEpubContext,
  baseOutputPath: string,
  options: utils.ConverterOptions
): Promise<string> {
  const epubFilePath = path.resolve(options.converterOutputPath, `${epubContextOutput.Title}.epub`);
  const epubFilePathTMP = path.resolve(options.converterOutputPath, `.${epubContextOutput.Title}.epub.part`);
  await new Promise((res, rej) => {
    const zipfile = new yazl.ZipFile();
    const writeStream = createWriteStream(epubFilePathTMP);
    writeStream.once('close', res);
    writeStream.once('error', rej);
    zipfile.outputStream.once('error', rej);
    zipfile.outputStream.pipe(writeStream);

    // explicitly add the following files because they do not exist in "epubContextOutput.Files" and should be at the beginning according to the spec
    zipfile.addFile(path.resolve(baseOutputPath, 'mimetype'), 'mimetype');
    zipfile.addFile(path.resolve(baseOutputPath, 'META-INF/container.xml'), 'META-INF/container.xml');
    zipfile.addFile(path.resolve(baseOutputPath, epubContextOutput.ContentPath), 'OEBPS/content.opf');

    const OEBPSPath = path.resolve(baseOutputPath, path.dirname(epubContextOutput.ContentPath));

    for (const file of epubContextOutput.Files) {
      const filePath = path.resolve(OEBPSPath, file.Path);
      const relativePath = path.relative(OEBPSPath, filePath);
      zipfile.addFile(filePath, `OEBPS/${relativePath}`);
    }

    zipfile.end();
  });

  await fspromises.rename(epubFilePathTMP, epubFilePath);

  return epubFilePath;
}

/**
 * Generate a Content.opf file
 * @param documentOld The old Content.opf JSDOM "body" element
 * @param epubContextInput EPUB Context of the Input file
 * @param epubContextOutput EPUB Context of the Output file
 * @param baseOutputPath Base Output path to output files to
 */
async function generateContentOPF(
  documentOld: Document,
  epubContextInput: EpubContext,
  epubContextOutput: OutputEpubContext,
  baseOutputPath: string
) {
  const replacedOutputTemplate = CONTENTOPF_TEMPLATE;
  // set custom "contentType" to force it to output xhtml compliant html (like self-closing elements to have a "/")
  const currentDOM = new JSDOM(replacedOutputTemplate, { contentType: 'application/xml' });
  const documentNew = currentDOM.window.document;
  const packageElement = currentDOM.window.document.querySelector('package');

  utils.assertionDefined(packageElement, new Error('Expected "packageElement" to exist'));

  const metadataElementNew = packageElement.querySelector('metadata');
  const manifestElementNew = packageElement.querySelector('manifest');
  const spineElementNew = packageElement.querySelector('spine');

  utils.assertionDefined(metadataElementNew, new Error('Expected "metdataElementNew" to exist'));
  utils.assertionDefined(manifestElementNew, new Error('Expected "manifestElementNew" to exist'));
  utils.assertionDefined(spineElementNew, new Error('Expected "spineElementNew" to exist'));

  const metadataElementOld = documentOld.querySelector('metadata');
  const manifestElementOld = documentOld.querySelector('manifest');
  const spineElementOld = documentOld.querySelector('spine');

  utils.assertionDefined(metadataElementOld, new Error('Expected "metdataElementOld" to exist'));
  utils.assertionDefined(manifestElementOld, new Error('Expected "manifestElementOld" to exist'));
  utils.assertionDefined(spineElementOld, new Error('Expected "spineElementOld" to exist'));

  let creatorCount = 0;
  // copy metadata from old to new
  // using "children" to exclude text nodes
  for (const elem of Array.from(metadataElementOld.children)) {
    // special handling for "cover", just to be sure
    if (elem.localName === 'meta' && elem.getAttribute('name') === 'cover') {
      const coverImgId = epubContextOutput.Files.find((v) => v.Id.includes('cover') && v.MediaType != XHTML_MIMETYPE);
      utils.assertionDefined(coverImgId, new Error('Expected "coverImgId" to be defined'));
      const newCoverNode = documentNew.createElementNS(metadataElementNew.namespaceURI, 'meta');
      newCoverNode.setAttribute('name', 'cover');
      newCoverNode.setAttribute('content', coverImgId.Id);
      metadataElementNew.appendChild(newCoverNode);
      continue;
    }

    let newNode: Element | undefined = undefined;

    if (elem.tagName === 'dc:title') {
      newNode = documentNew.createElementNS(DC_XML_NAMESPACE, 'dc:title');
      utils.assertionDefined(elem.textContent, new Error('Expected "elem.textContent" to be defined'));
      newNode.appendChild(documentNew.createTextNode(elem.textContent));
    } else if (elem.tagName === 'dc:publisher') {
      newNode = documentNew.createElementNS(DC_XML_NAMESPACE, 'dc:publisher');
      utils.assertionDefined(elem.textContent, new Error('Expected "elem.textContent" to be defined'));
      newNode.appendChild(documentNew.createTextNode(elem.textContent));
    } else if (elem.tagName === 'dc:language') {
      newNode = documentNew.createElementNS(DC_XML_NAMESPACE, 'dc:language');
      utils.assertionDefined(elem.textContent, new Error('Expected "elem.textContent" to be defined'));
      newNode.appendChild(documentNew.createTextNode(elem.textContent));
    } else if (elem.tagName === 'dc:creator') {
      creatorCount += 1;
      newNode = documentNew.createElementNS(DC_XML_NAMESPACE, 'dc:creator');
      utils.assertionDefined(elem.textContent, new Error('Expected "elem.textContent" to be defined'));
      newNode.appendChild(documentNew.createTextNode(elem.textContent));
      newNode.setAttribute('id', `creator${creatorCount.toString().padStart(2, '0')}`);
    } else if (elem.tagName === 'dc:date') {
      newNode = documentNew.createElementNS(DC_XML_NAMESPACE, 'dc:date');
      utils.assertionDefined(elem.textContent, new Error('Expected "elem.textContent" to be defined'));
      newNode.appendChild(documentNew.createTextNode(elem.textContent));
    }

    if (!utils.isNullOrUndefined(newNode)) {
      metadataElementNew.appendChild(newNode);
    }
  }

  for (const elem of epubContextOutput.Files) {
    // ignore cover.xhtml
    // ignore toc.xhtml
    // ignore toc.ncx
    if (elem.Id === 'cover.xhtml' || elem.Id === 'toc.xhtml' || elem.Id === 'ncx') {
      continue;
    }

    const newNode = documentNew.createElementNS(OPF_XML_NAMESPACE, 'item');
    newNode.setAttribute('id', elem.Id);
    newNode.setAttribute('href', path.relative(baseOutputPath, elem.Path));
    newNode.setAttribute('media-type', elem.MediaType);
    manifestElementNew.appendChild(newNode);
  }

  /** spine of the old content.opf, sorted and as filename */
  const sortedOldSpine: string[] = [];

  {
    /** id-filename Map, stores "id" as key and "filename" as value */
    const manifestIdMap: Map<string, string> = new Map();

    // using "children" to exclude text nodes
    for (const elem of Array.from(manifestElementOld.children)) {
      // ignore all non-"item" elements
      if (elem.localName !== 'item') {
        continue;
      }

      const filename = elem.getAttribute('href');
      const id = elem.getAttribute('id');

      utils.assertionDefined(filename, new Error('Expected "filename" to be defined'));
      utils.assertionDefined(id, new Error('Expected "id" to be defined'));

      manifestIdMap.set(id, filename);
    }

    // using "children" to exclude text nodes
    for (const elem of Array.from(spineElementOld.children)) {
      // ignore all non-"itemref" elements
      if (elem.nodeName !== 'itemref') {
        continue;
      }

      const idref = elem.getAttribute('idref');
      utils.assertionDefined(idref, new Error('Expected "idref" to be defined'));

      const filename = manifestIdMap.get(idref);
      utils.assertionDefined(filename, new Error('Expected "filename" to be defined'));

      sortedOldSpine.push(filename);
    }
  }

  epubContextOutput.Files.sort((a, b) => {
    const aindex = sortedOldSpine.findIndex((v) => v === a.OriginalFilename);
    const bindex = sortedOldSpine.findIndex((v) => v === b.OriginalFilename);

    const comp = aindex - bindex;

    if (comp === 0) {
      return a.IndexInSequence - b.IndexInSequence;
    }

    return comp;
  });

  for (const file of epubContextOutput.Files) {
    // only add xhtml types to the spine
    if (file.MediaType !== XHTML_MIMETYPE) {
      continue;
    }
    // ignore cover, because it already exists in the template
    // ignore "toc.xhtml" in case it should already exist
    if (file.Id === 'cover' || file.Id === 'toc.xhtml') {
      continue;
    }

    const newNode = documentNew.createElementNS(spineElementNew.namespaceURI, 'itemref');
    newNode.setAttribute('idref', file.Id);
    spineElementNew.appendChild(newNode);
  }

  const serialized = currentDOM.serialize();

  const writtenpath = path.resolve(baseOutputPath, 'content.opf');
  await utils.mkdir(path.dirname(writtenpath));
  await fspromises.writeFile(writtenpath, serialized);
}

/**
 * Generate a Table Of Contents XHTML file
 *
 * Assumes "epubContextOutput.Files" is already sorted
 * @param documentOld The old Content.opf JSDOM "body" element
 * @param epubContextInput EPUB Context of the Input file
 * @param epubContextOutput EPUB Context of the Output file
 * @param baseOutputPath Base Output path to output files to
 */
async function generateTocXHTML(
  documentOld: Document,
  epubContextInput: EpubContext,
  epubContextOutput: OutputEpubContext,
  baseOutputPath: string
) {
  const replacedOutputTemplate = TOC_XHTML_TEMPLATE;
  // set custom "contentType" to force it to output xhtml compliant html (like self-closing elements to have a "/")
  const currentDOM = new JSDOM(replacedOutputTemplate, { contentType: XHTML_MIMETYPE });
  const documentNew = currentDOM.window.document;
  const olElement = documentNew.querySelector('body > nav > ol.none');

  utils.assertionDefined(olElement, new Error('Expected "olElement" to exist'));

  const filesToLoop = epubContextOutput.Files.filter((v) => v.Main);

  for (const file of filesToLoop) {
    const liElement = documentNew.createElement('li');
    const aElement = documentNew.createElement('a');
    aElement.setAttribute('href', path.join('..', path.relative(baseOutputPath, file.Path)));
    utils.assertionDefined(file.Title, new Error(`Expected Main file to have a Title (outpath: "${file.Path}")`));
    aElement.appendChild(documentNew.createTextNode(file.Title.fullTitle));
    liElement.appendChild(aElement);
    olElement.appendChild(liElement);
  }

  const xhtmlName = 'toc.xhtml';
  await finishDOMtoFile(currentDOM, baseOutputPath, xhtmlName, FinishFileSubDir.Text, epubContextOutput, {
    Id: xhtmlName,
    IndexInSequence: 0,
    Main: true,
    OriginalFilename: '',
    Title: {
      fullTitle: 'Table Of Contents',
    },
  });
}

/**
 * Generate a Table Of Contents NCX file
 * @param documentOld The old Content.opf JSDOM "body" element
 * @param epubContextInput EPUB Context of the Input file
 * @param epubContextOutput EPUB Context of the Output file
 * @param baseOutputPath Base Output path to output files to
 */
async function generateTocNCX(
  documentOld: Document,
  epubContextInput: EpubContext,
  epubContextOutput: OutputEpubContext,
  baseOutputPath: string
) {
  const replacedOutputTemplate = TOC_NCX_TEMPLATE.replaceAll('{{TITLE}}', epubContextOutput.Title);
  // set custom "contentType" to force it to output xhtml compliant html (like self-closing elements to have a "/")
  const currentDOM = new JSDOM(replacedOutputTemplate, { contentType: XML_MIMETYPE });
  const documentNew = currentDOM.window.document;
  const navMapElement = documentNew.querySelector('ncx > navMap');

  utils.assertionDefined(navMapElement, new Error('Expected "navMapElement" to exist'));

  const filesToLoop = epubContextOutput.Files.filter((v) => v.Main);

  let currentpoint = 0;

  for (const file of filesToLoop) {
    utils.assertionDefined(file.Title, new Error(`Expected Main file to have a Title (outpath: "${file.Path}")`));
    currentpoint += 1;

    const navpointElement = documentNew.createElementNS(NCX_XML_NAMESPACE, 'navPoint');
    const navlabelElement = documentNew.createElementNS(NCX_XML_NAMESPACE, 'navLabel');
    const textElement = documentNew.createElementNS(NCX_XML_NAMESPACE, 'text');
    const contentElement = documentNew.createElementNS(NCX_XML_NAMESPACE, 'content');

    textElement.appendChild(documentNew.createTextNode(file.Title.fullTitle));
    navpointElement.setAttribute('id', `navPoint${currentpoint}`);
    navpointElement.setAttribute('playOrder', currentpoint.toString());
    contentElement.setAttribute('src', path.relative(baseOutputPath, file.Path));

    navlabelElement.appendChild(textElement);
    navpointElement.appendChild(navlabelElement);
    navpointElement.appendChild(contentElement);

    navMapElement.appendChild(navpointElement);
  }

  const filename = 'toc.ncx';
  const outPath = path.resolve(baseOutputPath, filename);
  await utils.mkdir(baseOutputPath);
  await fspromises.writeFile(outPath, currentDOM.serialize());
  epubContextOutput.Files.push({
    Id: filename,
    IndexInSequence: 0,
    Main: false,
    OriginalFilename: '',
    Path: outPath,
    MediaType: 'application/x-dtbncx+xml',
  });
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
async function getEpubContextForInput(usePath: string): Promise<{ context: EpubContext; contentBody: Document }> {
  const containerBuffer = await fspromises.readFile(path.resolve(usePath, 'META-INF/container.xml'));
  const container = new JSDOM(containerBuffer, { contentType: XML_MIMETYPE });
  const containerBody = container.window.document;

  const contentPathNode = containerBody.querySelector('container > rootfiles > rootfile');

  utils.assertionDefined(contentPathNode, new Error('Expected "contentPathNode" to be defined'));

  const contentPath = contentPathNode.getAttribute('full-path');

  utils.assertionDefined(contentPath, new Error('Expected "contentPath" to be defined'));

  const contentBuffer = await fspromises.readFile(path.resolve(usePath, contentPath));
  const content = new JSDOM(contentBuffer, { contentType: XML_MIMETYPE });
  const contentBody = content.window.document;

  const titleNode = contentBody.querySelector('package > metadata > dc\\:title');

  utils.assertionDefined(titleNode, new Error('Expected "titleNode" to be defined'));

  const volumeTitle = titleNode.textContent;

  utils.assertionDefined(volumeTitle, new Error('Expected "volumeTitle" to be defined'));

  const context: EpubContext = {
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
async function processHTMLFile(
  filePath: string,
  epubContextInput: EpubContext,
  epubContextOutput: OutputEpubContext,
  baseOutputPath: string
): Promise<void> {
  const loadedFile = await fspromises.readFile(filePath);
  const parsedInput = new JSDOM(loadedFile, { contentType: XHTML_MIMETYPE });
  const documentInput = parsedInput.window.document;

  const title = getTitle(documentInput.title);

  // ignore the TOC, because a new one will be generated
  if (title.fullTitle.toLowerCase() === 'table of contents') {
    return;
  }

  // ignore everything that matches the regex
  if (new RegExp(TITLES_TO_FILTER_OUT_REGEX).test(title.fullTitle)) {
    return;
  }

  // const currentBaseName = '';
  switch (title.titleType) {
    case TitleType.CoverPage:
      await doCoverPage(documentInput, title, epubContextInput, epubContextOutput, baseOutputPath, filePath);
      break;
    case TitleType.Afterword:
      await doAfterword(documentInput, title, epubContextInput, epubContextOutput, baseOutputPath, filePath);
      break;
    case TitleType.TitlePage:
    case TitleType.ColorInserts:
    case TitleType.CopyrightsAndCredits:
    case TitleType.TocImage:
    case TitleType.CastOfCharacters:
      await doFrontMatter(documentInput, title, epubContextInput, epubContextOutput, baseOutputPath, filePath);
      break;
    case TitleType.BonusStory:
      await doBonusStory(documentInput, title, epubContextInput, epubContextOutput, baseOutputPath, filePath);
      break;
    case TitleType.ShortStory:
      await doShortStory(documentInput, title, epubContextInput, epubContextOutput, baseOutputPath, filePath);
      break;
    case TitleType.SideStory:
      await doSideStory(documentInput, title, epubContextInput, epubContextOutput, baseOutputPath, filePath);
      break;
    case TitleType.Chapter:
      await doChapter(documentInput, title, epubContextInput, epubContextOutput, baseOutputPath, filePath);
      break;
    case TitleType.Interlude:
      await doInterlude(documentInput, title, epubContextInput, epubContextOutput, baseOutputPath, filePath);
      break;
    // the following will use the generic target
    case TitleType.Dedication:
    case TitleType.NamedSideStory:
      await doGeneric(documentInput, title, epubContextInput, epubContextOutput, baseOutputPath, filePath, 0);
      break;
    case TitleType.Previously:
    case TitleType.AboutAuthorAndIllust:
      await doGeneric(documentInput, title, epubContextInput, epubContextOutput, baseOutputPath, filePath);
      break;
    default:
      log(`Unhandled Type \"${title.titleType}\" + "${title.fullTitle}"`.red);
      await doGeneric(documentInput, title, epubContextInput, epubContextOutput, baseOutputPath, filePath, 0);
      break;
  }
}

interface IcreateMAINDOM {
  currentDOM: JSDOM;
  documentNew: Document;
  mainElement: Element;
}

/**
 * Create a dom from the MAIN_BODY_TEMPLATE template easily
 * @param title The Title object
 * @param sectionid The id of the "section" element
 * @returns The DOM, document and mainelement
 */
function createMAINDOM(title: Title, sectionid: string): IcreateMAINDOM {
  const replacedOutputTemplate = MAIN_BODY_TEMPLATE.replaceAll('{{TITLE}}', title.fullTitle)
    .replaceAll('{{SECTIONID}}', sectionid)
    .replaceAll('{{EPUBTYPE}}', EPubType.BodyMatterChapter);
  // set custom "contentType" to force it to output xhtml compliant html (like self-closing elements to have a "/")
  const currentDOM = new JSDOM(replacedOutputTemplate, { contentType: XHTML_MIMETYPE });
  const documentNew = currentDOM.window.document;
  const mainElement = documentNew.body.querySelector('div.main');

  utils.assertionDefined(mainElement, new Error('Expected "mainElement" to exist'));

  return {
    currentDOM,
    documentNew,
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
function createIMGDOM(title: Title, sectionid: string, imgclass: ImgClass, imgsrc: string): IcreateMAINDOM {
  const replacedOutputTemplate = JUST_IMAGE_TEMPLATE.replaceAll('{{TITLE}}', title.fullTitle)
    .replaceAll('{{SECTIONID}}', sectionid)
    .replaceAll('{{EPUBTYPE}}', EPubType.BodyMatterChapter)
    .replaceAll('{{IMGALT}}', sectionid)
    .replaceAll('{{IMGCLASS}}', imgclass)
    .replaceAll('{{IMGSRC}}', imgsrc);
  // set custom "contentType" to force it to output xhtml compliant html (like self-closing elements to have a "/")
  const currentDOM = new JSDOM(replacedOutputTemplate, { contentType: XHTML_MIMETYPE });
  const documentNew = currentDOM.window.document;
  const sectionElement = documentNew.body.querySelector('section');

  utils.assertionDefined(sectionElement, new Error('Expected "sectionElement" to exist'));

  return {
    currentDOM,
    documentNew,
    mainElement: sectionElement,
  };
}

enum FinishFileSubDir {
  Text = 'Text',
  Images = 'Images',
  Styles = 'Styles',
}

/**
 * Serialize a DOM into a file consistently
 * @param dom The DOM to save
 * @param basePath The base path to output files to
 * @param filename The name of the file (including extension)
 * @param subdir The Subdirectory to store the file in
 * @returns The Path the file was saved in
 */
async function finishDOMtoFile(
  dom: JSDOM,
  basePath: string,
  filename: string,
  subdir: FinishFileSubDir,
  epubContextOutput: OutputEpubContext,
  epubfileOptions: Omit<EpubFile, 'MediaType' | 'Path'>
): Promise<string> {
  const serialized = dom.serialize();

  const writtenpath = path.resolve(basePath, subdir, filename);
  await utils.mkdir(path.dirname(writtenpath));
  await fspromises.writeFile(writtenpath, serialized);

  epubContextOutput.Files.push({
    ...epubfileOptions,
    // this function creates the path, so it will be added here
    Path: writtenpath,
    // ensure it is the XHTML mimetype, because this function only writes the dom to file
    MediaType: XHTML_MIMETYPE,
    // ensure only the basename is added, not the full path
    OriginalFilename: path.basename(epubfileOptions.OriginalFilename),
  });

  return writtenpath;
}

async function copyImage(
  fromPath: string,
  basePath: string,
  epubContextOutput: OutputEpubContext,
  filename: string,
  epubfileOptions: Omit<EpubFile, 'MediaType' | 'Path'>
): Promise<string> {
  const writtenpath = path.resolve(basePath, FinishFileSubDir.Images, filename);
  await utils.mkdir(path.dirname(writtenpath));
  await fspromises.copyFile(fromPath, writtenpath);

  const mimetype = mime.lookup(filename) || undefined;

  utils.assertionDefined(mimetype, new Error('Expected "mimetype" to be defined'));

  epubContextOutput.Files.push({
    ...epubfileOptions,
    // this function creates the path, so it will be added here
    Path: writtenpath,
    // ensure it is the XHTML mimetype, because this function only writes the dom to file
    MediaType: mimetype,
    // ensure only the basename is added, not the full path
    OriginalFilename: path.basename(epubfileOptions.OriginalFilename),
  });

  return writtenpath;
}

/**
 * Handle everything related to the "Title.CoverPage" type
 * @param documentInput The Input Document's "document.body"
 * @param title The Title Object
 * @param epubContextInput EPUB Context of the Input file
 * @param epubContextOutput EPUB Context of the Output file
 * @param baseOutputPath Base Output path to output files to
 * @param currentInputFile Currently processing's Input file path
 */
async function doAfterword(
  documentInput: Document,
  title: Title,
  epubContextInput: EpubContext,
  epubContextOutput: OutputEpubContext,
  baseOutputPath: string,
  currentInputFile: string
): Promise<void> {
  // just to make sure that the type is defined and correctly assumed
  utils.assertion(title.titleType === TitleType.Afterword, new Error('Expected TitleType to be "Afterword"'));

  await doTextContent(documentInput, title, epubContextOutput, baseOutputPath, currentInputFile, {
    genID: function (lastStates: LastStates, subnum: number): string {
      let baseName = 'afterword';

      // only add a subnumber when a subnumber is required (not in the first of the chapter)
      if (subnum > 0) {
        baseName += `_${subnum}`;
      }

      return baseName;
    },
    genIMGID: function (lastStates: LastStates, inputimg: string): DoTextContentIMGID {
      epubContextOutput.LastStates.LastAfterwordNum += 1;
      const ext = path.extname(inputimg);
      const imgid = `afterword_img${epubContextOutput.LastStates.LastAfterwordNum}${ext}`;
      const imgfilename = `Afterword${epubContextOutput.LastStates.LastAfterwordNum}${ext}`;
      const xhtmlName = `afterword_img${epubContextOutput.LastStates.LastAfterwordNum}`;

      return {
        imgFilename: imgfilename,
        id: imgid,
        imgtype: ImgClass.Insert,
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
 * @param epubContextInput EPUB Context of the Input file
 * @param epubContextOutput EPUB Context of the Output file
 * @param baseOutputPath Base Output path to output files to
 * @param currentInputFile Currently processing's Input file path
 */
async function doCoverPage(
  documentInput: Document,
  title: Title,
  epubContextInput: EpubContext,
  epubContextOutput: OutputEpubContext,
  baseOutputPath: string,
  currentInputFile: string
): Promise<void> {
  // just to make sure that the type is defined and correctly assumed
  utils.assertion(title.titleType === TitleType.CoverPage, new Error('Expected TitleType to be "CoverPage"'));

  const imgNode = documentInput.querySelector('img');

  utils.assertionDefined(imgNode, new Error('Expected "imgNode" to be defined'));

  const imgNodeSrc = imgNode.src;

  const fromPath = path.resolve(path.dirname(currentInputFile), imgNodeSrc);
  const ext = path.extname(fromPath);
  const imgId = `cover${ext}`;
  const imgFilename = `Cover${ext}`;

  await copyImage(fromPath, baseOutputPath, epubContextOutput, imgFilename, {
    Id: imgId,
    OriginalFilename: fromPath,
    Main: false,
    IndexInSequence: 0,
  });
  const { currentDOM: imgDOM } = createIMGDOM(title, imgId, ImgClass.Cover, `../Images/${imgFilename}`);

  const xhtmlName = `cover.xhtml`;
  await finishDOMtoFile(imgDOM, baseOutputPath, xhtmlName, FinishFileSubDir.Text, epubContextOutput, {
    Id: xhtmlName,
    OriginalFilename: currentInputFile,
    Main: true,
    IndexInSequence: 0,
    Title: title,
  });
}

/**
 * Handle everything related to the Frontmatter Title types
 * @param documentInput The Input Document's "document.body"
 * @param title The Title Object
 * @param epubContextInput EPUB Context of the Input file
 * @param epubContextOutput EPUB Context of the Output file
 * @param baseOutputPath Base Output path to output files to
 * @param currentInputFile Currently processing's Input file path
 */
async function doFrontMatter(
  documentInput: Document,
  title: Title,
  epubContextInput: EpubContext,
  epubContextOutput: OutputEpubContext,
  baseOutputPath: string,
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

  const imgNodes = documentInput.querySelectorAll('img');

  utils.assertionDefined(imgNodes.length > 0, new Error('Expected "imgNode" to have members'));

  for (const elem of Array.from(imgNodes)) {
    epubContextOutput.LastStates.LastFrontNum += 1;

    /** Alias for better handling */
    const frontnum = epubContextOutput.LastStates.LastFrontNum;
    const imgNodeSrc = elem.src;

    const fromPath = path.resolve(path.dirname(currentInputFile), imgNodeSrc);
    const ext = path.extname(fromPath);
    const imgId = `frontmatter${frontnum}${ext}`;
    const imgFilename = `Frontmatter${frontnum}${ext}`;

    await copyImage(fromPath, baseOutputPath, epubContextOutput, imgFilename, {
      Id: imgId,
      OriginalFilename: fromPath,
      Main: false,
      IndexInSequence: 0,
    });
    const { currentDOM: imgDOM } = createIMGDOM(title, imgId, ImgClass.Insert, `../Images/${imgFilename}`);

    const isMain = epubContextOutput.Files.find((v) => v.Title === title);

    const xhtmlName = `frontmatter${frontnum}.xhtml`;
    await finishDOMtoFile(imgDOM, baseOutputPath, xhtmlName, FinishFileSubDir.Text, epubContextOutput, {
      Id: xhtmlName,
      OriginalFilename: currentInputFile,
      Main: utils.isNullOrUndefined(isMain),
      IndexInSequence: frontnum,
      Title: title,
    });
  }
}

/**
 * Handle everything related to the "Title.ShortStory" type
 * @param documentInput The Input Document's "document.body"
 * @param title The Title Object
 * @param epubContextInput EPUB Context of the Input file
 * @param epubContextOutput EPUB Context of the Output file
 * @param baseOutputPath Base Output path to output files to
 * @param currentInputFile Currently processing's Input file path
 */
async function doShortStory(
  documentInput: Document,
  title: Title,
  epubContextInput: EpubContext,
  epubContextOutput: OutputEpubContext,
  baseOutputPath: string,
  currentInputFile: string
): Promise<void> {
  // just to make sure that the type is defined and correctly assumed
  utils.assertion(title.titleType === TitleType.ShortStory, new Error('Expected TitleType to be "ShortStory"'));
  epubContextOutput.LastStates.LastShortStoryNum += 1;

  const bodyElement = documentInput.querySelector('body');
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

  await doTextContent(documentInput, title, epubContextOutput, baseOutputPath, currentInputFile, {
    genID: function (lastStates: LastStates, subnum: number): string {
      let baseName = 'shortstory' + epubContextOutput.LastStates.LastShortStoryNum;

      // only add a subnumber when a subnumber is required (not in the first of the chapter)
      if (subnum > 0) {
        baseName += `_${subnum}`;
      }

      return baseName;
    },
    genIMGID: function (lastStates: LastStates, inputimg: string): DoTextContentIMGID {
      epubContextOutput.LastStates.LastInsertNum += 1;
      const ext = path.extname(inputimg);
      const imgid = `insert${epubContextOutput.LastStates.LastInsertNum}${ext}`;
      const imgfilename = `Insert${epubContextOutput.LastStates.LastInsertNum}${ext}`;
      const xhtmlName = `insert${epubContextOutput.LastStates.LastInsertNum}`;

      return {
        imgFilename: imgfilename,
        id: imgid,
        imgtype: ImgClass.Insert,
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
 * @param epubContextInput EPUB Context of the Input file
 * @param epubContextOutput EPUB Context of the Output file
 * @param baseOutputPath Base Output path to output files to
 * @param currentInputFile Currently processing's Input file path
 */
async function doSideStory(
  documentInput: Document,
  title: Title,
  epubContextInput: EpubContext,
  epubContextOutput: OutputEpubContext,
  baseOutputPath: string,
  currentInputFile: string
): Promise<void> {
  // just to make sure that the type is defined and correctly assumed
  utils.assertion(title.titleType === TitleType.SideStory, new Error('Expected TitleType to be "SideStory"'));
  epubContextOutput.LastStates.LastSideStoryNum += 1;

  await doTextContent(documentInput, title, epubContextOutput, baseOutputPath, currentInputFile, {
    genID: function (lastStates: LastStates, subnum: number): string {
      let baseName = 'sidestory' + epubContextOutput.LastStates.LastSideStoryNum;

      // only add a subnumber when a subnumber is required (not in the first of the chapter)
      if (subnum > 0) {
        baseName += `_${subnum}`;
      }

      return baseName;
    },
    genIMGID: function (lastStates: LastStates, inputimg: string): DoTextContentIMGID {
      epubContextOutput.LastStates.LastInsertNum += 1;
      const ext = path.extname(inputimg);
      const imgid = `insert${epubContextOutput.LastStates.LastInsertNum}${ext}`;
      const imgfilename = `Insert${epubContextOutput.LastStates.LastInsertNum}${ext}`;
      const xhtmlName = `insert${epubContextOutput.LastStates.LastInsertNum}`;

      return {
        imgFilename: imgfilename,
        id: imgid,
        imgtype: ImgClass.Insert,
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
 * @param epubContextInput EPUB Context of the Input file
 * @param epubContextOutput EPUB Context of the Output file
 * @param baseOutputPath Base Output path to output files to
 * @param currentInputFile Currently processing's Input file path
 */
async function doBonusStory(
  documentInput: Document,
  title: Title,
  epubContextInput: EpubContext,
  epubContextOutput: OutputEpubContext,
  baseOutputPath: string,
  currentInputFile: string
): Promise<void> {
  // just to make sure that the type is defined and correctly assumed
  utils.assertion(title.titleType === TitleType.BonusStory, new Error('Expected TitleType to be "BonusStory"'));
  epubContextOutput.LastStates.LastBonusStoryNum += 1;

  await doTextContent(documentInput, title, epubContextOutput, baseOutputPath, currentInputFile, {
    genID: function (lastStates: LastStates, subnum: number): string {
      let baseName = 'bonusstory' + epubContextOutput.LastStates.LastBonusStoryNum;

      // only add a subnumber when a subnumber is required (not in the first of the chapter)
      if (subnum > 0) {
        baseName += `_${subnum}`;
      }

      return baseName;
    },
    genIMGID: function (lastStates: LastStates, inputimg: string): DoTextContentIMGID {
      epubContextOutput.LastStates.LastInsertNum += 1;
      const ext = path.extname(inputimg);
      const imgid = `insert${epubContextOutput.LastStates.LastInsertNum}${ext}`;
      const imgfilename = `Insert${epubContextOutput.LastStates.LastInsertNum}${ext}`;
      const xhtmlName = `insert${epubContextOutput.LastStates.LastInsertNum}`;

      return {
        imgFilename: imgfilename,
        id: imgid,
        imgtype: ImgClass.Insert,
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
 * @param epubContextInput EPUB Context of the Input file
 * @param epubContextOutput EPUB Context of the Output file
 * @param baseOutputPath Base Output path to output files to
 * @param currentInputFile Currently processing's Input file path
 */
async function doInterlude(
  documentInput: Document,
  title: Title,
  epubContextInput: EpubContext,
  epubContextOutput: OutputEpubContext,
  baseOutputPath: string,
  currentInputFile: string
): Promise<void> {
  // just to make sure that the type is defined and correctly assumed
  utils.assertion(title.titleType === TitleType.Interlude, new Error('Expected TitleType to be "Interlude"'));
  epubContextOutput.LastStates.LastInterludeNum += 1;

  await doTextContent(documentInput, title, epubContextOutput, baseOutputPath, currentInputFile, {
    genID: function (lastStates: LastStates, subnum: number): string {
      let baseName = 'interlude' + epubContextOutput.LastStates.LastInterludeNum;

      // only add a subnumber when a subnumber is required (not in the first of the chapter)
      if (subnum > 0) {
        baseName += `_${subnum}`;
      }

      return baseName;
    },
    genIMGID: function (lastStates: LastStates, inputimg: string): DoTextContentIMGID {
      epubContextOutput.LastStates.LastInsertNum += 1;
      const ext = path.extname(inputimg);
      const imgid = `insert${epubContextOutput.LastStates.LastInsertNum}${ext}`;
      const imgfilename = `Insert${epubContextOutput.LastStates.LastInsertNum}${ext}`;
      const xhtmlName = `insert${epubContextOutput.LastStates.LastInsertNum}`;

      return {
        imgFilename: imgfilename,
        id: imgid,
        imgtype: ImgClass.Insert,
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
 * @param epubContextInput EPUB Context of the Input file
 * @param epubContextOutput EPUB Context of the Output file
 * @param baseOutputPath Base Output path to output files to
 * @param currentInputFile Currently processing's Input file path
 */
async function doChapter(
  documentInput: Document,
  title: Title,
  epubContextInput: EpubContext,
  epubContextOutput: OutputEpubContext,
  baseOutputPath: string,
  currentInputFile: string
): Promise<void> {
  // just to make sure that the type is defined and correctly assumed
  utils.assertion(title.titleType === TitleType.Chapter, new Error('Expected TitleType to be "Chapter"'));
  epubContextOutput.LastStates.LastChapterNum += 1;

  await doTextContent(documentInput, title, epubContextOutput, baseOutputPath, currentInputFile, {
    genID: function (lastStates: LastStates, subnum: number): string {
      let baseName = 'chapter' + epubContextOutput.LastStates.LastChapterNum;

      // only add a subnumber when a subnumber is required (not in the first of the chapter)
      if (subnum > 0) {
        baseName += `_${subnum}`;
      }

      return baseName;
    },
    genIMGID: function (lastStates: LastStates, inputimg: string): DoTextContentIMGID {
      epubContextOutput.LastStates.LastInsertNum += 1;
      const ext = path.extname(inputimg);
      const imgid = `insert${epubContextOutput.LastStates.LastInsertNum}${ext}`;
      const imgfilename = `Insert${epubContextOutput.LastStates.LastInsertNum}${ext}`;
      const xhtmlName = `insert${epubContextOutput.LastStates.LastInsertNum}`;

      return {
        imgFilename: imgfilename,
        id: imgid,
        imgtype: ImgClass.Insert,
        xhtmlFilename: xhtmlName,
      };
    },
    genChapterElementContent: function (document: Document, title: Title, h1Element: HTMLHeadingElement): void {
      utils.assertionDefined(title.chapterNumber, new Error('Expected "title.chapterNumber" to be defined'));
      utils.assertionDefined(title.chapterTitle, new Error('Expected "title.chapterTitle" to be defined'));

      h1Element.appendChild(document.createTextNode(`Chapter ${title.chapterNumber}:`));
      h1Element.appendChild(document.createElementNS(XHTML_XML_NAMESPACE, 'br'));
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
 * @param epubContextInput EPUB Context of the Input file
 * @param epubContextOutput EPUB Context of the Output file
 * @param baseOutputPath Base Output path to output files to
 * @param currentInputFile Currently processing's Input file path
 * @param skipElements Set how many elements to initally skip
 */
async function doGeneric(
  documentInput: Document,
  title: Title,
  epubContextInput: EpubContext,
  epubContextOutput: OutputEpubContext,
  baseOutputPath: string,
  currentInputFile: string,
  skipElements?: number
): Promise<void> {
  // just to make sure that the type is defined and correctly assumed
  await doTextContent(documentInput, title, epubContextOutput, baseOutputPath, currentInputFile, {
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
      epubContextOutput.LastStates.LastGenericNum += 1;
      const ext = path.extname(inputimg);
      const imgid = `generic${epubContextOutput.LastStates.LastGenericNum}${ext}`;
      const imgfilename = `Generic${epubContextOutput.LastStates.LastGenericNum}${ext}`;
      const xhtmlName = `generic${epubContextOutput.LastStates.LastGenericNum}`;

      return {
        imgFilename: imgfilename,
        id: imgid,
        imgtype: ImgClass.Insert,
        xhtmlFilename: xhtmlName,
      };
    },
    genChapterElementContent: function (document: Document, title: Title, h1Element: HTMLHeadingElement): void {
      if (!utils.isNullOrUndefined(title.namedTitle) && !utils.isNullOrUndefined(title.chapterTitle)) {
        h1Element.appendChild(document.createTextNode(`${title.namedTitle}:`));
        h1Element.appendChild(document.createElementNS(XHTML_XML_NAMESPACE, 'br'));
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
  imgtype: ImgClass;
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
 * @param epubContextOutput EPUB Context of the Output file
 * @param baseOutputPath Base Output path to output files to
 * @param currentInputFile Currently processing's Input file path
 */
async function doTextContent(
  documentInput: Document,
  title: Title,
  epubContextOutput: OutputEpubContext,
  baseOutputPath: string,
  currentInputFile: string,
  options: DoTextContentOptions
): Promise<void> {
  let currentSubChapter = 0;
  let currentBaseName = options.genID(epubContextOutput.LastStates, currentSubChapter);

  let { currentDOM, documentNew, mainElement } = createMAINDOM(title, currentBaseName);

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
            await finishDOMtoFile(currentDOM, baseOutputPath, xhtmlNameMain, FinishFileSubDir.Text, epubContextOutput, {
              Id: xhtmlNameMain,
              OriginalFilename: currentInputFile,
              Main: currentSubChapter === 0 && sequenceCounter === 0,
              IndexInSequence: sequenceCounter,
              Title: title,
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
          } = options.genIMGID(epubContextOutput.LastStates, fromPath);

          await copyImage(fromPath, baseOutputPath, epubContextOutput, imgFilename, {
            Id: imgid,
            OriginalFilename: fromPath,
            Main: false,
            IndexInSequence: 0,
          });
          const { currentDOM: imgDOM } = createIMGDOM(title, imgid, imgtype, `../Images/${imgFilename}`);

          const xhtmlNameIMG = `${imgXHTMLFileName}.xhtml`;
          await finishDOMtoFile(imgDOM, baseOutputPath, xhtmlNameIMG, FinishFileSubDir.Text, epubContextOutput, {
            Id: xhtmlNameIMG,
            OriginalFilename: currentInputFile,
            Main: currentSubChapter === 0 && sequenceCounter === 0, // the image is the first page on first-page image chapaters (a image before the chapter header)
            Title: title,

            IndexInSequence: sequenceCounter,
          });
          sequenceCounter += 1;

          // dont create a new dom if the old one is still empty
          if (!skipSavingMainDOM) {
            currentBaseName = options.genID(epubContextOutput.LastStates, currentSubChapter);
            const nextchapter = createMAINDOM(title, currentBaseName);
            currentDOM = nextchapter.currentDOM;
            documentNew = nextchapter.documentNew;
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

    console.error(`unhandled localName: ${elem.localName}`.red);
  }

  if (!isElementEmpty(mainElement)) {
    const xhtmlNameMain = `${currentBaseName}.xhtml`;
    await finishDOMtoFile(currentDOM, baseOutputPath, xhtmlNameMain, FinishFileSubDir.Text, epubContextOutput, {
      Id: xhtmlNameMain,
      OriginalFilename: currentInputFile,
      Main: currentSubChapter === 0 && sequenceCounter === 0,
      IndexInSequence: sequenceCounter,
      Title: title,
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
    console.log('encountered unhandled nodeType:'.red, origNode.nodeType);

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

      console.log(`Unhandled Style found: \"${style}\"`.red);
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
