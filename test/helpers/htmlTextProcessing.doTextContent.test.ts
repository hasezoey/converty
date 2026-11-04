import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fspromises } from 'fs';
import * as path from 'path';
import * as utils from '../../src/utils.js';
import * as epubh from '../../src/helpers/epub.js';
import * as htmltp from '../../src/helpers/htmlTextProcessing.js';
import * as xh from '../../src/helpers/xml.js';

describe('htmlTextProcessing doTextContent branches', () => {
  const cleanupPaths: string[] = [];

  const createContext = () => {
    const ctx = new epubh.EpubContext<htmltp.TextProcessingECOptions>({
      title: 'Some Story',
      optionsClass: new htmltp.TextProcessingECOptions(),
    });
    cleanupPaths.push(ctx.rootDir);

    return ctx;
  };

  const createInputDocument = (html: string, styles: Array<Record<string, string>> = [{}]): Document => {
    const { document } = xh.newJSDOM(html, { contentType: xh.STATICS.XHTML_MIMETYPE });
    let styleIndex = 0;

    // jsdom's "getComputedStyle" is currently broken in this environment, so mock the styles needed for image handling
    vi.spyOn(document.defaultView!, 'getComputedStyle').mockImplementation(() => {
      const style = styles[styleIndex] ?? styles[styles.length - 1];
      styleIndex += 1;

      return { verticalAlign: 'top', ...style } as any;
    });

    return document;
  };

  const createOptions = (
    overrides: Partial<htmltp.DoTextContentOptions<htmltp.TextProcessingECOptions>> = {}
  ): htmltp.DoTextContentOptions<htmltp.TextProcessingECOptions> => ({
    genTextIdData: () => ({
      sectionId: 'chapter1',
      useType: {
        type: epubh.EpubContextFileXHTMLTypes.TEXT,
      },
    }),
    genImageIdData: () => ({
      sectionId: 'insert1.png',
      imgFilename: 'Insert1.png',
      xhtmlFilename: 'insert1',
      imgClass: epubh.ImgClass.Insert,
      useType: {
        type: epubh.EpubContextFileXHTMLTypes.IMG,
        imgClass: epubh.ImgClass.Insert,
        imgType: epubh.ImgType.Insert,
      },
    }),
    genChapterHeaderContent: (documentNew, entryType, h1Element) => {
      h1Element.appendChild(documentNew.createTextNode(entryType.title));
    },
    genPElemText: (origNode, documentNew) => {
      return [documentNew.createTextNode(origNode.textContent ?? '')];
    },
    getTextContent: (document) => Array.from(document.querySelector('body')?.children ?? []),
    isTitle: (_document, elem, entryType) => (elem.localName === 'h1' ? entryType.title : false),
    ...overrides,
  });

  afterEach(async () => {
    vi.restoreAllMocks();

    for (const cleanupPath of cleanupPaths.splice(0)) {
      await utils.removeDir(cleanupPath);
    }
  });

  it.concurrent('should skip the configured number of elements', async () => {
    const ctx = createContext();
    const documentInput = createInputDocument(
      '<html><head><title>Chapter 1</title></head><body><h1>Chapter 1</h1><p>skipped</p><p>kept</p></body></html>'
    );
    const entryType: htmltp.EntryInformation = { type: htmltp.EntryType.Text, title: 'Chapter 1' };

    await htmltp.doTextContent(
      documentInput,
      entryType,
      ctx,
      path.join(ctx.rootDir, 'input', 'chapter1.xhtml'),
      createOptions({ skipElements: 2 })
    );

    const content = await fspromises.readFile(path.join(ctx.contentOPFDir, epubh.FileDir.Text, 'chapter1.xhtml'), 'utf-8');
    expect(content).toContain('kept');
    expect(content).not.toContain('skipped');
  });

  it.concurrent('should skip elements matched by the custom checkElement function', async () => {
    const ctx = createContext();
    const documentInput = createInputDocument(
      '<html><head><title>Chapter 1</title></head><body><h1>Chapter 1</h1><p class="skip">skipped</p><p>kept</p></body></html>'
    );
    const entryType: htmltp.EntryInformation = { type: htmltp.EntryType.Text, title: 'Chapter 1' };

    await htmltp.doTextContent(
      documentInput,
      entryType,
      ctx,
      path.join(ctx.rootDir, 'input', 'chapter1.xhtml'),
      createOptions({ checkElement: (elem) => elem.className === 'skip' })
    );

    const content = await fspromises.readFile(path.join(ctx.contentOPFDir, epubh.FileDir.Text, 'chapter1.xhtml'), 'utf-8');
    expect(content).toContain('kept');
    expect(content).not.toContain('skipped');
  });

  it.concurrent('should save the content before a full size image and continue with a new document', async () => {
    const ctx = createContext();
    const currentInputFile = path.join(ctx.rootDir, 'input', 'chapter1.xhtml');
    const imgAbsPath = path.resolve(path.dirname(currentInputFile), 'images', 'insert1.png');

    await utils.mkdir(path.dirname(imgAbsPath));
    await fspromises.writeFile(imgAbsPath, Buffer.from('fake-image-data'));

    const documentInput = createInputDocument(
      '<html><head><title>Chapter 1</title></head><body><h1>Chapter 1</h1><p>Some text before the image.</p><p><img src="images/insert1.png" /></p></body></html>'
    );
    (documentInput.querySelector('img') as any).src = 'images/insert1.png';
    const entryType: htmltp.EntryInformation = { type: htmltp.EntryType.Text, title: 'Chapter 1' };

    await htmltp.doTextContent(documentInput, entryType, ctx, currentInputFile, createOptions());

    const textDir = path.join(ctx.contentOPFDir, epubh.FileDir.Text);
    const chapter = await fspromises.readFile(path.join(textDir, 'chapter1.xhtml'), 'utf-8');

    expect(chapter).toContain('Some text before the image.');
    expect(await utils.pathExists(path.join(textDir, 'insert1.xhtml'))).toBe(true);
    expect(await utils.pathExists(path.join(ctx.contentOPFDir, epubh.FileDir.Images, 'Insert1.png'))).toBe(true);
    expect(ctx.files.length).toBeGreaterThanOrEqual(3);
  });

  it('should copy middle-aligned images inline', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const ctx = createContext();
    const currentInputFile = path.join(ctx.rootDir, 'input', 'chapter1.xhtml');
    const firstImgPath = path.resolve(path.dirname(currentInputFile), 'images', 'first.png');
    const secondImgPath = path.resolve(path.dirname(currentInputFile), 'images', 'second.png');

    await utils.mkdir(path.dirname(firstImgPath));
    await fspromises.writeFile(firstImgPath, Buffer.from('fake-first-image'));
    await fspromises.writeFile(secondImgPath, Buffer.from('fake-second-image'));

    const documentInput = createInputDocument(
      '<html><head><title>Chapter 1</title></head><body><h1>Chapter 1</h1><p><img src="images/first.png" /><img src="images/second.png" /></p><p>Some text</p></body></html>',
      [{ verticalAlign: 'middle' }, { verticalAlign: 'middle' }]
    );
    const imgElems = documentInput.querySelectorAll('img');
    (imgElems[0] as any).src = 'images/first.png';
    (imgElems[1] as any).src = 'images/second.png';
    const entryType: htmltp.EntryInformation = { type: htmltp.EntryType.Text, title: 'Chapter 1' };
    let genImageIdDataCallCount = 0;
    const genImageIdData = vi.fn((optionsClass, imgFromPath, imgNode, entryType) => {
      genImageIdDataCallCount += 1;
      const base = createOptions().genImageIdData(optionsClass, imgFromPath, imgNode, entryType);
      // give each image a unique xhtmlFilename and sectionId so that the EPUB id is unique
      // and the "Overwriting file!" warning is not triggered
      base.xhtmlFilename = `Insert${genImageIdDataCallCount}`;
      base.sectionId = `insert${genImageIdDataCallCount}.png`;
      base.imgFilename = `Insert${genImageIdDataCallCount}.png`;

      return base;
    });

    await htmltp.doTextContent(
      documentInput,
      entryType,
      ctx,
      currentInputFile,
      createOptions({
        genImageIdData,
      })
    );

    expect(genImageIdData).toHaveBeenCalledTimes(2);
    expect(genImageIdData).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.stringContaining('first.png'),
      expect.anything(),
      entryType,
      epubh.ImgType.Inline
    );
    expect(genImageIdData).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.stringContaining('second.png'),
      expect.anything(),
      entryType,
      epubh.ImgType.Inline
    );

    expect(consoleLogSpy).not.toHaveBeenCalled();

    const textDir = path.join(ctx.contentOPFDir, epubh.FileDir.Text);
    const copiedImagePath1 = path.join(ctx.contentOPFDir, epubh.FileDir.Images, 'Insert1.png');
    const copiedImagePath2 = path.join(ctx.contentOPFDir, epubh.FileDir.Images, 'Insert2.png');

    // inline images are only copied, they do not get their own xhtml file
    expect(await utils.pathExists(path.join(textDir, 'insert1.xhtml'))).toBe(false);
    expect(await utils.pathExists(path.join(textDir, 'insert2.xhtml'))).toBe(false);
    expect(await utils.pathExists(path.join(textDir, 'chapter1.xhtml'))).toBe(true);
    expect(await utils.pathExists(copiedImagePath1)).toBe(true);
    expect(await fspromises.readFile(copiedImagePath1)).toEqual(await fspromises.readFile(firstImgPath));
    expect(await utils.pathExists(copiedImagePath2)).toBe(true);
    expect(await fspromises.readFile(copiedImagePath2)).toEqual(await fspromises.readFile(secondImgPath));

    const chapter = await fspromises.readFile(path.join(textDir, 'chapter1.xhtml'), 'utf-8');
    expect(chapter).toContain('Some text');
  });

  it('should log a warning and skip non-middle-aligned images when multiple are present', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const ctx = createContext();
    const currentInputFile = path.join(ctx.rootDir, 'input', 'chapter1.xhtml');
    const firstImgPath = path.resolve(path.dirname(currentInputFile), 'images', 'first.png');
    const secondImgPath = path.resolve(path.dirname(currentInputFile), 'images', 'second.png');

    await utils.mkdir(path.dirname(firstImgPath));
    await fspromises.writeFile(firstImgPath, Buffer.from('fake-first-image'));
    await fspromises.writeFile(secondImgPath, Buffer.from('fake-second-image'));

    const documentInput = createInputDocument(
      '<html><head><title>Chapter 1</title></head><body><h1>Chapter 1</h1><p><img src="images/first.png" /><img src="images/second.png" /></p><p>Some text</p></body></html>',
      [{ verticalAlign: 'top' }, { verticalAlign: 'middle' }]
    );
    const imgElems = documentInput.querySelectorAll('img');
    (imgElems[0] as any).src = 'images/first.png';
    (imgElems[1] as any).src = 'images/second.png';
    const entryType: htmltp.EntryInformation = { type: htmltp.EntryType.Text, title: 'Chapter 1' };
    let genImageIdDataCallCount = 0;
    const genImageIdData = vi.fn((optionsClass, imgFromPath, imgNode, entryType) => {
      genImageIdDataCallCount += 1;
      const base = createOptions().genImageIdData(optionsClass, imgFromPath, imgNode, entryType);
      // give each image a unique xhtmlFilename and sectionId so that the EPUB id is unique
      // and the "Overwriting file!" warning is not triggered
      base.xhtmlFilename = `insert${genImageIdDataCallCount}`;
      base.sectionId = `insert${genImageIdDataCallCount}.png`;
      base.imgFilename = `Insert${genImageIdDataCallCount}.png`;

      return base;
    });

    await htmltp.doTextContent(
      documentInput,
      entryType,
      ctx,
      currentInputFile,
      createOptions({
        genImageIdData,
      })
    );

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Multiple images present, and at least one does not have align "middle"! file: "${currentInputFile}"`)
    );

    expect(genImageIdData).toHaveBeenCalledTimes(1);
    expect(genImageIdData).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('second.png'),
      expect.anything(),
      entryType,
      epubh.ImgType.Inline
    );

    const textDir = path.join(ctx.contentOPFDir, epubh.FileDir.Text);
    const copiedImagePath1 = path.join(ctx.contentOPFDir, epubh.FileDir.Images, 'Insert1.png');
    const copiedImagePath2 = path.join(ctx.contentOPFDir, epubh.FileDir.Images, 'Insert2.png');

    // inline images are only copied, they do not get their own xhtml file
    expect(await utils.pathExists(path.join(textDir, 'insert1.xhtml'))).toBe(false);
    expect(await utils.pathExists(path.join(textDir, 'insert2.xhtml'))).toBe(false);
    expect(await utils.pathExists(path.join(textDir, 'chapter1.xhtml'))).toBe(true);
    expect(await utils.pathExists(copiedImagePath1)).toBe(true);
    expect(await fspromises.readFile(copiedImagePath1)).toEqual(await fspromises.readFile(secondImgPath));
    // due to the first image not being marked "middle", it will not be copied (or will be overwritten with the same id)
    expect(await utils.pathExists(copiedImagePath2)).toBe(false);

    const chapter = await fspromises.readFile(path.join(textDir, 'chapter1.xhtml'), 'utf-8');
    expect(chapter).toContain('Some text');
  });

  it.concurrent('should skip empty elements before the content', async () => {
    const ctx = createContext();
    const documentInput = createInputDocument(
      '<html><head><title>Chapter 1</title></head><body><h1>Chapter 1</h1><p></p><p>kept</p></body></html>'
    );
    const entryType: htmltp.EntryInformation = { type: htmltp.EntryType.Text, title: 'Chapter 1' };

    await htmltp.doTextContent(documentInput, entryType, ctx, path.join(ctx.rootDir, 'input', 'chapter1.xhtml'), createOptions());

    const content = await fspromises.readFile(path.join(ctx.contentOPFDir, epubh.FileDir.Text, 'chapter1.xhtml'), 'utf-8');

    expect(content).toContain('</h1><p>kept');
  });

  it.concurrent('should omit paragraph elements generated without content', async () => {
    const ctx = createContext();
    const documentInput = createInputDocument(
      '<html><head><title>Chapter 1</title></head><body><h1>Chapter 1</h1><p>one</p><p>empty</p></body></html>'
    );
    const entryType: htmltp.EntryInformation = { type: htmltp.EntryType.Text, title: 'Chapter 1' };

    await htmltp.doTextContent(
      documentInput,
      entryType,
      ctx,
      path.join(ctx.rootDir, 'input', 'chapter1.xhtml'),
      createOptions({
        genPElemText: (origNode, documentNew) => {
          if (origNode.textContent?.includes('empty')) {
            return [];
          }

          return [documentNew.createTextNode(origNode.textContent ?? '')];
        },
      })
    );

    const content = await fspromises.readFile(path.join(ctx.contentOPFDir, epubh.FileDir.Text, 'chapter1.xhtml'), 'utf-8');

    expect(content).toContain('one');
    expect(content).not.toContain('empty');
  });

  it.concurrent('should reset the previous image state and increment the subchapter', async () => {
    const ctx = createContext();
    ctx.optionsClass.setLastType(htmltp.LastProcessedType.Image);
    ctx.optionsClass.setImgTypeImplicit(epubh.ImgType.Insert);

    const documentInput = createInputDocument('<html><head><title>Chapter 1</title></head><body><p>Some text</p></body></html>');
    const entryType: htmltp.EntryInformation = { type: htmltp.EntryType.Text, title: 'Chapter 1' };

    await htmltp.doTextContent(
      documentInput,
      entryType,
      ctx,
      path.join(ctx.rootDir, 'input', 'chapter1.xhtml'),
      createOptions({ isTitle: () => false })
    );

    expect(ctx.optionsClass.lastType).toBe(htmltp.LastProcessedType.None);
    expect(ctx.optionsClass.getTracker('CurrentSubChapter')).toBe(1);
    expect(ctx.optionsClass.getTracker('Chapter')).toBe(0);
  });

  describe('trimDOM whitespace element', () => {
    it.concurrent('should trim an element that only contains whitespace text', () => {
      const { document } = xh.newJSDOM('<html><body></body></html>');
      const mainElem = document.createElement('div');
      const whitespaceElem = document.createElement('p');

      mainElem.appendChild(document.createTextNode('Hello'));
      whitespaceElem.appendChild(document.createTextNode('   '));
      mainElem.appendChild(whitespaceElem);

      htmltp.trimDOM(mainElem);

      expect(mainElem.childNodes).toHaveLength(1);
      expect(mainElem.textContent).toBe('Hello');
    });
  });
});
