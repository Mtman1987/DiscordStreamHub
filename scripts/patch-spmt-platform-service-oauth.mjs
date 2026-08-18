import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src', 'lib', 'spmt-client.ts');
const original = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
let source = original;

const importLine = "import { clearSpmtServiceTokenCache, getSpmtServiceToken } from './spmt-service-token';\n\n";
if (!source.includes("from './spmt-service-token'")) source = importLine + source;

const baseMarker = "const SPMT_API_KEY = process.env.SPMT_API_KEY || '';\n";
const helperMarker = 'async function spmtPlatformFetch(scope: string, url: string, init: RequestInit): Promise<Response> {';
if (!source.includes(helperMarker)) {
  if (!source.includes(baseMarker)) throw new Error('SPMT platform legacy-key marker missing');
  const helper = `${baseMarker}\nasync function spmtPlatformFetch(scope: string, url: string, init: RequestInit): Promise<Response> {\n  let serviceError: unknown = null;\n  try {\n    let token = await getSpmtServiceToken([scope]);\n    let response = await fetch(url, {\n      ...init,\n      headers: { ...((init.headers || {}) as Record<string, string>), Authorization: \`Bearer ${'${token}'}\` },\n    });\n    if (response.status === 401 || response.status === 403) {\n      clearSpmtServiceTokenCache();\n      token = await getSpmtServiceToken([scope]);\n      response = await fetch(url, {\n        ...init,\n        headers: { ...((init.headers || {}) as Record<string, string>), Authorization: \`Bearer ${'${token}'}\` },\n      });\n    }\n    if (response.status !== 401 && response.status !== 403) return response;\n    serviceError = new Error(\`SPMT service token rejected for ${'${scope}'} (${'${response.status}'})\`);\n  } catch (error) {\n    serviceError = error;\n  }\n\n  if (!String(SPMT_API_KEY || '').trim()) {\n    if (serviceError instanceof Error) throw serviceError;\n    throw new Error(\`SPMT service OAuth unavailable for ${'${scope}'}\`);\n  }\n  console.warn(\`[auth-migration] LEGACY_AUTH_USED caller=discord-stream-hub scope=${'${scope}'} transport=SPMT_API_KEY\`);\n  return fetch(url, {\n    ...init,\n    headers: { ...((init.headers || {}) as Record<string, string>), Authorization: \`Bearer ${'${SPMT_API_KEY}'}\` },\n  });\n}\n`;
  source = source.replace(baseMarker, helper);
}

source = source.replace(
  'export function isSpmtEnabled() {\n  return Boolean(SPMT_API_KEY);\n}',
  "export function isSpmtEnabled() {\n  return Boolean(process.env.DSH_CLIENT_SECRET || SPMT_API_KEY);\n}",
);
source = source.replaceAll('if (!SPMT_API_KEY)', 'if (!isSpmtEnabled())');

const replacements = [
  ["fetch(`${SPMT_BASE_URL.replace(/\\/$/, '')}/api/platform/identity/grandfather`, {", "spmtPlatformFetch('identity:write', `${SPMT_BASE_URL.replace(/\\/$/, '')}/api/platform/identity/grandfather`, {"],
  ["fetch(`${SPMT_BASE_URL.replace(/\\/$/, '')}/api/platform/identity/onboard`, {", "spmtPlatformFetch('identity:write', `${SPMT_BASE_URL.replace(/\\/$/, '')}/api/platform/identity/onboard`, {"],
  ["fetch(`${SPMT_BASE_URL.replace(/\\/$/, '')}/api/platform/events`, {", "spmtPlatformFetch('events:write', `${SPMT_BASE_URL.replace(/\\/$/, '')}/api/platform/events`, {"],
  ["fetch(`${SPMT_BASE_URL.replace(/\\/$/, '')}/api/platform/xp`, {", "spmtPlatformFetch('xp:write', `${SPMT_BASE_URL.replace(/\\/$/, '')}/api/platform/xp`, {"],
  ["fetch(`${SPMT_BASE_URL.replace(/\\/$/, '')}/api/platform/xp${path}`, {", "spmtPlatformFetch('xp:write', `${SPMT_BASE_URL.replace(/\\/$/, '')}/api/platform/xp${path}`, {"],
  ["fetch(`${SPMT_BASE_URL.replace(/\\/$/, '')}/api/platform/xp/migrate-balance`, {", "spmtPlatformFetch('xp:write', `${SPMT_BASE_URL.replace(/\\/$/, '')}/api/platform/xp/migrate-balance`, {"],
];
for (const [before, after] of replacements) source = source.replaceAll(before, after);

for (const required of [
  "spmtPlatformFetch('identity:write'",
  "spmtPlatformFetch('events:write'",
  "spmtPlatformFetch('xp:write'",
]) {
  if (!source.includes(required)) throw new Error(`SPMT platform OAuth patch missing ${required}`);
}

if (source !== original) fs.writeFileSync(file, source, 'utf8');
console.log('DSH canonical SPMT platform service OAuth patch applied.');
