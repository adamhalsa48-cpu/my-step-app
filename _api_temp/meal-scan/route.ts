import { generateText, Output } from 'ai'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { meals, profiles } from '@/lib/db/schema'
import { getSignedInUser } from '@/lib/server-auth'
import { eq } from 'drizzle-orm'

export const runtime = 'nodejs'

const scanResult = z.object({
  title: z.string().min(2).max(100),
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'meal']),
  caloriesKcal: z.number().int().min(0).max(10000),
  proteinGrams: z.number().min(0).max(500),
  carbsGrams: z.number().min(0).max(1000),
  fatGrams: z.number().min(0).max(500),
  ingredients: z.array(z.string().min(1).max(80)).max(30),
  aiNotes: z.string().max(500),
})

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

export async function POST(request: Request) {
  const user = await getSignedInUser()
  if (!user) return NextResponse.json({ error: 'Sign in to scan a meal.' }, { status: 401 })

  const form = await request.formData().catch(() => null)
  const photo = form?.get('photo')
  if (!(photo instanceof File) || !allowedTypes.has(photo.type) || photo.size < 1 || photo.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'Choose a JPG, PNG, or WebP photo smaller than 5 MB.' }, { status: 400 })
  }

  try {
    const [profile] = await db.select({ dietaryPreferences: profiles.dietaryPreferences }).from(profiles).where(eq(profiles.userId, user.id)).limit(1)
    const result = await generateText({
      model: 'google/gemini-3.8-flash',
      output: Output.object({ schema: scanResult }),
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Estimate the visible meal's nutrition for a general wellness log. Return reasonable approximate calories and macros, list only likely visible ingredients, and clearly say estimates can be inaccurate because portion sizes and hidden ingredients are unknown. Do not give medical advice. Dietary preferences for context: ${(profile?.dietaryPreferences ?? []).join(', ') || 'none supplied'}.`,
          },
          { type: 'file', mediaType: photo.type, data: new Uint8Array(await photo.arrayBuffer()) },
        ],
      }],
    })

    const output = scanResult.parse(result.output)
    const [meal] = await db.insert(meals).values({ userId: user.id, ...output }).returning()
    return NextResponse.json({ meal }, { status: 201 })
  } catch (error) {
    console.error('[stay-fit] meal scan failed', error)
    return NextResponse.json({ error: 'The meal could not be scanned right now. Try again in a moment.' }, { status: 502 })
  }
}
