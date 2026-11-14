#!/usr/bin/env node
// urgent-first command-line entry point.
import { main } from '../src/cli.js';

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code ?? 0;
  },
  (err) => {
    process.stderr.write(`urgent-first: unexpected error: ${err && err.stack ? err.stack : err}\n`);
    process.exitCode = 1;
  },
);
