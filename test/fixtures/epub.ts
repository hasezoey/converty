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
}

/**
 * Create a small, valid EPUB directory fixture.
 * The returned root directory needs to be removed by the caller.
 */
export async function createEpubFixture(options: EpubFixtureOptions = {}): Promise<EpubFixture> {
  const rootDir = await utils.createTmpDir('converty-fixture-');
  const contentOPFDir = path.join(rootDir, 'OEBPS');
  const title = options.title ?? '  Some   Story  ';

  await utils.mkdir(path.join(rootDir, 'META-INF'));
  await utils.mkdir(path.join(contentOPFDir, 'Text'));
  await utils.mkdir(path.join(contentOPFDir, 'Styles'));
  await utils.mkdir(path.join(contentOPFDir, 'Images'));

  await fspromises.writeFile(path.join(rootDir, 'mimetype'), 'application/epub+zip');
  await fspromises.writeFile(
    path.join(rootDir, 'META-INF', 'container.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>
`
  );
  await fspromises.writeFile(
    path.join(contentOPFDir, 'content.opf'),
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="pub-id">urn:uuid:test</dc:identifier>
    <meta name="cover" content="cover-img" />
  </metadata>
  <manifest>
    <item id="chapter-2" href="Text/chapter2.xhtml" media-type="application/xhtml+xml" />
    <item id="chapter-1" href="Text/chapter1.xhtml" media-type="application/xhtml+xml" />
    <item id="styles" href="Styles/stylesheet.css" media-type="text/css" />
    <item id="cover-img" href="Images/cover.png" media-type="image/png" />
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
  </manifest>
  <spine toc="ncx">
    <itemref idref="chapter-2" />
    <itemref idref="chapter-1" />
  </spine>
</package>
`
  );
  await fspromises.writeFile(
    path.join(contentOPFDir, 'Text', 'chapter1.xhtml'),
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>Chapter 1</title>
  </head>
  <body>
    <h1>Chapter 1</h1>
    <p>Lorem ipsum dolor sit amet.</p>
  </body>
</html>
`
  );
  await fspromises.writeFile(
    path.join(contentOPFDir, 'Text', 'chapter2.xhtml'),
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>Chapter 2</title>
  </head>
  <body>
    <h1>Chapter 2</h1>
    <p>Consectetur adipiscing elit.</p>
  </body>
</html>
`
  );
  await fspromises.writeFile(path.join(contentOPFDir, 'Styles', 'stylesheet.css'), 'body { color: black; }\n');
  await fspromises.writeFile(path.join(contentOPFDir, 'Images', 'cover.png'), Buffer.from('fake-image-data'));
  await fspromises.writeFile(
    path.join(contentOPFDir, 'toc.ncx'),
    `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap></navMap>
</ncx>
`
  );
  // files that should be ignored by "getInputContext"
  await fspromises.writeFile(path.join(rootDir, 'calibre_bookmarks.txt'), 'bookmarks');

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
  await addDirectoryToZip(zipfile, fixture.rootDir, fixture.rootDir);
  zipfile.end();

  await writePromise;

  return zipPath;
}

async function addDirectoryToZip(zipfile: yazl.ZipFile, dirPath: string, rootDir: string): Promise<void> {
  const entries = await fspromises.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const entryPath = path.join(dirPath, entry.name);
    const entryName = path.relative(rootDir, entryPath);

    if (entry.isDirectory()) {
      await addDirectoryToZip(zipfile, entryPath, rootDir);
      continue;
    }

    // already added manually to make sure it is stored uncompressed first
    if (entryName === 'mimetype') {
      continue;
    }

    zipfile.addFile(entryPath, entryName);
  }
}
