#!/usr/bin/env python3
"""
extract_vba.py — Wave 2 VBA/macro review engine, Python extraction layer.

Reads a .xlsm/.xlsb/.xls (or any oletools-supported) workbook, extracts all
VBA module source code, and runs oletools' built-in risk scanner separately
per module so findings can be attributed to a specific module by name — the
same "cite the real location" principle already used for formula cells via
_cellRef in validator-tier2.js.

This script never raises on a handleable failure (missing VBA, corrupt file,
password-protected project). It always emits a single JSON object to stdout
and exits 0, so the Node.js subprocess wrapper can parse the result the same
way runBatch() parses Claude's JSON responses — no special-casing a non-zero
exit code as a distinct failure path.

Usage:
    python3 extract_vba.py <path_to_workbook> [--include-attributes]

Output JSON shape:
{
  "hasVbaProject": bool,
  "fileType": "OLE" | "OpenXML" | "Word2003_XML" | "MHTML" | null,
  "moduleCount": int,
  "modules": [
    {
      "name": "Module1",              # VBA module name (e.g. "Module1", "Sheet1")
      "vbaFilename": "Module1.bas",   # filename as stored in the VBA project
      "streamPath": "VBA/Module1",
      "moduleType": "bas" | "cls" | "frm" | "unknown",
      "lineCount": int,
      "sourceCode": "...",            # full extracted source, boilerplate included
      "findings": [
        {
          "category": "AutoExec" | "Suspicious" | "IOC" | "ObfuscatedString",
          "keyword": "Shell",
          "description": "May run an executable file or a system command"
        }, ...
      ]
    }, ...
  ],
  "summary": {
    "autoExecCount": int,
    "suspiciousCount": int,
    "iocCount": int,
    "obfuscatedStringCount": int,
    "modulesWithFindings": int
  },
  "error": null | "human-readable message"
}
"""

import sys
import json
import argparse

# Map oletools' internal kw_type strings to our stable category names.
# oletools has used a couple of different labels across versions for the
# same concept, so this is intentionally a bit permissive.
_CATEGORY_MAP = {
    'AutoExec': 'AutoExec',
    'Suspicious': 'Suspicious',
    'IOC': 'IOC',
    'Hex String': 'ObfuscatedString',
    'Base64 String': 'ObfuscatedString',
    'Dridex String': 'ObfuscatedString',
    'VBA obfuscated Strings': 'ObfuscatedString',
}


def _module_type(vba_filename):
    # TODO (untested coverage gap, tracked 2026-07-11): .frm (UserForm)
    # modules are handled identically to .bas/.cls here — extracted and
    # scanned the same way — but this path has never actually been
    # exercised against a real file containing a UserForm. Neither of the
    # two production models tested so far (Carlsberg, Sunrise/KPMG) had
    # one. If a real UserForm-containing file surfaces, worth specifically
    # checking: (1) does VBA_Scanner's keyword scan behave sensibly against
    # form-designer boilerplate the way it does against class-module
    # boilerplate (see _strip_boilerplate_attributes above — forms may have
    # their own auto-generated preamble worth checking for false positives
    # the same way), and (2) does extract_macros() return the form's actual
    # code-behind cleanly, separate from the .frx binary resource data.
    if not vba_filename or '.' not in vba_filename:
        return 'unknown'
    ext = vba_filename.rsplit('.', 1)[-1].lower()
    if ext in ('bas', 'cls', 'frm'):
        return ext
    return 'unknown'


# Every class module Excel generates (ThisWorkbook, Sheet1, Sheet2, ...)
# starts with a fixed 8-line boilerplate preamble that VBA_Scanner's hex-
# string heuristic mistakes for obfuscation, because "VB_Base" carries a
# hardcoded COM CLSID GUID such as {00020819-0000-0000-C000-000000000046}
# (Excel.Sheet's own interface ID). This is Office-generated scaffolding
# present in every single VBA project, not attacker content, so it's
# stripped before scanning rather than left to generate a false positive
# on every module of every file. The full source (preamble included) is
# still kept in sourceCode for citation/display purposes.
_BOILERPLATE_ATTR_RE = None  # compiled lazily


def _strip_boilerplate_attributes(source_code):
    import re
    global _BOILERPLATE_ATTR_RE
    if _BOILERPLATE_ATTR_RE is None:
        _BOILERPLATE_ATTR_RE = re.compile(
            r'^Attribute\s+VB_(Name|Base|GlobalNameSpace|Creatable|PredeclaredId|'
            r'Exposed|TemplateDerived|Customizable)\s*=.*$',
            re.IGNORECASE | re.MULTILINE
        )
    return _BOILERPLATE_ATTR_RE.sub('', source_code)


def _scan_module(source_code):
    """Run oletools' VBA_Scanner against a single module's source and
    normalise the results into our finding shape. Isolated per-module so a
    scanner error on one module (e.g. a malformed obfuscation payload)
    doesn't take down the whole extraction."""
    from oletools.olevba import VBA_Scanner

    findings = []
    scannable_code = _strip_boilerplate_attributes(source_code)
    try:
        scanner = VBA_Scanner(scannable_code)
        for kw_type, keyword, description in scanner.scan(include_decoded_strings=True):
            category = _CATEGORY_MAP.get(kw_type, kw_type)
            findings.append({
                'category': category,
                'keyword': keyword,
                'description': description,
            })
    except Exception as e:
        findings.append({
            'category': 'ScanError',
            'keyword': '',
            'description': f'VBA_Scanner could not fully analyse this module: {e}',
        })
    return findings


def _is_encrypted(file_path):
    """Check whether the workbook itself is password-encrypted, independent
    of oletools/VBA_Parser. This matters because VBA_Parser, when pointed at
    an encrypted OOXML file, can open the outer OLE container (which is a
    legitimate, structurally valid OLE file wrapping the real encrypted
    content) and conclude "no VBA macros found" — a false negative, not a
    caught error, since it never actually saw the real (encrypted) content.
    Checking encryption status explicitly, before ever calling VBA_Parser,
    turns that silent false negative into an honest "cannot verify".

    Returns False (not encrypted, or format not recognised by msoffcrypto —
    e.g. a plain-text file with a misleading .xlsm extension) rather than
    raising, so this check never blocks extraction for files it can't
    classify; it only ever escalates a *positive, confirmed* encryption
    finding.
    """
    try:
        import msoffcrypto
        with open(file_path, 'rb') as f:
            office_file = msoffcrypto.OfficeFile(f)
            return bool(office_file.is_encrypted())
    except Exception:
        return False


def extract_vba(file_path, include_attributes=False):
    from oletools.olevba import VBA_Parser

    result = {
        'hasVbaProject': False,
        'encrypted': False,
        'fileType': None,
        'moduleCount': 0,
        'modules': [],
        'summary': {
            'autoExecCount': 0,
            'suspiciousCount': 0,
            'iocCount': 0,
            'obfuscatedStringCount': 0,
            'modulesWithFindings': 0,
        },
        'error': None,
    }

    if _is_encrypted(file_path):
        result['encrypted'] = True
        result['hasVbaProject'] = None  # genuinely unknown, not False — we never got to look
        result['error'] = ('This workbook is password-encrypted. VBA content cannot be '
                            'inspected without the password — this is a "cannot verify", '
                            'not a "no macros found" result.')
        return result

    try:
        vba_parser = VBA_Parser(file_path)
    except Exception as e:
        result['error'] = f'Could not open file for VBA analysis: {e}'
        return result

    try:
        result['fileType'] = vba_parser.type

        has_macros = vba_parser.detect_vba_macros()
        result['hasVbaProject'] = bool(has_macros)

        if not has_macros:
            return result

        for (filename, stream_path, vba_filename, vba_code) in vba_parser.extract_macros():
            # vba_code can be None for some non-source streams (e.g. XLM);
            # skip anything we can't actually treat as source text.
            if vba_code is None:
                continue

            findings = _scan_module(vba_code)

            module_name = vba_filename.rsplit('.', 1)[0] if vba_filename else (stream_path or 'Unknown')

            module_entry = {
                'name': module_name,
                'vbaFilename': vba_filename,
                'streamPath': stream_path,
                'moduleType': _module_type(vba_filename),
                'lineCount': vba_code.count('\n') + 1,
                'sourceCode': vba_code,
                'findings': findings,
            }
            result['modules'].append(module_entry)

            if findings:
                result['summary']['modulesWithFindings'] += 1
            for f in findings:
                if f['category'] == 'AutoExec':
                    result['summary']['autoExecCount'] += 1
                elif f['category'] == 'Suspicious':
                    result['summary']['suspiciousCount'] += 1
                elif f['category'] == 'IOC':
                    result['summary']['iocCount'] += 1
                elif f['category'] == 'ObfuscatedString':
                    result['summary']['obfuscatedStringCount'] += 1

        result['moduleCount'] = len(result['modules'])

    except Exception as e:
        # Partial results (if any modules were already extracted) are kept —
        # same "don't throw away what worked" pattern as the Tier 2 batch
        # error handling, which appends an error finding rather than
        # discarding results from batches that already succeeded.
        result['error'] = f'VBA extraction encountered an error partway through: {e}'
    finally:
        try:
            vba_parser.close()
        except Exception:
            pass

    return result


def main():
    parser = argparse.ArgumentParser(description='Extract and risk-scan VBA macros from an Office workbook.')
    parser.add_argument('file_path', help='Path to the .xlsm/.xlsb/.xls workbook')
    parser.add_argument('--include-attributes', action='store_true',
                         help='(reserved) include VB_Attribute boilerplate lines in output; currently always included')
    args = parser.parse_args()

    output = extract_vba(args.file_path, include_attributes=args.include_attributes)
    print(json.dumps(output))

    # Exit 0 even on a handled error — the JSON payload carries the error
    # message, and the Node wrapper checks the "error" field the same way
    # runOneBatch() checks for a caught exception rather than a process
    # exit code.
    sys.exit(0)


if __name__ == '__main__':
    main()
