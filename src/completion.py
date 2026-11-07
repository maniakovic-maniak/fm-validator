"""
completion.py - the Python twin of computeCompletion() in src/utils/rule-scope.js.

build_report.py calls this for every completion figure it prints, so the dashboard tile, the verdict
sentence, the Scope and Reliance panel and the Validation Matrix cards can no longer drift apart.
scripts/test-scope-sync.js runs both implementations over the same fixtures and fails if they differ.

A rule's status is derived exactly as the Validation Matrix derives it:
  no result returned                       -> Not Performed
  any result 'fail'                        -> Raised Issue
  any result uncertain                     -> Uncertain
  any result with an unsupported status    -> Not Performed (outcome unknown; Patch 53)
  otherwise                                -> Pass
Completion = (Pass + Raised Issue) / planned. Uncertain and Not Performed count as not concluded.
"""

FCH = {'fatal', 'critical', 'high'}
WEIGHTS = {'fatal': 5, 'critical': 4, 'high': 3}


def _pct(n, d):
    # floor(x + 0.5): rounds halves up, like JavaScript's Math.round (Python's round() rounds halves to even)
    return int((n / d) * 100 + 0.5) if d > 0 else 0


def _matches(rule_id, result_id):
    result_id = result_id or ''
    return result_id == rule_id or result_id.startswith(rule_id + '-')


# Patch 53 (D0): the only supported result statuses. A result with any other status (error, not_run, null,
# an unknown value) means the procedure's outcome is unknown: it is NOT concluded and must not count as a finding.
VALID_STATUSES = ('pass', 'fail', 'uncertain')


def rule_status(rule_id, rule_results):
    res = [r for r in rule_results if _matches(rule_id, r.get('id', ''))]
    if not res:
        return 'Not Performed'
    if any(r.get('status') == 'fail' for r in res):        # a completed procedure that found a defect stays concluded
        return 'Raised Issue'
    if any(r.get('status') == 'uncertain' for r in res):
        return 'Uncertain'
    if any(r.get('status') not in VALID_STATUSES for r in res):
        return 'Not Performed'                              # unknown outcome: incomplete evidence
    return 'Pass'


def compute_completion(planned_rules, rule_results):
    c = {'planned': len(planned_rules), 'pass': 0, 'issue': 0, 'uncertain': 0, 'notRun': 0,
         'fch': {'planned': 0, 'concluded': 0}, 'weighted': {'total': 0, 'concluded': 0}}
    status_by_id = {}
    for rule in planned_rules:
        st = rule_status(rule.get('id', ''), rule_results)
        status_by_id[rule.get('id', '')] = st
        sev = rule.get('severity')
        w = WEIGHTS.get(sev, 1)
        done = st in ('Pass', 'Raised Issue')
        if st == 'Pass': c['pass'] += 1
        elif st == 'Raised Issue': c['issue'] += 1
        elif st == 'Uncertain': c['uncertain'] += 1
        else: c['notRun'] += 1
        c['weighted']['total'] += w
        if done: c['weighted']['concluded'] += w
        if sev in FCH:
            c['fch']['planned'] += 1
            if done: c['fch']['concluded'] += 1
    c['concludedPct'] = _pct(c['pass'] + c['issue'], c['planned'])
    c['fchPct'] = _pct(c['fch']['concluded'], c['fch']['planned'])
    c['weightedPct'] = _pct(c['weighted']['concluded'], c['weighted']['total'])
    return {'counts': c, 'statusById': status_by_id}
