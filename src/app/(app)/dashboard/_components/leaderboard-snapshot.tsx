'use client';

import * as React from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import Image from 'next/image';

export function LeaderboardSnapshot() {

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-xl font-headline">Leaderboard</CardTitle>
          <CardDescription>Top community contributors.</CardDescription>
        </div>
        <Button asChild size="sm" variant="ghost">
          <Link href="/leaderboard">
            View All
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="relative aspect-[4/3] w-full bg-muted rounded-lg overflow-hidden border">
           <Image
            src="https://picsum.photos/seed/leaderboard-snapshot/400/300"
            alt="Leaderboard snapshot"
            fill
            className="object-cover"
            data-ai-hint="leaderboard chart"
           />
           <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
           <div className="absolute bottom-4 left-4 text-white">
                <h3 className="font-bold text-lg">Top 3 Players</h3>
                <p className="text-sm">GamerX_Pro, Pixel_Queen, Code_Wizard</p>
           </div>
        </div>
      </CardContent>
    </Card>
  );
}
