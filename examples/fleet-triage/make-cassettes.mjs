// Regenerate the committed cassettes in cassettes/ without an API key:
//
//   triage-incident.json    the incident, recorded with get_telemetry as it was deployed
//   triage-hypothesis.json  the incident forked at the telemetry result with the live reading
//   triage-fixed.json       a new run with the freshness check in get_telemetry
//
// The model here is a scripted stand-in that answers the way a careful triager
// would, so the walkthrough is identical for everyone. To see a real model on the
// same ticket, record with your own key instead:
//   npx blackbox record --out my-triage.json -- node agent.mjs
//
//   node make-cassettes.mjs           regenerate the committed cassettes
//   node make-cassettes.mjs --check   re-record with the current code and fail if
//                                     behavior differs from the committed cassettes

import Anthropic from "@anthropic-ai/sdk";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blackbox, diffTracesSemantic, formatDiffReport, loadTrace } from "@ardaulas/blackbox";
import { runTriage } from "./triage.mjs";
import * as fleet from "./tools.mjs";

const here = (path) => new URL(path, import.meta.url).pathname;
const json = (path) => JSON.parse(readFileSync(here(path), "utf8"));

/** The stand-in model: reads the conversation and replies like a careful triager would. */
let counter = 0;
const standInModel = async (_input, init) => {
  const request = JSON.parse(String(init.body));
  const calls = new Map();
  for (const message of request.messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type === "tool_use") calls.set(block.id, { name: block.name });
      if (block.type === "tool_result") calls.get(block.tool_use_id).output = JSON.parse(block.content);
    }
  }
  const seen = (name) => [...calls.values()].find((entry) => entry.name === name)?.output;
  const dtc = seen("lookup_dtc");
  const telemetry = seen("get_telemetry");
  const order = seen("open_work_order");
  const coolant = telemetry && Number(telemetry.data.find((point) => point.path === fleet.COOLANT).dp.value);
  const overheating = telemetry && coolant > dtc.overheat_threshold_c;

  const content = [];
  const use = (name, input) => content.push({ type: "tool_use", id: `toolu_standin_${++counter}`, name, input });
  let stop = "tool_use";
  if (!telemetry) {
    content.push({ type: "text", text: "I'll look up P0217 and pull VAN-14's latest telematics readings." });
    use("lookup_dtc", { code: "P0217" });
    use("get_telemetry", { vehicle_id: "VAN-14" });
  } else if (!overheating && !seen("get_service_history")) {
    content.push({
      type: "text",
      text: `Coolant is at ${coolant} °C, below the ${dtc.overheat_threshold_c} °C threshold for P0217, so this looks like a sensor or circuit fault rather than real overheating. Checking recent service work.`,
    });
    use("get_service_history", { vehicle_id: "VAN-14" });
  } else if (!order) {
    if (overheating) {
      content.push({
        type: "text",
        text: `Coolant is at ${coolant} °C, above the ${dtc.overheat_threshold_c} °C threshold for P0217${telemetry.cache_rejected ? " (the cached snapshot predated the fault, so this is the live reading)" : ""}. This is real overheating, so the van has to come off the road now.`,
      });
      use("open_work_order", {
        vehicle_id: "VAN-14",
        priority: "urgent",
        action: "Remove from service now and do not drive. Tow to the depot and inspect the cooling system (coolant level, pump, fan, thermostat) before it returns.",
      });
    } else {
      use("open_work_order", {
        vehicle_id: "VAN-14",
        priority: "routine",
        action: "Inspect the coolant temperature sensor and its wiring; the thermostat was replaced on 2026-08-02, so check its fitment. The van can stay in service until then.",
      });
    }
  } else {
    stop = "end_turn";
    content.push({
      type: "text",
      text:
        order.priority === "urgent"
          ? `Urgent: take VAN-14 off the road now. Its coolant is at ${coolant} °C, above the ${dtc.overheat_threshold_c} °C threshold for P0217, so I opened urgent work order ${order.work_order_id} to tow it to the depot for a cooling-system inspection.`
          : `Routine: I opened work order ${order.work_order_id} for VAN-14's next scheduled service. Coolant is normal at ${coolant} °C, so P0217 most likely comes from the temperature sensor or its wiring, and the van can stay in service.`,
    });
  }
  const body = { id: `msg_standin_${++counter}`, type: "message", role: "assistant", model: request.model, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } };
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
};

// Pin the clock so the cassettes' own timestamps fit the story: the alert at
// 07:58, the live reading at 08:52, the triage run at 09:05, the investigation's
// fork at 10:15 and the run with the fix at 11:20 (UTC, 2026-09-29).
function pinClock(iso) {
  let now = Date.parse(iso);
  Date.now = () => (now += 350);
}

async function run(clock, options, getTelemetry) {
  pinClock(clock);
  const bb = blackbox({ ...options, logErrors: true });
  const client = new Anthropic({ apiKey: "stand-in", fetch: bb.fetch, maxRetries: 0 });
  const tools = bb.tools({
    lookup_dtc: fleet.lookup_dtc,
    get_telemetry: getTelemetry,
    get_service_history: fleet.get_service_history,
    open_work_order: fleet.open_work_order,
  });
  const answer = await runTriage({ client, tools });
  const summary = await bb.finish();
  if (!check) console.log(`${summary.path}: ${summary.steps} steps, ${summary.status}\n  ${answer}`);
}

// --check: re-record into a temporary directory with the current code and
// compare each run with the committed cassette step by step (timestamps
// ignored). A change in behavior, such as the freshness check being undone,
// shows up as a divergence and exit code 1.
const check = process.argv.includes("--check");
const outDir = check ? mkdtempSync(join(tmpdir(), "fleet-triage-check-")) : here("cassettes");
const out = (name) => join(outDir, name);

await run("2026-09-29T09:05:00Z", { mode: "record", out: out("triage-incident.json"), traceId: "triage-incident", baseFetch: standInModel }, fleet.getTelemetryAsDeployed);
await run(
  "2026-09-29T10:15:00Z",
  {
    mode: "fork",
    cassette: out("triage-incident.json"),
    out: out("triage-hypothesis.json"),
    traceId: "triage-hypothesis",
    forkAt: 5,
    forkSet: json("inputs/live-reading.json"),
    continueWith: "script",
    script: json("inputs/urgent-replies.json"),
  },
  fleet.get_telemetry,
);
await run("2026-09-29T11:20:00Z", { mode: "record", out: out("triage-fixed.json"), traceId: "triage-fixed", baseFetch: standInModel }, fleet.get_telemetry);
rmSync(here("work-orders.jsonl"), { force: true });

if (check) {
  let failed = false;
  for (const name of ["triage-incident.json", "triage-hypothesis.json", "triage-fixed.json"]) {
    const committed = await loadTrace(here(`cassettes/${name}`));
    const fresh = await loadTrace(out(name));
    if (diffTracesSemantic(committed, fresh).hasDivergence) {
      failed = true;
      console.error(`\n${name} no longer matches what the current code records:`);
      console.error(formatDiffReport(committed, fresh, { comparison: "semantic" }));
    } else {
      console.log(`${name}: matches`);
    }
  }
  rmSync(outDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
