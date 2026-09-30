# AGENTS.md - Billed App Context & Project Rules

Refer to `MEMORY.md` for complete rules.

## Core Directives
1. **Maintenance Inputs**:
   - Sanitize and strip special characters (`!@#$%^&*+=~`|<>?{}[];:`) across maintenance form fields.
   - `ATTENDED BY` input must always be forced to uppercase BLOCK LETTERS.
   - Employee filter dropdown in Maintenance Records must support filtering by all report authors and employees.
2. **Issue Vouchers & PDF Output**:
   - `ISSUING DEPOT / SHOP`: Display machine/depot name cleanly without `SSE/TM/` prefix.
   - `ISSUED BY / DEPOT OFFICIAL`: Show the issuing employee's name and designation dynamically.
