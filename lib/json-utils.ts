export type JsonParseResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string }

function stripMarkdownFences(rawText: string): string {
  return rawText
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim()
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{")
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i += 1) {
    const char = text[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (char === "\\") {
      escaped = true
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (char === "{") depth += 1
    if (char === "}") depth -= 1

    if (depth === 0) {
      return text.slice(start, i + 1)
    }
  }

  return null
}

export function parseLlmJson(rawText: string): JsonParseResult {
  try {
    const cleaned = stripMarkdownFences(rawText)
    const jsonObject = extractFirstJsonObject(cleaned)

    if (!jsonObject) {
      return { ok: false, error: "No JSON object found in model output" }
    }

    return { ok: true, data: JSON.parse(jsonObject) as unknown }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error"
    return { ok: false, error: message }
  }
}
