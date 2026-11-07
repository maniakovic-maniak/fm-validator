'use strict';
// low-confidence-pass.js - Patch 57 (shadow only). In Fm-00062 the opening-balance rule T2-S2-009 passed at confidence 0.6 while a
// partner review found a real first-year net-debt discontinuity at that very cell. This measures, on every run, how many Pass
// results on critical/high/fatal rules carry a low self-reported confidence, and which. It changes NOTHING in the report, the
// matrix or the completion figure: the log line is for deciding whether a rule "low-confidence Pass becomes Uncertain" is
// worth switching on, once enough real runs have been looked at.
const BANDS = [0.6, 0.65, 0.7];
const HIGH_SEV = new Set(['fatal', 'critical', 'high']);

/** @param {Array<{id:string,status:string,confidence:number|null}>} ruleResults  @param {Map<string,string>|Object} severityById */
function lowConfidencePasses(ruleResults, severityById) {
  const sevOf = id => (severityById instanceof Map ? severityById.get(id) : (severityById || {})[id]);
  const passes = (ruleResults || []).filter(r => r && r.status === 'pass' && String(r.id || '').startsWith('T2-')
    && HIGH_SEV.has(String(sevOf(r.id) || '').toLowerCase()) && typeof r.confidence === 'number');
  const byBand = {};
  for (const b of BANDS) byBand[b] = passes.filter(r => r.confidence <= b).map(r => r.id);
  return { totalHighSeverityPasses: passes.length, byBand, ids: byBand[BANDS[0]] };
}

function summaryLine(s) {
  if (!s.totalHighSeverityPasses) return null;
  const parts = BANDS.map(b => `<=${b}: ${s.byBand[b].length}`).join(', ');
  const ids = s.ids.slice(0, 12).join(', ') + (s.ids.length > 12 ? ', ...' : '');
  return `Confidence check (shadow, no change to this report): of ${s.totalHighSeverityPasses} Pass result(s) on critical/high rules, those at or below each confidence - ${parts}${s.ids.length ? `; at <=${BANDS[0]}: ${ids}` : ''}`;
}

module.exports = { lowConfidencePasses, summaryLine, BANDS };
