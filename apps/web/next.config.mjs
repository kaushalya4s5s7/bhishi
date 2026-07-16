/** @type {import('next').NextConfig} */
const nextConfig = {
  // Turbopack (default in Next.js 16) — stub optional Privy peer deps not installed
  turbopack: {
    resolveAlias: {
      '@stripe/crypto': './src/stubs/empty.js',
      '@farcaster/mini-app-solana': './src/stubs/empty.js',
    },
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
