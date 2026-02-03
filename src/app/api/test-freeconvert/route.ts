// This file is intentionally left blank to disable the endpoint.
// The FreeConvert test functionality has been removed to ensure stability
// and replaced with a static placeholder in the main gif-conversion-service.
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  return NextResponse.json(
    {
      error: 'This endpoint is disabled.',
      message:
        'The FreeConvert API test has been removed to improve application stability. GIF generation now uses a static placeholder.',
    },
    { status: 410 }
  );
}
