import { auth } from '@/lib/auth'

export async function getSignedInUser() {
  const { data } = await auth.getSession()
  return data?.user ?? null
}
