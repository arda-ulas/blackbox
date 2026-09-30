---
layout: home
hero:
  name: Blackbox
  text: Time-travel debugger for AI agents
  tagline: Record a run of your own Anthropic or OpenAI agent. Replay it offline, fork it with one tool result changed, and diff to the first step where the runs part.
  actions:
    - theme: brand
      text: Quickstart
      link: /quickstart
    - theme: alt
      text: See it find a root cause
      link: /example-fleet-triage
    - theme: alt
      text: How it works
      link: /concepts
    - theme: alt
      text: GitHub
      link: https://github.com/arda-ulas/blackbox
features:
  - title: Record your own agent
    details: "Pass bb.fetch to the official SDK client and wrap your tools. Model calls and tool results go into a hash-chained JSON cassette."
  - title: Replay with no network
    details: "Your real code runs again against the cassette. Each request is compared with the recorded one, and the first difference is named. No API key needed."
  - title: Fork and diff
    details: "Hand the agent a different tool result at any recorded step, continue live or from scripted replies, and see the first divergence and the new answer."
  - title: Pin it in CI
    details: "blackbox assert and blackbox replay turn a committed cassette into an offline regression test."
---

<img src="/hero.svg" alt="blackbox inspect shows a telemetry reading captured before the fault; blackbox diff shows the first divergence at step 5 and the work order changing from routine to urgent" style="margin-top: 2rem; border-radius: 12px;" />

The recording above is from the [fleet-triage example](./example-fleet-triage): a maintenance agent kept an overheating
van in service because its telemetry tool served a stale reading. Blackbox reproduces the run, isolates the reading,
tests the fix by forking, and pins it.

_Blackbox is unrelated to Blackbox AI, the coding assistant._
