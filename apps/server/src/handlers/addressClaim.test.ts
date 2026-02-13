import { describe, it, expect } from 'vitest';
import { extractAddress, isValidEvmAddress, extractAddressFromPrBody } from './addressClaim.js';

describe('extractAddress', () => {
  it('extracts address from /osm402 address command', () => {
    expect(extractAddress('/osm402 address 0x1234567890abcdef1234567890abcdef12345678'))
      .toBe('0x1234567890abcdef1234567890abcdef12345678');
  });

  it('extracts address from osm402:address token', () => {
    expect(extractAddress('osm402:address 0xDeadBeefDeadBeefDeadBeefDeadBeefDeadBeef'))
      .toBe('0xDeadBeefDeadBeefDeadBeefDeadBeefDeadBeef');
  });

  it('still extracts address from legacy /gitpay address command', () => {
    expect(extractAddress('/gitpay address 0x1234567890abcdef1234567890abcdef12345678'))
      .toBe('0x1234567890abcdef1234567890abcdef12345678');
  });

  it('extracts address from multiline text', () => {
    const text = 'Hey, here is my fix.\n\n/osm402 address 0xAbCdEf0123456789AbCdEf0123456789AbCdEf01\n\nThanks!';
    expect(extractAddress(text)).toBe('0xAbCdEf0123456789AbCdEf0123456789AbCdEf01');
  });

  it('returns null when no address command found', () => {
    expect(extractAddress('Just a regular comment')).toBeNull();
  });

  it('returns null for invalid address (too short)', () => {
    expect(extractAddress('/osm402 address 0x1234')).toBeNull();
  });

  it('returns null for invalid address (non-hex)', () => {
    expect(extractAddress('/osm402 address 0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG')).toBeNull();
  });
});

describe('isValidEvmAddress', () => {
  it('accepts valid address', () => {
    expect(isValidEvmAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe(true);
  });

  it('rejects address without 0x prefix', () => {
    expect(isValidEvmAddress('1234567890abcdef1234567890abcdef12345678')).toBe(false);
  });

  it('rejects address with wrong length', () => {
    expect(isValidEvmAddress('0x1234')).toBe(false);
  });
});

describe('extractAddressFromPrBody', () => {
  it('extracts from PR body with osm402:address token', () => {
    const body = 'Fixes #42\n\nosm402:address 0xAbCdEf0123456789AbCdEf0123456789AbCdEf01';
    expect(extractAddressFromPrBody(body)).toBe('0xAbCdEf0123456789AbCdEf0123456789AbCdEf01');
  });

  it('extracts from PR body with /osm402 address command', () => {
    const body = 'Fix the bug\n/osm402 address 0x1234567890abcdef1234567890abcdef12345678';
    expect(extractAddressFromPrBody(body)).toBe('0x1234567890abcdef1234567890abcdef12345678');
  });

  it('returns null for null body', () => {
    expect(extractAddressFromPrBody(null)).toBeNull();
  });

  it('returns null when no address in body', () => {
    expect(extractAddressFromPrBody('Just a regular PR body')).toBeNull();
  });
});
