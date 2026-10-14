import { describe, it, expect } from 'vitest';
import { registryText, maskingText } from '../src/lib/registryText.js';

describe('registryText', () => {
  it('turns registry codes into plain English', () => {
    expect(registryText('ACTIVE_NOT_RECRUITING')).toBe('Active, not recruiting');
    expect(registryText('COMPLETED')).toBe('Completed');
    expect(registryText('SINGLE_GROUP')).toBe('Single group');
    expect(registryText('NA')).toBe('Not applicable');
  });

  it('leaves text that is already human-readable alone', () => {
    expect(registryText('Randomized, double-blind')).toBe('Randomized, double-blind');
  });

  it('names blinding levels the way trials are described', () => {
    expect(maskingText('QUADRUPLE')).toBe('Quadruple-blind');
    expect(maskingText('NONE')).toBe('None (open label)');
  });
});
