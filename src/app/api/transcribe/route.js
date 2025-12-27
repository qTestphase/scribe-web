export const runtime = "nodejs";

import { NextResponse } from "next/server";

// Simple in-memory rate limiter
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;

// Audio constraints
const MIN_FILE_SIZE = 10000; // ~1s of audio minimum (bytes) - prevents Whisper hallucinations
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB (Whisper's limit)
const MAX_DURATION_SECONDS = 120;

function getRateLimitKey(req) {
  // Use IP address or forwarded IP
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";
  return ip;
}

function checkRateLimit(key) {
  const now = Date.now();
  const record = rateLimitMap.get(key);

  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(key, { windowStart: now, count: 1 });
    return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - 1 };
  }

  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    const resetIn = Math.ceil((record.windowStart + RATE_LIMIT_WINDOW - now) / 1000);
    return { allowed: false, resetIn };
  }

  record.count++;
  return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - record.count };
}

export async function POST(req) {
  // Rate limiting
  const rateLimitKey = getRateLimitKey(req);
  const rateLimit = checkRateLimit(rateLimitKey);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: `Too many requests — try again in ${rateLimit.resetIn} seconds` },
      { status: 429 }
    );
  }

  // Parse form data
  let formData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid request format" },
      { status: 400 }
    );
  }

  const audioFile = formData.get("file");

  // Validate file exists
  if (!audioFile) {
    return NextResponse.json(
      { error: "No audio file provided" },
      { status: 400 }
    );
  }

  // Validate file size (reject empty/tiny or oversized files)
  const fileSize = audioFile.size;

  if (fileSize < MIN_FILE_SIZE) {
    return NextResponse.json(
      { error: "Recording too short — please try again" },
      { status: 400 }
    );
  }

  if (fileSize > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `Recording too long — please keep under ${MAX_DURATION_SECONDS} seconds` },
      { status: 400 }
    );
  }

  // Prepare request to OpenAI
  const fd = new FormData();
  fd.append("file", audioFile);
  fd.append("model", "whisper-1");

  try {
    const openaiRes = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: fd,
      }
    );

    if (!openaiRes.ok) {
      const status = openaiRes.status;
      
      if (status === 429) {
        return NextResponse.json(
          { error: "Service busy — please try again in a moment" },
          { status: 429 }
        );
      }
      
      return NextResponse.json(
        { error: "Transcription failed — please try again" },
        { status: 500 }
      );
    }

    const data = await openaiRes.json();

    return NextResponse.json({
      text: data.text || "",
    });
  } catch {
    return NextResponse.json(
      { error: "Transcription failed — please try again" },
      { status: 500 }
    );
  }
}