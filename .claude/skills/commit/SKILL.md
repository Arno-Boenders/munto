---
name: commit
description: Review-then-commit workflow for Munto, with a branch and a pull request per feature or fix. Use this every time the user wants work saved to git — "commit", "push", "ship it", "save this", "make a PR", "get this on main" — and whenever you're about to run `git commit` for any other reason. It reviews the pending diff, fixes what it finds, runs the tests and the build, commits on a feature/ or fix/ branch, and pushes it and opens a PR when asked.
---

# /commit — review, fix, verify, commit on a branch, PR

Work never lands straight on `main`. Every change goes on its own branch cut from `origin/main`
and reaches `main` as a pull request that the user squash-merges on GitHub. You commit, push and
open the PR; the merge is theirs. Batch related commands; aim for about six calls in total.

## Machine quirks (they break the obvious commands)

- A shell hook rewrites `git …` into `rtk git …`, and `git push` through it once pushed the wrong
  commit. Run git as `/usr/bin/git`.
- Global git config sets `diff.external` to VS Code: always `/usr/bin/git --no-pager diff --no-ext-diff`.
- Never pipe code on stdin (`node -e "$(…)"`, heredocs into an interpreter): write a scratchpad
  script and run it.

## 1. Look (one call)

```bash
/usr/bin/git fetch -q origin && /usr/bin/git status -sb && /usr/bin/git ls-files --others --exclude-standard \
  && /usr/bin/git --no-pager diff --no-ext-diff HEAD -U12
```

Untracked files need a conscious yes. `.env`, `secrets/`, `data/`, `*.pem`, `config/categories.json`,
`.impeccable/` and build output (`.next*/`, `dist/`) never go in: they hold bank keys, IBANs and real
amounts. The block `next dev` re-adds to `AGENTS.md` is expected — commit it.

## 2. Branch

On `main` (or a branch already merged): `/usr/bin/git switch -c <type>/<short-name> origin/main`
carries the uncommitted work along. `feature/<name>` for something new, `fix/<name>` for a bug,
`chore/<name>` for tooling and docs. A mixed batch with disjoint files becomes two branches. Already
on an open feature branch for this same work: stay on it.

PRs are squash-merged, so a branch cut from an older unmerged branch conflicts with `main` later.
Always cut from `origin/main`; before the PR, `/usr/bin/git merge-tree --write-tree origin/main HEAD`
must be clean. If it conflicts only because of a squash, replay the new commits with
`/usr/bin/git rebase --onto origin/main <last-merged-commit>`.

## 3. Review, digging only where a hunk depends on something outside it

`grep -n <symbol> src components lib` for call sites and existing helpers; `sed -n a,bp` for a range.

- **Would it work?** Both runtimes: `src/` runs in Next.js and, for `sync`/`seed`, as a child
  process (Electron as Node in the desktop app) — relative paths, env vars and the data folder
  (`src/paths.js`) must work in both. Next.js APIs here are newer than memory: check
  `node_modules/next/dist/docs/`. Windows and Linux too (CI runs both): `join`, not `/`.
- **Privacy.** Nothing about the user's money leaves the machine except to their bank and the AI
  they chose (`src/ai.js`): no new network calls, no amounts in logs or error messages sent anywhere.
  Links opened from the app stay https-only.
- **Duplicate and redundant code.** Shared helpers live in `lib/` and `src/`. Unused imports, dead
  branches, `console.log`, comments narrating the code.
- **Words.** The interface says *pot*, never *envelope*; amounts go through `Money`.

## 4. Fix forward, then verify — in the same call

Fix what's clearly right, in the diff's scope. Never `git checkout --`, `git restore` or `git stash`
to undo your own edit: that throws away the user's work too. End the same call with:

```bash
npm test 2>&1 | grep -E '^# (pass|fail)' && NEXT_DIST_DIR=.next-check npm run build 2>&1 | tail -5; rm -rf .next-check
```

(`.next-check` keeps the build away from a running `npm run ui` or `npm run app`.) The build is
needed when components, `app/`, `next.config` or dependencies changed; tests always. Red → fix and
re-run; don't commit on red unless the user says to, and then say so in the body.

## 5. Privacy check by a separate agent (every commit, no exceptions)

Every commit is checked by a fresh agent before it's made, because the repo is or will be public
and anything pushed can't be fully taken back. The agent hasn't seen the conversation, so it judges
only what will actually go out. You can't skip this step, even for a one-line change or a docs fix.

1. Stage the paths, then write what will go out to the scratchpad:
   `/usr/bin/git add <paths> && /usr/bin/git --no-pager diff --no-ext-diff --cached > <scratchpad>/outgoing.diff`,
   and put the planned commit subject and body (and, when pushing, the PR title and body) in
   `<scratchpad>/outgoing-text.md`.
2. Spawn an agent (`subagent_type: "general-purpose"`) with this brief, filling in both paths:

   > You are a privacy gate for a public open-source repo (a personal budget app). Read
   > `<outgoing.diff>` and `<outgoing-text.md>` completely. They hold a git diff plus the commit
   > message and PR text that are about to be pushed. Report anything that identifies a real person or
   > reveals their finances: **VAT/BTW/company numbers** (for example BE0123.456.789), national
   > register numbers, **IBANs** and account numbers, card numbers, **real-looking money amounts**,
   > balances or salaries, **names of people**, home addresses, phone numbers and e-mail
   > addresses, real merchant or payee names, employer names, which banks someone uses, transaction
   > counts, API keys, tokens, private keys, certificates, and `.env` content. Clearly made-up
   > placeholders are fine: €12.34, "Bakery", "Jane Doe", BE00 0000 0000 0000, example.com. So are
   > the names of public companies and banks that the code integrates with in general, like Enable
   > Banking or Perplexity, when they're mentioned as features and not as "my bank". For each hit,
   > give the file, the line, the text, and why it's a problem. If you're unsure, report it. End with
   > exactly `VERDICT: CLEAN` or `VERDICT: BLOCK`.
3. `BLOCK` → replace each hit with a made-up placeholder, or unstage the file, and run the agent
   again on the new diff. Only commit on `CLEAN`. Never commit over a `BLOCK` without asking the
   user, and show them the hits when you ask. Mention the verdict in the report.

## 6. Commit (one call)

```bash
/usr/bin/git --no-pager diff --no-ext-diff --stat --cached
/usr/bin/git commit -q -m "<subject>" -m "<why>" && /usr/bin/git log --oneline -3
```

The message must be the one the privacy agent checked. If you change it, check it again.

This repo's subjects are plain sentences about what the user gets, under ~72 chars, no `feat:`
prefix: "The account balance is what's there now, not last night's closing balance". The body says
why, and anything to do by hand. End with the attribution trailer from the system reminder.

## 7. Push and open the PR (when the user asks to push, PR or ship)

The PR title and body go through the privacy agent too (step 5): if they weren't in
`outgoing-text.md` yet, check them before `gh pr create`.

```bash
/usr/bin/git push origin HEAD:refs/heads/<branch> && /usr/bin/git ls-remote origin <branch>
gh pr create --base main --head <branch> --title "<plain title>" --body "<what, why, how it was checked>"
```

Check `ls-remote` shows your HEAD. Never force-push: if the remote branch moved (another session),
push under a new branch name. Don't merge the PR yourself unless the user asks; if they do,
`gh pr merge <n> --squash`, then `/usr/bin/git switch main && /usr/bin/git pull --ff-only`.

**Branches:** while the repo is private, merged branches may be cleaned up when the user asks.
Once it's public (`gh repo view --json visibility`), merged branches stay. Don't delete them, and
don't pass `--delete-branch`.
Stacked PRs: when the base PR merges, retarget the child to `main` before merging it.

The PR body: a short summary, what the user will notice, how it was verified (tests, build, what was
looked at in the app), and anything they must do after merging (`npm run app:install`, a setting).
End it with the PR attribution line from the system reminder.

**Nothing from the user's own money goes in git or GitHub.** The repo may go public, and PR
descriptions, comments and commit messages can't be fully taken back (PRs can't be deleted, and
edits keep their history). So no real amounts, balances, merchant or payee names, IBANs, account
names, transaction counts, or which banks the user has, in commit messages, PR titles and bodies,
comments, code comments or test fixtures. Describe the behaviour instead ("a bank that sends both
balances"), and when an example helps, use made-up figures (€12.34, "Bakery", BE00 0000 0000 0000).
Sync output, screenshots and database rows you looked at stay in the conversation.

## 8. Report

```
Reviewed and committed on fix/balance-today.

Fixed during review:
- src/sync.js:107 — …

Verified: 83 tests, build, privacy check CLEAN
Commits: d9679dc The account balance is what's there now…
PR: https://github.com/Arno-Boenders/munto/pull/12      ← or "Not pushed (not asked)."
```

A clean review is a real result: say "nothing needed fixing" rather than inventing findings.
