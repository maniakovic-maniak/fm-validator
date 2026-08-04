const ExcelJS = require('exceljs');
const fs = require('fs');
const { execSync } = require('child_process');
const { buildReportFile } = require('./src/report-tab');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

function readAuditOutputLines(outputPath) {
  const py = `
import openpyxl
wb = openpyxl.load_workbook("${outputPath}", data_only=True)
ws = wb["Audit Output"]
out = []
for r in range(1, 20):
    for c in range(1, 10):
        v = ws.cell(r,c).value
        if v is not None:
            out.append(str(v))
print("|||".join(out))
`;
  const scriptPath = '/tmp/_read_audit_output.py';
  fs.writeFileSync(scriptPath, py);
  return execSync(`python3 ${scriptPath}`, { encoding: 'utf-8' }).split('|||');
}

const baseMeta = {
  originalName: 'test.xlsx', modelType: 'test', modelIndustry: 'test',
  modelSummary: { currency: 'AUD', periodicity: 'monthly', key_sheets: ['Sheet1'] },
  tier0: { stats: {}, cellScoreIndex: {}, uniqueFormulas: [], edgeList: [] },
  overallAssessment: 'not_fit_for_purpose', igReadiness: 0, igCommentary: 'test',
  ruleResults: [], errorScan: [], redundantInputs: { applicable: false }, orphanSheets: { applicable: false },
  namedRangeAudit: { applicable: false }, formulaDeepDive: { findings: [] }, reasonableness: {},
  duplicateSheets: { applicable: false }, vbaReview: { applicable: false }, deepAccountingResolvedSheets: {},
};

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('/mnt/user-data/uploads/The_Bend_David_Gifford.xlsx');

  // ══════════════════════════════════════════════════════════════
  // The real scenario this fixes: a user ran the identical model
  // twice with no fixes applied. Direct comparison confirmed 18
  // closed findings were ALL Tier 2 (LLM), and of 19 new findings,
  // 12 were genuine new deterministic checks and 7 were more LLM
  // variance. The old blended line ("18 closed, 19 new") looked like
  // real progress/regression; it wasn't.
  // ══════════════════════════════════════════════════════════════
  {
    const outPath = '/tmp/test-crn-split.xlsx';
    await buildReportFile(outPath, [], [], {
      ...baseMeta,
      crossRunStats: {
        isFirstRun: false,
        closedFindingCount: 18, newFindingCount: 19, regressedFindingCount: 0, stillOpenFindingCount: 208,
        closedDeterministicCount: 0, newDeterministicCount: 12, regressedDeterministicCount: 0,
        closedLlmCount: 18, newLlmCount: 7, regressedLlmCount: 0,
      },
    });
    const lines = readAuditOutputLines(outPath);
    const text = lines.join(' ');
    check('deterministic line shows the genuine 12 new (not blended with LLM noise), and correctly shows 0 closed',
      text.includes('Since last run (deterministic checks)') && text.includes('0 closed') && text.includes('12 new'));
    check('LLM line shows the 18 closed / 7 new with the explicit non-determinism caveat',
      text.includes('Since last run (Tier 2 / LLM findings)') && text.includes('18 closed') && text.includes('7 new') && text.includes('can vary between runs even with an unchanged model'));
  }

  // ══════════════════════════════════════════════════════════════
  // Confirms the LLM line is entirely OMITTED when there's genuinely
  // nothing to report there — a run where only deterministic checks
  // changed shouldn't show an empty, confusing "0 closed · 0 new" LLM
  // line cluttering the report.
  // ══════════════════════════════════════════════════════════════
  {
    const outPath = '/tmp/test-crn-no-llm-change.xlsx';
    await buildReportFile(outPath, [], [], {
      ...baseMeta,
      crossRunStats: {
        isFirstRun: false,
        closedFindingCount: 3, newFindingCount: 2, regressedFindingCount: 0, stillOpenFindingCount: 50,
        closedDeterministicCount: 3, newDeterministicCount: 2, regressedDeterministicCount: 0,
        closedLlmCount: 0, newLlmCount: 0, regressedLlmCount: 0,
      },
    });
    const lines = readAuditOutputLines(outPath);
    const text = lines.join(' ');
    check('the LLM line is entirely omitted when there is genuinely nothing to report there (no clutter)',
      !text.includes('Tier 2 / LLM findings'));
  }

  // ══════════════════════════════════════════════════════════════
  // Confirms a GENUINE deterministic regression still triggers the
  // alarm-red background — this fix must not soften real signals.
  // ══════════════════════════════════════════════════════════════
  {
    const outPath = '/tmp/test-crn-genuine-regression.xlsx';
    await buildReportFile(outPath, [], [], {
      ...baseMeta,
      crossRunStats: {
        isFirstRun: false,
        closedFindingCount: 0, newFindingCount: 0, regressedFindingCount: 2, stillOpenFindingCount: 40,
        closedDeterministicCount: 0, newDeterministicCount: 0, regressedDeterministicCount: 2,
        closedLlmCount: 0, newLlmCount: 0, regressedLlmCount: 0,
      },
    });
    const lines = readAuditOutputLines(outPath);
    const text = lines.join(' ');
    check('a genuine deterministic regression still shows the explicit warning text',
      text.includes('2 regressed (previously closed, now reappeared)'));
  }

  // ══════════════════════════════════════════════════════════════
  // Confirms backward compatibility — a payload from before this
  // split (no *LlmCount/*DeterministicCount fields at all) still
  // renders correctly, falling back to the old blended behavior.
  // ══════════════════════════════════════════════════════════════
  {
    const outPath = '/tmp/test-crn-backward-compat.xlsx';
    await buildReportFile(outPath, [], [], {
      ...baseMeta,
      crossRunStats: {
        isFirstRun: false,
        closedFindingCount: 5, newFindingCount: 4, regressedFindingCount: 0, stillOpenFindingCount: 30,
      },
    });
    const lines = readAuditOutputLines(outPath);
    const text = lines.join(' ');
    check('a pre-split payload (no split fields at all) still renders without crashing, falling back to the blended numbers',
      text.includes('Since last run (deterministic checks)') && text.includes('5 closed') && text.includes('4 new'));
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
