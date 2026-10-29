# Workspace privacy lock

The workspace privacy lock is a device-local screen that hides Sutra until a 4–8 digit PIN is entered. It is a privacy control for shared or casually accessible devices, not encryption at rest.

## Stored metadata

The configuration lives outside the canonical workspace at `sutra:workspaceLock:v1` and is deliberately excluded from backups and Sutra Sync. It contains only:

- version and enabled state;
- a random 16-byte salt;
- a PBKDF2-HMAC-SHA-256 verifier;
- the PBKDF2 iteration count;
- the inactivity timeout.

The raw PIN is never persisted. Sutra refuses to enable or update the lock unless Safe Storage can write the configuration and read back the exact normalized metadata.

## Runtime behavior

- A valid enabled configuration is read before the body is parsed. Critical CSS hides every body child except the lock screen, preventing workspace content from painting or receiving focus.
- Every refresh starts locked. Unlock state belongs only to the current tab.
- Inactivity options include 1, 2, 5, 10, 15, 20, 30, 45, 60, 90 minutes; 2, 3, 4, 8, or 12 hours; 1 day; Never for the current session; and a Custom duration from 1 to 1,440 minutes.
- Lock now and configuration changes broadcast to other open Sutra tabs. Unlock does not broadcast.
- Changing the PIN or timeout and disabling the lock require the current PIN.
- The underlying application is `inert` and `aria-hidden` while locked, with keyboard focus contained on the unlock screen.

Disabling the privacy lock does not remove or encrypt workspace data. Students who need portable cryptographic protection should use password-encrypted `.sutra` backups.
