export interface ZipEntry {
  /** Forward slashes only. A backslash opens as one file literally named `a\b`. */
  path: string;
  bytes: Uint8Array;
}

/**
 * A CRC-32 table, built once.
 *
 * The one part of a zip that is arithmetic rather than layout, and the one a
 * structural test cannot catch: a container with perfect headers and a wrong
 * checksum opens as a CORRUPT archive, not as a broken one, so the failure
 * arrives as "this zip is damaged" with nothing pointing at the cause.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A fixed DOS timestamp — 2020-01-01 00:00:00.
 *
 * Deliberately not the clock: two exports of the same note then produce
 * byte-identical files, which makes a diff meaningful and a test able to
 * assert on bytes at all.
 */
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

function write(target: Uint8Array, offset: number, values: number[], widths: number[]): number {
  let at = offset;
  for (const [index, value] of values.entries()) {
    for (let byte = 0; byte < widths[index]!; byte += 1) {
      target[at] = (value >>> (byte * 8)) & 0xff;
      at += 1;
    }
  }
  return at;
}

/**
 * A store-only zip.
 *
 * **No compression, and no dependency.** Every entry this app puts in a bundle
 * is a WebP, which is already compressed — deflate would spend CPU to save
 * approximately nothing. That makes the whole format four record types with no
 * algorithm behind them, which is small enough to own rather than import.
 *
 * **Its correctness cannot be established by our own reader.** A parser that
 * agrees with the writer that produced it proves only that they share a
 * misunderstanding, so `e2e/imageExport.spec.ts` opens the result with a real
 * unzipper.
 */
export function createZip(entries: readonly ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const checksum = crc32(entry.bytes);
    const size = entry.bytes.byteLength;

    const local = new Uint8Array(30 + name.byteLength + size);
    let at = write(
      local,
      0,
      [0x04034b50, 20, 0, 0, DOS_TIME, DOS_DATE, checksum, size, size, name.byteLength, 0],
      [4, 2, 2, 2, 2, 2, 4, 4, 4, 2, 2],
    );
    local.set(name, at);
    local.set(entry.bytes, at + name.byteLength);
    locals.push(local);

    const central = new Uint8Array(46 + name.byteLength);
    at = write(
      central,
      0,
      [
        0x02014b50,
        20,
        20,
        0,
        0,
        DOS_TIME,
        DOS_DATE,
        checksum,
        size,
        size,
        name.byteLength,
        0,
        0,
        0,
        0,
        0,
        offset,
      ],
      [4, 2, 2, 2, 2, 2, 2, 4, 4, 4, 2, 2, 2, 2, 2, 4, 4],
    );
    central.set(name, at);
    centrals.push(central);

    offset += local.byteLength;
  }

  const centralSize = centrals.reduce((total, part) => total + part.byteLength, 0);
  const end = new Uint8Array(22);
  write(
    end,
    0,
    [0x06054b50, 0, 0, entries.length, entries.length, centralSize, offset, 0],
    [4, 2, 2, 2, 2, 4, 4, 2],
  );

  // `.buffer`, not the views themselves: TypeScript's `BlobPart` requires an
  // `ArrayBufferView<ArrayBuffer>` and a `Uint8Array` is typed over
  // `ArrayBufferLike`, which also covers `SharedArrayBuffer`. Every array here
  // is freshly allocated and owns its whole buffer, so handing over the buffer
  // is exact rather than a cast that hides a slice.
  const parts = [...locals, ...centrals, end].map((part) => part.buffer as ArrayBuffer);

  return new Blob(parts, { type: 'application/zip' });
}
