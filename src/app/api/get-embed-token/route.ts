import { NextResponse } from 'next/server';
import { getEmbedToken } from '@/services/powerbi';

export async function GET() {
  try {
    const embedConfig = await getEmbedToken();
    return NextResponse.json(embedConfig, { status: 200 });
  } catch (error: any) {
    console.error('API /get-embed-token error: ', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
