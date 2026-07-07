#!/usr/bin/env python3
"""
FM Validator — _VALIDATED.xlsx Report Builder
13-tab transaction-grade audit report
"""
import sys, json, os, re
from datetime import datetime
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.worksheet.datavalidation import DataValidation

# ── Colours ──────────────────────────────────────────────────────────────────
DARK_BLUE   = '1F4E79'; MID_BLUE   = '2E75B6'; LIGHT_BLUE  = 'D6E4F0'; PALE_BLUE = 'EBF3FA'
RED         = 'C00000'; LIGHT_RED  = 'FFE0E0'
AMBER       = 'C55A11'; LIGHT_AMBER= 'FCE4D6'
YELLOW      = 'FFD966'; LIGHT_YELL = 'FFF2CC'
GREEN       = '375623'; LIGHT_GREEN= 'E2EFDA'
GREY_DARK   = '595959'; GREY_MID   = 'A6A6A6'; GREY_LIGHT = 'F2F2F2'; WHITE = 'FFFFFF'
BORDER_COL  = 'BFBFBF'

def F(hex_col): return PatternFill('solid', fgColor=hex_col)
def Fn(bold=False,sz=10,col='000000',italic=False): return Font(bold=bold,size=sz,color=col,italic=italic,name='Arial')
def A(h='left',v='center',wrap=False): return Alignment(horizontal=h,vertical=v,wrap_text=wrap)
def B(col=BORDER_COL,sty='thin'):
    s=Side(style=sty,color=col)
    return Border(left=s,right=s,top=s,bottom=s)
def noBorder():
    s=Side(style='thin',color=WHITE)
    return Border(left=s,right=s,top=s,bottom=s)

def cell(ws,ref,val=None,bold=False,sz=10,col='000000',italic=False,bg=None,h='left',v='center',wrap=False,border=False):
    c=ws[ref]
    if val is not None: c.value=val
    c.font=Fn(bold=bold,sz=sz,col=col,italic=italic)
    if bg: c.fill=F(bg)
    c.alignment=A(h=h,v=v,wrap=wrap)
    if border: c.border=B()
    return c

def hdr(ws,ref,val,bg=DARK_BLUE,tc=WHITE,sz=10,h='left',bold=True):
    c=ws[ref]; c.value=val
    c.font=Fn(bold=bold,sz=sz,col=tc)
    c.fill=F(bg); c.alignment=A(h=h,v='center')
    c.border=B(col=WHITE); return c

def merge(ws,rng,val=None,bold=False,sz=10,col='000000',bg=None,h='left',v='center',wrap=False,italic=False):
    ws.merge_cells(rng); tl=rng.split(':')[0]; c=ws[tl]
    if val is not None: c.value=val
    c.font=Fn(bold=bold,sz=sz,col=col,italic=italic)
    if bg: c.fill=F(bg)
    c.alignment=A(h=h,v=v,wrap=wrap); return c

def fill_range(ws,r1,c1,r2,c2,bg):
    for r in range(r1,r2+1):
        for c in range(c1,c2+1):
            ws.cell(r,c).fill=F(bg)

def set_col(ws,col,w): ws.column_dimensions[get_column_letter(col)].width=w
def set_row(ws,row,h): ws.row_dimensions[row].height=h

def row_data(ws,row,vals,widths,bgs,fns):
    for i,(val,fn) in enumerate(zip(vals,fns)):
        c=ws.cell(row,i+1); c.value=val
        c.font=fn; c.fill=F(bgs[i] if bgs[i] else WHITE)
        c.alignment=A(h='center' if i<2 else 'left',v='top',wrap=True)
        c.border=B()

# ════════════════════════════════════════════════════════════════════════════════
def build_report(data_path, output_path):
    with open(data_path,'r') as f: d=json.load(f)


    # Sanitize text fields — Excel formula errors in strings cause LibreOffice to flag them
    def san(v):
        if isinstance(v,str): return v.replace("#REF!","#REF").replace("#VALUE!","#VALUE").replace("#N/A","#NA").replace("#NAME?","#NAME").replace("#DIV/0!","#DIV0")
        return v
    findings=[{k:san(v) for k,v in f.items()} for f in d.get("findings",[])]
    t0           = d.get('tier0',{})
    modelName    = d.get('modelName','Financial Model')
    modelType    = d.get('modelType','unknown')
    modelIndustry= d.get('modelIndustry','')
    currency     = d.get('currency','')
    periodicity  = d.get('periodicity','')
    domainSkill  = d.get('domainSkill','skill-generic.md')
    reviewDate   = datetime.now().strftime('%d %b %Y')
    sourceFile   = d.get('sourceFile','model.xlsm')
    overallAssess= d.get('overallAssessment','not_fit_for_purpose')
    igReadiness  = d.get('igReadiness',0)
    igCommentary = d.get('igCommentary','')
    modelTier    = d.get('modelTier','Tier 1')
    reviewMode   = d.get('reviewMode','llm_only')
    ruleResults  = d.get('ruleResults',[])
    errorScan    = d.get('errorScan',[])
    redundantIn  = d.get('redundantInputs',{'applicable':False,'totalInputs':0,'redundantCount':0,'redundant':[],'inputSheets':[]})

    # Checklist rules for the Validation Matrix — loaded from config
    checklist_path=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','config','checklist.json')
    try:
        with open(checklist_path) as cf: _cl=json.load(cf)
        checklist_rules=([dict(r,_tier='Tier 1') for r in _cl.get('tier1',[])]
                        +[dict(r,_tier='Tier 2') for r in _cl.get('tier2',[])])
    except Exception:
        checklist_rules=[]

    # Severity → priority mapping
    def priority(f):
        sev = (f.get('severity') or '').lower()
        if sev in ('fatal','critical'): return 'P1'
        if sev == 'high': return 'P2'
        return 'P3'

    p1 = [f for f in findings if priority(f)=='P1']
    p2 = [f for f in findings if priority(f)=='P2']
    p3 = [f for f in findings if priority(f)=='P3']

    # Audit coverage counts — feeds the dashboard completion breakdown (V11 1.3)
    def _rmatch0(rid,xid): return xid==rid or (xid or '').startswith(rid+'-')
    cov_perf=cov_pass=cov_issue=cov_unc=cov_np=0
    for _rule in checklist_rules:
        _rres=[r for r in ruleResults if _rmatch0(_rule.get('id',''),r.get('id',''))]
        if not _rres: cov_np+=1; continue
        cov_perf+=1
        if any(r.get('status') not in ('pass','uncertain') for r in _rres): cov_issue+=1
        elif any(r.get('status')=='uncertain' for r in _rres): cov_unc+=1
        else: cov_pass+=1

    # KPMG verdict
    # Neutral audit completion header — no verdict or reliance conclusion
    p1_open = len(p1)
    p2_open = len(p2)
    p3_open = len(p3)
    # Reliance classification (V11 1.1) — component of the audit conclusion,
    # stated factually. Hard rule: a model cannot be classified reliance-ready
    # for lender/investor use or transaction execution while any P1 item is open.
    if p1_open > 0:
        if igReadiness >= 60:
            verdict_short='RELIANCE-READY FOR INTERNAL REVIEW ONLY'; verdict_bg=DARK_BLUE
            verdict_text=(f'{p1_open} P1 item(s) remain open — this model cannot be classified reliance-ready for management, lender or investor use until all P1 items are resolved and retested. '
                          f'{igReadiness}% of planned procedures completed ({cov_pass} passed, {cov_issue} raised issues, {cov_unc} uncertain, {cov_np} not run).')
        else:
            verdict_short='NOT RELIANCE-READY'; verdict_bg=DARK_BLUE
            verdict_text=(f'{p1_open} P1 item(s) open and {igReadiness}% of planned procedures completed. Both open P1 findings and audit coverage prevent reliance at any level. '
                          f'Resolve P1 items and complete outstanding procedures before reassessment.')
    elif igReadiness >= 95:
        verdict_short='RELIANCE-READY FOR TRANSACTION EXECUTION'; verdict_bg=MID_BLUE
        verdict_text=(f'No P1 items open and {igReadiness}% of planned procedures completed ({cov_pass} passed). '
                      f'{p2_open} P2 item(s) remain and should be resolved or formally waived as part of transaction close.')
    elif igReadiness >= 80:
        verdict_short='RELIANCE-READY FOR LENDER / INVESTOR REVIEW'; verdict_bg=MID_BLUE
        verdict_text=(f'No P1 items open; {igReadiness}% of planned procedures completed. Outstanding items: {cov_unc} uncertain and {cov_np} not-run procedures, {p2_open} open P2 item(s). '
                      f'Suitable for external review with these limitations disclosed.')
    elif igReadiness >= 60:
        verdict_short='RELIANCE-READY FOR MANAGEMENT DISCUSSION'; verdict_bg=MID_BLUE
        verdict_text=(f'No P1 items open; {igReadiness}% of planned procedures completed. Coverage gaps ({cov_np} procedures not run, {cov_unc} uncertain) limit use to internal management discussion until closed.')
    else:
        verdict_short='RELIANCE-READY FOR INTERNAL REVIEW ONLY'; verdict_bg=DARK_BLUE
        verdict_text=(igCommentary or f'{igReadiness}% of planned procedures completed. Coverage is not yet sufficient for management, lender or investor reliance. {cov_np} procedures not run, {cov_unc} uncertain.')

    risk_rating = f'P1: {len(p1)}  P2: {len(p2)}  P3: {len(p3)}'

    wb = Workbook()

    # ════════════════════════════════════════════════════════════════════════
    # TAB 1 — AUDIT OUTPUT
    # ════════════════════════════════════════════════════════════════════════
    ws1 = wb.active; ws1.title = 'Audit Output'; ws1.sheet_view.showGridLines=False
    for col,w in [(1,3),(2,22),(3,18),(4,16),(5,14),(6,14),(7,14),(8,14),(9,14),(10,3)]:
        set_col(ws1,col,w)

    # Header banner
    merge(ws1,'B1:I3','FINANCIAL MODEL AUDIT REPORT',bold=True,sz=18,col=WHITE,bg=DARK_BLUE,v='center')
    fill_range(ws1,1,2,3,9,DARK_BLUE)
    for r in [1,2,3]: set_row(ws1,r,16)

    # Model info
    merge(ws1,'B4:D4',modelName,bold=True,sz=11,col=DARK_BLUE,bg=PALE_BLUE,v='center')
    merge(ws1,'E4:F4',f'{modelType} — {modelIndustry}',sz=9,col=GREY_DARK,bg=PALE_BLUE,v='center')
    merge(ws1,'G4:H4',f'{currency} · {periodicity}',sz=9,col=GREY_DARK,bg=PALE_BLUE,v='center')
    merge(ws1,'I4:I4',f'Review: {reviewDate}',sz=9,col=GREY_DARK,bg=PALE_BLUE,v='center',h='right')
    set_row(ws1,4,24); set_row(ws1,5,8)

    # Verdict bar
    merge(ws1,'B6:C7',verdict_short,bold=True,sz=11,col=WHITE,bg=verdict_bg,h='left',v='center')
    merge(ws1,'D6:I7',verdict_text,sz=10,col=WHITE,bg=verdict_bg,v='center',wrap=True)
    fill_range(ws1,6,2,7,9,verdict_bg)
    set_row(ws1,6,18); set_row(ws1,7,18); set_row(ws1,8,8)

    # Risk rating + readiness
    merge(ws1,'B9:C9','OPEN FINDINGS',bold=True,sz=9,col=GREY_DARK,bg=GREY_LIGHT,h='center')
    merge(ws1,'B10:C11',risk_rating,bold=True,sz=12,col=DARK_BLUE,bg=GREY_LIGHT,h='center',v='center')
    for r in [10,11]:
        ws1.cell(r,2).fill=F(GREY_LIGHT)
        ws1.cell(r,3).fill=F(GREY_LIGHT)

    merge(ws1,'D9:I9','AUDIT PROCESS COMPLETION',bold=True,sz=9,col=GREY_DARK,bg=GREY_LIGHT)
    ws1['D10'].value=f'{igReadiness}%'; ws1['D10'].font=Fn(bold=True,sz=22,col=MID_BLUE); ws1['D10'].alignment=A(h='center',v='center')
    merge(ws1,'E10:I10',f'{len(checklist_rules)} planned procedures — {cov_perf} performed · {cov_pass} passed · {cov_issue} raised issues · {cov_unc} uncertain · {cov_np} not run',sz=9,col=GREY_DARK)
    merge(ws1,'E11:I11',igCommentary or f'{len(p1)} P1 item(s) and {len(p2)} P2 item(s) require attention before this review can be closed.',sz=9,col=GREY_DARK,wrap=True)
    for r in [9,10,11]: set_row(ws1,r,18)
    set_row(ws1,12,8)

    # Priority summary
    items=[('P1 OPEN',len(p1),GREY_LIGHT,DARK_BLUE),('P2 OPEN',len(p2),GREY_LIGHT,DARK_BLUE),('P3 OPEN',len(p3),GREY_LIGHT,DARK_BLUE),
           ('UNIQUE',t0.get('stats',{}).get('uniqueFormulaCount',0),PALE_BLUE,MID_BLUE),
           ('IFERROR',t0.get('stats',{}).get('totalIferrorCount',0),GREY_LIGHT,DARK_BLUE),
           ('OFFSET',t0.get('stats',{}).get('totalOffsetCount',0),GREY_LIGHT,DARK_BLUE),
           ('EXT LINKS',t0.get('stats',{}).get('totalExternalLinks',0),GREY_LIGHT,DARK_BLUE),
           ('FORMULAS',t0.get('stats',{}).get('totalFormulaCells',0),PALE_BLUE,MID_BLUE)]
    for i,(label,val,bg,tc) in enumerate(items):
        col=i+2
        c13=ws1.cell(13,col); c13.value=label; c13.font=Fn(bold=True,sz=8,col=GREY_DARK); c13.fill=F(bg); c13.alignment=A(h='center',v='center')
        c14=ws1.cell(14,col); c14.value=val; c14.font=Fn(bold=True,sz=18,col=tc); c14.fill=F(bg); c14.alignment=A(h='center',v='center')
    set_row(ws1,13,20); set_row(ws1,14,26); set_row(ws1,15,8)

    # Status panel
    status_areas=[
        ('Formula integrity',t0.get('stats',{}).get('totalExternalLinks',0)>0 or t0.get('stats',{}).get('totalRefInFormula',0)>0,'formula errors or external links detected'),
        ('Unique formula review',t0.get('stats',{}).get('fscoreDist',{}).get('High',0)>0,'Complex formulas found — see Formula Analysis tab for detail'),
        ('Dependency flow',False,'Dependency flow assessed'),
        ('Scenario logic',False,'Scenario checks completed'),
        ('Debt / funding logic',any(f.get('category')=='Debt' and priority(f)=='P1' for f in findings),'Debt checks completed'),
        ('Financial statements',any(f.get('category')=='Integration' and priority(f)=='P1' for f in findings),'Three-statement integration checked'),
        ('Tax logic',any(f.get('category')=='Tax' for f in findings),'Tax checks completed'),
        ('Valuation / returns',False,'Valuation checks completed'),
        ('Presentation / usability',False,'Presentation checks completed'),
        ('Input linkage',
         redundantIn.get('applicable',False) and redundantIn.get('redundantCount',0)>0,
         (f"{redundantIn.get('redundantCount',0)} of {redundantIn.get('totalInputs',0)} input-sheet constants are not referenced by any formula — see the Redundant Inputs tab and Issue Log finding T0-RI-001"
          if redundantIn.get('applicable',False) and redundantIn.get('redundantCount',0)>0
          else f"All {redundantIn.get('totalInputs',0)} input-sheet constants are referenced by model formulas"
          if redundantIn.get('applicable',False)
          else 'Not applicable — no input/assumption-named sheet detected')),
    ]
    hdr(ws1,'B16','AUDIT AREA',bg=DARK_BLUE)
    ws1.merge_cells('C16:D16'); ws1['C16'].value='STATUS'; ws1['C16'].font=Fn(bold=True,col=WHITE); ws1['C16'].fill=F(DARK_BLUE); ws1['C16'].alignment=A(h='center')
    ws1.merge_cells('E16:I16'); ws1['E16'].value='SUMMARY'; ws1['E16'].font=Fn(bold=True,col=WHITE); ws1['E16'].fill=F(DARK_BLUE)
    set_row(ws1,16,18)

    for i,(area,has_issue,summary) in enumerate(status_areas,17):
        bg=GREY_LIGHT if has_issue else WHITE; status_txt='Review' if has_issue else 'Completed'
        status_bg=GREY_DARK if has_issue else GREY_MID
        ws1.cell(i,2).value=area; ws1.cell(i,2).font=Fn(bold=True,sz=9); ws1.cell(i,2).fill=F(bg)
        ws1.merge_cells(f'C{i}:D{i}'); ws1[f'C{i}'].value=status_txt; ws1[f'C{i}'].font=Fn(bold=True,sz=9,col=WHITE); ws1[f'C{i}'].fill=F(status_bg); ws1[f'C{i}'].alignment=A(h='center')
        ws1.merge_cells(f'E{i}:I{i}'); ws1[f'E{i}'].value=summary; ws1[f'E{i}'].font=Fn(sz=9); ws1[f'E{i}'].fill=F(bg)
        set_row(ws1,i,18)
    set_row(ws1,26,8)

    # Top open issues
    hdr(ws1,'B27','#'); hdr(ws1,'C27','FINDING',bg=DARK_BLUE); ws1.merge_cells('C27:D27'); ws1['C27'].fill=F(DARK_BLUE)
    for col,lbl in [(5,'PRIORITY'),(6,'F-SCORE'),(7,'AREA'),(8,'SHEET'),(9,'VIEW ISSUE')]:
        ws1.cell(27,col).value=lbl; ws1.cell(27,col).font=Fn(bold=True,col=WHITE); ws1.cell(27,col).fill=F(DARK_BLUE); ws1.cell(27,col).alignment=A(h='center')
    set_row(ws1,27,18)

    # Ordered by decision impact (V11 1.4): P1 first, then key-output impact,
    # then formula complexity — not by insertion order.
    _pri_rank={'P1':0,'P2':1,'P3':2}
    top10 = sorted(p1+p2+p3, key=lambda f:(
        _pri_rank.get(priority(f),3),
        0 if str(f.get('key_output_impact','')).lower() in ('yes','true','high') else 1,
        -(f.get('fscore') or 0)))[:10]
    for i,f in enumerate(top10,28):
        pri=priority(f); bg=PALE_BLUE if pri=='P1' else GREY_LIGHT
        ws1.cell(i,2).value=i-27; ws1.cell(i,2).font=Fn(bold=True,sz=9); ws1.cell(i,2).fill=F(bg); ws1.cell(i,2).alignment=A(h='center')
        ws1.merge_cells(f'C{i}:D{i}')
        finding_text = f.get('label') or f.get('reason','')
        ws1[f'C{i}'].value=finding_text[:120]; ws1[f'C{i}'].font=Fn(sz=9); ws1[f'C{i}'].fill=F(bg); ws1[f'C{i}'].alignment=A(wrap=True)
        p_cell=ws1.cell(i,5); p_cell.value=pri; p_cell.font=Fn(bold=True,sz=9,col=WHITE)
        p_cell.fill=F(MID_BLUE if pri=='P1' else GREY_DARK if pri=='P2' else GREY_MID)
        p_cell.font=Fn(bold=True,sz=9,col=WHITE); p_cell.alignment=A(h='center')
        fs=f.get('fscore',0) or 0
        ws1.cell(i,6).value=fs if fs else '—'; ws1.cell(i,6).fill=F(bg); ws1.cell(i,6).alignment=A(h='center')
        ws1.cell(i,7).value=f.get('category',''); ws1.cell(i,7).fill=F(bg)
        ws1.cell(i,8).value=f.get('sheet',''); ws1.cell(i,8).fill=F(bg); ws1.cell(i,8).alignment=A(h='center')
        sheet=f.get('sheet',''); cell_ref=f.get('cell','A1')
        if sheet and sheet not in ('—','N/A','Multiple'):
            label='View issue' if (cell_ref and cell_ref not in ('A1','—','N/A')) else sheet
            link_cell=ws1.cell(i,9)
            link_cell.value='=HYPERLINK("[' + sourceFile + ']' + sheet + '!A1","' + label + '")'
            link_cell.font=Font(size=9,color=MID_BLUE,underline='single',name='Arial')
            link_cell.fill=F(bg); link_cell.alignment=A(h='center')
        else:
            ws1.cell(i,9).value='—'; ws1.cell(i,9).fill=F(bg); ws1.cell(i,9).alignment=A(h='center'); ws1.cell(i,9).font=Fn(sz=9,col=GREY_MID)
        set_row(ws1,i,22)
    set_row(ws1,38,8)

    # Accounting review summary — fills previously blank dashboard space
    merge(ws1,'B39:I39','ACCOUNTING REVIEW SUMMARY',bold=True,sz=9,col=GREY_DARK,bg=GREY_LIGHT,h='left')
    set_row(ws1,39,16)
    acct_items = [
        ('Accounting basis reviewed', 'Extracted cell values — accrual basis assumed from financial statement structure'),
        ('Areas checked', 'Depreciation & asset treatment, revenue recognition, liability classification, debt treatment, tax balances'),
        ('Standards consistency', 'Assessed against general accrual accounting practice — no specific framework confirmed in model'),
    ]
    r = 40
    for label, val in acct_items:
        ws1.cell(r,2).value = label; ws1.cell(r,2).font = Fn(sz=9,bold=True,col=GREY_DARK); ws1.cell(r,2).fill = F(GREY_LIGHT)
        ws1.merge_cells(f'C{r}:I{r}')
        ws1.cell(r,3).value = val; ws1.cell(r,3).font = Fn(sz=9); ws1.cell(r,3).fill = F(GREY_LIGHT); ws1.cell(r,3).alignment = A(wrap=True)
        set_row(ws1,r,16)
        r += 1
    set_row(ws1,r,8)
    r += 1

    # Scope limitations
    ws1.merge_cells(f'B{r}:I{r}'); ws1[f'B{r}'].value='SCOPE AND LIMITATIONS'
    ws1[f'B{r}'].font=Fn(bold=True,sz=9,col=GREY_DARK); ws1[f'B{r}'].fill=F(GREY_LIGHT); ws1[f'B{r}'].alignment=A()
    set_row(ws1,r,16); r+=1
    ws1.merge_cells(f'B{r}:I{r+1}')
    scope=f'Review conducted in {reviewMode} mode. Domain skill: {domainSkill}. Tier 0 formula scanner analysed {t0.get("stats",{}).get("totalFormulaCells",0):,} formula cells. The following items were not included in this review: formula text inspection, named range audit, VBA review, source document testing. See the Scope and Reliance tab for a full list of items not included in this review.'
    ws1['B40'].value=scope; ws1['B40'].font=Fn(sz=9,col=GREY_DARK,italic=True); ws1['B40'].fill=F(GREY_LIGHT); ws1['B40'].alignment=A(wrap=True,v='top')
    for r in [40,41]:
        set_row(ws1,r,18)
        for c in range(2,10): ws1.cell(r,c).fill=F(GREY_LIGHT)

    # ════════════════════════════════════════════════════════════════════════
    # TAB 2 — READ ME
    # ════════════════════════════════════════════════════════════════════════
    ws2=wb.create_sheet('Read Me'); ws2.sheet_view.showGridLines=False
    for col,w in [(1,3),(2,28),(3,60),(4,3)]: set_col(ws2,col,w)

    merge(ws2,'B1:C1','READ ME — HOW TO USE THIS REPORT',bold=True,sz=14,col=WHITE,bg=DARK_BLUE,v='center')
    ws2.cell(1,2).fill=F(DARK_BLUE); ws2.cell(1,3).fill=F(DARK_BLUE); set_row(ws2,1,28)

    readme_sections=[
        ('PURPOSE','This report is the output of the FM Validator automated audit pipeline. It combines Tier 0 formula text analysis, Tier 1 code checks and Tier 2 Claude semantic analysis to produce a transaction-grade audit file.'),
        ('HOW TO READ THE ISSUE LOG','Each row in the Issue Log is one finding. Findings are sorted by Priority (P1 first), then F-Score. Use the filters on the Excel table to focus on specific areas, priorities or statuses. The View Issue link in each row jumps directly to the affected cell in the source model.'),
        ('PRIORITY LEVELS','P1 — Must be resolved before any external reliance. Affects key outputs or blocks the audit conclusion.\nP2 — Should be resolved before final issue or submission. Can be accepted with a documented rationale.\nP3 — Best practice. Address in the next model revision where practical.\nQuery — Requires confirmation from the model owner before the finding can be closed.'),
        ('CLOSURE STATUS','Open: Finding is unresolved.\nClosed: Finding has been retested and confirmed resolved.\nWaived: Finding is accepted as a known risk with documented rationale and approver sign-off.\nDeferred: Resolution deferred to a future model version.\nSuperseded: Finding replaced by a more comprehensive finding.'),
        ('HOW TO RESPOND TO AN ISSUE','1. Review the finding in the Issue Log.\n2. Set the Relevance column — Relevant, Not Relevant, or Needs Review.\n3. Add your management response in the Management Response column.\n4. The reviewer will confirm, accept or request further action in the Reviewer Response column.\n5. Once confirmed fixed, the finding is retested and closed under the closure rules below.'),
        ('HOW TO CLOSE AN ISSUE','Issues may only be closed when:\n• The fix has been implemented in the model;\n• The fix has been retested and confirmed by the reviewer;\n• Closure evidence is documented;\n• The reviewer has signed off.\nWaived issues require a documented commercial rationale and approver sign-off.'),
        ('VIEW ISSUE LINKS','Each finding with a known cell location includes a View Issue hyperlink. These links work best on Windows Excel when both files are open in the same Excel instance and stored in the same folder. On Mac Excel, links may fail with a reference error — this is an Excel limitation, not a report error. If a link fails, use the Sheet and Cell columns to navigate to the issue manually. The Sheet and Cell values are always accurate regardless of hyperlink behaviour.'),
        ('VALIDATION MATRIX','The Validation Matrix tab lists every rule in the review checklist and records whether it was performed, its outcome, the evidence reviewed, related findings, and whether a retest is required. Rules shown as Not Performed or Uncertain are the remaining procedures behind the audit completion percentage on the Audit Output tab.'),
        ('REDUNDANT INPUTS','The Redundant Inputs tab lists every numeric constant on the model\u2019s input sheets that is not referenced by any formula, with a hyperlink to each cell and a resolution column for the model owner: link the input into the calculation chain, remove it, or relabel it as a memo item. Unreferenced assumptions give a false sense of what drives the model.'),
        ('ERROR MATRIX','The Error Matrix tab groups every live error value in the workbook by error code, with sample locations, the typical root cause for that code, and the recommended corrective approach. Errors hidden inside IFERROR/IFNA wrappers do not appear as live values and are assessed under formula review.'),
        ('ASSUMPTION REGISTER','The Assumption Register tab is a provenance template for the model\u2019s key assumptions. Related findings from this review are pre-populated; the Source, Source Date, Owner, Basis and Externally Supported columns are for the model owner to complete and the reviewer to verify.'),
        ('WHAT THIS REPORT COVERS','This workbook records findings identified during the model review. It covers the automatable subset of a structured model review. It does not replace source document review, cell-by-cell formula inspection, or reviewer judgment. The following items were not included in this review — see the Scope and Reliance tab for details.'),
    ]
    row=3
    for heading,body in readme_sections:
        ws2.cell(row,2).value=heading; ws2.cell(row,2).font=Fn(bold=True,sz=11,col=DARK_BLUE); ws2.cell(row,2).fill=F(PALE_BLUE); ws2.cell(row,2).alignment=A()
        ws2.cell(row,3).fill=F(PALE_BLUE); set_row(ws2,row,20); row+=1
        ws2.cell(row,2).value=body; ws2.cell(row,2).font=Fn(sz=10); ws2.cell(row,2).alignment=A(wrap=True,v='top')
        ws2.merge_cells(f'B{row}:C{row}'); set_row(ws2,row,max(60,len(body)//2)); row+=2

    # ════════════════════════════════════════════════════════════════════════
    # TAB 3 — SCOPE AND RELIANCE
    # ════════════════════════════════════════════════════════════════════════
    ws3=wb.create_sheet('Scope and Reliance'); ws3.sheet_view.showGridLines=False
    for col,w in [(1,3),(2,28),(3,45),(4,3)]: set_col(ws3,col,w)

    merge(ws3,'B1:C1','SCOPE AND RELIANCE',bold=True,sz=14,col=WHITE,bg=DARK_BLUE,v='center')
    ws3.cell(1,2).fill=F(DARK_BLUE); ws3.cell(1,3).fill=F(DARK_BLUE); set_row(ws3,1,28)

    scope_fields=[
        ('MODEL DETAILS',''),
        ('Model name',modelName),
        ('Model type',f'{modelType} — {modelIndustry}'),
        ('Currency / Periodicity',f'{currency} · {periodicity}'),
        ('Source file',sourceFile),
        ('Domain skill applied',domainSkill),
        ('',''),
        ('REVIEW DETAILS',''),
        ('Review date',reviewDate),
        ('Review mode',reviewMode),
        ('Model tier',modelTier),
        ('Prepared by','FM Validator automated pipeline'),
        ('Checked by',''),
        ('Approved by',''),
        ('',''),
        ('SCOPE',''),
        ('Rules applied',f'{len(findings)} findings from 141-rule checklist'),
        ('Tier 0 coverage',f'{t0.get("stats",{}).get("totalFormulaCells",0):,} formula cells scanned'),
        ('Tier 1 coverage','12 structural code checks'),
        ('Tier 2 coverage','129 Claude semantic checks across 13 sections'),
        ('',''),
        ('EXCLUSIONS AND LIMITATIONS',''),
        ('Formula text inspection','Best-effort via Tier 0. Full formula-level review requires Excel access.'),
        ('Source document review','Not performed. Actuals reconciliation to source accounts not verified.'),
        ('Cell-by-cell audit','Not performed. Formula logic inspection requires formula text access.'),
        ('Commercial omission testing','Not performed. Requires challenger model and commercial judgment.'),
        ('VBA and macro audit','Not performed. Macro documentation checked only.'),
        ('Named range audit','Not performed. Broken named range detection via Tier 0 only.'),
        ('',''),
        ('OVERALL ASSESSMENT',''),
        ('Review status',f'{igReadiness}% of planned procedures completed · {len(p1)} P1 · {len(p2)} P2 · {len(p3)} P3'),
        ('Audit process completion',f'{igReadiness}% of planned review procedures completed'),
        ('Open findings summary',risk_rating),
        ('P1 findings',str(len(p1))),
        ('P2 findings',str(len(p2))),
        ('P3 findings',str(len(p3))),
        ('Signed off version','Not yet signed off'),
    ]

    row=3
    for label,val in scope_fields:
        if not label:
            set_row(ws3,row,8); row+=1; continue
        if not val:  # Section header
            ws3.cell(row,2).value=label; ws3.cell(row,2).font=Fn(bold=True,sz=10,col=DARK_BLUE); ws3.cell(row,2).fill=F(PALE_BLUE)
            ws3.cell(row,3).fill=F(PALE_BLUE); set_row(ws3,row,18); row+=1; continue
        ws3.cell(row,2).value=label; ws3.cell(row,2).font=Fn(sz=10,col=GREY_DARK); ws3.cell(row,2).fill=F(GREY_LIGHT); ws3.cell(row,2).alignment=A()
        ws3.cell(row,3).value=val; ws3.cell(row,3).font=Fn(sz=10,bold=(label in ('Verdict','Risk rating'))); ws3.cell(row,3).alignment=A(wrap=True,v='top')
        ws3.cell(row,2).border=B(); ws3.cell(row,3).border=B(); set_row(ws3,row,18); row+=1

    # ════════════════════════════════════════════════════════════════════════
    # TAB 4 — ISSUE LOG
    # ════════════════════════════════════════════════════════════════════════
    ws4=wb.create_sheet('Issue Log'); ws4.sheet_view.showGridLines=False; ws4.freeze_panes='A3'
    col_widths=[3,12,8,14,10,10,18,14,14,30,30,30,30,30,25,14,10,12,10,10,8,10,8,12,8,8,12,14,14,16,18,18,22,22,3]
    for i,w in enumerate(col_widths,1): set_col(ws4,i,w)

    merge(ws4,'B1:AH1','ISSUE LOG',bold=True,sz=14,col=WHITE,bg=DARK_BLUE,v='center')
    fill_range(ws4,1,2,1,34,DARK_BLUE); set_row(ws4,1,28)

    il_headers=['','Finding ID','Priority','Status','Relevance','Urgency',
                'Issue Type','Workstream','Category',
                'Issue Title','What is wrong','Why it matters','Output affected',
                'Corrective Action',
                'Model Risk','Key Output\nImpact','F-Score','Confidence','Method',
                'Sheet','Cell','Range',
                'View Issue',
                'Root Cause','Investment\nBlocker','Escalation\nFlag',
                'Date Raised','Owner','Target Date','Days Open',
                'Management\nResponse','Reviewer\nResponse',
                'Client\nResponse','']
    for col,h in enumerate(il_headers,1):
        c=ws4.cell(2,col); c.value=h; c.font=Fn(bold=True,sz=9,col=WHITE)
        c.fill=F(DARK_BLUE); c.alignment=A(h='center',v='center',wrap=True); c.border=B(col=WHITE)
    set_row(ws4,2,36)
    VIEW_COL=il_headers.index('View Issue')+1

    p_fill={'P1':PALE_BLUE,'P2':GREY_LIGHT,'P3':GREY_LIGHT,'pass':LIGHT_GREEN}
    for row_i,f in enumerate(findings,3):
        pri=priority(f)
        # Title fallback: never show the raw Finding ID as the title
        _t=(f.get('title') or f.get('label') or '').strip()
        if not _t or _t==f.get('id'):
            _w=str(f.get('condition') or f.get('what_wrong') or f.get('reason') or f.get('detail') or '').replace('\n',' ').strip()
            if _w:
                _t=re.split(r'(?<=[.;])\s',_w)[0]
                if len(_t)>70: _t=_t[:67].rstrip(' ,;:')+'...'
            else:
                _t=f.get('id','')
        f['title']=_t; f['label']=_t
        bg=PALE_BLUE if pri=='P1' else GREY_LIGHT if pri=='P2' else GREY_LIGHT if pri=='P3' else LIGHT_GREEN if f.get('status')=='pass' else GREY_LIGHT
        # Map old severity to High/Medium/Low
        raw_sev = (f.get('severity') or f.get('priority') or 'Medium').lower()
        sev = 'High' if raw_sev in ('fatal','critical','high','p1') else 'Low' if raw_sev in ('low','p3') else 'Medium'
        sheet=f.get('sheet',''); cell_ref=f.get('cell','A1') or 'A1'
        urgency=f.get('urgency',''); category=f.get('category','')

        # Build plain-English fields from Five C's
        issue_title = f.get('label') or f.get('id','')
        what_wrong  = f.get('condition') or f.get('reason','')
        why_matters = f.get('consequence','')
        fix_action  = f.get('corrective_action') or f.get('fix_instruction','')
        out_impact  = f.get('dollar_impact','')

        # Compute urgency from priority — no Claude field needed, keeps tone calm
        if pri == 'P1':
            urgency = 'Before next reliance'
        elif pri == 'P2':
            urgency = 'Before external circulation'
        else:
            urgency = 'When convenient'

        fscore_val = f.get('fscore', '') or '—'
        confidence_val = f.get('confidence', '')
        confidence_display = f'{confidence_val}%' if confidence_val != '' else '—'

        vals=['',f.get('id',''),pri,'Open','Relevant',urgency,
              f.get('issue_type',''),f.get('workstream',''),category,
              issue_title,what_wrong,why_matters,out_impact,
              fix_action,
              f.get('model_risk',''),f.get('key_output_impact','Unknown'),fscore_val,confidence_display,f.get('method',''),
              sheet,cell_ref,'',
              '',  # View issue — set separately
              f.get('root_cause',''),
              'Yes' if f.get('investment_grade_blocker') else 'No',
              'Yes' if f.get('escalation_flag') else 'No',
              reviewDate,'','','',
              '','',
              '','']

        for col,val in enumerate(vals,1):
            c=ws4.cell(row_i,col); c.value=val
            c.font=Fn(sz=9,bold=(col in [2,3,6]))
            c.fill=F(bg)
            c.alignment=A(h='center' if col in [3,4,5,6,7,17,18,19,20,21,22,26,27,28,30] else 'left',v='top',wrap=(col in [11,12,13,14,15,16]))
            c.border=B()

        # View issue hyperlink
        vc=ws4.cell(row_i,VIEW_COL)
        if sheet and sheet not in ('—','N/A','Multiple'):
            label='View issue' if cell_ref not in ('A1','—','N/A') else sheet
            vc.value=f'=HYPERLINK("[{sourceFile}]{sheet}!A1","{label}")'
            vc.font=Font(size=9,color=MID_BLUE,underline='single',name='Arial')
        else:
            vc.value='—'; vc.font=Fn(sz=9,col=GREY_MID)
        vc.fill=F(bg); vc.alignment=A(h='center',v='center'); vc.border=B()
        set_row(ws4,row_i,55)

    # ════════════════════════════════════════════════════════════════════════
    # TAB 5 — REMEDIATION & RETEST
    # ════════════════════════════════════════════════════════════════════════
    # Relevance Status dropdown — Relevant / Not Relevant / Needs Review
    if len(findings) > 0:
        relevance_dv = DataValidation(type='list', formula1='"Relevant,Not Relevant,Needs Review"', allow_blank=False)
        ws4.add_data_validation(relevance_dv)
        relevance_dv.add(f'E3:E{2+len(findings)}')

    ws5=wb.create_sheet('Remediation'); ws5.sheet_view.showGridLines=False; ws5.freeze_panes='A4'
    for col,w in [(1,3),(2,6),(3,14),(4,22),(5,10),(6,10),(7,10),(8,10),(9,45),(10,18),(11,14),(12,14),(13,14),(14,14),(15,14),(16,18),(17,18),(18,3)]:
        set_col(ws5,col,w)

    merge(ws5,'B1:Q1','REMEDIATION AND RETEST TRACKER',bold=True,sz=14,col=WHITE,bg=DARK_BLUE,v='center')
    fill_range(ws5,1,2,1,17,DARK_BLUE); set_row(ws5,1,28)

    # AI-generated caveat
    merge(ws5,'B2:Q2','Suggested actions are AI-generated and should be reviewed before implementation. Some recommendations may not be necessary or appropriate for the specific model.',sz=8,col=GREY_DARK,bg=PALE_BLUE,italic=True,wrap=True)
    set_row(ws5,2,26)

    rem_headers=['','#','Finding ID','Root Cause Group','Priority','F-Score','Urgency',
                 'Suggested Action','Owner','Target Date','Promised Fix Version',
                 'Retest Required','Retested By','Retest Date','Retest Result','Eligible to Close','']
    for col,h in enumerate(rem_headers,1):
        c=ws5.cell(3,col); c.value=h; c.font=Fn(bold=True,sz=9,col=WHITE)
        c.fill=F(DARK_BLUE); c.alignment=A(h='center',v='center',wrap=True); c.border=B(col=WHITE)
    set_row(ws5,3,32)

    # Only P1 and P2 in remediation
    rem_findings=[f for f in findings if priority(f) in ('P1','P2')]
    for row_i,f in enumerate(rem_findings,4):
        pri=priority(f); bg=LIGHT_AMBER if pri=='P1' else LIGHT_YELL if pri=='P2' else GREY_LIGHT
        vals=['',row_i-2,f.get('id',''),f.get('root_cause',''),pri,
              f.get('fscore','') or '—',f.get('urgency','') or '',
              f.get('corrective_action') or f.get('fix_instruction',''),
              '','','',
              'Yes','','','Pending','',
              '']
        for col,val in enumerate(vals,1):
            c=ws5.cell(row_i,col); c.value=val
            c.font=Fn(sz=9,bold=(col in [2,3,5]))
            c.fill=F(bg)
            c.alignment=A(h='center' if col in [2,5,6,7,8,12,13,14,15,16,17] else 'left',v='top',wrap=(col==9))
            c.border=B()
        set_row(ws5,row_i,50)

    # ════════════════════════════════════════════════════════════════════════
    # TAB 5B — VALIDATION MATRIX (B6) — every checklist rule with its outcome
    # ════════════════════════════════════════════════════════════════════════
    wsm=wb.create_sheet('Validation Matrix'); wsm.sheet_view.showGridLines=False; wsm.freeze_panes='A4'
    for col,w in [(1,3),(2,5),(3,12),(4,22),(5,46),(6,8),(7,11),(8,16),(9,11),(10,32),(11,24),(12,32),(13,10),(14,3)]:
        set_col(wsm,col,w)

    merge(wsm,'B1:M1','VALIDATION MATRIX — REVIEW PROCEDURES PERFORMED',bold=True,sz=14,col=WHITE,bg=DARK_BLUE,v='center')
    fill_range(wsm,1,2,1,13,DARK_BLUE); set_row(wsm,1,28)

    def _rmatch(rid,xid): return xid==rid or (xid or '').startswith(rid+'-')

    m_rows=[]; n_pass=n_issue=n_unc=n_np=0
    for rule in checklist_rules:
        rid=rule.get('id',''); tier=rule.get('_tier','Tier 2')
        rres=[r for r in ruleResults if _rmatch(rid,r.get('id',''))]
        rfnd=[f for f in findings if _rmatch(rid,f.get('id',''))]
        performed='Yes' if rres else 'No'
        issues=[r for r in rres if r.get('status') not in ('pass','uncertain')]
        unc=[r for r in rres if r.get('status')=='uncertain']
        if not rres: status='Not performed'; n_np+=1
        elif issues: status=f'Issues raised ({len(issues)})'; n_issue+=1
        elif unc: status='Uncertain'; n_unc+=1
        else: status='Pass'; n_pass+=1
        confs=[r.get('confidence') for r in rres if isinstance(r.get('confidence'),(int,float)) and r.get('confidence')]
        conf=f'{max(confs)}%' if (confs and tier=='Tier 2') else '\u2014'
        sm=re.search(r'-S(\d+)-',rid)
        if tier=='Tier 1': evidence='Full workbook \u2014 deterministic code check'
        elif sm and int(sm.group(1)) in (5,6,7,10): evidence='Deep financial data subset \u2014 full AFS/IFS/Cons/Debt/Equity/D&T/Leases'
        else: evidence='Standard data subset \u2014 all sheets, trimmed rows'
        refs=[f.get('id','') for f in rfnd]
        ref_txt=', '.join(refs[:4])+(f' +{len(refs)-4} more' if len(refs)>4 else '') if refs else '\u2014'
        if status=='Not performed': missing='Rule not returned by the review \u2014 re-run validation or test manually'
        elif status=='Uncertain': missing='Evidence insufficient for a conclusive test \u2014 see related finding'
        else: missing='\u2014'
        retest='Yes' if (issues or any(f.get('needs_retest') for f in rfnd)) else '\u2014'
        m_rows.append((rid,rule.get('source_section','') or rule.get('section',''),rule.get('label',''),tier,performed,status,conf,evidence,ref_txt,missing,retest))

    extras=len([f for f in findings if not any(_rmatch(r.get('id',''),f.get('id','')) for r in checklist_rules)])
    summ=(f'{len(checklist_rules)} rules in checklist \u2014 Performed: {len(checklist_rules)-n_np} \u00b7 Pass: {n_pass} \u00b7 '
          f'Issues raised: {n_issue} \u00b7 Uncertain: {n_unc} \u00b7 Not performed: {n_np}.'
          +(f' {extras} additional finding(s) outside the checklist \u2014 see Issue Log.' if extras else ''))
    merge(wsm,'B2:M2',summ,sz=9,col=GREY_DARK,bg=PALE_BLUE,italic=True,wrap=True); set_row(wsm,2,24)

    vm_headers=['','#','Rule ID','Test Area','Rule','Tier','Performed','Status','Confidence','Evidence Reviewed','Issue Reference(s)','Missing Evidence','Retest\nRequired','']
    for col,h in enumerate(vm_headers,1):
        c=wsm.cell(3,col); c.value=h; c.font=Fn(bold=True,sz=9,col=WHITE)
        c.fill=F(DARK_BLUE); c.alignment=A(h='center',v='center',wrap=True); c.border=B(col=WHITE)
    set_row(wsm,3,30)

    st_bg={'Pass':LIGHT_GREEN,'Uncertain':LIGHT_YELL,'Not performed':GREY_LIGHT}
    for row_i,(rid,area,label,tier,perf,status,conf,evidence,refs,missing,retest) in enumerate(m_rows,4):
        vals=['',row_i-3,rid,area,label,tier,perf,status,conf,evidence,refs,missing,retest,'']
        sbg=st_bg.get(status,LIGHT_AMBER if status.startswith('Issues') else WHITE)
        for col,val in enumerate(vals,1):
            c=wsm.cell(row_i,col); c.value=val
            c.font=Fn(sz=9,bold=(col in [3,8]))
            c.fill=F(sbg if col==8 else WHITE)
            c.alignment=A(h='center' if col in [2,6,7,9,13] else 'left',v='top',wrap=(col in [4,5,10,11,12]))
            c.border=B()
        set_row(wsm,row_i,26)

    # ════════════════════════════════════════════════════════════════════════
    # TAB 5C — ASSUMPTION REGISTER (B7) — assumption provenance template
    # ════════════════════════════════════════════════════════════════════════
    wsa=wb.create_sheet('Assumption Register'); wsa.sheet_view.showGridLines=False; wsa.freeze_panes='A4'
    for col,w in [(1,3),(2,5),(3,28),(4,30),(5,20),(6,12),(7,14),(8,26),(9,14),(10,32),(11,3)]:
        set_col(wsa,col,w)

    merge(wsa,'B1:J1','ASSUMPTION REGISTER \u2014 KEY ASSUMPTION PROVENANCE',bold=True,sz=14,col=WHITE,bg=DARK_BLUE,v='center')
    fill_range(wsa,1,2,1,10,DARK_BLUE); set_row(wsa,1,28)
    merge(wsa,'B2:J2','Related findings are pre-populated from this review. Source, Source Date, Owner, Basis and Externally Supported are for the model owner to complete and the reviewer to verify.',sz=8,col=GREY_DARK,bg=PALE_BLUE,italic=True,wrap=True)
    set_row(wsa,2,24)

    mining_areas=[('Commodity prices (PCI / thermal / benchmark)',['price','pricing','benchmark','hcc','pci','thermal']),
        ('FX rates',['fx','exchange rate','aud/usd','currency']),
        ('Production volumes & ramp-up',['production','volume','ramp','mtpa','tonn']),
        ('Product mix & quality',['product mix','quality','specification','washability']),
        ('Reserves & mine life',['reserve','resource','mine life','pit life','depletion']),
        ('Yield / recovery',['yield','recovery','wash']),
        ('Strip ratio & dilution',['strip ratio','dilution','waste']),
        ('Capital expenditure',['capex','capital expenditure','sustaining']),
        ('Operating costs',['opex','operating cost','unit cost','fob']),
        ('Royalties',['royalt']),
        ('Tax rates & treatment',['tax']),
        ('Debt terms & facilities',['debt','interest','facility','dscr','repayment','drawdown']),
        ('Discount rate / WACC',['discount rate','wacc','npv']),
        ('Inflation & escalation',['inflation','escalation','cpi']),
        ('Working capital',['working capital','receivable','payable','inventory']),
        ('Rehabilitation & closure costs',['rehabilitation','closure','restoration'])]
    generic_areas=[('Revenue drivers & pricing',['price','pricing','revenue','tariff']),
        ('Volume & growth rates',['volume','growth','ramp']),
        ('FX rates',['fx','exchange rate','currency']),
        ('Capital expenditure',['capex','capital expenditure']),
        ('Operating costs',['opex','operating cost','unit cost']),
        ('Tax rates & treatment',['tax']),
        ('Debt terms & facilities',['debt','interest','facility','dscr','repayment']),
        ('Discount rate / WACC',['discount rate','wacc','npv']),
        ('Inflation & escalation',['inflation','escalation','cpi']),
        ('Working capital',['working capital','receivable','payable','inventory'])]
    areas=mining_areas if ('mining' in (modelType or '').lower() or 'mining' in (domainSkill or '').lower()) else generic_areas

    def _ftext(f):
        return ' '.join(str(f.get(k,'') or '') for k in ('label','title','condition','reason','workstream','category')).lower()
    ftexts=[(f.get('id',''),_ftext(f)) for f in findings]

    ar_headers=['','#','Assumption Area','Related Findings','Source','Source Date','Owner','Basis (contract / market / management)','Externally\nSupported?','Notes','']
    for col,h in enumerate(ar_headers,1):
        c=wsa.cell(3,col); c.value=h; c.font=Fn(bold=True,sz=9,col=WHITE)
        c.fill=F(DARK_BLUE); c.alignment=A(h='center',v='center',wrap=True); c.border=B(col=WHITE)
    set_row(wsa,3,30)

    for row_i,(area,kws) in enumerate(areas,4):
        hits=[fid for fid,txt in ftexts if any(k in txt for k in kws)]
        ref_txt=', '.join(hits[:4])+(f' +{len(hits)-4} more' if len(hits)>4 else '') if hits else '\u2014'
        vals=['',row_i-3,area,ref_txt,'','','','','','','']
        for col,val in enumerate(vals,1):
            c=wsa.cell(row_i,col); c.value=val
            c.font=Fn(sz=9,bold=(col==3))
            c.fill=F(WHITE)
            c.alignment=A(h='center' if col in [2,9] else 'left',v='top',wrap=(col in [3,4,8,10]))
            c.border=B()
        set_row(wsa,row_i,26)

    # ════════════════════════════════════════════════════════════════════════
    # TAB 6 — FORMULA ANALYSIS
    # ════════════════════════════════════════════════════════════════════════
    ws6=wb.create_sheet('Formula Analysis'); ws6.sheet_view.showGridLines=False; ws6.freeze_panes='A3'
    for col,w in [(1,3),(2,10),(3,12),(4,8),(5,50),(6,8),(7,12),(8,40),(9,16),(10,8),(11,8),(12,8),(13,8),(14,8),(15,25),(16,10),(17,10),(18,20),(19,3)]:
        set_col(ws6,col,w)

    merge(ws6,'B1:R1','FORMULA DUE DILIGENCE — KEY FORMULA REVIEW',bold=True,sz=14,col=WHITE,bg=DARK_BLUE,v='center')
    fill_range(ws6,1,2,1,18,DARK_BLUE); set_row(ws6,1,28)

    # Stats summary
    stats=t0.get('stats',{})
    merge(ws6,'B2:D2',f"Total formulas: {stats.get('totalFormulaCells',0):,}",sz=9,col=GREY_DARK,bg=PALE_BLUE)
    merge(ws6,'E2:G2',f"Unique patterns: {stats.get('uniqueFormulaCount',0):,}",sz=9,col=GREY_DARK,bg=PALE_BLUE)
    merge(ws6,'H2:J2',f"IFERROR usage: {stats.get('totalIferrorCount',0):,}",sz=9,col=GREY_DARK,bg=PALE_BLUE)
    merge(ws6,'K2:M2',f"OFFSET: {stats.get('totalOffsetCount',0):,}",sz=9,col=AMBER,bg=LIGHT_AMBER)
    merge(ws6,'N2:P2',f"External links: {stats.get('totalExternalLinks',0)}",sz=9,col=GREY_DARK,bg=GREY_LIGHT)
    set_row(ws6,2,18)

    uf_headers=['','UFI','Sheet','Cell','Formula Text (snapshot at detection)','F-Score','Complexity\nBand',
                'F-Score Explanation','Formula Class','External\nLink','Volatile','Hardcode',
                'IFERROR','Cross-Sheet\nRefs','Precedent Sheets','Priority','Status','Reviewer\nComment','']
    for col,h in enumerate(uf_headers,1):
        c=ws6.cell(3,col); c.value=h; c.font=Fn(bold=True,sz=9,col=WHITE)
        c.fill=F(DARK_BLUE); c.alignment=A(h='center',v='center',wrap=True); c.border=B(col=WHITE)
    set_row(ws6,3,32)

    band_colors={'Critical':GREY_LIGHT,'High':LIGHT_AMBER,'Moderate':LIGHT_YELL,'Low':LIGHT_GREEN}
    ufs=t0.get('uniqueFormulas',[])
    for row_i,uf in enumerate(ufs[:200],4):  # Max 200 unique formulas
        band=uf.get('band','Low'); bg=band_colors.get(band,GREY_LIGHT)
        # Auto-generate reviewer comment for High/Moderate complexity
        auto_comment = ''
        if band in ('High','Very High','Critical','Moderate'):
            flags = []
            if uf.get('externalLinkFlag'): flags.append('references an external workbook — verify the link is current and the source file is accessible')
            if uf.get('volatileFlag'): flags.append('uses a volatile function (OFFSET/INDIRECT) — check whether a static alternative would work')
            if uf.get('iferrorFlag'): flags.append('contains error suppression — confirm this is not hiding a genuine calculation error')
            if uf.get('hardcodeFlag'): flags.append('contains hardcoded values — check whether these should be on the Inputs sheet')
            xrefs = uf.get('crossSheetRefs',0)
            if xrefs > 2: flags.append(f'references {xrefs} sheets — trace the dependency chain to confirm all source data is correct')
            if flags:
                auto_comment = 'Review required: ' + '; '.join(flags) + '.'
            else:
                auto_comment = f'Complex formula ({band} F-score). Review the logic and confirm it produces the intended result.'
        vals=['',uf.get('ufi',''),uf.get('sheet',''),uf.get('cell',''),
              uf.get('formulaText',''),uf.get('fscore',0),band,
              uf.get('explanation',''),uf.get('formulaClass',''),
              'Yes' if uf.get('externalLinkFlag') else 'No',
              'Yes' if uf.get('volatileFlag') else 'No',
              'Yes' if uf.get('hardcodeFlag') else 'No',
              'Yes' if uf.get('iferrorFlag') else 'No',
              uf.get('crossSheetRefs',0),uf.get('precedentSheets',''),
              '','OK','','']
        for col,val in enumerate(vals,1):
            c=ws6.cell(row_i,col); c.value=val
            c.font=Fn(sz=9,bold=(col in [2,6,7]))
            c.fill=F(bg)
            c.alignment=A(h='center' if col in [2,3,4,6,7,10,11,12,13,14,16,17] else 'left',v='top',wrap=(col in [5,8]))
            c.border=B()
        set_row(ws6,row_i,40)

    # ════════════════════════════════════════════════════════════════════════
    # TAB 7 — FORMULA MAP
    # ════════════════════════════════════════════════════════════════════════
    # TAB — ERROR-CODE ROOT CAUSE MATRIX (V11 §4)
    # ════════════════════════════════════════════════════════════════════════
    wse=wb.create_sheet('Error Matrix'); wse.sheet_view.showGridLines=False; wse.freeze_panes='A4'
    for col,w in [(1,3),(2,10),(3,8),(4,34),(5,34),(6,34),(7,3)]:
        set_col(wse,col,w)
    merge(wse,'B1:F1','ERROR-CODE ROOT CAUSE MATRIX',bold=True,sz=14,col=WHITE,bg=DARK_BLUE,v='center')
    fill_range(wse,1,2,1,6,DARK_BLUE); set_row(wse,1,28)
    _ifer=t0.get('stats',{}).get('totalIferrorCount',0)
    merge(wse,'B2:F2',(f'Live error values found in the workbook, grouped by code. '
        f'{_ifer:,} IFERROR/IFNA wrappers exist in this model — errors inside wrapped formulas do not appear here and may be silently masked; see Formula Due Diligence.'),
        sz=9,col=GREY_DARK,bg=PALE_BLUE,italic=True,wrap=True)
    set_row(wse,2,26)

    _ERR_GUIDE={
        '#REF!':   ('Referenced rows, columns or sheets were deleted or moved after the formula was written.',
                    'Rebuild the reference against the current layout; add named ranges for structural anchors.'),
        '#DIV/0!': ('Division where the denominator is zero or blank — typically an unguarded ratio in early or terminal periods.',
                    'Guard the denominator explicitly (IF(den=0,...)) rather than wrapping the result in IFERROR.'),
        '#N/A':    ('A lookup failed to find its key — missing key, mismatched type/format, or approximate match on unsorted data.',
                    'Confirm key existence and exact-match settings; reconcile key lists between source and lookup tables.'),
        '#VALUE!': ('Operation applied to the wrong data type — text in arithmetic, ranges of mismatched size, or stray characters in inputs.',
                    'Trace the offending operand; clean input typing and separate text from numeric columns.'),
        '#NAME?':  ('Formula references an undefined name — deleted named range, misspelled function, or missing add-in.',
                    'Repair or redefine the name; remove dependencies on unavailable add-ins.'),
        '#NUM!':   ('Invalid numeric operation — IRR failing to converge, negative value in a root/log, or overflow.',
                    'Check the input domain; for IRR provide a guess or use XIRR with explicit dates.'),
        '#NULL!':  ('Range intersection that does not intersect — usually a typo (space instead of comma/colon) in a range reference.',
                    'Correct the range operator in the formula.'),
        '#SPILL!': ('A dynamic array result is blocked by existing content in its spill range.',
                    'Clear the blocking cells or convert the formula to a fixed range.'),
    }
    hdr_cells=['','CODE','COUNT','SAMPLE LOCATIONS','TYPICAL ROOT CAUSE','RECOMMENDED ACTION','']
    for col,h in enumerate(hdr_cells,1):
        if not h: continue
        c=wse.cell(3,col); c.value=h; c.font=Fn(bold=True,sz=9,col=WHITE); c.fill=F(DARK_BLUE)
        c.alignment=A(h='center',v='center'); c.border=B(col=WHITE)
    set_row(wse,3,20)

    from collections import OrderedDict
    _by_code=OrderedDict()
    for e in errorScan:
        code=str(e.get('error','')).strip()
        if not code: continue
        _by_code.setdefault(code,[]).append(f"{e.get('sheet','')}!{e.get('cell','')}")
    row_i=4
    if not _by_code:
        merge(wse,f'B{row_i}:F{row_i}','No live error values detected in any cell. Note: errors masked by IFERROR/IFNA wrappers are not visible as live values — masking risk is assessed separately.',sz=9,col=GREY_DARK,wrap=True)
        set_row(wse,row_i,24); row_i+=1
    else:
        for code, locs in sorted(_by_code.items(), key=lambda kv:-len(kv[1])):
            cause,action=_ERR_GUIDE.get(code,('Unclassified error code.','Investigate the listed cells directly.'))
            loc_txt=', '.join(locs[:5])+(f' +{len(locs)-5} more' if len(locs)>5 else '')
            vals=['',code,len(locs),loc_txt,cause,action,'']
            for col,val in enumerate(vals,1):
                if col in (1,7): continue
                c=wse.cell(row_i,col); c.value=val
                c.font=Fn(sz=9,bold=(col==2),col=DARK_BLUE if col==2 else '000000')
                c.fill=F(PALE_BLUE if col==2 else WHITE)
                c.alignment=A(h='center' if col==3 else 'left',v='top',wrap=(col in (4,5,6)))
                c.border=B()
            set_row(wse,row_i,30); row_i+=1

    # ════════════════════════════════════════════════════════════════════════
    # TAB — TIDY-UP: REDUNDANT INPUTS (V11 §2) — full client-actionable list
    # ════════════════════════════════════════════════════════════════════════
    wst=wb.create_sheet('Redundant Inputs'); wst.sheet_view.showGridLines=False; wst.freeze_panes='A4'
    for col,w in [(1,3),(2,6),(3,14),(4,10),(5,16),(6,26),(7,14),(8,30),(9,3)]:
        set_col(wst,col,w)
    merge(wst,'B1:H1','REDUNDANT INPUTS — UNREFERENCED ASSUMPTIONS',bold=True,sz=14,col=WHITE,bg=DARK_BLUE,v='center')
    fill_range(wst,1,2,1,8,DARK_BLUE); set_row(wst,1,28)

    if not redundantIn.get('applicable',False):
        merge(wst,'B2:H2','Not applicable — no sheet matching input/assumption/driver naming was detected in this model.',sz=9,col=GREY_DARK,bg=PALE_BLUE,italic=True,wrap=True)
        set_row(wst,2,22)
    else:
        _rc=redundantIn.get('redundantCount',0); _ti=redundantIn.get('totalInputs',0)
        _pct=(100.0*_rc/_ti) if _ti else 0.0
        merge(wst,'B2:H2',(f"{_rc} of {_ti} numeric constants ({_pct:.1f}%) on {', '.join(redundantIn.get('inputSheets',[]))} are not referenced by any static formula reference. "
            f"Each cell below should be linked into the calculation chain, removed, or relabelled as a memo item. {redundantIn.get('note','')}"),
            sz=9,col=GREY_DARK,bg=PALE_BLUE,italic=True,wrap=True)
        set_row(wst,2,34)

        tu_headers=['','#','Sheet','Cell','Value (observed)','Nearby label (context)','Go to cell','Resolution (link / remove / relabel)','']
        for col,h in enumerate(tu_headers,1):
            if not h: continue
            c=wst.cell(3,col); c.value=h; c.font=Fn(bold=True,sz=9,col=WHITE); c.fill=F(DARK_BLUE)
            c.alignment=A(h='center',v='center',wrap=True); c.border=B(col=WHITE)
        set_row(wst,3,26)

        _rows=redundantIn.get('redundant',[])
        for i,item in enumerate(_rows,4):
            sheet=item.get('sheet',''); cell=item.get('cell',''); val=item.get('value','')
            label=item.get('label','') or ''
            vals=['',i-3,sheet,cell,val,label,'','' ,'']
            for col,v in enumerate(vals,1):
                if col in (1,9): continue
                c=wst.cell(i,col); c.value=v if v!='' or col in (6,8) else v
                c.font=Fn(sz=9,bold=(col==4))
                c.fill=F(WHITE)
                c.alignment=A(h='center' if col in (2,4) else 'right' if col==5 else 'left',v='top',wrap=(col in (6,8)))
                c.border=B()
            link=wst.cell(i,7)
            link.value='=HYPERLINK("[' + sourceFile + ']' + sheet + '!' + cell + '","Go to ' + cell + '")'
            link.font=Font(size=9,color=MID_BLUE,underline='single',name='Arial')
            link.alignment=A(h='center'); link.border=B()
            set_row(wst,i,16)
        if _rc>len(_rows):
            r=len(_rows)+4
            merge(wst,f'B{r}:H{r}',f'List capped at {len(_rows)} cells — {_rc-len(_rows)} further unreferenced constants exist beyond the cap.',sz=9,col=GREY_DARK,italic=True)

    # ════════════════════════════════════════════════════════════════════════
    ws7=wb.create_sheet('Sheet Dependency'); ws7.sheet_view.showGridLines=False; ws7.freeze_panes='A4'
    for col,w in [(1,3),(2,22),(3,22),(4,10),(5,16),(6,10),(7,10),(8,14),(9,18),(10,20),(11,3)]:
        set_col(ws7,col,w)

    merge(ws7,'B1:J1','SHEET DEPENDENCY ANALYSIS',bold=True,sz=14,col=WHITE,bg=DARK_BLUE,v='center')
    fill_range(ws7,1,2,1,10,DARK_BLUE); set_row(ws7,1,28)
    merge(ws7,'B2:J2','Shows how sheets reference each other. High-risk dependencies are flagged for review.',sz=9,col=GREY_DARK,bg=GREY_LIGHT)
    set_row(ws7,2,16)

    fm_headers=['','Target Sheet\n(formula lives here)','Precedent Sheet\n(sheet referenced)','Link\nCount','Direction','Avg\nF-Score','Max\nF-Score','Priority\nCount','Dependency\nRisk','Reviewer Note','']
    for col,h in enumerate(fm_headers,1):
        c=ws7.cell(3,col); c.value=h; c.font=Fn(bold=True,sz=9,col=WHITE)
        c.fill=F(DARK_BLUE); c.alignment=A(h='center',v='center',wrap=True); c.border=B(col=WHITE)
    set_row(ws7,3,32)

    risk_fill={'High':LIGHT_AMBER,'Moderate':LIGHT_YELL,'Low':LIGHT_GREEN,'Critical':LIGHT_AMBER}
    dir_fill={'Normal':LIGHT_GREEN,'External':LIGHT_AMBER,'Backward':LIGHT_AMBER,'Circular':LIGHT_AMBER}
    edges=t0.get('edgeList',[])
    for row_i,edge in enumerate(edges[:100],4):
        risk=edge.get('risk','Low'); direction=edge.get('direction','Normal')
        bg=risk_fill.get(risk,GREY_LIGHT)
        vals=['',edge.get('targetSheet',''),edge.get('precedentSheet',''),edge.get('linkCount',0),
              direction,'','',0,risk,'','']
        for col,val in enumerate(vals,1):
            c=ws7.cell(row_i,col); c.value=val
            c.font=Fn(sz=9,bold=(col==9))
            c.fill=F(dir_fill.get(direction,bg) if col==5 else bg)
            c.alignment=A(h='center' if col in [4,5,6,7,8,9] else 'left',v='center')
            c.border=B()
        set_row(ws7,row_i,18)

    # ════════════════════════════════════════════════════════════════════════
    # TAB 8 — F-SCORE RULES
    # ════════════════════════════════════════════════════════════════════════
    ws8=wb.create_sheet('F-Score Rules'); ws8.sheet_view.showGridLines=False
    for col,w in [(1,3),(2,10),(3,38),(4,42),(5,3)]: set_col(ws8,col,w)

    merge(ws8,'B1:D1','F-SCORE RULES — FORMULA COMPLEXITY SCORING METHODOLOGY',bold=True,sz=14,col=WHITE,bg=DARK_BLUE,v='center')
    fill_range(ws8,1,2,1,4,DARK_BLUE); set_row(ws8,1,28)
    merge(ws8,'B2:D2','The F-score is calculated automatically by the Tier 0 formula scanner. Every formula receives a score. Higher scores warrant closer inspection.',sz=9,col=GREY_DARK,bg=PALE_BLUE,italic=True)
    set_row(ws8,2,16)

    hdr(ws8,'B3','Score',h='center'); hdr(ws8,'C3','Feature'); hdr(ws8,'D3','Reason'); set_row(ws8,3,18)
    rules_data=[
        ('+1','Formula length > 100 characters','Longer formulas are harder to review and audit'),
        ('+2','Formula length > 250 characters','Indicates significant formula density'),
        ('+3','Formula length > 500 characters','Indicates very high formula density — consider splitting'),
        ('+1 each','Nested IF / IFS / CHOOSE / SWITCH','Nested branching increases scenario and edge-case risk'),
        ('+1','XLOOKUP / INDEX-MATCH / VLOOKUP / HLOOKUP','Lookup formulas require range and error-handling review'),
        ('+3','OFFSET or INDIRECT','Dynamic references are difficult to trace and audit'),
        ('+3','Volatile function (TODAY / NOW / RAND)','Volatile formulas recalculate on every workbook change'),
        ('+5','External workbook reference ([ marker)','Broken-link and version-control risk on file relocation'),
        ('+1','Hardcoded numeric constant inside formula','May bypass the centralised input structure'),
        ('+1','IFERROR / IFNA / ISERROR','Can hide genuine calculation errors if misused'),
        ('+5','Circularity-sensitive formula','Requires controlled iteration switch and convergence testing'),
        ('+1','> 5 arithmetic or logical operators','Moderate calculation density — review for clarity'),
        ('+2','> 10 arithmetic or logical operators','High calculation density — consider helper rows'),
        ('+1','Cross-sheet reference (! marker)','Increases dependency and traceability complexity'),
    ]
    for row_i,(score,feature,reason) in enumerate(rules_data,4):
        bg=GREY_LIGHT if row_i%2==0 else WHITE
        ws8.cell(row_i,2).value=score; ws8.cell(row_i,2).font=Fn(bold=True,sz=9); ws8.cell(row_i,2).fill=F(bg); ws8.cell(row_i,2).alignment=A(h='center'); ws8.cell(row_i,2).border=B()
        ws8.cell(row_i,3).value=feature; ws8.cell(row_i,3).font=Fn(sz=9); ws8.cell(row_i,3).fill=F(bg); ws8.cell(row_i,3).border=B()
        ws8.cell(row_i,4).value=reason; ws8.cell(row_i,4).font=Fn(sz=9); ws8.cell(row_i,4).fill=F(bg); ws8.cell(row_i,4).border=B()
        set_row(ws8,row_i,18)

    set_row(ws8,18,8)
    merge(ws8,'B19:D19','COMPLEXITY BANDS',bold=True,sz=11,col=WHITE,bg=MID_BLUE,v='center'); set_row(ws8,19,22)
    hdr(ws8,'B20','F-Score Range',h='center'); hdr(ws8,'C20','Band',h='center'); hdr(ws8,'D20','Treatment'); set_row(ws8,20,18)
    bands=[('0–3','Low',LIGHT_GREEN,'Ordinary complexity. Review through normal formula testing.'),
           ('4–7','Moderate',LIGHT_YELL,'Review for logic clarity, input linkage and copy-across consistency.'),
           ('8–12','High',LIGHT_AMBER,'Inspect carefully. Consider simplification or helper rows.'),
           ('13+','Very High',LIGHT_AMBER,'Needs detailed review. Consider simplifying or splitting into helper rows.')]
    for row_i,(score_range,band,bg,treatment) in enumerate(bands,21):
        ws8.cell(row_i,2).value=score_range; ws8.cell(row_i,2).font=Fn(bold=True,sz=9); ws8.cell(row_i,2).fill=F(bg); ws8.cell(row_i,2).alignment=A(h='center'); ws8.cell(row_i,2).border=B()
        ws8.cell(row_i,3).value=band; ws8.cell(row_i,3).font=Fn(bold=True,sz=9); ws8.cell(row_i,3).fill=F(bg); ws8.cell(row_i,3).alignment=A(h='center'); ws8.cell(row_i,3).border=B()
        ws8.cell(row_i,4).value=treatment; ws8.cell(row_i,4).font=Fn(sz=9); ws8.cell(row_i,4).fill=F(bg); ws8.cell(row_i,4).border=B()
        set_row(ws8,row_i,18)

    # ════════════════════════════════════════════════════════════════════════
    # TAB 9 — AUDIT LOG
    # ════════════════════════════════════════════════════════════════════════
    ws9=wb.create_sheet('Audit Log'); ws9.sheet_view.showGridLines=False; ws9.freeze_panes='A3'
    for col,w in [(1,3),(2,18),(3,22),(4,40),(5,40),(6,12),(7,12),(8,30),(9,3)]: set_col(ws9,col,w)

    merge(ws9,'B1:H1','AUDIT LOG — PIPELINE TRACE',bold=True,sz=14,col=WHITE,bg=DARK_BLUE,v='center')
    fill_range(ws9,1,2,1,8,DARK_BLUE); set_row(ws9,1,28)

    log_headers=['','Timestamp','Step','Action','Artifact','Result','Duration (s)','Notes','']
    for col,h in enumerate(log_headers,1):
        c=ws9.cell(2,col); c.value=h; c.font=Fn(bold=True,sz=9,col=WHITE)
        c.fill=F(DARK_BLUE); c.alignment=A(h='center' if col in [6,7] else 'left',v='center')
    set_row(ws9,2,18)

    audit_log=d.get('auditLog',[])
    result_colors={'✓ Completed':LIGHT_GREEN,'✓ Pass':LIGHT_GREEN,'⚠ Issues found':LIGHT_AMBER,'⚠ Issues':LIGHT_AMBER,'Not performed':GREY_LIGHT,'❌ Error':LIGHT_AMBER}
    for row_i,entry in enumerate(audit_log,3):
        result=entry.get('result','✓ Pass'); bg=result_colors.get(result,GREY_LIGHT)
        vals=['',entry.get('timestamp',''),entry.get('step',''),entry.get('action',''),
              entry.get('artifact',''),result,entry.get('duration',''),entry.get('notes',''),'']
        for col,val in enumerate(vals,1):
            c=ws9.cell(row_i,col); c.value=val
            c.font=Fn(sz=9,bold=(col==3))
            c.fill=F(bg)
            c.alignment=A(h='center' if col in [2,6,7] else 'left',v='top',wrap=(col in [4,5,8]))
            c.border=B()
        set_row(ws9,row_i,30)

    # ── Save ─────────────────────────────────────────────────────────────────
    wb.save(output_path)
    return {'status':'ok','tabs':13,'findings':len(findings)}

if __name__=='__main__':
    if len(sys.argv)<3:
        print('Usage: python3 build_report.py <data.json> <output.xlsx>',file=sys.stderr)
        sys.exit(1)
    result=build_report(sys.argv[1],sys.argv[2])
    print(json.dumps(result))
