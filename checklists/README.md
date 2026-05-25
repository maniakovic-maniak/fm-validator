# Checklists

This directory contains separate financial model validation checklists for different use cases.

## Available Checklists

### 1. **checklist.json** (Active by Default)
- **Rules:** 18 core rules
- **Purpose:** Default validation for this project
- **Coverage:** Essential structural and financial integrity checks
- **Status:** ✅ Currently active

**Includes:**
- 6 Tier 1 rules (critical structural checks)
- 12 Tier 2 rules (financial integrity tests)

### 2. **checklist-full.json** (Comprehensive)
- **Rules:** 38 comprehensive rules
- **Purpose:** Full reliance-grade validation (FAST + Big Four standards)
- **Coverage:** All 10 sections of a complete financial model audit
- **Status:** ⏸ Not active (enable when needed)

**Includes:**
- 6 Tier 1 rules (same critical structural checks)
- 32 Tier 2 rules (comprehensive financial, operational, and governance checks)

## Configuration

### Active Checklist
The active checklist is controlled by `config.json`. Currently set to use `checklist.json`.

### Switching Checklists

To switch to the full checklist:

1. **Method 1:** Edit `config.json`
   ```json
   {
     "activeChecklist": "checklist-full.json"
   }
   ```

2. **Method 2:** Update the `availableChecklists` array to set `active: true` for your desired checklist

### Priority Rules
- **For this project:** Use `checklist.json` (18 rules) — lightweight validation
- **For future use:** Use `checklist-full.json` (38 rules) — comprehensive audit when explicitly enabled

## File Structure

```
/checklists/
  ├── checklist.json           # 18-rule core checklist (active)
  ├── checklist-full.json      # 38-rule full checklist (inactive)
  ├── config.json              # Configuration file
  └── README.md                # This file
```

## How to Use

1. **Running validation with the active checklist:** Validator will use `checklist.json` by default
2. **Switching to full checklist:** Update `config.json` and restart the validator
3. **Individual checklist calls:** Can explicitly reference a specific checklist file by path

## Notes

- Both checklists use the same report tab format and fix policy
- Tier 1 rules are identical across both checklists (critical structural checks)
- Tier 2 rules expand significantly in the full checklist to cover all 10 audit sections
- The full checklist is designed for reliance-grade validation and contains advanced checks for scenarios, covenants, and model documentation
