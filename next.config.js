/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['aria-hidden', 'get-nonce', '@floating-ui/react', '@floating-ui/dom', '@floating-ui/core', '@floating-ui/utils'],
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config, { dev }) => {
    if (dev) {
      // Use in-memory cache in development to avoid PackFileCacheStrategy disk cache corruption
      config.cache = false;
    }
    return config;
  },
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
        hostname: 'firebasestorage.googleapis.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'flagcdn.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 's3.us-east-005.backblazeb2.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '**.backblazeb2.com',
        port: '',
        pathname: '/**',
      }
    ],
  },
};

module.exports = nextConfig;
