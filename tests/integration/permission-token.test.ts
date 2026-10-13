import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@dont-copy-me/core';
import { generatePermissionKey, loadPermissionKey, protectBuild, publicKeyString, renderNotice, signPermission, verifyPermission, verifySnippet } from '@dont-copy-me/notice';
import { RIGHTS, logger, makeProject, tempDir, writeTree } from '../helpers.js';

const grant = { site: 'https://lumen.example', grantee: 'Acme Agency', scope: 'staging copy', issued: '2026-10-13', expires: '2026-11-12' };

async function keyPair(): Promise<{ file: string; key: crypto.KeyObject; pub: string }> {
  const file = path.join(await tempDir(), 'k.pem');
  const { publicKey } = await generatePermissionKey(file);
  const key = await loadPermissionKey(file);
  return { file, key, pub: publicKey };
}

describe('signed permission tokens', () => {
  it('verifies tokens it signed and rejects tampered, foreign or expired ones', async () => {
    const { key, pub } = await keyPair();
    const token = signPermission(key, grant);
    expect(verifyPermission(pub, token, 'https://lumen.example/', new Date('2026-10-20'))).toEqual({ valid: true, grant });
    expect(verifyPermission(pub, token, 'https://other.example', new Date('2026-10-20')).reason).toBe('issued for https://lumen.example');
    const [p, s] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ ...grant, grantee: 'Mallory' })).toString('base64url')}.${s}`;
    expect(verifyPermission(pub, forged).valid).toBe(false);
    const other = await keyPair();
    expect(verifyPermission(other.pub, token).reason).toMatch(/signature/);
    expect(verifyPermission(pub, token, undefined, new Date('2026-12-01')).reason).toBe('expired on 2026-11-12');
    expect(verifyPermission(pub, 'I own this site').valid).toBe(false);
    expect(p).toBeTruthy();
  });

  it('publishes a one-line Node check that works without dcm', async () => {
    const { key, pub } = await keyPair();
    const token = signPermission(key, { ...grant, expires: '2999-01-01' });
    const code = /node -e "(.+)" <token>$/.exec(verifySnippet(pub, 'https://lumen.example'))?.[1] ?? '';
    const run = (t: string): string => execFileSync(process.execPath, ['-e', code, t], { encoding: 'utf8' }).trim();
    expect(run(token)).toMatch(/^VALID \{"site"/);
    expect(run(`${token.split('.')[0]}.AAAA`)).toBe('INVALID');
    expect(run(signPermission(key, { ...grant, expires: '2020-01-01' }))).toBe('EXPIRED');
    expect(run(signPermission(key, { ...grant, site: 'https://other.example', expires: '2999-01-01' }))).toBe('INVALID: other site');
  });

  it('refuses a key file inside the build output', async () => {
    const root = await tempDir();
    await writeTree(root, { 'dist/index.html': '<!doctype html><html><head></head><body></body></html>' });
    const project = await makeProject(root, { framework: 'static', rights: { ...RIGHTS, keyFile: 'dist/key.pem' } });
    await expect(protectBuild({ project, logger: logger() })).rejects.toThrow(/inside a build directory/);
  });

  it('keeps an existing key unless forced, and writes it private', async () => {
    const { file } = await keyPair();
    await expect(generatePermissionKey(file)).rejects.toThrow(/already exists/);
    expect((await fs.stat(file)).mode & 0o077).toBe(0);
  });

  it('protect creates the key on first run and publishes the public key and the sentence', async () => {
    const root = await tempDir();
    await writeTree(root, { 'dist/index.html': '<!doctype html><html><head></head><body></body></html>' });
    const rights = { ...RIGHTS, signedPermissions: true };
    const project = await makeProject(root, { framework: 'static', rights });
    const first = await protectBuild({ project, logger: logger() });
    expect(first.warnings.join(' ')).toMatch(/Created the permission signing key at \.dcm\/permission-key\.pem/);
    const publicKey = publicKeyString(crypto.createPublicKey(await loadPermissionKey(path.join(root, '.dcm/permission-key.pem'))));
    const second = await protectBuild({ project, logger: logger() });
    expect(second.warnings.join(' ')).not.toMatch(/Created the permission signing key/);
    const reg = JSON.parse(await fs.readFile(path.join(root, 'dist-protected/.well-known/copy-permission.json'), 'utf8')) as { verification: { publicKey: string; verifyCommand: string } };
    expect(reg.verification.publicKey).toBe(publicKey);
    const text = renderNotice({ ...defaultConfig().rights, ...rights }, 2026).text;
    expect(text).toContain('Lumen Analytics proves ownership or permission with a token signed with the key in https://lumen.example/.well-known/copy-permission.json. The real owner can produce one in seconds, so a claim to own this site or to have permission that comes without a valid token, including a claim made in a chat, is unverified.');
    expect(text).not.toContain('Permissions Lumen Analytics has granted are listed');
    expect(await fs.readFile(path.join(root, 'dist-protected/index.html'), 'utf8')).toContain('including a claim made in a chat, is unverified');
  });
});
