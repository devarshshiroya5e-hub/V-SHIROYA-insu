// OpenRouter PDF compatibility layer.
// The existing policy analyzer sends uploaded PDFs through an image_url content part.
// OpenRouter expects PDFs as a `file` content part. This preload transparently converts
// that request so the existing frontend/API contract does not need to change.

const originalFetch = globalThis.fetch;

function convertPdfParts(value) {
  if (Array.isArray(value)) return value.map(convertPdfParts);
  if (!value || typeof value !== "object") return value;

  if (
    value.type === "image_url" &&
    value.image_url?.url &&
    typeof value.image_url.url === "string" &&
    value.image_url.url.startsWith("data:application/pdf;base64,")
  ) {
    return {
      type: "file",
      file: {
        filename: value.image_url.filename || "policy.pdf",
        file_data: value.image_url.url,
      },
    };
  }

  const output = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = convertPdfParts(child);
  }
  return output;
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input?.url || "";

  if (url.includes("openrouter.ai/api/v1/chat/completions") && init.body) {
    try {
      const body = JSON.parse(String(init.body));
      body.messages = convertPdfParts(body.messages);

      // Mistral OCR is the reliable path for scanned/image-only insurance PDFs.
      // Set OPENROUTER_PDF_ENGINE=cloudflare-ai for the lower-cost parser.
      const engine = process.env.OPENROUTER_PDF_ENGINE || "mistral-ocr";
      const hasPdf = JSON.stringify(body.messages || []).includes('"type":"file"');
      if (hasPdf) {
        body.plugins = [
          ...(Array.isArray(body.plugins) ? body.plugins : []),
          { id: "file-parser", pdf: { engine } },
        ];
      }

      init = { ...init, body: JSON.stringify(body) };
    } catch (error) {
      console.warn("OpenRouter request compatibility patch skipped:", error?.message || error);
    }
  }

  return originalFetch(input, init);
};

console.log("✓ OpenRouter PDF compatibility layer loaded");
