import * as utils from '../utils.js';
import * as xh from './xml.js';
import * as sh from './string.js';
import * as tmp from 'tmp';
import * as path from 'path';
import { applyTemplate, getTemplate } from './template.js';
import { createWriteStream, promises as fspromises } from 'fs';
import { JSDOM } from 'jsdom';
import yazl from 'yazl';
// import yauzl from 'yauzl';

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

export class EpubContext<Trackers extends Record<string, number>> {
  /** The Tmpdir where the epub files are stored */
  protected readonly _tmpdir: tmp.DirResult;
  /** The Title of the Story */
  public readonly title: string;
  /** The Files of the Epub */
  protected _innerFiles: EpubFile[] = [];
  /** Tracker for sequence numbers */
  protected _tracker: Trackers;

  constructor(input: { title: string; trackers: Trackers }) {
    this.title = input.title;

    this._tmpdir = tmp.dirSync({
      prefix: 'converty',
      unsafeCleanup: true,
    });
    log('Tempdir path:', this.rootDir);
    this._tracker = input.trackers;
  }

  get tracker() {
    return this._tracker;
  }

  get rootDir() {
    return this._tmpdir.name;
  }

  get contentPath() {
    return path.join(this.rootDir, STATICS.ROOTPATH);
  }

  get files() {
    return this._innerFiles;
  }

  get cssPath() {
    return path.resolve(FileDir.Styles, 'style.css');
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

    const containerBasePath = path.dirname(this.contentPath);

    const modXHTML = applyTemplate(await getTemplate('toc.xhtml'), {
      '{{CSSPATH}}': path.resolve('..', this.cssPath),
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

    const containerBasePath = path.dirname(this.contentPath);

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
        href: path.relative(path.dirname(this.contentPath), file.filePath),
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
    const writtenPath = path.resolve(this.contentPath);

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
      zipfile.addFile(this.contentPath, `${STATICS.ROOTPATH}/${STATICS.CONTENTOPFPATH}`);

      const containerPath = path.dirname(this.contentPath);

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
  epubctx: EpubContext<any>,
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

export const STATICS = {
  CONTENTOPFPATH: 'content.opf',
  ROOTPATH: 'OEBPS',
  TOCXHTMLPATH: 'toc.xhtml',
  TOCNCXPATH: 'toc.ncx',
  EPUB_MIMETYPE: 'application/epub+zip',
  CSS_MIMETYPE: 'text/css',
} as const;
