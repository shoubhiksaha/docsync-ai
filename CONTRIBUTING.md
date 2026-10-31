# Contributing to DocSync AI

Thanks for helping. This guide covers setup, the branch and release flow, and what a change needs
before it can be merged.

## Setup

```bash
cp .env.example .env.local   # every variable is documented there
npm install
npm run setup:hooks          # pre-push guard: secret scan, no direct pushes to main/staging
npm run dev                  # http://localhost:3000
```

With no AI key configured, extraction returns each document type's sample data, so most of the
app can be developed without any provider account.

## Branches and releases

- Branch from `main` and name it `feature/<short-name>` or `fix/<short-name>`.
- Open a PR into `staging`. It is merged with a merge commit (never squash or rebase) and deployed
  to the staging environment after the owner approves.
- Once the change is verified on staging, open a PR from the **same branch** into `main`
  (`npm run promote`). Never merge `staging` into your branch or into `main`.

The full flow is in [docs/RELEASE_FLOW.md](./docs/RELEASE_FLOW.md).

## Before you open a PR

```bash
npm run lint && npm run typecheck
npm run test:coverage
npm run build && npm run test:e2e
```

CI runs the same checks, plus a secret scan and a dependency audit.

- **Commit messages** use [Conventional Commits](https://www.conventionalcommits.org/) with a scope,
  for example `feat(profiles): add a cold-storage receipt` or `fix(sync): retry Sheets on 429`.
- **User-facing copy** goes in `client/i18n/`. Every English string needs a Hindi one.
- **Changes users will notice** get a line in [CHANGELOG.md](./CHANGELOG.md) under *Unreleased*.

## Adding a document type

1. Add `modules/profiles/<id>.ts` and register it in `modules/profiles/index.ts`.
2. Add `__tests__/modules/profiles/<id>.test.ts`. It must pass the shared contract in
   `__tests__/helpers/profile-contract.ts`, which checks:
   - Hindi copy;
   - mock fields that pass the profile's own checks;
   - Notion properties that match its fields;
   - a sample document.
3. Draw a sample as `scripts/samples/<id>.html` and render it with
   `node scripts/samples/render.mjs <id>`.

Use `modules/profiles/checks.ts` for vehicle numbers, phone numbers, GSTIN, money tolerance and
Aadhaar masking, rather than writing new versions. More detail is in
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Data and secrets

- **Fictional data only.** Sample documents, tests and screenshots use made-up names and numbers.
  Never commit a real customer's document.
- **Aadhaar numbers** are never stored or logged in full; profiles keep the last 4 digits.
- **Secrets** stay in `.env.local` and the deployment environments, never in the repository. The
  pre-push hook and CI scan for them.

## Reporting bugs and ideas

Use the issue templates. Report security problems privately, as described in
[SECURITY.md](./SECURITY.md).
