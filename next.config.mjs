/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_PUBLIC_OAK_LOCAL_ASSISTANT === '1' && process.env.NODE_ENV === 'development' ? '.next-assistant' : '.next',
  experimental: {
    serverComponentsExternalPackages: ["pg"]
  }
};

export default nextConfig;
