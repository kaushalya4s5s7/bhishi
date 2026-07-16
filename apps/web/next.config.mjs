/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // Stub optional peer deps that Privy pulls in but we don't use
    config.resolve.alias = {
      ...config.resolve.alias,
      '@stripe/crypto': false,
      '@farcaster/mini-app-solana': false,
    };
    // Disable filesystem cache to avoid ENOSPC on disk-constrained machines
    config.cache = false;
    return config;
  },
};

export default nextConfig;
