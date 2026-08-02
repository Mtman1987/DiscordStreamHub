import { sqliteService } from '@/lib/sqlite-service';
import { getServerBranding, type ServerBranding } from '@/lib/server-branding';

export type TenantDescriptor = {
  id: string;
  branding: ServerBranding;
};

export async function listTenantDescriptors(currentServerId?: string): Promise<TenantDescriptor[]> {
  const ids = new Set(sqliteService.listDescendantDocumentIds('servers'));
  const current = String(currentServerId || '').trim();
  if (current) ids.add(current);

  return Promise.all([...ids].sort().map(async (id) => ({
    id,
    branding: await getServerBranding(id),
  })));
}
