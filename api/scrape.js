export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const { url } = await req.json();
  if (!url) return new Response(JSON.stringify({ error: 'URL required' }), { status: 400 });

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return new Response(JSON.stringify({ error: 'GEMINI_API_KEY가 설정되지 않았어요' }), { status: 500 });

  // 1. 페이지 HTML 가져오기
  let pageText = '';
  let imageUrl = '';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }
    });
    const html = await res.text();

    pageText = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000);

    const ogMatch = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    if (ogMatch) imageUrl = ogMatch[1];

    if (!imageUrl) {
      const imgMatch = html.match(/<img[^>]*src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
      if (imgMatch) imageUrl = imgMatch[1];
    }

    if (imageUrl && imageUrl.startsWith('/')) {
      const base = new URL(url);
      imageUrl = base.origin + imageUrl;
    }
  } catch (e) {
    pageText = `제품 URL: ${url}`;
  }

  // 2. Gemini API 호출
  const prompt = `당신은 광고 카피라이터입니다. 아래 제품 페이지 내용을 보고 한국어 광고 카피를 만들어주세요.

페이지 내용:
${pageText}

반드시 아래 JSON 형식으로만 응답하세요. 절대 다른 텍스트나 마크다운을 포함하지 마세요:
{"headline":"헤드라인(20자이내)","subtext":"서브텍스트(30자이내)","cta":"CTA버튼(10자이내)","brand":"브랜드명(15자이내)"}`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 300,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const geminiData = await geminiRes.json();

    if (geminiData.error) {
      throw new Error('Gemini 오류: ' + geminiData.error.message);
    }

    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let copy = {};
    try {
      copy = JSON.parse(rawText.trim());
    } catch {
      try {
        const cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
        copy = JSON.parse(cleaned);
      } catch {
        const jsonMatch = rawText.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
          copy = JSON.parse(jsonMatch[0]);
        } else {
          copy = { headline: "특별한 제품을 만나보세요", subtext: "지금 바로 확인해보세요", cta: "지금 구매하기", brand: "BRAND" };
        }
      }
    }

    return new Response(JSON.stringify({ copy, imageUrl }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
