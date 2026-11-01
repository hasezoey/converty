import { describe, expect, it } from 'vitest';
import * as th from '../../src/helpers/template.js';

describe('templateHelpers', () => {
  describe('applyTemplate', () => {
    it('should replace a single key', () => {
      expect(th.applyTemplate('Hello {{NAME}}!', { '{{NAME}}': 'World' })).toBe('Hello World!');
    });

    it('should replace multiple keys', () => {
      expect(th.applyTemplate('{{A}} and {{B}}', { '{{A}}': '1', '{{B}}': '2' })).toBe('1 and 2');
    });

    it('should return the input if there are no keys to replace', () => {
      expect(th.applyTemplate('No placeholders here', { FOO: 'bar' })).toBe('No placeholders here');
    });
  });

  describe('getTemplate', () => {
    it('should load an existing template', async () => {
      const template = await th.getTemplate('content.opf');

      expect(template).toContain('<package');
      expect(template).toContain('<?xml version="1.0" encoding="utf-8"?>');
    });

    it('should throw an error for a template that does not exist', async () => {
      await expect(th.getTemplate('does_not_exist.xhtml')).rejects.toThrow(/Could not find template path/);
    });
  });

  describe('clearTemplates', () => {
    it('should clear the cache and reload the template', async () => {
      await th.getTemplate('content.opf');
      th.clearTemplates();

      const template = await th.getTemplate('content.opf');

      expect(template).toContain('<package');
    });
  });
});
