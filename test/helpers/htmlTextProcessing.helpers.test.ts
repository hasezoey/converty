import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fspromises } from 'fs';
import * as path from 'path';
import * as utils from '../../src/utils.js';
import * as epubh from '../../src/helpers/epub.js';
import * as htmltp from '../../src/helpers/htmlTextProcessing.js';
import * as xh from '../../src/helpers/xml.js';

const DEFAULT_STYLE: Partial<CSSStyleDeclaration> = {
  fontWeight: 'normal',
  fontStyle: 'normal',
  verticalAlign: 'top',
  textDecoration: 'none',
  textAlign: 'left',
  marginLeft: '0px',
  fontSize: '1em',
  fontFamily: 'Times New Roman',
};

const createDocument = (html: string): Document => {
  const { document } = xh.newJSDOM(html);

  // jsdom's "getComputedStyle" is currently broken in this environment, so mock the styles needed for the style handling
  vi.spyOn(document.defaultView!, 'getComputedStyle').mockReturnValue(DEFAULT_STYLE as CSSStyleDeclaration);

  return document;
};

const createContext = (): epubh.EpubContext<htmltp.TextProcessingECOptions> => {
  return new epubh.EpubContext<htmltp.TextProcessingECOptions>({
    title: 'Some Story',
    optionsClass: new htmltp.TextProcessingECOptions(),
  });
};

describe('htmlTextProcessing helpers', () => {
  const cleanupPaths: string[] = [];

  const trackContext = (ctx: epubh.EpubContext<htmltp.TextProcessingECOptions>) => {
    cleanupPaths.push(ctx.rootDir);

    return ctx;
  };

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env['DEBUG_OUTPUT'];

    for (const cleanupPath of cleanupPaths.splice(0)) {
      await utils.removeDir(cleanupPath);
    }
  });

  describe('createXHTMLlnDOM', () => {
    it('should create a text dom from the template', async () => {
      const ctx = trackContext(createContext());

      const result = await htmltp.createXHTMLlnDOM({ type: htmltp.EntryType.Text, title: 'Chapter 1' }, 'chapter1', ctx);

      expect(result.document.title).toBe('Chapter 1');
      expect(result.mainElem.className).toBe('main');
      expect(result.mainElem.parentElement?.id).toBe('chapter1');
      expect(result.mainElem.parentElement?.getAttribute('epub:type')).toBe(epubh.EPubType.BodyMatterChapter);
      expect(result.document.querySelector('head > link')?.getAttribute('href')).toBe(
        path.join('..', ctx.getRelCssPath(ctx.contentOPFDir))
      );
    });
  });

  describe('createIMGlnDOM', () => {
    it('should create an image dom from the template', async () => {
      const ctx = trackContext(createContext());

      const result = await htmltp.createIMGlnDOM(
        { type: htmltp.EntryType.Text, title: 'Cover' },
        'cover-image',
        epubh.ImgClass.Cover,
        '../Images/cover.png',
        ctx
      );

      const imgElem = xh.queryDefinedElement<HTMLImageElement>(result.document, 'body img');

      expect(result.document.title).toBe('Cover');
      expect(imgElem.className).toBe(epubh.ImgClass.Cover);
      expect(imgElem.getAttribute('src')).toBe('../Images/cover.png');
      expect(imgElem.getAttribute('alt')).toBe('cover-image');
      expect(imgElem.parentElement?.getAttribute('epub:type')).toBe(epubh.EPubType.Cover);
    });

    it('should throw for an inline image', async () => {
      const ctx = trackContext(createContext());

      await expect(
        htmltp.createIMGlnDOM(
          { type: htmltp.EntryType.Text, title: 'Inline' },
          'inline-image',
          epubh.ImgClass.Inline,
          '../Images/inline.png',
          ctx
        )
      ).rejects.toThrow(/Should not create a IMG DOM for a INLINE element/);
    });
  });

  describe('copyImage', () => {
    it('should copy the image and add it to the context', async () => {
      const ctx = trackContext(createContext());
      const tmpDir = await utils.createTmpDir('converty-image-');
      cleanupPaths.push(tmpDir);
      const sourcePath = path.join(tmpDir, 'source.png');
      const imageContent = Buffer.from('fake-image-data');

      await fspromises.writeFile(sourcePath, imageContent);

      const copiedPath = await htmltp.copyImage(sourcePath, ctx, 'cover.png', 'cover-image', epubh.ImgClass.Cover);

      expect(copiedPath).toBe(path.resolve(ctx.contentOPFDir, epubh.FileDir.Images, 'cover.png'));
      expect(await fspromises.readFile(copiedPath)).toEqual(imageContent);
      expect(ctx.files).toHaveLength(1);
      expect(ctx.files[0]).toBeInstanceOf(epubh.EpubContextFileImg);
      expect(ctx.files[0]).toMatchObject({
        id: 'cover-image',
        mediaType: 'image/png',
        imgClass: epubh.ImgClass.Cover,
      });
    });
  });

  describe('traverseElements', () => {
    it('should traverse all parents upwards HTML', () => {
      const { document } = xh.newJSDOM('<html><body><div><span><em id="target"></em></span></div></body></html>');
      const targetElem = xh.queryDefinedElement(document, '#target');

      const parents = Array.from(htmltp.traverseParent(targetElem)).map((elem) => elem.tagName);

      expect(parents).toEqual(['SPAN', 'DIV', 'BODY', 'HTML']);
    });
  });

  describe('parentHas', () => {
    const createNestedDocument = (setContentType: boolean = true) => {
      const { document } = xh.newJSDOM(
        '<html><body><div><span><em id="target"></em></span></div></body></html>',
        setContentType
          ? {
              contentType: xh.STATICS.XHTML_MIMETYPE,
            }
          : undefined
      );

      return xh.queryDefinedElement(document, '#target');
    };

    it('should find a matching parent element', () => {
      const targetElem = createNestedDocument();

      expect(htmltp.parentHas(targetElem, 'span')).toBe(true);
      expect(htmltp.parentHas(targetElem, 'div')).toBe(true);
    });

    it('should return "false" for a non-matching parent element', () => {
      const targetElem = createNestedDocument();

      expect(htmltp.parentHas(targetElem, 'section')).toBe(false);
    });

    it('should return "false" for matching the self element', () => {
      const targetElem = createNestedDocument();

      expect(htmltp.parentHas(targetElem, 'em')).toBe(false);
    });

    it('should stop searching when the "until" element is reached', () => {
      const targetElem = createNestedDocument();

      expect(htmltp.parentHas(targetElem, 'span', 'div')).toBe(true);
      expect(htmltp.parentHas(targetElem, 'body', 'div')).toBe(false);
    });

    it('should correctly determine parent characteristics when contentType is unset (default HTML)', () => {
      const targetElem = createNestedDocument(false);

      // Actual parent that should always be found
      expect(htmltp.parentHas(targetElem, 'div')).toBe(true);
      // Self element should not be found
      expect(htmltp.parentHas(targetElem, 'em')).toBe(false);
      // Non-existant element, should never be found
      expect(htmltp.parentHas(targetElem, 'section')).toBe(false);
    });
  });

  describe('hasInChain', () => {
    const createNestedDocument = (setContentType: boolean = true) => {
      const { document } = xh.newJSDOM(
        '<html><body><div><span><em id="target"></em></span></div></body></html>',
        setContentType
          ? {
              contentType: xh.STATICS.XHTML_MIMETYPE,
            }
          : undefined
      );

      return xh.queryDefinedElement(document, '#target');
    };

    it('should find a matching parent element', () => {
      const targetElem = createNestedDocument();

      expect(htmltp.hasInChain(targetElem, 'span')).toBe(true);
      expect(htmltp.hasInChain(targetElem, 'div')).toBe(true);
    });

    it('should return "false" for a non-matching parent element', () => {
      const targetElem = createNestedDocument();

      expect(htmltp.hasInChain(targetElem, 'section')).toBe(false);
    });

    it('should return "true" for matching the self element', () => {
      const targetElem = createNestedDocument();

      expect(htmltp.hasInChain(targetElem, 'em')).toBe(true);
    });

    it('should stop searching when the "until" element is reached', () => {
      const targetElem = createNestedDocument();

      expect(htmltp.hasInChain(targetElem, 'span', 'div')).toBe(true);
      expect(htmltp.hasInChain(targetElem, 'body', 'div')).toBe(false);
    });

    it('should correctly determine parent characteristics when contentType is unset (default HTML)', () => {
      const targetElem = createNestedDocument(false);

      // Actual parent that should always be found
      expect(htmltp.hasInChain(targetElem, 'div')).toBe(true);
      // Self element should be found
      expect(htmltp.hasInChain(targetElem, 'em')).toBe(true);
      // Non-existant element, should never be found
      expect(htmltp.hasInChain(targetElem, 'section')).toBe(false);
    });
  });

  describe('processCommonStyle sub and strikethrough', () => {
    it('should add a "sub" element when the vertical align is sub', () => {
      const document = createDocument('<html><body></body></html>');
      const elem = document.createElement('div');
      const parentElem = document.createElement('div');
      const tracker = new htmltp.PElemTracker();

      vi.spyOn(document.defaultView!, 'getComputedStyle').mockReturnValue({
        ...DEFAULT_STYLE,
        verticalAlign: 'sub',
      } as CSSStyleDeclaration);

      htmltp.processCommonStyle(tracker, parentElem, document, elem);

      expect(tracker.currentElem?.nodeName).toBe('SUB');
    });

    it('should add an "s" element when the text decoration is line-through', () => {
      const document = createDocument('<html><body></body></html>');
      const elem = document.createElement('div');
      const parentElem = document.createElement('div');
      const tracker = new htmltp.PElemTracker();

      vi.spyOn(document.defaultView!, 'getComputedStyle').mockReturnValue({
        ...DEFAULT_STYLE,
        textDecoration: 'line-through',
      } as CSSStyleDeclaration);

      htmltp.processCommonStyle(tracker, parentElem, document, elem);

      expect(tracker.currentElem?.nodeName).toBe('S');
    });
  });

  describe('finishEpubctx', () => {
    const addChapter = async (ctx: epubh.EpubContext<htmltp.TextProcessingECOptions>) => {
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
    };

    const createOptions = async () => {
      const outputDir = await utils.createTmpDir('converty-output-');
      cleanupPaths.push(outputDir);

      return {
        converterInputPath: '/converty/input',
        converterOutputPath: outputDir,
        fileInputPath: '/converty/input/book.epub',
      };
    };

    it('should write a directory when debug output is enabled', async () => {
      process.env['DEBUG_OUTPUT'] = '1';
      const ctx = trackContext(createContext());
      const extraCtx = trackContext(createContext());
      const options = await createOptions();
      const hook = vi.fn();

      await addChapter(ctx);

      const resultPath = await htmltp.finishEpubctx(ctx, options, [extraCtx], { contentOPF: hook });

      expect(resultPath).toBe(path.resolve(options.converterOutputPath, 'Some Story'));
      expect(await utils.pathExists(path.join(resultPath, 'OEBPS', 'content.opf'))).toBe(true);
      expect(await utils.pathExists(path.join(resultPath, 'OEBPS', 'Text', 'chapter1.xhtml'))).toBe(true);
      expect(await utils.pathExists(ctx.rootDir)).toBe(false);
      expect(await utils.pathExists(extraCtx.rootDir)).toBe(false);
      expect(hook).toHaveBeenCalledOnce();
    });

    it('should write a epub file when debug output is disabled', async () => {
      // explicitly disable debug output
      delete process.env['DEBUG_OUTPUT'];
      const ctx = trackContext(createContext());
      const options = await createOptions();

      await addChapter(ctx);

      const resultPath = await htmltp.finishEpubctx(ctx, options, []);

      expect(resultPath).toBe(path.resolve(options.converterOutputPath, 'Some Story.epub'));
      expect(await utils.pathExists(resultPath)).toBe(true);
      expect(await utils.pathExists(ctx.rootDir)).toBe(false);
    });
  });

  describe('getBodyFontPx', () => {
    const createDoc = (contentType?: boolean, bodySize?: string): Document => {
      const { document } = xh.newJSDOM(
        `<html><body><p>Test</p></body></html>`,
        contentType
          ? {
              contentType: xh.STATICS.XHTML_MIMETYPE,
            }
          : undefined
      );

      const extraProps = bodySize ? { fontSize: bodySize } : {};

      // jsdom's "getComputedStyle" is currently broken in this environment, so mock the styles needed for the style handling
      vi.spyOn(document.defaultView!, 'getComputedStyle').mockReturnValue({
        fontWeight: 'normal',
        fontStyle: 'normal',
        verticalAlign: 'top',
        textDecoration: 'none',
        textAlign: 'left',
        ...extraProps,
      } as any);

      return document;
    };

    it('should provide the default sizes', () => {
      const doc = createDoc();

      const result = htmltp.getBodyFontPx(doc);

      expect(result.bodyFontSizePx).toBe(16);
      expect(result.window).toStrictEqual(doc.defaultView);
    });

    it('should provide the changed body sizes in XHTML', () => {
      const doc = createDoc(true, '30px');

      const result = htmltp.getBodyFontPx(doc);

      expect(result.bodyFontSizePx).toBe(30);
    });

    it('should provide the changed body sizes in HTML', () => {
      const doc = createDoc(false, '30px');

      const result = htmltp.getBodyFontPx(doc);

      expect(result.bodyFontSizePx).toBe(30);
    });

    it("should provide the window, but not match another doc's window", () => {
      const doc1 = createDoc();
      const doc2 = createDoc();

      const result = htmltp.getBodyFontPx(doc1);

      expect(result.window).toStrictEqual(doc1.defaultView);
      expect(result.window).not.toStrictEqual(doc2.defaultView);
    });
  });
});
