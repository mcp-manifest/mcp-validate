import { readFileSync, existsSync } from 'fs';
import { basename, extname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * @typedef {Object} McpServerEntry
 * @property {string} command
 * @property {string[]} [args]
 * @property {Object<string,string>} [env]
 */

/**
 * Read MCP server entries from a Claude Code settings.json file.
 * @param {string} settingsPath
 * @returns {Object<string, McpServerEntry>}
 */
export function readSettings(settingsPath) {
  if (!existsSync(settingsPath)) {
    throw new Error(`Settings file not found: ${settingsPath}`);
  }
  const json = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  return json.mcpServers || {};
}

/**
 * Infer install method from a command string.
 * @param {string} command
 * @param {string[]} args
 * @returns {{ method: string, package: string, command: string } | null}
 */
export function inferInstall(command, args = []) {
  const cmd = basename(command).toLowerCase();

  // npx -y @scope/package or npx @scope/package
  if (cmd === 'npx' || cmd === 'npx.cmd') {
    const pkgArg = args.find(a => !a.startsWith('-'));
    if (pkgArg) {
      return { method: 'npm', package: pkgArg, command: pkgArg.split('/').pop().replace(/^@/, '') };
    }
  }

  // uvx package or uv run package
  if (cmd === 'uvx' || cmd === 'uvx.exe') {
    const pkgArg = args.find(a => !a.startsWith('-'));
    if (pkgArg) {
      return { method: 'pip', package: pkgArg, command: pkgArg };
    }
  }

  // python -m package
  if ((cmd === 'python' || cmd === 'python3' || cmd === 'python.exe') && args[0] === '-m') {
    const pkg = args[1];
    if (pkg) {
      return { method: 'pip', package: pkg, command: `python -m ${pkg}` };
    }
  }

  // docker run image
  if (cmd === 'docker' || cmd === 'docker.exe') {
    if (args[0] === 'run') {
      const image = args.filter(a => !a.startsWith('-')).pop();
      if (image) {
        return { method: 'docker', package: image, command: 'docker' };
      }
    }
  }

  // dotnet tool — check if it's a known dotnet tool command
  // Heuristic: if the command has no extension or is an .exe not in system dirs
  if (cmd.endsWith('.exe') || !cmd.includes('.')) {
    const toolName = cmd.replace(/\.exe$/, '');
    // Try to detect if it's a dotnet tool
    return { method: 'dotnet-tool', package: toolName, command: toolName };
  }

  return null;
}

/**
 * Extract config entries from args and env vars.
 * @param {string[]} args
 * @param {Object<string,string>} env
 * @returns {Array<{key: string, type: string, arg?: string, env_var?: string, description: string}>}
 */
export function extractConfig(args = [], env = {}) {
  const config = [];
  const skipNext = new Set();

  // Parse --flag value pairs from args
  for (let i = 0; i < args.length; i++) {
    if (skipNext.has(i)) continue;

    const arg = args[i];
    if (arg.startsWith('--') && i + 1 < args.length && !args[i + 1].startsWith('-')) {
      const key = arg.replace(/^--/, '');
      const value = args[i + 1];
      skipNext.add(i + 1);

      const type = inferConfigType(key, value);
      config.push({
        key,
        description: humanize(key),
        type,
        required: false,
        arg,
        prompt: humanize(key)
      });
    } else if (arg.startsWith('-') && arg.length === 2 && i + 1 < args.length && !args[i + 1].startsWith('-')) {
      // Short flags like -k value
      const key = arg.replace(/^-/, '');
      const value = args[i + 1];
      skipNext.add(i + 1);

      const type = inferConfigType(key, value);
      config.push({
        key,
        description: humanize(key),
        type,
        required: false,
        arg,
        prompt: humanize(key)
      });
    }
  }

  // Parse env vars
  for (const [envKey, envValue] of Object.entries(env)) {
    // Check if this env var already maps to an arg-based config
    const existing = config.find(c => c.key === envKey.toLowerCase().replace(/_/g, '-'));
    if (existing) {
      existing.env_var = envKey;
      continue;
    }

    const key = envKey.toLowerCase().replace(/_/g, '-');
    const type = inferConfigType(key, envValue);
    config.push({
      key,
      description: humanize(key),
      type,
      required: false,
      env_var: envKey,
      prompt: humanize(key)
    });
  }

  return config;
}

/**
 * Infer config value type from key name and sample value.
 */
function inferConfigType(key, value) {
  const keyLower = key.toLowerCase();
  if (keyLower.includes('key') || keyLower.includes('token') || keyLower.includes('secret') || keyLower.includes('password')) {
    return 'secret';
  }
  if (keyLower.includes('url') || keyLower.includes('endpoint') || keyLower.includes('host')) {
    if (value && (value.startsWith('http') || value.startsWith('//'))) return 'url';
  }
  if (keyLower.includes('path') || keyLower.includes('dir') || keyLower.includes('file')) {
    return 'path';
  }
  if (value === 'true' || value === 'false') return 'boolean';
  if (value && !isNaN(value)) return 'number';
  return 'string';
}

/**
 * Convert kebab-case or snake_case to human-readable.
 */
function humanize(str) {
  return str
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Build a settings_template from the original command/args, replacing detected values with ${key} vars.
 */
export function buildSettingsTemplate(command, args = [], config = []) {
  const templateArgs = [...args];

  // Replace arg values with template variables
  for (let i = 0; i < templateArgs.length; i++) {
    const argConfig = config.find(c => c.arg === templateArgs[i]);
    if (argConfig && i + 1 < templateArgs.length) {
      templateArgs[i + 1] = `\${${argConfig.key}}`;
    }
  }

  // For npx commands, use the package as the command
  const cmd = basename(command).toLowerCase();
  if (cmd === 'npx' || cmd === 'npx.cmd') {
    const pkgIdx = templateArgs.findIndex(a => !a.startsWith('-'));
    if (pkgIdx >= 0) {
      const pkg = templateArgs[pkgIdx];
      return {
        command: pkg.split('/').pop().replace(/^@/, ''),
        args: templateArgs.filter((_, i) => i !== pkgIdx && templateArgs[i] !== '-y')
          .filter(a => a.length > 0)
      };
    }
  }

  return {
    command: basename(command).replace(/\.exe$/, ''),
    args: templateArgs.filter(a => a.length > 0)
  };
}

/**
 * Try to get server info via MCP initialize handshake.
 * @param {string} command
 * @param {string[]} args
 * @param {Object<string,string>} env
 * @returns {Promise<{name?: string, version?: string} | null>}
 */
export async function probeServer(command, args = [], env = {}) {
  const initMsg = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mcp-manifest-generate', version: '0.1.0' }
    }
  });

  try {
    const { spawn } = await import('child_process');
    return new Promise((resolve) => {
      const proc = spawn(command, args, {
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      const timeout = setTimeout(() => {
        proc.kill();
        resolve(null);
      }, 5000);

      proc.stdout.on('data', (data) => {
        output += data.toString();
        // Try to parse JSON-RPC response
        try {
          const lines = output.split('\n').filter(l => l.trim());
          for (const line of lines) {
            // Skip Content-Length headers
            if (line.startsWith('{')) {
              const resp = JSON.parse(line);
              if (resp.result?.serverInfo) {
                clearTimeout(timeout);
                proc.kill();
                resolve(resp.result.serverInfo);
                return;
              }
            }
          }
        } catch { /* partial data, keep reading */ }
      });

      proc.on('error', () => {
        clearTimeout(timeout);
        resolve(null);
      });

      proc.on('exit', () => {
        clearTimeout(timeout);
        resolve(null);
      });

      // Send the initialize message with Content-Length header
      const content = initMsg;
      proc.stdin.write(`Content-Length: ${Buffer.byteLength(content)}\r\n\r\n${content}`);
    });
  } catch {
    return null;
  }
}

/**
 * Generate a manifest from an MCP server settings entry.
 * @param {string} name - Server name from settings key
 * @param {McpServerEntry} entry - The settings entry
 * @param {{ probe?: boolean }} options
 * @returns {Promise<object>} Draft mcp-manifest.json object
 */
export async function generateManifest(name, entry, options = {}) {
  const { command, args = [], env = {} } = entry;
  const install = inferInstall(command, args);
  const config = extractConfig(args, env);
  const template = buildSettingsTemplate(command, args, config);

  let serverInfo = { name, displayName: humanize(name), version: '1.0.0' };

  // Try MCP handshake if requested
  if (options.probe) {
    const probed = await probeServer(command, args, env);
    if (probed) {
      if (probed.name) serverInfo.name = probed.name.toLowerCase().replace(/\s+/g, '-');
      if (probed.name) serverInfo.displayName = probed.name;
      if (probed.version) serverInfo.version = probed.version;
    }
  }

  const manifest = {
    $schema: 'https://mcp-manifest.dev/schema/v0.1.json',
    version: '0.1',
    server: {
      name: serverInfo.name,
      displayName: serverInfo.displayName,
      description: `TODO: Add description for ${serverInfo.displayName}`,
      version: serverInfo.version
    },
    install: install ? [{ ...install, priority: 0 }] : [],
    transport: 'stdio',
    config,
    scopes: ['global'],
    settings_template: template
  };

  return manifest;
}
