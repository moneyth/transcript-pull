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
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    const html = await pageRes.text();

    // Extract title
    const titleMatch = html.match(/<title>(.*?)<\/title>/);
    const title = titleMatch
      ? titleMatch[1].replace(' - YouTube', '').trim()
      : `Video ${videoId}`;

    // Try multiple patterns to find caption tracks
    let tracks = [];

    // Pattern 1: captionTracks array
    const p1 = html.match(/"captionTracks":(\[.*?\])/s);
    if (p1) {
      try { tracks = JSON.parse(p1[1]); } catch (_) {}
    }

    // Pattern 2: inside playerCaptionsTracklistRenderer
    if (!tracks.length) {
      const p2 = html.match(/"playerCaptionsTracklistRenderer":\{"captionTracks":(\[.*?\])/s);
      if (p2) {
        try { tracks = JSON.parse(p2[1]); } catch (_) {}
      }
    }

    // Pattern 3: extract baseUrl directly
    if (!tracks.length) {
      const p3 = [...html.matchAll(/"baseUrl":"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]+)"/g)];
      if (p3.length) {
        tracks = p3.map(m => ({ baseUrl: m[1].replace(/\\u0026/g, '&') }));
      }
    }

    // Pattern 4: try timedtext API directly
    if (!tracks.length) {
      const timedRes = await fetch(
        `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`
      );
      if (timedRes.ok) {
        const timedData = await timedRes.json();
        const lines = (timedData?.events || [])
          .filter(e => e.segs)
          .map(e => e.segs.map(s => s.utf8).join('').trim())
          .filter(Boolean);
        if (lines.length) {
          return new Response(JSON.stringify({ transcript: lines.join(' '), title, videoId }), {
            status: 200,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          });
        }
      }
    }

    if (!tracks.length) {
      return new Response(
        JSON.stringify({ error: 'No captions available for this video' }),
        { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // Prefer English, fall back to first available
    const track =
      tracks.find(t => t.languageCode === 'en') ||
      tracks.find(t => t.languageCode?.startsWith('en')) ||
      tracks.find(t => t.kind === 'asr') ||
      tracks[0];

    if (!track?.baseUrl) {
      return new Response(
        JSON.stringify({ error: 'No usable caption track found' }),
        { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const baseUrl = track.baseUrl.replace(/\\u0026/g, '&');
    const captionRes = await fetch(baseUrl);
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

    if (!transcript) {
      return new Response(
        JSON.stringify({ error: 'Captions found but transcript was empty' }),
        { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

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