import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fspromises } from 'fs';
import * as path from 'path';
import * as utils from '../../src/utils.js';
import genericCopy_ln from '../../src/modules/genericCopy_ln.js';
import { createEpubFixture, EpubFixture } from '../fixtures/epub.js';

const SERIES_TITLE = 'Death March to the Parallel World Rhapsody Vol. 1';

describe('genericCopy_ln process', () => {
  const cleanupPaths: string[] = [];

  const runGenericCopy = async (fixture: EpubFixture) => {
    const workDir = await utils.createTmpDir('converty-generic-copy-');
    cleanupPaths.push(workDir);
    const outputDir = path.join(workDir, 'output');
    await utils.mkdir(outputDir);

    const resultPath = await genericCopy_ln().process({
      converterInputPath: fixture.rootDir,
      converterOutputPath: outputDir,
      fileInputPath: fixture.rootDir,
    });

    return { resultPath, outputDir };
  };

  beforeEach(() => {
    process.env['DEBUG_OUTPUT'] = '1';
  });

  afterEach(async () => {
    delete process.env['DEBUG_OUTPUT'];

    for (const cleanupPath of cleanupPaths.splice(0)) {
      await utils.removeDir(cleanupPath);
    }
  });

  it('should process a basic epub and find the cover via the metadata fallback', async () => {
    const fixture = await createEpubFixture({ title: SERIES_TITLE });
    cleanupPaths.push(fixture.rootDir);

    const { resultPath, outputDir } = await runGenericCopy(fixture);

    expect(resultPath).toBe(path.resolve(outputDir, SERIES_TITLE));

    const contentOPF = await fspromises.readFile(path.join(resultPath, 'OEBPS', 'content.opf'), 'utf-8');
    expect(contentOPF).toContain('<dc:title>Death March to the Parallel World Rhapsody Vol. 1</dc:title>');
    expect(contentOPF).toContain('property="belongs-to-collection"');
    expect(contentOPF).toMatch(/<meta[^>]+property="belongs-to-collection"[^>]*>\s*Death March to the Parallel World Rhapsody\s*<\/meta>/);
    expect(contentOPF).toContain('property="collection-type">series</meta>');
    expect(contentOPF).toContain('property="group-position">1</meta>');
    expect(contentOPF).toContain('id="cover.png"');
    expect(contentOPF).toContain('<meta name="cover" content="cover.png" />');

    const textFiles = (await fspromises.readdir(path.join(resultPath, 'OEBPS', 'Text'))).sort();
    expect(textFiles).toEqual(['chapter-1.xhtml', 'chapter-2.xhtml', 'toc.xhtml']);

    const chapter1 = await fspromises.readFile(path.join(resultPath, 'OEBPS', 'Text', 'chapter-1.xhtml'), 'utf-8');
    expect(chapter1).toContain('<title>Chapter 1</title>');
    expect(chapter1).toContain('Lorem ipsum dolor sit amet.');

    const chapter2 = await fspromises.readFile(path.join(resultPath, 'OEBPS', 'Text', 'chapter-2.xhtml'), 'utf-8');
    expect(chapter2).toContain('<title>Chapter 2</title>');
    expect(chapter2).toContain('Consectetur adipiscing elit.');

    expect(await utils.pathExists(path.join(resultPath, 'OEBPS', 'Images', 'cover.png'))).toBe(true);
    expect(await utils.pathExists(path.join(resultPath, 'OEBPS', 'Styles', 'stylesheet.css'))).toBe(true);
  });

  it('should find the cover via the manifest properties', async () => {
    const fixture = await createEpubFixture({
      title: SERIES_TITLE,
      coverLookup: 'properties',
    });
    cleanupPaths.push(fixture.rootDir);

    const { resultPath } = await runGenericCopy(fixture);

    const contentOPF = await fspromises.readFile(path.join(resultPath, 'OEBPS', 'content.opf'), 'utf-8');
    expect(contentOPF).toContain('<meta name="cover" content="cover.png" />');
    expect(contentOPF).toContain('id="cover.png"');
    expect(contentOPF).toContain('properties="cover-image"');

    expect(await utils.pathExists(path.join(resultPath, 'OEBPS', 'Images', 'cover.png'))).toBe(true);
  });

  it('should skip an input toc that is detected by filename', async () => {
    const fixture = await createEpubFixture({
      title: SERIES_TITLE,
      coverLookup: 'properties',
      chapters: [
        {
          id: 'nav-input',
          href: 'Text/nav.xhtml',
          title: 'Contents',
          body: '<p>INPUT_NAV_MARKER</p>',
        },
      ],
    });
    cleanupPaths.push(fixture.rootDir);

    const { resultPath } = await runGenericCopy(fixture);

    const textDir = path.join(resultPath, 'OEBPS', 'Text');
    const textFiles = (await fspromises.readdir(textDir)).sort();
    expect(textFiles).toEqual(['chapter-1.xhtml', 'chapter-2.xhtml', 'toc.xhtml']);

    const generatedTOC = await fspromises.readFile(path.join(textDir, 'toc.xhtml'), 'utf-8');
    expect(generatedTOC).not.toContain('INPUT_NAV_MARKER');
  });

  it('should skip an input toc that is detected by title', async () => {
    const fixture = await createEpubFixture({
      title: SERIES_TITLE,
      coverLookup: 'properties',
      chapters: [
        {
          id: 'contents-input',
          href: 'Text/contents.xhtml',
          title: 'Table of Contents',
          body: '<h1>Table of Contents</h1><p>INPUT_TITLE_MARKER</p>',
        },
      ],
    });
    cleanupPaths.push(fixture.rootDir);

    const { resultPath } = await runGenericCopy(fixture);

    const textDir = path.join(resultPath, 'OEBPS', 'Text');
    const textFiles = (await fspromises.readdir(textDir)).sort();
    expect(textFiles).toEqual(['chapter-1.xhtml', 'chapter-2.xhtml', 'toc.xhtml']);

    const generatedTOC = await fspromises.readFile(path.join(textDir, 'toc.xhtml'), 'utf-8');
    expect(generatedTOC).not.toContain('INPUT_TITLE_MARKER');
  });

  it('should preserve an input toc that contains images', async () => {
    const fixture = await createEpubFixture({
      title: SERIES_TITLE,
      coverLookup: 'properties',
      chapters: [
        {
          id: 'contents-image',
          href: 'Text/contents-image.xhtml',
          title: 'Table of Contents',
          body: '<h1>Table of Contents</h1><p>TOC_IMAGE_MARKER</p><p><img src="../Images/toc-image.png" alt="Contents" /></p>',
        },
      ],
      extraFiles: [
        {
          path: 'Images/toc-image.png',
          content: Buffer.from('fake-toc-image-data'),
        },
      ],
    });
    cleanupPaths.push(fixture.rootDir);

    const { resultPath } = await runGenericCopy(fixture);

    const textDir = path.join(resultPath, 'OEBPS', 'Text');
    const contents = await fspromises.readFile(path.join(textDir, 'contents-image.xhtml'), 'utf-8');
    expect(contents).toContain('TOC_IMAGE_MARKER');
    expect(contents).toContain('../Images/toc-image.png');

    const copiedImagePath = path.join(resultPath, 'OEBPS', 'Images', 'toc-image.png');
    expect(await utils.pathExists(copiedImagePath)).toBe(true);
    expect(await fspromises.readFile(copiedImagePath)).toEqual(Buffer.from('fake-toc-image-data'));
  });

  it('should remove processing instructions', async () => {
    const fixture = await createEpubFixture({
      title: SERIES_TITLE,
      coverLookup: 'properties',
      chapters: [
        {
          id: 'processing-instructions',
          href: 'Text/processing-instructions.xhtml',
          title: 'Processing Instructions',
          body: '<p>Before</p><?HBG-PAGE-NUMBER 1?><p>After</p>',
        },
      ],
    });
    cleanupPaths.push(fixture.rootDir);

    const { resultPath } = await runGenericCopy(fixture);

    const contents = await fspromises.readFile(path.join(resultPath, 'OEBPS', 'Text', 'processing-instructions.xhtml'), 'utf-8');
    expect(contents).toContain('Before');
    expect(contents).toContain('After');
    expect(contents).not.toContain('HBG-PAGE-NUMBER');
  });
});
