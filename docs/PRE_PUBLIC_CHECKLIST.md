# Pre-Public Checklist

Use this checklist before making the repository public or sharing it with recruiters.

## Security Checklist

- [ ] No `.env` or `.env.local` files committed
- [ ] No API keys committed
- [ ] No PHI or real patient data committed
- [ ] No confidential company data committed
- [ ] No `node_modules/` committed
- [ ] No `.next/` build output committed
- [ ] Workspace exports reviewed before committing
- [ ] Screenshots reviewed for sensitive content

## Technical Checklist

- [ ] Install works
- [ ] Dev server works
- [ ] Typecheck passes
- [ ] Build passes if applicable
- [ ] README is accurate
- [ ] Screenshots added or TODO placeholders are acceptable
- [ ] `.env.example` contains placeholders only
- [ ] Public metadata does not frame the project as clinical decision support

## Product Checklist

- [ ] Disclaimer is visible
- [ ] Project is not framed as a medical product
- [ ] Project is not framed as clinical decision support
- [ ] Limitations are documented
- [ ] Mock/demo fallback states are explained
- [ ] PCT is described as a case study, not a validated product

## Safe Commands

```powershell
git status
git diff --cached
git grep -n "gsk_\|sk-or-\|OPENROUTER_API_KEY\|GROQ_API_KEY"
npm install
npm run typecheck
npm run build
```
