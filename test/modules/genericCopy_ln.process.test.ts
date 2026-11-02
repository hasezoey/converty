import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fspromises } from 'fs';
import * as path from 'path';
import * as utils from '../../src/utils.js';
import genericCopy_ln from '../../src/modules/genericCopy_ln.js';
import { createEpubFixture } from '../fixtures/epub.js';

describe('genericCopy_ln process', () => {
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
    const fixture = await createEpubFixture({ title: 'Death March to the Parallel World Rhapsody Vol. 1' });
    cleanupPaths.push(fixture.rootDir);

    const workDir = await utils.createTmpDir('converty-generic-copy-');
    cleanupPaths.push(workDir);
    const outputDir = path.join(workDir, 'output');
    await utils.mkdir(outputDir);

    const resultPath = await genericCopy_ln().process({
      converterInputPath: fixture.rootDir,
      converterOutputPath: outputDir,
      fileInputPath: fixture.rootDir,
    });

    expect(resultPath).toBe(path.resolve(outputDir, 'Death March to the Parallel World Rhapsody Vol. 1'));

    const contentOPF = await fspromises.readFile(path.join(resultPath, 'OEBPS', 'content.opf'), 'utf-8');
    expect(contentOPF).toContain('<dc:title>Death March to the Parallel World Rhapsody Vol. 1</dc:title>');
    expect(contentOPF).toContain('property="belongs-to-collection"');
    expect(contentOPF).toMatch(/<meta[^>]+property="belongs-to-collection"[^>]*>\s*Death March to the Parallel World Rhapsody\s*<\/meta>/);
    expect(contentOPF).toContain('property="collection-type">series</meta>');
    expect(contentOPF).toContain('property="group-position">1</meta>');
    expect(contentOPF).toContain('id="cover.png"');

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
});
