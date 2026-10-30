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
