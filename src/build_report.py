#!/usr/bin/env python3
"""
FM Validator — _VALIDATED.xlsx Report Builder
9-tab transaction-grade audit report
"""
import sys, json, os
from datetime import datetime
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

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

    # Severity → priority mapping
    def priority(f):
        sev = (f.get('severity') or '').lower()
        if sev in ('fatal','critical'): return 'P1'
        if sev == 'high': return 'P2'
        return 'P3'

    p1 = [f for f in findings if priority(f)=='P1']
    p2 = [f for f in findings if priority(f)=='P2']
    p3 = [f for f in findings if priority(f)=='P3']

    # KPMG verdict
    # Neutral audit completion header — no verdict or reliance conclusion
    p1_open = len(p1)
    p2_open = len(p2)
    p3_open = len(p3)
    verdict_short = f'AUDIT REVIEW — {igReadiness}% OF PLANNED PROCEDURES COMPLETED'
    verdict_bg    = MID_BLUE
    verdict_text  = (igCommentary or f'The audit file has completed {igReadiness}% of the planned review procedures. This does not mean the model is approved or ready for external use. Open items are listed by priority below. Further review or retesting is required before these items can be closed.')

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
    merge(ws1,'B6:C7',verdict_short,bold=True,sz=11,col=WHITE,bg=MID_BLUE,h='left',v='center')
    merge(ws1,'D6:I7',verdict_text,sz=10,col=WHITE,bg=MID_BLUE,v='center',wrap=True)
    fill_range(ws1,6,2,7,9,MID_BLUE)
    set_row(ws1,6,18); set_row(ws1,7,18); set_row(ws1,8,8)

    # Risk rating + readiness
    merge(ws1,'B9:C9','OPEN FINDINGS',bold=True,sz=9,col=GREY_DARK,bg=GREY_LIGHT,h='center')
    merge(ws1,'B10:C11',risk_rating,bold=True,sz=12,col=DARK_BLUE,bg=GREY_LIGHT,h='center',v='center')
    for r in [10,11]:
        ws1.cell(r,2).fill=F(GREY_LIGHT)
        ws1.cell(r,3).fill=F(GREY_LIGHT)

    merge(ws1,'D9:I9','AUDIT PROCESS COMPLETION',bold=True,sz=9,col=GREY_DARK,bg=GREY_LIGHT)
    ws1['D10'].value=f'{igReadiness}%'; ws1['D10'].font=Fn(bold=True,sz=22,col=AMBER); ws1['D10'].alignment=A(h='center',v='center')
    merge(ws1,'E10:I10',f'Procedures completed: {igReadiness}% of planned review steps',sz=9,col=GREY_DARK)
    merge(ws1,'E11:I11',igCommentary or f'{len(p1)} P1 item(s) and {len(p2)} P2 item(s) require attention before this review can be closed.',sz=9,col=GREY_DARK,wrap=True)
    for r in [9,10,11]: set_row(ws1,r,18)
    set_row(ws1,12,8)

    # Priority summary
    items=[('P1 OPEN',len(p1),GREY_LIGHT,DARK_BLUE),('P2 OPEN',len(p2),GREY_LIGHT,DARK_BLUE),('P3 OPEN',len(p3),GREY_LIGHT,DARK_BLUE),
           ('','',None,None),
           ('IFERROR',t0.get('stats',{}).get('totalIferrorCount',0),LIGHT_AMBER,AMBER),
           ('OFFSET',t0.get('stats',{}).get('totalOffsetCount',0),LIGHT_YELL,DARK_BLUE),
           ('EXT LINKS',t0.get('stats',{}).get('totalExternalLinks',0),LIGHT_RED,RED),
           ('FORMULAS',t0.get('stats',{}).get('totalFormulaCells',0),PALE_BLUE,MID_BLUE)]
    for i,(label,val,bg,tc) in enumerate(items):
        col=i+2
        if not label: continue
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
    ]
    hdr(ws1,'B16','AUDIT AREA',bg=DARK_BLUE)
    ws1.merge_cells('C16:D16'); ws1['C16'].value='STATUS'; ws1['C16'].font=Fn(bold=True,col=WHITE); ws1['C16'].fill=F(DARK_BLUE); ws1['C16'].alignment=A(h='center')
    ws1.merge_cells('E16:I16'); ws1['E16'].value='SUMMARY'; ws1['E16'].font=Fn(bold=True,col=WHITE); ws1['E16'].fill=F(DARK_BLUE)
    set_row(ws1,16,18)

    for i,(area,has_issue,summary) in enumerate(status_areas,17):
        bg=PALE_BLUE if has_issue else GREY_LIGHT; status_txt='Review' if has_issue else 'Completed'
        status_bg=MID_BLUE if has_issue else GREY_DARK
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

    top10 = (p1+p2+p3)[:10]
    for i,f in enumerate(top10,28):
        pri=priority(f); bg=LIGHT_AMBER if pri=='P1' else LIGHT_YELL if pri=='P2' else GREY_LIGHT
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

    # Scope limitations
    ws1.merge_cells('B39:I39'); ws1['B39'].value='SCOPE AND LIMITATIONS'
    ws1['B39'].font=Fn(bold=True,sz=9,col=GREY_DARK); ws1['B39'].fill=F(GREY_LIGHT); ws1['B39'].alignment=A()
    ws1.merge_cells('B40:I41')
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
        ('HOW TO READ THE ISSUE LOG','Each row in the Issue Log is one finding. Findings are sorted by Priority (P1 first), then Severity, then F-Score. Use the filters on the Excel table to focus on specific areas, priorities or statuses. The View Issue link in each row jumps directly to the affected cell in the source model.'),
        ('PRIORITY LEVELS','P1 — Must be resolved before any external reliance. Affects key outputs or blocks the audit conclusion.\nP2 — Should be resolved before final issue or submission. Can be accepted with a documented rationale.\nP3 — Best practice. Address in the next model revision where practical.\nQuery — Requires confirmation from the model owner before the finding can be closed.'),
        ('WORKFLOW STATUS','New → Triage → Open → Awaiting Management Response → In Remediation → Ready for Retest → Retest Failed → Ready for Sign-off → Closed'),
        ('CLOSURE STATUS','Open: Finding is unresolved.\nClosed: Finding has been retested and confirmed resolved.\nWaived: Finding is accepted as a known risk with documented rationale and approver sign-off.\nDeferred: Resolution deferred to a future model version.\nSuperseded: Finding replaced by a more comprehensive finding.'),
        ('HOW TO RESPOND TO AN ISSUE','1. Review the finding in the Issue Log.\n2. Add your management response in the Management Response column.\n3. Update the Workflow Status to Awaiting Reviewer Response.\n4. The reviewer will confirm, accept or request further action.\n5. Once confirmed fixed, the reviewer updates status to Ready for Sign-off.'),
        ('HOW TO CLOSE AN ISSUE','Issues may only be closed when:\n• The fix has been implemented in the model;\n• The fix has been retested and confirmed by the reviewer;\n• Closure evidence is documented;\n• The reviewer has signed off.\nWaived issues require a documented commercial rationale and approver sign-off.'),
        ('VIEW ISSUE LINKS','Each finding with a known cell location includes a View Issue hyperlink. These links work best on Windows Excel when both files are open in the same Excel instance and stored in the same folder. On Mac Excel, links may fail with a reference error — this is an Excel limitation, not a report error. If a link fails, use the Sheet and Cell columns to navigate to the issue manually. The Sheet and Cell values are always accurate regardless of hyperlink behaviour.'),
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

    il_headers=['','Finding ID','Priority','Workflow Status','Closure Status','Severity','Urgency',
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

    p_fill={'P1':PALE_BLUE,'P2':GREY_LIGHT,'P3':GREY_LIGHT,'pass':LIGHT_GREEN}
    for row_i,f in enumerate(findings,3):
        pri=priority(f)
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

        vals=['',f.get('id',''),pri,'Open','Open',sev,urgency,
              f.get('issue_type',''),f.get('workstream',''),category,
              issue_title,what_wrong,why_matters,out_impact,
              fix_action,
              f.get('model_risk',''),f.get('key_output_impact',''),'','',f.get('method',''),
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
        vc=ws4.cell(row_i,24)
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
    ws5=wb.create_sheet('Remediation'); ws5.sheet_view.showGridLines=False; ws5.freeze_panes='A3'
    for col,w in [(1,3),(2,6),(3,14),(4,22),(5,10),(6,10),(7,10),(8,10),(9,45),(10,18),(11,14),(12,14),(13,14),(14,14),(15,14),(16,18),(17,18),(18,3)]:
        set_col(ws5,col,w)

    merge(ws5,'B1:Q1','REMEDIATION AND RETEST TRACKER',bold=True,sz=14,col=WHITE,bg=DARK_BLUE,v='center')
    fill_range(ws5,1,2,1,17,DARK_BLUE); set_row(ws5,1,28)

    rem_headers=['','#','Finding ID','Root Cause Group','Priority','F-Score','Severity','Urgency',
                 'Specific Action Required','Owner','Target Date','Promised Fix Version',
                 'Retest Required','Retested By','Retest Date','Retest Result','Eligible to Close','']
    for col,h in enumerate(rem_headers,1):
        c=ws5.cell(2,col); c.value=h; c.font=Fn(bold=True,sz=9,col=WHITE)
        c.fill=F(DARK_BLUE); c.alignment=A(h='center',v='center',wrap=True); c.border=B(col=WHITE)
    set_row(ws5,2,32)

    # Only P1 and P2 in remediation
    rem_findings=[f for f in findings if priority(f) in ('P1','P2')]
    for row_i,f in enumerate(rem_findings,3):
        pri=priority(f); bg=LIGHT_AMBER if pri=='P1' else LIGHT_YELL if pri=='P2' else GREY_LIGHT
        raw_sev2 = (f.get('severity') or f.get('priority') or 'Medium').lower()
        sev2 = 'High' if raw_sev2 in ('fatal','critical','high','p1') else 'Low' if raw_sev2 in ('low','p3') else 'Medium'
        vals=['',row_i-2,f.get('id',''),f.get('root_cause',''),pri,
              f.get('fscore','') or '—',sev2,f.get('urgency','') or '',
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
    # TAB 6 — FORMULA ANALYSIS
    # ════════════════════════════════════════════════════════════════════════
    ws6=wb.create_sheet('Formula Analysis'); ws6.sheet_view.showGridLines=False; ws6.freeze_panes='A3'
    for col,w in [(1,3),(2,10),(3,12),(4,8),(5,50),(6,8),(7,12),(8,40),(9,16),(10,8),(11,8),(12,8),(13,8),(14,8),(15,25),(16,10),(17,10),(18,20),(19,3)]:
        set_col(ws6,col,w)

    merge(ws6,'B1:R1','FORMULA ANALYSIS — UNIQUE FORMULA REVIEW (UFI)',bold=True,sz=14,col=WHITE,bg=DARK_BLUE,v='center')
    fill_range(ws6,1,2,1,18,DARK_BLUE); set_row(ws6,1,28)

    # Stats summary
    stats=t0.get('stats',{})
    merge(ws6,'B2:D2',f"Total formulas: {stats.get('totalFormulaCells',0):,}",sz=9,col=GREY_DARK,bg=PALE_BLUE)
    merge(ws6,'E2:G2',f"Unique patterns: {stats.get('uniqueFormulaCount',0):,}",sz=9,col=GREY_DARK,bg=PALE_BLUE)
    merge(ws6,'H2:J2',f"IFERROR usage: {stats.get('totalIferrorCount',0):,}",sz=9,col=GREY_DARK,bg=PALE_BLUE)
    merge(ws6,'K2:M2',f"OFFSET: {stats.get('totalOffsetCount',0):,}",sz=9,col=AMBER,bg=LIGHT_AMBER)
    merge(ws6,'N2:P2',f"External links: {stats.get('totalExternalLinks',0)}",sz=9,col=RED,bg=LIGHT_RED)
    set_row(ws6,2,18)

    uf_headers=['','UFI','Sheet','Cell','Formula Text (snapshot at detection)','F-Score','Complexity\nBand',
                'F-Score Explanation','Formula Class','External\nLink','Volatile','Hardcode',
                'IFERROR','Cross-Sheet\nRefs','Precedent Sheets','Priority','Status','Reviewer\nComment','']
    for col,h in enumerate(uf_headers,1):
        c=ws6.cell(3,col); c.value=h; c.font=Fn(bold=True,sz=9,col=WHITE)
        c.fill=F(DARK_BLUE); c.alignment=A(h='center',v='center',wrap=True); c.border=B(col=WHITE)
    set_row(ws6,3,32)

    band_colors={'Critical':LIGHT_RED,'High':LIGHT_AMBER,'Moderate':LIGHT_YELL,'Low':LIGHT_GREEN}
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

    risk_fill={'High':LIGHT_RED,'Moderate':LIGHT_AMBER,'Low':LIGHT_GREEN,'Critical':LIGHT_RED}
    dir_fill={'Normal':LIGHT_GREEN,'External':LIGHT_RED,'Backward':LIGHT_RED,'Circular':LIGHT_RED}
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
    return {'status':'ok','tabs':9,'findings':len(findings)}

if __name__=='__main__':
    if len(sys.argv)<3:
        print('Usage: python3 build_report.py <data.json> <output.xlsx>',file=sys.stderr)
        sys.exit(1)
    result=build_report(sys.argv[1],sys.argv[2])
    print(json.dumps(result))
