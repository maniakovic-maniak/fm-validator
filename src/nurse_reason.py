#!/usr/bin/env python3
"""
nurse_reason.py — weekly "reason" step of the nurse pipeline.

Run on a schedule (cron, on the admin process - internal ops, isolated from
the customer-facing cluster), not per-run. Reads every data/nurse-logs/*.json
record ever written (full history, not just the last 7 days - this regenerates
the full current-state picture each time, the same stateless-recompute pattern
already used elsewhere in this pipeline, e.g. the retention sweep), and groups
uncertain-item candidates along the two dimensions agreed with Mik:

  cross_model  - same rule ID + same domain skill file, recurring across
                 DIFFERENT models -> the strongest signal that a rule or its
                 skill-file instruction is genuinely broken, independent of
                 any one client's file
  within_model - same model (matched by a best-effort filename-stem heuristic,
                 see nurse_gather.derive_model_key - NOT a guaranteed match),
                 recurring across REPEATED runs -> either a persistently
                 unresolved gap in that specific model, or a rule that simply
                 cannot be answered for that model's sub-type

Both are ranked by recurrence count, highest first. Nothing is gated on a
minimum recurrence to appear - everything shows, ranked - so a genuine
one-off is never silently dropped; recurrence is a priority signal, not an
inclusion filter (this was an open design question; this is the default
chosen absent a stricter instruction - reconfigurable if wanted).

ALWAYS writes a dated report file, even when nothing recurs and the report is
empty of findings - an empty week is a real result, not distinguishable from
"the job didn't run" unless something is written either way.
"""
import sys
import json
import argparse
from pathlib import Path
from collections import defaultdict
from datetime import datetime, timezone

# Categories worth pattern-hunting. 'uncategorized' is deliberately excluded from
# both dimensions below: it means no detector exists yet for whatever's in there
# (a mix of B2/C1/C2/D), so grouping it would produce noise, not signal, until
# those detectors exist. a_candidate and b1_* have real, specific meaning today.
TRACKED_CATEGORIES = {'a_candidate', 'b1_strong', 'b1_weak'}


def load_all_logs(logs_dir):
    logs = []
    for p in sorted(Path(logs_dir).glob('*.json')):
        try:
            logs.append(json.loads(p.read_text(encoding='utf-8')))
        except Exception as e:
            print(f"   \u26a0\ufe0f  Skipping unreadable nurse log {p.name}: {e}", file=sys.stderr)
    return logs


def build_report(logs):
    cross_model = defaultdict(lambda: {'occurrences': [], 'sample_finding': None})
    within_model = defaultdict(lambda: {'occurrences': [], 'sample_finding': None})

    for log in logs:
        run_id = log.get('runId')
        model_key = log.get('modelKey', 'unknown')
        domain_file = log.get('domainFile')
        for f in log.get('uncertainFindings', []):
            if f.get('category') not in TRACKED_CATEGORIES:
                continue
            rule_id = f.get('rule_id')

            ck = (domain_file, rule_id)
            entry = cross_model[ck]
            entry['occurrences'].append({'runId': run_id, 'modelKey': model_key, 'category': f.get('category')})
            if entry['sample_finding'] is None:
                entry['sample_finding'] = f.get('finding')

            wk = (model_key, rule_id)
            wentry = within_model[wk]
            wentry['occurrences'].append({'runId': run_id, 'category': f.get('category')})
            if wentry['sample_finding'] is None:
                wentry['sample_finding'] = f.get('finding')

    def finalize(groups, key_names, distinct_dimension=None):
        """distinct_dimension: if given, requires at least 2 DISTINCT values of
        that occurrence field (not just 2 distinct runs) to qualify - this is
        what actually distinguishes "recurs across different models" from
        "recurs across repeated runs of the same model": 4 runs of one model
        is real within-model recurrence but must NOT also count as cross-model
        recurrence just because there happen to be 4 runIds."""
        out = []
        for key, entry in groups.items():
            distinct_runs = {o['runId'] for o in entry['occurrences']}
            if len(distinct_runs) < 2:
                continue  # by definition, "recurring" needs at least 2 distinct runs
            if distinct_dimension:
                distinct_vals = {o[distinct_dimension] for o in entry['occurrences']}
                if len(distinct_vals) < 2:
                    continue
            row = dict(zip(key_names, key))
            row['recurrenceCount'] = len(distinct_runs)
            row['runIds'] = sorted(distinct_runs)
            row['sampleFinding'] = entry['sample_finding']
            row['categoriesSeen'] = sorted({o['category'] for o in entry['occurrences']})
            out.append(row)
        out.sort(key=lambda r: -r['recurrenceCount'])
        return out

    cross_model_out = finalize(cross_model, ['domainFile', 'ruleId'], distinct_dimension='modelKey')
    within_model_out = finalize(within_model, ['modelKey', 'ruleId'])

    held_runs = [{'runId': l.get('runId'), 'originalName': l.get('originalName'), 'heldReason': l.get('heldReason')}
                 for l in logs if l.get('held')]

    return {
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'runsAnalyzed': len(logs),
        'distinctModels': len({l.get('modelKey') for l in logs}),
        'currentlyHeldRuns': held_runs,
        'crossModelPatterns': cross_model_out,
        'withinModelPatterns': within_model_out,
        'note': "'uncategorized' findings are excluded from pattern-grouping above - no detector exists yet for that bucket (a mix of B2/C1/C2/D)."
    }


def run(logs_dir=None, out_dir=None):
    logs_dir = Path(logs_dir) if logs_dir else (Path(__file__).parent.parent / 'data' / 'nurse-logs')
    out_dir = Path(out_dir) if out_dir else (Path(__file__).parent.parent / 'data' / 'nurse-reports')
    out_dir.mkdir(parents=True, exist_ok=True)

    logs = load_all_logs(logs_dir)
    report = build_report(logs)

    stamp = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    out_path = out_dir / f'{stamp}.json'
    out_path.write_text(json.dumps(report, indent=2), encoding='utf-8')

    latest_path = out_dir / 'latest.json'
    latest_path.write_text(json.dumps(report, indent=2), encoding='utf-8')

    return report, out_path


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--logs-dir', default=None)
    ap.add_argument('--out-dir', default=None)
    args = ap.parse_args()

    report, out_path = run(args.logs_dir, args.out_dir)
    print(json.dumps({
        'ok': True, 'outPath': str(out_path),
        'runsAnalyzed': report['runsAnalyzed'],
        'crossModelPatterns': len(report['crossModelPatterns']),
        'withinModelPatterns': len(report['withinModelPatterns']),
        'currentlyHeld': len(report['currentlyHeldRuns']),
    }))
