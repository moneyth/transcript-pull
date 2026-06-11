// api/transcript.js - Vercel Serverless Function
// No API key needed

export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const { searchParams } = new URL(req.url);
  const videoId = searchParams.get('videoId');

  if (!videoId) {
    return new Response(JSON.stringify({ error: 'videoId is required' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const listUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const pageRes = await fetch(listUrl, {
      headers: { 'Accept-Language': 'en-US,en;q=0.9' },
    });
    const html = await pageRes.text();

    const captionMatch = html.match(/"captionTracks":\[(.*?)\]/);
    if (!captionMatch) {
      return new Response(
        JSON.stringify({ error: 'No captions available for this video' }),
        { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const tracks = JSON.parse(`[${captionMatch[1]}]`);
    const track =
      tracks.find(t => t.languageCode === 'en') ||
      tracks.find(t => t.languageCode?.startsWith('en')) ||
      tracks[0];

    if (!track?.baseUrl) {
      return new Response(
        JSON.stringify({ error: 'No usable caption track found' }),
        { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const captionRes = await fetch(track.baseUrl);
    const xml = await captionRes.text();

    const lines = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(m =>
      m[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/<[^>]*>/g, '')
        .trim()
    );

    const transcript = lines.filter(Boolean).join(' ');

    const titleMatch = html.match(/<title>(.*?)<\/title>/);
    const title = titleMatch
      ? titleMatch[1].replace(' - YouTube', '').trim()
      : `Video ${videoId}`;

    return new Response(JSON.stringify({ transcript, title, videoId }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
        }
