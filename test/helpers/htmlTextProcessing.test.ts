import { describe, expect, it } from 'vitest';
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
});
