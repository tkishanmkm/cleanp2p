/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  allowedDevOrigins: [
    "*.run.app",
    "ais-dev-z4tflsmdxkkz6pqbnxv35p-11963060841.asia-east1.run.app",
    "ais-pre-z4tflsmdxkkz6pqbnxv35p-11963060841.asia-east1.run.app",
    "localhost:3000",
  ],
  transpilePackages: ['aria-hidden', 'get-nonce'],
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
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
      }
    ],
  },
};

module.exports = nextConfig;
