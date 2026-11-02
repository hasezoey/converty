import { afterEach, describe, expect, it } from 'vitest';
import { promises as fspromises } from 'fs';
import * as path from 'path';
import * as utils from '../../src/utils.js';
import * as epubh from '../../src/helpers/epub.js';
import * as xh from '../../src/helpers/xml.js';
import { createEpubFixture, createEpubZip } from '../fixtures/epub.js';

describe('getInputContext', () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    for (const cleanupPath of cleanupPaths.splice(0)) {
      await utils.removeDir(cleanupPath);
    }
  });

  const getXHTMLFiles = (ctx: epubh.EpubContext<epubh.BaseEpubOptions, epubh.InputEpubCustomData>) => {
    return ctx.files.filter((file): file is epubh.EpubContextFileXHTML => file instanceof epubh.EpubContextFileXHTML);
  };

  it('should read a directory based epub', async () => {
    const fixture = await createEpubFixture({ spineOrder: 'reversed' });
    cleanupPaths.push(fixture.rootDir);

    const ctx = await epubh.getInputContext(fixture.rootDir);
    cleanupPaths.push(ctx.rootDir);

    expect(ctx.title).toBe('Some Story');
    expect(ctx.root_path).toBe(path.resolve(ctx.rootDir, 'OEBPS'));
    expect(ctx.customData?.contentOPFDoc).toBeDefined();

    const xhtmlFiles = getXHTMLFiles(ctx);
    expect(xhtmlFiles.map((file) => file.id)).toEqual(['chapter-2', 'chapter-1']);
    expect(xhtmlFiles.map((file) => file.title)).toEqual(['Chapter 2', 'Chapter 1']);
    expect(xhtmlFiles[0].customData?.spineIndex).toBeDefined();
    expect(xhtmlFiles[1].customData?.spineIndex).toBeDefined();
    expect(xhtmlFiles[0].customData?.spineIndex).toBeLessThan(xhtmlFiles[1].customData?.spineIndex ?? 0);

    const firstXHTMLIndex = ctx.files.findIndex((file) => file instanceof epubh.EpubContextFileXHTML);
    expect(ctx.files.slice(0, firstXHTMLIndex).every((file) => !(file instanceof epubh.EpubContextFileXHTML))).toBe(true);

    const stylesheet = ctx.files.find((file) => file.id === 'styles');
    expect(stylesheet?.mediaType).toBe(epubh.STATICS.CSS_MIMETYPE);

    const cover = ctx.files.find((file) => file.id === 'cover-img');
    expect(cover?.mediaType).toBe('image/png');

    const ncx = ctx.files.find((file) => file.id === 'ncx');
    expect(ncx?.mediaType).toBe(xh.STATICS.NCX_MIMETYPE);

    expect(ctx.files.some((file) => path.basename(file.filePath) === 'mimetype')).toBe(false);
    expect(ctx.files.some((file) => path.basename(file.filePath) === 'container.xml')).toBe(false);
    expect(ctx.files.some((file) => path.basename(file.filePath) === 'calibre_bookmarks.txt')).toBe(false);
  });

  it('should read a zip based epub', async () => {
    const fixture = await createEpubFixture({ spineOrder: 'reversed' });
    cleanupPaths.push(fixture.rootDir);

    const zipDir = await utils.createTmpDir('converty-zip-');
    cleanupPaths.push(zipDir);
    const zipPath = path.join(zipDir, 'fixture.epub');
    await createEpubZip(fixture, zipPath);

    const ctx = await epubh.getInputContext(zipPath);
    cleanupPaths.push(ctx.rootDir);

    expect(ctx.title).toBe('Some Story');

    const xhtmlFiles = getXHTMLFiles(ctx);
    expect(xhtmlFiles.map((file) => file.id)).toEqual(['chapter-2', 'chapter-1']);
    expect(xhtmlFiles.map((file) => file.title)).toEqual(['Chapter 2', 'Chapter 1']);
    expect(ctx.files.find((file) => file.id === 'styles')?.mediaType).toBe(epubh.STATICS.CSS_MIMETYPE);
    expect(ctx.files.find((file) => file.id === 'cover-img')?.mediaType).toBe('image/png');
  });

  it('should throw for a file that is not a zip or epub', async () => {
    const tmpDir = await utils.createTmpDir('converty-test-');
    cleanupPaths.push(tmpDir);
    const filePath = path.join(tmpDir, 'book.txt');

    await fspromises.writeFile(filePath, 'not an epub');

    await expect(epubh.getInputContext(filePath)).rejects.toThrow(/does not end with "zip" or "epub"/);
  });
});
