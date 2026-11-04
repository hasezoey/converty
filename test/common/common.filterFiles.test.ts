import { afterEach, describe, expect, it } from 'vitest';
import * as path from 'path';
import * as utils from '../../src/utils.js';
import * as common from '../../src/common/common.js';
import * as epubh from '../../src/helpers/epub.js';

type FilterContext = epubh.EpubContext<epubh.BaseEpubOptions<epubh.BaseEpubContextTrackers, 'Global'>, epubh.InputEpubCustomData>;

describe('common filterFiles', () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    for (const cleanupPath of cleanupPaths.splice(0)) {
      await utils.removeDir(cleanupPath);
    }
  });

  const createContext = (): FilterContext => {
    const ctx = new epubh.EpubContext<epubh.BaseEpubOptions<epubh.BaseEpubContextTrackers, 'Global'>, epubh.InputEpubCustomData>({
      title: 'Some Story',
      optionsClass: new epubh.BaseEpubOptions(),
    });

    cleanupPaths.push(ctx.rootDir);

    return ctx;
  };

  const createXHTMLFile = (ctx: FilterContext, id: string, fileName: string, spineIndex?: number) => {
    const file = new epubh.EpubContextFileXHTML({
      id,
      filePath: path.join(ctx.contentOPFDir, 'Text', fileName),
      title: id,
      type: { type: epubh.EpubContextFileXHTMLTypes.TEXT },
      seqIndex: 0,
      globalSeqIndex: 0,
    });

    if (!utils.isNullOrUndefined(spineIndex)) {
      file.customData = { spineIndex };
    }

    return file;
  };

  const createBaseFile = (ctx: FilterContext, id: string, relativePath: string, mediaType: string) => {
    return new epubh.EpubContextFileBase({
      id,
      filePath: path.join(ctx.contentOPFDir, relativePath),
      mediaType,
    });
  };

  it('should ignore non-XHTML files and XHTML files that are not in the spine', () => {
    const ctx = createContext();

    ctx.addFile(createBaseFile(ctx, 'opf', 'content.opf', 'application/oebps-package+xml'));
    ctx.addFile(createBaseFile(ctx, 'ncx', 'toc.ncx', 'application/x-dtbncx+xml'));
    ctx.addFile(createBaseFile(ctx, 'image', 'Images/cover.png', 'image/png'));
    ctx.addFile(createBaseFile(ctx, 'styles', 'Styles/stylesheet.css', epubh.STATICS.CSS_MIMETYPE));
    ctx.addFile(createXHTMLFile(ctx, 'no-spine', 'no-spine.xhtml'));
    ctx.addFile(createXHTMLFile(ctx, 'zero-spine', 'zero-spine.xhtml', 0));
    ctx.addFile(createXHTMLFile(ctx, 'chapter1', 'chapter1.xhtml', 1));

    const result = Array.from(common.filterFiles(ctx, undefined, false));

    expect(result.map((file) => file.id)).toEqual(['chapter1']);
  });

  it('should yield stylesheets when requested', () => {
    const ctx = createContext();

    ctx.addFile(createBaseFile(ctx, 'styles', 'Styles/stylesheet.css', epubh.STATICS.CSS_MIMETYPE));
    ctx.addFile(createXHTMLFile(ctx, 'chapter1', 'chapter1.xhtml', 1));

    const result = Array.from(common.filterFiles(ctx, undefined, true));

    expect(result.map((file) => file.id)).toEqual(['styles', 'chapter1']);
  });

  it('should match plain regex filters against the full path', () => {
    const ctx = createContext();
    const fullPath = path.join(ctx.contentOPFDir, 'Text', 'chapter1.xhtml');

    ctx.addFile(createXHTMLFile(ctx, 'chapter1', 'chapter1.xhtml', 1));

    const result = Array.from(common.filterFiles(ctx, [new RegExp(`${fullPath.replaceAll('\\', '\\\\')}$`)], false));

    expect(result).toHaveLength(0);
  });

  it('should match object filters against the basename when enabled', () => {
    const ctx = createContext();

    ctx.addFile(createXHTMLFile(ctx, 'chapter1', 'chapter1.xhtml', 1));

    const result = Array.from(common.filterFiles(ctx, [{ regex: /^chapter1\.xhtml$/, basename: true }], false));

    expect(result).toHaveLength(0);
  });

  it('should match object filters against the full path when disabled', () => {
    const ctx = createContext();
    const fullPath = path.join(ctx.contentOPFDir, 'Text', 'chapter1.xhtml');

    ctx.addFile(createXHTMLFile(ctx, 'chapter1', 'chapter1.xhtml', 1));

    const basenameResult = Array.from(common.filterFiles(ctx, [{ regex: /^chapter1\.xhtml$/, basename: false }], false));
    expect(basenameResult).toHaveLength(1);

    const fullPathResult = Array.from(
      common.filterFiles(ctx, [{ regex: new RegExp(`${fullPath.replaceAll('\\', '\\\\')}$`), basename: false }], false)
    );
    expect(fullPathResult).toHaveLength(0);
  });

  it('should reset global regexes between files', () => {
    const ctx = createContext();

    ctx.addFile(createXHTMLFile(ctx, 'chapter1', 'chapter1.xhtml', 1));
    ctx.addFile(createXHTMLFile(ctx, 'chapter2', 'chapter2.xhtml', 2));
    ctx.addFile(createXHTMLFile(ctx, 'chapter3', 'chapter3.xhtml', 3));

    const result = Array.from(common.filterFiles(ctx, [/chapter/g], false));

    expect(result).toHaveLength(0);
  });

  it('should reset global object regexes between files', () => {
    const ctx = createContext();

    ctx.addFile(createXHTMLFile(ctx, 'chapter1', 'chapter1.xhtml', 1));
    ctx.addFile(createXHTMLFile(ctx, 'chapter2', 'chapter2.xhtml', 2));
    ctx.addFile(createXHTMLFile(ctx, 'chapter3', 'chapter3.xhtml', 3));

    const result = Array.from(common.filterFiles(ctx, [{ regex: /chapter/g, basename: true }], false));

    expect(result).toHaveLength(0);
  });
});
