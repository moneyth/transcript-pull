// api/playlist.js - Vercel Serverless Function
// Scrapes playlist video IDs from YouTube — no API key needed

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
  const playlistId = searchParams.get('playlistId');
  const videoId = searchParams.get('videoId');

  if (videoId) {
    return new Response(
      JSON.stringify({ videos: [{ videoId, title: null }] }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  if (!playlistId) {
    return new Response(JSON.stringify({ error: 'playlistId or videoId is required' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const url = `https://www.youtube.com/playlist?list=${playlistId}`;
    const res = await fetch(url, {
      headers: {
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      },
    });
    const html = await res.text();

    const dataMatch = html.match(/var ytInitialData = ({.*?});<\/script>/s);
    if (!dataMatch) {
      return new Response(JSON.stringify({ error: 'Could not parse playlist data' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const data = JSON.parse(dataMatch[1]);
    const contents =
      data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]
        ?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]
        ?.itemSectionRenderer?.contents?.[0]
        ?.playlistVideoListRenderer?.contents || [];

    const videos = contents
      .filter(item => item?.playlistVideoRenderer)
      .map(item => ({
        videoId: item.playlistVideoRenderer.videoId,
        title: item.playlistVideoRenderer.title?.runs?.[0]?.text || null,
      }));

    if (videos.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No videos found — playlist may be private or empty' }),
        { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ videos }), {
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
