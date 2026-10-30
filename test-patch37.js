'use strict';
// Patch 37 checks: a query the file answers is closed with its evidence; a remedy about an empty cell is withheld.
const { buildTaxWorkbook, CQ } = require('./scripts/query-fixtures');
const { resolveAnswerableQueries } = require('./src/utils/query-resolver');
const { applyRemedyChecks, cellListCitations } = require('./src/utils/remedy-check');
const { mergeDuplicateCriticalQueries } = require('./src/utils/record-type-classifier');
let fails = 0;
const check = (n, ok) => { console.log((ok ? 'PASS: ' : 'FAIL: ') + n); if (!ok) fails++; };

async function load(variant) {
  const { parseExcel } = require('./src/parser');
  const { runTier0 } = require('./src/validator-tier0');
  const parsed = await parseExcel(await buildTaxWorkbook(variant));
  const t0 = await runTier0(parsed);
  return { workbook: parsed._raw, cellScoreIndex: t0.cellScoreIndex };
}

(async () => {
  // 1. every row links, the cited column is empty
  let ctx = await load('linked');
  let f = CQ({});
  let sum = resolveAnswerableQueries([f], ctx);
  check('all cells link: the Critical Query becomes a False Positive', f.record_type === 'False Positive' && sum.answered.length === 1);
  check('the original record type and the evidence are kept', f.query_resolution.original_record_type === 'Critical Query' && /all 12 populated cell/.test(f.query_resolution.evidence));
  check('the wrong column is reported and the row is tested instead', f.query_resolution.widened_to_row === true && /column I, which is empty/.test(f.query_resolution.evidence));
  check('the note on the record says it was answered by the file', /Query answered by the file/.test(f.record_type_note) && /Critical Query/.test(f.record_type_note));

  // 2. one typed value
  ctx = await load('typed');
  f = CQ({});
  sum = resolveAnswerableQueries([f], ctx);
  check('one typed value: the Critical Query stays open', f.record_type === 'Critical Query' && sum.typed.length === 1);
  check('the typed cell is named', f.query_resolution.status === 'typed_value_found' && f.query_resolution.cells.includes('SystemOperator!AQ694'));

  // 3. one calculation
  ctx = await load('calc');
  f = CQ({});
  resolveAnswerableQueries([f], ctx);
  check('a calculation in the chain is not a plain link: the question stays open', f.record_type === 'Critical Query' && f.query_resolution.status === 'not_answered');

  // 4. cited column holds the links: exact cells are tested
  ctx = await load('colI');
  f = CQ({});
  resolveAnswerableQueries([f], ctx);
  check('cited cells that hold links are tested as cited, without widening', f.record_type === 'False Positive' && f.query_resolution.widened_to_row === false && f.query_resolution.tested === 4);

  // 5. what is not touched
  ctx = await load('linked');
  const other = [
    CQ({ id: 'T0-X-1' }),
    CQ({ record_type: 'Confirmed Finding' }),
    CQ({ fix_instruction: 'Review the tax rate rows.' }),
    CQ({ fix_instruction: 'Confirm SystemOperator!I165 is a formula reference to Nowhere!I78.' }),
  ];
  sum = resolveAnswerableQueries(other, ctx);
  check('a Tier 0 finding, a Confirmed Finding, another question shape and an unknown sheet are not touched', sum.examined === 0 && other.every(o => !o.query_resolution) && other[1].record_type === 'Confirmed Finding');

  // 6. remedy check on the same text
  ctx = await load('linked');
  const w = CQ({});
  const nonEmpty = CQ({ id: 'T2-X-2', fix_instruction: 'Confirm that SystemOperator!AP165, AQ165 and AR165 are formula references to AP78.' });
  const noClaim = CQ({ id: 'T2-X-3', fix_instruction: 'Look at SystemOperator!I165, I653 and I724 again.' });
  const rsum = applyRemedyChecks([w, nonEmpty, noClaim], ctx);
  check('a statement about empty cells is withheld and names them', w.remedy_check.status === 'withheld' && /SystemOperator!I165, SystemOperator!I653, SystemOperator!I694, SystemOperator!I724/.test(w.remedy_check.reasons[0]));
  check('a statement about cells that hold something is confirmed', nonEmpty.remedy_check.status === 'verified');
  check('a list with no statement about the cells is not judged', noClaim.remedy_check.status === 'unverified');
  check('the original remedy text is kept', /formula references to I78/.test(w.remedy_check.original));
  const lists = cellListCitations(w.remedy_check.original, ctx.workbook);
  check('the list parser reads "I165, I653, I694 and I724" as four cells', lists.length === 1 && lists[0].cells.join() === 'I165,I653,I694,I724');
  check('summary counts', rsum.checked === 3 && rsum.withheld === 1 && rsum.verified === 1 && rsum.unverified === 1);

  // 7. the resolver still reads the question after the remedy was withheld
  sum = resolveAnswerableQueries([w], ctx);
  check('the resolver reads the original remedy after it was withheld', w.record_type === 'False Positive' && sum.answered.length === 1);

  // 8. a False Positive no longer takes part in Critical Query merging
  const a = CQ({ id: 'T2-A-1', cell: 'AP42', confidence: 50 }), b = CQ({ id: 'T2-A-2', cell: 'AP42', confidence: 40 });
  b.record_type = 'False Positive';
  check('a closed query is not merged with an open one', mergeDuplicateCriticalQueries([a, b]).length === 0 && a.record_type === 'Critical Query');

  console.log(fails ? `\n${fails} FAILED` : '\nAll Patch 37 checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
