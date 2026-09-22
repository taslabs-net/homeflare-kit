/**
 * The plist serializer, case by case — and, on macOS, every case round-tripped through Apple's own
 * `plutil`, so "valid plist" is Apple's verdict rather than this file's opinion.
 *
 * ⚠️ plutil only READS here: it converts a file in a fresh temp directory to JSON on stdout.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type PlistDict, PlistError, escapeText, renderPlist } from './plist.ts';

const body = (dict: PlistDict) => {
  const text = renderPlist(dict);
  return text.slice(text.indexOf('<dict'), text.lastIndexOf('</plist>')).trimEnd();
};

describe('renderPlist', () => {
  test('a complete document: XML declaration, Apple DOCTYPE, plist 1.0, trailing newline', () => {
    const text = renderPlist({ Label: 'com.example.job' });
    expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC')).toBe(
      true,
    );
    expect(text).toContain(
      '<plist version="1.0">\n<dict>\n\t<key>Label</key>\n\t<string>com.example.job</string>\n</dict>\n</plist>\n',
    );
  });

  test('strings, integers and booleans', () => {
    expect(body({ a: 'x', b: 42, c: -7, d: 0, e: true, f: false })).toBe(
      [
        '<dict>',
        '\t<key>a</key>',
        '\t<string>x</string>',
        '\t<key>b</key>',
        '\t<integer>42</integer>',
        '\t<key>c</key>',
        '\t<integer>-7</integer>',
        '\t<key>d</key>',
        '\t<integer>0</integer>',
        '\t<key>e</key>',
        '\t<true/>',
        '\t<key>f</key>',
        '\t<false/>',
        '</dict>',
      ].join('\n'),
    );
  });

  test('negative zero renders as 0', () => {
    expect(body({ z: -0 })).toContain('<integer>0</integer>');
  });

  test('arrays and nested dicts indent one tab per level', () => {
    expect(body({ args: ['/bin/sh', '-c'], keep: { SuccessfulExit: false } })).toBe(
      [
        '<dict>',
        '\t<key>args</key>',
        '\t<array>',
        '\t\t<string>/bin/sh</string>',
        '\t\t<string>-c</string>',
        '\t</array>',
        '\t<key>keep</key>',
        '\t<dict>',
        '\t\t<key>SuccessfulExit</key>',
        '\t\t<false/>',
        '\t</dict>',
        '</dict>',
      ].join('\n'),
    );
  });

  test('empty containers self-close', () => {
    expect(body({ a: [], d: {} })).toBe(
      '<dict>\n\t<key>a</key>\n\t<array/>\n\t<key>d</key>\n\t<dict/>\n</dict>',
    );
    expect(body({})).toBe('<dict/>');
  });

  test('dicts in arrays (StartCalendarInterval)', () => {
    expect(body({ s: [{ Hour: 3 }, { Minute: 5 }] })).toContain(
      '\t<array>\n\t\t<dict>\n\t\t\t<key>Hour</key>\n\t\t\t<integer>3</integer>\n\t\t</dict>',
    );
  });

  test('keys are sorted, so insertion order never changes the bytes', () => {
    expect(renderPlist({ b: 1, a: 2, C: 3 })).toBe(renderPlist({ C: 3, a: 2, b: 1 }));
    expect(body({ b: 1, a: 2, C: 3 }).indexOf('<key>C</key>')).toBeLessThan(
      body({ b: 1, a: 2, C: 3 }).indexOf('<key>a</key>'),
    );
  });
});

describe('escaping', () => {
  test('&, < and > are escaped in values and keys', () => {
    expect(body({ 'a&b': '<x> & "y" \'z\'' })).toContain(
      '<key>a&amp;b</key>\n\t<string>&lt;x&gt; &amp; "y" \'z\'</string>',
    );
  });

  test('a would-be CDATA end or entity is inert', () => {
    expect(escapeText(']]>&amp;', 'p')).toBe(']]&gt;&amp;amp;');
  });

  test('CR becomes a character reference; tab and LF stay literal', () => {
    expect(escapeText('a\r\nb\tc', 'p')).toBe('a&#13;\nb\tc');
  });

  test('non-ASCII and astral characters pass through as UTF-8', () => {
    expect(escapeText('café — 日本 \u{1F600}', 'p')).toBe('café — 日本 \u{1F600}');
  });

  test.each([
    ['NUL', '\x00'],
    ['BEL', '\x07'],
    ['VT', '\x0B'],
    ['ESC', '\x1B'],
    ['U+FFFE', String.fromCharCode(0xfffe)],
    ['U+FFFF', String.fromCharCode(0xffff)],
    ['a lone high surrogate', String.fromCharCode(0xd83d)],
    ['a lone low surrogate', `a${String.fromCharCode(0xde00)}`],
  ])('%s is refused with the path, not dropped', (_name, bad) => {
    expect(() => renderPlist({ outer: { inner: [`ok${bad}`] } })).toThrow(PlistError);
    expect(() => renderPlist({ outer: { inner: [`ok${bad}`] } })).toThrow('outer.inner[0]');
  });
});

describe('refusals', () => {
  test.each([
    ['a fraction', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['an unsafe integer', 2 ** 60],
    ['undefined', undefined],
    ['null', null],
    ['a Date', new Date(0)],
    ['a function', () => 1],
    ['a bigint', 1n],
  ])('%s', (_name, value) => {
    expect(() => renderPlist({ k: value } as unknown as PlistDict)).toThrow(PlistError);
  });

  test('a non-dict top level', () => {
    expect(() => renderPlist([] as unknown as PlistDict)).toThrow('top level');
  });

  test('a cycle stops at the depth cap instead of overflowing the stack', () => {
    const loop: Record<string, unknown> = {};
    loop['self'] = loop;
    expect(() => renderPlist(loop as PlistDict)).toThrow('nested deeper');
  });
});

const plutil = '/usr/bin/plutil';
const onMac = process.platform === 'darwin' && (await Bun.file(plutil).exists());

describe.skipIf(!onMac)("Apple's plutil reads it back identically", () => {
  const cases: Record<string, PlistDict> = {
    scalars: { s: 'x', i: 42, n: -7, t: true, f: false },
    nested: { a: ['/bin/sh', '-c', 'exec "$prog"'], d: { SuccessfulExit: false }, e: [], o: {} },
    special: { 'a&b<c>': '<&> "q" \'a\' ]]> tab\there\nnewline\r\ncrlf café \u{1F600}' },
    launchd: {
      Label: 'com.example.job',
      ProgramArguments: ['/usr/bin/true'],
      StartCalendarInterval: [{ Hour: 3, Minute: 30 }, { Weekday: 0 }],
      KeepAlive: { SuccessfulExit: false },
    },
  };

  test.each(Object.entries(cases))('%s', async (_name, dict) => {
    const dir = await mkdtemp(join(tmpdir(), 'hf-plist-'));
    try {
      const file = join(dir, 'case.plist');
      await writeFile(file, renderPlist(dict));
      const proc = Bun.spawn([plutil, '-convert', 'json', '-o', '-', file], {
        stderr: 'pipe',
        stdout: 'pipe',
      });
      const out = await new Response(proc.stdout).text();
      expect(await proc.exited).toBe(0);
      expect(JSON.parse(out)).toEqual(dict);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
