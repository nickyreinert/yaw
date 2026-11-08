# PostToolUse fixtures (T-047)

Captured from a live `claude` 2.1.319 session (`claude -p`, hook script writing stdin to a file), 2026-11-08. Unedited.

- PostToolUse-Bash.json: `tool_response` = `{stdout, stderr, interrupted, isImage, noOutputExpected}`. stderr was merged into `stdout` for a command writing to both.
- PostToolUseFailure-Bash-exit3.json: a Bash command that exits 3 fires PostToolUseFailure, not PostToolUse. Output arrives as the string `error` ("Exit code 3\n<output>"); there is no `tool_response`.
- PostToolUse-Grep.json: `{mode, numFiles, filenames, content, numLines, totalLines}` (content mode).
- PostToolUse-Read.json: `{type:"text", file:{filePath, content, numLines, startLine, totalLines}}`.
- PostToolUseFailure-WebFetch.json: failure only. A successful WebFetch payload is NOT captured (the fetch proxy in the capture environment refused example.com), so the `result` shape is unverified. WebFetch ran inside a `web-fetch` subagent (`agent_id`, `agent_type` set).

Replacement check (same session type): a PostToolUse hook returning `hookSpecificOutput.updatedToolOutput` in the shapes above replaced what the model saw for Bash, Grep and Read. Not tested: wrong-shape values, WebFetch, Copilot CLI `modifiedResult`.
