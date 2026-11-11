/**
 * A minimal synchronous zlib/DEFLATE (RFC 1950 + RFC 1951) decompressor.
 *
 * OSM PBF files carry each block as a zlib stream, and the package promises a
 * synchronous API with zero runtime dependencies, so it cannot borrow
 * `node:zlib` (absent in browsers) or a third-party inflater. Only the parts
 * PBF needs are implemented: stored, fixed-Huffman and dynamic-Huffman blocks,
 * without preset dictionaries.
 */

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

/** Order in which code-length code lengths are transmitted. */
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const MAX_BITS = 15;
const TABLE_SIZE = 1 << MAX_BITS;

/** A decode table entry holds the symbol in the high bits and its length below. */
function entry(symbol: number, length: number): number {
    return (symbol << 4) | length;
}

function reverseBits(code: number, length: number): number {
    let reversed = 0;
    for (let i = 0; i < length; i++) {
        reversed = (reversed << 1) | (code & 1);
        code >>= 1;
    }
    return reversed;
}

/**
 * Fill `table` with the canonical Huffman code described by `lengths`.
 * Returns the longest code length, which is the mask width used for lookups.
 */
function buildTable(lengths: Uint8Array, count: number, table: Int32Array): number {
    const counts = new Uint16Array(MAX_BITS + 1);
    let maxBits = 0;
    for (let i = 0; i < count; i++) {
        const length = lengths[i];
        counts[length]++;
        if (length > maxBits) {
            maxBits = length;
        }
    }
    counts[0] = 0;

    const nextCode = new Uint16Array(MAX_BITS + 1);
    let code = 0;
    for (let bits = 1; bits <= MAX_BITS; bits++) {
        code = (code + counts[bits - 1]) << 1;
        nextCode[bits] = code;
    }

    const size = 1 << maxBits;
    table.fill(0, 0, size);
    for (let symbol = 0; symbol < count; symbol++) {
        const length = lengths[symbol];
        if (length === 0) {
            continue;
        }
        const reversed = reverseBits(nextCode[length]++, length);
        const value = entry(symbol, length);
        const step = 1 << length;
        for (let index = reversed; index < size; index += step) {
            table[index] = value;
        }
    }
    return maxBits;
}

let fixedLiteralLengths: Uint8Array | undefined;
let fixedDistanceLengths: Uint8Array | undefined;

function fixedTables(literalTable: Int32Array, distanceTable: Int32Array): { literalMax: number, distanceMax: number } {
    if (!fixedLiteralLengths) {
        fixedLiteralLengths = new Uint8Array(288);
        for (let i = 0; i < 144; i++) fixedLiteralLengths[i] = 8;
        for (let i = 144; i < 256; i++) fixedLiteralLengths[i] = 9;
        for (let i = 256; i < 280; i++) fixedLiteralLengths[i] = 7;
        for (let i = 280; i < 288; i++) fixedLiteralLengths[i] = 8;
        fixedDistanceLengths = new Uint8Array(30).fill(5);
    }
    return {
        literalMax: buildTable(fixedLiteralLengths, 288, literalTable),
        distanceMax: buildTable(fixedDistanceLengths!, 30, distanceTable),
    };
}

/**
 * Decompress a zlib stream.
 *
 * @param data the buffer holding the stream
 * @param start offset of the zlib header
 * @param end offset just past the stream (trailing bytes are ignored)
 * @param sizeHint expected decompressed size, used to size the output buffer
 */
export function inflate(data: Uint8Array, start: number = 0, end: number = data.length, sizeHint: number = 0): Uint8Array {
    const cmf = data[start];
    const flg = data[start + 1];
    if ((cmf & 0x0f) !== 8) {
        throw new Error(`unsupported zlib compression method ${cmf & 0x0f}`);
    }
    if (flg & 0x20) {
        throw new Error('zlib preset dictionaries are not supported');
    }

    let pos = start + 2;
    let bitBuf = 0;
    let bitCnt = 0;
    let phantomBytes = 0;

    const literalTable = new Int32Array(TABLE_SIZE);
    const distanceTable = new Int32Array(TABLE_SIZE);
    const codeLengthTable = new Int32Array(TABLE_SIZE);
    const codeLengths = new Uint8Array(320);

    let out = new Uint8Array(Math.max(sizeHint, 1 << 16));
    let outPos = 0;

    const ensureBits = (n: number) => {
        while (bitCnt < n) {
            if (pos < end) {
                bitBuf |= data[pos++] << bitCnt;
            } else if (++phantomBytes > 2) {
                throw new Error('truncated deflate stream');
            }
            bitCnt += 8;
        }
    };

    const getBits = (n: number): number => {
        if (n === 0) {
            return 0;
        }
        ensureBits(n);
        const value = bitBuf & ((1 << n) - 1);
        bitBuf >>>= n;
        bitCnt -= n;
        return value;
    };

    const decode = (table: Int32Array, maxBits: number): number => {
        ensureBits(maxBits);
        const value = table[bitBuf & ((1 << maxBits) - 1)];
        if (value === 0) {
            throw new Error('invalid deflate Huffman code');
        }
        const length = value & 15;
        bitBuf >>>= length;
        bitCnt -= length;
        return value >>> 4;
    };

    const put = (byte: number) => {
        if (outPos === out.length) {
            const grown = new Uint8Array(out.length * 2);
            grown.set(out);
            out = grown;
        }
        out[outPos++] = byte;
    };

    const copyBack = (distance: number, length: number) => {
        for (let i = 0; i < length; i++) {
            put(out[outPos - distance]);
        }
    };

    let final = 0;
    while (!final) {
        final = getBits(1);
        const type = getBits(2);

        if (type === 0) {
            // Stored block: drop the partial byte and copy the literal run.
            pos -= bitCnt >> 3;
            bitBuf = 0;
            bitCnt = 0;
            const length = data[pos] | (data[pos + 1] << 8);
            const complement = data[pos + 2] | (data[pos + 3] << 8);
            if ((length ^ 0xffff) !== complement) {
                throw new Error('invalid deflate stored block length');
            }
            pos += 4;
            for (let i = 0; i < length; i++) {
                put(data[pos + i]);
            }
            pos += length;
            continue;
        }

        if (type === 1 || type === 2) {
            let literalMax: number;
            let distanceMax: number;
            if (type === 1) {
                ({ literalMax, distanceMax } = fixedTables(literalTable, distanceTable));
            } else {
                const literalCount = getBits(5) + 257;
                const distanceCount = getBits(5) + 1;
                const codeLengthCount = getBits(4) + 4;

                codeLengths.fill(0);
                for (let i = 0; i < codeLengthCount; i++) {
                    codeLengths[CODE_LENGTH_ORDER[i]] = getBits(3);
                }
                const codeLengthMax = buildTable(codeLengths, 19, codeLengthTable);

                const total = literalCount + distanceCount;
                codeLengths.fill(0, 0, total);
                let i = 0;
                while (i < total) {
                    const symbol = decode(codeLengthTable, codeLengthMax);
                    if (symbol < 16) {
                        codeLengths[i++] = symbol;
                        continue;
                    }
                    let repeat: number;
                    let value = 0;
                    if (symbol === 16) {
                        if (i === 0) {
                            throw new Error('invalid deflate code length repeat');
                        }
                        value = codeLengths[i - 1];
                        repeat = 3 + getBits(2);
                    } else if (symbol === 17) {
                        repeat = 3 + getBits(3);
                    } else {
                        repeat = 11 + getBits(7);
                    }
                    if (i + repeat > total) {
                        throw new Error('deflate code length overflow');
                    }
                    while (repeat-- > 0) {
                        codeLengths[i++] = value;
                    }
                }

                literalMax = buildTable(codeLengths.subarray(0, literalCount), literalCount, literalTable);
                distanceMax = buildTable(codeLengths.subarray(literalCount), distanceCount, distanceTable);
            }

            for (;;) {
                const symbol = decode(literalTable, literalMax);
                if (symbol < 256) {
                    put(symbol);
                    continue;
                }
                if (symbol === 256) {
                    break;
                }
                if (symbol > 285) {
                    throw new Error(`invalid deflate length symbol ${symbol}`);
                }
                const lengthIndex = symbol - 257;
                const length = LENGTH_BASE[lengthIndex] + getBits(LENGTH_EXTRA[lengthIndex]);
                const distanceSymbol = decode(distanceTable, distanceMax);
                if (distanceSymbol > 29) {
                    throw new Error(`invalid deflate distance symbol ${distanceSymbol}`);
                }
                const distance = DIST_BASE[distanceSymbol] + getBits(DIST_EXTRA[distanceSymbol]);
                if (distance > outPos) {
                    throw new Error('deflate distance beyond output start');
                }
                copyBack(distance, length);
            }
            continue;
        }

        throw new Error(`invalid deflate block type ${type}`);
    }

    return out.subarray(0, outPos);
}
