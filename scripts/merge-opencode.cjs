const fs = require('fs');

// Merge provider blocks from config/*-provider.jsonc into the device opencode.jsonc.
// Only the `provider` object is merged; everything else (permission, references, mcp,
// tools, model) is preserved. No secrets are touched.
//
// Usage: node merge-opencode.cjs <opencode.jsonc> <config1> [config2 ...]

const ocPath = process.argv[2];
const cfgPaths = process.argv.slice(3);

if (!ocPath || cfgPaths.length === 0) {
  console.error('usage: node merge-opencode.cjs <opencode.jsonc> <config*>...');
  process.exit(1);
}

// Strip JSONC: block comments + trailing commas. Line comments (//) are NOT stripped
// because URLs like https://... contain // and must be preserved.
function strip(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,(\s*[}\]])/g, '$1');
}

const oc = JSON.parse(strip(fs.readFileSync(ocPath, 'utf8')));
if (!oc.provider || typeof oc.provider !== 'object') oc.provider = {};

let merged = 0;
for (const cp of cfgPaths) {
  const cfg = JSON.parse(strip(fs.readFileSync(cp, 'utf8')));
  if (cfg.provider && typeof cfg.provider === 'object') {
    for (const key of Object.keys(cfg.provider)) {
      oc.provider[key] = cfg.provider[key];
      merged++;
    }
  }
}

fs.writeFileSync(ocPath, JSON.stringify(oc, null, 2) + '\n');
console.log('[3/4] Merged ' + merged + ' provider(s) into ' + ocPath +
  ' -> [' + Object.keys(oc.provider).join(', ') + ']');
