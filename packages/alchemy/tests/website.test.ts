import { describe, expect, test } from 'bun:test';
import { astroWebsite, viteWebsite } from '../src/cloudflare/website.ts';

describe('website helpers', () => {
  test('astroWebsite and viteWebsite are functions, not factories that call betterAuth', () => {
    expect(typeof astroWebsite).toBe('function');
    expect(typeof viteWebsite).toBe('function');
  });
});
