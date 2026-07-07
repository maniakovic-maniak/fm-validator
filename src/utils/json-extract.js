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
    const _qc = (rawText.match(/"/g) || []).length;
    const _trunc = _qc % 2 !== 0 ? ' [RESPONSE APPEARS TRUNCATED — odd quote count / unterminated string; check multi-block responses or max_tokens]' : '';
    throw new Error(`extractJson: could not parse JSON after repair attempts:${_trunc} ${e4.message}${context}`);
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
  const stack = [];               // tracks '{' / '[' nesting outside strings
  let i = 0;

  // After a potential closing quote followed by a comma, valid JSON must
  // continue with a key string (inside objects) or a value (inside arrays).
  // Narrative text like: including "typos", DIV/0 errors — has an embedded
  // quote followed by a comma, which the old heuristic misread as a real
  // string terminator. Look past the comma to decide.
  function validAfterComma(j) {
    while (j < jsonStr.length && /\s/.test(jsonStr[j])) j++;
    const c = jsonStr[j];
    const inArray = stack[stack.length - 1] === '[';
    if (c === '"') {
      if (inArray) return true;              // next array element
      // In an object the next token must be a key: "...":
      let k = j + 1;
      while (k < jsonStr.length) {
        if (jsonStr[k] === '"' && jsonStr[k - 1] !== '\\') break;
        k++;
      }
      k++;
      while (k < jsonStr.length && /\s/.test(jsonStr[k])) k++;
      return jsonStr[k] === ':';
    }
    // Non-string continuation is only valid inside arrays
    return inArray && (c === '{' || c === '[' || /[-0-9tfn]/.test(c || ''));
  }

  while (i < jsonStr.length) {
    const ch = jsonStr[i];
    const prev = jsonStr[i - 1];

    if (!inString && (ch === '{' || ch === '[')) stack.push(ch);
    else if (!inString && (ch === '}' || ch === ']')) stack.pop();

    if (ch === '"' && prev !== '\\') {
      if (!inString) {
        inString = true;
        result += ch;
      } else {
        let j = i + 1;
        while (j < jsonStr.length && /\s/.test(jsonStr[j])) j++;
        const nextMeaningful = jsonStr[j];
        if (nextMeaningful === ':' || nextMeaningful === '}' ||
            nextMeaningful === ']' || j >= jsonStr.length) {
          inString = false;
          result += ch;
        } else if (nextMeaningful === ',') {
          if (validAfterComma(j + 1)) {
            inString = false;
            result += ch;
          } else {
            result += '\\"';               // embedded quote before a comma
          }
        } else {
          result += '\\"';                 // embedded quote mid-sentence
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
