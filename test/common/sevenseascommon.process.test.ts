import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fspromises } from 'fs';
import * as path from 'path';
import * as utils from '../../src/utils.js';
import * as ssc from '../../src/common/sevenseascommon.js';
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

describe('sevenseasCommon process', () => {
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

  it('should process a directory based epub into an output directory', async () => {
    const fixture = await createEpubFixture({ coverImage: false });
    cleanupPaths.push(fixture.rootDir);

    const workDir = await utils.createTmpDir('converty-process-');
    cleanupPaths.push(workDir);
    const outputDir = path.join(workDir, 'output');
    await utils.mkdir(outputDir);

    const resultPath = await ssc.process(
      {
        converterInputPath: fixture.rootDir,
        converterOutputPath: outputDir,
        fileInputPath: fixture.rootDir,
      },
      {}
    );

    expect(resultPath).toBe(path.resolve(outputDir, 'Some Story'));

    const contentOPF = await fspromises.readFile(path.join(resultPath, 'OEBPS', 'content.opf'), 'utf-8');
    expect(contentOPF).toContain('<dc:title>Some Story</dc:title>');
    expect(contentOPF).toContain('property="belongs-to-collection"');
    expect(contentOPF).toContain('>Some Story</meta>');
    expect(contentOPF).toContain('property="collection-type">series</meta>');
    expect(contentOPF).toContain('property="group-position">1</meta>');
    expect(contentOPF).toContain('href="Styles/stylesheet.css"');
    expect(contentOPF).toContain('id="chapter1.xhtml"');
    expect(contentOPF).toContain('id="chapter2.xhtml"');

    const textDir = path.join(resultPath, 'OEBPS', 'Text');
    const textFiles = (await fspromises.readdir(textDir)).sort();
    expect(textFiles).toEqual(['chapter1.xhtml', 'chapter2.xhtml', 'toc.xhtml']);

    const chapter1 = await fspromises.readFile(path.join(textDir, 'chapter1.xhtml'), 'utf-8');
    expect(chapter1).toContain('Chapter 1');
    expect(chapter1).toContain('Lorem ipsum dolor sit amet.');

    const chapter2 = await fspromises.readFile(path.join(textDir, 'chapter2.xhtml'), 'utf-8');
    expect(chapter2).toContain('Chapter 2');
    expect(chapter2).toContain('Consectetur adipiscing elit.');

    const tocXHTML = await fspromises.readFile(path.join(textDir, 'toc.xhtml'), 'utf-8');
    expect(tocXHTML).toContain('Chapter 1');
    expect(tocXHTML).toContain('Chapter 2');
    expect(tocXHTML.indexOf('Chapter 1')).toBeLessThan(tocXHTML.indexOf('Chapter 2'));
  });

  it('should process an epub with a non-standard content.opf filename', async () => {
    const fixture = await createEpubFixture({
      coverImage: false,
      contentOPFFilename: 'package.opf',
    });
    cleanupPaths.push(fixture.rootDir);

    const workDir = await utils.createTmpDir('converty-process-');
    cleanupPaths.push(workDir);
    const outputDir = path.join(workDir, 'output');
    await utils.mkdir(outputDir);

    const resultPath = await ssc.process(
      {
        converterInputPath: fixture.rootDir,
        converterOutputPath: outputDir,
        fileInputPath: fixture.rootDir,
      },
      {}
    );

    expect(resultPath).toBe(path.resolve(outputDir, 'Some Story'));
    expect(await utils.pathExists(path.join(resultPath, 'OEBPS', 'content.opf'))).toBe(true);
    expect(await utils.pathExists(path.join(resultPath, 'OEBPS', 'package.opf'))).toBe(false);

    const textFiles = (await fspromises.readdir(path.join(resultPath, 'OEBPS', 'Text'))).sort();
    expect(textFiles).toEqual(['chapter1.xhtml', 'chapter2.xhtml', 'toc.xhtml']);
  });

  it('should use the configured processHTMLFile hook for each spine file', async () => {
    const fixture = await createEpubFixture({ coverImage: false });
    cleanupPaths.push(fixture.rootDir);

    const workDir = await utils.createTmpDir('converty-process-');
    cleanupPaths.push(workDir);
    const outputDir = path.join(workDir, 'output');
    await utils.mkdir(outputDir);

    const processedFiles: string[] = [];
    const resultPath = await ssc.process(
      {
        converterInputPath: fixture.rootDir,
        converterOutputPath: outputDir,
        fileInputPath: fixture.rootDir,
      },
      {
        processHTMLFile: async (filePath, epubctxOut, config) => {
          processedFiles.push(path.basename(filePath));

          return ssc.processHTMLFile(filePath, epubctxOut, config);
        },
      }
    );

    expect(resultPath).toBe(path.resolve(outputDir, 'Some Story'));
    expect(processedFiles).toEqual(['chapter1.xhtml', 'chapter2.xhtml']);
  });

  it('should skip files matching the configured files filter regex', async () => {
    const fixture = await createEpubFixture({ coverImage: false });
    cleanupPaths.push(fixture.rootDir);

    const workDir = await utils.createTmpDir('converty-process-');
    cleanupPaths.push(workDir);
    const outputDir = path.join(workDir, 'output');
    await utils.mkdir(outputDir);

    const filesToFilter = /chapter2\.xhtml/i;
    const processedFiles: string[] = [];
    const resultPath = await ssc.process(
      {
        converterInputPath: fixture.rootDir,
        converterOutputPath: outputDir,
        fileInputPath: fixture.rootDir,
      },
      {
        FilesToFilter: [filesToFilter],
        processHTMLFile: async (filePath, epubctxOut, config) => {
          processedFiles.push(path.basename(filePath));

          return ssc.processHTMLFile(filePath, epubctxOut, config);
        },
      }
    );

    expect(resultPath).toBe(path.resolve(outputDir, 'Some Story'));
    expect(processedFiles).toEqual(['chapter1.xhtml']);

    const textFiles = (await fspromises.readdir(path.join(resultPath, 'OEBPS', 'Text'))).sort();
    expect(textFiles).toEqual(['chapter1.xhtml', 'toc.xhtml']);
  });
});
