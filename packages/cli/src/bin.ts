#!/usr/bin/env node
import { main } from './cli.js';
import { defaultHandlers } from './handlers.js';

const code = await main(process.argv, defaultHandlers);
process.exitCode = code;
