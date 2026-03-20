import { NextResponse } from 'next/server';
import { getEmbedToken } from '@/services/powerbi';

/**
 * Next.js Route Handler (`/api/get-embed-token`)
 * 
 * Secure server-side endpoint designed to execute the Azure AD and Power BI REST operations
 * safely on the backend. Emits an HTTP 200 payload with the embed token or HTTP 500 on failure.
 * 
 * Forced to run on the 'edge' runtime to ensure native Cloudflare Pages architecture compatibility.
 */
export const runtime = 'edge';

export async function GET() {
  try {
    const embedConfig = await getEmbedToken();
    return NextResponse.json(embedConfig, { status: 200 });
  } catch (error: any) {
    console.error('API /get-embed-token error: ', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
