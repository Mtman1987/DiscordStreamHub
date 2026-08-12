const fs = require('node:fs');
const path = 'scripts/patch-current-production-errors.cjs';
let source = fs.readFileSync(path, 'utf8');
const before = "  assert.match(gateway, /authorization: `Bearer/);";
const after = "  assert.ok(gateway.includes('authorization:'));\\n  assert.ok(gateway.includes('Bearer '));";
if (!source.includes(before)) throw new Error('problematic embedded backtick marker not found');
source = source.replace(before, after);
fs.writeFileSync(path, source);
