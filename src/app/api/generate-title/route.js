export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ title: "New note" });
  }

  const { transcript } = body;

  if (!transcript || !transcript.trim()) {
    return NextResponse.json({ title: "New note" });
  }

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content:
              "You generate short, concise titles for notes. Respond with only the title, no quotes, no punctuation at the end, max 6 words.",
          },
          {
            role: "user",
            content: `Generate a short title for this note:\n\n${transcript.slice(0, 1000)}`,
          },
        ],
        max_tokens: 20,
        temperature: 0.7,
      }),
    });

    if (!openaiRes.ok) {
      return NextResponse.json({ title: "New note" });
    }

    const data = await openaiRes.json();
    const title = data.choices?.[0]?.message?.content?.trim() || "New note";

    return NextResponse.json({ title });
  } catch {
    return NextResponse.json({ title: "New note" });
  }
}