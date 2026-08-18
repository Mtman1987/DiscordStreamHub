import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src', 'lib', 'mtfixit-orchestrator.ts');
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const importMarker = "import { sendOwnerDiscordDm } from './owner-dm-service';\n";
const importLine = "import { clearSpmtServiceTokenCache, getSpmtServiceToken } from './spmt-service-token';";
if (!source.includes(importLine)) {
  if (!source.includes(importMarker)) throw new Error('MtFixIt service OAuth import marker missing');
  source = source.replace(importMarker, `${importMarker}${importLine}\n`);
}

if (!source.includes('async function sendRotatorRequest(')) {
  const old = `async function rotatorRequest(path: string, init: RequestInit = {}) {\n  const key = sharedKey();\n  if (!key) throw new Error('The DSH-to-rotator shared key is unavailable.');\n  const response = await fetch(\`${'${rotatorBaseUrl()}${path}'}\`, {\n    ...init,\n    headers: { accept: 'application/json', 'x-dsh-mtfixit-key': key, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) },\n    cache: 'no-store',\n    signal: AbortSignal.timeout(20_000),\n  });\n  const payload = await response.json().catch(() => null);\n  if (!response.ok) throw new Error(payload?.error || \`Rotator HTTP ${'${response.status}'}\`);\n  return payload;\n}`;
  if (!source.includes(old)) throw new Error('MtFixIt rotatorRequest marker missing');
  const replacement = `async function sendRotatorRequest(path: string, init: RequestInit, headers: Record<string, string>) {\n  const response = await fetch(\`${'${rotatorBaseUrl()}${path}'}\`, {\n    ...init,\n    headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...headers, ...(init.headers || {}) },\n    cache: 'no-store',\n    signal: AbortSignal.timeout(20_000),\n  });\n  const payload = await response.json().catch(() => null);\n  return { response, payload };\n}\n\nasync function rotatorRequest(path: string, init: RequestInit = {}) {\n  try {\n    const serviceToken = await getSpmtServiceToken(['athena:write']);\n    let result = await sendRotatorRequest(path, init, { Authorization: \`Bearer ${'${serviceToken}'}\` });\n    if (result.response.status === 401 || result.response.status === 403) {\n      clearSpmtServiceTokenCache();\n      const refreshed = await getSpmtServiceToken(['athena:write']);\n      result = await sendRotatorRequest(path, init, { Authorization: \`Bearer ${'${refreshed}'}\` });\n    }\n    if (result.response.ok) return result.payload;\n    if (result.response.status !== 401 && result.response.status !== 403) {\n      throw new Error(result.payload?.error || \`Rotator HTTP ${'${result.response.status}'}\`);\n    }\n  } catch (error) {\n    console.warn('[MtFixIt] SPMT service OAuth unavailable; compatibility fallback may be used:', safeErrorText(error));\n  }\n\n  const key = sharedKey();\n  if (!key) throw new Error('SPMT service OAuth failed and no legacy DSH-to-rotator compatibility credential is configured.');\n  console.warn('[auth-migration] LEGACY_AUTH_USED migration=AUTH-DSH-003 caller=discord-stream-hub route=' + path + ' transport=x-dsh-mtfixit-key');\n  const legacy = await sendRotatorRequest(path, init, { 'x-dsh-mtfixit-key': key });\n  if (!legacy.response.ok) throw new Error(legacy.payload?.error || \`Rotator HTTP ${'${legacy.response.status}'}\`);\n  return legacy.payload;\n}`;
  source = source.replace(old, replacement);
}

fs.writeFileSync(file, source, 'utf8');

const ownerDmFile = path.join(root, 'src', 'lib', 'owner-dm-service.ts');
let ownerDm = fs.readFileSync(ownerDmFile, 'utf8').replace(/\r\n/g, '\n');
ownerDm = ownerDm.replace(
  "const components = (buttons || []).slice(0, 5).flatMap((button) => {",
  "const components = (buttons || []).slice(0, 5).flatMap<Record<string, unknown>>((button) => {",
);
fs.writeFileSync(ownerDmFile, ownerDm, 'utf8');
console.log('MtFixIt scoped SPMT service OAuth patch applied.');
