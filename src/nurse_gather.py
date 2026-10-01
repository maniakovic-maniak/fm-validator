#!/usr/bin/env python3
"""
nurse_gather.py — per-run "gather" step of the nurse pipeline.

Called once, automatically, right after a report finishes building (invoked from
server.js via execFile, same pattern as recalc_check.py). Reads the just-built
report's own Validation Matrix + Issue Log (the exact source of truth the client
sees - never a second, parallel representation that could drift from it), tags
each uncertain finding with whatever category logic currently exists (B1/A today;
B2/C1/D will slot in here once their detectors are built), and merges in the
run's rule-exclusion decisions and hold status (both already computed elsewhere
in the pipeline) into one combined per-run record.

Writes data/nurse-logs/<runId>.json. ALWAYS writes something, even when there is
nothing to report, so an empty file is visible evidence the job ran - not
indistinguishable from the job never having run at all.

This step must never be allowed to break report delivery to the client - any
failure here is caught and logged by the caller (server.js), not surfaced to
the user.
"""
import sys
import re
import csv
import json
import argparse
from pathlib import Path
from datetime import datetime, timezone

try:
    import openpyxl
except ImportError:
    sys.exit("Requires openpyxl: pip3 install openpyxl")

BLANKISH = {None, '', 'A1', 'n/a', 'N/A', '\u2014', '-'}
def is_real_location(v):
    return v is not None and str(v).strip() not in BLANKISH

ABSENCE_START_RE = re.compile(r'^\s*(no |there (is|are) no |none of |not applicable|n/a)', re.I)
ABSENCE_EARLY_RE = re.compile(
    r'\b(contains?|has|have|includes?|shows?|holds?|exists?)\s+(any\s+)?no\b'
    r'|\bnone of\b'
    r'|\bno\b[^.;]{0,80}\b(exist|exists|appear|appears|present|found|visible|content)\b', re.I)

def is_absence_finding(text):
    t = str(text or '')
    if not t.strip():
        return False
    return bool(ABSENCE_START_RE.search(t) or ABSENCE_EARLY_RE.search(t[:220]))

def categorize_uncertain(report_path):
    """Returns (list of {rule_id, category, sheet, cell, finding}, total_uncertain_count)."""
    wb = openpyxl.load_workbook(report_path, read_only=True, data_only=True)
    if 'Validation Matrix' not in wb.sheetnames or 'Issue Log' not in wb.sheetnames:
        raise ValueError(f"Expected tabs 'Validation Matrix' and 'Issue Log' not found in {report_path}")

    vm_rows = [r for r in wb['Validation Matrix'].iter_rows(values_only=True) if r and r[1]]
    uncertain_ids = {r[1] for r in vm_rows if r[5] == 'Uncertain'}

    il_all = [r for r in wb['Issue Log'].iter_rows(values_only=True)]
    hdr_i = next(i for i, r in enumerate(il_all) if r and 'ID' in [str(v) for v in r if v])
    cols = [str(v) for v in il_all[hdr_i]]
    idx = {name: cols.index(name) for name in ('ID', 'Sheet', 'Cell', 'Finding') if name in cols}
    missing = {'ID', 'Sheet', 'Cell', 'Finding'} - idx.keys()
    if missing:
        raise ValueError(f"Issue Log is missing expected column(s): {missing}")

    rows_out = []
    seen_ids = set()
    for r in il_all[hdr_i + 1:]:
        if not r or not r[idx['ID']] or r[idx['ID']] not in uncertain_ids:
            continue
        rid = r[idx['ID']]
        sheet = r[idx['Sheet']]
        cell = r[idx['Cell']]
        finding = r[idx['Finding']]
        seen_ids.add(rid)

        if sheet == 'A1':
            cat = 'a_candidate'
        elif is_real_location(sheet) and is_real_location(cell):
            cat = 'b1_strong'
        elif is_real_location(sheet) and not is_absence_finding(finding):
            cat = 'b1_weak'
        else:
            cat = 'uncategorized'

        rows_out.append({
            'rule_id': rid, 'category': cat,
            'sheet': sheet or '', 'cell': cell or '',
            'finding': str(finding or '').replace('\n', ' ').strip()[:400],
        })

    for rid in uncertain_ids - seen_ids:
        rows_out.append({'rule_id': rid, 'category': 'uncategorized', 'sheet': '', 'cell': '', 'finding': '(no Issue Log row found for this ID)'})

    return rows_out, len(uncertain_ids)


def derive_model_key(original_name):
    """Best-effort stable identity for 'the same model resubmitted' - strips a
    trailing numeric timestamp/id suffix from the filename stem. This is a
    heuristic, not a guaranteed match: a genuinely renamed file breaks it, and
    two different models that happen to share a name before their suffix would
    incorrectly collide. Good enough as a first pass; revisit if it misfires."""
    stem = Path(str(original_name or 'unknown')).stem
    return re.sub(r'[-_]\d{6,}$', '', stem) or stem


def gather(report_path, run_id, original_name, domain_file=None,
           rule_exclusion_record=None, held=False, held_reason=None,
           out_dir=None):
    report_path = Path(report_path)
    findings, total_uncertain = categorize_uncertain(report_path)

    record = {
        'runId': run_id,
        'originalName': original_name,
        'modelKey': derive_model_key(original_name),
        'domainFile': domain_file,
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'held': bool(held),
        'heldReason': held_reason,
        'uncertainTotal': total_uncertain,
        'uncertainByCategory': {},
        'uncertainFindings': findings,
        'ruleExclusions': rule_exclusion_record or None,
    }
    for f in findings:
        record['uncertainByCategory'][f['category']] = record['uncertainByCategory'].get(f['category'], 0) + 1

    out_dir = Path(out_dir) if out_dir else (Path(__file__).parent.parent / 'data' / 'nurse-logs')
    out_dir.mkdir(parents=True, exist_ok=True)
    safe_run_id = re.sub(r'[^A-Za-z0-9_-]', '_', str(run_id))
    out_path = out_dir / f'{safe_run_id}.json'
    out_path.write_text(json.dumps(record, indent=2), encoding='utf-8')
    return record, out_path


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('report', help='Path to the just-built processed report .xlsx')
    ap.add_argument('--run-id', required=True)
    ap.add_argument('--original-name', required=True)
    ap.add_argument('--domain-file', default=None)
    ap.add_argument('--rule-exclusion-record', default=None, help='Path to this run\'s data/rule-exclusions/<run>.json, if one exists')
    ap.add_argument('--held', action='store_true')
    ap.add_argument('--held-reason', default=None)
    ap.add_argument('--out-dir', default=None)
    args = ap.parse_args()

    rer = None
    if args.rule_exclusion_record and Path(args.rule_exclusion_record).exists():
        rer = json.loads(Path(args.rule_exclusion_record).read_text(encoding='utf-8'))

    record, out_path = gather(args.report, args.run_id, args.original_name, args.domain_file,
                               rer, args.held, args.held_reason, args.out_dir)
    print(json.dumps({'ok': True, 'outPath': str(out_path), 'uncertainTotal': record['uncertainTotal'],
                       'byCategory': record['uncertainByCategory']}))
