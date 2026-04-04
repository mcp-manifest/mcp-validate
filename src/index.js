import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const schemaPath = join(__dirname, '..', 'schema', 'v0.1.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

/**
 * Validate a manifest object against the JSON Schema.
 * @param {object} manifest - Parsed manifest JSON
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateManifest(manifest) {
  const valid = validateSchema(manifest);
  const errors = [];

  if (!valid && validateSchema.errors) {
    for (const err of validateSchema.errors) {
      const path = err.instancePath || '(root)';
      errors.push(`${path}: ${err.message}`);
    }
  }

  // Additional semantic checks beyond JSON Schema
  if (manifest.transport === 'sse' || manifest.transport === 'streamable-http') {
    if (!manifest.endpoint) {
      errors.push(`transport "${manifest.transport}" requires an "endpoint" URL`);
    }
  }

  if (manifest.config) {
    const keys = manifest.config.map(c => c.key);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (dupes.length > 0) {
      errors.push(`duplicate config keys: ${[...new Set(dupes)].join(', ')}`);
    }

    // Validate options and options_from aren't both set
    for (const cfg of manifest.config) {
      if (cfg.options && cfg.options_from) {
        errors.push(`config "${cfg.key}": cannot have both "options" and "options_from"`);
      }
    }
  }

  if (manifest.settings_template) {
    const templateStr = JSON.stringify(manifest.settings_template);
    const varRefs = [...templateStr.matchAll(/\$\{([^}]+)\}/g)].map(m => m[1]);
    const configKeys = (manifest.config || []).map(c => c.key);
    for (const ref of varRefs) {
      if (!configKeys.includes(ref)) {
        errors.push(`settings_template references "\${${ref}}" but no config entry has key "${ref}"`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Discover a manifest from a domain, URL, or file path.
 * @param {string} input - Domain, URL, or file path
 * @returns {Promise<{ manifest: object|null, source: string, errors: string[] }>}
 */
export async function discover(input) {
  const errors = [];

  // 1. Installed tool: try {command} --manifest
  if (!input.startsWith('http') && !input.startsWith('/') && !input.includes('\\') && !input.endsWith('.json')) {
    try {
      const manifest = await tryCommandManifest(input);
      if (manifest) {
        return { manifest, source: `command: ${input} --manifest`, errors: [] };
      }
    } catch { /* not an installed command */ }
  }

  // 2. Local file path
  try {
    const { existsSync, readFileSync: readSync } = await import('fs');
    if (existsSync(input)) {
      try {
        const manifest = JSON.parse(readSync(input, 'utf-8'));
        return { manifest, source: `file: ${input}`, errors: [] };
      } catch (e) {
        return { manifest: null, source: `file: ${input}`, errors: [`Failed to parse: ${e.message}`] };
      }
    }
  } catch { /* not a file path */ }

  // 3. Direct URL to .json
  if (input.startsWith('http') && input.endsWith('.json')) {
    try {
      const res = await fetch(input, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const manifest = await res.json();
        return { manifest, source: `url: ${input}`, errors: [] };
      }
      errors.push(`${input} returned ${res.status}`);
    } catch (e) {
      errors.push(`${input}: ${e.message}`);
    }
    return { manifest: null, source: input, errors };
  }

  // 4. Normalize to base URL
  let baseUrl = input;
  if (!baseUrl.startsWith('http')) baseUrl = `https://${baseUrl}`;
  baseUrl = baseUrl.replace(/\/+$/, '');

  // 5. Try well-known URL
  const wellKnown = `${baseUrl}/.well-known/mcp-manifest.json`;
  try {
    const res = await fetch(wellKnown, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const manifest = await res.json();
      return { manifest, source: `well-known: ${wellKnown}`, errors: [] };
    }
    errors.push(`well-known: ${res.status}`);
  } catch (e) {
    errors.push(`well-known: ${e.message}`);
  }

  // 6. Fetch HTML and parse <link rel="mcp-manifest">
  try {
    const res = await fetch(baseUrl, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const html = await res.text();
      const match = html.match(/<link[^>]+rel\s*=\s*["']mcp-manifest["'][^>]+href\s*=\s*["']([^"']+)["']/i)
                 || html.match(/<link[^>]+href\s*=\s*["']([^"']+)["'][^>]+rel\s*=\s*["']mcp-manifest["']/i);

      if (match) {
        let href = match[1];
        if (href.startsWith('/')) href = `${baseUrl}${href}`;
        else if (!href.startsWith('http')) href = `${baseUrl}/${href}`;

        try {
          const mRes = await fetch(href, { signal: AbortSignal.timeout(10000) });
          if (mRes.ok) {
            const manifest = await mRes.json();
            return { manifest, source: `link tag: ${href}`, errors: [] };
          }
          errors.push(`link tag href ${href}: ${mRes.status}`);
        } catch (e) {
          errors.push(`link tag href ${href}: ${e.message}`);
        }
      } else {
        errors.push('no <link rel="mcp-manifest"> found in HTML');
      }
    }
  } catch (e) {
    errors.push(`HTML fetch: ${e.message}`);
  }

  return { manifest: null, source: baseUrl, errors };
}

/**
 * Try running {command} --manifest and parse the output as a manifest.
 * @param {string} command
 * @returns {Promise<object|null>}
 */
async function tryCommandManifest(command) {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  try {
    const cmd = process.platform === 'win32' ? command.replace(/\.exe$/, '') : command;
    const { stdout, stderr } = await execAsync(`${cmd} --manifest`, { timeout: 10000 });

    if (!stdout || !stdout.trim()) return null;

    const manifest = JSON.parse(stdout.trim());
    // Basic sanity check — must have server.name
    if (manifest?.server?.name) return manifest;
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a command exists on PATH.
 * @param {string} command
 * @returns {Promise<boolean>}
 */
export async function checkCommand(command) {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);
  const cmd = process.platform === 'win32' ? `where ${command}` : `which ${command}`;
  try {
    await execAsync(cmd);
    return true;
  } catch {
    return false;
  }
}
