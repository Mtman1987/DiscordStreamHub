'use client';

import * as React from 'react';
import {
  collection,
  addDoc,
  Timestamp,
  doc,
  deleteDoc,
  query,
} from 'firebase/firestore';
import { useFirestore, useUser, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/page-header';
import type { UserProfile, CalendarEvent } from '@/lib/types';
import { format, isSameDay, isSameMinute, isToday } from 'date-fns';
import { PlusCircle, Loader2, BookUser, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { CalendarDisplay } from './_components/calendar-display';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Define a type for the new event, making eventDateTime a Timestamp
type NewCalendarEvent = Omit<CalendarEvent, 'id' | 'eventDateTime'> & {
    eventDateTime: Timestamp;
};

// --- Simple Debug Component ---
function SimpleEventList({ serverId }: { serverId: string | null }) {
    const firestore = useFirestore();
    const [currentMonthName, setCurrentMonthName] = React.useState(format(new Date(), 'MMMM'));

    const allEventsQuery = useMemoFirebase(() => {
        if (!firestore || !serverId) return null;
        return collection(firestore, 'servers', serverId, 'calendarEvents');
    }, [firestore, serverId]);

    const { data: allEvents, isLoading } = useCollection<CalendarEvent>(allEventsQuery);
    
    const todaysCaptain = React.useMemo(() => {
        if (!allEvents) return null;
        return allEvents.find(e => e.type === 'captains-log' && e.eventDateTime && isToday(e.eventDateTime.toDate()));
    }, [allEvents]);

    const displayEvents = React.useMemo(() => {
        if (!allEvents) return [];
        // Filter out 'captains-log' type events
        return allEvents.filter(event => event.type !== 'captains-log');
    }, [allEvents]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Events for {currentMonthName}</CardTitle>
                <CardDescription>A list of all upcoming events from the community calendar.</CardDescription>
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-60">
                    {isLoading ? (
                        <div className="space-y-2">
                            <Skeleton className="h-6 w-full" />
                            <Skeleton className="h-6 w-full" />
                            <Skeleton className="h-6 w-full" />
                        </div>
                    ) : displayEvents && displayEvents.length > 0 ? (
                        <ul className="space-y-2 text-sm">
                            {displayEvents.map(event => (
                                <li key={event.id} className="p-2 bg-secondary rounded-md">
                                    <p className="font-bold">{event.eventName} <span className="font-normal text-muted-foreground">({event.type})</span></p>
                                    <p>{event.description}</p>
                                    <p className="text-xs text-muted-foreground">{event.eventDateTime ? format(event.eventDateTime.toDate(), 'PPP, p') : 'No date'}</p>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-center text-muted-foreground py-10">No events found in the database.</p>
                    )}
                </ScrollArea>
            </CardContent>
            <CardFooter className="flex items-center gap-2 border-t pt-4">
                 <h3 className="text-sm font-semibold text-muted-foreground">Today's Captain:</h3>
                 {todaysCaptain ? (
                    <p className="font-semibold">{todaysCaptain.username}</p>
                 ) : (
                    <p className="text-sm text-muted-foreground">No Captain's Log recorded for today.</p>
                 )}
            </CardFooter>
        </Card>
    );
}


export default function CalendarPage() {
  const firestore = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();
  const [serverId, setServerId] = React.useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = React.useState<string | null>(null);

  const [isEventDialogOpen, setIsEventDialogOpen] = React.useState(false);
  const [isLogDialogOpen, setIsLogDialogOpen] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  
  // State for the confirmation dialog
  const [isConflictDialogOpen, setIsConflictDialogOpen] = React.useState(false);
  const [conflictingEvent, setConflictingEvent] = React.useState<NewCalendarEvent | null>(null);


  React.useEffect(() => {
    const storedServerId = localStorage.getItem('discordServerId');
    const storedUserId = localStorage.getItem('discordUserId');
    if (storedServerId) setServerId(storedServerId);
    if (storedUserId) setCurrentUserId(storedUserId);
  }, []);

  const allEventsQuery = useMemoFirebase(() => {
    if (!firestore || !serverId) return null;
    return collection(firestore, 'servers', serverId, 'calendarEvents');
  }, [firestore, serverId]);

  const { data: allEvents } = useCollection<CalendarEvent>(allEventsQuery);

  const { currentUserLogs, currentUserEvents } = React.useMemo(() => {
    if (!allEvents) return { currentUserLogs: [], currentUserEvents: [] };
    const userLogs = allEvents.filter(e => e.type === 'captains-log' && e.userId === currentUserId);
    const userEvents = allEvents.filter(e => e.type !== 'captains-log' && e.userId === currentUserId);
    return { currentUserLogs: userLogs, currentUserEvents: userEvents };
  }, [allEvents, currentUserId]);


  const currentUserProfileRef = useMemoFirebase(() => {
    if (!firestore || !serverId || !currentUserId) return null;
    return doc(firestore, 'servers', serverId, 'users', currentUserId);
  }, [firestore, serverId, currentUserId]);

  const { data: currentUserProfile } = useDoc<UserProfile>(currentUserProfileRef);

  const saveEvent = async (eventToSave: NewCalendarEvent) => {
    if (!firestore || !serverId) return;
    setIsSaving(true);
    try {
        const eventCollection = collection(firestore, 'servers', serverId, 'calendarEvents');
        await addDoc(eventCollection, eventToSave);
        toast({
          title: 'Success!',
          description: 'Your event has been added.',
        });
        setIsEventDialogOpen(false);
      } catch (error) {
        console.error("Failed to add event:", error);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Could not save the event. Please try again.',
        });
      } finally {
        setIsSaving(false);
        setConflictingEvent(null);
        setIsConflictDialogOpen(false);
      }
  }


  const handleAddEvent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firestore || !serverId || !user || !currentUserProfile || !allEvents) {
        toast({
            variant: 'destructive',
            title: 'Error',
            description: 'Cannot add event. User or server information is missing.',
        });
        return;
    }

    const formData = new FormData(event.currentTarget);
    const dateStr = formData.get('date') as string;
    const timeStr = formData.get('time') as string;
    const eventDate = new Date(`${dateStr}T${timeStr}`);
    
    const newEvent: NewCalendarEvent = {
        eventName: formData.get('title') as string,
        eventDateTime: Timestamp.fromDate(eventDate),
        type: formData.get('type') as 'event' | 'meeting' | 'qotd',
        description: formData.get('description') as string,
        userId: currentUserProfile.discordUserId,
        userAvatar: currentUserProfile.avatarUrl,
        username: currentUserProfile.username,
    };

    // Check for conflicts before saving
    const conflict = allEvents.find(existingEvent => {
        const existingEventDate = existingEvent.eventDateTime.toDate();
        return isSameMinute(existingEventDate, eventDate);
    });

    if (conflict) {
        setConflictingEvent(newEvent);
        setIsConflictDialogOpen(true);
    } else {
        await saveEvent(newEvent);
    }
  };

  const handleLogDay = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firestore || !serverId || !user || !currentUserProfile || !allEvents) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Cannot log day. User, server, or event information is missing.',
      });
      return;
    }
    setIsSaving(true);
    const formData = new FormData(event.currentTarget);
    const dateStr = formData.get('log_date') as string;
    
    const localDate = new Date(`${dateStr}T00:00:00`);

    const dayAlreadyClaimed = allEvents.some(e => 
        e.type === 'captains-log' && 
        isSameDay(e.eventDateTime.toDate(), localDate)
    );

    if (dayAlreadyClaimed) {
        toast({
            variant: 'destructive',
            title: 'Day Already Claimed',
            description: 'This day has already been logged by a captain. Please choose another day.',
        });
        setIsSaving(false);
        return;
    }

    const newLogEvent = {
        eventName: "Captain's Log",
        eventDateTime: Timestamp.fromDate(localDate),
        type: 'captains-log' as const,
        description: `${currentUserProfile.username} has claimed this day.`,
        userId: currentUserProfile.discordUserId,
        userAvatar: currentUserProfile.avatarUrl,
        username: currentUserProfile.username,
    };

    try {
      const eventCollection = collection(firestore, 'servers', serverId, 'calendarEvents');
      await addDoc(eventCollection, newLogEvent);
      toast({
        title: 'Success!',
        description: 'Your Captain\'s Log has been recorded.',
      });
      setIsLogDialogOpen(false);
    } catch (error) {
      console.error("Failed to log day:", error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Could not save the log. Please try again.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!firestore || !serverId) return;
    const eventDocRef = doc(firestore, 'servers', serverId, 'calendarEvents', eventId);
    try {
        await deleteDoc(eventDocRef);
        toast({
            title: 'Entry Deleted',
            description: 'The calendar entry has been removed.',
        })
    } catch (error) {
        console.error("Failed to delete event:", error);
        toast({
            variant: 'destructive',
            title: 'Error',
            description: 'Could not delete the entry.'
        })
    }
  };


  return (
    <div className="space-y-8">
       <PageHeader
        title="Mission Control"
        description="A live view of your community's schedule."
      >
        <div className="flex items-center gap-2">
            <Dialog open={isLogDialogOpen} onOpenChange={setIsLogDialogOpen}>
                <DialogTrigger asChild>
                    <Button variant="outline">
                        <BookUser className="mr-2 h-4 w-4" />
                        Captain's Log
                    </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Captain's Log</DialogTitle>
                        <DialogDescription>
                            Claim a day or manage your existing log entries for this month.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleLogDay} className="space-y-4">
                       <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="log_date" className="text-right">Date</Label>
                            <Input id="log_date" name="log_date" type="date" defaultValue={format(new Date(), 'yyyy-MM-dd')} className="col-span-3" required />
                        </div>
                        <Button type="submit" disabled={isSaving} className="w-full">
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Claim Day
                        </Button>
                    </form>

                    <Separator />

                    <div>
                        <h3 className="text-sm font-medium mb-2 text-center">Your Claimed Days</h3>
                        <ScrollArea className="h-40 w-full rounded-md border p-2">
                             <div className="space-y-2">
                                {currentUserLogs.length > 0 ? (
                                    currentUserLogs.map(log => (
                                        <div key={log.id} className="flex items-center justify-between text-sm p-2 bg-secondary rounded-md">
                                            <span>{format(log.eventDateTime.toDate(), 'MMMM do, yyyy')}</span>
                                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteEvent(log.id)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ))
                                ) : (
                                    <p className="text-sm text-muted-foreground text-center py-4">You have not claimed any days this month.</p>
                                )}
                             </div>
                        </ScrollArea>
                    </div>
                    
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setIsLogDialogOpen(false)}>Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isEventDialogOpen} onOpenChange={setIsEventDialogOpen}>
                <DialogTrigger asChild>
                    <Button>
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Add Event
                    </Button>
                </DialogTrigger>
                 <DialogContent className="max-h-[90vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Add or Manage Events</DialogTitle>
                        <DialogDescription>
                        Fill out the form to add a new event, or manage your existing events for this month.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto pr-4 -mr-4 space-y-6">
                        <form onSubmit={handleAddEvent} className="space-y-4 border-b pb-6">
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="title" className="text-right">Title</Label>
                                <Input id="title" name="title" className="col-span-3" required />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="date" className="text-right">Date</Label>
                                <Input id="date" name="date" type="date" defaultValue={format(new Date(), 'yyyy-MM-dd')} className="col-span-3" required />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="time" className="text-right">Time</Label>
                                <Input id="time" name="time" type="time" defaultValue="12:00" className="col-span-3" required />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="type" className="text-right">Type</Label>
                                <Select name="type" required defaultValue="event">
                                    <SelectTrigger className="col-span-3">
                                    <SelectValue placeholder="Select event type" />
                                    </SelectTrigger>
                                    <SelectContent>
                                    <SelectItem value="event">Event</SelectItem>
                                    <SelectItem value="meeting">Meeting</SelectItem>
                                    <SelectItem value="qotd">Question of the Day</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="description" className="text-right">Description</Label>
                                <Textarea id="description" name="description" className="col-span-3" required />
                            </div>
                            <div className="flex justify-end">
                                <Button type="submit" disabled={isSaving}>
                                    {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Save Event
                                </Button>
                            </div>
                        </form>
                        
                        <div className="space-y-2">
                            <h3 className="text-sm font-medium text-center">Your Created Events</h3>
                            <ScrollArea className="h-40 w-full rounded-md border p-2">
                                <div className="space-y-2">
                                    {currentUserEvents.length > 0 ? (
                                        currentUserEvents.map(event => (
                                            <div key={event.id} className="flex items-center justify-between text-sm p-2 bg-secondary rounded-md">
                                                <div className="flex-1 truncate">
                                                    <p className="font-semibold truncate">{event.eventName}</p>
                                                    <p className="text-xs text-muted-foreground">{format(event.eventDateTime.toDate(), 'PP, p')}</p>
                                                </div>
                                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteEvent(event.id)}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-sm text-muted-foreground text-center py-4">You have not created any events this month.</p>
                                    )}
                                </div>
                            </ScrollArea>
                        </div>
                    </div>

                    <DialogFooter className="mt-4">
                        <Button type="button" variant="outline" onClick={() => setIsEventDialogOpen(false)}>Close</Button>
                    </DialogFooter>
                 </DialogContent>
            </Dialog>
        </div>
      </PageHeader>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-1">
            <CalendarDisplay serverId={serverId} />
        </div>
        <div className="md:col-span-2">
            <SimpleEventList serverId={serverId} />
        </div>
      </div>

        <AlertDialog open={isConflictDialogOpen} onOpenChange={setIsConflictDialogOpen}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Event Conflict</AlertDialogTitle>
                    <AlertDialogDescription>
                        An event already exists at this date and time. Do you want to create this event anyway?
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setConflictingEvent(null)}>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => conflictingEvent && saveEvent(conflictingEvent)} disabled={isSaving}>
                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Create Anyway
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </div>
  );
}
