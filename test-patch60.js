// Patch 60: false "not applicable" entries, cell repair, decision-log sheets, Depreciation & Tax alias (from The Bend, Fm-00066).
const { isNotApplicableAbsence } = require('./src/utils/absence-policy');
const { buildApplicabilityRecord } = require('./src/utils/applicability-record');
const { cellOnSheet, repairLocations } = require('./src/utils/location-repair');
const { resolveSheetName } = require('./src/utils/sheet-resolver');
let bad = 0; const ck = (n, ok) => { console.log((ok ? 'PASS: ' : 'FAIL: ') + n); if (!ok) bad++; };
const U = (condition, reason) => ({ status: 'uncertain', condition, reason });

ck('genuine: single-currency model stays Not Applicable', isNotApplicableAbsence(U('Not applicable to this model type: BALANCE SHEET and PROFIT & LOSS are presented entirely in A$ million with no foreign-currency conversion visible.', 'Model is single-currency AUD for an Australian project; no cross-border investment structure is evidenced.')));
ck('genuine: private model, no listed vehicle stays Not Applicable', isNotApplicableAbsence(U('Not applicable to this model type: DASHBOARD shows private enterprise/equity values with no listed market price.', 'No evidence this model is a listed REIT/public vehicle; it is a private development precinct model.')));
ck('evidence gap: register not provided is NOT applicability', !isNotApplicableAbsence(U('Not applicable - scope limitation, no adjustments register was provided.', 'Evidence gap - this requires a source register.')));
ck('evidence gap: no dependency-trace data is NOT applicability', !isNotApplicableAbsence(U('No dependency-trace data was available to confirm or refute orphaned inputs.', 'Confirming every input needs a full dependency trace not available from extracted row data not applicable not applicable')));
ck('evidence gap: lookup text not visible is NOT applicability', !isNotApplicableAbsence(U('No VLOOKUP/INDEX-MATCH formula text was visible in the reviewed row data.', 'Lookup integrity requires formula text inspection not applicable')));

const f = { id: 'T2-X', record_type: 'Not Applicable', _applicability: { basis: 'reviewer statement', subject: 'Not applicable to this model type: no FX.', reason: 'Not applicable to this model type: no FX. Single-currency AUD.' } };
const rec = buildApplicabilityRecord([f], {})[0];
ck('applicability reason no longer repeats the subject', !rec.reason.toLowerCase().includes('no fx') && rec.reason.includes('Single-currency'));

ck('cell: "DASHBOARD V5" on DASHBOARD', cellOnSheet('DASHBOARD V5 computes MIN(FINANCIALS!$L$243:$Q$243)', 'DASHBOARD') === 'V5');
ck('cell: Sheet!Cell on the other sheet', cellOnSheet('DASHBOARD V5 computes MIN(FINANCIALS!$L$243:$Q$243)', 'FINANCIALS') === 'L243');
ck('cell: two cells on the sheet is ambiguous', cellOnSheet('DASHBOARD V4 and DASHBOARD C25 differ', 'DASHBOARD') === null);
ck('cell: sheet named with no cell gives none', cellOnSheet('DASHBOARD shows 536.77', 'DASHBOARD') === null);
ck('cell: quoted sheet name', cellOnSheet("'DEBT SCHEDULE'!B7 and B11", 'DEBT SCHEDULE') === 'B7');
const rows = [{ sheet: 'DASHBOARD', cell: 'A1', condition: 'DASHBOARD V5 computes a DSCR' }, { sheet: 'DASHBOARD', cell: 'A1', condition: 'DASHBOARD shows two values' }, { sheet: 'DASHBOARD', cell: 'C9', condition: 'DASHBOARD V5 differs' }];
const st = repairLocations(rows, ['DASHBOARD', 'FINANCIALS']);
ck('repair: A1 replaced when unambiguous', rows[0].cell === 'V5' && rows[0].location_basis === 'cell_from_text');
ck('repair: A1 kept when the text names no cell', rows[1].cell === 'A1');
ck('repair: a real cell is never overwritten', rows[2].cell === 'C9');
ck('repair: stats count the repaired cell', st.fromRef === 1);

ck("alias: 'Profit & Loss' resolves PROFIT & LOSS", resolveSheetName('Profit & Loss', ['PROFIT & LOSS', 'BALANCE SHEET']) === 'PROFIT & LOSS');
const src = require('fs').readFileSync('./src/validator-tier2.js', 'utf8');
ck('alias: Depreciation & Tax list includes Profit & Loss', /'Depreciation & Tax': \[[^\]]*'Profit & Loss'/.test(src));
const lk = require('fs').readFileSync('./src/utils/sheet-linkage.js', 'utf8');
ck("linkage: 'decision' excluded as a log sheet", /EXCLUDE_KEYWORDS = \[[^\]]*'decision'/.test(lk));
console.log(bad ? bad + ' failed' : '\n17 checks passed'); process.exit(bad ? 1 : 0);
