import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { promises as fspromises } from 'fs';
import * as path from 'path';
import yauzl from 'yauzl';
import * as utils from '../../src/utils.js';
import * as epubh from '../../src/helpers/epub.js';
import * as xh from '../../src/helpers/xml.js';

describe('epubHelpers', () => {
  describe('normalizeId', () => {
    it('should strip invalid characters from the id', () => {
      expect(epubh.normalizeId('Hello World!')).toBe('HelloWorld');
      expect(epubh.normalizeId('  leading and trailing  ')).toBe('leadingandtrailing');
    });

    it('should keep valid characters like dashes, underscores and dots', () => {
      expect(epubh.normalizeId('Chapter_1 - The Beginning')).toBe('Chapter_1-TheBeginning');
    });

    it('should throw an error for ids that are completely invalid', () => {
      expect(() => epubh.normalizeId('!!!')).toThrow(/Expected "replacedid" to have length > 0/);
    });
  });

  describe('BaseEpubOptions trackers', () => {
    interface ExtraTrackers extends epubh.BaseEpubContextTrackers {
      CurrentSeq: number;
    }

    it('should init trackers to "0" when being accessed', () => {
      const options = new epubh.BaseEpubOptions<ExtraTrackers>();

      expect(options.getTracker('Global')).toBe(0);
      expect(options.getTracker('CurrentSeq')).toBe(0);
    });

    it('should increment a tracker and return the new value', () => {
      const options = new epubh.BaseEpubOptions<ExtraTrackers>();

      expect(options.incTracker('Global')).toBe(1);
      expect(options.incTracker('Global')).toBe(2);
      expect(options.getTracker('Global')).toBe(2);
      expect(options.incTracker('CurrentSeq')).toBe(1);
    });

    it('should decrement a tracker and return the new value', () => {
      const options = new epubh.BaseEpubOptions<ExtraTrackers>();

      options.incTracker('Global');
      options.incTracker('Global');
      expect(options.decTracker('Global')).toBe(1);
      expect(options.getTracker('Global')).toBe(1);
      expect(options.decTracker('CurrentSeq')).toBe(0);
    });

    it('should reset a tracker to "0"', () => {
      const options = new epubh.BaseEpubOptions<ExtraTrackers>();

      options.incTracker('Global');
      options.incTracker('Global');
      expect(options.resetTracker('Global')).toBe(0);
      expect(options.getTracker('Global')).toBe(0);
    });

    it('should keep multiple trackers independent', () => {
      const options = new epubh.BaseEpubOptions<ExtraTrackers>();

      options.incTracker('Global');
      options.incTracker('CurrentSeq');

      expect(options.getTracker('Global')).toBe(1);
      expect(options.getTracker('CurrentSeq')).toBe(1);
    });
  });

  describe('EpubContext', () => {
    it('should default the stylesheet filename to the default stylesheet', () => {
      const ctx = new epubh.EpubContext<epubh.BaseEpubOptions>({
        title: 'Some Story',
        optionsClass: new epubh.BaseEpubOptions(),
      });

      expect(ctx.title).toBe('Some Story');
      expect(ctx.cssFilename).toBe('stylesheet.css');
    });

    it('should generate the contentOPF path inside a temporary directory', () => {
      const ctx = new epubh.EpubContext<epubh.BaseEpubOptions>({
        title: 'Some Story',
        optionsClass: new epubh.BaseEpubOptions(),
      });

      expect(ctx.contentOPFDir).toBe(path.join(ctx.rootDir, epubh.STATICS.ROOT_PATH));
      expect(ctx.contentOPFPath).toBe(path.join(ctx.rootDir, epubh.STATICS.ROOT_PATH, epubh.STATICS.CONTENTOPF_FILENAME));
    });

    it('should store added files', () => {
      const ctx = new epubh.EpubContext<epubh.BaseEpubOptions>({
        title: 'Some Story',
        optionsClass: new epubh.BaseEpubOptions(),
      });

      expect(ctx.files).toHaveLength(0);

      ctx.addFile(
        new epubh.EpubContextFileBase({
          id: 'test',
          mediaType: 'application/octet-stream',
          filePath: '/converty/test',
        })
      );

      expect(ctx.files).toHaveLength(1);
      expect(ctx.files[0]).toBeInstanceOf(epubh.EpubContextFileBase);
    });
  });

  describe('getInputContext', () => {
    it('should throw an error for a path that does not exist', async () => {
      await expect(epubh.getInputContext('/converty/does/not/exist')).rejects.toThrow(/Could not get stat of/);
    });
  });

  describe('applySeriesMetadata', () => {
    it('should apply the series metadata to the metadata element', () => {
      const { document } = xh.newJSDOM('<html><body></body></html>');
      const metadataElem = document.createElementNS(xh.STATICS.OPF_XML_NAMESPACE, 'metadata');

      const idCounter = { c: 0 };
      epubh.applySeriesMetadata(document, metadataElem, idCounter, { name: 'Some Series', volume: '4' });

      const metas = Array.from(metadataElem.children).filter((v) => v.localName === 'meta');

      expect(metas).toHaveLength(3);

      const collectionElem = metas[0];
      expect(collectionElem.getAttribute('property')).toBe('belongs-to-collection');
      expect(collectionElem.getAttribute('id')).toBe('id-1');
      expect(collectionElem.textContent).toBe('Some Series');

      const typeElem = metas[1];
      expect(typeElem.getAttribute('property')).toBe('collection-type');
      expect(typeElem.getAttribute('refines')).toBe('#id-1');
      expect(typeElem.textContent).toBe('series');

      const positionElem = metas[2];
      expect(positionElem.getAttribute('property')).toBe('group-position');
      expect(positionElem.getAttribute('refines')).toBe('#id-1');
      expect(positionElem.textContent).toBe('4');

      expect(idCounter.c).toBe(1);
    });
  });

  describe('finishDOMtoFile', () => {
    let ctx: epubh.EpubContext<epubh.BaseEpubOptions>;
    let epubfileOptions: Omit<ConstructorParameters<typeof epubh.EpubContextFileXHTML>[0], 'filePath'>;
    let consoleErrorSpy: MockInstance<typeof console.error>;

    beforeEach(() => {
      ctx = new epubh.EpubContext<epubh.BaseEpubOptions>({
        title: 'Some Story',
        optionsClass: new epubh.BaseEpubOptions(),
      });

      epubfileOptions = {
        id: 'chapter1.xhtml',
        title: 'Chapter 1',
        type: {
          type: epubh.EpubContextFileXHTMLTypes.TEXT,
        },
        seqIndex: 0,
        globalSeqIndex: 0,
      };
    });

    afterEach(async () => {
      if (consoleErrorSpy) {
        consoleErrorSpy.mockRestore();
      }

      await utils.removeDir(ctx.rootDir);
    });

    it('should write the serialized dom into the given file and add it to the context', async () => {
      const { dom } = xh.newJSDOM('<html><body><p>Some text</p></body></html>');

      const writtenPath = await epubh.finishDOMtoFile(dom, ctx.contentOPFDir, 'chapter1.xhtml', epubh.FileDir.Text, ctx, epubfileOptions);

      expect(writtenPath).toBe(path.resolve(ctx.contentOPFDir, epubh.FileDir.Text, 'chapter1.xhtml'));

      const content = await fspromises.readFile(writtenPath, 'utf-8');
      expect(content).toContain('<?xml version="1.0" encoding="utf-8"?>');
      expect(content).toContain('Some text');

      expect(ctx.files).toHaveLength(1);
      expect(ctx.files[0]).toBeInstanceOf(epubh.EpubContextFileXHTML);
    });

    it('should overwrite an already existing file and add it again to the context', async () => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { dom } = xh.newJSDOM('<html><body><p>Some text</p></body></html>');

      const firstPath = await epubh.finishDOMtoFile(dom, ctx.contentOPFDir, 'chapter1.xhtml', epubh.FileDir.Text, ctx, epubfileOptions);

      const secondDom = xh.newJSDOM('<html><body><p>Other text</p></body></html>');

      const secondPath = await epubh.finishDOMtoFile(
        secondDom.dom,
        ctx.contentOPFDir,
        'chapter1.xhtml',
        epubh.FileDir.Text,
        ctx,
        epubfileOptions
      );

      expect(secondPath).toBe(firstPath);
      expect(ctx.files).toHaveLength(2);

      const content = await fspromises.readFile(firstPath, 'utf-8');
      expect(content).toContain('Other text');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('EpubContextFileXHTML', () => {
    it('should set the media type and detect the main file', () => {
      const file = new epubh.EpubContextFileXHTML({
        id: 'chapter1.xhtml',
        filePath: '/converty/chapter1.xhtml',
        title: 'Chapter 1',
        type: { type: epubh.EpubContextFileXHTMLTypes.TEXT },
        seqIndex: 0,
        globalSeqIndex: 0,
      });
      const subFile = new epubh.EpubContextFileXHTML({
        id: 'chapter1_1.xhtml',
        filePath: '/converty/chapter1_1.xhtml',
        title: 'Chapter 1',
        type: { type: epubh.EpubContextFileXHTMLTypes.TEXT },
        seqIndex: 1,
        globalSeqIndex: 0,
      });

      expect(file.mediaType).toBe(xh.STATICS.XHTML_MIMETYPE);
      expect(file.isMain).toBe(true);
      expect(subFile.isMain).toBe(false);
    });

    it('should throw for a negative "seqIndex"', () => {
      expect(
        () =>
          new epubh.EpubContextFileXHTML({
            id: 'chapter1.xhtml',
            filePath: '/converty/chapter1.xhtml',
            title: 'Chapter 1',
            type: { type: epubh.EpubContextFileXHTMLTypes.TEXT },
            seqIndex: -1,
            globalSeqIndex: 0,
          })
      ).toThrow(/seqIndex cannot be smaller than 0/);
    });

    it('should throw for a negative "globalSeqIndex"', () => {
      expect(
        () =>
          new epubh.EpubContextFileXHTML({
            id: 'chapter1.xhtml',
            filePath: '/converty/chapter1.xhtml',
            title: 'Chapter 1',
            type: { type: epubh.EpubContextFileXHTMLTypes.TEXT },
            seqIndex: 0,
            globalSeqIndex: -1,
          })
      ).toThrow(/globalSeqIndex cannot be smaller than 0/);
    });
  });

  describe('EpubContext getters', () => {
    let ctx: epubh.EpubContext<epubh.BaseEpubOptions>;

    afterEach(async () => {
      if (ctx) {
        await utils.removeDir(ctx.rootDir);
      }
    });

    it('should return the default css path', () => {
      ctx = new epubh.EpubContext<epubh.BaseEpubOptions>({
        title: 'Some Story',
        optionsClass: new epubh.BaseEpubOptions(),
      });

      expect(ctx.cssPath).toBe(path.resolve(ctx.contentOPFDir, epubh.FileDir.Styles, 'stylesheet.css'));
      expect(ctx.getRelCssPath(ctx.contentOPFDir)).toBe(path.join(epubh.FileDir.Styles, 'stylesheet.css'));
    });

    it('should use a custom css filename', () => {
      ctx = new epubh.EpubContext<epubh.BaseEpubOptions>({
        title: 'Some Story',
        optionsClass: new epubh.BaseEpubOptions(),
        cssName: 'custom.css',
      });

      expect(ctx.cssFilename).toBe('custom.css');
      expect(ctx.cssPath).toBe(path.resolve(ctx.contentOPFDir, epubh.FileDir.Styles, 'custom.css'));
    });
  });

  describe('sortFilesForSpine', () => {
    let ctx: epubh.EpubContext<epubh.BaseEpubOptions>;

    beforeEach(() => {
      ctx = new epubh.EpubContext<epubh.BaseEpubOptions>({
        title: 'Some Story',
        optionsClass: new epubh.BaseEpubOptions(),
      });
    });

    afterEach(async () => {
      await utils.removeDir(ctx.rootDir);
    });

    it('should sort by type and sequence index', () => {
      const stylesheet = new epubh.EpubContextFileBase({
        id: 'stylesheet',
        mediaType: epubh.STATICS.CSS_MIMETYPE,
        filePath: '/converty/stylesheet.css',
      });
      const cover = new epubh.EpubContextFileXHTML({
        id: 'cover.xhtml',
        filePath: '/converty/cover.xhtml',
        title: 'Cover',
        type: { type: epubh.EpubContextFileXHTMLTypes.IMG, imgClass: epubh.ImgClass.Cover, imgType: epubh.ImgType.Cover },
        seqIndex: 0,
        globalSeqIndex: 5,
      });
      const toc = new epubh.EpubContextFileXHTML({
        id: 'toc.xhtml',
        filePath: '/converty/toc.xhtml',
        title: 'Table Of Contents',
        type: { type: epubh.EpubContextFileXHTMLTypes.TOC },
        seqIndex: 0,
        globalSeqIndex: 5,
      });
      const chapter = new epubh.EpubContextFileXHTML({
        id: 'chapter1.xhtml',
        filePath: '/converty/chapter1.xhtml',
        title: 'Chapter 1',
        type: { type: epubh.EpubContextFileXHTMLTypes.TEXT },
        seqIndex: 0,
        globalSeqIndex: 1,
      });
      const subChapter = new epubh.EpubContextFileXHTML({
        id: 'chapter1_1.xhtml',
        filePath: '/converty/chapter1_1.xhtml',
        title: 'Chapter 1',
        type: { type: epubh.EpubContextFileXHTMLTypes.TEXT },
        seqIndex: 1,
        globalSeqIndex: 1,
      });
      const credits = new epubh.EpubContextFileXHTML({
        id: 'copyright.xhtml',
        filePath: '/converty/copyright.xhtml',
        title: 'Copyrights and Credits',
        type: { type: epubh.EpubContextFileXHTMLTypes.CREDITS },
        seqIndex: 0,
        globalSeqIndex: 0,
      });

      for (const file of [credits, chapter, stylesheet, subChapter, toc, cover]) {
        ctx.addFile(file);
      }

      ctx.sortFilesForSpine();

      expect(ctx.files[0]).toBe(stylesheet);

      const xhtmlIds = ctx.files.filter((v) => v instanceof epubh.EpubContextFileXHTML).map((v) => v.id);

      expect(xhtmlIds).toEqual(['cover.xhtml', 'toc.xhtml', 'chapter1.xhtml', 'chapter1_1.xhtml', 'copyright.xhtml']);
    });
  });

  describe('generateFinish', () => {
    let ctx: epubh.EpubContext<epubh.BaseEpubOptions>;

    beforeEach(() => {
      ctx = new epubh.EpubContext<epubh.BaseEpubOptions>({
        title: 'Some Story',
        optionsClass: new epubh.BaseEpubOptions(),
      });
    });

    afterEach(async () => {
      await utils.removeDir(ctx.rootDir);
    });

    const addChapter = async () => {
      const { dom } = xh.newJSDOM('<html><head><title>Chapter 1</title></head><body><p>Some text</p></body></html>', {
        contentType: xh.STATICS.XHTML_MIMETYPE,
      });

      return epubh.finishDOMtoFile(dom, ctx.contentOPFDir, 'chapter1.xhtml', epubh.FileDir.Text, ctx, {
        id: 'chapter1.xhtml',
        title: 'Chapter 1',
        type: { type: epubh.EpubContextFileXHTMLTypes.TEXT },
        seqIndex: 0,
        globalSeqIndex: 0,
      });
    };

    it('should generate the toc, ncx and content.opf', async () => {
      await addChapter();

      await ctx.generateFinish();

      const contentOPF = await fspromises.readFile(ctx.contentOPFPath, 'utf-8');
      expect(contentOPF).toContain('<dc:title>Some Story</dc:title>');
      expect(contentOPF).toContain('id="chapter1.xhtml"');
      expect(contentOPF).toContain('href="Text/chapter1.xhtml"');
      expect(contentOPF).toContain('media-type="application/x-dtbncx+xml"');
      expect(contentOPF).toContain('toc="toc.ncx"');
      expect(contentOPF).toContain('properties="nav"');
      expect(contentOPF).toContain('<itemref idref="chapter1.xhtml"/>');

      const tocXHTML = await fspromises.readFile(
        path.resolve(ctx.contentOPFDir, epubh.FileDir.Text, epubh.STATICS.TOC_XHTML_FILENAME),
        'utf-8'
      );
      expect(tocXHTML).toContain('<a href="../Text/chapter1.xhtml">Chapter 1</a>');

      const tocNCX = await fspromises.readFile(path.resolve(ctx.contentOPFDir, epubh.STATICS.TOC_NCX_FILENAME), 'utf-8');
      expect(tocNCX).toContain('<text>Chapter 1</text>');
      expect(tocNCX).toContain('src="Text/chapter1.xhtml"');
    });

    it('should call the contentOPF hook', async () => {
      await addChapter();

      const hook = vi.fn(({ document, metadataElem }: Parameters<epubh.ContentOPFFn>[0]) => {
        const metaElem = document.createElement('meta');
        metaElem.textContent = 'hooked';

        metadataElem.appendChild(metaElem);
      });

      await ctx.generateFinish({ contentOPF: hook });

      expect(hook).toHaveBeenCalledOnce();

      const contentOPF = await fspromises.readFile(ctx.contentOPFPath, 'utf-8');
      expect(contentOPF).toContain('hooked');
    });
  });

  describe('finish', () => {
    let ctx: epubh.EpubContext<epubh.BaseEpubOptions>;

    beforeEach(() => {
      ctx = new epubh.EpubContext<epubh.BaseEpubOptions>({
        title: 'Some Story',
        optionsClass: new epubh.BaseEpubOptions(),
      });
    });

    afterEach(async () => {
      await utils.removeDir(ctx.rootDir);
    });

    it('should generate an epub zip with all required files', async () => {
      const { dom } = xh.newJSDOM('<html><head><title>Chapter 1</title></head><body><p>Some text</p></body></html>', {
        contentType: xh.STATICS.XHTML_MIMETYPE,
      });

      await epubh.finishDOMtoFile(dom, ctx.contentOPFDir, 'chapter1.xhtml', epubh.FileDir.Text, ctx, {
        id: 'chapter1.xhtml',
        title: 'Chapter 1',
        type: { type: epubh.EpubContextFileXHTMLTypes.TEXT },
        seqIndex: 0,
        globalSeqIndex: 0,
      });

      const epubPath = await ctx.finish();
      const entries = await getZipEntryNames(epubPath);

      expect(epubPath).toBe(path.resolve(ctx.rootDir, 'Some Story.epub'));
      expect(entries).toContain('mimetype');
      expect(entries).toContain('META-INF/container.xml');
      expect(entries).toContain('OEBPS/content.opf');
      expect(entries).toContain('OEBPS/toc.ncx');
      expect(entries).toContain('OEBPS/Text/toc.xhtml');
      expect(entries).toContain('OEBPS/Text/chapter1.xhtml');
    });
  });

  describe('copyMetadata', () => {
    let ctx: epubh.EpubContext<epubh.BaseEpubOptions>;

    beforeEach(() => {
      ctx = new epubh.EpubContext<epubh.BaseEpubOptions>({
        title: 'Some Story',
        optionsClass: new epubh.BaseEpubOptions(),
      });
    });

    afterEach(async () => {
      await utils.removeDir(ctx.rootDir);
    });

    const createOutputDocument = () => {
      const { document } = xh.newJSDOM('<package><metadata></metadata></package>', {
        contentType: xh.STATICS.XML_MIMETYPE,
      });

      return {
        document,
        packageElem: xh.queryDefinedElement(document, 'package'),
        metadataElem: xh.queryDefinedElement(document, 'metadata'),
      };
    };

    const createInputDocument = (metadata: string) => {
      const { document } = xh.newJSDOM(
        `<package unique-identifier="pub-id"><metadata xmlns:dc="${xh.STATICS.DC_XML_NAMESPACE}" xmlns:opf="${xh.STATICS.OPF_XML_NAMESPACE}">${metadata}</metadata></package>`,
        { contentType: xh.STATICS.XML_MIMETYPE }
      );

      return {
        document,
        packageElem: xh.queryDefinedElement(document, 'package'),
        metadataElem: xh.queryDefinedElement(document, 'metadata'),
      };
    };

    it('should copy the supported metadata elements', () => {
      const input = createInputDocument(`
        <dc:title>Old Title</dc:title>
        <dc:publisher>Publisher</dc:publisher>
        <dc:language>en</dc:language>
        <dc:creator>Author</dc:creator>
        <dc:date>2020-01-01</dc:date>
        <dc:rights>Rights</dc:rights>
        <dc:description>Description</dc:description>
        <dc:identifier id="pub-id" opf:scheme="calibre">123</dc:identifier>
        <meta name="cover" content="cover-img" />
        <other>ignored</other>
      `);
      const output = createOutputDocument();

      ctx.addFile(
        new epubh.EpubContextFileImg({
          id: 'cover-img',
          mediaType: 'image/png',
          filePath: '/converty/cover.png',
          imgClass: epubh.ImgClass.Cover,
        })
      );

      const idCounter: epubh.IdCounter = { c: 0 };

      epubh.copyMetadata(output.document, Array.from(input.metadataElem.children), ctx, output.metadataElem, input.packageElem, idCounter);

      const children = Array.from(output.metadataElem.children);
      const byLocalName = (name: string) => children.filter((v) => v.localName === name);

      expect(byLocalName('title')).toHaveLength(0);
      expect(byLocalName('publisher')[0].textContent).toBe('Publisher');
      expect(byLocalName('language')[0].textContent).toBe('en');
      expect(byLocalName('creator')[0].textContent).toBe('Author');
      expect(byLocalName('creator')[0].getAttribute('id')).toBe('id-1');
      expect(byLocalName('date')[0].textContent).toBe('2020-01-01');
      expect(byLocalName('rights')[0].textContent).toBe('Rights');
      expect(byLocalName('description')[0].textContent).toBe('Description');
      expect(byLocalName('identifier')[0].textContent).toBe('123');
      expect(byLocalName('identifier')[0].getAttribute('id')).toBe('pub-id');
      expect(byLocalName('identifier')[0].getAttribute('opf:scheme')).toBe('calibre');
      expect(byLocalName('other')).toHaveLength(0);

      const coverMeta = children.filter((v) => v.localName === 'meta' && v.getAttribute('name') === 'cover');
      expect(coverMeta).toHaveLength(1);
      expect(coverMeta[0].getAttribute('content')).toBe('cover-img');

      expect(idCounter.c).toBe(1);
    });

    it('should use the already known cover image', () => {
      const input = createInputDocument('<meta name="cover" content="cover-img" />');
      const output = createOutputDocument();

      ctx.optionsClass.coverImgId = 'existing-cover.png';

      epubh.copyMetadata(output.document, Array.from(input.metadataElem.children), ctx, output.metadataElem, input.packageElem, { c: 0 });

      const coverMeta = Array.from(output.metadataElem.children).filter(
        (v) => v.localName === 'meta' && v.getAttribute('name') === 'cover'
      );

      expect(coverMeta).toHaveLength(1);
      expect(coverMeta[0].getAttribute('content')).toBe('existing-cover.png');
    });

    it('should throw when the cover image could not be found', () => {
      const input = createInputDocument('<meta name="cover" content="missing-cover" />');
      const output = createOutputDocument();

      expect(() =>
        epubh.copyMetadata(output.document, Array.from(input.metadataElem.children), ctx, output.metadataElem, input.packageElem, { c: 0 })
      ).toThrow(/Expected to find cover\("missing-cover"\) file in original epub/);
    });
  });

  describe('serializeXML', () => {
    afterEach(() => {
      delete process.env['DEBUG_OUTPUT'];
    });

    it('should serialize the dom with the xml declaration', async () => {
      const { dom } = xh.newJSDOM('<html><body><p>Some text</p></body></html>');

      const serialized = await epubh.serializeXML(dom);

      expect(serialized.startsWith(`${xh.STATICS.XML_BEGINNING_OP}\n`)).toBe(true);
      expect(serialized).toContain('<p>Some text</p>');
    });

    it('should prettify the output when debug output is enabled', async () => {
      process.env['DEBUG_OUTPUT'] = '1';
      const { dom } = xh.newJSDOM('<html><body><p>Some text</p></body></html>');

      const serialized = await epubh.serializeXML(dom);

      expect(serialized).toContain('\n  <body>');
    });
  });
});

async function getZipEntryNames(zipPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) {
        return reject(err);
      }

      const entries: string[] = [];

      zip.on('entry', (entry) => {
        entries.push(entry.fileName);
        zip.readEntry();
      });
      zip.once('error', reject);
      zip.once('close', () => resolve(entries));

      zip.readEntry();
    });
  });
}
