export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const { url } = await req.json();
  if (!url) return new Response(JSON.stringify({ error: 'URL required' }), { status: 400 });

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return new Response(JSON.stringify({ error: 'API key not set' }), { status: 500 });

  // 1. 페이지 HTML 가져오기
  let pageText = '';
  let imageUrl = '';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AdMakerBot/1.0)' }
    });
    const html = await res.text();

    // 텍스트 추출 (태그 제거)
    pageText = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);

    // og:image 추출
    const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    if (ogImageMatch) imageUrl = ogImageMatch[1];

    // og:image 없으면 첫 번째 큰 이미지 찾기
    if (!imageUrl) {
      const imgMatch = html.match(/<img[^>]*src=["']([^"']*(?:product|main|hero|banner|thumb)[^"']*)["']/i)
        || html.match(/<img[^>]*src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp))["']/i);
      if (imgMatch) imageUrl = imgMatch[1];
    }

    // 상대경로면 절대경로로 변환
    if (imageUrl && imageUrl.startsWith('/')) {
      const base = new URL(url);
      imageUrl = base.origin + imageUrl;
    }

  } catch (e) {
    pageText = `URL: ${url}`;
  }

  // 2. Gemini API로 카피 생성
  const prompt = `다음은 제품 페이지의 내용이에요. 이 제품을 위한 광고 카피를 한국어로 만들어주세요.

페이지 내용:
${pageText}

아래 JSON 형식으로만 답해주세요. 다른 텍스트는 절대 포함하지 마세요:
{
  "headline": "짧고 강렬한 헤드라인 (20자 이내)",
  "subtext": "혜택을 강조하는 서브텍스트 (30자 이내)",
  "cta": "행동을 유도하는 CTA 버튼 텍스트 (10자 이내)",
  "brand": "브랜드명 또는 제품명 (15자 이내)"
}`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 256 }
        })
      }
    );

    const geminiData = await geminiRes.json();
    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const clean = rawText.replace(/```json|```/g, '').trim();
    const copy = JSON.parse(clean);

    return new Response(JSON.stringify({ copy, imageUrl }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: 'AI 카피 생성 실패: ' + e.message }), { status: 500 });
  }
}
