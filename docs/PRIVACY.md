# Privacy

Codex: Status & Actions runs locally and does not provide its own network service, analytics, crash reporting, or telemetry.

## Data read

- Task IDs, titles, working directories, timestamps, and hierarchy from local Codex `thread/list`
- Event type, timestamp, thread ID, and turn ID from local rollout JSONL files
- Hook event name, thread ID, and turn ID from local Codex hook invocations

Task titles are displayed on Stream Deck keys. Working directories are used only as a title fallback and are not forwarded.

## Data deliberately discarded

The hook process receives the standard Codex hook object, which may include sensitive fields. Before any inter-process transmission it extracts a fixed identifier allow-list and discards the rest. It does not forward or log:

- prompts or messages
- approval command text
- questions or answers
- tool input or output
- transcript paths
- file contents or patches

## Local storage

Stream Deck global settings store byte offsets and small state identifiers required for restart recovery. The plugin does not copy rollout files or maintain a transcript database.

The hook socket and helper live under `$CODEX_HOME/codex-status-actions`. The directory is mode `0700`; the socket and `hooks.json` are mode `0600`.

## Diagnostics

“Copy Safe Diagnostics” includes plugin/platform versions, configured Codex home, connection states, task count, hook count, and whether enhanced status is enabled. It excludes task IDs, titles, paths, transcripts, and event content.
