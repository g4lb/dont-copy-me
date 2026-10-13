import { crc32 } from 'node:zlib';

/**
 * Standard copyright metadata for images: the same fields photographers and stock libraries use
 * (XMP `dc:rights` / `xmpRights:UsageTerms`, PNG `Copyright` text, JPEG comment, SVG `<metadata>`).
 * Anyone can read and strip them; they are a rights statement that often travels with copied
 * files, not a hidden watermark. Pixels are never changed.
 */
export interface ImageRights {
  /** Short copyright line, e.g. "© 2026 Lumen Analytics". */
  copyright: string;
  /** Full notice text. */
  terms: string;
  termsUrl?: string | undefined;
}

export type ImageMetaOutcome = 'added' | 'present' | 'unsupported';

const XMP_KEYWORD = 'XML:com.adobe.xmp';
const XMP_JPEG_NS = 'http://ns.adobe.com/xap/1.0/\0';
const MARKER = 'dcm-rights';

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] as string);
}

/** The notice usually starts with the copyright line already; avoid repeating it. */
function statement(rights: ImageRights): string {
  return rights.terms.includes(rights.copyright) ? rights.terms : `${rights.copyright}. ${rights.terms}`;
}

export function xmpPacket(rights: ImageRights): string {
  const lang = (v: string): string => `<rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(v)}</rdf:li></rdf:Alt>`;
  return [
    `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>`,
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="${MARKER}">`,
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/">',
    `<dc:rights>${lang(rights.copyright)}</dc:rights>`,
    `<xmpRights:UsageTerms>${lang(rights.terms)}</xmpRights:UsageTerms>`,
    '<xmpRights:Marked>True</xmpRights:Marked>',
    ...(rights.termsUrl ? [`<xmpRights:WebStatement>${escapeXml(rights.termsUrl)}</xmpRights:WebStatement>`] : []),
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="r"?>',
  ].join('');
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** Adds an XMP `iTXt` chunk and a `Copyright` `tEXt` chunk after IHDR. */
export function addPngRights(png: Buffer, rights: ImageRights): { data: Buffer; outcome: ImageMetaOutcome } {
  if (png.length < 33 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return { data: png, outcome: 'unsupported' };
  let offset = 8;
  let ihdrEnd = -1;
  while (offset + 8 <= png.length) {
    const len = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    const end = offset + 12 + len;
    if (end > png.length) return { data: png, outcome: 'unsupported' };
    if (type === 'IHDR') ihdrEnd = end;
    if ((type === 'iTXt' || type === 'tEXt') && png.toString('latin1', offset + 8, offset + 8 + XMP_KEYWORD.length + 1).startsWith(XMP_KEYWORD)) {
      return { data: png, outcome: 'present' };
    }
    if (type === 'IEND') break;
    offset = end;
  }
  if (ihdrEnd < 0) return { data: png, outcome: 'unsupported' };
  // iTXt: keyword \0 compression-flag(0) compression-method(0) language \0 translated-keyword \0 text
  const itxt = Buffer.concat([Buffer.from(`${XMP_KEYWORD}\0\0\0\0\0`, 'latin1'), Buffer.from(xmpPacket(rights), 'utf8')]);
  // tEXt is Latin-1 only: keep the copyright line ASCII-safe.
  const latin = (s: string): string => s.replace(/©/g, '(c)').replace(/[^\x20-\x7e]/g, '?');
  const text = Buffer.from(`Copyright\0${latin(statement(rights))}`, 'latin1');
  const data = Buffer.concat([png.subarray(0, ihdrEnd), pngChunk('iTXt', itxt), pngChunk('tEXt', text), png.subarray(ihdrEnd)]);
  return { data, outcome: 'added' };
}

function jpegSegment(marker: number, payload: Buffer): Buffer | undefined {
  if (payload.length + 2 > 0xffff) return undefined;
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** Adds an XMP APP1 segment and a COM (comment) segment after SOI / APP0. */
export function addJpegRights(jpeg: Buffer, rights: ImageRights): { data: Buffer; outcome: ImageMetaOutcome } {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return { data: jpeg, outcome: 'unsupported' };
  let offset = 2;
  let insertAt = 2;
  while (offset + 4 <= jpeg.length && jpeg[offset] === 0xff) {
    const marker = jpeg[offset + 1] as number;
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
    const len = jpeg.readUInt16BE(offset + 2);
    if (marker === 0xe1 && jpeg.toString('latin1', offset + 4, offset + 4 + XMP_JPEG_NS.length) === XMP_JPEG_NS) {
      return { data: jpeg, outcome: 'present' };
    }
    if (marker === 0xe0) insertAt = offset + 2 + len; // keep JFIF first
    offset += 2 + len;
  }
  const app1 = jpegSegment(0xe1, Buffer.concat([Buffer.from(XMP_JPEG_NS, 'latin1'), Buffer.from(xmpPacket(rights), 'utf8')]));
  const com = jpegSegment(0xfe, Buffer.from(statement(rights), 'utf8'));
  if (!app1 || !com) return { data: jpeg, outcome: 'unsupported' };
  return { data: Buffer.concat([jpeg.subarray(0, insertAt), app1, com, jpeg.subarray(insertAt)]), outcome: 'added' };
}

/** Adds a comment and RDF `<metadata>` right after the opening `<svg>` tag. */
export function addSvgRights(svg: string, rights: ImageRights): { data: string; outcome: ImageMetaOutcome } {
  if (svg.includes(MARKER)) return { data: svg, outcome: 'present' };
  const open = /<svg\b[^>]*>/i.exec(svg);
  if (!open) return { data: svg, outcome: 'unsupported' };
  const meta =
    `<!-- ${escapeXml(statement(rights)).replace(/--/g, '—')} -->` +
    `<metadata id="${MARKER}"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
    `<rdf:Description><dc:rights>${escapeXml(statement(rights))}</dc:rights>` +
    `${rights.termsUrl ? `<dc:source>${escapeXml(rights.termsUrl)}</dc:source>` : ''}</rdf:Description></rdf:RDF></metadata>`;
  const at = open.index + open[0].length;
  return { data: `${svg.slice(0, at)}${meta}${svg.slice(at)}`, outcome: 'added' };
}
