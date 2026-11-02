import { createWriteStream, promises as fspromises } from 'fs';
import * as path from 'path';
import yazl from 'yazl';
import * as utils from '../../src/utils.js';

export interface EpubFixture {
  /** Root directory of the generated fixture */
  rootDir: string;
  /** Directory containing the content.opf */
  contentOPFDir: string;
}

export interface EpubFixtureOptions {
  /** The title to use in the content.opf metadata */
  title?: string;
  /** Whether to add cover metadata to the content.opf (defaults to true) */
  coverImage?: boolean;
  /** How the cover image should be referenced in the content.opf (defaults to the metadata fallback) */
  coverLookup?: 'meta' | 'properties';
  /** The order of the chapters in the spine (defaults to natural order) */
  spineOrder?: 'natural' | 'reversed';
  /** Directory containing the content.opf, relative to the fixture root (defaults to "OEBPS") */
  contentOPFDirName?: string;
  /** Additional chapters to add to the manifest and spine */
  chapters?: EpubFixtureChapter[];
  /** Additional files to write, relative to the content.opf directory */
  extraFiles?: EpubFixtureFile[];
}

export interface EpubFixtureChapter {
  /** The manifest id of the chapter */
  id: string;
  /** Path relative to the content.opf directory */
  href: string;
  /** The title used in "head > title" */
  title: string;
  /** Extra XML content to add to the head element */
  head?: string;
  /** The XML content of the body element */
  body: string;
}

export interface EpubFixtureFile {
  /** Path relative to the content.opf directory */
  path: string;
  content: string | Buffer;
}

/**
 * Create a small, valid EPUB directory fixture.
 * The returned root directory needs to be removed by the caller.
 */
export async function createEpubFixture(options: EpubFixtureOptions = {}): Promise<EpubFixture> {
  const rootDir = await utils.createTmpDir('converty-fixture-');
  const contentOPFDirName = options.contentOPFDirName ?? 'OEBPS';
  const contentOPFDir = path.join(rootDir, contentOPFDirName);
  const title = options.title ?? '  Some   Story  ';
  const coverMeta = options.coverImage === false || options.coverLookup === 'properties' ? '' : '<meta name="cover" content="cover-img" />';
  const coverManifest =
    options.coverImage === false
      ? ''
      : options.coverLookup === 'properties'
        ? '<item id="cover-img" href="Images/cover.png" media-type="image/png" properties="cover-image" />'
        : '<item id="cover-img" href="Images/cover.png" media-type="image/png" />';
  const chapters: EpubFixtureChapter[] = [
    {
      id: 'chapter-1',
      href: 'Text/chapter1.xhtml',
      title: 'Chapter 1',
      body: '<h1>Chapter 1</h1>\n    <p>Lorem ipsum dolor sit amet.</p>',
    },
    {
      id: 'chapter-2',
      href: 'Text/chapter2.xhtml',
      title: 'Chapter 2',
      body: '<h1>Chapter 2</h1>\n    <p>Consectetur adipiscing elit.</p>',
    },
    ...(options.chapters ?? []),
  ];
  const spineChapters = options.spineOrder === 'reversed' ? [chapters[1], chapters[0], ...chapters.slice(2)] : chapters;
  const spineItems = spineChapters.map((chapter) => `<itemref idref="${chapter.id}" />`).join('\n    ');
  const chapterManifest = chapters
    .map((chapter) => `<item id="${chapter.id}" href="${chapter.href}" media-type="application/xhtml+xml" />`)
    .join('\n    ');

  await utils.mkdir(contentOPFDir);
  await Promise.all([
    utils.mkdir(path.join(rootDir, 'META-INF')),
    utils.mkdir(path.join(contentOPFDir, 'Text')),
    utils.mkdir(path.join(contentOPFDir, 'Styles')),
    utils.mkdir(path.join(contentOPFDir, 'Images')),
  ]);

  await Promise.all([
    fspromises.writeFile(path.join(rootDir, 'mimetype'), 'application/epub+zip'),
    fspromises.writeFile(
      path.join(rootDir, 'META-INF', 'container.xml'),
      `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${contentOPFDirName}/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>
`
    ),
    fspromises.writeFile(
      path.join(contentOPFDir, 'content.opf'),
      `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="pub-id">urn:uuid:test</dc:identifier>
    ${coverMeta}
  </metadata>
  <manifest>
    ${coverManifest}
    <item id="styles" href="Styles/stylesheet.css" media-type="text/css" />
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
    ${chapterManifest}
  </manifest>
  <spine toc="ncx">
    ${spineItems}
  </spine>
</package>
`
    ),
    fspromises.writeFile(path.join(contentOPFDir, 'Styles', 'stylesheet.css'), 'body { color: black; }\n'),
    fspromises.writeFile(path.join(contentOPFDir, 'Images', 'cover.png'), Buffer.from('fake-image-data')),
    fspromises.writeFile(
      path.join(contentOPFDir, 'toc.ncx'),
      `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap></navMap>
</ncx>
`
    ),
    // files that should be ignored by "getInputContext"
    fspromises.writeFile(path.join(rootDir, 'calibre_bookmarks.txt'), 'bookmarks'),
    ...chapters.map(async (chapter) => {
      const chapterPath = path.join(contentOPFDir, chapter.href);

      await utils.mkdir(path.dirname(chapterPath));
      await fspromises.writeFile(
        chapterPath,
        `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>${chapter.title}</title>
    ${chapter.head ?? ''}
  </head>
  <body>
    ${chapter.body}
  </body>
</html>
`
      );
    }),
    ...(options.extraFiles ?? []).map(async (file) => {
      const filePath = path.join(contentOPFDir, file.path);

      await utils.mkdir(path.dirname(filePath));
      await fspromises.writeFile(filePath, file.content);
    }),
  ]);

  return {
    rootDir,
    contentOPFDir,
  };
}

/**
 * Create a zip/epub file from a generated fixture directory.
 * The resulting file is generated at test runtime, not stored in the repository.
 */
export async function createEpubZip(fixture: EpubFixture, zipPath: string): Promise<string> {
  const zipfile = new yazl.ZipFile();
  const writeStream = createWriteStream(zipPath);

  const writePromise = new Promise<void>((resolve, reject) => {
    writeStream.once('close', resolve);
    writeStream.once('error', reject);
    zipfile.outputStream.once('error', reject);
    zipfile.outputStream.pipe(writeStream);
  });

  zipfile.addFile(path.join(fixture.rootDir, 'mimetype'), 'mimetype', { compress: false });

  const entries = await collectZipEntries(fixture.rootDir, fixture.rootDir);
  for (const entry of entries) {
    // already added manually to make sure it is stored uncompressed first
    if (entry.name === 'mimetype') {
      continue;
    }

    zipfile.addFile(entry.filePath, entry.name);
  }

  zipfile.end();

  await writePromise;

  return zipPath;
}

interface ZipEntry {
  filePath: string;
  name: string;
}

async function collectZipEntries(dirPath: string, rootDir: string): Promise<ZipEntry[]> {
  const entries = await fspromises.readdir(dirPath, { withFileTypes: true });
  const collected = await Promise.all(
    entries.map(async (entry): Promise<ZipEntry[]> => {
      const entryPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        return collectZipEntries(entryPath, rootDir);
      }

      return [{ filePath: entryPath, name: path.relative(rootDir, entryPath) }];
    })
  );

  return collected.flat().sort((a, b) => a.name.localeCompare(b.name));
}
