import { describe, expect, it } from 'vitest';
import { extractFixtures, extractFixturesFromHtml, MAX_FIXTURES } from './extract-fixtures';

const node = (i: number) => ({ homeTeam: `Home ${i}`, awayTeam: `Away ${i}`, odds: { home: 2.1, draw: 3.4, away: 3.6 } });

describe('extractFixtures (JSON tree)', () => {
  it('caps at MAX_FIXTURES on oversized trees', () => {
    expect(extractFixtures({ matches: Array.from({ length: 300 }, (_, i) => node(i + 1)) }).length).toBe(MAX_FIXTURES);
  });
  it('caps deeply nested duplicate branches', () => {
    const deep = { a: { b: { c: Array.from({ length: 80 }, (_, i) => node(i + 1)) } }, d: Array.from({ length: 80 }, (_, i) => node(i + 100)) };
    expect(extractFixtures(deep).length).toBe(MAX_FIXTURES);
  });
  it('parses normal payloads unchanged', () => {
    const fx = extractFixtures({ list: [node(1), node(2)] });
    expect(fx.length).toBe(2);
    expect(fx[0]).toEqual({ home: 'Home 1', away: 'Away 1', h: 2.1, d: 3.4, a: 3.6 });
  });
  it('ignores malformed nodes', () => {
    expect(extractFixtures({ x: { homeTeam: 'A' }, y: null, z: 5 }).length).toBe(0);
  });
});

describe('extractFixturesFromHtml (regex rows)', () => {
  const row = (i: number) => `<div data-home="Home ${i}" data-away="Away ${i}" data-odds="2.10,3.40,3.60"></div>`;
  it('caps at MAX_FIXTURES', () => {
    expect(extractFixturesFromHtml(Array.from({ length: 200 }, (_, i) => row(i + 1)).join('')).length).toBe(MAX_FIXTURES);
  });
  it('parses valid rows', () => {
    const fx = extractFixturesFromHtml(row(1) + row(2));
    expect(fx.length).toBe(2);
    expect(fx[1].a).toBe(3.6);
  });
  it('skips malformed odds', () => {
    expect(extractFixturesFromHtml('<div data-home="A" data-away="B" data-odds="2.10,3.40"></div>').length).toBe(0);
  });
});