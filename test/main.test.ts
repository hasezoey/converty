import { afterEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { getConfig, getConverterBasePath, setConfig } from '../src/main.js';

vi.mock('downloads-folder', () => ({
  default: () => '/mock/Downloads',
}));

describe('main config', () => {
  const resetConfig = () => {
    setConfig(undefined as unknown as Parameters<typeof setConfig>[0]);
  };

  afterEach(() => {
    resetConfig();
  });

  it('should use the downloads folder fallback without a config', () => {
    resetConfig();

    expect(getConverterBasePath()).toBe(path.resolve('/mock/Downloads', 'converty'));
  });

  it('should append the project name to a configured base path', () => {
    setConfig({ baseConverterPath: '/mock/converter-base' });

    expect(getConverterBasePath()).toBe(path.resolve('/mock/converter-base', 'converty'));
  });

  it('should use the fallback when the configured base path is empty', () => {
    setConfig({ baseConverterPath: '' });

    expect(getConverterBasePath()).toBe(path.resolve('/mock/Downloads', 'converty'));
  });

  it('should get the config that was set', () => {
    const config = { baseConverterPath: '/mock/converter-base', createDownloadLink: false };

    setConfig(config);

    expect(getConfig()).toBe(config);
  });
});
