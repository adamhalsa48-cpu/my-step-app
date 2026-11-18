/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.STAYFIT_MOBILE_EXPORT === '1' ? { output: 'export' } : {
    async headers() {
      return [{
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(), microphone=()' },
        ],
      }]
    },
  }),
  images: { unoptimized: true },
}

export default nextConfig
