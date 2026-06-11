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
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    const html = await res.text();

    // Try multiple patterns for ytInitialData
    let data = null;
    const patterns = [
      /var ytInitialData = ({.*?});<\/script>/s,
      /window\["ytInitialData"\] = ({.*?});<\/script>/s,
      /ytInitialData = ({.*?});/s,
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        try { data = JSON.parse(match[1]); break; } catch (_) {}
      }
    }

    if (!data) {
      return new Response(JSON.stringify({ error: 'Could not parse playlist data' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Try multiple paths in the data structure
    let contents = [];

    // Path 1: standard
    contents = data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]
      ?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]
      ?.itemSectionRenderer?.contents?.[0]
      ?.playlistVideoListRenderer?.contents || [];

    // Path 2: alternate structure
    if (!contents.length) {
      contents = data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]
        ?.tabRenderer?.content?.richGridRenderer?.contents || [];
    }

    // Path 3: deep search for playlistVideoRenderer anywhere in data
    if (!contents.length) {
      const str = JSON.stringify(data);
      const matches = [...str.matchAll(/"videoId":"([^"]{11})","thumbnail".*?"text":"([^"]+)"/g)];
      if (matches.length) {
        const videos = matches.map(m => ({ videoId: m[1], title: m[2] }));
        return new Response(JSON.stringify({ videos }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
    }

    // Path 4: regex fallback directly on raw HTML
    if (!contents.length) {
      const idMatches = [...html.matchAll(/\/watch\?v=([a-zA-Z0-9_-]{11})/g)];
      const seen = new Set();
      const videos = [];
      for (const m of idMatches) {
        if (!seen.has(m[1])) {
          seen.add(m[1]);
          videos.push({ videoId: m[1], title: null });
        }
      }
      if (videos.length) {
        return new Response(JSON.stringify({ videos }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
    }

    const videos = contents
      .filter(item => item?.playlistVideoRenderer || item?.richItemRenderer?.content?.videoRenderer)
      .map(item => {
        const r = item?.playlistVideoRenderer || item?.richItemRenderer?.content?.videoRenderer;
        return {
          videoId: r?.videoId,
          title: r?.title?.runs?.[0]?.text || r?.title?.simpleText || null,
        };
      })
      .filter(v => v.videoId);

    if (!videos.length) {
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