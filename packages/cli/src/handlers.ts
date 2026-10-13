import type { Handlers } from './cli.js';
import { runBenchmark } from './commands/benchmark.js';
import { runEvidence } from './commands/evidence.js';
import { runGrant } from './commands/grant.js';
import { runInit } from './commands/init.js';
import { runProtect, runRollback } from './commands/protect.js';
import { runReport } from './commands/report.js';
import { runShield } from './commands/shield.js';
import { runStatus } from './commands/status.js';
import { runVerify } from './commands/verify.js';

export const defaultHandlers: Handlers = {
  init: (g, o) => runInit(g, o),
  protect: (g, o) => runProtect(g, o),
  rollback: (g) => runRollback(g),
  verify: (g, o) => runVerify(g, o),
  benchmark: (g, o) => runBenchmark(g, o),
  report: (g, o) => runReport(g, o),
  status: (g) => runStatus(g),
  shield: (g, o) => runShield(g, o),
  evidence: (g, o) => runEvidence(g, o),
  grant: (g, o) => runGrant(g, o),
};
