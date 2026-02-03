/* eslint-disable react/no-unescaped-entities */
/* eslint-disable @next/next/no-img-element */
import { FirebaseComponentsProvider } from "@/firebase";

export const dynamic = 'force-dynamic';

export default async function HeadlessCommunityCardPage({ 
  params, 
  searchParams 
}: { 
  params: Promise<{ serverId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { serverId } = await params;
  const {
    streamer,
    title,
    game,
    viewers,
    avatar,
    thumbnail,
    live
  } = await searchParams;

  const isLive = live === 'true';

  return (
    <FirebaseComponentsProvider>
      <main className="bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 w-[960px] h-[360px] flex flex-col">
        {/* Header */}
        <div className="w-full h-[60px] bg-black/60 border-b border-white/10 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img 
              src={avatar as string} 
              alt={`${streamer} avatar`}
              className="w-10 h-10 rounded-full border-2 border-purple-400"
            />
            <div>
              <h1 className="text-lg font-bold text-white">🚀 Captain {streamer}</h1>
              <div className="flex items-center gap-2">
                {isLive && (
                  <span className="bg-red-500 text-white px-2 py-1 rounded text-xs font-semibold animate-pulse">
                    🔴 LIVE
                  </span>
                )}
                <span className="text-purple-300 text-sm">👥 {viewers} viewers</span>
              </div>
            </div>
          </div>
          <div className="bg-gradient-to-r from-purple-500/20 to-blue-500/20 rounded-lg px-4 py-2 border border-purple-400/30">
            <div className="text-sm font-bold text-purple-300">⭐ COMMUNITY MEMBER</div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex flex-1">
          {/* Left Side - Stream Preview */}
          <div className="w-[640px] h-[240px] relative">
            <img 
              src={thumbnail as string}
              alt="Stream preview"
              className="w-full h-full object-cover"
            />
            {!isLive && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <div className="text-white text-center">
                  <div className="text-4xl mb-2">⏸️</div>
                  <div className="text-lg">Stream Offline</div>
                </div>
              </div>
            )}
          </div>

          {/* Right Side - Community Info */}
          <div className="w-[320px] h-[240px] bg-black/40 backdrop-blur-sm border-l border-white/10 p-6 flex flex-col">
            {/* AI Shoutout */}
            <div className="flex-1 mb-4">
              <div className="text-sm text-purple-300 mb-3 font-semibold">🤖 AI Cosmic Shoutout:</div>
              <div className="text-white text-sm leading-relaxed">
                "Space Cadet {streamer} is on an amazing {game} mission! Their dedication to exploring the digital cosmos makes them a valued member of our Space Mountain community. Join their adventure and support a fellow explorer! 🚀✨"
              </div>
            </div>

            {/* Stream Info */}
            <div className="space-y-3">
              <div>
                <div className="text-xs text-purple-300 mb-1 font-semibold">🎮 Currently Playing:</div>
                <div className="text-white text-sm font-semibold">{game}</div>
              </div>
              <div>
                <div className="text-xs text-purple-300 mb-1 font-semibold">📺 Stream Title:</div>
                <div className="text-white text-sm">{title}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="w-full h-[60px] bg-black/60 border-t border-white/10 px-6 py-3 flex items-center justify-between">
          <div className="text-purple-300 text-sm font-semibold">
            🌌 Space Mountain Command | Powered by Cosmic AI
          </div>
          <div className="text-white text-sm font-bold">
            twitch.tv/{streamer} | {new Date().toLocaleTimeString()}
          </div>
        </div>
      </main>
    </FirebaseComponentsProvider>
  );
}
