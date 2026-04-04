#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { readSettings, generateManifest } from '../src/generate.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${BOLD}mcp-manifest-generate${RESET} — Generate mcp-manifest.json from existing MCP server configs

${BOLD}Usage:${RESET}
  mcp-manifest-generate                              List servers in default settings
  mcp-manifest-generate --server <name>              Generate manifest for a specific server
  mcp-manifest-generate --init                       Interactive wizard (from scratch)
  mcp-manifest-generate --from-settings <path>       Use a specific settings file
  mcp-manifest-generate --server <name> --probe      Also run MCP handshake for server info
  mcp-manifest-generate --server <name> -o <file>    Write manifest to file
  mcp-manifest-generate --all                        Generate manifests for all servers

${BOLD}Examples:${RESET}
  mcp-manifest-generate --init
  mcp-manifest-generate --server ironlicensing
  mcp-manifest-generate --from-settings ~/.claude/settings.json --server gitcaddy --probe
  mcp-manifest-generate --server ironlicensing -o mcp-manifest.json
  mcp-manifest-generate --all -o manifests/

${BOLD}Options:${RESET}
  --init                  Interactive wizard to create a manifest from scratch
  --from-settings <path>  Path to settings.json (default: ~/.claude/settings.json)
  --server <name>         Server name to generate manifest for
  --all                   Generate manifests for all servers
  --probe                 Run MCP initialize handshake for server name/version
  -o, --output <path>     Output file or directory
  --json                  Output raw JSON (no colors/decoration)
  --help                  Show this help
`);
  process.exit(0);
}

function getArg(name) {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

const settingsPath = getArg('--from-settings')
  || join(homedir(), '.claude', 'settings.json');
const serverName = getArg('--server');
const outputPath = getArg('-o') || getArg('--output');
const doProbe = args.includes('--probe');
const doAll = args.includes('--all');
const doInit = args.includes('--init');
const jsonOnly = args.includes('--json');

async function run() {
  // Init wizard mode
  if (doInit) {
    await runInitWizard();
    return;
  }

  // Load settings
  if (!existsSync(settingsPath)) {
    console.error(`${RED}Settings file not found: ${settingsPath}${RESET}`);
    console.error(`${DIM}Default location: ~/.claude/settings.json${RESET}`);
    process.exit(1);
  }

  let servers;
  try {
    servers = readSettings(settingsPath);
  } catch (e) {
    console.error(`${RED}Failed to read settings: ${e.message}${RESET}`);
    process.exit(1);
  }

  const serverNames = Object.keys(servers);
  if (serverNames.length === 0) {
    console.error(`${YELLOW}No MCP servers found in ${settingsPath}${RESET}`);
    process.exit(1);
  }

  // List mode — no --server or --all specified
  if (!serverName && !doAll) {
    console.log(`\n${BOLD}MCP servers in ${DIM}${settingsPath}${RESET}\n`);
    for (const name of serverNames) {
      const entry = servers[name];
      const cmd = entry.command || '(no command)';
      const argCount = (entry.args || []).length;
      const envCount = Object.keys(entry.env || {}).length;
      console.log(`  ${CYAN}${name}${RESET}`);
      console.log(`    command: ${cmd}`);
      if (argCount > 0) console.log(`    args: ${argCount} argument(s)`);
      if (envCount > 0) console.log(`    env: ${envCount} variable(s)`);
      console.log('');
    }
    console.log(`${DIM}Use --server <name> to generate a manifest, or --all for all servers${RESET}\n`);
    process.exit(0);
  }

  // Generate for specific server
  if (serverName) {
    if (!servers[serverName]) {
      console.error(`${RED}Server "${serverName}" not found. Available: ${serverNames.join(', ')}${RESET}`);
      process.exit(1);
    }

    const manifest = await generateManifest(serverName, servers[serverName], { probe: doProbe });
    outputManifest(manifest, serverName, outputPath, jsonOnly);
    return;
  }

  // Generate for all servers
  if (doAll) {
    for (const name of serverNames) {
      if (!jsonOnly) console.log(`\n${BOLD}Generating: ${CYAN}${name}${RESET}`);
      const manifest = await generateManifest(name, servers[name], { probe: doProbe });
      const outPath = outputPath ? join(outputPath, `${name}.mcp-manifest.json`) : null;
      outputManifest(manifest, name, outPath, jsonOnly);
    }
    return;
  }
}

function outputManifest(manifest, name, outPath, jsonOnly) {
  const json = JSON.stringify(manifest, null, 2);

  if (outPath) {
    // Ensure directory exists for --all mode
    const dir = outPath.endsWith('.json') ? undefined : outPath;
    if (dir) {
      try { mkdirSync(dir, { recursive: true }); } catch {}
    }
    const filePath = outPath.endsWith('.json') ? outPath : join(outPath, `${name}.mcp-manifest.json`);
    writeFileSync(filePath, json + '\n');
    if (!jsonOnly) console.log(`${GREEN}✓${RESET} Written to ${filePath}`);
    return;
  }

  if (jsonOnly) {
    console.log(json);
    return;
  }

  console.log(`\n${BOLD}Generated mcp-manifest.json for "${name}":${RESET}\n`);
  // Colorize JSON output
  const colorized = json
    .replace(/"([^"]+)":/g, `"${CYAN}$1${RESET}":`)
    .replace(/: "([^"]+)"/g, `: "${GREEN}$1${RESET}"`)
    .replace(/: (\d+)/g, `: ${YELLOW}$1${RESET}`);
  console.log(colorized);
  console.log(`\n${DIM}Review and edit the TODO fields, then save as mcp-manifest.json${RESET}`);
  console.log(`${DIM}Validate with: mcp-manifest-validate ./mcp-manifest.json${RESET}\n`);
}


async function runInitWizard() {
  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q, def) => new Promise(resolve => {
    const prompt = def ? `${q} ${DIM}(${def})${RESET}: ` : `${q}: `;
    rl.question(prompt, answer => resolve(answer.trim() || def || ''));
  });

  console.log(`\n${BOLD}MCP Manifest Generator${RESET}`);
  console.log(`${DIM}Create a new mcp-manifest.json interactively\n${RESET}`);

  // Server info
  console.log(`${BOLD}Server Info${RESET}`);
  const name = await ask('  Server name (lowercase, hyphens)', '');
  const displayName = await ask('  Display name', name.split('-').map(w => w[0]?.toUpperCase() + w.slice(1)).join(' '));
  const description = await ask('  Description', '');
  const version = await ask('  Version', '1.0.0');
  const author = await ask('  Author/organization', '');

  // Install
  console.log(`\n${BOLD}Installation${RESET}`);
  console.log(`  ${DIM}Methods: npm, pip, dotnet-tool, cargo, binary, docker${RESET}`);
  const method = await ask('  Install method', 'npm');
  const pkg = await ask('  Package name', name);
  const command = await ask('  Command after install', name);
  const source = await ask('  Custom registry URL (optional)', '');

  // Transport
  console.log(`\n${BOLD}Transport${RESET}`);
  console.log(`  ${DIM}Options: stdio, sse, streamable-http${RESET}`);
  const transport = await ask('  Transport', 'stdio');
  let endpoint = '';
  if (transport !== 'stdio') {
    endpoint = await ask('  Endpoint URL', '');
  }

  // Config
  console.log(`\n${BOLD}Configuration${RESET}`);
  console.log(`  ${DIM}Add config parameters your server needs. Empty name to finish.${RESET}`);
  const config = [];
  while (true) {
    const key = await ask(`  Config key (empty to finish)`, '');
    if (!key) break;
    console.log(`    ${DIM}Types: string, secret, url, path, boolean, number${RESET}`);
    const type = await ask(`    Type`, 'string');
    const configDesc = await ask(`    Description`, '');
    const required = (await ask(`    Required? (y/n)`, 'n')).toLowerCase() === 'y';
    const envVar = await ask(`    Environment variable (optional)`, '');
    const arg = await ask(`    CLI argument (optional, e.g. --api-key)`, '');
    const promptText = await ask(`    User prompt text`, configDesc || key);

    const entry = { key, description: configDesc, type, required, prompt: promptText };
    if (envVar) entry.env_var = envVar;
    if (arg) entry.arg = arg;
    config.push(entry);
  }

  // Scope
  console.log(`\n${BOLD}Scope${RESET}`);
  const scope = await ask('  Scope (global, project, both)', 'global');

  rl.close();

  // Build manifest
  const manifest = {
    $schema: 'https://mcp-manifest.dev/schema/v0.1.json',
    version: '0.1',
    server: {
      name,
      displayName,
      description,
      version,
      ...(author && { author })
    },
    install: [{
      method,
      package: pkg,
      command,
      ...(source && { source }),
      priority: 0
    }],
    transport,
    ...(endpoint && { endpoint }),
    ...(config.length > 0 && { config }),
    scopes: [scope],
    settings_template: {
      command,
      args: config.filter(c => c.arg).flatMap(c => [c.arg, `\${${c.key}}`])
    }
  };

  const json = JSON.stringify(manifest, null, 2);

  if (outputPath) {
    writeFileSync(outputPath, json + '\n');
    console.log(`\n${GREEN}✓${RESET} Written to ${outputPath}`);
  } else {
    console.log(`\n${BOLD}Generated mcp-manifest.json:${RESET}\n`);
    console.log(json);
    console.log(`\n${DIM}Save as mcp-manifest.json and validate with: mcp-manifest-validate ./mcp-manifest.json${RESET}\n`);
  }
}

run().catch(err => {
  console.error(`${RED}Fatal: ${err.message}${RESET}`);
  process.exit(2);
});
