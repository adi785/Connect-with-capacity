"""Service layer.

All ownership and scoping checks live here rather than in Postgres RLS (Section 4):
Firebase owns identity, so the database has no `auth.uid()` to key policies on and
FastAPI is the sole gatekeeper. Keeping the rules in one layer makes them testable
and keeps every router consistent.

Submodules import each other (e.g. `feedback` reuses `courses` visibility checks), so
this package deliberately imports nothing eagerly — that would create a cycle.
"""
