import * as utils from '../utils.js';
import * as xh from './xml.js';
import * as sh from './string.js';
import * as tmp from 'tmp';
import * as path from 'path';
import { applyTemplate, getTemplate } from './template.js';
import { createWriteStream, promises as fspromises } from 'fs';
import { JSDOM } from 'jsdom';
import yazl from 'yazl';
import yauzl from 'yauzl';
import * as mime from 'mime-types';

const log = utils.createNameSpace('epubHelpers');

/**
 * A file in the epub, which can be anything except XHTML (like stylesheets and raw images)
 */
export class EpubContextFileBase {
  /** The id to use for the file in the EPub */
  public readonly id: string;
  /**
   * The Output Path of the file absolute file
   * also used as the final file destination later relatively resolved to the contentOPF
   */
  public readonly filePath: string;
  /** The mime-type of the File */
  public readonly mediaType: string;
  /** Field to store custom data for caching for a specific file (like a spineIndex) */
  public customData?: Record<string, any>;

  constructor(input: { id: string; mediaType: string; filePath: string }) {
    this.id = input.id;
    this.mediaType = input.mediaType;
    this.filePath = input.filePath;
  }
}

/**
 * The type the image is meant to be
 */
export enum ImgClass {
  Cover = 'cover',
  Insert = 'insert',
}

export enum ImgType {
  Cover,
  Frontmatter,
  Backmatter,
  Insert,
}

export enum EpubContextFileXHTMLTypes {
  IMG,
  TEXT,
  CREDITS,
  TOC,
}

export interface EpubContextFileXHTMLImgType {
  type: EpubContextFileXHTMLTypes.IMG;
  imgClass: ImgClass;
  imgType: ImgType;
}

export interface EpubContextFileXHTMLCreditsType {
  type: EpubContextFileXHTMLTypes.CREDITS;
}

export interface EpubContextFileXHTMLTextType {
  type: EpubContextFileXHTMLTypes.TEXT;
}

export interface EpubContextFileXHTMLTocType {
  type: EpubContextFileXHTMLTypes.TOC;
}

export type EpubContextNewFileXHTMLType =
  | EpubContextFileXHTMLImgType
  | EpubContextFileXHTMLCreditsType
  | EpubContextFileXHTMLTextType
  | EpubContextFileXHTMLTocType;

/**
 * A file in the epub, special for XHTML files (like actual text files, or image xhtml files)
 */
export class EpubContextFileXHTML extends EpubContextFileBase {
  /**
   * The Sequential index of this sequence
   * only has a meaning if there are multiple with the same title
   */
  public readonly seqIndex: number;
  /**
   * The Global Sequential index in the order the file should be listed in, multiple in the same sequence may have the same index and use "seqIndex"
   */
  public readonly globalSeqIndex: number;
  // /** Internal storage for "isMain" */
  // protected readonly _isMain: boolean;
  /** The title of the entry */
  public readonly title: string;
  /** The Specific type of the XHTML file */
  public readonly type: EpubContextNewFileXHTMLType;

  /** Get if this File is the main entry for a file sequence */
  get isMain() {
    return this.seqIndex === 0;
  }

  constructor(
    input: { title: string; type: EpubContextFileXHTML['type']; seqIndex: number; globalSeqIndex: number /* isMain: boolean */ } & Omit<
      ConstructorParameters<typeof EpubContextFileBase>[0],
      'mediaType'
    >
  ) {
    super({ ...input, mediaType: xh.STATICS.XHTML_MIMETYPE });
    this.title = input.title;
    this.type = input.type;

    if (input.seqIndex < 0) {
      throw new Error('seqIndex cannot be smaller than 0');
    }

    this.seqIndex = input.seqIndex;

    if (input.globalSeqIndex < 0) {
      throw new Error('globalSeqIndex cannot be smaller than 0');
    }

    this.globalSeqIndex = input.globalSeqIndex;
  }
}

export type EpubFile = EpubContextFileBase | EpubContextFileXHTML;

export class EpubContext<Trackers extends Record<string, number>, CustomData extends Record<string, any> = never> {
  /** The Tmpdir where the epub files are stored */
  protected readonly _tmpdir: tmp.DirResult;
  /** The Title of the Story */
  public readonly title: string;
  /** The Files of the Epub */
  protected _innerFiles: EpubFile[] = [];
  /** Tracker for sequence numbers */
  protected _tracker: Trackers;
  /** Custom Data to store in the ctx for use */
  public customData?: CustomData;
  /** The filename of the css-stylesheet to be used */
  public readonly cssFilename: string;

  constructor(input: { title: string; trackers: Trackers; customData?: CustomData; cssName?: string }) {
    this.title = input.title;

    this._tmpdir = tmp.dirSync({
      prefix: 'converty',
      unsafeCleanup: true,
    });
    log('Tempdir path:', this.rootDir);
    this._tracker = input.trackers;

    this.customData = input.customData ?? undefined;
    this.cssFilename = input.cssName ?? STATICS.DEFAULT_CSS_FILENAME;
  }

  /** Get all the trackers (get wrapper for "_tracker") */
  get tracker() {
    return this._tracker;
  }

  /** Get the working directory's root (tmpdir) */
  get rootDir() {
    return this._tmpdir.name;
  }

  /** Get the absolute path to where the content.opf file will be */
  get contentOPFPath() {
    return path.join(this.contentOPFDir, STATICS.CONTENTOPFPATH);
  }

  /** Get the absolute directory to where the content.opf file will be in */
  get contentOPFDir() {
    return path.resolve(this.rootDir, STATICS.ROOTPATH);
  }

  /** Get all currently registered files that will be included in the EPUB */
  get files() {
    return this._innerFiles;
  }

  /** Get the absolute path to the css style file */
  get cssPath() {
    return path.relative(this.contentOPFDir, path.resolve(this.contentOPFDir, FileDir.Styles, this.cssFilename));
  }

  /**
   * Add a file to the epub
   * @param file The file to be added
   */
  public addFile(file: EpubFile) {
    this._innerFiles.push(file);
  }

  /**
   * Sort the files array in-place for the content.opf spine
   */
  public sortFilesForSpine() {
    this._innerFiles.sort(sortContentSpine);
  }

  /**
   * Increment a tracker and return the new number
   * @param trackerType The Type to increment
   * @returns The incremented number
   */
  public incTracker(trackerType: keyof Trackers): number {
    // @ts-expect-error see https://github.com/microsoft/TypeScript/issues/51069
    this._tracker[trackerType] += 1;

    return this._tracker[trackerType];
  }

  /**
   * Generate and save the TOC-XHTML file
   * if one already exists, a new one will replace it
   */
  protected async generateTOCXHTML() {
    const foundIndex = this.files.findIndex((v) => v instanceof EpubContextFileXHTML && v.type.type === EpubContextFileXHTMLTypes.TOC);

    if (foundIndex !== -1) {
      log('Removing existing TOC-XHTML');
      this._innerFiles.splice(foundIndex, 1);
    }

    const containerBasePath = path.dirname(this.contentOPFPath);

    const modXHTML = applyTemplate(await getTemplate('toc.xhtml'), {
      '{{CSSPATH}}': path.join('..', this.cssPath),
      '{{TOC_XHTML_FILENAME}}': path.join(
        '..',
        path.relative(containerBasePath, path.resolve(containerBasePath, FileDir.Text, STATICS.TOCXHTMLPATH))
      ),
    });

    const { dom, document } = xh.newJSDOM(modXHTML, { contentType: xh.STATICS.XHTML_MIMETYPE });
    const listElem = xh.queryDefinedElement(document, 'body > nav > ol');

    for (const file of this.files) {
      // ignore non-xhtml files
      if (!(file instanceof EpubContextFileXHTML)) {
        continue;
      }
      // ignore non-main files
      if (!file.isMain) {
        continue;
      }

      const liElem = document.createElement('li');
      const aElem = document.createElement('a');
      aElem.setAttribute('href', path.join('..', path.relative(containerBasePath, file.filePath)));
      aElem.appendChild(document.createTextNode(file.title));

      liElem.appendChild(aElem);
      listElem.appendChild(liElem);
    }

    await finishDOMtoFile(dom, containerBasePath, STATICS.TOCXHTMLPATH, FileDir.Text, this, {
      id: STATICS.TOCXHTMLPATH,
      globalSeqIndex: 0, // will be moved to the place automatically
      seqIndex: 0,
      title: 'Table Of Contents',
      type: {
        type: EpubContextFileXHTMLTypes.TOC,
      },
    });
  }

  /**
   * Generate and save the TOC-NCX file
   * if one already exists, a new one will replace it
   */
  protected async generateTOCNCX() {
    const foundIndex = this.files.findIndex((v) => v.mediaType === xh.STATICS.NCX_MIMETYPE);

    if (foundIndex !== -1) {
      log('Removing existing TOC-NCX');
      this._innerFiles.splice(foundIndex, 1);
    }

    const containerBasePath = path.dirname(this.contentOPFPath);

    const modXML = applyTemplate(await getTemplate('toc.ncx'), {
      '{{TITLE}}': this.title,
    });

    const { dom, document } = xh.newJSDOM(modXML, { contentType: xh.STATICS.XML_MIMETYPE });
    const navMapElem = xh.queryDefinedElement(document, 'ncx > navMap');

    let currentPoint = 0;

    for (const file of this.files) {
      // ignore non-xhtml files
      if (!(file instanceof EpubContextFileXHTML)) {
        continue;
      }
      // ignore non-main files
      if (!file.isMain) {
        continue;
      }

      currentPoint += 1;

      const navpointElem = document.createElementNS(xh.STATICS.NCX_XML_NAMESPACE, 'navPoint');
      const navlabelElem = document.createElementNS(xh.STATICS.NCX_XML_NAMESPACE, 'navLabel');
      const textElem = document.createElementNS(xh.STATICS.NCX_XML_NAMESPACE, 'text');
      const contentElem = document.createElementNS(xh.STATICS.NCX_XML_NAMESPACE, 'content');

      textElem.appendChild(document.createTextNode(file.title));
      navpointElem.setAttribute('id', `navPoint${currentPoint}`);
      navpointElem.setAttribute('playOrder', currentPoint.toString());
      contentElem.setAttribute('src', path.relative(containerBasePath, file.filePath));

      navlabelElem.appendChild(textElem);
      navpointElem.appendChild(navlabelElem);
      navpointElem.appendChild(contentElem);

      navMapElem.appendChild(navpointElem);
    }

    const outpath = path.resolve(containerBasePath, STATICS.TOCNCXPATH);
    await utils.mkdir(containerBasePath);
    await fspromises.writeFile(outpath, `${xh.STATICS.XML_BEGINNING_OP}\n` + dom.serialize());
    this.addFile(
      new EpubContextFileBase({
        id: STATICS.TOCNCXPATH,
        mediaType: xh.STATICS.NCX_MIMETYPE,
        filePath: outpath,
      })
    );
  }

  /**
   * Generate and save the content.opf file
   * if one already exists, a new one will replace it
   * @param hookfn A function to execute before finishing the content.opf, can be used to tranfer more metadata than default
   */
  protected async generateContentOPF(hookfn?: ContentOPFFn) {
    const modXML = applyTemplate(await getTemplate('content.opf'), {
      '{{TOC_XHTML_FILENAME}}': STATICS.TOCXHTMLPATH,
    });

    const { dom, document } = xh.newJSDOM(modXML, { contentType: xh.STATICS.XML_MIMETYPE });

    const metadataElem = xh.queryDefinedElement(document, 'metadata');
    const manifestElem = xh.queryDefinedElement(document, 'manifest');
    const spineElem = xh.queryDefinedElement(document, 'spine');

    const idCounter = 0;

    // add default metadata
    {
      const titleNode = document.createElementNS(xh.STATICS.DC_XML_NAMESPACE, 'dc:title');
      titleNode.appendChild(document.createTextNode(this.title));
      metadataElem.appendChild(titleNode);
    }

    // set the NCX toc to use
    spineElem.setAttribute('toc', STATICS.TOCNCXPATH);

    // add all files to the manifest
    for (const file of this.files) {
      const newElem = document.createElementNS(xh.STATICS.OPF_XML_NAMESPACE, 'item');
      xh.applyAttributes(newElem, {
        id: file.id,
        href: path.relative(path.dirname(this.contentOPFPath), file.filePath),
        'media-type': file.mediaType,
      });

      if (file.id === STATICS.TOCXHTMLPATH) {
        newElem.setAttribute('properties', 'nav');
      }

      manifestElem.appendChild(newElem);
    }

    // generate the spine (play-order)
    for (const file of this.files) {
      // ignore non-xhtml files
      if (!(file instanceof EpubContextFileXHTML)) {
        continue;
      }

      const newElem = document.createElementNS(spineElem.namespaceURI, 'itemref');
      newElem.setAttribute('idref', file.id);
      spineElem.appendChild(newElem);
    }

    // execute the hook function if it exists
    if (!utils.isNullOrUndefined(hookfn)) {
      if (typeof hookfn !== 'function') {
        throw new Error(`HookFn was defined but was not a function, type was: "${typeof hookfn}"`);
      }

      hookfn({
        document,
        idCounter,
        metadataElem,
        manifestElem,
        spineElem,
      });
    }

    const serialized = `${xh.STATICS.XML_BEGINNING_OP}\n` + dom.serialize();
    const writtenPath = this.contentOPFPath;

    {
      const stat = await utils.statPath(writtenPath);

      if (!utils.isNullOrUndefined(stat)) {
        log('"content.opf" already existed and will be overwritten', writtenPath);
      }
    }

    await utils.mkdir(path.dirname(writtenPath));
    await fspromises.writeFile(writtenPath, serialized);
  }

  /**
   * Generate the TOC, NCX, and finialize the content.opf and save to a epub.zip
   * @param hooks Define Hooks for the generator functions
   */
  public async finish(hooks?: { contentOPF: ContentOPFFn }): Promise<string> {
    log('Starting to finish epub');

    this.sortFilesForSpine();

    await this.generateTOCXHTML();
    await this.generateTOCNCX();

    this.sortFilesForSpine(); // sort again because a file got added

    await this.generateContentOPF(hooks?.contentOPF);

    const epubFileName = path.resolve(this.rootDir, sh.stringToFilename(this.title) + '.epub');
    const epubFileNamePart = epubFileName + '.part';
    const containerXMLFile = await getTemplate('container.xml');

    await new Promise((res, rej) => {
      const zipfile = new yazl.ZipFile();
      const writeStream = createWriteStream(epubFileNamePart);
      writeStream.once('close', res);
      writeStream.once('error', rej);
      zipfile.outputStream.once('error', rej);
      zipfile.outputStream.pipe(writeStream);

      // explicitly add the following files manually
      zipfile.addBuffer(Buffer.from(STATICS.EPUB_MIMETYPE), 'mimetype');
      zipfile.addBuffer(Buffer.from(containerXMLFile), `META-INF/container.xml`);
      zipfile.addFile(this.contentOPFPath, `${STATICS.ROOTPATH}/${STATICS.CONTENTOPFPATH}`);

      const containerPath = path.dirname(this.contentOPFPath);

      for (const file of this.files) {
        const filePath = path.resolve(containerPath, file.filePath);
        const relativePath = path.relative(containerPath, filePath);
        zipfile.addFile(filePath, `${STATICS.ROOTPATH}/${relativePath}`);
      }

      zipfile.end();
    });

    await fspromises.rename(epubFileNamePart, epubFileName);

    return epubFileName;
  }
}

/** Hook Function Definition for generating the contentOPF */
export type ContentOPFFn = (t: {
  document: Document;
  idCounter: number;
  metadataElem: Element;
  manifestElem: Element;
  spineElem: Element;
}) => void;

/**
 * Sort function for sorting the content.opf spine {@link generateContentOPF}
 * @param a A Element
 * @param b B Element
 * @returns Sort order
 */
function sortContentSpine(a: EpubFile, b: EpubFile) {
  // ignore all non-xhtml files and move them to the front (before cover xhtml), they will be ignored for the spine and toc generation
  if (!(a instanceof EpubContextFileXHTML)) {
    // cannot be 0, otherwise other sorting will not apply correctly
    return -1;
  }
  if (!(b instanceof EpubContextFileXHTML)) {
    // cannot be 0, otherwise other sorting will not apply correctly
    return 1;
  }

  // handle special cases, special order - do not reorder, otherwise the order will break
  {
    // move cover to the front
    if (a.type.type === EpubContextFileXHTMLTypes.IMG && a.type.imgType === ImgType.Cover) {
      return -1;
    }
    if (b.type.type === EpubContextFileXHTMLTypes.IMG && b.type.imgType === ImgType.Cover) {
      return 1;
    }
    // move credits to the end
    if (a.type.type === EpubContextFileXHTMLTypes.CREDITS) {
      return 1;
    }
    if (b.type.type === EpubContextFileXHTMLTypes.CREDITS) {
      return -1;
    }
    // move TOC to the front (after COVER)
    if (a.type.type === EpubContextFileXHTMLTypes.TOC) {
      return -1;
    }
    if (b.type.type === EpubContextFileXHTMLTypes.TOC) {
      return 1;
    }
    // move frontmatter to the front
    if (a.type.type === EpubContextFileXHTMLTypes.IMG && a.type.imgType === ImgType.Frontmatter) {
      if (b.type.type === EpubContextFileXHTMLTypes.IMG && b.type.imgType === ImgType.Frontmatter) {
        return a.globalSeqIndex - b.globalSeqIndex;
      }

      return -1;
    }
    if (b.type.type === EpubContextFileXHTMLTypes.IMG && b.type.imgType === ImgType.Frontmatter) {
      if (a.type.type === EpubContextFileXHTMLTypes.IMG && a.type.imgType === ImgType.Frontmatter) {
        return a.globalSeqIndex - b.globalSeqIndex;
      }

      return 1;
    }
    // move backmatter to the back
    if (a.type.type === EpubContextFileXHTMLTypes.IMG && a.type.imgType === ImgType.Backmatter) {
      if (b.type.type === EpubContextFileXHTMLTypes.IMG && b.type.imgType === ImgType.Backmatter) {
        return a.globalSeqIndex - b.globalSeqIndex;
      }

      return -1;
    }
    if (b.type.type === EpubContextFileXHTMLTypes.IMG && b.type.imgType === ImgType.Backmatter) {
      if (a.type.type === EpubContextFileXHTMLTypes.IMG && a.type.imgType === ImgType.Backmatter) {
        return a.globalSeqIndex - b.globalSeqIndex;
      }

      return 1;
    }
  }

  // handle case where the types are not defined
  if (utils.isNullOrUndefined(a.type) || utils.isNullOrUndefined(b.type)) {
    return 0;
  }

  // if they have the same global sequence, use the local sequence
  if (a.globalSeqIndex === b.globalSeqIndex) {
    return a.seqIndex - b.seqIndex;
  }

  return a.globalSeqIndex - b.globalSeqIndex;
}

export enum FileDir {
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
export async function finishDOMtoFile(
  dom: JSDOM,
  basePath: string,
  filename: string,
  subdir: FileDir,
  epubctx: EpubContext<any, any>,
  epubfileOptions: Omit<ConstructorParameters<typeof EpubContextFileXHTML>[0], 'filePath'>
): Promise<string> {
  const serialized = `${xh.STATICS.XML_BEGINNING_OP}\n` + dom.serialize();

  const writtenPath = path.resolve(basePath, subdir, filename);
  await utils.mkdir(path.dirname(writtenPath));

  {
    const stat = await utils.statPath(writtenPath);

    if (!utils.isNullOrUndefined(stat)) {
      log('Path already existed and will be overwritten', writtenPath);
    }
  }

  await fspromises.writeFile(writtenPath, serialized);

  epubctx.addFile(
    new EpubContextFileXHTML({
      ...epubfileOptions,
      filePath: writtenPath,
    })
  );

  return writtenPath;
}

/** Possible values for "epub:type" */
export enum EPubType {
  Cover = 'cover',
  BackMatter = 'backmatter',
  BodyMatterChapter = 'bodymatter chapter',
}

/** The Values for the Input Epub's Tracker */
export interface InputEpubTracker {
  Global: number;
}

/** The Type for the Input Epub's first Generic  */
export type InputEpubTrackerRecord = Record<keyof InputEpubTracker, number>;

/** Custom Data the Input Epub provides */
export interface InputEpubCustomData {
  contentOPFDoc: Document;
}

/**
 * Process the input path to a useable directory structure
 * - If the input is a directory, copy it into a temp-directory
 * - If the input is a epub / zip, extract it into a temp-directory
 * @param inputPath The path to decide on
 */
export async function getInputContext(inputPath: string): Promise<EpubContext<InputEpubTrackerRecord, InputEpubCustomData>> {
  const stat = await utils.statPath(inputPath);

  if (utils.isNullOrUndefined(stat)) {
    throw new Error(`Could not get stat of "${inputPath}"`);
  }

  if (!stat.isDirectory() && !stat.isFile()) {
    throw new Error(`Input is not a directory or a file! Input: "${inputPath}"`);
  }

  const epubctx = new EpubContext<InputEpubTrackerRecord, InputEpubCustomData>({
    title: '',
    trackers: {
      Global: 0,
    },
  });

  /** alias for easier use */
  const rootPath = epubctx.rootDir;

  if (stat.isDirectory()) {
    log(`Input is a directory`, inputPath);

    // recursively copy the input to a temp path
    for await (const file of recursiveDirRead(inputPath)) {
      const relPath = path.relative(inputPath, file);
      const newPath = path.resolve(rootPath, relPath);
      await utils.mkdir(path.dirname(newPath));

      await fspromises.copyFile(file, newPath, 0x755);

      await addToCtx(epubctx, newPath);
    }
  }

  if (stat.isFile()) {
    log(`Input is a file`, inputPath);

    if (!(inputPath.endsWith('zip') || inputPath.endsWith('epub'))) {
      throw new Error(`File "${inputPath}" does not end with "zip" or "epub"`);
    }

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

            const outPath = path.resolve(rootPath, entry.fileName);

            await utils.mkdir(path.dirname(outPath));

            const writeStream = createWriteStream(outPath);

            writeStream.on('close', async () => {
              await addToCtx(epubctx, outPath);

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
  }

  let contentOPFPath: string;

  {
    const containerXmlPath = path.resolve(rootPath, 'META-INF/container.xml');
    const { document: containerXMLDoc } = xh.newJSDOM(await fspromises.readFile(containerXmlPath), {
      contentType: xh.STATICS.XML_MIMETYPE,
    });

    const rootFileElem = xh.queryDefinedElement(containerXMLDoc, 'rootfiles > rootfile');
    const contentOPFPathTMP = rootFileElem.getAttribute('full-path') ?? undefined;
    utils.assertion(
      !!contentOPFPathTMP,
      new Error(
        `Expected input container.xml to have a "rootfile" element with valid "full-path" attribute. Container.xml path: "${containerXmlPath}"`
      )
    );
    contentOPFPath = path.resolve(rootPath, contentOPFPathTMP);
  }

  const { document } = xh.newJSDOM(await fspromises.readFile(contentOPFPath), { contentType: xh.STATICS.XML_MIMETYPE });

  if (!utils.isNullOrUndefined(epubctx.customData)) {
    epubctx.customData.contentOPFDoc = document;
  } else {
    epubctx.customData = { contentOPFDoc: document };
  }

  const metadataElem = xh.queryDefinedElement(document, 'package > metadata');
  const manifestElem = xh.queryDefinedElement(document, 'package > manifest');
  const spineElem = xh.queryDefinedElement(document, 'package > spine');

  // get and set the title
  {
    const titleElem = xh.definedElement(
      Array.from(metadataElem.childNodes).find((v) => v.nodeType === v.ELEMENT_NODE && (v as Element).tagName === 'dc:title') as
        | Element
        | undefined,
      'metadata > dc:title'
    );
    const title = sh.stringFixSpaces(sh.xmlToString(titleElem.textContent ?? ''));
    // @ts-expect-error "title" is readonly, but it is overwritten here because of the initial empty string
    epubctx.title = title;
  }

  /** Storage for less often executing a function */
  const contentOPFDir = path.dirname(contentOPFPath);
  const spineChildren = Array.from(spineElem.childNodes);

  // get and set all the id's
  for (const item of Array.from(xh.queryDefinedElementAll(manifestElem, 'item'))) {
    const hrefAttr = item.getAttribute('href');
    utils.assertionDefined(hrefAttr, new Error(`Expected Attribute "href" to be on a "item" Element. Element: "${item.outerHTML}"`));
    const found = epubctx.files.find((v) => path.relative(contentOPFDir, v.filePath) === hrefAttr);

    if (!found) {
      log(`Could not find a file in the epubctx matching the content.opf item, Item: "${item.outerHTML}"`);
      continue;
    }

    // @ts-expect-error "id" is a read-only property, but has been defaulted to be empty
    found.id = item.id;

    const mediaTypeAttr = item.getAttribute('media-type');
    utils.assertionDefined(
      mediaTypeAttr,
      new Error(`Expected Attribute "media-type" to be on a "item" Element. Element: "${item.outerHTML}"`)
    );

    if (mediaTypeAttr !== found.mediaType) {
      log(`WARN: Guessed MimeType does not match content.opf MimeType! Guessed: "${found.mediaType}", ConentOPF: "${mediaTypeAttr}"`);
      // @ts-expect-error "mediaType" is a read-only property, but it should get overwritten by the found mimetype
      found.mediaType = mediaTypeAttr;
    }

    // the following is a helper so that sorting can be done with less "find"(loops)
    const spineIndex =
      spineChildren.findIndex((v) => v.nodeType === v.ELEMENT_NODE && (v as Element).getAttribute('idref') === found.id) + 1;

    if (utils.isNullOrUndefined(found.customData)) {
      found.customData = { spineIndex };
    } else {
      found.customData['spineIndex'] = spineIndex;
    }
  }

  // sort the files in spine order
  {
    epubctx.files.sort(function sortContentSpineForInput(a: EpubFile, b: EpubFile) {
      // ignore all non-xhtml files and move them to the front (before cover xhtml), they will be ignored for the spine and toc generation
      if (!(a instanceof EpubContextFileXHTML)) {
        // cannot be 0, otherwise other sorting will not apply correctly
        return -1;
      }
      if (!(b instanceof EpubContextFileXHTML)) {
        // cannot be 0, otherwise other sorting will not apply correctly
        return 1;
      }

      // use the customData if available, otherwise default to 0
      return (a.customData?.['spineIndex'] ?? 0) - (b.customData?.['spineIndex'] ?? 0);
    });
  }

  return epubctx;
}

/**
 * Add a file to the given epubctx
 * Helper to deduplicate code
 * @param epubctx The Epubctx to add the file to
 * @param filePath The file path where the file can be found at
 */
async function addToCtx(epubctx: EpubContext<InputEpubTrackerRecord, InputEpubCustomData>, filePath: string): Promise<void> {
  // ignore the "mimetype" file
  if (path.basename(filePath) === 'mimetype') {
    return;
  }
  // ignore the "container.xml"
  if (path.basename(filePath) === 'container.xml') {
    return;
  }

  let guessedMime = mime.lookup(filePath);
  log(`addToCtx: guessedMime: "${guessedMime}"`);

  // change "guessedMime" to always be a valid string
  if (!guessedMime) {
    guessedMime = 'application/octet-stream';
  }

  if (guessedMime === xh.STATICS.XHTML_MIMETYPE || guessedMime === STATICS.HTML_MIMETYPE) {
    const { document } = xh.newJSDOM(await fspromises.readFile(filePath), { contentType: STATICS.HTML_MIMETYPE });

    const titleElem = document.querySelector('head > title');

    let title: string = '';

    if (!utils.isNullOrUndefined(titleElem)) {
      title = sh.stringFixSpaces(sh.xmlToString(titleElem.textContent ?? ''));
    }

    const globState = epubctx.incTracker('Global');
    epubctx.addFile(
      new EpubContextFileXHTML({
        filePath: filePath,
        globalSeqIndex: globState,
        id: '',
        seqIndex: 0, // always set to 0, because there is no sequencing that can be generically be done
        title: title,
        type: {
          type: EpubContextFileXHTMLTypes.TEXT,
        },
      })
    );
  } else {
    epubctx.addFile(
      new EpubContextFileBase({
        filePath: filePath,
        id: '',
        mediaType: guessedMime,
      })
    );
  }

  return;
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
 * Normalize a id for epub use (only allow supported characters)
 * @param input The String to normalize
 * @returns The normalized String
 */
export function normalizeId(input: string): string {
  const replacedid = input.replaceAll(/^[^a-zA-Z]+|[^a-zA-Z0-9-_.]/gim, '');
  utils.assertion(replacedid.length > 0, new Error('Expected "replacedid" to have length > 0'));

  return replacedid;
}

export const STATICS = {
  CONTENTOPFPATH: 'content.opf',
  ROOTPATH: 'OEBPS',
  TOCXHTMLPATH: 'toc.xhtml',
  TOCNCXPATH: 'toc.ncx',
  EPUB_MIMETYPE: 'application/epub+zip',
  CSS_MIMETYPE: 'text/css',
  HTML_MIMETYPE: 'text/html',
  DEFAULT_CSS_FILENAME: 'stylesheet.css',
} as const;
