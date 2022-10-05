import { JSDOM } from 'jsdom';
import * as utils from '../utils.js';

const log = utils.createNameSpace('xmlHelpers');

/**
 * Chain-Assert that input "elem" is defined
 * @param elem The Element to assert to be defined
 * @param elemName The Element name for the Error
 * @returns The input "elem"
 */
export function definedElement<T extends Node>(elem: T | undefined | null, elemName: string): T {
  utils.assertionDefined(elem, new Error(`Expected Node "${elemName}" to be defined`));

  return elem;
}

/**
 * Chain-Assert that input list "elem" is defined and has length above 0
 * @param elem The Element-List to assert to be defined
 * @param elemName The Element name for the Error
 * @returns The input "elem"
 */
export function definedElementAll<T extends NodeListOf<Node>>(elem: T | undefined | null, elemName: string): T {
  utils.assertionDefined(elem, new Error(`Expected NodeList for "${elemName}" to be defined`));
  utils.assertion(elem.length > 0, new Error('Expected NodeList for "${elemName}" to not be 0'));

  return elem;
}

/**
 * Helper for easier querying with {@link definedElement} without having to duplicate so much
 * @param queryOn The Element to query on
 * @param selector The CSS Selector
 * @returns The found Element
 */
export function queryDefinedElement<T extends Element = Element>(queryOn: Document | Element, selector: string): T {
  return definedElement(queryOn.querySelector(selector) as T, selector);
}

/**
 * Helper for easier querying with {@link definedElement} without having to duplicate so much
 * @param queryOn The Element to query on
 * @param selector The CSS Selector
 * @returns The found Element
 */
export function queryDefinedElementAll<T extends Element = Element>(queryOn: Document | Element, selector: string): NodeListOf<T> {
  return definedElementAll(queryOn.querySelectorAll(selector), selector);
}

export interface INewJSDOMReturn {
  dom: JSDOM;
  document: Document;
}

/**
 * Helper to easily get JSDOM dom and Document
 * @param content The content of the JSDOM
 * @returns The DOM and Document
 */
export function newJSDOM(
  content: NonNullable<ConstructorParameters<typeof JSDOM>[0]>,
  options?: ConstructorParameters<typeof JSDOM>[1]
): INewJSDOMReturn {
  const dom = new JSDOM(typeof content !== 'string' ? content.toString() : content, options);
  const document = dom.window.document;

  return { dom, document };
}

/**
 * Apply multiple attributes with one function
 * @param elem The Element to apply the attributes on
 * @param attrs The Attributes to apply
 */
export function applyAttributes(elem: Element, attrs: Record<string, string>): void {
  for (const [attr, value] of Object.entries(attrs)) {
    elem.setAttribute(attr, value);
  }
}
