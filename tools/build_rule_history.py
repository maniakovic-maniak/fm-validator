#!/usr/bin/env python3
"""Seed config/rule-history-seed/<domain>.json from processed audit reports (Validation Matrix tab).
The running pipeline then keeps its own copy in data/rule-history/<domain>.json (gitignored), updated after every run.
Usage: python3 build_rule_history.py <domain> <out.json> <report1.xlsx> [report2.xlsx ...]
Only rule id and status are read - no client data is stored."""
import sys, json, openpyxl, datetime
domain, out, reports = sys.argv[1], sys.argv[2], sys.argv[3:]
CONC = ('Pass', 'Raised Issue')
rules, runs = {}, 0
for f in reports:
    wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
    rows = list(wb['Validation Matrix'].iter_rows(values_only=True))
    h = next(i for i, r in enumerate(rows) if r and 'Rule ID' in r)
    hd = list(rows[h]); ri, si = hd.index('Rule ID'), hd.index('Status')
    runs += 1
    for r in rows[h + 1:]:
        rid, st = r[ri], r[si]
        if not rid: continue
        e = rules.setdefault(rid, {'runs': 0, 'concluded': 0, 'last': None})
        if st == 'Not Performed':
            continue  # skipped by the reviewer: says nothing about whether the rule can conclude
        e['runs'] += 1
        e['concluded'] += 1 if st in CONC else 0
        e['last'] = st
json.dump({'domain': domain, 'runs': runs, 'updated': datetime.date.today().isoformat(), 'rules': rules},
          open(out, 'w'), indent=1, sort_keys=True)
print(f'{domain}: {runs} runs, {len(rules)} rules -> {out}')
