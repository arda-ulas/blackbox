# Trace Schema Notes

## Goal

Capture all non-deterministic inputs needed to replay an agent run offline.

## Trace Step Fields

Initial fields:
- run_id
- step_idx
- type
- timestamp
- parent_run_id
- fork_point
- request_hash
- payload

## Step Types

- model_call
- model_response
- tool_call
- tool_result
- state_snapshot

## Hashing Rule

Use canonical serialization:
- sorted object keys
- stable JSON output
- normalized values where needed

The engineering target is canonical-hash-identical replay, not raw byte identity.
