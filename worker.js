/**
 * Cloudflare Worker backend for Multilingual College Notice Assistant.
 *
 * Required Worker secret:
 *   ANTHROPIC_API_KEY
 *
 * Required Worker variable:
 *   ALLOWED_ORIGIN = exact public origin of your OneClickLive website,
 *   e.g. https://abc12345.oneclicklive.app (no trailing slash)
 */

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function corsHeaders(origin, allowedOrigin) {
  const permitted = origin && origin === allowedOrigin ? origin : "null";
  return {
    "access-control-allow-origin": permitted,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "vary": "Origin"
  };
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...cors }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN || "");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405, cors);
    }
    if (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) {
      return json({ error: "This website is not allowed to use this AI endpoint. Check ALLOWED_ORIGIN." }, 403, cors);
    }
    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: "AI is not configured. Add the ANTHROPIC_API_KEY Worker secret." }, 500, cors);
    }

    try {
      const body = await request.json();
      const { system, notice, imageData, mimeType } = body || {};
      if (typeof system !== "string" || (!notice && !imageData)) {
        return json({ error: "Please provide notice text or an image." }, 400, cors);
      }
      if (typeof notice === "string" && notice.length > 60000) {
        return json({ error: "The notice is too long. Please keep it under 60,000 characters." }, 413, cors);
      }

      const content = [];
      if (imageData) {
        const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
        if (!allowed.includes(mimeType)) {
          return json({ error: "Use a JPG, PNG, GIF or WEBP image." }, 400, cors);
        }
        if (typeof imageData !== "string" || imageData.length > 7_000_000) {
          return json({ error: "Image is too large. Please upload an image smaller than 5 MB." }, 413, cors);
        }
        content.push({
          type: "image",
          source: { type: "base64", media_type: mimeType, data: imageData }
        });
      }
      if (notice) content.push({ type: "text", text: "NOTICE TEXT:\\n" + notice });
      if (imageData) content.push({ type: "text", text: "Read the attached notice image and extract its text accurately." });

      const upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 3000,
          system,
          messages: [{ role: "user", content }]
        })
      });

      const resultBody = await upstream.json();
      if (!upstream.ok) {
        return json(
          { error: resultBody?.error?.message || "The AI provider rejected the request." },
          upstream.status,
          cors
        );
      }
      const result = (resultBody.content || [])
        .filter(part => part.type === "text")
        .map(part => part.text)
        .join("\\n");

      return json({ result }, 200, cors);
    } catch (error) {
      return json({ error: "Server error while processing the notice. Please try again." }, 500, cors);
    }
  }
};
