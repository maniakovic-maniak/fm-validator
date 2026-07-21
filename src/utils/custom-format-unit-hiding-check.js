// custom-format-unit-hiding-check.js — sourced from PwC Global Financial
// Modeling Guidelines' "Essence of Spreadsheet Evil" list (D1): custom
// number formats that change the DISPLAYED unit are one of the highest-
// risk items on that list. A trailing comma in a custom Excel format
// divides the displayed value by 1,000 per comma (e.g. "#,##0," shows
// thousands, "#,##0,," shows millions) — a reviewer scanning the cell's
// raw value without noticing the format can misread the magnitude by
// orders of magnitude.
//
// Framed as INFORMATIONAL, not an assertion that a label is missing:
// verifying whether a nearby header genuinely documents the scale is a
// harder, more fragile problem than this check attempts — it flags the
// presence of a scaling format for review, consistent with this
// project's "flag for review" pattern rather than asserting an error.

// A SCALING comma sits immediately after the last digit placeholder (0
// or #) with no further digit placeholder after it — distinct from a
// THOUSANDS-SEPARATOR comma, which is always followed by more digit
// placeholders (the ",##0" inside "#,##0"). "#,##0," has a separator
// comma (followed by "##0") and then a genuine scaling comma at the end
// (followed by nothing but the format's end or quoted text).
const SCALING_COMMA_RE = /[0#](,+)(?![0#])/;

// FIX (found via real testing against The Bend, before shipping): a
// format like $0,,"M" or "($"#,##0,,"M)" divides by a million AND bakes
// an "M" (or similar) unit label directly into the displayed text —
// self-documenting, exactly the GOOD practice PwC's guidance is asking
// for, not the hiding pattern. Confirmed directly: 256 of the first
// version's findings on a real file were entirely this self-documenting
// case. A format is only genuinely "hiding" the scale if it has NO
// quoted text label anywhere after the scaling commas.
const QUOTED_LABEL_AFTER_COMMAS_RE = /,+[^"]*"[^"]+"/;

function countTrailingCommas(numFmt) {
  const m = SCALING_COMMA_RE.exec(numFmt || '');
  if (!m) return 0;
  return m[1].length;
}

function hasEmbeddedUnitLabel(numFmt) {
  return QUOTED_LABEL_AFTER_COMMAS_RE.test(numFmt || '');
}

function hasEmbeddedUnitLabel(numFmt) {
  return QUOTED_LABEL_AFTER_COMMAS_RE.test(numFmt || '');
}

function checkCustomFormatUnitHiding(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const numFmt = cell.numFmt;
        if (!numFmt || numFmt === 'General') return;
        const commas = countTrailingCommas(numFmt);
        if (commas === 0) return;
        if (hasEmbeddedUnitLabel(numFmt)) return; // self-documenting (e.g. "M" baked into the format) — not hiding anything
        const raw = cell.formula ? cell.result : cell.value;
        if (typeof raw !== 'number') return;
        const scale = Math.pow(1000, commas);
        findings.push({
          sheet: ws.name,
          cell: cell.address,
          numFmt,
          rawValue: raw,
          displayedApprox: raw / scale,
          scaleLabel: commas === 1 ? 'thousands' : commas === 2 ? 'millions' : `10^${commas * 3}`,
          note: `${ws.name}!${cell.address}'s number format (${numFmt}) divides the displayed value by ${scale.toLocaleString()} (shown in ${commas === 1 ? 'thousands' : commas === 2 ? 'millions' : 'a larger scale'}) — the raw value is ${raw}, displaying as approximately ${(raw / scale).toFixed(2)}. Confirm the sheet or column header clearly states this scale.`,
        });
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags cells using a custom number format with trailing comma(s), which scales the displayed value down (thousands, millions, etc.) without changing the underlying number — a reviewer scanning raw values without noticing the format can misread magnitude. Informational: this check does not verify whether a header already documents the scale.',
  };
}

module.exports = { checkCustomFormatUnitHiding };
