# Task tracking

Where your tasks live.

- **Local only:** `TASKS.md` is the list. Works offline, no GitHub needed. IDs look like `T-012`.
- **GitHub only:** GitHub issues are the list. `TASKS.md` is a read-only copy of your open issues, refreshed by `just task sync`. IDs are issue numbers (`#34`).
- **Both:** `TASKS.md` stays the list; `just task sync` copies each task to a GitHub issue (one way) and links the number.

Team projects always use GitHub only.

Example: a solo side project usually starts local; add GitHub later when others join.
