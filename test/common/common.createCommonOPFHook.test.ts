import { afterEach, describe, expect, it } from 'vitest';
import * as utils from '../../src/utils.js';
import * as common from '../../src/common/common.js';
import * as epubh from '../../src/helpers/epub.js';
import * as htmltp from '../../src/helpers/htmlTextProcessing.js';
import * as xh from '../../src/helpers/xml.js';

describe('common createCommonOPFHook', () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    for (const cleanupPath of cleanupPaths.splice(0)) {
      await utils.removeDir(cleanupPath);
    }
  });

  const createContext = (title: string) => {
    const ctx = new epubh.EpubContext<htmltp.TextProcessingECOptions>({
      title,
      optionsClass: new htmltp.TextProcessingECOptions(),
    });

    cleanupPaths.push(ctx.rootDir);

    return ctx;
  };

  const createInputDocument = (metadata: string) => {
    const { document } = xh.newJSDOM(
      `<package unique-identifier="pub-id"><metadata xmlns:dc="${xh.STATICS.DC_XML_NAMESPACE}">${metadata}</metadata></package>`,
      { contentType: xh.STATICS.XML_MIMETYPE }
    );

    return document;
  };

  const createOutputDocument = () => {
    const { document } = xh.newJSDOM('<package><metadata></metadata><manifest></manifest><spine></spine></package>', {
      contentType: xh.STATICS.XML_MIMETYPE,
    });

    return {
      document,
      metadataElem: xh.queryDefinedElement(document, 'metadata'),
      manifestElem: xh.queryDefinedElement(document, 'manifest'),
      spineElem: xh.queryDefinedElement(document, 'spine'),
    };
  };

  const runHook = (inputDocument: Document, title: string, idCounter: number, seriesRegex?: RegExp): Element => {
    const ctx = createContext(title);
    const output = createOutputDocument();
    const hook = common.createCommonOPFHook(inputDocument, ctx, seriesRegex);

    hook({
      document: output.document,
      idCounter,
      metadataElem: output.metadataElem,
      manifestElem: output.manifestElem,
      spineElem: output.spineElem,
    });

    return output.metadataElem;
  };

  const getMeta = (metadataElem: Element, property: string) => {
    return Array.from(metadataElem.children).find((elem) => elem.localName === 'meta' && elem.getAttribute('property') === property);
  };

  it('should copy metadata and apply the series from the title', () => {
    const inputDocument = createInputDocument(`
      <dc:title>Old Title</dc:title>
      <dc:creator>Author</dc:creator>
      <dc:language>en</dc:language>
      <dc:identifier id="pub-id">123</dc:identifier>
    `);

    const metadataElem = runHook(inputDocument, 'Some Story Vol. 2', 5);
    const children = Array.from(metadataElem.children);
    const byLocalName = (name: string) => children.filter((elem) => elem.localName === name);

    expect(byLocalName('title')).toHaveLength(0);
    expect(byLocalName('creator')[0].textContent).toBe('Author');
    expect(byLocalName('creator')[0].getAttribute('id')).toBe('id-6');
    expect(byLocalName('language')[0].textContent).toBe('en');
    expect(byLocalName('identifier')[0].textContent).toBe('123');
    expect(byLocalName('identifier')[0].getAttribute('id')).toBe('pub-id');

    const collectionElem = getMeta(metadataElem, 'belongs-to-collection');
    expect(collectionElem?.getAttribute('id')).toBe('id-7');
    expect(collectionElem?.textContent).toBe('Some Story');
    expect(getMeta(metadataElem, 'collection-type')?.textContent).toBe('series');
    expect(getMeta(metadataElem, 'group-position')?.textContent).toBe('2');
  });

  it('should default the series volume to 1', () => {
    const inputDocument = createInputDocument('<dc:creator>Author</dc:creator>');

    const metadataElem = runHook(inputDocument, 'Some Story', 0);

    expect(getMeta(metadataElem, 'belongs-to-collection')?.textContent).toBe('Some Story');
    expect(getMeta(metadataElem, 'group-position')?.textContent).toBe('1');
  });

  it('should use a custom series regex', () => {
    const inputDocument = createInputDocument('<dc:creator>Author</dc:creator>');
    const seriesRegex = /^(?<series>.+?)(?:,? (?:Vol\.|Volume) (?<num>\d+)(?: \(light novel\))?)?$/im;

    const metadataElem = runHook(inputDocument, 'Some Story, Volume 3 (light novel)', 0, seriesRegex);

    expect(getMeta(metadataElem, 'belongs-to-collection')?.textContent).toBe('Some Story');
    expect(getMeta(metadataElem, 'group-position')?.textContent).toBe('3');
  });

  it('should not apply series metadata when the custom regex does not match', () => {
    const inputDocument = createInputDocument('<dc:creator>Author</dc:creator>');

    const metadataElem = runHook(inputDocument, 'Some Story', 0, /^Does Not Match$/);

    expect(getMeta(metadataElem, 'belongs-to-collection')).toBeUndefined();
    expect(getMeta(metadataElem, 'collection-type')).toBeUndefined();
    expect(getMeta(metadataElem, 'group-position')).toBeUndefined();
  });
});
