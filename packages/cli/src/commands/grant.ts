import crypto from 'node:crypto';
import path from 'node:path';
import { DcmError, ExitCode } from '@dont-copy-me/core';
import { generatePermissionKey, loadPermissionKey, publicKeyString, signPermission, verifyPermission } from '@dont-copy-me/notice';
import { createContext, rel, type GlobalOptions } from '../context.js';
import { paint } from '../format.js';

export interface GrantCliOptions {
  init?: boolean;
  force?: boolean;
  to?: string;
  scope?: string;
  days?: number;
  verify?: string;
}

/** Creates the signing key, issues signed permission tokens, or checks one. */
export async function runGrant(global: GlobalOptions, options: GrantCliOptions): Promise<number> {
  const ctx = await createContext(global);
  const { logger, project } = ctx;
  const rights = project.config.rights;
  const keyFile = path.resolve(project.root, rights.keyFile);

  if (options.init) {
    const { publicKey } = await generatePermissionKey(keyFile, Boolean(options.force));
    ctx.emit({ keyFile: rel(project, keyFile), publicKey });
    logger.success(`Signing key written to ${rel(project, keyFile)}. Keep it private, never deploy it, and back it up.`);
    if (!rights.signedPermissions) logger.info('Set rights.signedPermissions: true and run `dcm protect` to publish the public key.');
    return ExitCode.Ok;
  }

  const key = await loadPermissionKey(keyFile);
  const publicKey = publicKeyString(crypto.createPublicKey(key));
  if (options.verify) {
    const check = verifyPermission(publicKey, options.verify, rights.siteUrl);
    ctx.emit(check);
    if (check.valid) logger.success(`Valid token: ${check.grant?.grantee} · ${check.grant?.scope} · until ${check.grant?.expires}`);
    else logger.error(`Invalid token: ${check.reason}`);
    return check.valid ? ExitCode.Ok : ExitCode.Failure;
  }

  if (!options.to || !options.scope) {
    throw new DcmError('E_USAGE', 'dcm grant needs --to and --scope (or --init / --verify)', {
      hint: 'Example: dcm grant --to "Acme Agency" --scope "staging copy for the redesign" --days 30',
      exitCode: ExitCode.Usage,
    });
  }
  const issued = new Date();
  const expires = new Date(issued.getTime() + (options.days ?? 30) * 86_400_000);
  const grant = {
    site: rights.siteUrl ?? rights.owner,
    grantee: options.to,
    scope: options.scope,
    issued: issued.toISOString().slice(0, 10),
    expires: expires.toISOString().slice(0, 10),
  };
  const token = signPermission(key, grant);
  ctx.emit({ token, grant });
  if (!global.json) {
    logger.info(`Permission for ${grant.grantee}: ${grant.scope} (until ${grant.expires})`);
    process.stdout.write(`${token}\n`);
    logger.info(paint('gray', 'Give this token to the person or agent; it can be checked against the key in /.well-known/copy-permission.json.'));
  }
  return ExitCode.Ok;
}
