import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DcmError, ExitCode, pathExists } from '@dont-copy-me/core';

/**
 * Signed permission tokens: the owner keeps an Ed25519 private key (never deployed) and publishes
 * the public key in /.well-known/copy-permission.json. A token is `<payload>.<signature>`, both
 * base64url, where the signature covers the payload bytes. Anyone can verify a token with the
 * public key; only the key holder can issue one.
 */
export interface PermissionGrant {
  /** Site the permission is for. */
  site: string;
  grantee: string;
  scope: string;
  /** ISO date. */
  issued: string;
  /** ISO date. */
  expires: string;
}

export interface TokenCheck {
  valid: boolean;
  grant?: PermissionGrant;
  reason?: string;
}

const b64url = (b: Buffer): string => b.toString('base64url');

export async function generatePermissionKey(file: string, force = false): Promise<{ publicKey: string }> {
  if ((await pathExists(file)) && !force) {
    throw new DcmError('E_EXISTS', `${file} already exists`, {
      hint: 'Keep the existing key: tokens you issued depend on it. Use --force only to replace it on purpose.',
      exitCode: ExitCode.Usage,
    });
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { encoding: 'utf8', mode: 0o600 });
  return { publicKey: publicKeyString(publicKey) };
}

/** Public key as base64 SPKI DER, the form published in copy-permission.json. */
export function publicKeyString(key: crypto.KeyObject): string {
  return key.export({ type: 'spki', format: 'der' }).toString('base64');
}

/** Loads the signing key, creating it first when it does not exist yet. */
export async function ensurePermissionKey(file: string): Promise<{ key: crypto.KeyObject; created: boolean }> {
  if (await pathExists(file)) return { key: await loadPermissionKey(file), created: false };
  await generatePermissionKey(file);
  return { key: await loadPermissionKey(file), created: true };
}

export async function loadPermissionKey(file: string): Promise<crypto.KeyObject> {
  if (!(await pathExists(file))) {
    throw new DcmError('E_NO_PERMISSION_KEY', `Permission signing key not found at ${file}`, {
      hint: 'Run `dcm grant --init` to create it (keep it private and backed up), or set rights.signedPermissions: false.',
      exitCode: ExitCode.Config,
    });
  }
  return crypto.createPrivateKey(await fs.readFile(file, 'utf8'));
}

export function signPermission(privateKey: crypto.KeyObject, grant: PermissionGrant): string {
  const payload = Buffer.from(JSON.stringify(grant), 'utf8');
  return `${b64url(payload)}.${b64url(crypto.sign(null, payload, privateKey))}`;
}

export function verifyPermission(publicKey: string, token: string, site?: string, now = new Date()): TokenCheck {
  const [p, s, extra] = token.trim().split('.');
  if (!p || !s || extra !== undefined) return { valid: false, reason: 'not a token (expected <payload>.<signature>)' };
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
    const payload = Buffer.from(p, 'base64url');
    if (!crypto.verify(null, payload, key, Buffer.from(s, 'base64url'))) return { valid: false, reason: 'signature does not match the published key' };
    const grant = JSON.parse(payload.toString('utf8')) as PermissionGrant;
    if (site && new URL(grant.site).origin !== new URL(site).origin) return { valid: false, grant, reason: `issued for ${grant.site}` };
    if (!(new Date(`${grant.expires}T23:59:59Z`) >= now)) return { valid: false, grant, reason: `expired on ${grant.expires}` };
    return { valid: true, grant };
  } catch (error) {
    return { valid: false, reason: (error as Error).message };
  }
}

/**
 * One-line Node.js check published next to the key, so anyone can verify a token without dcm. It
 * checks the signature, the site (when known) and the expiry date.
 */
export function verifySnippet(publicKey: string, site?: string): string {
  const siteCheck = site ? `new URL(g.site).origin!=='${new URL(site).origin}'?'INVALID: other site':` : '';
  return (
    `node -e "const c=require('crypto');const [p,s]=process.argv[1].split('.');const b=Buffer.from(p,'base64url');` +
    `const k=c.createPublicKey({key:Buffer.from('${publicKey}','base64'),format:'der',type:'spki'});` +
    `const g=c.verify(null,b,k,Buffer.from(s||'','base64url'))&&JSON.parse(b);` +
    `console.log(!g?'INVALID':${siteCheck}!(new Date(g.expires+'T23:59:59Z')>=new Date())?'EXPIRED':'VALID '+b)" <token>`
  );
}
