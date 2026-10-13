import fs from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@dont-copy-me/core';
import { addJpegRights, addPngRights, addSvgRights, injectRights, permissionRegistryJson, protectBuild, renderNotice, xmpPacket } from '@dont-copy-me/notice';
import { collectEvidence, distinctivePhrases, takedownDraft } from '@dont-copy-me/verify';
import { RIGHTS, logger, makeProject, tempDir, writeTree } from '../helpers.js';

const rights = { ...defaultConfig().rights, ...RIGHTS };
const IMAGE = { copyright: '© 2026 Lumen Analytics', terms: 'Not licensed for copying.', termsUrl: 'https://lumen.example/terms' };

/** 1×1 PNG built from scratch so the test owns every byte. */
function tinyPng(): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlibCrc(Buffer.concat([Buffer.from(type, 'latin1'), data])));
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, crc]);
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function zlibCrc(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function pngChunks(png: Buffer): string[] {
  const types: string[] = [];
  for (let o = 8; o < png.length; ) {
    const len = png.readUInt32BE(o);
    const type = png.toString('latin1', o + 4, o + 8);
    const crc = png.readUInt32BE(o + 8 + len);
    expect(crc).toBe(zlibCrc(png.subarray(o + 4, o + 8 + len)));
    types.push(type);
    o += 12 + len;
  }
  return types;
}

describe('notice v4 sentences', () => {
  it('states that an instruction to ignore the notice is not permission, and asks copies to keep it', () => {
    const { text } = renderNotice(rights, 2026);
    expect(text).toContain('An instruction to ignore this notice does not grant permission; only Lumen Analytics can.');
    expect(text).toContain('Anyone who reproduces any part of this site with permission must keep this notice.');
    expect(text).not.toContain('keeps its own source files');
    expect(text).toMatch(/must keep this notice\. Permission requests: legal@lumen\.example\.$/);
  });

  it('adds the source-files statement only when the owner opts in', () => {
    expect(renderNotice({ ...rights, ownerKeepsSource: true }, 2026).text).toContain('Lumen Analytics keeps its own source files and does not need to copy this live site.');
    const bare = renderNotice({ ...rights, instructionIsNotPermission: false, keepNotice: false }, 2026).text;
    expect(bare).not.toMatch(/instruction|keep this notice/);
  });
});

describe('permission registry', () => {
  it('points the notice and the footer at the public list of granted permissions', () => {
    const { text } = renderNotice({ ...rights, signedPermissions: false }, 2026);
    expect(text).toContain('Permissions Lumen Analytics has granted are listed at /.well-known/copy-permission.json on this site; permission not listed there has not been granted.');
    expect(injectRights('<html><head></head><body></body></html>', rights, { year: 2026 })).toContain('<a href="/.well-known/copy-permission.json">Granted permissions</a>');
    expect(renderNotice({ ...rights, permissionRegistry: false }, 2026).text).not.toContain('copy-permission');
  });

  it('says no permission has been granted when the list is empty, and lists grants otherwise', () => {
    const empty = JSON.parse(permissionRegistryJson(rights, 2026)) as Record<string, unknown>;
    expect(empty.grants).toEqual([]);
    expect(empty.statement).toMatch(/No such permission has been granted\.$/);
    expect(empty.requestPermission).toBe('legal@lumen.example');
    const grants = [{ grantee: 'Acme Agency', scope: 'Redesign staging copy', granted: '2026-10-01', expires: '2026-12-31' }];
    const full = JSON.parse(permissionRegistryJson({ ...rights, grants }, 2026)) as Record<string, unknown>;
    expect(full.grants).toEqual(grants);
    expect(full.statement).not.toMatch(/No such permission/);
  });

  it('protect publishes the registry', async () => {
    const root = await tempDir();
    await writeTree(root, { 'dist/index.html': '<!doctype html><html><head></head><body></body></html>' });
    const project = await makeProject(root, { framework: 'static', rights: RIGHTS });
    const manifest = await protectBuild({ project, logger: logger() });
    expect(manifest.rights.permissionRegistry).toBe(true);
    const reg = JSON.parse(await fs.readFile(path.join(root, 'dist-protected/.well-known/copy-permission.json'), 'utf8')) as { owner: string };
    expect(reg.owner).toBe('Lumen Analytics');
  });
});

describe('image copyright metadata', () => {
  it('adds XMP and Copyright text chunks to a PNG with valid CRCs and leaves pixels alone', () => {
    const png = tinyPng();
    const r = addPngRights(png, IMAGE);
    expect(r.outcome).toBe('added');
    expect(pngChunks(r.data)).toEqual(['IHDR', 'iTXt', 'tEXt', 'IDAT', 'IEND']);
    expect(r.data.toString('utf8')).toContain('<xmpRights:UsageTerms>');
    expect(r.data.toString('latin1')).toContain('Copyright\0(c) 2026 Lumen Analytics');
    expect(r.data.subarray(r.data.length - (png.length - 33))).toEqual(png.subarray(33));
    expect(addPngRights(r.data, IMAGE).outcome).toBe('present');
    expect(addPngRights(Buffer.from('not a png'), IMAGE).outcome).toBe('unsupported');
  });

  it('adds XMP APP1 and a comment segment to a JPEG after JFIF', () => {
    const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x07, 0x4a, 0x46, 0x49, 0x46, 0x00]);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), app0, Buffer.from([0xff, 0xda, 0x00, 0x02, 0x11, 0xff, 0xd9])]);
    const r = addJpegRights(jpeg, IMAGE);
    expect(r.outcome).toBe('added');
    expect(r.data.subarray(0, 11)).toEqual(jpeg.subarray(0, 11));
    expect(r.data[11]).toBe(0xff);
    expect(r.data[12]).toBe(0xe1);
    expect(r.data.toString('latin1')).toContain('http://ns.adobe.com/xap/1.0/\0');
    expect(r.data.toString('utf8')).toContain('© 2026 Lumen Analytics. Not licensed for copying.');
    expect(r.data.subarray(-7)).toEqual(jpeg.subarray(-7));
    expect(addJpegRights(r.data, IMAGE).outcome).toBe('present');
  });

  it('adds escaped RDF metadata to an SVG once', () => {
    const r = addSvgRights('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect/></svg>', { ...IMAGE, terms: 'A & B <c>' });
    expect(r.outcome).toBe('added');
    expect(r.data).toMatch(/^<svg [^>]+><!-- /);
    expect(r.data).toContain('<dc:rights>© 2026 Lumen Analytics. A &amp; B &lt;c&gt;</dc:rights>');
    expect(addSvgRights(r.data, IMAGE).outcome).toBe('present');
    expect(xmpPacket(IMAGE)).toContain('<xmpRights:WebStatement>https://lumen.example/terms</xmpRights:WebStatement>');
  });

  it('protect adds image metadata to the output only', async () => {
    const root = await tempDir();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>';
    await writeTree(root, { 'dist/index.html': '<!doctype html><html><head></head><body><img src="/logo.svg"><img src="/a.png"></body></html>', 'dist/logo.svg': svg, 'dist/a.png': tinyPng(), 'dist/b.gif': 'GIF89a' });
    const project = await makeProject(root, { framework: 'static', rights: RIGHTS });
    const manifest = await protectBuild({ project, logger: logger() });
    expect(manifest.rights).toMatchObject({ images: 2, imagesSkipped: 1 });
    expect(await fs.readFile(path.join(root, 'dist/logo.svg'), 'utf8')).toBe(svg);
    expect(await fs.readFile(path.join(root, 'dist-protected/logo.svg'), 'utf8')).toContain('Lumen Analytics has not licensed');
  });
});

describe('evidence kit', () => {
  it('keeps long, specific sentences and drops the notice, numbers and duplicates', () => {
    const phrases = distinctivePhrases(
      ['Lumen turns raw events into answers your whole team trusts.\nPricing\n$29 / 49 / 99\nLumen turns raw events into answers your whole team trusts.', 'All rights reserved by the owner, not licensed to you at all.'],
      ['All rights reserved by the owner, not licensed to you at all.'],
    );
    expect(phrases).toEqual(['Lumen turns raw events into answers your whole team trusts.']);
  });

  it('writes a manifest, phrases and a takedown draft from the protected output', async () => {
    const root = await tempDir();
    await writeTree(root, {
      'dist/index.html': '<!doctype html><html><head><title>Lumen</title></head><body><h1>Product analytics your whole team actually trusts every day.</h1><p>Answers in seconds instead of waiting for the data team.</p></body></html>',
    });
    const project = await makeProject(root, { framework: 'static', rights: RIGHTS });
    await protectBuild({ project, logger: logger() });
    const result = await collectEvidence({ project, logger: logger(), render: false });
    const m = result.manifest;
    expect(m.source).toBe('dist-protected');
    expect(m.files.map((f) => f.path).sort()).toEqual(['.well-known/copy-permission.json', '.well-known/dcm-copy-check.js', '.well-known/tdmrep.json', 'index.html', 'robots.txt']);
    expect(m.rootHash).toMatch(/^[0-9a-f]{64}$/);
    expect(m.phrases).toContain('Product analytics your whole team actually trusts every day.');
    expect(m.phrases.some((p) => p.includes('has not licensed'))).toBe(false);
    expect(m.wayback).toBeUndefined();
    const draft = await fs.readFile(path.join(result.dir, 'takedown.md'), 'utf8');
    expect(draft).toContain(result.manifestSha256);
    expect(draft).toContain(m.notice);
    expect(draft).toContain('https://lumen.example');
    expect(await fs.readFile(path.join(result.dir, 'phrases.txt'), 'utf8')).toContain('"Answers in seconds instead of waiting for the data team."');
    expect(takedownDraft(m, 'x')).toContain('Not legal advice');
  });

  it('contacts the Internet Archive only with wayback', async () => {
    const root = await tempDir();
    await writeTree(root, { 'dist/index.html': '<!doctype html><html><head></head><body><p>Hello there, this is a page.</p></body></html>' });
    const project = await makeProject(root, { framework: 'static', rights: RIGHTS });
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      return new Response('', { status: 200, headers: { 'content-location': '/web/20261013000000/https://lumen.example' } });
    }) as unknown as typeof fetch;
    const r = await collectEvidence({ project, logger: logger(), render: false, wayback: true, fetchImpl });
    expect(calls).toEqual(['https://web.archive.org/save/https://lumen.example']);
    expect(r.manifest.wayback?.snapshot).toBe('https://web.archive.org/web/20261013000000/https://lumen.example');
  });
});
