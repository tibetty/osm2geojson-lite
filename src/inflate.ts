/**
 * A minimal synchronous zlib/DEFLATE (RFC 1950 + RFC 1951) decompressor.
 *
 * OSM PBF files carry each block as a zlib stream, and the package promises a
 * synchronous API with zero runtime dependencies, so it cannot borrow
 * `node:zlib` (absent in browsers) or a third-party inflater. Only what PBF
 * needs is implemented: stored, fixed-Huffman and dynamic-Huffman blocks,
 * without preset dictionaries.
 *
 * The decoder makes one forward pass over the input and writes the output
 * once, in order: literals are stored directly, and back-references use
 * `copyWithin` when they cannot overlap or an LZ77 byte loop when they can.
 * Huffman tables are rebuilt per block and their buffers reused across calls,
 * so a PBF file with many blocks does not allocate per block. The Adler-32
 * trailer is verified, so a corrupt payload is rejected instead of being
 * decoded into wrong bytes.
 */

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

/** Order in which code-length code lengths are transmitted. */
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const MAX_BITS = 15;
const MAX_TABLE = 1 << MAX_BITS;
const CODE_LENGTH_TABLE = 1 << 7;
const MOD_ADLER = 65521;
/** Cap on the pre-allocation from `sizeHint`; a corrupt header can claim GBs. */
const MAX_INITIAL_OUTPUT = 1 << 26;

/**
 * Scratch buffers shared by every call. `inflate` is synchronous and never
 * calls itself, so one set is safe and saves allocating 300 KiB per block on
 * the PBF path, where a single file holds many independent streams.
 */
const literalTable = new Int32Array(MAX_TABLE);
const distanceTable = new Int32Array(MAX_TABLE);
const codeLengthTable = new Int32Array(CODE_LENGTH_TABLE);
const codeLengths = new Uint8Array(288 + 32);
const fixedLiteralTable = new Int32Array(1 << 9);
const fixedDistanceTable = new Int32Array(1 << 5);
const codeCounts = new Uint16Array(MAX_BITS + 1);
const nextCodes = new Uint16Array(MAX_BITS + 1);
let fixedTablesReady = false;

/** A table entry holds the symbol above its code length. */
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
 * Fill `table` with the canonical Huffman code described by `lengths` and
 * return the longest code length, which is the mask width for lookups.
 * Over-subscribed trees are rejected, so corrupt data cannot be decoded.
 */
function buildTable(lengths: Uint8Array, count: number, table: Int32Array): number {
    const counts = codeCounts;
    counts.fill(0);
    let maxBits = 0;
    for (let i = 0; i < count; i++) {
        const length = lengths[i];
        counts[length]++;
        if (length > maxBits) {
            maxBits = length;
        }
    }
    if (maxBits === 0) {
        // No codes at all: make sure a stale slot cannot decode as a symbol.
        table[0] = 0;
        return 0;
    }
    counts[0] = 0;

    let left = 1;
    for (let bits = 1; bits <= MAX_BITS; bits++) {
        left = (left << 1) - counts[bits];
        if (left < 0) {
            throw new Error('invalid deflate Huffman tree');
        }
    }

    const nextCode = nextCodes;
    let code = 0;
    for (let bits = 1; bits <= MAX_BITS; bits++) {
        code = (code + counts[bits - 1]) << 1;
        nextCode[bits] = code;
    }

    const size = 1 << maxBits;
    if (left > 0) {
        // An incomplete tree (legal for distances) leaves slots unwritten, and
        // a stale entry would decode as a valid symbol, so clear them.
        table.fill(0, 0, size);
    }
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

function prepareFixedTables(): void {
    if (fixedTablesReady) {
        return;
    }
    for (let i = 0; i < 144; i++) codeLengths[i] = 8;
    for (let i = 144; i < 256; i++) codeLengths[i] = 9;
    for (let i = 256; i < 280; i++) codeLengths[i] = 7;
    for (let i = 280; i < 288; i++) codeLengths[i] = 8;
    buildTable(codeLengths, 288, fixedLiteralTable);

    codeLengths.fill(5, 0, 30);
    buildTable(codeLengths, 30, fixedDistanceTable);
    fixedTablesReady = true;
}

/**
 * Adler-32 of the first `length` bytes. The sums stay well inside the safe
 * integer range for 128 bytes, so the modulo runs once per 128 bytes instead
 * of once per byte; on PBF-sized payloads this is the difference between the
 * checksum costing as much as the decoding and a few percent of it.
 */
function adler32(data: Uint8Array, length: number): number {
    let a = 1;
    let b = 0;
    let i = 0;
    for (; i + 128 <= length; i += 128) {
        for (let k = 0; k < 128; k++) {
            a += data[i + k];
            b += a;
        }
        a %= MOD_ADLER;
        b %= MOD_ADLER;
    }
    for (; i < length; i++) {
        a += data[i];
        b += a;
    }
    return (((b % MOD_ADLER) << 16) | (a % MOD_ADLER)) >>> 0;
}

/**
 * Decompress a zlib stream.
 *
 * @param data the buffer holding the stream
 * @param start offset of the zlib header
 * @param end offset just past the stream, including its 4-byte Adler-32 trailer
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
    if (end - start < 6) {
        throw new Error('truncated deflate stream');
    }

    let pos = start + 2;
    let bitBuf = 0;
    let bitCnt = 0;

    let out = new Uint8Array(Math.max(Math.min(sizeHint, MAX_INITIAL_OUTPUT), 1024));
    let outPos = 0;

    /** Top up the bit buffer; bits past the end of the stream read as zero. */
    const refill = () => {
        while (bitCnt <= 24 && pos < end) {
            bitBuf |= data[pos++] << bitCnt;
            bitCnt += 8;
        }
    };

    /** Enlarge the output buffer; `outPos` is a local in the hot loop. */
    const grow = (needed: number) => {
        let size = out.length;
        while (size < needed) {
            size *= 2;
        }
        const grown = new Uint8Array(size);
        grown.set(out);
        out = grown;
    };

    /** Read `n` bits of block metadata; truncation is an error here. */
    const readBits = (n: number): number => {
        if (n === 0) {
            return 0;
        }
        if (bitCnt < n) {
            refill();
            if (bitCnt < n) {
                throw new Error('truncated deflate stream');
            }
        }
        const value = bitBuf & ((1 << n) - 1);
        bitBuf >>>= n;
        bitCnt -= n;
        return value;
    };

    /** Decode one symbol; only used for the dynamic block's code lengths. */
    const readSymbol = (table: Int32Array, maxBits: number): number => {
        if (bitCnt < maxBits) {
            refill();
        }
        const value = table[bitBuf & ((1 << maxBits) - 1)];
        if (value === 0) {
            throw new Error('invalid deflate Huffman code');
        }
        const length = value & 15;
        if (length > bitCnt) {
            throw new Error('truncated deflate stream');
        }
        bitBuf >>>= length;
        bitCnt -= length;
        return value >>> 4;
    };

    /**
     * Decode literal/length/distance symbols until the end-of-block marker.
     *
     * The bit reader's state is copied into locals for the duration of the
     * block: it is the hottest loop in the decoder, and closure variables live
     * in a heap context, whereas locals stay in registers. The refill loops are
     * spelled out at each site for the same reason. Bits past the end of the
     * stream read as zero, so a code longer than the bits that remain is
     * reported as truncation instead of being decoded.
     */
    const decodeSymbols = (litTable: Int32Array, litMax: number, distTable: Int32Array, distMax: number) => {
        let bb = bitBuf;
        let bc = bitCnt;
        let p = pos;
        let op = outPos;
        const litMask = (1 << litMax) - 1;
        const distMask = (1 << distMax) - 1;

        for (;;) {
            if (bc < 15) {
                while (bc <= 24 && p < end) {
                    bb |= data[p++] << bc;
                    bc += 8;
                }
            }

            const literal = litTable[bb & litMask];
            const literalLength = literal & 15;
            if (literalLength > bc || literal === 0) {
                throw new Error(literal === 0 ? 'invalid deflate Huffman code' : 'truncated deflate stream');
            }
            bb >>>= literalLength;
            bc -= literalLength;
            const symbol = literal >>> 4;

            if (symbol < 256) {
                if (op === out.length) {
                    grow(op + 1);
                }
                out[op++] = symbol;
                continue;
            }
            if (symbol === 256) {
                break;
            }
            if (symbol > 285) {
                throw new Error(`invalid deflate length symbol ${symbol}`);
            }

            const lengthIndex = symbol - 257;
            const lengthBits = LENGTH_EXTRA[lengthIndex];
            if (bc < lengthBits) {
                while (bc <= 24 && p < end) {
                    bb |= data[p++] << bc;
                    bc += 8;
                }
                if (bc < lengthBits) {
                    throw new Error('truncated deflate stream');
                }
            }
            const length = LENGTH_BASE[lengthIndex] + (bb & ((1 << lengthBits) - 1));
            bb >>>= lengthBits;
            bc -= lengthBits;

            if (bc < 15) {
                while (bc <= 24 && p < end) {
                    bb |= data[p++] << bc;
                    bc += 8;
                }
            }
            const distanceLiteral = distTable[bb & distMask];
            const distanceLength = distanceLiteral & 15;
            if (distanceLength > bc || distanceLiteral === 0) {
                throw new Error(distanceLiteral === 0 ? 'invalid deflate Huffman code' : 'truncated deflate stream');
            }
            bb >>>= distanceLength;
            bc -= distanceLength;
            const distanceSymbol = distanceLiteral >>> 4;
            if (distanceSymbol > 29) {
                throw new Error(`invalid deflate distance symbol ${distanceSymbol}`);
            }

            const distanceBits = DIST_EXTRA[distanceSymbol];
            if (bc < distanceBits) {
                while (bc <= 24 && p < end) {
                    bb |= data[p++] << bc;
                    bc += 8;
                }
                if (bc < distanceBits) {
                    throw new Error('truncated deflate stream');
                }
            }
            const distance = DIST_BASE[distanceSymbol] + (bb & ((1 << distanceBits) - 1));
            bb >>>= distanceBits;
            bc -= distanceBits;

            if (distance > op) {
                throw new Error('deflate distance beyond output start');
            }
            if (op + length > out.length) {
                grow(op + length);
            }
            const from = op - distance;
            if (length > 16 && distance >= length) {
                out.copyWithin(op, from, from + length);
                op += length;
            } else {
                // Short runs and overlapping runs: byte loop. Overlap must not
                // use memmove semantics, because the pattern repeats.
                for (let i = 0; i < length; i++) {
                    out[op++] = out[from + i];
                }
            }
        }

        bitBuf = bb;
        bitCnt = bc;
        pos = p;
        outPos = op;
    };

    let final = 0;
    while (!final) {
        final = readBits(1);
        const type = readBits(2);

        if (type === 0) {
            // Stored block: hand back whole buffered bytes, then copy the run.
            pos -= bitCnt >> 3;
            bitBuf = 0;
            bitCnt = 0;
            if (pos + 4 > end - 4) {
                throw new Error('truncated deflate stream');
            }
            const length = data[pos] | (data[pos + 1] << 8);
            const complement = data[pos + 2] | (data[pos + 3] << 8);
            if ((length ^ 0xffff) !== complement) {
                throw new Error('invalid deflate stored block length');
            }
            pos += 4;
            if (pos + length > end - 4) {
                throw new Error('truncated deflate stream');
            }
            if (outPos + length > out.length) {
                grow(outPos + length);
            }
            out.set(data.subarray(pos, pos + length), outPos);
            outPos += length;
            pos += length;
            continue;
        }

        if (type === 1) {
            prepareFixedTables();
            decodeSymbols(fixedLiteralTable, 9, fixedDistanceTable, 5);
            continue;
        }

        if (type === 2) {
            const literalCount = readBits(5) + 257;
            const distanceCount = readBits(5) + 1;
            const codeLengthCount = readBits(4) + 4;

            codeLengths.fill(0);
            for (let i = 0; i < codeLengthCount; i++) {
                codeLengths[CODE_LENGTH_ORDER[i]] = readBits(3);
            }
            const codeLengthMax = buildTable(codeLengths, 19, codeLengthTable);

            const total = literalCount + distanceCount;
            codeLengths.fill(0);
            let i = 0;
            while (i < total) {
                const symbol = readSymbol(codeLengthTable, codeLengthMax);
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
                    repeat = 3 + readBits(2);
                } else if (symbol === 17) {
                    repeat = 3 + readBits(3);
                } else {
                    repeat = 11 + readBits(7);
                }
                if (i + repeat > total) {
                    throw new Error('deflate code length overflow');
                }
                while (repeat-- > 0) {
                    codeLengths[i++] = value;
                }
            }

            const literalMax = buildTable(codeLengths.subarray(0, literalCount), literalCount, literalTable);
            const distanceMax = buildTable(codeLengths.subarray(literalCount), distanceCount, distanceTable);
            decodeSymbols(literalTable, literalMax, distanceTable, distanceMax);
            continue;
        }

        throw new Error(`invalid deflate block type ${type}`);
    }

    const expected = ((data[end - 4] << 24) | (data[end - 3] << 16) | (data[end - 2] << 8) | data[end - 1]) >>> 0;
    if (adler32(out, outPos) !== expected) {
        throw new Error('zlib checksum mismatch');
    }
    return out.subarray(0, outPos);
}
