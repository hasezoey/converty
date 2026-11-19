import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { promises as fspromises } from 'fs';
import * as path from 'path';
import * as utils from '../../src/utils.js';
import crossinfworld_ln from '../../src/modules/crossinfworld_ln.js';
import { createEpubFixture } from '../fixtures/epub.js';
import * as xh from '../../src/helpers/xml.js';

// jsdom's "getComputedStyle" is broken for XML documents in this environment,
// so provide the default styles that the processing code expects.
vi.mock('../../src/helpers/xml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/helpers/xml.js')>();
  const defaultStyle = {
    fontWeight: 'normal',
    fontStyle: 'normal',
    verticalAlign: 'top',
    textDecoration: 'none',
    textAlign: 'left',
    marginLeft: '0px',
    fontSize: '1em',
    fontFamily: 'Times New Roman',
  };

  return {
    ...actual,
    newJSDOM: (content: Parameters<typeof actual.newJSDOM>[0], options?: Parameters<typeof actual.newJSDOM>[1]) => {
      const result = actual.newJSDOM(content, options);

      if (result.document.defaultView) {
        // jsdom does not reliably apply XHTML stylesheets here; retain defaults while honoring inline styles tested below.
        (result.document.defaultView as any).getComputedStyle = (elem: Element) => {
          const inlineStyle = (elem as HTMLElement).style;

          return {
            ...defaultStyle,
            fontWeight: inlineStyle?.fontWeight || defaultStyle.fontWeight,
            fontStyle: inlineStyle?.fontStyle || defaultStyle.fontStyle,
            verticalAlign: inlineStyle?.verticalAlign || defaultStyle.verticalAlign,
            textDecoration: inlineStyle?.textDecoration || defaultStyle.textDecoration,
            textAlign: inlineStyle?.textAlign || defaultStyle.textAlign,
            fontSize: inlineStyle?.fontSize || defaultStyle.fontSize,
          };
        };
      }

      return result;
    },
  };
});

describe('crossinfworld_ln process', () => {
  const cleanupPaths: string[] = [];

  beforeAll(() => {
    process.env['DEBUG_OUTPUT'] = '1';
  });

  afterAll(async () => {
    delete process.env['DEBUG_OUTPUT'];

    for (const cleanupPath of cleanupPaths) {
      await utils.removeDir(cleanupPath);
    }
  });

  /**
   * Run the module with a directory-based EPUB fixture and DEBUG_OUTPUT enabled.
   * The returned output is a directory, which lets each test inspect generated OPF and XHTML files directly.
   */
  const processFixture = async (fixture: Awaited<ReturnType<typeof createEpubFixture>>) => {
    cleanupPaths.push(fixture.rootDir);

    const workDir = await utils.createTmpDir('converty-crossinfworld-');
    cleanupPaths.push(workDir);
    const outputDir = path.join(workDir, 'output');
    await utils.mkdir(outputDir);

    const resultPath = await crossinfworld_ln().process({
      converterInputPath: fixture.rootDir,
      converterOutputPath: outputDir,
      fileInputPath: fixture.rootDir,
    });

    return { resultPath, outputDir };
  };

  it.concurrent('should process a basic epub into an output directory', async () => {
    const fixture = await createEpubFixture({ title: 'Reincarnated as the Last of My Kind Vol. 1', coverImage: false });
    cleanupPaths.push(fixture.rootDir);

    const workDir = await utils.createTmpDir('converty-crossinfworld-');
    cleanupPaths.push(workDir);
    const outputDir = path.join(workDir, 'output');
    await utils.mkdir(outputDir);

    const resultPath = await crossinfworld_ln().process({
      converterInputPath: fixture.rootDir,
      converterOutputPath: outputDir,
      fileInputPath: fixture.rootDir,
    });

    expect(resultPath).toBe(path.resolve(outputDir, 'Reincarnated as the Last of My Kind Vol. 1'));

    const contentOPF = await fspromises.readFile(path.join(resultPath, 'OEBPS', 'content.opf'), 'utf-8');
    expect(contentOPF).toContain('<dc:title>Reincarnated as the Last of My Kind Vol. 1</dc:title>');
    expect(contentOPF).toContain('property="belongs-to-collection"');
    expect(contentOPF).toMatch(/<meta[^>]+property="belongs-to-collection"[^>]*>\s*Reincarnated as the Last of My Kind\s*<\/meta>/);
    expect(contentOPF).toContain('property="collection-type">series</meta>');
    expect(contentOPF).toContain('property="group-position">1</meta>');

    const textFiles = (await fspromises.readdir(path.join(resultPath, 'OEBPS', 'Text'))).sort();
    expect(textFiles).toEqual(['chapter1.xhtml', 'chapter2.xhtml', 'toc.xhtml']);

    const chapter1 = await fspromises.readFile(path.join(resultPath, 'OEBPS', 'Text', 'chapter1.xhtml'), 'utf-8');
    expect(chapter1).toContain('Chapter 1');
    expect(chapter1).toContain('Lorem ipsum dolor sit amet.');

    const chapter2 = await fspromises.readFile(path.join(resultPath, 'OEBPS', 'Text', 'chapter2.xhtml'), 'utf-8');
    expect(chapter2).toContain('Chapter 2');
    expect(chapter2).toContain('Consectetur adipiscing elit.');

    expect(await utils.pathExists(path.join(resultPath, 'OEBPS', 'Styles', 'stylesheet.css'))).toBe(true);
  });

  it.concurrent('should skip a "contents.xhtml" file from the spine', async () => {
    const fixture = await createEpubFixture({
      title: 'Reincarnated as the Last of My Kind Vol. 1',
      coverImage: false,
      chapters: [
        {
          id: 'contents',
          href: 'Text/contents.xhtml',
          title: 'Contents',
          body: '<h1>Contents</h1><p>Chapter 1</p>',
        },
      ],
    });
    cleanupPaths.push(fixture.rootDir);

    const workDir = await utils.createTmpDir('converty-crossinfworld-');
    cleanupPaths.push(workDir);
    const outputDir = path.join(workDir, 'output');
    await utils.mkdir(outputDir);

    const resultPath = await crossinfworld_ln().process({
      converterInputPath: fixture.rootDir,
      converterOutputPath: outputDir,
      fileInputPath: fixture.rootDir,
    });

    const textFiles = (await fspromises.readdir(path.join(resultPath, 'OEBPS', 'Text'))).sort();
    expect(textFiles).toEqual(['chapter1.xhtml', 'chapter2.xhtml', 'toc.xhtml']);
  });

  it.concurrent('should classify matter and illustrations without duplicating character-page chapters', async () => {
    const fixture = await createEpubFixture({
      title: 'So You Want to Live the Slow Life. A Guide to Life in the Beastly Wilds Vol. 1',
      coverImage: false,
      chapters: [
        {
          id: 'cover',
          href: 'Text/cover.xhtml',
          title: 'Cover',
          body: '<p><img src="../Images/cover.png" alt="Cover" /></p>',
        },
        {
          id: 'copyright',
          href: 'Text/copyright.xhtml',
          title: 'Copyright',
          body: '<p>Mock copyright notice.</p>',
        },
        {
          id: 'character-1',
          href: 'Text/character1.xhtml',
          title: 'Character Page',
          body: '<p><img src="../Images/character1.png" alt="Character Page" /></p>',
        },
        {
          id: 'character-2',
          href: 'Text/character2.xhtml',
          title: 'Character Page 2',
          body: '<p><img src="../Images/character2.png" alt="Character Page 2" /></p>',
        },
        {
          id: 'chapter-3',
          href: 'Text/chapter3.xhtml',
          title: 'Chapter 3',
          body: '<h1>Chapter 3</h1><p>Mock chapter opening.</p>',
        },
        {
          id: 'illustration-1',
          href: 'Text/illustration1.xhtml',
          title: 'Chapter 3: Illustration 1',
          body: '<p><img src="../Images/illustration1.png" alt="Chapter 3 Illustration 1" /></p>',
        },
        {
          id: 'scene-b',
          href: 'Text/sceneb.xhtml',
          title: 'Chapter 3: Scene B',
          body: '<p>Mock continuation after the illustration.</p>',
        },
        {
          id: 'afterword',
          href: 'Text/afterword.xhtml',
          title: 'Afterword',
          body: '<p>Mock afterword.</p>',
        },
      ],
      extraFiles: [
        { path: 'Images/character1.png', content: Buffer.from('mock-character-1') },
        { path: 'Images/character2.png', content: Buffer.from('mock-character-2') },
        { path: 'Images/illustration1.png', content: Buffer.from('mock-illustration-1') },
      ],
    });
    const { resultPath } = await processFixture(fixture);

    const textDir = path.join(resultPath, 'OEBPS', 'Text');
    expect((await fspromises.readdir(textDir)).sort()).toEqual([
      'afterword.xhtml',
      'chapter1.xhtml',
      'chapter2.xhtml',
      'chapter3.xhtml',
      'chapter3_1.xhtml',
      'copyright.xhtml',
      'cover.xhtml',
      'frontmatter1.xhtml',
      'frontmatter2.xhtml',
      'insert1.xhtml',
      'toc.xhtml',
    ]);

    expect(await fspromises.readFile(path.join(textDir, 'chapter3_1.xhtml'), 'utf-8')).toContain(
      'Mock continuation after the illustration.'
    );

    const toc = await fspromises.readFile(path.join(textDir, 'toc.xhtml'), 'utf-8');
    expect(toc.match(/Character Page/g)).toHaveLength(1);
    expect(toc).not.toContain('Chapter 3: Illustration 1');
    expect(toc).not.toContain('Chapter 3: Scene B');

    const contentOPF = await fspromises.readFile(path.join(resultPath, 'OEBPS', 'content.opf'), 'utf-8');
    expect(contentOPF.indexOf('idref="cover.xhtml"')).toBeLessThan(contentOPF.indexOf('idref="chapter1.xhtml"'));
    expect(contentOPF.indexOf('idref="afterword.xhtml"')).toBeLessThan(contentOPF.indexOf('idref="copyright.xhtml"'));
    expect(contentOPF.indexOf('idref="copyright.xhtml"')).toBe(contentOPF.lastIndexOf('idref="copyright.xhtml"'));
  });

  it.concurrent('should ignore generated-toc inputs and other-series pages', async () => {
    const fixture = await createEpubFixture({
      title: 'Reincarnated as the Last of My Kind Vol. 1',
      coverImage: false,
      chapters: [
        {
          id: 'body-toc',
          href: 'Text/body-toc.xhtml',
          title: 'Book navigation',
          body: '<h2>Table of Contents</h2><p>BODY_TOC_MARKER</p>',
        },
        {
          id: 'title-toc',
          href: 'Text/title-toc.xhtml',
          title: 'Table of Contents',
          body: '<p>TITLE_TOC_MARKER</p>',
        },
        {
          id: 'other-series',
          href: 'Text/other-series.xhtml',
          title: 'Other Series Pt. 1',
          body: '<p>OTHER_SERIES_MARKER</p>',
        },
      ],
    });
    const { resultPath } = await processFixture(fixture);

    const textDir = path.join(resultPath, 'OEBPS', 'Text');
    expect((await fspromises.readdir(textDir)).sort()).toEqual(['chapter1.xhtml', 'chapter2.xhtml', 'toc.xhtml']);

    const toc = await fspromises.readFile(path.join(textDir, 'toc.xhtml'), 'utf-8');
    expect(toc).not.toContain('BODY_TOC_MARKER');
    expect(toc).not.toContain('TITLE_TOC_MARKER');
    expect(toc).not.toContain('OTHER_SERIES_MARKER');
  });

  it.concurrent('should convert nested inline styles into semantic elements', async () => {
    const fixture = await createEpubFixture({
      title: 'Reincarnated as the Last of My Kind Vol. 1',
      coverImage: false,
      chapters: [
        {
          id: 'styled',
          href: 'Text/styled.xhtml',
          title: 'Styled Chapter',
          body: '<h1>Styled Chapter</h1><p><span style="font-weight: bold"><span style="font-style: italic"><span style="font-size: 80%">Styled mock text.</span></span></span></p><p style="text-align: right">Mock signature.</p>',
        },
      ],
    });
    const { resultPath } = await processFixture(fixture);

    const chapter = await fspromises.readFile(path.join(resultPath, 'OEBPS', 'Text', 'chapter3.xhtml'), 'utf-8');
    expect(chapter).toMatch(/<strong>\s*<em>\s*<small>Styled mock text\.<\/small>\s*<\/em>\s*<\/strong>/);
    expect(chapter).toMatch(/<p class="signature">Mock signature\.<\/p>/);
  });

  it.concurrent('should preserve top-level list structure and item text', async () => {
    const fixture = await createEpubFixture({
      title: 'Reincarnated as the Last of My Kind Vol. 1',
      coverImage: false,
      chapters: [
        {
          id: 'list',
          href: 'Text/list.xhtml',
          title: 'Instructions',
          body: '<h1>Instructions</h1><p>Before list.</p><ol start="3"><li>First mock item.</li><li value="7">Second mock item.</li></ol><p>After list.</p>',
        },
      ],
    });
    const { resultPath } = await processFixture(fixture);

    // createEpubFixture always adds Chapters 1 and 2 first, making this custom chapter chapter3.xhtml.
    const listChapter = await fspromises.readFile(path.join(resultPath, 'OEBPS', 'Text', 'chapter3.xhtml'), 'utf-8');
    // Inspect the generated XML as a tree so the test verifies container/item structure and semantic attributes.
    const { document } = xh.newJSDOM(listChapter, { contentType: xh.STATICS.XHTML_MIMETYPE });
    const list = xh.queryDefinedElement(document, 'body ol');
    const items = Array.from(list.querySelectorAll(':scope > li'));

    expect(list.getAttribute('start')).toBe('3');
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.textContent)).toEqual(['First mock item.', 'Second mock item.']);
    expect(items[1].getAttribute('value')).toBe('7');
    expect(list.previousElementSibling?.textContent).toBe('Before list.');
    expect(list.nextElementSibling?.textContent).toBe('After list.');
  });
});
