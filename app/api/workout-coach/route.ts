import { generateText } from 'ai'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSignedInUser } from '@/lib/server-auth'

export const runtime = 'nodejs'

const questionSchema = z.object({
  question: z.string().trim().min(3).max(500),
})

export async function POST(request: Request) {
  const user = await getSignedInUser()
  if (!user) return NextResponse.json({ error: 'Sign in to ask the workout coach.' }, { status: 401 })

  const parsed = questionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Enter a workout question under 500 characters.' }, { status: 400 })

  try {
    const result = await generateText({
      model: 'google/gemini-3.8-flash',
      prompt: `You are the Stay Fit workout coach for a general wellness app. Answer the user's exercise question clearly and encouragingly. For exercise questions, explain what the movement is, the main muscles/body areas it works, and one or two beginner-friendly form cues. Keep the answer concise (under 120 words). Do not diagnose injuries, prescribe treatment, or promise results. Encourage stopping if a movement causes pain and adapting to the user's comfort. If asked for medical advice, say you cannot provide it and suggest a qualified professional.\n\nUser question: ${parsed.data.question}`,
    })

    return NextResponse.json({ answer: result.text })
  } catch (error) {
    console.error('[stay-fit] workout coach failed', error)
    return NextResponse.json({ error: 'The workout coach could not reply right now. Try again in a moment.' }, { status: 502 })
  }
}
