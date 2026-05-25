# Separate Checklists Setup Summary

## ✅ Completed Setup

Two separate checklists have been successfully added to the project:

### Directory Structure
```
project-root/
└── checklists/
    ├── checklist.json           (18 rules) ← ACTIVE by default
    ├── checklist-full.json      (38 rules) ← Comprehensive (inactive)
    ├── config.json              ← Configuration file
    └── README.md                ← Usage documentation
```

---

## Checklist Details

### 1. **checklist.json** — Core Validation (18 rules) ✅ ACTIVE
**Use Case:** Default validation for this project

**Composition:**
- **Tier 1 (Critical):** 6 rules
  - Required sheets structure
  - No formula errors
  - Model Issues tab empty
  - Balance sheet check exists
  - Cash flow reconciliation exists
  - No negative PP&E values

- **Tier 2 (Financial Integrity):** 12 rules
  - Balance sheet balances for every period
  - Cash flow reconciliation
  - Retained earnings flow-through
  - Equity movement reconciliation
  - Working capital reconciliation
  - Logical balance sheet positions
  - Tax calculation validity
  - Deferred tax disclosure
  - Segment revenue totals
  - EBITDA margin plausibility
  - Debt repayment coherence
  - Capital expenditure timing

---

### 2. **checklist-full.json** — Comprehensive Validation (38 rules) ⏸ INACTIVE
**Use Case:** Full reliance-grade audit (FAST + Big Four standards)

**Composition:**
- **Tier 1 (Critical):** 6 rules (same as core)
- **Tier 2 (Comprehensive):** 32 rules covering:
  - **Section 1:** Model Purpose & Transparency (FAST principles)
  - **Section 2:** Model Structure (architecturally sound)
  - **Section 3:** Input Management (centralized assumptions)
  - **Section 4:** Formula Logic (consistency & sign conventions)
  - **Section 5:** Financial Statements (all reconciliations)
  - **Section 6:** Debt Management (schedules, covenants, capex)
  - **Section 7:** Operations & Returns (revenue drivers, margins, IRR/NPV)
  - **Section 8:** Scenarios & Sensitivities (controls & response logic)
  - **Section 9:** Model Integrity & Documentation (checks, change logs)
  - **Section 10:** Dashboard & Documentation (KPIs, cover sheet)

---

## Configuration

### Current Priority Settings

| Setting | Value | Purpose |
|---------|-------|---------|
| **Active Checklist** | `checklist.json` | Default validator uses 18-rule core checklist |
| **Default Purpose** | Lightweight validation | Fast, focused audits for this project |
| **Full Checklist Status** | Available but inactive | Can be enabled individually for comprehensive audits |

---

## How to Switch Checklists

### To activate the full checklist:

**Option 1: Edit `config.json`**
```json
{
  "activeChecklist": "checklist-full.json"
}
```

**Option 2: Update the `availableChecklists` array**
```json
"availableChecklists": [
  {
    "name": "checklist.json",
    "active": false  // ← Set to false
  },
  {
    "name": "checklist-full.json",
    "active": true   // ← Set to true
  }
]
```

---

## Files Created

| File | Size | Purpose |
|------|------|---------|
| `checklist.json` | 9.0 KB | Core 18-rule checklist (active) |
| `checklist-full.json` | 18 KB | Full 38-rule checklist (inactive) |
| `config.json` | 879 B | Configuration & checklist registry |
| `README.md` | 2.4 KB | Usage documentation |

---

## Usage

1. **Default validation** → Uses `checklist.json` (18 rules)
2. **Switch to full validation** → Update `config.json` to activate `checklist-full.json` (38 rules)
3. **Reference specific checklist** → Applications can call individual files directly:
   - `./checklists/checklist.json`
   - `./checklists/checklist-full.json`

---

## Key Features

✅ **Two independent checklists** with clear separation of concerns  
✅ **18-rule core checklist** for lightweight validation (active by default)  
✅ **38-rule comprehensive checklist** for reliance-grade audits (available on demand)  
✅ **Configuration file** for easy switching between checklists  
✅ **Documentation** for setup and usage instructions  
✅ **Valid JSON** files ready for integration  
✅ **Priority set** to use core checklist for this project, full checklist for future individual calls  

---

## Next Steps

- Integrate the checklists into your validator application
- Update your application to read from `config.json` to determine the active checklist
- Test validation with both checklists to ensure correct behavior
- Switch between checklists as needed for different audit requirements
