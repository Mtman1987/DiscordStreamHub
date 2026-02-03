'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useDoc, useFirestore, useMemoFirebase } from '@/firebase';
import type { LeaderboardSettings } from '@/lib/types';
import { doc } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { updateLeaderboardSettings } from '@/lib/actions';
import { usePathname } from 'next/navigation';
import { Save, Loader2, CheckCircle, XCircle, Twitch, MessageSquare, Shield } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Save className="mr-2 h-4 w-4" />
      )}
      Save All Point Values
    </Button>
  );
}

export function PointsConfigCard({ serverId }: { serverId: string }) {
  const pathname = usePathname();
  const firestore = useFirestore();

  const [state, formAction] = useActionState(updateLeaderboardSettings, {
    status: 'idle',
    message: '',
  });

  const settingsRef = useMemoFirebase(() => {
    if (!firestore || !serverId) return null;
    return doc(firestore, 'servers', serverId, 'config', 'leaderboardSettings');
  }, [firestore, serverId]);

  const { data: settings, isLoading } = useDoc<LeaderboardSettings>(settingsRef);

  return (
    <Card>
      <form action={formAction}>
        <input type="hidden" name="serverId" value={serverId} />
        <input type="hidden" name="currentPath" value={pathname} />
        <CardHeader>
          <CardTitle className="font-headline">Points Configuration</CardTitle>
          <CardDescription>
            Set the point values awarded for community and admin actions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading && (
            <div className="space-y-4">
                {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          )}
          {!isLoading && (
            <>
              {/* --- Community Points --- */}
              <div className="space-y-4">
                <h3 className="flex items-center gap-2 text-lg font-semibold text-primary">
                    <Twitch className="h-5 w-5" />
                    Community Points (Twitch)
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="raid-points">Raid</Label>
                    <Input id="raid-points" name="raidPoints" type="number" defaultValue={settings?.raidPoints ?? 10} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="follow-points">Follow</Label>
                    <Input id="follow-points" name="followPoints" type="number" defaultValue={settings?.followPoints ?? 5} required />
                  </div>
                </div>
                 <div className="grid grid-cols-2 gap-4">
                   <div className="space-y-2">
                    <Label htmlFor="sub-points">Subscription</Label>
                    <Input id="sub-points" name="subPoints" type="number" defaultValue={settings?.subPoints ?? 50} required />
                  </div>
                   <div className="space-y-2">
                    <Label htmlFor="gifted-sub-points">Gifted Sub</Label>
                    <Input id="gifted-sub-points" name="giftedSubPoints" type="number" defaultValue={settings?.giftedSubPoints ?? 25} required />
                  </div>
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="bit-points">per 100 Bits</Label>
                      <Input id="bit-points" name="bitPoints" type="number" defaultValue={settings?.bitPoints ?? 1} required />
                    </div>
                     <div className="space-y-2">
                      <Label htmlFor="chat-activity-points">Chat Activity</Label>
                      <Input id="chat-activity-points" name="chatActivityPoints" type="number" defaultValue={settings?.chatActivityPoints ?? 1} required />
                    </div>
                </div>
              </div>
              
              <div className="space-y-4">
                 <h3 className="flex items-center gap-2 text-lg font-semibold text-indigo-500">
                    <MessageSquare className="h-5 w-5" />
                    Community Points (Discord)
                </h3>
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="first-message-points">First Message of Day</Label>
                        <Input id="first-message-points" name="firstMessagePoints" type="number" defaultValue={settings?.firstMessagePoints ?? 5} required />
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="message-reaction-points">Message Reaction</Label>
                        <Input id="message-reaction-points" name="messageReactionPoints" type="number" defaultValue={settings?.messageReactionPoints ?? 1} required />
                    </div>
                 </div>
              </div>

              <Separator />

              {/* --- Admin Points --- */}
              <div className="space-y-4">
                 <h3 className="flex items-center gap-2 text-lg font-semibold text-green-600">
                    <Shield className="h-5 w-5" />
                    Admin Action Points
                </h3>
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="admin-event-points">Add Calendar Event</Label>
                        <Input id="admin-event-points" name="adminEventPoints" type="number" defaultValue={settings?.adminEventPoints ?? 10} required />
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="admin-log-points">Add Captain's Log</Label>
                        <Input id="admin-log-points" name="adminLogPoints" type="number" defaultValue={settings?.adminLogPoints ?? 5} required />
                    </div>
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="admin-message-points">Message Posted</Label>
                        <Input id="admin-message-points" name="adminMessagePoints" type="number" defaultValue={settings?.adminMessagePoints ?? 1} required />
                    </div>
                 </div>
              </div>
            </>
          )}

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
