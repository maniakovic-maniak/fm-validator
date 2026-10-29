"""Builds the small workbooks the acceptance cases need (Patch 27). Each has a deliberately wrong saved value so the
recalculation comparison has something to find. Saved values are written straight into the sheet XML, because openpyxl
cannot store a formula and a cached result together."""
import openpyxl, zipfile, re, sys, os

def make(path, cells, caches):
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'S'
    for a, v in cells.items(): ws[a] = v
    wb.save(path + '.tmp')
    zin = zipfile.ZipFile(path + '.tmp'); zout = zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED)
    for it in zin.infolist():
        d = zin.read(it.filename)
        if it.filename == 'xl/worksheets/sheet1.xml':
            s = d.decode()
            for a, (kind, v) in caches.items():
                pat = r'<c r="%s"([^>]*?)>(<f>[^<]*</f>)(<v\s*/>|<v></v>)?</c>' % a
                if kind == 'num':   rep = lambda m, v=v: '<c r="%s"%s>%s<v>%s</v></c>' % (a, re.sub(r'\st="[^"]*"', '', m.group(1)), m.group(2), v)
                elif kind == 'str': rep = lambda m, v=v: '<c r="%s"%s t="str">%s<v>%s</v></c>' % (a, re.sub(r'\st="[^"]*"', '', m.group(1)), m.group(2), v)
                elif kind == 'bool':rep = lambda m, v=v: '<c r="%s"%s t="b">%s<v>%s</v></c>' % (a, re.sub(r'\st="[^"]*"', '', m.group(1)), m.group(2), v)
                elif kind == 'none':rep = lambda m: '<c r="%s"%s>%s</c>' % (a, re.sub(r'\st="[^"]*"', '', m.group(1)), m.group(2))
                s2, n = re.subn(pat, rep, s)
                assert n == 1, (path, a, n)
                s = s2
            d = s.encode()
        zout.writestr(it, d)
    zout.close(); os.remove(path + '.tmp')

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
# case 1: a ratio saved as 1.35 that recalculates to 0.50
make(os.path.join(out, 'case1_ratio.xlsx'), {'A1': 1, 'B1': 2, 'C1': '=A1/B1'}, {'C1': ('num', 1.35)})
# case 2: IFERROR with no engine failure and a stale cache; a dependent inherits the stale value
make(os.path.join(out, 'case2_iferror_stale.xlsx'),
     {'A1': 10, 'B1': '=IFERROR(A1*2,0)', 'C1': '=B1+1'}, {'B1': ('num', 10), 'C1': ('num', 11)})
# case 3: a text result, a Boolean result, a formula with no saved value, and an engine error
make(os.path.join(out, 'case3_result_types.xlsx'),
     {'A1': 1, 'B1': '=A1&"x"', 'C1': '=A1>0', 'D1': '=A1+1', 'E1': '=1/0'},
     {'B1': ('str', 'zz'), 'C1': ('bool', 0), 'D1': ('none', None), 'E1': ('num', 5)})
# volatile: TODAY() saved on another day, and a cell that depends on it
make(os.path.join(out, 'volatile.xlsx'), {'A1': '=TODAY()', 'B1': '=A1+1', 'C1': 5, 'D1': '=C1*2'},
     {'A1': ('num', 44000), 'B1': ('num', 44001), 'D1': ('num', 10)})
# held back: an IFERROR over IRR (a documented engine limitation) whose saved value differs
make(os.path.join(out, 'heldback.xlsx'), {'A1': -100, 'A2': 60, 'A3': 60, 'B1': '=IFERROR(IRR(A1:A3),0)', 'C1': '=B1*2'},
     {'B1': ('num', 0.9), 'C1': ('num', 1.8)})
# a clean file: everything matches
make(os.path.join(out, 'clean.xlsx'), {'A1': 2, 'B1': '=A1*3', 'C1': '=B1+1'}, {'B1': ('num', 6), 'C1': ('num', 7)})
print('ok')
