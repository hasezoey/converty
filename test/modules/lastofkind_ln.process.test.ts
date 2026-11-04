import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { promises as fspromises } from 'fs';
import * as path from 'path';
import * as utils from '../../src/utils.js';
import lastofkind_ln from '../../src/modules/lastofkind_ln.js';
import { createEpubFixture } from '../fixtures/epub.js';

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
        (result.document.defaultView as any).getComputedStyle = () => defaultStyle;
      }

      return result;
    },
  };
});

describe('lastofkind_ln process', () => {
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

  it.concurrent('should process a basic epub into an output directory', async () => {
    const fixture = await createEpubFixture({ title: 'Reincarnated as the Last of My Kind Vol. 1', coverImage: false });
    cleanupPaths.push(fixture.rootDir);

    const workDir = await utils.createTmpDir('converty-lastofkind-');
    cleanupPaths.push(workDir);
    const outputDir = path.join(workDir, 'output');
    await utils.mkdir(outputDir);

    const resultPath = await lastofkind_ln().process({
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

    const workDir = await utils.createTmpDir('converty-lastofkind-');
    cleanupPaths.push(workDir);
    const outputDir = path.join(workDir, 'output');
    await utils.mkdir(outputDir);

    const resultPath = await lastofkind_ln().process({
      converterInputPath: fixture.rootDir,
      converterOutputPath: outputDir,
      fileInputPath: fixture.rootDir,
    });

    const textFiles = (await fspromises.readdir(path.join(resultPath, 'OEBPS', 'Text'))).sort();
    expect(textFiles).toEqual(['chapter1.xhtml', 'chapter2.xhtml', 'toc.xhtml']);
  });
});
