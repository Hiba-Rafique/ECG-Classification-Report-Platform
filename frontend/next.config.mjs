/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lockfile at c:\Users\hibar\package-lock.json confuses root inference
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
