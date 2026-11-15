import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);

function sources(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) return sources(url);
    return /\.(tsx?|css|html|svg)$/.test(entry.name) ? [url] : [];
  });
}

describe('self-hosted assets', () => {
  const files = [
    new URL('index.html', root),
    ...sources(new URL('src/', root)),
    ...sources(new URL('public/', root)),
  ];

  for (const file of files) {
    it(`${fileURLToPath(file).split('/paynowlah/')[1]} has no external resource URLs`, () => {
      const source = readFileSync(file, 'utf8')
        // SVG namespace identifiers do not make network requests.
        .replaceAll('http://www.w3.org/2000/svg', '')
        .replaceAll('http://www.w3.org/1999/xlink', '')
        // A plain link to the source code; clicking it is the only way it loads.
        .replaceAll("'https://github.com/choonkeat/paynowlah.sg'", '');
      expect(source).not.toMatch(/https?:\/\//i);
      expect(source).not.toMatch(/(?:src|href)\s*=\s*["']\/\//i);
      expect(source).not.toMatch(/(?:url|@import)\s*\(?\s*["']?\/\//i);
    });
  }

  it('bundles both font families as actual local WOFF2 files', () => {
    const css = readFileSync(new URL('src/index.css', root), 'utf8');
    for (const name of ['bricolage-grotesque-latin', 'jetbrains-mono-latin']) {
      expect(css).toContain(`url('./assets/fonts/${name}.woff2')`);
      const bytes = readFileSync(new URL(`src/assets/fonts/${name}.woff2`, root));
      expect(bytes.subarray(0, 4).toString()).toBe('wOF2');
    }
  });

  it('only ships the five necessary browser libraries', () => {
    const browserLibraries = new Set<string>();
    for (const file of sources(new URL('src/', root))) {
      if (!/\.tsx?$/.test(file.pathname)) continue;
      const source = readFileSync(file, 'utf8');
      for (const [, name] of source.matchAll(/(?:\bfrom\s*|^import\s*|\bimport\(\s*)['"]([^'"]+)['"]/gm)) {
        if (!name.startsWith('.') && !name.startsWith('@/')) {
          browserLibraries.add(name.split('/')[0]);
        }
      }
    }
    expect([...browserLibraries].sort()).toEqual(['lucide-react', 'qrcode', 'react', 'react-dom', 'zxing-wasm']);
  });
});
