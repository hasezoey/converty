import { afterEach, describe, expect, it, vi } from 'vitest';
import * as ssc from '../../src/common/sevenseascommon.js';
import * as epubh from '../../src/helpers/epub.js';
import * as htmltp from '../../src/helpers/htmlTextProcessing.js';
import * as xh from '../../src/helpers/xml.js';

const DEFAULT_STYLE = {
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
  vi.spyOn(document.defaultView!, 'getComputedStyle').mockReturnValue(DEFAULT_STYLE as any);

  return document;
};

const createEntryType = (overrides: Partial<ssc.EntryInformationExt> = {}): ssc.EntryInformationExt => ({
  type: htmltp.EntryType.Text,
  title: 'Chapter 1',
  firstLine: 'Chapter 1',
  imgType: epubh.ImgType.Insert,
  ...overrides,
});

describe('sevenseasCommon helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('genChapterHeaderContent', () => {
    it('should add the first and second line to the header', () => {
      const { document } = xh.newJSDOM('<html><body></body></html>');
      const h1Element = document.createElement('h1');
      const entryType = createEntryType({
        title: 'Chapter 1: The Beginning',
        firstLine: 'Chapter 1:',
        secondLine: 'The Beginning',
      });

      ssc.genChapterHeaderContent(document, entryType, h1Element);

      expect(h1Element.querySelector('br')).not.toBeNull();
      expect(h1Element.textContent).toBe('Chapter 1:The Beginning');
    });

    it('should not add a line break without a second line', () => {
      const { document } = xh.newJSDOM('<html><body></body></html>');
      const h1Element = document.createElement('h1');
      const entryType = createEntryType({ title: 'Chapter 1', firstLine: 'Chapter 1' });

      ssc.genChapterHeaderContent(document, entryType, h1Element);

      expect(h1Element.querySelector('br')).toBeNull();
      expect(h1Element.textContent).toBe('Chapter 1');
    });
  });

  describe('cachedIsTitleOptions', () => {
    it('should cache the window and body font size', () => {
      const document = createDocument('<html><body></body></html>');
      const options = new ssc.SevenSeasECOptions();

      ssc.cachedIsTitleOptions(document, options);

      expect(options.titleCache?.bodyFontSizePx).toBe(16);
      expect(options.titleCache?.window).toBe(document.defaultView);
    });
  });

  describe('getTitle extra types', () => {
    it('should detect a title page as frontmatter', () => {
      expect(ssc.getTitle('Title Page', {}).imgType).toBe(epubh.ImgType.Frontmatter);
    });

    it('should detect copyrights as frontmatter', () => {
      expect(ssc.getTitle('Copyrights and Credits', {}).imgType).toBe(epubh.ImgType.Frontmatter);
    });

    it('should detect an extra chapter as backmatter', () => {
      expect(ssc.getTitle('Extra Chapter', {}).imgType).toBe(epubh.ImgType.Backmatter);
    });

    it('should call the custom getTitleHook', () => {
      const hook = vi.fn((retObj: ssc.GetTitleTmpEIE) => {
        retObj.imgType = epubh.ImgType.Frontmatter;
      });

      const result = ssc.getTitle('Chapter 5', { getTitleHook: hook });

      expect(hook).toHaveBeenCalledWith(expect.objectContaining({ firstLine: 'Chapter 5' }), 'Chapter', '5', undefined, 'Chapter 5');
      expect(result.imgType).toBe(epubh.ImgType.Frontmatter);
    });
  });

  describe('generatePElementInnerTranslate', () => {
    it('should return text nodes as they are', () => {
      const document = createDocument('<html><body></body></html>');
      const textNode = document.createTextNode('Some text');
      const parentElem = document.createElement('div');

      const elems = ssc.generatePElementInnerTranslate(textNode, document, parentElem, new ssc.SevenSeasECOptions(), {});

      expect(elems).toHaveLength(1);
      expect(elems[0].textContent).toBe('Some text');
    });

    it('should return "br" elements directly', () => {
      const document = createDocument('<html><body></body></html>');
      const brElem = document.createElement('br');
      const parentElem = document.createElement('div');

      const elems = ssc.generatePElementInnerTranslate(brElem, document, parentElem, new ssc.SevenSeasECOptions(), {});

      expect(elems).toHaveLength(1);
      expect(elems[0].nodeName).toBe('BR');
    });

    it('should ignore non-element and non-text nodes', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const document = createDocument('<html><body></body></html>');
      const commentNode = document.createComment('Some comment');
      const parentElem = document.createElement('div');

      const elems = ssc.generatePElementInnerTranslate(commentNode, document, parentElem, new ssc.SevenSeasECOptions(), {});

      expect(elems).toHaveLength(0);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should mark the parent as extra indented', () => {
      const document = createDocument('<html><body></body></html>');
      const pElem = document.createElement('p');
      pElem.textContent = 'Indented text';
      const parentElem = document.createElement('div');

      vi.spyOn(document.defaultView!, 'getComputedStyle').mockReturnValue({ ...DEFAULT_STYLE, marginLeft: '10px' } as any);

      ssc.generatePElementInnerTranslate(pElem, document, parentElem, new ssc.SevenSeasECOptions(), {});

      expect(parentElem.className).toBe('extra-indent');
    });

    it('should wrap big text into a "strong" element', () => {
      const document = createDocument('<html><body></body></html>');
      const pElem = document.createElement('p');
      pElem.textContent = 'Big text';
      const parentElem = document.createElement('div');

      vi.spyOn(document.defaultView!, 'getComputedStyle').mockImplementation((elem) => {
        if (elem.tagName.toLowerCase() === 'body') {
          return DEFAULT_STYLE;
        }

        return { ...DEFAULT_STYLE, fontSize: '3.00em' } as any;
      });

      const elems = ssc.generatePElementInnerTranslate(pElem, document, parentElem, new ssc.SevenSeasECOptions(), {});

      expect(elems).toHaveLength(1);
      expect(elems[0].nodeName).toBe('STRONG');
      expect(elems[0].textContent).toBe('Big text');
    });

    it('should wrap monospace text into a "code" element', () => {
      const document = createDocument('<html><body></body></html>');
      const pElem = document.createElement('p');
      pElem.textContent = 'Code text';
      const parentElem = document.createElement('div');

      vi.spyOn(document.defaultView!, 'getComputedStyle').mockReturnValue({ ...DEFAULT_STYLE, fontFamily: 'monospace' } as any);

      const elems = ssc.generatePElementInnerTranslate(pElem, document, parentElem, new ssc.SevenSeasECOptions(), {});

      expect(elems).toHaveLength(1);
      expect(elems[0].nodeName).toBe('CODE');
      expect(elems[0].textContent).toBe('Code text');
    });

    it('should preserve the element id', () => {
      const document = createDocument('<html><body></body></html>');
      const pElem = document.createElement('p');
      pElem.id = 'test-id';
      pElem.textContent = 'Bold text';
      const parentElem = document.createElement('div');

      vi.spyOn(document.defaultView!, 'getComputedStyle').mockReturnValue({ ...DEFAULT_STYLE, fontWeight: 'bold' } as any);

      const elems = ssc.generatePElementInnerTranslate(pElem, document, parentElem, new ssc.SevenSeasECOptions(), {});

      expect(elems).toHaveLength(1);
      expect((elems[0] as Element).id).toBe('test-id');
    });
  });
});
