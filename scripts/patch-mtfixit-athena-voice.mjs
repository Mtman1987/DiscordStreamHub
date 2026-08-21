import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function patch(relative, transform) {
  const file = path.join(root, relative);
  const before = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const after = transform(before);
  if (after === before) return;
  fs.writeFileSync(file, after, 'utf8');
}

patch('src/lib/mtfixit-contract.ts', (source) => {
  let next = source;
  next = next.replace(
    "return 'Athena captured an ecosystem snapshot and has begun working on your report. I’ll message you back here with the outcome.';",
    "return 'I’ve got it. I’m taking an ecosystem snapshot and tracing the problem now. I’ll come back here when I know what changed.';",
  );
  next = next.replace(
    "return 'Athena found the problem, applied the approved fix, and the deployment checks passed.';",
    "return 'Found it. I checked the repair, the deployment passed, and the live service is back in line.';",
  );
  next = next.replace(
    "return 'Athena found and validated a possible fix. It is waiting for mtman review before deployment.';",
    "return 'I found a likely fix and validated the patch. I’m sending it through my ChatGPT review pass before I touch production.';",
  );
  next = next.replace(
    "return 'Athena finished checking the report but did not find a safe code change to apply. The findings were sent to mtman.';",
    "return 'I finished the trace, but I couldn’t prove a safe code change. I saved the evidence for mtman instead of guessing.';",
  );
  next = next.replace(
    "return 'Athena could not safely complete this repair. The report and findings were sent to mtman for review.';",
    "return 'I couldn’t prove a safe repair yet. I packaged the report and evidence for mtman rather than risk making it worse.';",
  );
  next = next.replace(
    "return 'Please include the problem after `!mtfixit`, for example: `!mtfixit \"I cannot tag people even though I am it\"`.';",
    "return 'Tell me what broke after `!mtfixit` — for example: `!mtfixit \"I cannot tag people even though I am it\"`. I’ll trace it from there.';",
  );
  return next;
});

patch('src/lib/mtfixit-orchestrator.ts', (source) => {
  let next = source;
  next = next.replace(
    "status: 'awaiting_analysis' | 'awaiting_approval' | 'deploying' | 'deployed' | 'failed' | 'denied' | 'no_change';",
    "status: 'awaiting_analysis' | 'awaiting_approval' | 'awaiting_chatgpt' | 'deploying' | 'deployed' | 'failed' | 'denied' | 'no_change';",
  );
  if (!next.includes("resolution.status === 'awaiting_chatgpt'")) {
    const marker = "      if (resolution.status === 'awaiting_approval') {";
    const index = next.indexOf(marker);
    if (index < 0) throw new Error('MtFixIt awaiting_approval marker missing');
    const addition = `      if (resolution.status === 'awaiting_chatgpt') {\n        if (!reviewAnnounced) {\n          reviewAnnounced = true;\n          await emit(options, { jobId, outcome: 'waiting-review', stage: 'waiting-review', message: resolution.message });\n        }\n        continue;\n      }\n\n`;
    next = next.slice(0, index) + addition + next.slice(index);
  }
  return next;
});

console.log('MtFixIt Athena public voice and ChatGPT review lifecycle patched.');
