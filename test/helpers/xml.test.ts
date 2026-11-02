import { describe, expect, it } from 'vitest';
import * as xh from '../../src/helpers/xml.js';

describe('xmlHelpers', () => {
  describe('definedElement', () => {
    it('should return the given element when it is defined', () => {
      const { document } = xh.newJSDOM('<html><body><div id="test">Hello</div></body></html>');

      const elem = xh.definedElement(document.querySelector('#test') as Element, 'test');

      expect(elem.textContent).toBe('Hello');
    });

    it('should throw an error when the element is not defined', () => {
      expect(() => xh.definedElement(undefined, 'test')).toThrow(/Expected Node "test" to be defined/);
      expect(() => xh.definedElement(null, 'test')).toThrow(/Expected Node "test" to be defined/);
    });
  });

  describe('definedElementAll', () => {
    it('should return the given element list when it is defined and not empty', () => {
      const { document } = xh.newJSDOM('<html><body><div></div><div></div></body></html>');

      const elems = xh.definedElementAll(document.querySelectorAll('div'), 'divs');

      expect(elems.length).toBe(2);
    });

    it('should throw an error when the element list is empty', () => {
      const { document } = xh.newJSDOM('<html><body></body></html>');

      expect(() => xh.definedElementAll(document.querySelectorAll('div'), 'divs')).toThrow('Expected NodeList for "divs" to not be 0');
    });

    it('should throw an error when the element list is not defined', () => {
      expect(() => xh.definedElementAll(undefined, 'divs')).toThrow(/Expected NodeList for "divs" to be defined/);
    });
  });

  describe('queryDefinedElement', () => {
    it('should find an element with a css selector', () => {
      const { document } = xh.newJSDOM('<html><body><section><p id="chapter">Chapter 1</p></section></body></html>');

      const elem = xh.queryDefinedElement(document, 'section > p');

      expect(elem.id).toBe('chapter');
      expect(elem.textContent).toBe('Chapter 1');
    });

    it('should throw an error when the element cannot be found', () => {
      const { document } = xh.newJSDOM('<html><body></body></html>');

      expect(() => xh.queryDefinedElement(document, 'body > section')).toThrow(/Expected Node "body > section" to be defined/);
    });
  });

  describe('queryDefinedElementAll', () => {
    it('should find all elements with a css selector', () => {
      const { document } = xh.newJSDOM('<html><body><p>One</p><p>Two</p></body></html>');

      const elems = xh.queryDefinedElementAll(document, 'p');

      expect(elems.length).toBe(2);
      expect(Array.from(elems).map((v) => v.textContent)).toEqual(['One', 'Two']);
    });

    it('should throw an error when no elements can be found', () => {
      const { document } = xh.newJSDOM('<html><body></body></html>');

      expect(() => xh.queryDefinedElementAll(document, 'section')).toThrow('Expected NodeList for "section" to not be 0');
    });
  });

  describe('newJSDOM', () => {
    it('should return the dom and the document', () => {
      const { dom, document } = xh.newJSDOM('<html><head><title>Test</title></head><body></body></html>', {
        contentType: xh.STATICS.XHTML_MIMETYPE,
      });

      expect(dom).toBeDefined();
      expect(document).toBeDefined();
      expect(document.querySelector('head > title')?.textContent).toBe('Test');
    });

    it('should accept buffer input', () => {
      const { document } = xh.newJSDOM(Buffer.from('<html><head><title>Test</title></head><body></body></html>'));

      expect(document.querySelector('head > title')?.textContent).toBe('Test');
    });
  });

  describe('applyAttributes', () => {
    it('should apply multiple attributes at once', () => {
      const { document } = xh.newJSDOM('<html><body></body></html>');
      const elem = document.createElement('div');

      xh.applyAttributes(elem, { id: 'myid', class: 'myclass', 'data-foo': 'bar' });

      expect(elem.id).toBe('myid');
      expect(elem.className).toBe('myclass');
      expect(elem.getAttribute('data-foo')).toBe('bar');
    });
  });
});
