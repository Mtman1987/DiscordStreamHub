import { NextRequest, NextResponse } from 'next/server';
import { decideMtFixIt } from '@/lib/mtfixit-orchestrator';
import { DSH_SPMT_COOKIE, resolveSpmtSession } from '@/lib/spmt-session';

export const dynamic = 'force-dynamic';

const JOB_RE = /^[a-zA-Z0-9_-]{8,100}$/;

function cleanAction(value: unknown): 'approve' | 'deny' | '' {
  const action = String(value || '').trim().toLowerCase();
  return action === 'approve' || action === 'deny' ? action : '';
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function requireOwner(request: NextRequest) {
  const token = request.cookies.get(DSH_SPMT_COOKIE)?.value || '';
  if (!token) return null;
  try {
    const resolved = await resolveSpmtSession(token);
    return resolved.session.isAdmin ? resolved : null;
  } catch {
    return null;
  }
}

function page(title: string, body: string, status = 200) {
  return new NextResponse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:dark}body{margin:0;background:#070b12;color:#eef4ff;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;display:grid;min-height:100vh;place-items:center;padding:24px;box-sizing:border-box}.card{width:min(720px,100%);background:#101722;border:1px solid #28364c;border-radius:16px;padding:24px;box-shadow:0 20px 70px #0008}.eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#8aa5c8}.muted{color:#9aacbf}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:24px}button,a.button{appearance:none;border:0;border-radius:10px;padding:12px 18px;font-weight:700;cursor:pointer;text-decoration:none}.approve{background:#31c76a;color:#06140b}.deny{background:#e14c58;color:white}.secondary{background:#29374a;color:#eef4ff}code{background:#080d14;border:1px solid #263247;border-radius:6px;padding:2px 6px}form{display:inline}</style></head><body><main class="card">${body}</main></body></html>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' },
  });
}

function invalid(message: string, status = 400) {
  return page('Athena Repair Gate', `<div class="eyebrow">Athena · Repair Gate</div><h1>Cannot continue</h1><p>${escapeHtml(message)}</p>`, status);
}

export async function GET(request: NextRequest) {
  const jobId = String(request.nextUrl.searchParams.get('jobId') || '').trim();
  const action = cleanAction(request.nextUrl.searchParams.get('action'));
  if (!JOB_RE.test(jobId) || !action) return invalid('The approval link is invalid or incomplete.');

  const owner = await requireOwner(request);
  if (!owner) {
    const returnTo = encodeURIComponent(`${request.nextUrl.pathname}?jobId=${encodeURIComponent(jobId)}&action=${action}`);
    return page('Athena Repair Gate', `<div class="eyebrow">Athena · Repair Gate</div><h1>SPMT owner sign-in required</h1><p class="muted">Approval and denial are owner-gated. Sign in through the normal DSH/SPMT session, then reopen this repair link.</p><div class="actions"><a class="button secondary" href="/api/auth/spmt-session?next=${returnTo}">Sign in with SPMT</a></div>`, 401);
  }

  const verb = action === 'approve' ? 'Approve & deploy' : 'Deny / hold';
  const className = action === 'approve' ? 'approve' : 'deny';
  return page('Athena Repair Gate', `<div class="eyebrow">Athena · Repair Gate</div><h1>${verb}</h1><p>Job <code>${escapeHtml(jobId)}</code></p><p class="muted">You are authenticated as the SPMT owner/admin. This is the final confirmation before Athena records your decision.</p><form method="post"><input type="hidden" name="jobId" value="${escapeHtml(jobId)}"><input type="hidden" name="action" value="${action}"><div class="actions"><button class="${className}" type="submit">${verb}</button><a class="button secondary" href="/">Cancel</a></div></form>`);
}

export async function POST(request: NextRequest) {
  const owner = await requireOwner(request);
  if (!owner) return invalid('Your SPMT owner session is missing or expired. Reopen the Discord approval link and sign in again.', 401);

  const form = await request.formData().catch(() => null);
  const jobId = String(form?.get('jobId') || '').trim();
  const action = cleanAction(form?.get('action'));
  if (!JOB_RE.test(jobId) || !action) return invalid('The repair decision payload is invalid.');

  try {
    const state = await decideMtFixIt(jobId, action);
    const approved = action === 'approve';
    return page('Athena Repair Gate', `<div class="eyebrow">Athena · Repair Gate</div><h1>${approved ? 'Approved' : 'Denied'}</h1><p>Job <code>${escapeHtml(jobId)}</code> is now <strong>${escapeHtml(state.status)}</strong>.</p><p class="muted">${escapeHtml(state.message || (approved ? 'Athena will merge, deploy, and verify the repair.' : 'Athena will hold this repair.'))}</p><div class="actions"><a class="button secondary" href="/">Return to DSH</a></div>`);
  } catch (error) {
    console.error(`[MtFixItDecisionPage] ${action} failed job=${jobId}:`, error);
    return invalid(error instanceof Error ? error.message : 'Athena could not record that decision.', 409);
  }
}
