import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function patchFile(relative, transform) {
  const file = path.join(root, relative);
  const before = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const after = transform(before);
  if (after === before) return;
  fs.writeFileSync(file, after, 'utf8');
}

patchFile('src/lib/owner-dm-service.ts', (source) => {
  let next = source;
  next = next.replace(
    "if (button.customId && /^mtfixit_(?:approve|deny):[a-zA-Z0-9_-]{8,100}$/.test(button.customId)) {",
    "if (button.customId && /^(?:mtfixit|chatgpt)_(?:approve|deny):[a-zA-Z0-9_-]{8,120}$/.test(button.customId)) {",
  );
  if (!next.includes('(?:mtfixit|chatgpt)_(?:approve|deny)')) throw new Error('Owner DM repair-button marker missing');
  return next;
});

patchFile('scripts/discord-ingress-bot.ts', (source) => {
  let next = source;
  next = next.replace(
    "const MTFIXIT_DECISION = /^mtfixit_(approve|deny):([a-zA-Z0-9_-]{8,100})$/;",
    "const REPAIR_DECISION = /^(mtfixit|chatgpt)_(approve|deny):([a-zA-Z0-9_-]{8,120})$/;",
  );
  next = next.replace(
    "const match = String(interaction.customId || '').match(MTFIXIT_DECISION);\n  if (!match) return false;\n  if (!DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN is required');\n  const action = match[1] as 'approve' | 'deny';\n  const jobId = match[2];",
    "const match = String(interaction.customId || '').match(REPAIR_DECISION);\n  if (!match) return false;\n  if (!DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN is required');\n  const kind = match[1] as 'mtfixit' | 'chatgpt';\n  const action = match[2] as 'approve' | 'deny';\n  const jobId = match[3];",
  );
  next = next.replace(
    "body: JSON.stringify({ userId: interaction.user.id, jobId, action }),",
    "body: JSON.stringify({ userId: interaction.user.id, jobId, action, kind }),",
  );
  next = next.replace(
    "const state = String(result?.state?.status || (action === 'approve' ? 'deploying' : 'denied'));\n  const suffix = action === 'approve'\n    ? `\\n\\n✅ mtman approved this repair. Athena is ${state === 'deployed' ? 'finished deploying it.' : 'merging/deploying it now.'}`\n    : '\\n\\n⛔ mtman denied automatic deployment. Athena is holding this repair for further instructions.';",
    "const state = String(result?.state?.status || (action === 'approve' ? (kind === 'chatgpt' ? 'awaiting-chatgpt' : 'deploying') : 'denied'));\n  const suffix = action === 'approve'\n    ? kind === 'chatgpt'\n      ? `\\n\\n✅ mtman approved ChatGPT repair. Packet is now queued for the next hourly ChatGPT pass.`\n      : `\\n\\n✅ mtman approved this repair. Athena is ${state === 'deployed' ? 'finished deploying it.' : 'merging/deploying it now.'}`\n    : kind === 'chatgpt'\n      ? '\\n\\n⛔ mtman declined ChatGPT fallback. This repair packet will not enter the ChatGPT queue.'\n      : '\\n\\n⛔ mtman denied automatic deployment. Athena is holding this repair for further instructions.';",
  );
  next = next.replace(
    "console.log(`[DiscordIngress] MtFixIt decision action=${action} job=${jobId} user=${interaction.user.id} state=${state}`);",
    "console.log(`[DiscordIngress] Repair decision kind=${kind} action=${action} job=${jobId} user=${interaction.user.id} state=${state}`);",
  );
  if (!next.includes('const REPAIR_DECISION = /^(mtfixit|chatgpt)_(approve|deny)')) throw new Error('Discord repair-decision marker missing');
  if (!next.includes('jobId, action, kind')) throw new Error('Discord repair-decision payload marker missing');
  return next;
});

patchFile('src/app/api/internal/mtfixit/decision/route.ts', (source) => {
  let next = source;
  next = next.replace(
    "import { decideMtFixIt } from '@/lib/mtfixit-orchestrator';",
    "import { decideChatGptHandoff, decideMtFixIt } from '@/lib/mtfixit-orchestrator';",
  );
  next = next.replace(
    "const body = await request.json().catch(() => null) as { userId?: unknown; jobId?: unknown; action?: unknown } | null;",
    "const body = await request.json().catch(() => null) as { userId?: unknown; jobId?: unknown; action?: unknown; kind?: unknown } | null;",
  );
  if (!next.includes("const kind = String(body?.kind || 'mtfixit').trim().toLowerCase();")) {
    next = next.replace(
      "const action = String(body?.action || '').trim().toLowerCase();",
      "const action = String(body?.action || '').trim().toLowerCase();\n  const kind = String(body?.kind || 'mtfixit').trim().toLowerCase();",
    );
  }
  next = next.replace(
    "if (!/^[a-zA-Z0-9_-]{8,100}$/.test(jobId)) return NextResponse.json({ error: 'Invalid job ID' }, { status: 400 });",
    "if (!/^[a-zA-Z0-9_-]{8,120}$/.test(jobId)) return NextResponse.json({ error: 'Invalid job ID' }, { status: 400 });\n  if (kind !== 'mtfixit' && kind !== 'chatgpt') return NextResponse.json({ error: 'Invalid repair decision kind' }, { status: 400 });",
  );
  next = next.replace(
    "const state = await decideMtFixIt(jobId, action);\n    return NextResponse.json({ ok: true, state });",
    "const state = kind === 'chatgpt'\n      ? await decideChatGptHandoff(jobId, action)\n      : await decideMtFixIt(jobId, action);\n    return NextResponse.json({ ok: true, state });",
  );
  if (!next.includes('decideChatGptHandoff')) throw new Error('ChatGPT handoff decision route marker missing');
  if (!next.includes("kind !== 'mtfixit' && kind !== 'chatgpt'")) throw new Error('Repair decision kind validation marker missing');
  return next;
});

patchFile('src/lib/mtfixit-orchestrator.ts', (source) => {
  let next = source;
  const decisionMarker = "export async function decideMtFixIt(jobId: string, action: 'approve' | 'deny'): Promise<MtFixItResolutionState> {";
  if (!next.includes('export async function decideChatGptHandoff')) {
    const index = next.indexOf(decisionMarker);
    if (index < 0) throw new Error('MtFixIt decision marker missing');
    const addition = `export async function decideChatGptHandoff(handoffId: string, action: 'approve' | 'deny') {\n  const payload = await rotatorRequest(\`/api/dsh/mtfixit/chatgpt-handoffs/\${encodeURIComponent(handoffId)}/decision\`, {\n    method: 'POST',\n    body: JSON.stringify({ action, decisionBy: 'mtman-discord' }),\n  });\n  if (!payload?.handoff?.id) throw new Error('Rotator ChatGPT handoff decision returned no state.');\n  return payload.handoff;\n}\n\n`;
    next = next.slice(0, index) + addition + next.slice(index);
  }

  const failedMarker = "if (job.status === 'failed') {\n        const report = jobReport(job, input);\n        await notifyMtman(`Athena failed to produce a safe fix for **${input.reporter}**’s MtFixIt report. Job **${job.id}** needs review.`, { fileName: `${job.id}.txt`, fileContent: report });\n        await emit(options, { jobId, outcome: 'failed', stage: 'failed', message: job.error || job.summary });\n        return;\n      }";
  if (!next.includes('Approve ChatGPT Repair')) {
    if (!next.includes(failedMarker)) throw new Error('MtFixIt failed-job marker missing');
    next = next.replace(failedMarker, `if (job.status === 'failed') {\n        const report = jobReport(job, input);\n        const handoffMatch = String(job.error || '').match(/awaiting-chatgpt:(chatgpt-[A-Za-z0-9_-]{8,120})/);\n        if (handoffMatch) {\n          const handoffId = handoffMatch[1];\n          await notifyMtman(\n            \`Local Qwen could not produce a safe fix for **\${input.reporter}**’s report: “\${input.description.slice(0, 800)}”\\n\\nApprove once to send this prepared repair packet to the next hourly ChatGPT Business repair pass, or decline to hold it.\`,\n            {\n              fileName: \`\${job.id}.txt\`,\n              fileContent: report,\n              buttons: [\n                { label: 'Approve ChatGPT Repair', customId: \`chatgpt_approve:\${handoffId}\`, style: 3 },\n                { label: 'Decline / Hold', customId: \`chatgpt_deny:\${handoffId}\`, style: 4 },\n              ],\n            },\n          );\n          await emit(options, { jobId, outcome: 'waiting-review', stage: 'waiting-review', message: \`ChatGPT fallback \${handoffId} awaits mtman approval.\` });\n          return;\n        }\n        await notifyMtman(\`Athena failed to produce a safe fix for **\${input.reporter}**’s MtFixIt report. Job **\${job.id}** needs review.\`, { fileName: \`\${job.id}.txt\`, fileContent: report });\n        await emit(options, { jobId, outcome: 'failed', stage: 'failed', message: job.error || job.summary });\n        return;\n      }`);
  }
  if (!next.includes('export async function decideChatGptHandoff')) throw new Error('ChatGPT orchestrator decision marker missing');
  if (!next.includes('Approve ChatGPT Repair')) throw new Error('ChatGPT approval DM marker missing');
  return next;
});

console.log('ChatGPT repair owner-approval flow patched.');
