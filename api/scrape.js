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
  } catch (e) {
    pageText = `제품 URL: ${url}`;
  }

  // 2. OpenRouter로 카피 + 배경 프롬프트 생성
  const prompt = `당신은 광고 카피라이터입니다. 아래 제품 페이지 내용을 보고 한국어 광고 카피와 배경 이미지 프롬프트를 만들어주세요.

페이지 내용:
${pageText}

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트나 마크다운은 절대 포함하지 마세요:
{"headline":"헤드라인(20자이내)","subtext":"서브텍스트(30자이내)","cta":"CTA버튼(10자이내)","brand":"브랜드명(15자이내)","bgPrompt":"영어로된 광고배경 이미지 프롬프트 (예: dark luxury background with bokeh lights, professional product photography)"}`;

  let copy = { headline: "특별한 제품을 만나보세요", subtext: "지금 바로 확인해보세요", cta: "지금 구매하기", brand: "BRAND" };
  let bgPrompt = 'professional product advertisement background, studio lighting, elegant';

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
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 400,
        temperature: 0.7
      })
    });

    const aiData = await aiRes.json();
    if (aiData.error) throw new Error(aiData.error.message);
    const rawText = aiData.choices?.[0]?.message?.content || '';

    let parsed = {};
    try { parsed = JSON.parse(rawText.trim()); }
    catch { try { parsed = JSON.parse(rawText.replace(/```json\s*/gi,'').replace(/```\s*/gi,'').trim()); } catch { const m = rawText.match(/\{[\s\S]*?\}/); if(m) parsed = JSON.parse(m[0]); } }

    if (parsed.headline) copy.headline = parsed.headline;
    if (parsed.subtext)  copy.subtext  = parsed.subtext;
    if (parsed.cta)      copy.cta      = parsed.cta;
    if (parsed.brand)    copy.brand    = parsed.brand;
    if (parsed.bgPrompt) bgPrompt      = parsed.bgPrompt;

  } catch (e) {
    // 기본값 사용
  }

  // 3. Pollinations AI 배경 이미지 URL 생성 (base64 변환 없이 URL만 반환)
  const fullPrompt = `${bgPrompt}, no text, no watermark, no people, advertisement background, high quality`;
  const seed = Math.floor(Math.random() * 999999);
  const generatedImageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=1080&height=1080&nologo=true&seed=${seed}`;

  return new Response(JSON.stringify({
    copy,
    bgPrompt,
    generatedImageUrl,  // Pollinations AI 생성 이미지 URL
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
