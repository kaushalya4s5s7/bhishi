/** @type {import('next').NextConfig} */
const nextConfig = {
  // Turbopack (default in Next.js 16) — stub optional Privy peer deps not installed
  turbopack: {
    resolveAlias: {
      '@stripe/crypto': './src/stubs/empty.js',
      '@farcaster/mini-app-solana': './src/stubs/empty.js',
    },
  },
  // Disable persistent filesystem cache to avoid filling disk in dev
  experimental: {
    isrMemoryCacheSize: 0,
  },
  // Webpack fallback
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@stripe/crypto': false,
      '@farcaster/mini-app-solana': false,
    };
    config.cache = false;
    return config;
  },
};

export default nextConfig;
