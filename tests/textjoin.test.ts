import { describe, it, expect } from 'vitest';
import { joinTextItems, type TextPiece } from '../scripts/ingest/docs.js';

/** A 10-point piece of text at (x, y), `width` wide. */
const piece = (str: string, x: number, y: number, width: number, hasEOL = false): TextPiece => ({
  str,
  transform: [10, 0, 0, 10, x, y],
  width,
  height: 10,
  hasEOL,
});

describe('joinTextItems', () => {
  it('rejoins a word the PDF printed as touching pieces', () => {
    // "JA" ends at x=114; "Ks" starts right there (Rinvoq's "JA Ks").
    expect(joinTextItems([piece('point of JA', 50, 700, 64), piece('Ks, preventing', 114, 700, 70)])).toBe(
      'point of JAKs, preventing'
    );
    // Slight kerning overlap or gap still counts as one word ("fun ction").
    expect(joinTextItems([piece('fun', 0, 500, 15), piece('ction', 15.6, 500, 25)])).toBe('function');
    expect(joinTextItems([piece('fun', 0, 500, 15), piece('ction', 14.5, 500, 25)])).toBe('function');
  });

  it('keeps a space where the page shows a gap', () => {
    expect(joinTextItems([piece('Janus', 0, 700, 28), piece('kinase', 30.5, 700, 30)])).toBe('Janus kinase');
  });

  it('keeps spaces that are in the text itself', () => {
    expect(joinTextItems([piece('Janus ', 0, 700, 30), piece('kinase', 30, 700, 30)])).toBe('Janus kinase');
    expect(joinTextItems([piece('Janus', 0, 700, 28), piece(' ', 28, 700, 2), piece('kinase', 30, 700, 30)])).toBe(
      'Janus kinase'
    );
  });

  it('puts a space between lines', () => {
    // Next line starts back at the left margin.
    expect(joinTextItems([piece('immune cell', 0, 700, 300), piece('function', 0, 688, 40)])).toBe(
      'immune cell function'
    );
    // A piece that ends its line, even if the next starts nearby.
    expect(joinTextItems([piece('end', 0, 700, 15, true), piece('next', 15, 700, 20)])).toBe('end next');
  });

  it('never runs a trial number into the next word across a gap', () => {
    expect(joinTextItems([piece('NCT03725007', 0, 700, 60), piece('(SELECT)', 62.5, 700, 40)])).toBe(
      'NCT03725007 (SELECT)'
    );
  });
});

describe('joinTextItems on print that is not a plain line of text', () => {
  it('keeps a space between rotated pieces', () => {
    const rotated = (str: string, y: number): TextPiece => ({ str, transform: [0, 10, -10, 0, 300, y], width: 10, height: 10 });
    expect(joinTextItems([rotated('15', 100), rotated('15', 100)])).toBe('15 15');
  });

  it('keeps a space between pieces printed on top of each other', () => {
    expect(joinTextItems([piece('15', 0, 700, 10), piece('15', 2, 700, 10)])).toBe('15 15');
  });
});
