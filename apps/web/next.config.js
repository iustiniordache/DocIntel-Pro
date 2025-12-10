/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@docintel/shared'],
  experimental: {
    typedRoutes: true,
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
  },
  // Optimize for production
  poweredByHeader: false,
  compress: true,
  // Image optimization compatible with static export
  images: {
    unoptimized: true, // Required for static export to CloudFront
  },
  // Enable static export for S3+CloudFront deployment
  output: 'export',
  trailingSlash: true,
};

export default nextConfig;
