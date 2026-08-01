---
id: EEP-OBS-01
domain: OBS
title: Logs are structured and carry a correlation identifier
version: 1.0.0
status: stable
maturity: standard
severity: warning
applies_to: [backend]
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
supersedes: []
related: ["EEP-OBS-02"]
---

## Statement

Logs are structured and carry a correlation identifier.

## Rationale

Logs written as unstructured prose are readable one line at a time but do not aggregate: a log platform cannot group, filter, or alert on a field it first has to parse out of a sentence. Structured output turns each log line into queryable data, so every field becomes something a dashboard or an alert rule can reference directly instead of something a person has to read and interpret. A correlation identifier bound to the request and threaded through every downstream call is what lets an engineer reconstruct one request's full path across components during an incident, instead of guessing from timestamps. Without it, diagnosing a failure that crosses two or more components turns into manually reconciling separate log streams by hand, which is slow exactly when speed matters most. The cost compounds: every additional component in a system multiplies the number of log streams an incident responder has to line up by hand.

## Pattern

Concentrate logging configuration in one setup module invoked once at process start, so every part of the codebase inherits the same structured format instead of reinventing it. At the point a request or message enters the system, generate or extract a correlation identifier and bind it to the logging context for the remainder of that unit of work, so every subsequent log line carries it automatically without being threaded through every function signature by hand. When work is handed to a background task, a queued message, or a downstream call, carry that same identifier forward so it continues to bind in the new context.

## Antipatterns

Ad hoc debug statements added while chasing a defect and left behind after it is fixed produce unstructured noise that cannot be queried, filtered, or correlated with anything else, and that nobody remembers to remove. Writing the identifier into the log message text instead of a structured field is tempting because it is quick, but it forces every downstream reader to parse a sentence instead of reading a field, defeating the purpose of structuring the log in the first place. Just as common: binding a correlation identifier at the entry point but generating a fresh one at each internal boundary instead of propagating the original, which produces fragments that look complete individually but cannot be stitched into one request's story.

## Check contract

A check proves the logging configuration emits structured output and that request handling binds a correlation identifier available to every log line.

## Waiver policy

Waivable with a declared waiver carrying owner and expiry of at most 90 days, except where noted.
