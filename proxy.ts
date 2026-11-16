import { NextRequest, NextResponse } from 'next/server'
import { capacitorOrigins } from './lib/native-origins'

function configuredOrigin(value: string | undefined) {
  if (!value) return null
  try {
    const parsed = new URL(value.includes('://') ? value : `https://${value}`)
    return parsed.origin
  } catch {
    return null
  }
}

function isAllowedOrigin(origin: string) {
  const allowed = new Set([
    ...capacitorOrigins,
    configuredOrigin(process.env.VERCEL_URL),
    configuredOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL),
    configuredOrigin(process.env.V0_RUNTIME_URL),
    configuredOrigin(process.env.V0_DEV_APP_URL),
    configuredOrigin(process.env.V0_BUILD_URL),
    configuredOrigin(process.env.V0_SANDBOX_URL),
  ].filter((value): value is string => Boolean(value)))
  return allowed.has(origin)
}

export function proxy(request: NextRequest) {
  const origin = request.headers.get('origin')
  if (!origin || !isAllowedOrigin(origin)) return NextResponse.next()

  const headers = new Headers({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  })
  if (request.method === 'OPTIONS') return new NextResponse(null, { status: 204, headers })

  const response = NextResponse.next()
  headers.forEach((value, key) => response.headers.set(key, value))
  return response
}

export const config = { matcher: '/api/:path*' }
