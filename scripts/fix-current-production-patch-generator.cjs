const fs = require('node:fs');
const path = 'scripts/patch-current-production-errors.cjs';
let source = fs.readFileSync(path, 'utf8');
const before = "  assert.match(gateway, /authorization: `Bearer/);";
const after = "  assert.match(gateway, /authorization:[\\s\\S]*Bearer/);";
if (!source.includes(before)) throw new Error('problematic embedded backtick marker not found');
source = source.replace(before, after);
fs.writeFileSync(path, source);
