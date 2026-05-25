import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Static export for portability (can be served by any web server)
  output: 'export',
  trailingSlash: true,

  // Disable image optimization for static export compatibility
  images: { unoptimized: true },

  // basePath for serving at /app subfolder (if needed)
  // basePath: '/onyx',

};

export default nextConfig;
