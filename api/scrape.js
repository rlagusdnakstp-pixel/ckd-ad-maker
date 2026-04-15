export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const { url } = await req.json();
  if (!url) return new Response(JSON.stringify({ error: 'URL required' }), { status: 400 });

  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_API_KEY) return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY가 설정되지 않았어요' }), { status: 500 });

  // 1. 페이지 HTML 가져오기
  let pageText = '';
  let originalImageUrl = '';
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
    if (ogMatch) originalImageUrl = ogMatch[1];

    if (!originalImageUrl) {
      const imgMatch = html.match(/<img[^>]*src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
      if (imgMatch) originalImageUrl = imgMatch[1];
    }

    if (originalImageUrl && originalImageUrl.startsWith('/')) {
      const base = new URL(url);
      originalImageUrl = base.origin + originalImageUrl;
    }
  } catch (e) {
    pageText = `제품 URL: ${url}`;
  }

  // 2. OpenRouter로 카피 + 배경 프롬프트 동시 생성
  const copyPrompt = `당신은 광고 카피라이터입니다. 아래 제품 페이지 내용을 보고 한국어 광고 카피와 배경 이미지 프롬프트를 만들어주세요.

페이지 내용:
${pageText}

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트나 마크다운은 절대 포함하지 마세요:
{
  "headline": "헤드라인(20자이내)",
  "subtext": "서브텍스트(30자이내)",
  "cta": "CTA버튼(10자이내)",
  "brand": "브랜드명(15자이내)",
  "bgPrompt": "영어로 된 배경 이미지 생성 프롬프트. 제품과 어울리는 분위기의 광고 배경. 예: elegant dark background with soft bokeh lights, luxury product photography style, cinematic"
}`;

  let copy = {};
  let bgPrompt = '';

  try {
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ad-maker.vercel.app',
        'X-Title': 'AD Maker'
      },
      body: JSON.stringify({
        model: 'openrouter/elephant-alpha',
        messages: [{ role: 'user', content: copyPrompt }],
        max_tokens: 400,
        temperature: 0.7
      })
    });

    const aiData = await aiRes.json();
    if (aiData.error) throw new Error('AI 오류: ' + aiData.error.message);

    const rawText = aiData.choices?.[0]?.message?.content || '';

    try {
      copy = JSON.parse(rawText.trim());
    } catch {
      try {
        const cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
        copy = JSON.parse(cleaned);
      } catch {
        const jsonMatch = rawText.match(/\{[\s\S]*?\}/);
        if (jsonMatch) copy = JSON.parse(jsonMatch[0]);
        else copy = { headline: "특별한 제품을 만나보세요", subtext: "지금 바로 확인해보세요", cta: "지금 구매하기", brand: "BRAND" };
      }
    }

    bgPrompt = copy.bgPrompt || 'elegant dark studio background, professional product photography, cinematic lighting, luxury advertisement';
    delete copy.bgPrompt;

  } catch (e) {
    copy = { headline: "특별한 제품을 만나보세요", subtext: "지금 바로 확인해보세요", cta: "지금 구매하기", brand: "BRAND" };
    bgPrompt = 'elegant dark studio background, professional product photography, cinematic lighting';
  }

  // 3. Pollinations AI로 배경 이미지 생성
  let generatedImageUrl = '';
  try {
    const fullPrompt = `${bgPrompt}, no text, no watermark, advertisement background, high quality, 4k`;
    const encodedPrompt = encodeURIComponent(fullPrompt);
    // Pollinations AI - 무료 이미지 생성 API
    generatedImageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1080&height=1080&nologo=true&enhance=true&seed=${Date.now()}`;
  } catch (e) {
    generatedImageUrl = '';
  }

  // 4. 이미지 결정: AI 생성 이미지 우선, 없으면 원본 제품 이미지
  const finalImageUrl = generatedImageUrl || originalImageUrl || '';

  // 5. 이미지를 base64로 변환 (CORS 문제 해결)
  let imageBase64 = '';
  if (finalImageUrl) {
    try {
      const imgRes = await fetch(finalImageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const imgBuffer = await imgRes.arrayBuffer();
      const bytes = new Uint8Array(imgBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
      imageBase64 = `data:${contentType};base64,${base64}`;
    } catch (e) {
      imageBase64 = '';
    }
  }

  return new Response(JSON.stringify({
    copy,
    imageUrl: finalImageUrl,
    imageBase64,
    bgPrompt
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
