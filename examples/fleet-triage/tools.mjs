// The fleet-triage agent's tools: plain local functions over small JSON tables.
// Example data for illustration; not repair guidance.
//
// Telemetry signals are named with COVESA VSS 6.1 paths, and each reading is a
// VISS v3 data point { value, ts }: the value as a string (a JSON array of
// strings for array signals such as DTCList), and ts the time the value was
// captured.

import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

const read = (name) => JSON.parse(readFileSync(new URL(`./data/${name}`, import.meta.url), "utf8"));
const DTC = read("dtc-codes.json");
const TELEMETRY = read("telemetry.json");
const FAULTS = read("fault-events.json");
const HISTORY = read("service-history.json");

export const COOLANT = "Vehicle.Powertrain.CombustionEngine.EngineCoolant.Temperature";

export async function lookup_dtc({ code }) {
  const key = String(code).toUpperCase();
  return DTC[key] ? { code: key, ...DTC[key] } : { code, error: "unknown code" };
}

/**
 * get_telemetry as it was deployed when the incident happened: a snapshot cached
 * at the depot wins over the live reading, however old it is. Kept so the
 * incident can be recorded again (make-cassettes.mjs); the agent uses the fixed
 * version below.
 */
export async function getTelemetryAsDeployed({ vehicle_id }) {
  const snapshot = TELEMETRY.cache[vehicle_id] ?? TELEMETRY.live[vehicle_id];
  return snapshot ? { vehicle_id, data: snapshot } : { vehicle_id, error: "no telemetry" };
}

/**
 * Preventive action: a reading captured before the vehicle's latest fault
 * cannot describe that fault. A cached snapshot older than the fault is
 * rejected and the live reading is used; if no fresh reading exists, the
 * result says `stale: true` instead of passing old data off as current.
 */
export async function get_telemetry({ vehicle_id }) {
  const fault = FAULTS[vehicle_id];
  const capturedAt = (snapshot) => snapshot && snapshot[0].dp.ts;
  const cached = TELEMETRY.cache[vehicle_id];
  const live = TELEMETRY.live[vehicle_id];
  const fresh = (snapshot) => snapshot && (!fault || capturedAt(snapshot) >= fault.set_at);

  if (fresh(cached)) return { vehicle_id, data: cached, stale: false };
  if (fresh(live)) {
    const freshness = { stale: false };
    if (cached) freshness.cache_rejected = `snapshot captured ${capturedAt(cached)}, before ${fault.dtc} was set at ${fault.set_at}`;
    return { vehicle_id, data: live, ...freshness };
  }
  const snapshot = cached ?? live;
  if (!snapshot) return { vehicle_id, error: "no telemetry" };
  return { vehicle_id, data: snapshot, stale: true, warning: `newest reading was captured ${capturedAt(snapshot)}, before ${fault.dtc} was set at ${fault.set_at}` };
}

export async function get_service_history({ vehicle_id }) {
  return HISTORY[vehicle_id] ? { vehicle_id, ...HISTORY[vehicle_id] } : { vehicle_id, error: "no service history" };
}

// Appends the order to work-orders.jsonl (git-ignored) and returns its id. The id
// is derived from the order itself, so the same order always gets the same id.
export async function open_work_order({ vehicle_id, priority, action }) {
  const order = { vehicle_id, priority, action };
  const work_order_id = `WO-${createHash("sha256").update(JSON.stringify(order)).digest("hex").slice(0, 6).toUpperCase()}`;
  appendFileSync(new URL("./work-orders.jsonl", import.meta.url), JSON.stringify({ work_order_id, ...order }) + "\n");
  return { work_order_id, vehicle_id, priority, status: "open" };
}

export const TOOL_SPECS = [
  {
    name: "lookup_dtc",
    description: "Look up an OBD-II diagnostic trouble code: its title, severity band and recommended checks.",
    input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
  },
  {
    name: "get_telemetry",
    description: "Latest telematics readings for a vehicle, as COVESA VSS signal paths with VISS data points (value, capture time ts).",
    input_schema: { type: "object", properties: { vehicle_id: { type: "string" } }, required: ["vehicle_id"] },
  },
  {
    name: "get_service_history",
    description: "A vehicle's last service date and the parts replaced then.",
    input_schema: { type: "object", properties: { vehicle_id: { type: "string" } }, required: ["vehicle_id"] },
  },
  {
    name: "open_work_order",
    description: "Open a maintenance work order. priority: urgent (remove from service now), soon (within 48 hours) or routine (next scheduled service).",
    input_schema: {
      type: "object",
      properties: {
        vehicle_id: { type: "string" },
        priority: { type: "string", enum: ["urgent", "soon", "routine"] },
        action: { type: "string" },
      },
      required: ["vehicle_id", "priority", "action"],
    },
  },
];
