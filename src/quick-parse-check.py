#!/usr/bin/env python3
"""
Quick fallback parse check — used ONLY when ExcelJS fails to open a file
in upload-integrity-check.js. Not a full validation pass, just a second
opinion on one question: is this file genuinely unreadable, or does
another real library (openpyxl) open it fine, meaning ExcelJS hit a
compatibility gap on a valid file rather than the file actually being
corrupted.

read_only=True is used deliberately for speed, matching this project's
own established convention elsewhere (recalc_check.py) — confirmed on a
1.15M-cell file to use ~55MB and avoid the OOM risk of openpyxl's
default mode.

Usage: python3 quick-parse-check.py <file_path>
Prints JSON {"ok": true, "sheetNames": [...]} on success to stdout.
Prints an error message to stderr and exits 1 on genuine failure.
"""
import sys
import json

def main():
    if len(sys.argv) < 2:
        print("Usage: quick-parse-check.py <file_path>", file=sys.stderr)
        sys.exit(1)

    file_path = sys.argv[1]

    try:
        import openpyxl
    except ImportError:
        print("openpyxl not installed", file=sys.stderr)
        sys.exit(1)

    try:
        wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
        sheet_names = wb.sheetnames
        wb.close()
        print(json.dumps({"ok": True, "sheetNames": sheet_names}))
        sys.exit(0)
    except Exception as e:
        # Openpyxl's own exception messages for password-protected files
        # typically mention "encrypt" or similar — surfaced as-is so the
        # caller can distinguish this from genuine corruption.
        print(str(e), file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
