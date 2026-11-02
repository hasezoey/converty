import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fspromises } from 'fs';
import * as path from 'path';
import * as utils from '../../src/utils.js';
import averbil_ln from '../../src/modules/averbil_ln.js';
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

describe('averbil_ln process', () => {
  const cleanupPaths: string[] = [];

  beforeEach(() => {
    process.env['DEBUG_OUTPUT'] = '1';
  });

  afterEach(async () => {
    delete process.env['DEBUG_OUTPUT'];

    for (const cleanupPath of cleanupPaths.splice(0)) {
      await utils.removeDir(cleanupPath);
    }
  });

  it('should process a basic epub into an output directory', async () => {
    const fixture = await createEpubFixture({ coverImage: false });
    cleanupPaths.push(fixture.rootDir);

    const workDir = await utils.createTmpDir('converty-averbil-');
    cleanupPaths.push(workDir);
    const outputDir = path.join(workDir, 'output');
    await utils.mkdir(outputDir);

    const resultPath = await averbil_ln().process({
      converterInputPath: fixture.rootDir,
      converterOutputPath: outputDir,
      fileInputPath: fixture.rootDir,
    });

    expect(resultPath).toBe(path.resolve(outputDir, 'Some Story'));

    const contentOPF = await fspromises.readFile(path.join(resultPath, 'OEBPS', 'content.opf'), 'utf-8');
    expect(contentOPF).toContain('<dc:title>Some Story</dc:title>');
    expect(contentOPF).toContain('property="belongs-to-collection"');
    expect(contentOPF).toContain('>Some Story</meta>');
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
  });
});
