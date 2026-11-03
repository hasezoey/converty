import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fspromises } from 'fs';
import * as path from 'path';
import * as utils from '../../src/utils.js';
import * as epubh from '../../src/helpers/epub.js';
import * as htmltp from '../../src/helpers/htmlTextProcessing.js';
import * as xh from '../../src/helpers/xml.js';

describe('htmlTextProcessing', () => {
  describe('STATICS', () => {
    it('should have the default static values', () => {
      expect(htmltp.STATICS.JSDOM_XHTML_OPTIONS).toEqual({ contentType: xh.STATICS.XHTML_MIMETYPE });
      expect(htmltp.STATICS.DEFAULT_HEADER_SEARCH_COUNT).toBe(5);
      expect(htmltp.STATICS.DEFAULT_SKIP_ELEMENTS).toBe(0);
    });
  });

  describe('isElementEmpty', () => {
    it('should detect elements without any children', () => {
      const { document } = xh.newJSDOM('<html><body></body></html>');
      const emptyElem = document.createElement('div');

      expect(htmltp.isElementEmpty(emptyElem)).toBe(true);
    });

    it('should not detect elements with children as empty', () => {
      const { document } = xh.newJSDOM('<html><body></body></html>');
      const filledElem = document.createElement('div');
      filledElem.appendChild(document.createTextNode('Hello'));

      expect(htmltp.isElementEmpty(filledElem)).toBe(false);
    });
  });

  describe('onlyhash1', () => {
    it('should return true for a single "h1" element', () => {
      const { document } = xh.newJSDOM('<html><body></body></html>');
      const mainElem = document.createElement('div');
      const h1Elem = document.createElement('h1');
      h1Elem.textContent = 'Chapter 1';
      mainElem.appendChild(h1Elem);

      expect(htmltp.onlyhash1(mainElem)).toBe(true);
    });

    it('should return false when there is more than just the "h1"', () => {
      const { document } = xh.newJSDOM('<html><body></body></html>');
      const mainElem = document.createElement('div');
      mainElem.appendChild(document.createElement('h1'));
      mainElem.appendChild(document.createElement('p'));

      expect(htmltp.onlyhash1(mainElem)).toBe(false);
    });

    it('should return false for elements without children', () => {
      const { document } = xh.newJSDOM('<html><body></body></html>');
      const mainElem = document.createElement('div');

      expect(htmltp.onlyhash1(mainElem)).toBe(false);
    });
  });

  describe('trimDOM', () => {
    it('should trim trailing empty text nodes and elements', () => {
      const { document } = xh.newJSDOM('<html><body></body></html>');
      const mainElem = document.createElement('div');
      mainElem.appendChild(document.createTextNode('Hello'));
      mainElem.appendChild(document.createTextNode('   ')); // trailing empty text node
      mainElem.appendChild(document.createElement('p')); // empty element

      htmltp.trimDOM(mainElem);

      expect(mainElem.childNodes.length).toBe(1);
      expect(mainElem.textContent).toBe('Hello');
    });

    it('should not trim elements with content', () => {
      const { document } = xh.newJSDOM('<html><body></body></html>');
      const mainElem = document.createElement('div');
      const pElem = document.createElement('p');
      pElem.appendChild(document.createTextNode('Some content'));
      mainElem.appendChild(pElem);

      htmltp.trimDOM(mainElem);

      expect(mainElem.childNodes.length).toBe(1);
      expect(mainElem.textContent).toBe('Some content');
    });
  });

  describe('isH1Title', () => {
    const entryType: htmltp.EntryInformation = { type: htmltp.EntryType.Text, title: 'Chapter 1' };
    const optionsClass = new htmltp.TextProcessingECOptions();

    it('should return the processed title when it matches', () => {
      const { document } = xh.newJSDOM('<html><body></body></html>');
      const elem = document.createElement('p');
      elem.textContent = 'Chapter 1';

      expect(htmltp.isH1Title(document, elem, entryType, optionsClass)).toBe('Chapter 1');
    });

    it('should return true for an "h1" element with a different title', () => {
      const { document } = xh.newJSDOM('<html><body></body></html>');
      const elem = document.createElement('h1');
      elem.textContent = 'Chapter 2';

      expect(htmltp.isH1Title(document, elem, entryType, optionsClass)).toBeTruthy();
    });

    it('should return false for titles that do not match', () => {
      const { document } = xh.newJSDOM('<html><body></body></html>');
      const elem = document.createElement('p');
      elem.textContent = 'Some Other Title';

      expect(htmltp.isH1Title(document, elem, entryType, optionsClass)).toBe(false);
    });

    it('should return false for empty titles', () => {
      const { document } = xh.newJSDOM('<html><body></body></html>');
      const elem = document.createElement('p');
      elem.textContent = '   ';

      expect(htmltp.isH1Title(document, elem, entryType, optionsClass)).toBe(false);
    });
  });

  describe('PElemTracker', () => {
    it('should set the first element as current and top element', () => {
      const { document } = xh.newJSDOM('<html><body></body></html>');
      const tracker = new htmltp.PElemTracker();
      const elem = document.createElement('div');

      tracker.setNewElem(elem);

      expect(tracker.currentElem).toBe(elem);
      expect(tracker.topElem).toBe(elem);
    });

    it('should append to the top element when setting a new current element', () => {
      const { document } = xh.newJSDOM('<html><body></body></html>');
      const tracker = new htmltp.PElemTracker();
      const topElem = document.createElement('div');
      const childElem = document.createElement('p');

      tracker.setNewElem(topElem);
      tracker.setNewElem(childElem);

      expect(tracker.currentElem).toBe(childElem);
      expect(tracker.topElem).toBe(topElem);
      expect(topElem.childNodes.length).toBe(1);
      expect(topElem.childNodes[0]).toBe(childElem);
    });
  });

  describe('TextProcessingECOptions', () => {
    it('should default the last type and image type', () => {
      const options = new htmltp.TextProcessingECOptions();

      expect(options.lastType).toBe(htmltp.LastProcessedType.None);
      expect(options.imgTypeImplicit).toBe(epubh.ImgType.Frontmatter);
    });

    it('should allow setting the last type and image type', () => {
      const options = new htmltp.TextProcessingECOptions();

      options.setLastType(htmltp.LastProcessedType.Image);
      expect(options.lastType).toBe(htmltp.LastProcessedType.Image);

      options.setImgTypeImplicit(epubh.ImgType.Insert);
      expect(options.imgTypeImplicit).toBe(epubh.ImgType.Insert);
    });
  });

  describe('doTextContent', () => {
    let ctx: epubh.EpubContext<htmltp.TextProcessingECOptions>;
    let documentInput: Document;

    const DEFAULT_INPUT_HTML =
      '<html><head><title>Some Story</title></head><body><h1>Chapter 1</h1><p>Some mock text content for the chapter.</p></body></html>';

    const createInputDocument = (html: string): Document => {
      const { document } = xh.newJSDOM(html, { contentType: xh.STATICS.XHTML_MIMETYPE });

      // jsdom's "getComputedStyle" is currently broken in this environment, so mock the styles needed for image handling
      vi.spyOn(document.defaultView!, 'getComputedStyle').mockReturnValue({ verticalAlign: 'top' } as any);

      return document;
    };

    const createDoTextContentOptions = (): htmltp.DoTextContentOptions<htmltp.TextProcessingECOptions> => ({
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      genTextIdData: (_optionsClass, _entryType, _extra) => {
        return {
          sectionId: 'chapter1',
          useType: {
            type: epubh.EpubContextFileXHTMLTypes.TEXT,
          },
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      genImageIdData: (_optionsClass, _inputImg, _imgNode, _entryType, _imgTypeHint) => {
        return {
          sectionId: 'insert1',
          imgFilename: 'Insert1.png',
          xhtmlFilename: 'insert1',
          imgClass: epubh.ImgClass.Insert,
          useType: {
            type: epubh.EpubContextFileXHTMLTypes.IMG,
            imgClass: epubh.ImgClass.Insert,
            imgType: epubh.ImgType.Insert,
          },
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      genChapterHeaderContent: (documentNew, entryType, h1Element: HTMLHeadingElement, _documentInput) => {
        h1Element.appendChild(documentNew.createTextNode(entryType.title));
      },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      genPElemText: (origNode, documentNew, parentElem, _optionsClass) => {
        const pElem = documentNew.createElement('p');
        pElem.textContent = origNode.textContent ?? '';
        parentElem.appendChild(pElem);

        return [pElem];
      },
      getTextContent: (document) => Array.from(document.querySelector('body')?.children ?? []),
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      isTitle: (document, elem, entryType, _optionsClass) => (elem.localName === 'h1' ? entryType.title : false),
    });

    beforeEach(() => {
      ctx = new epubh.EpubContext<htmltp.TextProcessingECOptions>({
        title: 'Some Story',
        optionsClass: new htmltp.TextProcessingECOptions(),
      });
      documentInput = createInputDocument(DEFAULT_INPUT_HTML);
    });

    afterEach(async () => {
      await utils.removeDir(ctx.rootDir);
    });

    it('should save the processed chapter into a new xhtml file', async () => {
      const entryType: htmltp.EntryInformation = { type: htmltp.EntryType.Text, title: 'Chapter 1' };

      documentInput = createInputDocument(DEFAULT_INPUT_HTML);

      await htmltp.doTextContent(documentInput, entryType, ctx, '/converty/input/chapter1.xhtml', createDoTextContentOptions());

      expect(ctx.files).toHaveLength(1);
      expect(ctx.files[0]).toBeInstanceOf(epubh.EpubContextFileXHTML);

      const writtenPath = path.resolve(ctx.contentOPFDir, epubh.FileDir.Text, 'chapter1.xhtml');
      const stat = await utils.statPath(writtenPath);

      expect(stat).toBeDefined();

      const content = await fspromises.readFile(writtenPath, 'utf-8');
      expect(content).toContain('Chapter 1');
    });

    it('should not save a chapter file when the document is fully empty', async () => {
      documentInput = createInputDocument('<html><head><title>Some Story</title></head><body></body></html>');
      const entryType: htmltp.EntryInformation = { type: htmltp.EntryType.Text, title: 'Chapter 1' };

      await htmltp.doTextContent(documentInput, entryType, ctx, '/converty/input/chapter1.xhtml', createDoTextContentOptions());

      expect(ctx.files).toHaveLength(0);
    });

    it('should save the image xhtml and not the chapter when a full size image is the last element', async () => {
      const currentInputFile = path.join(ctx.rootDir, 'input', 'chapter1.xhtml');
      const imgAbsPath = path.resolve(path.dirname(currentInputFile), 'images', 'insert1.png');

      await utils.mkdir(path.dirname(imgAbsPath));
      await fspromises.writeFile(imgAbsPath, Buffer.from('fake-image-data'));

      documentInput = createInputDocument(
        '<html><head><title>Some Story</title></head><body><h1>Chapter 1</h1><p>Some text before the image.<img src="images/insert1.png" /></p></body></html>'
      );
      const imgElem = documentInput.querySelector('img');
      expect(imgElem).toBeDefined();
      (imgElem as any).src = 'images/insert1.png';
      const entryType: htmltp.EntryInformation = { type: htmltp.EntryType.Text, title: 'Chapter 1' };

      await htmltp.doTextContent(documentInput, entryType, ctx, currentInputFile, createDoTextContentOptions());

      // the image itself and the generated image-xhtml should be saved, but not the chapter
      expect(ctx.files).toHaveLength(2);

      const imgXhtmlFile = ctx.files.find((v) => v instanceof epubh.EpubContextFileXHTML);

      expect(imgXhtmlFile).toBeDefined();
      expect(imgXhtmlFile).toMatchObject({ id: 'insert1.xhtml' });
    });

    it('should save the chapter when text follows the full size image', async () => {
      const currentInputFile = path.join(ctx.rootDir, 'input', 'chapter1.xhtml');
      const imgAbsPath = path.resolve(path.dirname(currentInputFile), 'images', 'insert1.png');

      await utils.mkdir(path.dirname(imgAbsPath));
      await fspromises.writeFile(imgAbsPath, Buffer.from('fake-image-data'));

      documentInput = createInputDocument(
        '<html><head><title>Some Story</title></head><body><h1>Chapter 1</h1><p>Some text before the image.<img src="images/insert1.png" /></p><p>Some text after the image.</p></body></html>'
      );
      const imgElem = documentInput.querySelector('img');
      expect(imgElem).toBeDefined();
      (imgElem as any).src = 'images/insert1.png';
      const entryType: htmltp.EntryInformation = { type: htmltp.EntryType.Text, title: 'Chapter 1' };

      await htmltp.doTextContent(documentInput, entryType, ctx, currentInputFile, createDoTextContentOptions());

      // the image gets saved, and because text follows it, the chapter itself also needs to be saved
      expect(ctx.files).toHaveLength(3);

      const chapterFile = ctx.files.find((v) => v instanceof epubh.EpubContextFileXHTML && v.id === 'chapter1.xhtml');

      expect(chapterFile).toBeDefined();

      const chapterPath = path.resolve(ctx.contentOPFDir, epubh.FileDir.Text, 'chapter1.xhtml');
      const content = await fspromises.readFile(chapterPath, 'utf-8');

      expect(content).toContain('Some text after the image');
    });
  });

  describe('processCommonStyle', () => {
    const createDoc = (): Document => {
      const { document } = xh.newJSDOM('<html><body></body></html>');

      // jsdom's "getComputedStyle" is currently broken in this environment, so mock the styles needed for the style handling
      vi.spyOn(document.defaultView!, 'getComputedStyle').mockReturnValue({
        fontWeight: 'normal',
        fontStyle: 'normal',
        verticalAlign: 'top',
        textDecoration: 'none',
        textAlign: 'left',
      } as any);

      return document;
    };

    it('should add a "strong" element when the font weight is bold', () => {
      const doc = createDoc();
      const elem = doc.createElement('div');
      const parentElem = doc.createElement('div');
      const tracker = new htmltp.PElemTracker();

      vi.spyOn(doc.defaultView!, 'getComputedStyle').mockReturnValue({ fontWeight: 'bold' } as any);

      const res = htmltp.processCommonStyle(tracker, parentElem, doc, elem);

      expect(tracker.currentElem).toBeDefined();
      expect(tracker.currentElem?.nodeName).toBe('STRONG');
      expect(res.window).toBeDefined();
      expect(res.elemCompStyle).toBeDefined();
    });

    it('should add an "em" element when the font style is italic', () => {
      const doc = createDoc();
      const elem = doc.createElement('div');
      const parentElem = doc.createElement('div');
      const tracker = new htmltp.PElemTracker();

      vi.spyOn(doc.defaultView!, 'getComputedStyle').mockReturnValue({ fontStyle: 'italic' } as any);

      const res = htmltp.processCommonStyle(tracker, parentElem, doc, elem);

      expect(tracker.currentElem).toBeDefined();
      expect(tracker.currentElem?.nodeName).toBe('EM');
      expect(res.elemCompStyle).toBeDefined();
    });

    it('should add a "sup" element when the vertical align is super', () => {
      const doc = createDoc();
      const elem = doc.createElement('div');
      const parentElem = doc.createElement('div');
      const tracker = new htmltp.PElemTracker();

      vi.spyOn(doc.defaultView!, 'getComputedStyle').mockReturnValue({ verticalAlign: 'super' } as any);

      const res = htmltp.processCommonStyle(tracker, parentElem, doc, elem);

      expect(tracker.currentElem).toBeDefined();
      expect(tracker.currentElem?.nodeName).toBe('SUP');
      expect(res.elemCompStyle).toBeDefined();
    });

    it('should add a "u" element when the text decoration is underline', () => {
      const doc = createDoc();
      const elem = doc.createElement('div');
      const parentElem = doc.createElement('div');
      const tracker = new htmltp.PElemTracker();

      vi.spyOn(doc.defaultView!, 'getComputedStyle').mockReturnValue({ textDecoration: 'underline' } as any);

      const res = htmltp.processCommonStyle(tracker, parentElem, doc, elem);

      expect(tracker.currentElem).toBeDefined();
      expect(tracker.currentElem?.nodeName).toBe('U');
      expect(res.elemCompStyle).toBeDefined();
    });

    it('should mark the parent element as centered when the text align is center', () => {
      const doc = createDoc();
      const elem = doc.createElement('div');
      const parentElem = doc.createElement('div');
      const tracker = new htmltp.PElemTracker();

      vi.spyOn(doc.defaultView!, 'getComputedStyle').mockReturnValue({ textAlign: 'center' } as any);

      const res = htmltp.processCommonStyle(tracker, parentElem, doc, elem);

      expect(parentElem.className).toBe('centerp section-marking');
      expect(res.elemCompStyle).toBeDefined();
    });

    it('should mark the parent element as a signature when the text align is right', () => {
      const doc = createDoc();
      const elem = doc.createElement('div');
      const parentElem = doc.createElement('div');
      const tracker = new htmltp.PElemTracker();

      vi.spyOn(doc.defaultView!, 'getComputedStyle').mockReturnValue({ textAlign: 'right' } as any);

      const res = htmltp.processCommonStyle(tracker, parentElem, doc, elem);

      expect(parentElem.className).toBe('signature');
      expect(res.elemCompStyle).toBeDefined();
    });

    it('should not add any element or style when the default styles are used', () => {
      const doc = createDoc();
      const elem = doc.createElement('div');
      const parentElem = doc.createElement('div');
      const tracker = new htmltp.PElemTracker();

      const res = htmltp.processCommonStyle(tracker, parentElem, doc, elem);

      expect(tracker.currentElem).toBeUndefined();
      expect(tracker.topElem).toBeUndefined();
      expect(parentElem.className).toBe('');
      expect(res.elemCompStyle).toBeDefined();
    });

    it('should add a <small> element when font-size is smaller than the body', () => {
      const doc = createDoc();
      const elem = doc.createElement('div');
      const parentElem = doc.createElement('div');
      const tracker = new htmltp.PElemTracker();

      vi.spyOn(doc.defaultView!, 'getComputedStyle').mockReturnValue({ fontSize: '80%' } as any);

      const res = htmltp.processCommonStyle(tracker, parentElem, doc, elem);

      expect(tracker.currentElem).toBeDefined();
      expect(tracker.currentElem?.nodeName).toBe('SMALL');
      expect(res.elemCompStyle).toBeDefined();
    });

    it('should not add <small> when the element has vertical-align <sub>', () => {
      const doc = createDoc();
      const elem = doc.createElement('div');
      const parentElem = doc.createElement('div');
      const tracker = new htmltp.PElemTracker();

      vi.spyOn(doc.defaultView!, 'getComputedStyle').mockReturnValue({ verticalAlign: 'sub', fontSize: '80%' } as any);

      htmltp.processCommonStyle(tracker, parentElem, doc, elem);

      // should add sub, not small
      expect(tracker.currentElem?.nodeName).toBe('SUB');
      expect(parentElem.querySelector('small')).toBeNull();
    });

    it('should not add <small> when the element has vertical-align <sup>', () => {
      const doc = createDoc();
      const elem = doc.createElement('div');
      const parentElem = doc.createElement('div');
      const tracker = new htmltp.PElemTracker();

      vi.spyOn(doc.defaultView!, 'getComputedStyle').mockReturnValue({ verticalAlign: 'super', fontSize: '80%' } as any);

      htmltp.processCommonStyle(tracker, parentElem, doc, elem);

      // should add sup, not small (order: small added after sup check, but we skip small if sup present)
      expect(tracker.currentElem?.nodeName).toBe('SUP');
      expect(parentElem.querySelector('small')).toBeNull();
    });
  });
});
