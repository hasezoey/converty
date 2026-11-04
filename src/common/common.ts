import * as epubh from '../helpers/epub.js';
import { TextProcessingECOptions } from '../helpers/htmlTextProcessing.js';
import * as xh from '../helpers/xml.js';
import * as utils from '../utils.js';

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
