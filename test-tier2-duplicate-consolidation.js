const { consolidateTier2Duplicates, extractSameAsRefs, resolveRoot } = require('./src/utils/tier2-duplicate-consolidation.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// The real defect this fixes: confirmed directly against a real
// report — T2-S10-006 ("Same as T2-S5-003"), T2-S10-014 ("Same as
// T2-S5-007"), and T2-S10-092 ("Same as T2-S5-007/T2-S10-014") all
// self-identify as duplicates, inflating the headline count.
// ══════════════════════════════════════════════════════════════════
{
  const findings = [
    { id: 'T2-S5-003', reason: 'Equity build reliability cannot currently be confirmed due to X.' },
    { id: 'T2-S5-007', reason: 'Tax expense reliability affects NPAT and distributable cash outputs.' },
    { id: 'T2-S10-006', reason: 'Same as T2-S5-003 — equity build reliability cannot currently be confirmed.' },
    { id: 'T2-S10-014', reason: 'Same as T2-S5-007 — tax expense reliability affects NPAT and distributable cash outputs.' },
    { id: 'T2-S10-092', reason: 'Same as T2-S5-007/T2-S10-014.' },
    { id: 'T0-RSN-008', reason: 'Two valuation methods for the same asset diverge materially.' },
  ];

  const { consolidated, removed } = consolidateTier2Duplicates(findings);
  check('real defect fixed: 6 findings consolidate to exactly 3 (the 3 genuine duplicates removed)',
    consolidated.length === 3 && removed.length === 3);
  check('the 2-hop transitive chain resolves to the TRUE root (T2-S5-007), not the intermediate (T2-S10-014)',
    removed.find(r => r.id === 'T2-S10-092').rootId === 'T2-S5-007');
  check('the root finding gets a visible cross-reference note listing what was consolidated into it',
    consolidated.find(f => f.id === 'T2-S5-007').condition.includes('T2-S10-014') &&
    consolidated.find(f => f.id === 'T2-S5-007').condition.includes('T2-S10-092'));
}

// ══════════════════════════════════════════════════════════════════
// The exact real false positive: ordinary prose containing "same
// as" incidentally (as part of "the same asset") must NOT be treated
// as a duplicate reference.
// ══════════════════════════════════════════════════════════════════
{
  const findings = [
    { id: 'T0-RSN-008', reason: 'Two valuation methods for the same asset diverge materially.' },
  ];
  const { consolidated, removed } = consolidateTier2Duplicates(findings);
  check('ordinary prose containing "same as" incidentally (within "same asset") is correctly NOT treated as a duplicate',
    consolidated.length === 1 && removed.length === 0);
}

// ══════════════════════════════════════════════════════════════════
// A finding that references a root which doesn't actually exist in
// this run (e.g. the referenced rule didn't fire this time) must be
// kept standalone, not silently dropped — losing real information
// would be worse than an unconsolidated duplicate.
// ══════════════════════════════════════════════════════════════════
{
  const findings = [
    { id: 'T2-S10-006', reason: 'Same as T2-S5-003 — equity build reliability cannot currently be confirmed.' },
  ];
  const { consolidated, removed } = consolidateTier2Duplicates(findings);
  check('a finding referencing a root that does not exist in this run is kept standalone, not silently dropped',
    consolidated.length === 1 && removed.length === 0);
}

// ══════════════════════════════════════════════════════════════════
// A finding that (incorrectly, hypothetically) points at itself must
// not be dropped either — a genuine safety net against a malformed
// self-reference.
// ══════════════════════════════════════════════════════════════════
{
  const findings = [
    { id: 'T2-S1-001', reason: 'Same as T2-S1-001.' },
  ];
  const { consolidated } = consolidateTier2Duplicates(findings);
  check('a finding that points at itself is kept, not dropped (a safety net against a malformed self-reference)',
    consolidated.length === 1);
}

// ══════════════════════════════════════════════════════════════════
// Unit tests for the two helper functions directly.
// ══════════════════════════════════════════════════════════════════
check('extractSameAsRefs correctly handles a single referenced ID',
  JSON.stringify(extractSameAsRefs('Same as T2-S5-003 — some reason text.')) === JSON.stringify(['T2-S5-003']));
check('extractSameAsRefs correctly handles two slash-separated referenced IDs',
  JSON.stringify(extractSameAsRefs('Same as T2-S5-007/T2-S10-014.')) === JSON.stringify(['T2-S5-007', 'T2-S10-014']));
check('extractSameAsRefs returns null for text not starting with "same as"',
  extractSameAsRefs('This finding is not the same as anything else.') === null);
check('extractSameAsRefs returns null for a non-string input',
  extractSameAsRefs(null) === null && extractSameAsRefs(undefined) === null);

{
  const chain = new Map([['A', ['B']], ['B', ['C']], ['C', ['D']]]);
  check('resolveRoot correctly follows a 3-hop chain to its true end',
    resolveRoot('A', chain) === 'D');
}
{
  // A circular chain must not hang or crash — the depth cap protects
  // against this even though a genuine circular reference should
  // never actually occur in practice.
  const circular = new Map([['A', ['B']], ['B', ['A']]]);
  const result = resolveRoot('A', circular);
  check('a circular chain (should never genuinely occur) does not hang or crash, terminating via the depth cap',
    typeof result === 'string');
}

console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
if (!allPass) process.exit(1);
