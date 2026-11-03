import { describe, expect, it, vi } from 'vitest';
import * as ssc from '../../src/common/sevenseascommon.js';
import * as epubh from '../../src/helpers/epub.js';
import * as htmltp from '../../src/helpers/htmlTextProcessing.js';
import * as xh from '../../src/helpers/xml.js';

describe('sevenseasCommon', () => {
  const emptyConfig: ssc.SevenSeasConfig = {};
  const { document } = xh.newJSDOM('<html><body></body></html>');

  const mockedCompStyles = {
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
    const { document: doc } = xh.newJSDOM(html);

    // jsdom's "getComputedStyle" is currently broken in this environment, so mock the styles needed for the style handling
    vi.spyOn(doc.defaultView!, 'getComputedStyle').mockReturnValue(mockedCompStyles as any);

    return doc;
  };

  const createEntryType = (overrides: Partial<ssc.EntryInformationExt> = {}): ssc.EntryInformationExt => ({
    type: htmltp.EntryType.Text,
    title: 'Chapter 1',
    firstLine: 'Chapter 1',
    imgType: epubh.ImgType.Insert,
    ...overrides,
  });

  describe('matcher', () => {
    it('should detect supported series names', () => {
      const sevenSeasMatcher = ssc.matcher(new RegExp('Some Series', 'gi'));

      expect(sevenSeasMatcher('Some Series - Book 1')).toBe(true);
      expect(sevenSeasMatcher('some series')).toBe(true);
      expect(sevenSeasMatcher('Some Other Series')).toBe(false);
    });

    it('should reset the regex state after every check', () => {
      const sevenSeasMatcher = ssc.matcher(new RegExp('Some Series', 'gi'));

      expect(sevenSeasMatcher('Some Series')).toBe(true);
      expect(sevenSeasMatcher('Some Series')).toBe(true);
    });
  });

  describe('compareEntryInformation', () => {
    it('should compare full entries', () => {
      const last = createEntryType({ title: 'Chapter 1', imgType: epubh.ImgType.Insert });

      expect(ssc.compareEntryInformationFull(last, createEntryType({ title: 'Chapter 1', imgType: epubh.ImgType.Insert }))).toBe(true);
      expect(ssc.compareEntryInformationFull(last, createEntryType({ title: 'Chapter 2', imgType: epubh.ImgType.Insert }))).toBe(false);
      expect(ssc.compareEntryInformationFull(last, createEntryType({ title: 'Chapter 1', imgType: epubh.ImgType.Frontmatter }))).toBe(
        false
      );
    });

    it('should compare entries by title and image type', () => {
      const last = createEntryType({ title: 'Chapter 1', imgType: epubh.ImgType.Insert });

      expect(ssc.compareEntryInformationTitle(last, createEntryType({ title: 'Chapter 1', imgType: epubh.ImgType.Insert }))).toBe(true);
      expect(ssc.compareEntryInformationTitle(last, createEntryType({ title: 'Chapter 2', imgType: epubh.ImgType.Insert }))).toBe(false);
      expect(ssc.compareEntryInformationTitle(last, createEntryType({ title: 'Chapter 1', imgType: epubh.ImgType.Backmatter }))).toBe(
        false
      );
    });
  });

  describe('determineReset', () => {
    it('should return "true" by default', () => {
      const options = new ssc.SevenSeasECOptions();
      const entryType = createEntryType();

      expect(ssc.determineReset(document, entryType, options)).toBe(true);
    });

    it('should return "false" for matching frontmatter entries', () => {
      const options = new ssc.SevenSeasECOptions();
      options.lastEntryType = createEntryType({ title: 'Chapter 1', imgType: epubh.ImgType.Frontmatter });
      const entryType = createEntryType({ title: 'Chapter 1', imgType: epubh.ImgType.Frontmatter });

      expect(ssc.determineReset(document, entryType, options)).toBe(false);
    });

    it('should return "true" for differing frontmatter entries', () => {
      const options = new ssc.SevenSeasECOptions();
      options.lastEntryType = createEntryType({ title: 'Chapter 1', imgType: epubh.ImgType.Frontmatter });
      const entryType = createEntryType({ title: 'Chapter 2', imgType: epubh.ImgType.Frontmatter });

      expect(ssc.determineReset(document, entryType, options)).toBe(true);
    });

    it('should return "false" for a insert that follows the same title', () => {
      const options = new ssc.SevenSeasECOptions();
      options.lastEntryType = createEntryType({ title: 'Chapter 1', imgType: epubh.ImgType.Insert });
      const entryType = createEntryType({ title: 'Chapter 1', imgType: epubh.ImgType.Insert });

      expect(ssc.determineReset(document, entryType, options)).toBe(false);
    });
  });

  describe('genTextIdData', () => {
    it('should default to a chapter section id', () => {
      const options = new ssc.SevenSeasECOptions();

      const res = ssc.genTextIdData(options, createEntryType(), { increasedChapterWithTitle: false });

      expect(res.sectionId).toBe('chapter0');
      expect(res.useType).toEqual({ type: epubh.EpubContextFileXHTMLTypes.TEXT });
    });

    it('should add a subchapter number when required', () => {
      const options = new ssc.SevenSeasECOptions();
      options.incTracker('CurrentSubChapter');

      const res = ssc.genTextIdData(options, createEntryType(), { increasedChapterWithTitle: false });

      expect(res.sectionId).toBe('chapter0_1');
    });

    it('should use the copyright section id and type for copyright entries', () => {
      const options = new ssc.SevenSeasECOptions();

      const res = ssc.genTextIdData(
        options,
        createEntryType({ title: 'Copyrights and Credits', firstLine: 'Copyrights and Credits', imgType: epubh.ImgType.Frontmatter }),
        {
          increasedChapterWithTitle: false,
        }
      );

      expect(res.sectionId).toBe('copyright');
      expect(res.useType).toEqual({ type: epubh.EpubContextFileXHTMLTypes.CREDITS });
    });

    it('should use the afterword section id for afterword entries', () => {
      const options = new ssc.SevenSeasECOptions();
      options.incTracker('Chapter');
      options.incTracker('Chapter');

      const res = ssc.genTextIdData(
        options,
        createEntryType({ title: 'Afterword', firstLine: 'Afterword', imgType: epubh.ImgType.Backmatter }),
        {
          increasedChapterWithTitle: true,
        }
      );

      expect(res.sectionId).toBe('afterword');
      expect(options.getTracker('Chapter')).toBe(1); // was decremented again because of the "afterword"
    });
  });

  describe('genImgIdData', () => {
    it('should generate insert image data', () => {
      const options = new ssc.SevenSeasECOptions();
      options.setImgTypeImplicit(epubh.ImgType.Insert);
      const entryType = createEntryType({
        type: htmltp.EntryType.Text,
        title: 'Chapter 1',
        firstLine: 'Chapter 1',
        imgType: epubh.ImgType.Insert,
      });
      const imgNode = document.createElement('img');

      const res = ssc.genImgIdData(options, '/converty/Insert1.png', imgNode, entryType);

      expect(res.imgClass).toBe(epubh.ImgClass.Insert);
      expect(res.sectionId).toBe('insert1.png');
      expect(res.imgFilename).toBe('Insert1.png');
      expect(res.xhtmlFilename).toBe('insert1');
      expect(res.useType?.type).toBe(epubh.EpubContextFileXHTMLTypes.IMG);
      expect(res.useType?.imgClass).toBe(epubh.ImgClass.Insert);
      expect(res.useType?.imgType).toBe(epubh.ImgType.Insert);
    });

    it('should generate frontmatter image data', () => {
      const options = new ssc.SevenSeasECOptions();
      options.setImgTypeImplicit(epubh.ImgType.Frontmatter);
      const entryType = createEntryType({
        type: htmltp.EntryType.Text,
        title: 'Copyrights and Credits',
        firstLine: 'Copyrights and Credits',
        imgType: epubh.ImgType.Frontmatter,
      });
      const imgNode = document.createElement('img');

      const res = ssc.genImgIdData(options, '/converty/Frontmatter1.png', imgNode, entryType);

      expect(res.imgClass).toBe(epubh.ImgClass.Insert);
      expect(res.sectionId).toBe('frontmatter1.png');
      expect(res.imgFilename).toBe('Frontmatter1.png');
      expect(res.xhtmlFilename).toBe('frontmatter1');
      expect(res.useType?.imgType).toBe(epubh.ImgType.Frontmatter);
    });

    it('should generate backmatter image data', () => {
      const options = new ssc.SevenSeasECOptions();
      options.setImgTypeImplicit(epubh.ImgType.Backmatter);
      const entryType = createEntryType({
        type: htmltp.EntryType.Text,
        title: 'Afterword',
        firstLine: 'Afterword',
        imgType: epubh.ImgType.Backmatter,
      });
      const imgNode = document.createElement('img');

      const res = ssc.genImgIdData(options, '/converty/Backmatter1.png', imgNode, entryType);

      expect(res.imgClass).toBe(epubh.ImgClass.Insert);
      expect(res.sectionId).toBe('backmatter1.png');
      expect(res.imgFilename).toBe('Backmatter1.png');
      expect(res.xhtmlFilename).toBe('backmatter1');
      expect(res.useType?.imgType).toBe(epubh.ImgType.Backmatter);
    });

    it('should generate cover image data', () => {
      const options = new ssc.SevenSeasECOptions();
      const entryType = createEntryType({
        type: htmltp.EntryType.Text,
        title: 'Cover Page',
        firstLine: 'Cover Page',
        imgType: epubh.ImgType.Cover,
      });
      const imgNode = document.createElement('img');

      const res = ssc.genImgIdData(options, '/converty/cover.png', imgNode, entryType);

      expect(res.imgClass).toBe(epubh.ImgClass.Cover);
      expect(res.sectionId).toBe('cover.png');
      expect(res.imgFilename).toBe('Cover.png');
      expect(res.xhtmlFilename).toBe('cover');
      expect(res.useType?.imgType).toBe(epubh.ImgType.Cover);
    });
  });

  describe('titleHelpers', () => {
    it('should convert a title for easier comparison', () => {
      expect(ssc.convertTitleCompare('Chapter 1')).toBe('Chapter1');
      expect(ssc.convertTitleCompare('Chapter 1…')).toBe('Chapter1...');
    });

    it('should process titles to lowercase without spaces', () => {
      expect(ssc.processTitles(['Chapter 1', 'AFTERWORD', 'Table of Contents Page'])).toEqual([
        'chapter1',
        'afterword',
        'tableofcontentspage',
      ]);
      expect(ssc.preProcessTitle('Chapter 1')).toBe('chapter1');
    });

    it('should detect cover titles', () => {
      expect(ssc.isTitleCover('cover')).toBe(true);
      expect(ssc.isTitleCover('coverpage')).toBe(true);
      expect(ssc.isTitleCover('Some Random Title')).toBe(false);
    });
  });

  describe('getTitle', () => {
    it('should parse a simple chapter title', () => {
      const ret = ssc.getTitle('Chapter 1', emptyConfig);

      expect(ret.title).toBe('Chapter 1');
      expect(ret.firstLine).toBe('Chapter 1');
      expect(ret.secondLine).toBeUndefined();
      expect(ret.type).toBe(htmltp.EntryType.Text);
      expect(ret.imgType).toBe(epubh.ImgType.Insert);
    });

    it('should parse a chapter title with a subtitle', () => {
      const ret = ssc.getTitle('Chapter 2: The Beginning', emptyConfig);

      expect(ret.firstLine).toBe('Chapter 2:');
      expect(ret.secondLine).toBe('The Beginning');
      expect(ret.title).toBe('Chapter 2: The Beginning');
    });

    it('should detect a cover title', () => {
      const ret = ssc.getTitle('Cover', emptyConfig);

      expect(ret.imgType).toBe(epubh.ImgType.Cover);
    });

    it('should ignore the table of contents', () => {
      const ret = ssc.getTitle('Table of Contents', emptyConfig);

      expect(ret.type).toBe(htmltp.EntryType.Ignore);
    });

    it('should detect an afterword as backmatter', () => {
      const ret = ssc.getTitle('Afterword', emptyConfig);

      expect(ret.imgType).toBe(epubh.ImgType.Backmatter);
    });

    it('should strip the "image" suffix from titles', () => {
      const ret = ssc.getTitle('Chapter 1: Hero Image', emptyConfig);

      expect(ret.title).toBe('Chapter 1: Hero');
    });
  });

  describe('isTitle', () => {
    const entryType = createEntryType({ title: 'Chapter 1', firstLine: 'Chapter 1' });
    const optionsClass = new ssc.SevenSeasECOptions();

    it('should return false for empty titles', () => {
      const elem = document.createElement('p');
      elem.textContent = '   ';

      expect(ssc.isTitle(document, elem, entryType, optionsClass)).toBe(false);
    });

    it('should return the title when it matches', () => {
      const elem = document.createElement('h1');
      elem.textContent = 'Chapter 1';

      expect(ssc.isTitle(document, elem, entryType, optionsClass)).toBe('Chapter 1');
    });

    it('should return true for auto book mark toc elements', () => {
      const elem = document.createElement('h1');
      elem.id = 'auto_bookmark_toc_chapter_1';
      elem.textContent = 'Totally Different';

      expect(ssc.isTitle(document, elem, entryType, optionsClass)).toBe(true);
    });

    it('should detect a new chapter heading by content when the head title does not match', () => {
      const doc = createDocument('<html><body><h1>Different Chapter Heading</h1></body></html>');
      const elem = doc.querySelector('h1')!;

      vi.spyOn(doc.defaultView!, 'getComputedStyle').mockImplementation((styleElem) => {
        return {
          ...mockedCompStyles,
          fontSize: styleElem === doc.body ? '10px' : '20px',
        } as any;
      });

      expect(ssc.isTitle(doc, elem, createEntryType({ title: 'Chapter 1' }), new ssc.SevenSeasECOptions())).toBe(
        'Different Chapter Heading'
      );
    });
  });

  describe('getTextContentBody', () => {
    it('should return all body children', () => {
      const { document } = xh.newJSDOM('<html><body><h1>Chapter 1</h1><p>Some text</p></body></html>');

      const children = ssc.getTextContentBody(document);

      expect(children).toHaveLength(2);
      expect(children[0].localName).toBe('h1');
      expect(children[1].localName).toBe('p');
    });
  });

  describe('generatePElementInner', () => {
    it('should return text nodes as they are', () => {
      const doc = createDocument('<html><body></body></html>');
      const textNode = doc.createTextNode('Some text');

      const elems = ssc.generatePElementInner(textNode, doc, doc.createElement('div'), new ssc.SevenSeasECOptions(), emptyConfig);

      expect(elems).toHaveLength(1);
      expect(elems[0].nodeType).toBe(3); // "Node.TEXT_NODE"
      expect(elems[0].textContent).toBe('Some text');
    });

    it('should return the children of a plain element directly', () => {
      const doc = createDocument('<html><body></body></html>');
      const pElem = doc.createElement('p');
      pElem.textContent = 'Some text';

      const elems = ssc.generatePElementInner(pElem, doc, doc.createElement('div'), new ssc.SevenSeasECOptions(), emptyConfig);

      expect(elems).toHaveLength(1);
      expect(elems[0].nodeType).toBe(3); // "Node.TEXT_NODE"
      expect(elems[0].textContent).toBe('Some text');
    });

    it('should wrap content into a "strong" element when bold', () => {
      const doc = createDocument('<html><body></body></html>');
      const strongElem = doc.createElement('strong');
      strongElem.textContent = 'Bold text';

      vi.spyOn(doc.defaultView!, 'getComputedStyle').mockReturnValue({ ...mockedCompStyles, fontWeight: 'bold' } as any);

      const elems = ssc.generatePElementInner(strongElem, doc, doc.createElement('div'), new ssc.SevenSeasECOptions(), emptyConfig);

      expect(elems).toHaveLength(1);
      expect(elems[0].nodeName).toBe('STRONG');
      expect(elems[0].textContent).toBe('Bold text');
    });

    it('should remove colored styles from the output', () => {
      const doc = createDocument('<html><body><p style="color: #fff">test</p></body></html>');
      const pElem = doc.querySelector('p')!;
      const parentElem = doc.createElement('div');

      const elems = ssc.generatePElementInner(pElem, doc, parentElem, new ssc.SevenSeasECOptions(), emptyConfig);

      // the parent element must not be modified, for example by applying the color style to it
      expect(parentElem.outerHTML).toBe('<div></div>');
      expect(parentElem.attributes).toHaveLength(0);
      expect(parentElem.childNodes).toHaveLength(0);

      expect(elems).toHaveLength(1);
      expect(elems[0].nodeType).toBe(doc.TEXT_NODE);
      expect(elems[0].textContent).toBe('test');

      for (const elem of elems) {
        expect(elem.textContent).not.toContain('color');
        expect(elem.textContent).not.toContain('#fff');

        if (elem.nodeType === doc.ELEMENT_NODE) {
          expect((elem as Element).getAttribute('style')).toBeNull();
        }
      }
    });

    it('should return "br" elements directly', () => {
      const doc = createDocument('<html><body></body></html>');
      const brElem = doc.createElement('br');

      const elems = ssc.generatePElementInner(brElem, doc, doc.createElement('div'), new ssc.SevenSeasECOptions(), emptyConfig);

      expect(elems).toHaveLength(1);
      expect(elems[0].nodeName).toBe('BR');
      expect(elems[0].nodeType).toBe(1); // "Node.ELEMENT_NODE"
    });

    it('should combine with the last node when the previous node did not end correctly', () => {
      const doc = createDocument('<html><body><div class="main"><p>Some text </p></div></body></html>');
      const mainElem = doc.querySelector('.main')!;
      const parentElem = mainElem;

      const origNode = doc.createElement('p');
      origNode.textContent = 'More text here';

      const elems = ssc.generatePElementInner(origNode, doc, parentElem, new ssc.SevenSeasECOptions(), emptyConfig);

      expect(elems).toHaveLength(0);
      expect(mainElem.lastChild?.textContent).toBe('Some text More text here');
    });

    it('should not combine when the custom combine hook prevents it', () => {
      const doc = createDocument('<html><body><div class="main"><p>Some text </p></div></body></html>');
      const mainElem = doc.querySelector('.main')!;
      const parentElem = mainElem;

      const origNode = doc.createElement('p');
      origNode.textContent = 'More text here';

      const config: ssc.SevenSeasConfig = { generatePElementCombineHook: () => true };
      const elems = ssc.generatePElementInner(origNode, doc, parentElem, new ssc.SevenSeasECOptions(), config);

      expect(elems).toHaveLength(1);
      expect(elems[0].nodeType).toBe(3); // "Node.TEXT_NODE"
      expect(mainElem.lastChild?.textContent).toBe('Some text ');
    });
  });
});
