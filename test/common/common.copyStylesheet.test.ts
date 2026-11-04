import { afterEach, describe, expect, it } from 'vitest';
import { promises as fspromises } from 'fs';
import * as path from 'path';
import * as utils from '../../src/utils.js';
import * as common from '../../src/common/common.js';
import * as epubh from '../../src/helpers/epub.js';
import * as th from '../../src/helpers/template.js';

type StylesheetContext = epubh.EpubContext<epubh.BaseEpubOptions<epubh.BaseEpubContextTrackers, 'Global'>, epubh.InputEpubCustomData>;

describe('common copyStylesheet', () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    for (const cleanupPath of cleanupPaths.splice(0)) {
      await utils.removeDir(cleanupPath);
    }
  });

  const createContext = (): StylesheetContext => {
    const ctx = new epubh.EpubContext<epubh.BaseEpubOptions<epubh.BaseEpubContextTrackers, 'Global'>, epubh.InputEpubCustomData>({
      title: 'Some Story',
      optionsClass: new epubh.BaseEpubOptions(),
    });

    cleanupPaths.push(ctx.rootDir);

    return ctx;
  };

  it('should copy the default stylesheet and register it', async () => {
    const ctx = createContext();
    const expectedPath = path.resolve(ctx.contentOPFDir, epubh.FileDir.Styles, 'stylesheet.css');

    await common.copyStylesheet(ctx);

    expect(await fspromises.readFile(expectedPath, 'utf-8')).toBe(await th.getTemplate('text-ln.css'));
    expect(ctx.files).toHaveLength(1);
    expect(ctx.files[0]).toBeInstanceOf(epubh.EpubContextFileBase);
    expect(ctx.files[0]).toMatchObject({
      id: 'stylesheet',
      mediaType: epubh.STATICS.CSS_MIMETYPE,
      filePath: expectedPath,
    });
  });

  it('should use the configured root path', async () => {
    const ctx = createContext();
    ctx.root_path = 'EPUB';

    await common.copyStylesheet(ctx);

    const expectedPath = path.resolve(ctx.contentOPFDir, epubh.FileDir.Styles, 'stylesheet.css');
    expect(await utils.pathExists(expectedPath)).toBe(true);
    expect(ctx.files[0].filePath).toBe(expectedPath);
  });
});
