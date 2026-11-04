import * as epubh from '../helpers/epub.js';
import { TextProcessingECOptions } from '../helpers/htmlTextProcessing.js';
import * as xh from '../helpers/xml.js';
import * as utils from '../utils.js';
import * as path from 'node:path';
import * as fspromises from 'node:fs/promises';
import { getTemplate } from '../helpers/template.js';
import * as htmltp from '../helpers/htmlTextProcessing.js';
import * as sh from '../helpers/string.js';

const log = utils.createNameSpace('common/common');

/** Regex for detecting the series in the ContentOPF */
export const SERIES_MATCH_REGEX = /^(?<series>.+?)( (?:Vol\.|Volume) (?<num>\d+))?$/im;

//! This module is for commonly used files that are not specific to a module.

/**
 * Create a {@link epubh.ContentOPFFn} without further processing.
 * @param contentOPFInput The loaded "content.opf" document
 * @param epubctxOut The context of the output
 * @param series_regex Use a custom series extraction regex. Required capture groups are "series" and "num". Default {@link SERIES_MATCH_REGEX}
 * @returns The created hook function
 */
export function createCommonOPFHook(
  contentOPFInput: Document,
  epubctxOut: epubh.EpubContext<TextProcessingECOptions, never>,
  series_regex?: RegExp
): epubh.ContentOPFFn {
  return function commonOPFHook(hookdata: Parameters<epubh.ContentOPFFn>[0]) {
    commonContentOPFCopy(contentOPFInput, epubctxOut, hookdata, series_regex ?? SERIES_MATCH_REGEX);
  };
}

/**
 * Copies standard known metadata where possible.
 * @param contentOPFInput The loaded "content.opf" document
 * @param epubctxOut The context of the output
 * @param hookdata Standard data provided by {@link epubh.ContentOPFFn}
 * @param series_regex Use a custom series extraction regex. Required capture groups are "series" and "num". Default {@link SERIES_MATCH_REGEX}
 */
export function commonContentOPFCopy(
  contentOPFInput: Document,
  epubctxOut: epubh.EpubContext<TextProcessingECOptions, never>,
  hookdata: Parameters<epubh.ContentOPFFn>[0],
  series_regex?: RegExp
) {
  const packageElementOld = xh.queryDefinedElement(contentOPFInput, 'package');
  const metadataElementOld = xh.queryDefinedElement(contentOPFInput, 'metadata');

  const idCounterO: epubh.IdCounter = { c: hookdata.idCounter };
  epubh.copyMetadata(
    hookdata.document,
    Array.from(metadataElementOld.children),
    epubctxOut,
    hookdata.metadataElem,
    packageElementOld,
    idCounterO
  );

  // Regex to extract the series title and if available the volume position
  const caps = (series_regex ?? SERIES_MATCH_REGEX).exec(epubctxOut.title);

  if (!utils.isNullOrUndefined(caps)) {
    const seriesTitleNoVolume = utils.regexMatchGroupRequired(caps, 'series', 'contentOPFHook meta collection');
    const seriesPos = utils.regexMatchGroup(caps, 'num');

    epubh.applySeriesMetadata(hookdata.document, hookdata.metadataElem, idCounterO, {
      name: seriesTitleNoVolume,
      volume: seriesPos ?? '1',
    });
  } else {
    log('Found no series captures for: "'.red + epubctxOut.title.grey + '"'.red);
  }
}

export interface FilteFilesExtraIgnoreConf {
  regex: RegExp;
  /** Set if the regex should be on the full path, or just the basename. */
  basename: boolean;
}

export type FilterFilesExtraIgnore = (RegExp | FilteFilesExtraIgnoreConf)[];

/**
 * Iterate through all the file in the given epubctx.
 * This ignores common things like ".opf", ".ncx".
 * Yields css stylesheets.
 * The returned XHTML files are ensured to be in the spine.
 * @param epubctx The Epub Context to loop through their files
 * @param extra_ignore Extra regex for files to ignore based on filename
 * @param yield_css If enabled, yield css stylesheets instead of ignoring them
 */
export function filterFiles(
  epubctx: epubh.EpubContext<epubh.BaseEpubOptions<epubh.BaseEpubContextTrackers, 'Global'>, epubh.InputEpubCustomData>,
  extra_ignore: FilterFilesExtraIgnore | undefined,
  yield_css: true
): Generator<epubh.EpubContextFileXHTML | epubh.EpubContextFileBase>;
/**
 * Iterate through all the file in the given epubctx.
 * This ignores common things like ".opf", ".ncx".
 * Does *not* yield css stylesheets.
 * The returned XHTML files are ensured to be in the spine.
 * @param epubctx The Epub Context to loop through their files
 * @param extra_ignore Extra regex for files to ignore based on filename
 * @param yield_css If enabled, yield css stylesheets instead of ignoring them
 */
export function filterFiles(
  epubctx: epubh.EpubContext<epubh.BaseEpubOptions<epubh.BaseEpubContextTrackers, 'Global'>, epubh.InputEpubCustomData>,
  extra_ignore: FilterFilesExtraIgnore | undefined,
  yield_css: false | undefined
): Generator<epubh.EpubContextFileXHTML>;
/**
 * Iterate through all the file in the given epubctx.
 * This ignores common things like ".opf", ".ncx".
 * The returned XHTML files are ensured to be in the spine.
 * @param epubctx The Epub Context to loop through their files
 * @param extra_ignore Extra regex for files to ignore based on filename
 * @param yield_css If enabled, yield css stylesheets instead of ignoring them
 */
export function* filterFiles(
  epubctx: epubh.EpubContext<epubh.BaseEpubOptions<epubh.BaseEpubContextTrackers, 'Global'>, epubh.InputEpubCustomData>,
  extra_ignore?: FilterFilesExtraIgnore,
  yield_css?: boolean
): Generator<epubh.EpubContextFileXHTML | epubh.EpubContextFileBase> {
  main: for (const file of epubctx.files) {
    /** Alias to make it easier to handle */
    const filePath = file.filePath;

    if (extra_ignore) {
      for (const r of extra_ignore) {
        if (r instanceof RegExp) {
          // reset the state, otherwise regexes with the "g" flag would alternate between matches
          r.lastIndex = 0;

          if (r.test(filePath)) {
            log(`Skipping file "${file.id}" because it is in the filter regex`);
            continue main;
          }
        } else {
          const testPath = r.basename ? path.basename(filePath) : filePath;
          // reset the state, otherwise regexes with the "g" flag would alternate between matches
          r.regex.lastIndex = 0;

          if (r.regex.test(testPath)) {
            log(`Skipping file "${file.id}" because it is in the filter regex`);
            continue main;
          }
        }
      }
    }

    // skip "content.opf" / "package.opf" file, because it is handled outside of this loop
    if (/\.opf/.test(filePath)) {
      continue;
    }
    // ignore all .ncx files (like toc.ncx)
    if (/\.ncx/.test(filePath)) {
      continue;
    }

    const mimetype = file.mediaType;
    log(`Processing file "${file.id}", ${mimetype}`);

    utils.assertion(typeof mimetype === 'string', new Error('Expected "mimetype" to be of string'));

    if (/image/gim.test(mimetype)) {
      // ignore image files, because they will be copied when required
      continue;
    }
    if (mimetype === epubh.STATICS.CSS_MIMETYPE) {
      if (yield_css) {
        yield file;
      }

      // ignore css input files, unless explicitly wanted, because our own will be applied
      continue;
    }
    if (file instanceof epubh.EpubContextFileXHTML) {
      // ignore all files that are not listed in the spine
      if (!file.customData?.spineIndex) {
        log(`Skipping file "${file.id}" as it is not listed in the original spine!`);
        continue;
      }

      yield file;
      continue;
    }

    console.error(`Unhandled "mimetype": ${mimetype}`.red, file);
  }
}

/**
 * Copy the default `text-ln.css` stylesheet into the given epubctx.
 * @param epubctx The Epub context to copy the file into
 */
export async function copyStylesheet(
  epubctx: epubh.EpubContext<epubh.BaseEpubOptions<epubh.BaseEpubContextTrackers, 'Global'>, epubh.InputEpubCustomData>
) {
  const stylesheetpath = path.resolve(epubctx.contentOPFDir, epubh.FileDir.Styles, 'stylesheet.css');
  await utils.mkdir(path.dirname(stylesheetpath));
  await fspromises.writeFile(stylesheetpath, await getTemplate('text-ln.css'));
  epubctx.addFile(
    new epubh.EpubContextFileBase({
      id: 'stylesheet',
      mediaType: epubh.STATICS.CSS_MIMETYPE,
      filePath: stylesheetpath,
    })
  );
}

/** Cache Object for {@link isTitle} */
export interface IsTitleCache {
  bodyFontSizePx: number;
  window: Window;
}

/**
 * Determine if the given element is a title by comparing font sizes.
 * @param elem The Element to check
 * @param titleCache Optional Cache to not compute styles too often when not required
 * @returns A String with the detected content of the element if a title, "false" otherwise
 */
export function detectTitleByFontSize(elem: Element, titleCache?: IsTitleCache): false | string {
  let bodyFontSize: number;
  let window: Window;

  if (!utils.isNullOrUndefined(titleCache)) {
    bodyFontSize = titleCache.bodyFontSizePx;
    window = titleCache.window;
  } else {
    const ret = htmltp.getBodyFontPx(elem.ownerDocument);
    window = ret.window;
    bodyFontSize = ret.bodyFontSizePx;
  }

  const innerElem = elem.querySelector(':first-child');

  // use first inner elements, because headers are wrapped in a span that has the font-size style
  const useElem = innerElem ? innerElem : elem;

  const elemCompStyle = window.getComputedStyle(useElem);
  let elemFontSizePx: number;

  {
    const elemFontSizePxTMP = parseInt(elemCompStyle.fontSize);
    elemFontSizePx = Number.isNaN(elemFontSizePxTMP) ? bodyFontSize : elemFontSizePxTMP;
  }

  if (elemFontSizePx >= bodyFontSize * 1.3) {
    return sh.xmlToString(useElem.textContent ?? '') || false;
  }

  return false;
}
