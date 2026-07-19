#!/usr/bin/env python3
"""
Scale benchmark for the rewritten masking BFS — simulates Hidden Gem's
actual real-world numbers (not a small synthetic case) to measure real
wall-clock time BEFORE handing the fix back, given the last version of
this fix ran for 8+ hours in production before being interrupted.

Target scale, matching the real Hidden Gem run's own numbers:
  - 1,152,789 target cells
  - 264,055 unresolved_errors (the root_seeds size that caused the
    catastrophic slowdown in the previous version)
  - A mix of short reference chains and some deep ones, and a realistic
    branching factor (most cells referenced by a handful of others).
"""

import random
import re
import string
import sys
import time

sys.path.insert(0, 'src')
import importlib.util
spec = importlib.util.spec_from_file_location("recalc_check", "src/recalc_check.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
_extract_refs = mod._extract_refs

random.seed(1234)

N_TARGETS = 1_152_789
N_UNRESOLVED = 264_055
SHEET = "Sheet1"

print(f"Building synthetic scenario: {N_TARGETS:,} target cells, "
      f"{N_UNRESOLVED:,} unresolved_errors...")
t0 = time.time()

# Build a chain-like dependency structure: cell N often references a
# handful of earlier cells (N-1, N-2, ...), similar to how a real model's
# formulas mostly reference nearby/earlier cells, with some randomness.
target_keys = [f"{SHEET}!A{i}" for i in range(1, N_TARGETS + 1)]
formula_texts = {}
for i in range(1, N_TARGETS + 1):
    key = f"{SHEET}!A{i}"
    if i == 1:
        formula_texts[key] = "=1"
        continue
    n_refs = random.choice([1, 1, 1, 2, 2, 3])
    refs = []
    for _ in range(n_refs):
        back = random.randint(1, min(5, i - 1))
        refs.append(f"A{i - back}")
    formula_texts[key] = "=" + "+".join(refs)

unresolved_errors = []
sample_indices = random.sample(range(1, N_TARGETS + 1), N_UNRESOLVED)
for i in sample_indices:
    unresolved_errors.append({"sheet": SHEET, "cell": f"A{i}"})

external_ref_cells = set()

# A handful of real mismatches scattered through the range.
mismatches = []
for i in random.sample(range(1, N_TARGETS + 1), 50):
    mismatches.append({"sheet": SHEET, "cell": f"A{i}", "cached": 1.0, "recalculated": 0.0, "diff": -1.0})

print(f"  scenario built ({round(time.time()-t0,1)}s).")

# ---- Run the actual current algorithm from recalc_check.py's masking BFS ----
print("\nRunning the CURRENT reverse-index BFS algorithm...")
t1 = time.time()

IFERROR_IFNA_RE = re.compile(r'\bIFERROR\s*\(|\bIFNA\s*\(', re.IGNORECASE)
mismatch_keys = {f"{m['sheet']}!{m['cell']}" for m in mismatches}
formula_by_key = formula_texts
root_seeds = set(external_ref_cells) | {f"{e['sheet']}!{e['cell']}" for e in unresolved_errors}

t_parse = time.time()
refs_by_key = {}
for key in target_keys:
    formula = formula_by_key.get(key)
    if formula:
        refs_by_key[key] = _extract_refs(formula, key.split('!', 1)[0])
print(f"  reference parsing: {round(time.time()-t_parse,1)}s")

t_index = time.time()
dependents_of = {}
for key, refs in refs_by_key.items():
    for (rsheet, rcol, rrow) in refs:
        dependents_of.setdefault(f"{rsheet}!{rcol}{rrow}", []).append(key)
print(f"  reverse index build: {round(time.time()-t_index,1)}s ({len(dependents_of):,} referenced cells)")

t_seed = time.time()
tainted_by_error = set()
for key in target_keys:
    formula = formula_by_key.get(key)
    if not formula:
        continue
    if IFERROR_IFNA_RE.search(formula):
        tainted_by_error.add(key)
        continue
    refs = refs_by_key.get(key, ())
    if any(f"{rsheet}!{rcol}{rrow}" in root_seeds for (rsheet, rcol, rrow) in refs):
        tainted_by_error.add(key)
print(f"  initial seeding: {round(time.time()-t_seed,1)}s ({len(tainted_by_error):,} tainted)")

t_waves = time.time()
frontier = set(tainted_by_error)
wave_count = 0
for _wave in range(30):
    newly_tainted = set()
    for tkey in frontier:
        for dep_key in dependents_of.get(tkey, ()):
            if dep_key not in tainted_by_error:
                newly_tainted.add(dep_key)
    wave_count += 1
    if not newly_tainted:
        break
    tainted_by_error |= newly_tainted
    frontier = newly_tainted
print(f"  wave propagation: {round(time.time()-t_waves,1)}s ({wave_count} waves, {len(tainted_by_error):,} total tainted)")

total = time.time() - t1
print(f"\nTOTAL masking BFS time: {round(total,1)}s ({round(total/60,2)} minutes)")

if total > 600:
    print("\n*** STILL TOO SLOW (>10 min) — DO NOT SHIP. Needs further investigation. ***")
    sys.exit(1)
else:
    print(f"\nOK — completes in well under the ~600s (~10min) the whole original pipeline used to take.")
