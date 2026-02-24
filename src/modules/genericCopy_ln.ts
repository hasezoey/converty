import * as utils from '../utils.js';
import { promises as fspromises } from 'fs';
import * as path from 'path';
import * as xh from '../helpers/xml.js';
import * as epubh from '../helpers/epub.js';
import { copyImage, finishEpubctx, STATICS, TextProcessingECOptions } from '../helpers/htmlTextProcessing.js';

/*
This is a module that does *not* apply the normal templates, but rather copies
content as-is over, with some slight modifications applied.
Current modifications:
- filter-out newsletter
- remove links that link to the toc (usually the title headers)
- restructure files into "Text", "Styles" and "Images" folders
*/

const log = utils.createNameSpace('genericCopy');

// STATIC OPTIONS
const VERIFIED_MATCH_LIST = [];
const INPUT_MATCH_REGEX = new RegExp(VERIFIED_MATCH_LIST.join('|'), 'i');
/** Regex of files to filter out (to not include in the output) */
const FILES_TO_FILTER_OUT_REGEX = /newsletter/gim;
/** Regex for detecting the series in the ContentOPF */
const SERIES_MATCH_REGEX = /^(?<series>.+?)((?: |, )?(?:Vol\.|Volume) (?<num>\d+)(?: \(light novel\))?)?$/im;
const STYLE_PATH = path.join(epubh.FileDir.Styles, 'stylesheet.css');

/** A TOC element in the original TOC.ncx */
class TOCElem {
  constructor(
    /** Title of the entry */
    public title: string,
    /** Path of the HTML file */
    public textPath: string
  ) {}
}

// CODE
// extends, because otherwise it would complain about types being not correct in a alias
class GenericCopyECOptions extends TextProcessingECOptions {
  /** The *input* cover file path */
  public coverInputPath?: string;
  /** Original order of TOC.ncx elements */
  public tocElements: TOCElem[];
}

// EXPORTS
export function matcher(name: string) {
  const ret = INPUT_MATCH_REGEX.test(name);
  // reset regex after use, because they have a state, seemingly even with "test"
  INPUT_MATCH_REGEX.lastIndex = 0;

  return ret;
}

export default function genericSevenSeas_ln(): utils.ConverterModule {
  return { matcher, process };
}

export async function process(options: utils.ConverterOptions): Promise<string> {
  const epubctxInput = await epubh.getInputContext(options.fileInputPath);

  const epubctxOutput = new epubh.EpubContext<GenericCopyECOptions>({
    title: epubctxInput.title,
    optionsClass: new GenericCopyECOptions(),
  });

  // check needs to be done, because it does not carry over from the function that defined it
  utils.assertionDefined(epubctxInput.customData, new Error('Expected "epubctxInput.customData" to be defined at this point'));
  const contentOPFInput = epubctxInput.customData.contentOPFDoc;

  await copyCoverImg(contentOPFInput, epubctxInput, epubctxOutput);

  await readTOC(contentOPFInput, epubctxInput, epubctxOutput);

  const stylesheetpath = path.resolve(epubctxOutput.contentOPFDir, STYLE_PATH);
  let done_style = false;

  for (const file of epubctxInput.files) {
    /** Alias to make it easier to handle */
    const filePath = file.filePath;

    if (new RegExp(FILES_TO_FILTER_OUT_REGEX).test(filePath)) {
      log(`Skipping file "${file.id}" because it is in the filter regex`);
      continue;
    }

    // skip "content.opf" file, because we re-generate it
    if (/\.opf/.test(filePath)) {
      continue;
    }
    // ignore all .ncx files (like toc.ncx), as we re-generate those
    if (/\.ncx/.test(filePath)) {
      continue;
    }
    // ignore toc XHTMLs as we re-generate those
    if (/^(?:toc|nav).xhtml$/.test(path.basename(filePath))) {
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
      if (done_style) {
        console.log(`Found more than 1 stylesheets, only one is supported, skipping. File: ${file.filePath}`.red);
        continue;
      }

      done_style = true;
      await utils.mkdir(path.dirname(stylesheetpath));
      await fspromises.writeFile(stylesheetpath, await fspromises.readFile(file.filePath));
      epubctxOutput.addFile(
        new epubh.EpubContextFileBase({
          id: 'stylesheet',
          mediaType: epubh.STATICS.CSS_MIMETYPE,
          filePath: stylesheetpath,
        })
      );
      continue;
    }
    if (file instanceof epubh.EpubContextFileXHTML) {
      await processHTMLFile(epubctxInput, epubctxOutput, file);
      continue;
    }

    console.error(`Unhandled "mimetype": ${mimetype}`.red, file);
  }

  function contentOPFHook({ document, idCounter, metadataElem }: Parameters<epubh.ContentOPFFn>[0]) {
    const packageElementOld = xh.queryDefinedElement(contentOPFInput, 'package');
    const metadataElementOld = xh.queryDefinedElement(contentOPFInput, 'metadata');

    const idCounterO: epubh.IdCounter = { c: idCounter };
    epubh.copyMetadata(document, Array.from(metadataElementOld.children), epubctxOutput, metadataElem, packageElementOld, idCounterO);

    // Regex to extract the series title and if available the volume position
    const caps = SERIES_MATCH_REGEX.exec(epubctxOutput.title);

    if (!utils.isNullOrUndefined(caps)) {
      const seriesTitleNoVolume = utils.regexMatchGroupRequired(caps, 'series', 'contentOPFHook meta collection');
      const seriesPos = utils.regexMatchGroup(caps, 'num');

      if (!seriesPos) {
        console.log('Failed to extra series position information!'.yellow);
      }

      epubh.applySeriesMetadata(document, metadataElem, idCounterO, {
        name: seriesTitleNoVolume,
        volume: seriesPos ?? '1',
      });
    } else {
      log('Found no series captures for: "'.red + epubctxOutput.title.grey + '"'.red);
    }
  }

  return await finishEpubctx(epubctxOutput, options, [epubctxInput], {
    contentOPF: contentOPFHook,
  });
}

/**
 * Process the given HTML file
 */
async function processHTMLFile(
  epubctxInput: epubh.EpubContext<epubh.BaseEpubOptions, epubh.InputEpubCustomData>,
  epubctxOutput: epubh.EpubContext<GenericCopyECOptions>,
  file: epubh.EpubContextFileXHTML
): Promise<void> {
  const loadedFile = await fspromises.readFile(file.filePath);
  const { document: documentInput, dom } = xh.newJSDOM(loadedFile, STATICS.JSDOM_XHTML_OPTIONS);

  await copyImages(documentInput, epubctxOutput, file);

  const title = extractTitle(documentInput, epubctxOutput, file);

  // determine type
  let useType: epubh.EpubContextNewFileXHTMLType = { type: epubh.EpubContextFileXHTMLTypes.TEXT };

  if (testForSingleImg(documentInput)) {
    const imgNode = documentInput.querySelector('body img')!;
    const src = imgNode.getAttribute('src');
    utils.assertionDefined(src, new Error('Expected attribute "src" to be defined on a img element'));

    // Due to "copyImages" run earlier, the src is already updated to point to the *ouput* cover path
    if (epubctxOutput.optionsClass.coverImgId === path.basename(src)) {
      useType = { type: epubh.EpubContextFileXHTMLTypes.IMG, imgClass: epubh.ImgClass.Cover, imgType: epubh.ImgType.Cover };
    } else {
      // TODO: more specific img types
      useType = { type: epubh.EpubContextFileXHTMLTypes.IMG, imgClass: epubh.ImgClass.Insert, imgType: epubh.ImgType.Frontmatter };
    }
  }

  removeTOCLinks(documentInput);
  removeAllProcessingInstructions(documentInput);
  updateStyleLocation(documentInput, epubctxOutput);

  const isMain = epubctxOutput.optionsClass.tocElements.findIndex((v) => v.textPath.endsWith(path.basename(file.filePath))) >= 0;

  // save dom to new location
  // trimDOM(mainElem);
  const xhtmlNameMain = `${file.id}.xhtml`;
  await epubh.finishDOMtoFile(dom, epubctxOutput.contentOPFDir, xhtmlNameMain, epubh.FileDir.Text, epubctxOutput, {
    id: xhtmlNameMain,
    seqIndex: isMain ? 0 : 1,
    title: title,
    type: useType,
    globalSeqIndex: epubctxOutput.optionsClass.getTracker('Global'),
  });
  epubctxOutput.optionsClass.incTracker('Global');
}

/**
 * Try to extract the title from various elements.
 * Falls back to series title in `epubctxOutput.title`
 * @param document The document to search and modify the title in
 * @param epubctxOutput The epubctx to take the title from as a fallback
 * @param file The current file for error reporting
 * @returns The found title
 */
function extractTitle(
  document: Document,
  epubctxOutput: epubh.EpubContext<GenericCopyECOptions>,
  file: epubh.EpubContextFileXHTML
): string {
  let title = epubctxOutput.title;

  const h1Elem = document.querySelector('h1');
  const titleElem = document.querySelector('head > title');
  const tocEntry = epubctxOutput.optionsClass.tocElements.find((v) => v.textPath.endsWith(path.basename(file.filePath)));

  if (h1Elem && h1Elem.textContent.trim().length > 0) {
    title = h1Elem.textContent.trim();
  } else if (!utils.isNullOrUndefined(tocEntry)) {
    title = tocEntry.title;
  } else if (titleElem) {
    title = titleElem.textContent.trim();
  } else {
    console.log(`Could not extract a proper type for ${file.filePath}`.yellow);
  }

  if (titleElem) {
    titleElem.textContent = title;
  } else {
    const head = xh.queryDefinedElement(document, 'head');
    const newTitle = document.createElement('title');
    newTitle.textContent = title;
    head.appendChild(newTitle);
  }

  return title;
}

/**
 * Read & store the input TOC
 * @param contentOPFInput The input OPF xml data
 * @param epubctxInput The Input epub context
 * @param epubctxOutput The output epub context
 */
async function readTOC(
  contentOPFInput: Document,
  epubctxInput: epubh.EpubContext<epubh.BaseEpubOptions, epubh.InputEpubCustomData>,
  epubctxOutput: epubh.EpubContext<GenericCopyECOptions>
) {
  const spineElementOld = xh.queryDefinedElement(contentOPFInput, 'spine');
  const manifestElementOld = xh.queryDefinedElement(contentOPFInput, 'manifest');

  const tocNCXId = spineElementOld.getAttribute('toc');
  utils.assertionDefined(tocNCXId, new Error(`Expected to find attribute "toc" on "spine"`));

  const tocNCXPath = xh.queryDefinedElement(manifestElementOld, `item[id="${tocNCXId}"]`).getAttribute('href');
  utils.assertionDefined(tocNCXPath, new Error(`Expected to find attribute "href" in "manifest > item[id="${tocNCXId}"]`));

  const loadedFile = await fspromises.readFile(path.resolve(epubctxInput.contentOPFDir, tocNCXPath));
  const { document: ncxDoc } = xh.newJSDOM(loadedFile, STATICS.JSDOM_XHTML_OPTIONS);

  const navMap = xh.queryDefinedElement(ncxDoc, 'navMap');

  const tocElements: [TOCElem, number][] = [];

  for (const navpoint of navMap.children) {
    const title = xh.queryDefinedElement(navpoint, 'text');
    const tocPath = xh.queryDefinedElement(navpoint, 'content').getAttribute('src');
    utils.assertionDefined(tocPath, new Error('Expected "content" to have attribute "src"'));
    const playorder = navpoint.getAttribute('playOrder');
    utils.assertionDefined(playorder, new Error('Expected "navPoint" to have attribute "playOrder"'));
    const playorderInt = parseInt(playorder);

    const tocelem = new TOCElem(title.textContent, tocPath);
    tocElements.push([tocelem, playorderInt]);
  }

  tocElements.sort((a, b) => a[1] - b[1]);

  epubctxOutput.optionsClass.tocElements = tocElements.map((v) => v[0]);
}

/**
 * Find and copy over the cover image
 * @param contentOPFInput The input OPF xml data
 * @param epubctxInput The Input epub context
 * @param epubctxOutput The output epub context
 */
async function copyCoverImg(
  contentOPFInput: Document,
  epubctxInput: epubh.EpubContext<epubh.BaseEpubOptions, epubh.InputEpubCustomData>,
  epubctxOutput: epubh.EpubContext<GenericCopyECOptions>
) {
  const metadataElementOld = xh.queryDefinedElement(contentOPFInput, 'metadata');
  const manifestElementOld = xh.queryDefinedElement(contentOPFInput, 'manifest');

  const coverId = xh.queryDefinedElement(metadataElementOld, 'meta[name="cover"]').getAttribute('content');
  utils.assertionDefined(coverId, new Error(`Expected to find attribute "content" in "metadata > meta[name="cover"]`));
  const coverImg = xh.queryDefinedElement(manifestElementOld, `item[id="${coverId}"]`).getAttribute('href');
  utils.assertionDefined(coverImg, new Error(`Expected to find attribute "href" in "manifest > item[id="${coverId}"]`));

  const ext = path.extname(coverImg);
  const coverOutName = `cover${ext}`;
  await copyImage(path.resolve(epubctxInput.contentOPFDir, coverImg), epubctxOutput, coverOutName, coverOutName);
  epubctxOutput.optionsClass.coverImgId = coverOutName;
  epubctxOutput.optionsClass.coverInputPath = coverImg;
}

/**
 * Go through the body of the document, and see if the only element is a img (excluding containers)
 * @param document The document to check
 * @returns "true" if the only element (excluding containers) is a image, "false" otherwise
 */
function testForSingleImg(document: Document): boolean {
  let currentElem: Element | null | undefined = document.querySelector('body');

  while ((currentElem = currentElem?.firstElementChild)) {
    // short-circuit as we now know there are more than expected elements
    if (currentElem.childElementCount > 1) {
      return false;
    }

    if (currentElem.nodeName === 'img') {
      return true;
    }
  }

  return false;
}

/**
 * Copy all images from the input document to the output epubctx
 * @param document The document to got through for all images
 * @param epubctxOutput The Epub context to copy into
 * @param file The current document's file data
 */
async function copyImages(document: Document, epubctxOutput: epubh.EpubContext<GenericCopyECOptions>, file: epubh.EpubContextFileXHTML) {
  for (const imgElem of document.querySelectorAll('img')) {
    const imgPathRel = imgElem.src;
    const imgPath = path.resolve(path.dirname(file.filePath), imgPathRel);
    const basename = path.basename(imgPath);
    let resolveName = basename;

    // cover is handled by "copyCoverImg"
    if (epubctxOutput.optionsClass.coverInputPath!.endsWith(basename)) {
      resolveName = epubctxOutput.optionsClass.coverImgId!;
    }

    if (!(await utils.pathExists(imgPath))) {
      console.log(`Image path does not exist: ${imgPath}`.red);
      continue;
    }

    const imgOutPath = path.resolve(epubctxOutput.contentOPFDir, epubh.FileDir.Images, resolveName);

    // ignore it if files already exist, for example cover is likely already copied. Also for inline elements, which might be common
    if (!(await utils.pathExists(imgOutPath))) {
      await copyImage(imgPath, epubctxOutput, basename, basename);
    }

    const textPath = path.resolve(epubctxOutput.contentOPFDir, epubh.FileDir.Text);
    const relative = path.relative(textPath, imgOutPath);
    imgElem.src = relative;
  }
}

/**
 * Remove all Processing Instructions from the document, like `HBG-PAGE-NUMBER`
 * @param document The document to remove all PI from
 */
function removeAllProcessingInstructions(document: Document) {
  const iter = document.createNodeIterator(document.documentElement, document.defaultView!.NodeFilter.SHOW_PROCESSING_INSTRUCTION);
  let currentNode: Node | null;

  while ((currentNode = iter.nextNode())) {
    if (currentNode.parentElement === currentNode.parentNode) {
      currentNode.parentElement?.removeChild(currentNode);
    }
  }
}

/**
 * Update the stylesheet location path to our updated path
 * @param document The document to update the style location in
 */
function updateStyleLocation(document: Document, epubctxOutput: epubh.EpubContext<GenericCopyECOptions>) {
  const linkElem = document.querySelector('head > link[rel="stylesheet"]') as HTMLLinkElement | undefined;
  const textpath = path.resolve(epubctxOutput.contentOPFDir, epubh.FileDir.Text);
  const styleRel = path.relative(textpath, path.join(epubctxOutput.contentOPFDir, STYLE_PATH));

  if (!utils.isNullOrUndefined(linkElem)) {
    linkElem.href = styleRel;
  } else {
    log('Style link element not found, inserting one');

    const linkElem = document.createElement('link');
    linkElem.href = styleRel;
    linkElem.type = 'text/css';
    const headElem = xh.queryDefinedElement(document, 'head');
    headElem.appendChild(linkElem);
  }
}

/**
 * Remove all links which point to the TOC
 * @param document The document to go through
 */
function removeTOCLinks(document: Document) {
  for (const _aElem of document.querySelectorAll('body a')) {
    const aElem = _aElem as HTMLAnchorElement;

    if (/(toc|nav).*xhtml/i.test(aElem.href)) {
      const parentNode = aElem.parentNode!;
      // this has to be outside of "for..of" due to showhow stopping the iteration after the first element
      const nodes = Array.from(aElem.childNodes);
      for (const child of nodes) {
        parentNode.insertBefore(child, aElem);
      }

      if (aElem.hasChildNodes()) {
        throw new Error('Failed to move nodes from "a" element?');
      }

      aElem.remove();
    }
  }
}
