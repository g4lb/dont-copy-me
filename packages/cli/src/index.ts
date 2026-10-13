/**
 * Programmatic API. `defineConfig` is what dcm.config.ts imports.
 */
export { defineConfig, type DcmConfig, type DcmConfigInput } from '@dont-copy-me/core';
export { protectBuild, type ProtectManifest } from '@dont-copy-me/notice';
export { verifyBuilds, type VerifyReport } from '@dont-copy-me/verify';
export { createProgram, main, type Handlers } from './cli.js';
export { defaultHandlers } from './handlers.js';
export { ADAPTERS, createContext } from './context.js';
