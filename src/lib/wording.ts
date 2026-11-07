/**
 * The same approved-use wording, however the PDF text spaced it.
 *
 * Indication names are read from FDA PDFs, and the reader once split words
 * at font changes ("adults with out cirrhosis", "To reduc e formation").
 * Facts already confirmed under that wording must still match the corrected
 * one, so wording is compared with spaces ignored. Every letter, digit and
 * punctuation mark must still be the same.
 */
export function wordingKey(text: string): string {
  return text.replace(/\s+/g, '');
}

export function sameWording(a: string, b: string): boolean {
  return wordingKey(a) === wordingKey(b);
}
