// json-extract.js
// Shared robust JSON extraction from Claude API text responses.
// Handles: markdown fences, thinking-block leakage, and the most common
// JSON syntax errors caused by unescaped quotes inside narrative string
// values (more frequent with Sonnet 5's longer, more detailed responses).

// Attempts several increasingly aggressive repair strategies before giving up.
function extractJson(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('extractJson: empty or non-string input');
  }

  let cleaned = rawText.replace(/```json|```/g, '').trim();

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('extractJson: no JSON object braces found in response');
  }
  const slice = cleaned.substring(start, end + 1);

  // Attempt 1 — parse as-is
  try {
    return JSON.parse(slice);
  } catch (e1) {
    // fall through to repair attempts
  }

  // Attempt 2 — fix common unescaped-quote pattern inside string values.
  // Finds sequences like: "...text with a "quoted word" inside..."
  // and escapes internal quotes that aren't adjacent to JSON structural
  // characters (: , { } [ ]), which are the most likely cause of breaks.
  try {
    const repaired = repairUnescapedQuotes(slice);
    return JSON.parse(repaired);
  } catch (e2) {
    // fall through
  }

  // Attempt 3 — trailing comma removal (another common LLM JSON error)
  try {
    const noTrailingCommas = slice.replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(noTrailingCommas);
  } catch (e3) {
    // fall through
  }

  // Attempt 4 — combine both repairs
  try {
    let combined = repairUnescapedQuotes(slice);
    combined = combined.replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(combined);
  } catch (e4) {
    // give up — throw the original error with context for debugging
    const posMatch = e4.message.match(/position (\d+)/);
    let context = '';
    if (posMatch) {
      const pos = parseInt(posMatch[1], 10);
      const cStart = Math.max(0, pos - 150);
      const cEnd = Math.min(slice.length, pos + 150);
      context = `\nContext near error: ...${slice.substring(cStart, cEnd)}...`;
    }
    throw new Error(`extractJson: could not parse JSON after repair attempts: ${e4.message}${context}`);
  }
}

// Escapes quote characters that appear to be inside string values rather
// than acting as JSON string delimiters. Heuristic: a quote is a string
// delimiter if it's immediately preceded/followed by JSON structural
// characters (: , { } [ ] whitespace) — otherwise it's likely an embedded
// quote that should be escaped.
function repairUnescapedQuotes(jsonStr) {
  let result = '';
  let inString = false;
  let i = 0;
  while (i < jsonStr.length) {
    const ch = jsonStr[i];
    const prev = jsonStr[i - 1];

    if (ch === '"' && prev !== '\\') {
      if (!inString) {
        // Opening quote
        inString = true;
        result += ch;
      } else {
        // Potential closing quote — check if what follows looks like
        // valid JSON continuation (: , } ] or whitespace then one of those)
        let j = i + 1;
        while (j < jsonStr.length && /\s/.test(jsonStr[j])) j++;
        const nextMeaningful = jsonStr[j];
        if (nextMeaningful === ':' || nextMeaningful === ',' ||
            nextMeaningful === '}' || nextMeaningful === ']' ||
            j >= jsonStr.length) {
          // Looks like a genuine closing quote
          inString = false;
          result += ch;
        } else {
          // Looks like an embedded quote — escape it
          result += '\\"';
        }
      }
    } else {
      result += ch;
    }
    i++;
  }
  return result;
}

module.exports = { extractJson };
