'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useDoc, useFirestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import { updateAdminRoles } from '@/lib/actions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Save, Loader2, CheckCircle, XCircle, Shield } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { usePathname } from 'next/navigation';
import type { DiscordServer } from '@/lib/types';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Save className="mr-2 h-4 w-4" />
      )}
      Save Admin Roles
    </Button>
  );
}

export function AdminRoleSettings({ serverId }: { serverId: string }) {
  const pathname = usePathname();
  const firestore = useFirestore();

  const [state, formAction] = useActionState(updateAdminRoles, {
    status: 'idle',
    message: '',
  });

  // Fetch the list of all roles available for the server
  const rolesConfigRef = React.useMemo(() => {
    if (!firestore || !serverId) return null;
    return doc(firestore, 'servers', serverId, 'config', 'roles');
  }, [firestore, serverId]);
  const { data: rolesData, isLoading: isLoadingRoles } = useDoc<{ list: string[] }>(rolesConfigRef);
  const allRoles = rolesData?.list || [];

  // Fetch the current server config to know which roles are already admins
  const serverConfigRef = React.useMemo(() => {
    if (!firestore || !serverId) return null;
    return doc(firestore, 'servers', serverId);
  }, [firestore, serverId]);
  const { data: serverConfig, isLoading: isLoadingServerConfig } = useDoc<DiscordServer>(serverConfigRef);
  const adminRoles = serverConfig?.adminRoles || [];

  const isLoading = isLoadingRoles || isLoadingServerConfig;

  return (
    <Card>
      <form action={formAction}>
        <input type="hidden" name="serverId" value={serverId} />
        <input type="hidden" name="currentPath" value={pathname} />
        <CardHeader>
          <CardTitle className="font-headline flex items-center gap-2"><Shield className="text-primary"/> Admin Role Configuration</CardTitle>
          <CardDescription>
            Select which roles should be considered administrative. Members with these roles will be eligible for admin-only points.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-60 w-full pr-4">
            <div className="space-y-4">
                {isLoading && Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="flex items-center space-x-2">
                        <Skeleton className="h-4 w-4" />
                        <Skeleton className="h-4 w-32" />
                    </div>
                ))}
                {!isLoading && allRoles.length > 0 && allRoles.map(role => (
                    <div key={role} className="flex items-center space-x-2">
                        <Checkbox 
                            id={`role-${role}`} 
                            name={role}
                            defaultChecked={adminRoles.includes(role)}
                        />
                        <Label htmlFor={`role-${role}`} className="font-normal">{role}</Label>
                    </div>
                ))}
                 {!isLoading && allRoles.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-10">
                        No roles found. Please sync your server with Discord first.
                    </p>
                 )}
            </div>
          </ScrollArea>
           {state.status !== 'idle' && (
            <Alert variant={state.status === 'error' ? 'destructive' : 'default'} className="mt-4">
              {state.status === 'success' ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              <AlertTitle>{state.status === 'success' ? 'Success' : 'Error'}</AlertTitle>
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
        <CardFooter>
          <SubmitButton />
        </CardFooter>
      </form>
    </Card>
  );
}
