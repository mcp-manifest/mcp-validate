# mcp-manifest-validate

[![MCP Manifest](https://mcp-manifest.dev/media/mcp-manifest-badge-light.svg)](https://mcp-manifest.dev)

Validate `mcp-manifest.json` files and test autodiscovery from domains.

## Usage

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

## License

CC0 1.0 — Public domain.
