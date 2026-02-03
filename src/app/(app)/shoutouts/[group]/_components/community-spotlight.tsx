'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PlayCircle } from "lucide-react";
import Image from "next/image";

// Mock data for a random clip
const mockClip = {
    gifUrl: "https://media.tenor.com/yG_mD8bW32EAAAAd/star-wars-celebration-lightsaber.gif",
    streamerName: "Galaxy_Glider",
    twitchUrl: "https://twitch.tv/Galaxy_Glider"
};

export function CommunitySpotlight() {
    // In the future, this would involve fetching a random clip from Firestore
    // and ensuring the gifUrl is available.
    const [clip] = React.useState(mockClip);

    return (
        <Card className="bg-gradient-to-tr from-primary/10 to-transparent">
            <div className="grid md:grid-cols-2 gap-6 items-center">
                <div className="p-6">
                    <CardHeader className="p-0">
                        <CardTitle className="text-2xl font-headline text-primary">Community Spotlight</CardTitle>
                        <CardDescription>
                            A special thanks to every member of the Space Mountain community. Together, we are stronger and shine brighter than any single star. This is for all of you!
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0 mt-4">
                        <p className="text-sm text-muted-foreground">
                            Now playing a random clip from: <a href={clip.twitchUrl} target="_blank" rel="noopener noreferrer" className="font-bold text-primary hover:underline">{clip.streamerName}</a>
                        </p>
                    </CardContent>
                </div>
                <div className="p-6 pt-0 md:p-6 h-full">
                    <div className="relative aspect-video w-full h-full rounded-lg overflow-hidden group border-2 border-primary/20">
                         <Image
                            src={clip.gifUrl}
                            alt={`Twitch clip from ${clip.streamerName}`}
                            layout="fill"
                            objectFit="cover"
                            unoptimized // GIFs should not be optimized by Next/image
                        />
                        <div className="absolute inset-0 bg-black/30 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                            <PlayCircle className="h-12 w-12 text-white/70 group-hover:text-white group-hover:scale-110 transition-transform" />
                        </div>
                    </div>
                </div>
            </div>
        </Card>
    )
}
