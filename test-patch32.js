'use strict';
// Patch 32 checks: shared reference service (tokenizer, range-aware graph), cycle detector, tracer, Python mirror.
const path = require('path');
const { spawnSync } = require('child_process');
const rs = require('./src/utils/reference-service');
const circ = require('./src/utils/circular-reference-detector');
const tracer = require('./src/utils/cell-dependency-tracer');
let fails = 0;
const check = (n, ok) => { console.log((ok ? 'PASS: ' : 'FAIL: ') + n); if (!ok) fails++; };

const ctxOf = (sheets, names) => { const c = rs.makeContext(sheets, names); c.sheetOrder = sheets; return c; };
const SH = ['S', 'T', 'Other Sheet', 'Jan', 'Feb', 'Mar'];
const show = (f, names) => rs.tokenizeReferences(f, 'S', ctxOf(SH, names));
const cells = (f, names) => show(f, names).refs.map(r => `${r.sheet}!${rs.colName(r.c1)}${r.r1}${(r.c1 !== r.c2 || r.r1 !== r.r2) ? ':' + rs.colName(r.c2) + r.r2 : ''}`);

// cycle helper: formulas keyed "Sheet!A1" -> text
const idx = o => { const x = {}; for (const [k, v] of Object.entries(o)) x[k] = { formulaText: v }; return x; };
const cyc = (o, sheets = ['S', 'T', 'Other Sheet'], names) => circ.findCycles(circ.buildDependencyGraph(idx(o), sheets, { names }));

// ---------------------------------------------------------------- tokenizer
check('a quoted literal is not a reference', JSON.stringify(cells('IF(B1="C99",D1,0)')) === '["S!B1","S!D1"]');
check('doubled quotes inside text are one literal', JSON.stringify(cells('"say ""A1"" now"&B2')) === '["S!B2"]');
check('a quoted sheet name is read, a quoted literal that looks like a sheet reference is not', JSON.stringify(cells("'Other Sheet'!A1+\"T!B2\"")) === '["Other Sheet!A1"]');
check('a range is kept as a range, not its top-left cell', JSON.stringify(cells('SUM(A2:A10)')) === '["S!A2:A10"]');
check('a reversed range is normalised', JSON.stringify(cells('SUM(C5:A1)')) === '["S!A1:C5"]');
check('a whole column and a whole row are ranges to the edge', (() => { const r = show('SUM(A:A)+SUM(3:5)').refs; return r[0].kind === 'column' && r[0].r2 === rs.MAX_ROW && r[1].kind === 'row' && r[1].c2 === rs.MAX_COL; })());
check('a defined name resolves to its range', JSON.stringify(cells('SUM(Rate)', { RATE: { sheet: 'T', c1: 2, r1: 3, c2: 2, r2: 9 } })) === '["T!B3:B9"]');
check('a name that cannot be resolved is recorded, not dropped', show('Unknown_Name*2').unknown.length === 1 && show('Unknown_Name*2').unknown[0].kind === 'name');
check('a name with a question mark is one name', show('IF(Perm_Debt?,1,2)').unknown[0].text === 'Perm_Debt?');
check('ROW COLUMN ROWS COLUMNS arguments are position-only', (() => { const r = show('ROW(A5)+COLUMNS(B1:D1)+E1').refs; return r[0].positionOnly && r[1].positionOnly && !r[2].positionOnly; })());
check('a nested call inside ROW stays position-only to its closing bracket', (() => { const r = show('ROW(INDEX(A1:A9,2))+B1').refs; return r[0].positionOnly && !r[1].positionOnly && r.length === 2; })());
check('3-D reference expands across the sheets between the tabs', JSON.stringify(cells('SUM(Jan:Mar!B5)')) === '["Jan!B5","Feb!B5","Mar!B5"]');
check('external workbook reference is recorded as unknown', show("'[1]Sheet'!A1+[2]X!B2").unknown.length === 2 && show("'[1]Sheet'!A1").refs.length === 0);
check('structured table reference is recorded as unknown', show('Table1[Col]+A1').unknown[0].kind === 'structured' && show('Table1[Col]+A1').refs.length === 1);
check('a #REF! target is recorded as a deleted reference', show('Other!#REF!+T!#REF!').unknown.length >= 1 && show("T!#REF!").unknown[0].kind === 'deleted reference');
check('a sheet that is not in the workbook is recorded', show('Missing!A1').unknown[0].kind === 'sheet not in workbook');
check('a function name that looks like a cell is a function', show('LOG10(A1)').refs.length === 1 && cells('LOG10(A1)')[0] === 'S!A1');
check('numbers with exponents are not references', JSON.stringify(cells('1E5+2.5E+3+A1')) === '["S!A1"]');
check('a range ending in a computed cell keeps its near end and the function arguments', JSON.stringify(cells('$B2:INDEX($B2:$F2,1,3)')) === '["S!B2","S!B2:F2"]');
check('absolute markers do not change the cell', JSON.stringify(cells('$A$1+A1')) === '["S!A1","S!A1"]');
check('TRUE and FALSE are not names', show('IF(TRUE,A1,FALSE)').unknown.length === 0);
check('conditional flag: IF condition is always evaluated, branches are not', (() => { const r = show('IF(A1>0,B1,C1)').refs; return !r[0].conditional && r[1].conditional && r[2].conditional; })());
check('conditional flag: IFERROR value is always evaluated, fallback is not; AND evaluates everything', (() => { const a = show('IFERROR(A1,B1)').refs, b = show('AND(A1,B1)').refs; return !a[0].conditional && a[1].conditional && !b[0].conditional && !b[1].conditional; })());
check('conditional flag: a reference nested inside a branch stays conditional, one after it does not', (() => { const r = show('IF(X1,SUM(B1,C1),0)+D1').refs; return r[1].conditional && r[2].conditional && !r[3].conditional; })());

// ---------------------------------------------------------------- cycles: genuine vs false, in pairs
const c4 = cyc({ 'S!A1': 'SUM(A2:A10)', 'S!A5': 'A1' });
check('GENUINE: A1=SUM(A2:A10), A5=A1 is a cycle, through a range and unconditional', c4.length === 1 && c4[0].throughRange && !c4[0].conditional);
check('FALSE: the same formulas with A5 outside the range (A11) have no cycle', cyc({ 'S!A1': 'SUM(A2:A10)', 'S!A11': 'A1' }).length === 0);
check('GENUINE: a cell that sums a range containing itself is a cycle', cyc({ 'S!A5': 'SUM(A1:A10)' }).length === 1);
check('GENUINE: a direct two-cell loop is a cycle and is not through a range', (() => { const c = cyc({ 'S!A1': 'B1', 'S!B1': 'A1' }); return c.length === 1 && !c[0].throughRange; })());
check('FALSE: address-like text creates no dependency', cyc({ 'S!A1': 'IF(B1="C99",D1,0)', 'S!C99': 'A1' }).length === 0);
check('GENUINE: the same chain written without the quotes is a cycle', cyc({ 'S!A1': 'IF(B1=C99,D1,0)', 'S!C99': 'A1' }).length === 1);
check('FALSE: COLUMNS($H21:H21) in H21 reads a size, not a value', cyc({ 'S!H21': 'COLUMNS($H21:H21)' }).length === 0);
check('FALSE: ROW(E368)-ROW($E$368) in E368 reads positions only', cyc({ 'S!E368': 'ROW(E368)-ROW($E$368)' }).length === 0);
check('GENUINE: a whole-column reference closes a cycle', cyc({ 'S!B1': 'SUM(A:A)', 'S!A9': 'B1' }).length === 1);
check('FALSE: a whole-column reference to another column does not', cyc({ 'S!B1': 'SUM(C:C)', 'S!A9': 'B1' }).length === 0);
check('GENUINE: a defined name closes a cycle', cyc({ 'S!A1': 'SUM(Rate)', 'S!A3': 'A1' }, ['S'], { RATE: { sheet: 'S', c1: 1, r1: 2, c2: 1, r2: 4 } }).length === 1);
check('FALSE: the same name pointing elsewhere does not', cyc({ 'S!A1': 'SUM(Rate)', 'S!A3': 'A1' }, ['S'], { RATE: { sheet: 'S', c1: 5, r1: 2, c2: 5, r2: 4 } }).length === 0);
check('GENUINE: a cycle across sheets through a range', cyc({ 'S!A1': "SUM('Other Sheet'!A1:A5)", 'Other Sheet!A3': 'S!A1' }).length === 1);
check('FALSE: the same addresses on a different sheet are not the range', cyc({ 'S!A1': 'SUM(T!A2:A10)', 'S!A5': 'A1' }).length === 0);
check('GENUINE: a range of 3,000 cells still closes a cycle (no size limit)', cyc({ 'S!A1': 'SUM(B1:B3000)', 'S!B2500': 'A1' }).length === 1);
check('conditional: a loop that needs an IF branch is reported as conditional', (() => { const c = cyc({ 'S!A1': 'IF(Z1=1,SUM(A2:A10),0)', 'S!A5': 'A1' }); return c.length === 1 && c[0].conditional && c[0].throughRange; })());
check('unconditional wins: the same loop with the range in the IF condition is unconditional', (() => { const c = cyc({ 'S!A1': 'IF(SUM(A2:A10)>0,1,0)', 'S!A5': 'A1' }); return c.length === 1 && !c[0].conditional; })());
check('a cycle found twice (conditional and not) is reported once', cyc({ 'S!A1': 'SUM(A2:A10)+IF(Z1,A5,0)', 'S!A5': 'A1' }).length === 1);
check('self-reference by name of the cell is a one-cell cycle', (() => { const c = cyc({ 'S!A1': 'A1+1' }); return c.length === 1 && c[0].length === 2; })());

// ---------------------------------------------------------------- laziness / performance
{
  const N = 30000, rowsAbove = {}, rowsBelow = {};
  for (let i = 1; i <= N; i++) { rowsAbove['S!A' + i] = i === 1 ? '1+0' : `SUM(A$1:A${i - 1})`; rowsBelow['S!A' + i] = i === N ? '1+0' : `SUM(A${i + 1}:A${N})`; }
  let t = Date.now(); const a = cyc(rowsAbove); const msA = Date.now() - t;
  t = Date.now(); const b = cyc(rowsBelow); const msB = Date.now() - t;
  check(`30,000 running totals (each reads everything above) have no cycle and finish quickly (${msA} ms)`, a.length === 0 && msA < 5000);
  check(`30,000 remaining totals (each reads everything below, a 30,000-deep chain) have no cycle (${msB} ms)`, b.length === 0 && msB < 5000);
  rowsAbove['S!A1'] = `SUM(A2:A${N})`;
  check('closing the running totals with one cell reading the bottom row is found', cyc(rowsAbove).length >= 1);
}

// ---------------------------------------------------------------- detector result shape
{
  const index = idx({ 'S!A1': 'SUM(A2:A10)', 'S!A5': 'A1', 'S!C1': 'D1', 'S!D1': 'C1', 'S!F1': 'IF(Z1,SUM(F2:F9),0)', 'S!F4': 'F1' });
  const wb = { getWorksheet: () => null, definedNames: { model: [] } };
  const r = circ.checkCircularReferences(index, ['S'], wb);
  check('direct cycles keep their original buckets', r.otherCycles.length === 1 && r.otherCycles[0].path.includes('S!C1'));
  check('range cycles are separate, split into unconditional and conditional', r.rangeCycles.length === 2 && r.rangeCyclesUnconditional.length === 1 && r.rangeCyclesConditional.length === 1);
  check('the result says what could not be located', r.stats && r.stats.unknownDependencies && typeof r.stats.unknownDependencies.total === 'number');
  const f = circ.buildRangeCycleFinding(r);
  check('T0-CIRC-003 is medium when an unconditional range cycle exists', f && f.id === 'T0-CIRC-003' && f.severity === 'medium');
  check('T0-CIRC-003 names both kinds and says it reads formula text only', /always evaluated/.test(f.condition) && /lazily evaluated/.test(f.condition) && /formula text only/.test(f.condition));
  const low = circ.buildRangeCycleFinding(circ.checkCircularReferences(idx({ 'S!A1': 'IF(Z1,SUM(A2:A10),0)', 'S!A5': 'A1' }), ['S'], wb));
  check('T0-CIRC-003 is low when every range cycle is conditional', low && low.severity === 'low');
  check('no finding when there is no range cycle', circ.buildRangeCycleFinding(circ.checkCircularReferences(idx({ 'S!A1': 'B1', 'S!B1': 'A1' }), ['S'], wb)) === null);
  check('unknown dependencies are disclosed in the finding', (() => { const g = circ.checkCircularReferences(idx({ 'S!A1': 'SUM(A2:A10)+Mystery', 'S!A5': 'A1' }), ['S'], wb); return /could not be located/.test(circ.buildRangeCycleFinding(g).condition); })());
}

// ---------------------------------------------------------------- tracer
{
  const e = tracer.extractCellReferences('IF(B1="C99",D1,SUM(A2:A4))+ROW(Z9)', 'S', ['S']);
  check('tracer: literal removed, position-only argument ignored, range gives its cells', JSON.stringify(e.map(x => x.cell)) === '["B1","D1","A2","A3","A4"]');
  check('tracer: a range\'s top-left cell is direct, its other members are marked range-derived', e.filter(x => x.fromRange).length === 2 && !e.find(x => x.cell === 'A2').fromRange);
  const stats = {};
  const big = tracer.extractCellReferences('SUM(A1:A500)', 'S', ['S'], { stats });
  check('tracer: a long range is cut at 60 cells and the cut is counted', big.length === 60 && stats.rangesCut === 1);
  const idx2 = idx({ 'S!A1': 'SUM(B1:B5)', 'S!B1': 'C1+1', 'S!B3': 'D1+1' });
  const t = tracer.traceCellChain('S', 'A1', idx2, (s, c) => (c === 'C1' ? 5 : null), ['S']);
  check('tracer: blank members of a range, and blanks behind its formula members, are not dead ends; formula members are followed', !t.hasDeadEnds && t.chain.some(x => x.cell === 'B3') && t.chain.some(x => x.cell === 'C1'));
  const t3 = tracer.traceCellChain('S', 'A1', idx({ 'S!A1': 'SUM(B1:B5)' }), () => null, ['S']);
  check('tracer: a blank top-left cell of a range is still a dead end, as before', t3.hasDeadEnds && t3.deadEnds[0].cell === 'B1');
  const t4 = tracer.traceCellChain('S', 'A1', idx({ 'S!A1': 'SUM(B1:B5)', 'S!B1': '1+1' }), (s, c) => (c === 'B4' ? '#DIV/0!' : null), ['S']);
  check('tracer: a cached error anywhere in a range is reported', t4.hasErrorPropagation && t4.errorPropagations[0].cell === 'B4');
  const t2 = tracer.traceCellChain('S', 'A1', idx({ 'S!A1': 'B1+1' }), () => null, ['S']);
  check('tracer: a blank cell named directly is still a dead end', t2.hasDeadEnds);
}

// ---------------------------------------------------------------- Python mirror
const py = (code) => spawnSync('python3', ['-I', '-c', 'import sys,json;sys.path.insert(0,sys.argv[1]);import reference_service as r;' + code, path.join(__dirname, 'src')], { encoding: 'utf8' });
{
  const p = py("print(sorted(r.extract_refs('IF(B1=\"C99\",D1,0)','S')))");
  if (p.status !== 0) console.log('SKIP: python3 not available - ' + String(p.stderr).slice(0, 80));
  else {
    check('python: a quoted literal is not a reference', !/C99/.test(p.stdout) && /'D'/.test(p.stdout));
    const q = py("a=r.extract_refs('SUM(A1:A2000)','S');b=r.extract_refs('SUM(A1:A2001)','S');print(a.cell_count(),b.cell_count(),len(b),len(b.big_ranges))");
    check('python: ranges of 2,000 and 2,001 cells are both covered, the larger kept as a rectangle', q.stdout.trim() === '2000 2001 0 1');
    const h = py("b=r.BigRanges();x=r.extract_refs('SUM(A1:A5000)','S');b.add(x,'S!B1');y=r.extract_refs('SUM(C1:C5000)','S');b.add(y,'S!B2');h=b.hit_by(['S!A77']);print(sorted(h.items()),bool(b),b.hit_by(['S!A77']))");
    check('python: a cell inside a kept range reaches its reader, once, and not the reader of another range', h.stdout.trim() === "[('S!B1', 'S!A77')] True {}");
    const s3 = py("print(sorted(r.extract_refs('SUM(Jan:Mar!B5)','S',['Jan','Feb','Mar'])))");
    check('python: 3-D references expand across the tabs', /Feb/.test(s3.stdout) && /Mar/.test(s3.stdout) && /Jan/.test(s3.stdout));

    // parity: the same formulas give the same covered cells in JavaScript and Python
    const forms = ['IF(B1="C99",D1,0)', "'Other Sheet'!A1:B3+S!C4", '$A$1+SUM($B2:C$4)', 'SUM(Jan:Mar!B5)', '"x""A1"&F7*G8', 'SUM(A1:A2000)+Q9'];
    const jsSet = f => { const out = new Set(); for (const r of show(f).refs) for (let rr = r.r1; rr <= r.r2; rr++) for (let cc = r.c1; cc <= r.c2; cc++) out.add(`${r.sheet}!${rs.colName(cc)}${rr}`); return [...out].sort(); };
    const pyOut = spawnSync('python3', ['-I', '-c', "import sys,json;sys.path.insert(0,sys.argv[1]);import reference_service as r\nres=[]\nfor f in json.loads(sys.argv[2]):\n    s=r.extract_refs(f,'S',['S','T','Other Sheet','Jan','Feb','Mar'])\n    res.append(sorted('%s!%s%d'%x for x in s))\nprint(json.dumps(res))", path.join(__dirname, 'src'), JSON.stringify(forms)], { encoding: 'utf8' });
    let same = false;
    try { const got = JSON.parse(pyOut.stdout.trim()); same = forms.every((f, i) => JSON.stringify(got[i]) === JSON.stringify(jsSet(f))); } catch (_) { /* reported below */ }
    check('JavaScript and Python cover the same cells on shared formulas', same);
  }
}

console.log(fails ? `\n${fails} FAILED` : '\nAll Patch 32 checks passed');
process.exit(fails ? 1 : 0);
