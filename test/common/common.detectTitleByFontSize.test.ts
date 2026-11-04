import { afterEach, describe, expect, it, vi } from 'vitest';
import * as common from '../../src/common/common.js';
import * as xh from '../../src/helpers/xml.js';

const DEFAULT_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: '16px',
};

describe('common detectTitleByFontSize', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createNestedDocument = (getFontSize: (elem: Element) => string, extraContent?: string) => {
    const content = extraContent ? extraContent : 'Chapter 1';
    const { document } = xh.newJSDOM(`<html><body><p id="target">${content}</p></body></html>`);

    vi.spyOn(document.defaultView!, 'getComputedStyle').mockImplementation((elem) => {
      return {
        ...DEFAULT_STYLE,
        fontSize: getFontSize(elem),
      } as CSSStyleDeclaration;
    });

    return xh.queryDefinedElement(document, '#target');
  };

  it('should detect a title at the font size threshold', () => {
    const elem = createNestedDocument((styleElem) => (styleElem === styleElem.ownerDocument.body ? '10px' : '13px'));

    expect(common.detectTitleByFontSize(elem)).toBe('Chapter 1');
  });

  it('should return false below the font size threshold', () => {
    const elem = createNestedDocument((styleElem) => (styleElem === styleElem.ownerDocument.body ? '10px' : '12px'));

    expect(common.detectTitleByFontSize(elem)).toBe(false);
  });

  it('should use the first child element for the font size and content', () => {
    const elem = createNestedDocument(
      (styleElem) => (styleElem.tagName === 'SPAN' ? '13px' : '10px'),
      '<span>Wrapped Title</span><span>Ignored</span>'
    );

    expect(common.detectTitleByFontSize(elem)).toBe('Wrapped Title');
  });

  it('should use the provided title cache', () => {
    const elem = createNestedDocument((styleElem) => (styleElem === styleElem.ownerDocument.body ? '100px' : '13px'));

    const titleCache: common.IsTitleCache = {
      bodyFontSizePx: 10,
      window: elem.ownerDocument.defaultView!,
    };

    expect(common.detectTitleByFontSize(elem, titleCache)).toBe('Chapter 1');
  });

  it('should fall back to the body font size when the computed font size is invalid', () => {
    const elem = createNestedDocument((styleElem) => (styleElem === styleElem.ownerDocument.body ? '100px' : 'not-a-font-size'));

    const titleCache: common.IsTitleCache = {
      bodyFontSizePx: 10,
      window: elem.ownerDocument.defaultView!,
    };

    expect(common.detectTitleByFontSize(elem, titleCache)).toBe(false);
  });
});
