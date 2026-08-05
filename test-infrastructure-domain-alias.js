const { normalizeDomainLabel, loadDomainSkill } = require('./src/classifier.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// The real defect this fixes: confirmed via a direct review of a new
// skill-infrastructure.md draft that its content is genuinely accurate
// (verified sheet map, dates, structure toggle, and cash-accumulation
// pattern against the real Financial_Model_for_Railways model), but
// the file had no matching DOMAIN_ALIASES entry at all — Familiarisation's
// own model-type wording is LLM-generated and not guaranteed consistent,
// so without this the file would never actually get loaded.
// ══════════════════════════════════════════════════════════════════
const plausibleVariants = ['railway', 'Railway', 'rail', 'rail transport', 'infrastructure', 'Rail Infrastructure', 'railway — freight, passenger, and infrastructure operator'];
for (const variant of plausibleVariants) {
  const normalized = normalizeDomainLabel(variant);
  check(`"${variant}" normalizes to the canonical "infrastructure" domain`, normalized === 'infrastructure');
}

// ══════════════════════════════════════════════════════════════════
// Confirms the actual file genuinely loads, not just that the string
// normalizes correctly — the two are separate failure points.
// ══════════════════════════════════════════════════════════════════
{
  const result = loadDomainSkill('railway');
  check('loadDomainSkill("railway") actually loads skill-infrastructure.md, not a fallback',
    result.file === 'skill-infrastructure.md');
  check('the loaded content is substantial (not an empty/near-empty file)',
    result.content.length > 5000);
  check('the loaded content contains recognizable railway-domain markers',
    result.content.includes('Track access charge') && result.content.includes('Freight') && result.content.includes('Passenger'));
}

// ══════════════════════════════════════════════════════════════════
// Confirms genuinely unrelated model types do NOT falsely match —
// the alias list is deliberately scoped to railway-specific terms,
// not generic "transport"/"transportation", since those could also
// describe an airline, shipping, or trucking model this file's
// freight/passenger/infrastructure-entity-split content does not cover.
// ══════════════════════════════════════════════════════════════════
const unrelatedTypes = ['airline', 'trucking', 'shipping', 'transportation', 'logistics'];
for (const t of unrelatedTypes) {
  const normalized = normalizeDomainLabel(t);
  check(`"${t}" is correctly NOT normalized to "infrastructure" (falls through unchanged, to skill-generic.md)`,
    normalized === t);
}

// Confirms the property/mining aliases from before this change still
// work correctly — this addition must not have disturbed them.
check('regression: "property" domain still resolves correctly',
  normalizeDomainLabel('real estate') === 'property');
check('regression: "mining" domain still resolves correctly',
  normalizeDomainLabel('coal') === 'mining');

console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
if (!allPass) process.exit(1);
