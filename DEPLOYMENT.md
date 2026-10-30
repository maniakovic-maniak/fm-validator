# Financial Model Validator - Deployment Guide

## Overview
This is a Node.js/Express application that provides a web interface for validating financial models (Excel files) against a predefined checklist of rules.

## Features
- ✅ HTML-based file upload interface
- ✅ Excel validation against financial checklist
- ✅ Real-time progress tracking
- ✅ Detailed validation reports with pass/fail statistics
- ✅ Support for multiple checklist profiles
- ✅ File size limit: 20 MB
- ✅ Format support: .xlsx and .xlsm
- ✅ **Secure: Uses ExcelJS for safe file parsing** (no vulnerable dependencies)

## Security
**Last Updated: May 26, 2026**
- Uses ExcelJS for secure Excel file parsing (replaces deprecated xlsx)
- Multer v2.0.1 (all DoS vulnerabilities patched)
- UUID v11 (buffer bounds checks enabled)
- Regular dependency audits via `npm audit`
- No high-severity vulnerabilities

## System Requirements
- **Node.js**: v14 or higher
- **npm**: v6 or higher
- **Disk space**: 100 MB minimum
- **Port**: 3000 (configurable via .env)

## Installation & Setup

### 1. Deploy Files
Copy the entire project to your web host:
```bash
cp -r fm-validator /path/to/deployment
cd /path/to/deployment
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
Copy `.env.example` to `.env` and update settings:
```bash
cp .env.example .env
```

Edit `.env`:
```
PORT=3000
NODE_ENV=production
ACTIVE_CHECKLIST=checklist.json
```

### 4. Create Upload Directory
```bash
mkdir -p uploads
chmod 755 uploads
```

### 5. Start Server
```bash
# Development
npm start

# Or with process manager (recommended for production)
pm2 start server.js --name "fm-validator"
```

The application will be available at:
```
http://localhost:3000
```

## Project Structure
```
fm-validator/
├── server.js                 # Express server & API endpoints
├── package.json              # Dependencies
├── .env.example              # Environment configuration template
├── public/
│   └── index.html            # Web interface (HTML + JS)
├── validators/
│   └── runner.js             # Validation engine
├── checklists/
│   ├── checklist.json        # Default validation rules (18 rules)
│   ├── checklist-full.json   # Comprehensive validation (38 rules)
│   └── config.json           # Checklist configuration
└── uploads/                  # Temporary file storage (auto-created)
```

## API Endpoints

### GET /
Returns the main HTML interface.

### POST /api/validate
Upload and validate an Excel file.

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- File parameter: `file` (.xlsx only, max 20 MB)

**Response:**
```json
{
  "status": "success",
  "data": {
    "timestamp": "2026-05-25T11:07:31.458Z",
    "fileName": "model.xlsx",
    "fileSize": 23738,
    "checklist": "checklist",
    "status": "completed",
    "results": {
      "passed": [...],
      "failed": [...],
      "warnings": [...]
    },
    "stats": {
      "total": 18,
      "passed": 18,
      "failed": 0,
      "passRate": 100
    }
  }
}
```

### GET /api/health
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-05-25T11:06:50.859Z",
  "version": "1.0.0"
}
```

### GET /api/checklists
Get available checklists configuration.

## Validation Process

1. User uploads `.xlsx` file via web interface
2. File is saved to `uploads/` directory
3. Validator engine runs checklist against file
4. Results include:
   - Individual pass/fail for each rule
   - Statistics (total, passed, failed, pass rate)
   - Detailed messages for failures
5. Results displayed in UI with summary report

## Checklists Explained

### checklist.json (18 rules - Active by default)
Core validation for essential financial model integrity:
- **Tier 1 (6 rules)**: Critical structural checks
  - Required sheets present
  - No formula errors
  - Model Issues tab empty
  - Balance sheet check exists
  - Cash flow reconciliation exists
  - No negative PP&E

- **Tier 2 (12 rules)**: Financial integrity
  - Balance sheet reconciliation
  - Cash flow reconciliation
  - Retained earnings flow-through
  - Debt and capex coherence
  - Margin plausibility
  - And 7 more financial checks

### checklist-full.json (38 rules - Optional)
Comprehensive audit-grade validation covering:
- Model purpose & transparency
- Input management
- Formula logic consistency
- All financial reconciliations
- Debt management
- Operations & returns
- Scenarios & sensitivities
- Model integrity & documentation

**To use full checklist:**
Edit `checklists/config.json` and set:
```json
{
  "activeChecklist": "checklist-full.json"
}
```

## Troubleshooting

### Port Already in Use
```bash
# Find process using port 3000
lsof -i :3000

# Change port in .env
PORT=3001
```

### File Upload Fails
- Check file is `.xlsx` format
- Verify file size < 20 MB
- Ensure `uploads/` directory exists and is writable

### Validation Always Passes
- This is normal for new models; validation checks for specific sheet structures
- See results details for which checks passed/failed

### Dependencies Installation Issues
```bash
# Clear npm cache
npm cache clean --force

# Reinstall
rm package-lock.json
npm install
```

### A Finding or Report Looks Wrong (Not an Operational Failure)
The sections above cover the app not running. If the app runs fine but a
specific finding, count, or report field looks incorrect, that's a
different kind of problem — see **[TRIAGE.md](TRIAGE.md)** before
changing any code. The same visible symptom can originate in the check
logic, the Tier 2 prompt guidance, the data Tier 2 was given, the
report-builder's presentation logic, or a stale deployment — each needs
a different fix, and guessing wrong wastes a cycle.

## Production Deployment

### Using PM2 (Recommended)
```bash
# Install PM2 globally
npm install -g pm2

# Start application
pm2 start server.js --name "fm-validator" --instances max --exec-mode cluster

# Setup auto-restart on reboot
pm2 startup
pm2 save
```

### Using Docker (Optional)
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

### Using Nginx Reverse Proxy
```nginx
upstream fm_validator {
  server localhost:3000;
}

server {
  listen 80;
  server_name yourdomain.com;

  location / {
    proxy_pass http://fm_validator;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }
}
```

## Performance Tips

1. **Clean up old uploads regularly**
   ```bash
   find uploads -mtime +7 -delete  # Delete files older than 7 days
   ```

2. **Monitor server resources**
   ```bash
   pm2 monit
   ```

3. **Enable gzip compression in Nginx** for faster transfers

4. **Consider CDN** for static assets if serving globally

## Security Considerations

1. **Validate uploaded files** - Only .xlsx accepted, 20 MB limit
2. **Sanitize file paths** - Using multer's storage configuration
3. **Error handling** - Generic error messages to prevent info disclosure
4. **CORS** - Configure as needed for client applications
5. **Environment variables** - Never commit `.env` file with secrets

## Support & Maintenance

### Regular Maintenance
- Monitor error logs
- Clean up `uploads/` directory
- Update dependencies: `npm audit fix`
- Backup database/config if using persistent storage

### Monitoring
```bash
# Check application status
pm2 status

# View logs
pm2 logs fm-validator

# View specific errors
pm2 logs fm-validator --err
```

## Version History
- **1.0.1** - Security update: Migrated from xlsx to ExcelJS, upgraded multer to 2.0.1, upgraded uuid to 11.1.1. Removed all high-severity vulnerabilities.
- **1.0.0** - Initial release with 18-rule core checklist and 38-rule full checklist

## License
ISC

## Run provenance and baselines (Patch 27)

Every report now carries a RUN PROVENANCE panel on the Scope and Reliance tab (input SHA-256, size, validator commit,
rule-set version, reviewer model), and a `<report>.provenance.json` file is written beside the report in `processed/`
(removed by the same 30-day sweep). The commit is read from `.git`, or from `GIT_COMMIT` if the deploy sets it.

- `node scripts/acceptance-baseline.js` runs the 16 acceptance cases from the 29 Oct 2026 independent review against the
  current code and compares them with `acceptance/baseline.json`. A patch that makes a case pass runs it with `--update`
  and commits the new baseline in the same patch.
- `node scripts/baseline-run.js "<workbook>"` is a timed, no-cost pass (parse, Tier 0, SUM-range scan, recalculation)
  that records seconds and peak memory per stage in `baseline/`. Run it once on the VPS for Hidden Gem before Patches 30
  and 32.

## Recalculation ledger (Patch 28)

`src/recalc_check.py` now returns a `ledger`: every formula cell in exactly one outcome (matched, differ, held back by a
known engine limitation, volatile, engine error, no saved value, type not judged, set aside before comparison, not run),
and the categories are reconciled to the workbook's formula-cell count. The comparison rules live in
`src/recalc_compare.py`: numbers within 0.1% (absolute floor 0.01, or 0.0001 for saved values of size 10 or less); text,
Boolean and error values exact; dates to within one second. An IFERROR/IFNA formula is held back only when it calls a
function in `ENGINE_LIMITED_FUNCTIONS` (MATCH, IRR, XIRR); the word IFERROR alone no longer hides a difference.
A cell that calls or depends on NOW, TODAY, RAND, INFO or CELL("filename") is volatile and is counted, not raised.
Findings: T0-RECALC-001 (numbers), -002 (circular, unchanged), -003 (held back, a Query), -004 (text or true/false, a
Query). They are built in `src/utils/recalc-findings.js` for both pipelines.

## Formula Deep Dive completion and report wording (Patch 29)

`src/utils/deepdive-reconcile.js` compares what the Deep Dive sent with what came back. "Reviewed" is now the number of
valid answers (a requested `ufi`, status pass, fail or uncertain, first answer kept); unknown, duplicate and malformed
answers are listed and discarded, and the formulas with no valid answer are shown as Not completed. The reviewer is told
to copy each item's `ufi` into its result. The Formula Risk Review tab gains Review Result and Review Detail columns,
shows up to 1,000 formulas (reviewed first, then highest F-score), and adds a Formula Inventory tab with every unique
formula when that limit is reached. The "grounded in direct formula-text inspection" sentence is replaced by a statement
of what the reviewer was given and what was not validated. `key_output_impact` of No or Unknown no longer adds to the
consequence score. Deferred: on the full-parse route Tier 2 still runs before the Tier 0 finding blocks are assembled.

## Exact formula identity and complete formula text (Patch 30)

`normalizeFormula(formula, address)` in `src/validator-tier0.js` now gives a formula family its exact identity: text
constants and quoted sheet names are set aside first, references become R1C1 offsets from the cell (so a formula filled
across or down is one family), and absolute anchors, different offsets, constants, names and sheets all stay distinct.
Family counts therefore rise (Hidden Gem 476 to 1,686; Carlsberg 171 to 385). A family is a navigation aid, not evidence
that every member was tested.

`src/utils/formula-store.js` keeps the complete text of every formula that Tier 0 shortens for display (over 300
characters). Short formulas are complete in `cellScoreIndex`; long ones are appended to an unlinked temporary file and
only their offsets are held in memory (Hidden Gem: 388 formulas). Read formulas through `fullFormula(cellScoreIndex,
key, info)`; the circular-reference detector, the dependency tracer, the NPV and nested-IF checks, the range checks and
the Formula Deep Dive now do. The 300-character field stays for display. Measured on Hidden Gem on a 2-core 8 GB
sandbox: Tier 0 64.9 s to 67.4 s, peak 1,808 MB to 1,822 MB. The VPS run is still the gate.

## Focused path checks (Patch 31)

Four deterministic checks that read saved values and formula text (no recalculation), run in both pipelines through
`runPathChecks` and shown on a new Path Checks tab with one verdict per tested item (passed, defect, query, control
weakness, not completed).

- **Lookup contract** (`lookup-contract.js`, T0-LOOKUP-001 missing key, high; T0-LOOKUP-002 duplicate key, medium):
  `MATCH(key, array, 0)` with `&` keys and `INDEX(NamedBlock,,col)` parts. The key is built from saved values and the
  source rows that match are counted. A key that is blank, a wildcard, an invalid saved date, a repeated 0, or sits in
  an `IF` branch that may not run is counted Not completed, never judged.
- **Average completeness** (`average-completeness.js`, T0-AVGCOMP-001 high, -002 low): an `AVERAGE` over one row or
  column (direct or `OFFSET`) is compared with the numeric cells it was given; a formula cell returning text is a
  defect, blanks a query, an `IFERROR`/`IFNA` text fallback in a feeder a control weakness. The sensitivity figure is
  arithmetic on saved values.
- **Fallback propagation** (`fallback-propagation.js`, T0-FALLBACK-001 low): `IFERROR(lookup, "text")` families, one
  budgeted pass to classify direct readers as error, omitted, handled or other.
- **Bypassed checks** (`bypassed-checks.js`): for a nested-subtotal finding, names the check cells in the same column
  that cannot reach the cell, and the ones that can.
- Nested-subtotal and double-scaling findings now carry a `quantification` (reported, expected, difference) from saved
  values; a ratio of two scaled figures is separated from a scaled amount.

Each scan is time-boxed and says "stopped after N seconds" when it is. Measured in the sandbox on Hidden Gem: path
checks 5.3 s on top of Tier 0; Bend, Sydney Airport, riio, Carlsberg, Port Melbourne and the ESO model raise no lookup
defects. Acceptance cases 10 to 14 run on synthetic fixtures (`scripts/path-fixtures.js`) because the ESO file is not in
the repository. Not yet done: Bend has 785 lookups Not completed because ExcelJS returns some saved dates as invalid
Date objects; reading the raw serial would recover them.

**Output registry (draft only).** `scripts/propose-output-registry.js <model>` writes
`config/output-registries/<model>.proposed.json` from sheet and row labels. It is `proposed` with `approved_by` and
`approved_on` empty, is not read by the pipeline and holds no report. Approval storage and the verdict ceiling arrive in
Patch 33. Deep Dive selection by consequence waits for the Patch 32 reference service (Tier 0 holds sheet-level links
only). Tier 0 still runs after Tier 2 on the full-parse route.

## One reference reader for the graph checks (Patch 32)

`src/utils/reference-service.js` (JavaScript) and `src/reference_service.py` (Python) read formula references by the same
rules, replacing three separate regular expressions in the dependency tracer, the circular-reference detector and the
recalculation taint tracer. String literals are removed first, so `IF(B1="C99",...)` no longer creates a dependency on
C99 or an invented cycle. A range stays a range: `A1=SUM(A2:A10)` with `A5=A1` is now found as a cycle. Whole-column
and whole-row references, defined names that are plain ranges, and 3-D references (`Jan:Mar!B5`) are expanded or kept
as rectangles. A reference that cannot be located (structured table reference, external workbook, a name that is not a
plain range, a sheet not in the workbook) is counted as an unknown dependency and reported, never dropped quietly.
`ROW`, `COLUMN`, `ROWS` and `COLUMNS` read position only and add no edge, to the closing bracket of the call. A
reference in an `IF`, `IFERROR`, `IFNA`, `CHOOSE`, `IFS` or `SWITCH` branch after the condition is marked conditional.

- **Cycle search** keeps ranges as ranges (a per-column sorted index, lazy three-colour search), so a long row-sum over
  already-finished cells costs almost nothing. Direct cell cycles keep T0-CIRC-001. Cycles that close through a range are a
  new finding, T0-CIRC-003, medium when every link is always evaluated, low when it closes only through a lazily
  evaluated branch. It states what the search could not locate and that it reads formula text only.
- **Key-output chain check** (the dependency tracer) follows the formula cells inside a range instead of the top-left
  cell only. A blank reached through a range is not reported as a dead end; a top-left blank still is. A range is cut
  at 60 cells and the cut is counted. On the real models, flagged dead ends: Carlsberg 3 to 3 (same cells), Sydney Airport
  1 to 1 (same cell), Bend 6 to 5 (G103 is read only as part of a range).
- **Recalculation taint tracer** (Python): ranges over 2,000 cells are kept as rectangles instead of being dropped, so
  taint reaches a SUM over thousands of cells (acceptance case 6: 2,000 and 2,001 cells are both covered). The
  recalculation ledger is unchanged on Carlsberg, Bend, riio and Port Melbourne.
- Acceptance cases 4, 5 and 6 now pass. `test-patch32.js` (66 checks) includes JavaScript/Python agreement on shared
  formulas.

Measured in the sandbox: cycle search on Hidden Gem 10.8 s and 2.4 GB peak, riio 0.3 s, ESO 0.14 s. Carlsberg has
iterative calculation switched on, so its whole-row `AVERAGEIF(...,102:102)` self-references are real references that
Excel accepts only because of that setting. Not changed: the shared reader is not yet used by the checks that read
single-cell references from their own patterns (lookup contract, bypassed checks); that is a later clean-up.

## Remedy check, applicability record, approved priority outputs (Patch 33)

**Remedy check** (`src/utils/remedy-check.js`, runs on all findings just before record types are assigned, in both
pipelines). A suggested fix is checked against the audited file before it is published:
- a cell cited as holding a quoted formula must hold it (`AP242 holds \`=SUM(AP10:AP19)\``). A cell that holds a different
  formula, a constant, or nothing fails. A *proposed* formula ("change it to ...") is never compared with the existing one;
- OFFSET arguments are read by role (reference, rows displacement, columns displacement, height, width). A remedy that
  describes a negative width or height when the negative value is a displacement fails, because a negative displacement
  moves the reference up or left and is valid;
- a remedy whose only action is to wrap the formula in IFERROR/IFNA/ISERROR, or to return 0 on error, fails unless it
  also says to find or correct the cause, restructure with an explicit test, or guard the denominator. "Do not wrap it in
  IFERROR" is not a suppression.
A failed remedy is replaced by a short statement of why it was withheld; the finding is never removed or re-rated, the
original wording is kept in `finding.remedy_check.original`, and `fixable` becomes false. Remedies it cannot evaluate are
left exactly as written and counted "could not be checked". The Scope and Reliance tab shows the counts. All 194
remedy texts hard-coded in the pipelines were scanned; none is withheld.

**Applicability record** (`src/utils/applicability-record.js`, called after the absence policy in `validator-tier2.js`).
An absence the reviewer itself says does not belong in this kind of model ("no debt schedule ... an unlevered model") is
recorded as Not Applicable: it stays in the Issue Log, drops out of the P1-P3 counts and the Remediation tab, and is listed
in the Applicability Record on the Scope and Reliance tab with the reviewer's reason, so a person can overrule it. The
procedure's status is unchanged, so coverage figures do not move. A fatal-severity rule and any statement about the
reviewer's own limits are never set aside this way. A sheet that looks like a macro-refilled store (Saved Results and the
like) in a workbook with a VBA project adds a separate "Freshness not tested" line; the audit reads saved values and does
not run macros.

**Approved priority outputs.** `config/output-registries/<model>.json` is an approved registry only when its status is
`approved` and it names an approver and an ISO approval date. A draft (`.proposed.json`), a file with an empty name or
date, or no file counts as no approval. The model name is the uploaded file name without its extension, lower-cased and
hyphenated, so the registry belongs to a file name. Steps: `node scripts/propose-output-registry.js <model file>`, edit the
list, then `node scripts/approve-output-registry.js <proposed.json> --by "Full Name"` (adds `--on YYYY-MM-DD`, default today;
`--replace` to overwrite), and commit. Effect: the highest reliance tier (Transaction Execution) needs an approved list as
well as reviewer approval; without it the report shows the tier below, says why in the decision box and in a Priority
Outputs panel, and everything else is unchanged. A report is never held.

Acceptance cases 15 and 16 run on synthetic fixtures (`scripts/remedy-fixtures.js`); `test-patch33.js` has 41 checks including
report builds under each registry state. Not done: the remedy check reads cited cells from backtick-quoted formulas only;
the applicability record relies on the reviewer's wording, not on the model's structure; both are noted as the next places
to widen if the first real runs show misses.

## Remedy citations in prose, duplicate Critical Queries (Patch 34)

Found in the ESO run Fm-00053 (all of Patches 27-33 deployed): the remedy check reported "130 could not be checked" because it read only formulas quoted in backticks and no real remedy contains any.

- **Remedy check reads plain-prose cell citations** (`src/utils/remedy-check.js`: `proseCitations`, `valueAgrees`). Cells are found by the workbook's own sheet names, so a sheet called "RoRE ranges" works. Two claims are tested against the saved file: "the formula in X" (X must hold a formula) and "X shows 12.2m" (the saved value must agree, allowing m/k/bn units and rounding). A sheet name not in the workbook is not guessed at. Percentages are not read as values. A remedy that fails is withheld as before, with the original kept in `remedy_check.original`.
- **Real-file result:** of the 77 ESO remedies, one is confirmed and one withheld (T2-S5-004 points at the source formula in `FinancialStatements!AP35`, which is empty; the hard-coded zero is in `AP42`). 75 cite nothing the file can test. The panel now says "cite nothing the file can test" rather than "could not be checked".
- **Duplicate Critical Queries** (`mergeDuplicateCriticalQueries`, called after `assignRecordTypes` in `index.js` and `server.js`): two Critical Queries on the same sheet and cell count once. The higher-confidence one stays; the other becomes a Query with `merged_into` set. Cells that are only the A1 fallback are never merged. Logged as "Critical Queries about the same cell merged".
- Not changed: the Patch 7 rule that a fatal, critical or high-severity absence keeps its Critical Query escalation at low confidence (tested by `test-patch7.js`).

Checks: `node test-patch34.js` (17 checks). Earlier suites unchanged.

## Check independence, volatile run stamps, placeholder rows of zeros (Patch 35)

From the Partner Review of ESO run Fm-00053 (3 genuine misses of 23 independent findings, 13 partly covered).

- **Check independence** (`src/utils/check-independence.js`, part of `runPathChecks`): for each row labelled "Check" whose saved values are zero and whose formula is `A - B`, `A = B`, `ROUND(A-B,n)` or `ABS(A-B)`, the formula cells behind each side are traced. A check is a **Query** (finding `T0-CHECKIND-001`, record type Query, confidence 50) when both sides read exactly the same cells, or when everything behind the smaller side (two or more calculations) is also behind the other. Otherwise it is listed as Passed on the Path Checks tab with how many calculations sit only behind each side and how many behind both, which is the Partner's question put in numbers. It is static: it shows a check could not have failed, not that it can. Walk limit 40,000 cells per side and an 8 s budget; anything over is Not completed.
- **Real files:** on the Bend, `Debt!H128` is `H127-H126` where `H127` is `=H126`, and `Debt!H29` tests current + non-current = closing where non-current is closing minus current; both are checks that cannot fail and are now Queries (3 on the Bend, 1 on Sydney Airport, 2 on ESO, none on Carlsberg, Qantas, Mortgage or Railways). On ESO the main statement checks pass but 99-100% of the calculations behind one side are also behind the other.
- **Volatile run stamp** (`src/utils/volatile-timestamp.js`, `T0-VOLTIME-001`, Observation): a cell that is only `NOW()` or `TODAY()`, with the date it last held. ESO has two (`LiveResults!T17`, `ScenarioRun_AllOutputData!AY28`).
- **Placeholder rows** (`placeholder-text-check.js`): a zero no longer counts as content, so a note followed by zeros (the ESO archive pattern) is flagged. ESO goes from 1 to 46 of 48 placeholder cells; no change on the other models. The finding lists the count by sheet.
- **Not built, on purpose:** a fixed-range INDEX check. ESO's `INDEX($E$368:$E$390, m_ESO_modelscenario)` is a 23-slot drop-down list over 23 scenario columns, not truncated; flagging it would only record a design preference.
- **Timing (sandbox, Hidden Gem 1.15M cells):** independence 1.2 s, volatile stamps 0.8 s, one check not completed (size).

Checks: `node test-patch35.js` (18 checks). `test-patch31.js` now accepts extra Path Checks criteria beyond the original three.

## Text results in date-formatted cells, calculated lookup keys, scope figures, Hidden Gem timings (Patch 36)

From the ESO and Bend runs: lookups the Path Checks tab could not test (5 on ESO, 785 on the Bend), and three scope figures that did not read as one story.

- **The cause was in the Excel reader, not the model.** When a formula returns text ("FY26") in a cell with a date format, exceljs turns the saved text into an Invalid Date at load. The text is gone from the loaded workbook, so any check reading that cell, and the reviewer, saw a blank or a bad date. `src/utils/raw-result-recovery.js` (called from `parseWorkbook`, before the sheet rows are built) finds such formula cells, reads the real value from the sheet XML and puts it back as the cell's saved result. Formulas and styles are not touched. A sheet over 80M characters, or more than 20,000 cells, is skipped and reported. The run log prints "Text results in date-formatted cells: N of N read back from the file".
- **How common it is:** ESO 109 cells, The Bend 87 (earlier Bend files 179 and 2), Railways 300, Mortgage 120, Hidden Gem 99; none on Carlsberg, Qantas or Sydney Airport. Cost 0.1-0.6 s, Hidden Gem 0.6 s.
- **Lookup keys that are small calculations** (`src/utils/key-expression.js`): `YEAR($I$4)-1`, `2000+VALUE(RIGHT(H$6,2))`, with + - * / brackets and YEAR, MONTH, DAY, VALUE, LEFT, RIGHT, MID, LEN. Anything else, text in arithmetic or a blank returns "could not be read"; a wrong value is never produced, and each lookup is also compared with its own saved result, so a mistake shows as a disagreement. A lookup array of `YEAR(range)` is supported the same way. `notCompletedExamples` now keeps up to five examples per reason.
- **Result on The Bend:** lookups tested 106 to 623 of 891, all passed, no false defects. ESO stays at 698 tested; its five `YEAR($I$4)-1` lookups sit in an `IF` branch that is not taken, so they are now correctly "not found inside a conditional branch" rather than "not readable".
- **Scope figures:** the report was already consistent (122 counted = 16 Tier 1 + 106 Tier 2); the run log's 125 is the number of Tier 2 procedures put to the reviewer. The Scope tab's Tier 2 line now says so: "(125 were put to the reviewer; 19 were set aside after the run as not applicable to this model type and are in neither the counts nor the findings)". The figure comes from `scopeSummary.tier2Sent`.
- **Hidden Gem on the VPS (Patch 33 code, measured 30 Oct 2026):** parse 18.4-18.5 s; Tier 0 128.7-133.1 s; path checks 9.9-10.7 s; cycle search 14.9-15.9 s; peak 2,029 MB under the default Node heap, whose limit is 2,096 MB (VPS has 7.4 GB RAM; pm2 sets no memory limit or node args). The margin between heap and RSS was not measured and the full pipeline on Hidden Gem was not timed end to end. Sandbox, Patches 35-36: check independence 1.2 s, volatile stamps 0.8 s, text recovery 0.6 s.

Checks: `node test-patch36.js` (22 checks).

## Queries the file already answers, remedy check on cell lists (Patch 37)

From the ESO run Fm-00054. Its only Critical Query (`T2-S3-005`) asked the person to "confirm that SystemOperator!I165, I653, I694 and I724 are formula references to I78, not independently typed values". The file answers that: rows 165, 653 and 694 hold `=AP78`, `=AQ78` ... and row 724 holds `=AP653`. The finding also named column I, which is empty in all five rows (the values sit in AP:AT). That one question was the main reason the report said "unresolved Critical Query".

- **Query resolver** (`src/utils/query-resolver.js`, run after `assignRecordTypes` and before Critical Query merging in `index.js` and `server.js`). It answers one question shape only: a Tier 2 Query or Critical Query that asks to "confirm" that listed cells are references (links) to another cell. Each cited cell is followed through plain one-cell references (up to 8 hops). If a cited cell is empty, every populated numeric or formula cell in that row is tested instead, against the same column of the target row, and the evidence says so. The answer is positive only if **every** tested cell leads to the target row. Then the record becomes a **False Positive**, the original record type and the evidence are kept (`query_resolution`, `record_type_note`), and the Issue Log row stays. One typed value, one calculation, or a formula whose text is not held leaves the question open and the evidence is added to the note. The run log prints "Query resolver: N answered by the file ...".
- **On ESO:** all 20 populated cells in rows 165, 653, 694 and 724 trace to row 78, so the Critical Query would close (5.6 s including parse and Tier 0 in the sandbox; the resolver itself is milliseconds).
- **Remedy check, cells named in a list** (`cellListCitations` in `remedy-check.js`): a fix that makes a statement about a list of cells ("X, Y and Z are formula references / are typed values") is withheld if any listed cell is empty in the file. A list with no statement about it is not judged.
- **Not changed, deliberately:** absences at A1 that the absence policy converts to a confirmed finding (ESO `T2-S10-014` is a P2 this way). That is the Step 5b design in `config/skill.md`; changing it is a policy decision and is left to the owner. A resolved Critical Query is closed by evidence from the file, not by a person; the framework document says only a person may clear a critical gate, so this is flagged to the owner as a policy question too.

Checks: `node test-patch37.js` (17 checks).

## Narrow fixes after an independent review of Patch 37 (Patch 38)

An independent review of Patch 37 raised seven points about the code; each was reproduced against the real modules before it was changed (all four resolver and merge points, the lookup record type and the swallowed path-check error reproduced; the history point is partly true and is Patch 39).

- **Query resolver follows a fixed destination** (`query-resolver.js`). `follow()` compared the next hop's column with the column of the cell it was currently reading, so `B2 -> C3 -> C1` was accepted as a reference to `B1`. The destination is now fixed per trace: the exact cell for a cell the finding names, and the same column of the target row only for a row that was widened because the cited column is empty (the ESO case). A cited row with no populated cell now stays in the population as a failed test (the query stays open). A finding that asks for something else as well (a second sentence in the fix, or a different problem in its own condition) is **part answered**: the evidence is added, the record is not closed. A reference to a blank is still a valid reference; whether the blank matters is a different test and is not made here.
- **Critical Queries at one cell are grouped, not demoted** (`record-type-classifier.js`). Patch 34 turned the weaker one into a Query. Two rules raising a concern at one cell can be two concerns, so both stay Critical Queries and keep blocking. Each gets `same_location_group`; the weaker one also `grouped_with`. The report counts every blocking record and adds the location count: "2 unresolved Critical Queries (at 1 location)". The log line now reads "grouped for display (all still blocking)".
- **`T0-LOOKUP-002` keeps record type Query** (`path-checks.js`). It was classified as a confirmed P2 because the finding carried no record type.
- **A path check that fails is reported as not completed** (`path-checks.js`, `build_report.py`). The error was dropped, so the tab showed "0 tested" or no tab at all. The summary now carries the error; the Path Checks tab says NOT COMPLETED with the reason; the Scope tab's Work Not Performed lists it as a gap. The verdict is not changed by this alone: a failed check limits what was tested, not every use of the model.
- **Still to do (not in this patch):** history wording and storage (disappearance is "not observed", never "resolved"; idempotent and out-of-order safe), the evidence-backed run record that replaces `reviewerApproved`, registry validation, run provenance for `soul.md`, `finding-class.json` and `rule-tiering.json`, one `effective_priority`, and decision-threshold tests in recalculation. Owner decision recorded: no compulsory human sign-off; the system issues its own assessment, qualified where evidence is incomplete.

Checks: `node test-patch38.js` (17 checks, including report builds). `test-patch34.js` now expects grouping instead of demotion.

## History: "not observed" is not "resolved"; one run recorded once (Patch 39)

From the independent review of Patch 37 (point 3), reproduced against `finding-history.js` and its two call sites before the change.

- **Vocabulary** (`finding-history.js`, `STATUS`). A finding present before and absent now is stored as `not_observed` (it was `closed`). The report already said "not found in this run; it is not evidence that it was fixed"; the store now agrees. A finding that is found again after being not observed has **reappeared** (the report says "reappeared" and the tile is REAPPEARED; it said regressed). Three more statuses exist and are never set automatically: `verified_resolved`, `disproven`, `verification_unavailable`. `markVerification()` sets them and refuses without evidence (method, detail, checkedAt). Nothing calls it yet; a retest component will.
- **Old files.** A `closed` entry is read as `not_observed` with `legacyClosed: true`. It is never promoted to verified. The file is rewritten as version 2 on the next run; version 1 files still load.
- **One run, recorded once** (`recordRun`). `server.js` passes the order id (`runId`, already in `/api/validate`) and the time the analysis began; `index.js` generates a run id per command-line run. A retry of the run recorded last (a failed report build or e-mail that is run again) is compared with the baseline as it was before that run and **replaces** it, so "new" does not turn into "still open". A retry of an earlier run changes nothing.
- **Out-of-order runs.** A run that started before the recorded baseline and finishes later is compared with the newer baseline and does not overwrite it; the report's Audit Output says so ("Note on history"). With four workers this can happen for real.
- **Locking and atomic writes.** The read, compare and write are under a lock file (waits up to 5 s; a lock older than 60 s is cleared; `FM_HISTORY_LOCK_WAIT_MS` shortens the wait for tests). If the lock cannot be taken the run still gets its comparison, history is not written, and the note says so. The file is replaced by rename, so a crash cannot leave half a file.
- **Size.** The previous baseline is kept inside the file to make a retry exact; if it exceeds 3 MB it is dropped and a retry then compares with the run already recorded.
- **No new AI calls and no extra cost.** Timing is a file read and write.

Checks: `node test-patch39.js` (20 checks, including six simultaneous workers and a report build). Existing history suites pass; `test-crossrun-llm-split.js` now expects "reappeared".

## Patch 40 - evidence-backed run record replaces the reviewer flag

- **No compulsory human sign-off.** `reviewerApproved` is gone. Each run builds an assessment record (`src/utils/run-record.js`, written beside the report as `<report>.runrecord.json`). It binds the workbook hash, code commit, rule-set hash, config file hashes and priority-output list hash to the evidence: independent recalculation (completed, mismatches, coverage of at least 90%), path checks (any that failed to complete), review batches, and the priority-output list.
- **The top tier follows the evidence.** "Reliance-ready - transaction execution" is issued only when the record has no gaps. Each gap is printed on the Scope and Reliance tab (new ASSESSMENT RECORD panel) and in the decision text. A record that could not be built caps the tier. A payload with no `runRecord` key behaves as before. No report is held; only the top tier moves.
- **Priority-output list.** `loadRegistryState` validates each definition (sheet, row or cell, label), rejects an empty list and duplicates, and returns the definitions and file hash. `checkRegistryAgainstWorkbook` checks each output exists in this workbook; an approval that no longer matches the file does not carry over.
- **Provenance** now covers soul.md, finding-class.json, rule-tiering.json, chunking.json and the rule-history seeds, so changing any of them changes the rule-set hash and the record fingerprint.
- No extra model calls, so run price is unchanged.
- Rollback: `git revert` the commit; no data migration.
- Check: `node test-patch40.js`
