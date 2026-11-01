import { describe, expect, it } from 'vitest';
import * as path from 'path';
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
});
