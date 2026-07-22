# Direct test of the "Since last run" dashboard text logic added to
# build_report.py -- replicates the real computation to verify it
# produces sensible, honest output across the key scenarios without
# needing the full workbook-building context.

def compute_crn_text(crossRunStats):
    _crn_closed = len(crossRunStats.get('closed', []))
    _crn_new = len(crossRunStats.get('new', []))
    _crn_regressed = len(crossRunStats.get('regressed', []))
    _crn_still_open = len(crossRunStats.get('stillOpen', []))
    _is_first_run = (_crn_closed == 0 and _crn_regressed == 0 and _crn_still_open == 0 and _crn_new > 0)
    if _is_first_run:
        return f'First run for this model — no prior report to compare against ({_crn_new} finding(s) established as the baseline).'
    else:
        text = f'{_crn_closed} closed · {_crn_new} new · {_crn_still_open} still open since the last run'
        if _crn_regressed > 0:
            text += f' · \u26a0 {_crn_regressed} regressed (previously closed, now reappeared)'
        return text

all_pass = True

# First run: only "new" populated, nothing else
text1 = compute_crn_text({'closed': [], 'new': [1,2,3], 'regressed': [], 'stillOpen': []})
print('First run:', text1)
assert 'First run for this model' in text1 and '3 finding(s)' in text1
print('PASS: first-run case correctly distinguished from "0 changes"\n')

# Normal second run: some closed, some new, some still open, no regressions
text2 = compute_crn_text({'closed': [1,2], 'new': [3], 'regressed': [], 'stillOpen': [4,5]})
print('Normal run:', text2)
assert '2 closed' in text2 and '1 new' in text2 and '2 still open' in text2 and 'regressed' not in text2
print('PASS: normal run shows all three counts, no false regression mention\n')

# Run with a genuine regression
text3 = compute_crn_text({'closed': [], 'new': [], 'regressed': [1], 'stillOpen': [2,3]})
print('Run with regression:', text3)
assert '1 regressed' in text3 and 'previously closed, now reappeared' in text3
print('PASS: regression case correctly flagged with explanation\n')

# Edge case: everything genuinely fixed, zero findings remain
text4 = compute_crn_text({'closed': [1,2,3], 'new': [], 'regressed': [], 'stillOpen': []})
print('Everything fixed:', text4)
assert '3 closed' in text4 and '0 new' in text4 and '0 still open' in text4
print('PASS: fully-clean run displays correctly, not mistaken for a first run\n')

print('ALL TESTS PASSED')
