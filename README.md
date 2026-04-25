# mcp-manifest-validate

[![MCP Manifest](https://mcp-manifest.dev/media/mcp-manifest-badge-light.svg)](https://mcp-manifest.dev)

Validate `mcp-manifest.json` files, test autodiscovery from domains, and generate manifests from existing MCP server configs.

## Validate

```bash
# Validate a local manifest
npx mcp-manifest-validate ./mcp-manifest.json

# Test autodiscovery from a domain
npx mcp-manifest-validate ironlicensing.com

# Validate from a URL
npx mcp-manifest-validate https://example.com/mcp-manifest.json

# Only test discovery (skip validation)
npx mcp-manifest-validate --discover ironlicensing.com
```

## What It Checks

1. **Discovery** — Can the manifest be found via well-known URL or HTML link tag?
2. **Schema** — Does it conform to the [mcp-manifest spec](https://mcp-manifest.dev)?
3. **Semantics** — Are config keys unique? Do template variables reference real config entries? Does the transport match the endpoint?
4. **Installation** — Is the command available on PATH?

## Example Output

```
MCP Manifest Validator
Input: ironlicensing.com

Discovery
  ✓ Manifest found via well-known: https://ironlicensing.com/.well-known/mcp-manifest.json

Schema Validation
  ✓ Valid against mcp-manifest schema v0.1

Server Info
  ℹ Name: IronLicensing
  ℹ Version: 1.1.0
  ℹ Description: Manage IronLicensing products, tiers, features, licenses, and analytics
  ℹ Author: IronServices

Installation
  ℹ Method: dotnet-tool (IronLicensing.Mcp)
  ℹ Command: ironlicensing-mcp
  ✓ "ironlicensing-mcp" found on PATH

Transport
  ℹ Type: stdio

Config
  ℹ profile [string] (arg: --profile)
  ℹ api-key [secret] (env: IRONLICENSING_API_KEY, arg: --api-key)
  ℹ base-url [url] (env: IRONLICENSING_BASE_URL, arg: --base-url)

✓ All checks passed
```

## Programmatic Use

```js
import { validateManifest, discover, checkCommand } from 'mcp-manifest-validate';

// Validate a manifest object
const { valid, errors } = validateManifest(manifest);

// Discover from a domain
const { manifest, source, errors } = await discover('ironlicensing.com');

// Check if a command exists
const exists = await checkCommand('ironlicensing-mcp');
```

## Generate

Create `mcp-manifest.json` from your existing Claude Code MCP server configs:

```bash
# List all configured MCP servers
npx mcp-manifest-generate

# Generate manifest for a specific server
npx mcp-manifest-generate --server ironlicensing

# Use a specific settings file
npx mcp-manifest-generate --from-settings ~/.claude/settings.json --server myserver

# Probe the server for name/version via MCP handshake
npx mcp-manifest-generate --server ironlicensing --probe

# Output to file
npx mcp-manifest-generate --server ironlicensing -o mcp-manifest.json

# Generate for all servers
npx mcp-manifest-generate --all

# Raw JSON (for piping)
npx mcp-manifest-generate --server ironlicensing --json
```

The generator reverse-engineers your existing config:
- **`--flag value`** args become typed config entries (`--api-key` → type: `secret`)
- **Environment variables** become config entries with `env_var` field
- **Command patterns** infer install method (`npx` → npm, `uvx` → pip, `.exe` → dotnet-tool)
- **`--probe`** runs an MCP initialize handshake to get the real server name and version

Review the generated manifest, fill in the `TODO` description, and commit.

## License

Apache-2.0 — see [LICENSE](LICENSE) for the full license text and [NOTICE](NOTICE) for attribution.
