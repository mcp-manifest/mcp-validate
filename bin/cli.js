#!/usr/bin/env node

import { readFileSync } from 'fs';
import { validateManifest, discover, checkCommand } from '../src/index.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

function pass(msg) { console.log(`  ${GREEN}\u2713${RESET} ${msg}`); }
function fail(msg) { console.log(`  ${RED}\u2717${RESET} ${msg}`); }
function warn(msg) { console.log(`  ${YELLOW}\u26A0${RESET} ${msg}`); }
function info(msg) { console.log(`  ${CYAN}\u2139${RESET} ${msg}`); }
function heading(msg) { console.log(`\n${BOLD}${msg}${RESET}`); }

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`
${BOLD}mcp-manifest-validate${RESET} — Validate MCP manifests and test autodiscovery

${BOLD}Usage:${RESET}
  mcp-manifest-validate <file|url|domain>  Validate a manifest
  mcp-manifest-validate --discover <domain> Test autodiscovery only

${BOLD}Examples:${RESET}
  mcp-manifest-validate ./mcp-manifest.json
  mcp-manifest-validate ironlicensing.com
  mcp-manifest-validate https://example.com/mcp-manifest.json
  mcp-manifest-validate --discover ironlicensing.com

${BOLD}Options:${RESET}
  --discover   Only test autodiscovery, don't validate
  --json       Output results as JSON
  --help       Show this help
`);
  process.exit(0);
}

const discoverOnly = args.includes('--discover');
const jsonOutput = args.includes('--json');
const input = args.filter(a => !a.startsWith('--'))[0];

if (!input) {
  console.error(`${RED}Error: provide a file path, URL, or domain${RESET}`);
  process.exit(1);
}

let totalErrors = 0;

async function run() {
  heading('MCP Manifest Validator');
  console.log(`${DIM}Input: ${input}${RESET}`);

  // Step 1: Discover / Load
  heading('Discovery');
  let manifest;

  const { manifest: discovered, source, errors: discoverErrors } = await discover(input);

  if (discovered) {
    pass(`Manifest found via ${source}`);
    manifest = discovered;
  } else {
    fail('Manifest not found');
    for (const err of discoverErrors) {
      info(`${DIM}${err}${RESET}`);
    }
    totalErrors++;

    if (discoverOnly || !manifest) {
      printResult();
      return;
    }
  }

  if (discoverOnly) {
    printResult();
    return;
  }

  // Step 2: Schema validation
  heading('Schema Validation');
  const { valid, errors: schemaErrors } = validateManifest(manifest);

  if (valid) {
    pass('Valid against mcp-manifest schema v0.1');
  } else {
    for (const err of schemaErrors) {
      fail(err);
      totalErrors++;
    }
  }

  // Step 3: Server info
  heading('Server Info');
  if (manifest.server) {
    info(`Name: ${BOLD}${manifest.server.displayName || manifest.server.name}${RESET}`);
    info(`Version: ${manifest.server.version}`);
    if (manifest.server.description) info(`Description: ${manifest.server.description}`);
    if (manifest.server.author) info(`Author: ${manifest.server.author}`);
    if (manifest.server.homepage) info(`Homepage: ${manifest.server.homepage}`);
  }

  // Step 4: Install check
  heading('Installation');
  if (manifest.install && manifest.install.length > 0) {
    const preferred = manifest.install.sort((a, b) => (a.priority || 0) - (b.priority || 0))[0];
    info(`Method: ${preferred.method} (${preferred.package})`);
    info(`Command: ${BOLD}${preferred.command}${RESET}`);

    const exists = await checkCommand(preferred.command);
    if (exists) {
      pass(`"${preferred.command}" found on PATH`);
    } else {
      warn(`"${preferred.command}" not found on PATH`);
      info(`Install: ${DIM}${getInstallCommand(preferred)}${RESET}`);
    }
  }

  // Step 5: Transport
  heading('Transport');
  info(`Type: ${manifest.transport}`);
  if ((manifest.transport === 'sse' || manifest.transport === 'streamable-http') && manifest.endpoint) {
    info(`Endpoint: ${manifest.endpoint}`);
  }

  // Step 6: Config
  if (manifest.config && manifest.config.length > 0) {
    heading('Config');
    for (const c of manifest.config) {
      const flags = [];
      if (c.required) flags.push(`${RED}required${RESET}`);
      if (c.type === 'secret') flags.push(`${YELLOW}secret${RESET}`);
      if (c.env_var) flags.push(`env: ${c.env_var}`);
      if (c.arg) flags.push(`arg: ${c.arg}`);
      const flagStr = flags.length > 0 ? ` ${DIM}(${flags.join(', ')})${RESET}` : '';
      info(`${c.key} [${c.type}]${flagStr}`);
    }
  }

  // Step 7: Scopes
  if (manifest.scopes) {
    heading('Scopes');
    info(manifest.scopes.join(', '));
  }

  printResult();
}

function getInstallCommand(install) {
  switch (install.method) {
    case 'dotnet-tool':
      return install.source
        ? `dotnet tool install -g ${install.package} --add-source "${install.source}"`
        : `dotnet tool install -g ${install.package}`;
    case 'npm': return `npm install -g ${install.package}`;
    case 'pip': return `pip install ${install.package}`;
    case 'cargo': return `cargo install ${install.package}`;
    default: return `Install ${install.package} (${install.method})`;
  }
}

function printResult() {
  console.log('');
  if (totalErrors === 0) {
    console.log(`${GREEN}${BOLD}\u2713 All checks passed${RESET}`);
    process.exit(0);
  } else {
    console.log(`${RED}${BOLD}\u2717 ${totalErrors} error(s) found${RESET}`);
    process.exit(1);
  }
}

run().catch(err => {
  console.error(`${RED}Fatal: ${err.message}${RESET}`);
  process.exit(2);
});
