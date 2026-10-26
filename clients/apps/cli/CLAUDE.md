# CLI - Critical Rules

- **ALWAYS** output structured JSON when `process.env.VOWKEY_RESPONSE === "true"`
  - Use Response objects (MessageResponse, ListResponse, etc.) from `/apps/cli/src/models/response/`
  - DON'T write free-form text that breaks JSON parsing

- **NEVER** use `console.log()` for output
  - Use `CliUtils.writeLn()` to respect `VOWKEY_QUIET` and `VOWKEY_RESPONSE` environment variables
  - Use the `ConsoleLogService` from the `ServiceContainer`

- **ALWAYS** respect `VOWKEY_CLEANEXIT` environment variable
  - Exit code 0 even on errors when `VOWKEY_CLEANEXIT` is set
  - Required for scripting environments that need clean exits
