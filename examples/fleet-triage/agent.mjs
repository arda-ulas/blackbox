// Run the fleet-triage agent with Blackbox wired in (the three marked lines and
// finish()). Under `blackbox record|replay|fork ... -- node agent.mjs` the
// session records, replays or forks; run on its own it just calls the API.

import Anthropic from "@anthropic-ai/sdk";
import { blackbox } from "@ardaulas/blackbox";
import { runTriage } from "./triage.mjs";
import * as fleetTools from "./tools.mjs";

const bb = blackbox(); //                                   ← Blackbox
const client = new Anthropic({ fetch: bb.fetch }); //       ← Blackbox
const tools = bb.tools({ //                                 ← Blackbox
  lookup_dtc: fleetTools.lookup_dtc,
  get_telemetry: fleetTools.get_telemetry,
  get_service_history: fleetTools.get_service_history,
  open_work_order: fleetTools.open_work_order,
});

const answer = await runTriage({ client, tools, model: process.env.ANTHROPIC_MODEL });
console.log(answer);
await bb.finish();
