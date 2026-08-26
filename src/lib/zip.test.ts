import { describe, expect, it } from 'vitest';

import { createZip, crc32 } from './zip';

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function readUint16(bytes: Uint8Array, at: number): number {
  return bytes[at]! | (bytes[at + 1]! << 8);
}

function readUint32(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0
  );
}

describe('crc32', () => {
  it.each([
    ['hello', 0x3610a686],
    ['', 0x00000000],
    ['The quick brown fox jumps over the lazy dog', 0x414fa339],
  ])('matches the known checksum for %o', (value, expected) => {
    // Published values, not ones this implementation produced. A checksum that
    // only agrees with itself is the one defect a structural test cannot see:
    // headers can be perfect and the archive still opens as CORRUPT, with
    // nothing pointing at the cause.
    expect(crc32(text(value))).toBe(expected);
  });
});

describe('createZip', () => {
  it('ends with an end-of-central-directory record naming every entry', async () => {
    const bytes = await bytesOf(
      createZip([
        { path: 'a.txt', bytes: text('hello') },
        { path: 'b.txt', bytes: text('world') },
      ]),
    );

    const eocd = bytes.length - 22;
    expect(readUint32(bytes, eocd)).toBe(0x06054b50);
    expect(readUint16(bytes, eocd + 8)).toBe(2);
    expect(readUint16(bytes, eocd + 10)).toBe(2);
  });

  it('starts with a local file header', async () => {
    const bytes = await bytesOf(createZip([{ path: 'a.txt', bytes: text('hello') }]));

    expect(readUint32(bytes, 0)).toBe(0x04034b50);
  });

  it('stores bytes verbatim, uncompressed', async () => {
    // Method 0. Every entry this app bundles is a WebP, which is already
    // compressed — deflate would spend CPU to save nothing, and STORE is what
    // keeps this dependency-free.
    const bytes = await bytesOf(createZip([{ path: 'a.txt', bytes: text('hello') }]));

    expect(readUint16(bytes, 8)).toBe(0);
    // Compressed and uncompressed sizes agree, which is what "stored" means.
    expect(readUint32(bytes, 18)).toBe(5);
    expect(readUint32(bytes, 22)).toBe(5);
    expect(new TextDecoder().decode(bytes.slice(30 + 5, 30 + 5 + 5))).toBe('hello');
  });

  it('keeps a nested path’s forward slash', async () => {
    // A backslash here is what makes an archive open as one file literally
    // named `files\x.webp` on some tools rather than a folder.
    const bytes = await bytesOf(createZip([{ path: 'files/x.webp', bytes: text('x') }]));

    expect(new TextDecoder().decode(bytes.slice(30, 30 + 12))).toBe('files/x.webp');
  });

  it('is byte-identical for the same input twice', async () => {
    // The timestamp is fixed rather than read from the clock, so a diff of two
    // exports means something and a test can assert on bytes at all.
    const first = await bytesOf(createZip([{ path: 'a.txt', bytes: text('hello') }]));
    const second = await bytesOf(createZip([{ path: 'a.txt', bytes: text('hello') }]));

    expect(first).toEqual(second);
  });

  it('records each entry’s own offset, so the second is findable', async () => {
    const bytes = await bytesOf(
      createZip([
        { path: 'a.txt', bytes: text('hello') },
        { path: 'b.txt', bytes: text('world') },
      ]),
    );

    const firstLocalSize = 30 + 5 + 5;
    const centralStart = firstLocalSize * 2;
    const secondCentral = centralStart + 46 + 5;

    expect(readUint32(bytes, secondCentral)).toBe(0x02014b50);
    // A shared offset of 0 is the classic bug: the archive lists two files and
    // extracts the first one twice.
    expect(readUint32(bytes, secondCentral + 42)).toBe(firstLocalSize);
  });

  it('writes an empty archive for no entries', async () => {
    const bytes = await bytesOf(createZip([]));

    expect(bytes.length).toBe(22);
    expect(readUint16(bytes, 8)).toBe(0);
  });
});
