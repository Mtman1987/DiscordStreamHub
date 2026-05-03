/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  // Increase body size limit for API routes (clip uploads)
  serverExternalPackages: ['discord-verify', 'puppeteer-screen-recorder', 'better-sqlite3', 'sql.js'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'cdn.discordapp.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'wsrv.nl',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'static-cdn.jtvnw.net',
        port: '',
        pathname: '/**',
      },
    ],
  },
  // Required for discord-verify to work
  serverExternalPackages: ['discord-verify', 'puppeteer-screen-recorder', 'better-sqlite3', 'sql.js'],
  turbopack: {
    resolveAlias: {
      'firebase/firestore': './src/lib/firestore-shim.ts',
      'firebase/auth': './src/lib/firestore-shim.ts',
    },
  },
};

module.exports = nextConfig;
