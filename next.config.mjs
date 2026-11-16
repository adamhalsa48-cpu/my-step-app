/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.STAYFIT_MOBILE_EXPORT === '1' ? { output: 'export' } : {}),
  images: { unoptimized: true },
}

export default nextConfig
