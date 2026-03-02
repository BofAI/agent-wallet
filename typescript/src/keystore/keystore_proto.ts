import { Buffer } from 'buffer';
import type { KeystoreData } from './keystore';

/**
 * Minimal protobuf encoder/decoder for:
 *
 * message KeystoreData {
 *   map<string, string> entries = 1;
 * }
 *
 * Wire-level equivalent to:
 *
 * message KeystoreData {
 *   message EntriesEntry {
 *     string key = 1;
 *     string value = 2;
 *   }
 *   repeated EntriesEntry entries = 1;
 * }
 */

const WIRE_TYPE_VARINT = 0;
const WIRE_TYPE_64BIT = 1;
const WIRE_TYPE_LENGTH_DELIMITED = 2;
const WIRE_TYPE_32BIT = 5;

function encodeVarint(value: number): Buffer {
  const chunks: number[] = [];
  let v = value >>> 0;
  while (v >= 0x80) {
    chunks.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  chunks.push(v);
  return Buffer.from(chunks);
}

function decodeVarint(buf: Buffer, offset: number): { value: number; nextOffset: number } {
  let result = 0;
  let shift = 0;
  let pos = offset;
  let bytesRead = 0;
  while (pos < buf.length) {
    if (bytesRead >= 5) throw new Error('Varint too long (> 5 bytes for uint32)');
    const b = buf[pos++];
    bytesRead++;
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) {
      return { value: result >>> 0, nextOffset: pos };
    }
    shift += 7;
  }
  throw new Error('Unexpected end of buffer while decoding varint');
}

/**
 * Skip a field based on wire type. Returns the new offset after skipping.
 */
function skipField(buf: Buffer, offset: number, wireType: number): number {
  switch (wireType) {
    case WIRE_TYPE_VARINT: {
      const { nextOffset } = decodeVarint(buf, offset);
      return nextOffset;
    }
    case WIRE_TYPE_64BIT:
      if (offset + 8 > buf.length) throw new Error('Unexpected end of buffer skipping 64-bit field');
      return offset + 8;
    case WIRE_TYPE_LENGTH_DELIMITED: {
      const { value: len, nextOffset } = decodeVarint(buf, offset);
      if (nextOffset + len > buf.length) throw new Error('Length-delimited field exceeds buffer');
      return nextOffset + len;
    }
    case WIRE_TYPE_32BIT:
      if (offset + 4 > buf.length) throw new Error('Unexpected end of buffer skipping 32-bit field');
      return offset + 4;
    default:
      throw new Error(`Unknown wire type ${wireType}`);
  }
}

function encodeStringField(fieldNumber: number, value: string): Buffer {
  const tag = encodeVarint((fieldNumber << 3) | WIRE_TYPE_LENGTH_DELIMITED);
  const bytes = Buffer.from(value, 'utf8');
  const len = encodeVarint(bytes.length);
  return Buffer.concat([tag, len, bytes]);
}

export function encodeKeystoreData(data: KeystoreData): Buffer {
  const outerChunks: Buffer[] = [];

  for (const [key, value] of Object.entries(data)) {
    const entryBuf = Buffer.concat([
      encodeStringField(1, key),
      encodeStringField(2, value)
    ]);
    // entries field = 1, wire type = length-delimited
    const tag = encodeVarint((1 << 3) | WIRE_TYPE_LENGTH_DELIMITED);
    const len = encodeVarint(entryBuf.length);
    outerChunks.push(tag, len, entryBuf);
  }

  return Buffer.concat(outerChunks);
}

export function decodeKeystoreData(buf: Buffer): KeystoreData {
  const result: KeystoreData = {};
  let offset = 0;

  while (offset < buf.length) {
    // Decode tag as varint
    const { value: tag, nextOffset: tagEnd } = decodeVarint(buf, offset);
    offset = tagEnd;
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;

    if (fieldNumber !== 1 || wireType !== WIRE_TYPE_LENGTH_DELIMITED) {
      offset = skipField(buf, offset, wireType);
      continue;
    }

    // Read sub-message length
    const { value: msgLen, nextOffset: msgStart } = decodeVarint(buf, offset);
    offset = msgStart;
    if (offset + msgLen > buf.length) {
      throw new Error(`Sub-message length ${msgLen} exceeds buffer (offset=${offset}, bufLen=${buf.length})`);
    }
    const end = offset + msgLen;

    let key: string | undefined;
    let value: string | undefined;

    while (offset < end) {
      const { value: innerTag, nextOffset: innerTagEnd } = decodeVarint(buf, offset);
      offset = innerTagEnd;
      const innerField = innerTag >>> 3;
      const innerWire = innerTag & 0x07;

      if (innerWire !== WIRE_TYPE_LENGTH_DELIMITED) {
        offset = skipField(buf, offset, innerWire);
        continue;
      }

      const { value: strLen, nextOffset: strStart } = decodeVarint(buf, offset);
      offset = strStart;
      if (offset + strLen > end) {
        throw new Error(`String length ${strLen} exceeds sub-message boundary`);
      }
      const str = buf.subarray(offset, offset + strLen).toString('utf8');
      offset += strLen;

      if (innerField === 1) key = str;
      else if (innerField === 2) value = str;
    }

    if (key !== undefined && value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}
