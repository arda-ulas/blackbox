// The recording / replay / fork session behind `blackbox()`.
//
// The session sits in the call path through the official SDKs' `fetch` option
// and through wrapped tool functions:
//
//   record  forwards each model call, then records the normalized request and
//           response; wrapped tools run and their results are recorded.
//   replay  answers each model call from the cassette after checking the request
//           against the recorded one; wrapped tools return recorded results and
//           never run. Nothing is forwarded.
//   fork    replays up to a recorded tool_result, substitutes a new result there,
//           then continues with the live API or a scripted responder; wrapped
//           tools run for real after the fork point. The prefix is copied
//           verbatim, so its hashes match the parent and `diff` reports the first
//           divergence at the fork step.
//   off     passes everything through untouched.
//
// Tool steps of one model turn are buffered and written in the order the model
// requested the calls, so concurrently executed tools record deterministically.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { BlackboxError, BlackboxUnsupportedError, ReplayDivergenceError } from "../errors.ts";
import {
  ANTHROPIC_PATH,
  normalizeAnthropicRequest,
  normalizeAnthropicResponse,
  synthesizeAnthropicResponse,
} from "../integrations/anthropic.ts";
import { json, ToolCallIds, type NeutralOutput } from "../integrations/common.ts";
import {
  normalizeOpenAIRequest,
  normalizeOpenAIResponse,
  OPENAI_CHAT_PATH,
  OPENAI_RESPONSES_PATH,
  synthesizeOpenAIResponse,
} from "../integrations/openai.ts";
import { validateTrace } from "../replay/CassetteReplay.ts";
import { canonicalize } from "../trace/hash.ts";
import { parseJson } from "../trace/parseJson.ts";
import { auditTraceNeutrality } from "../trace/neutrality.ts";
import { toolCallsOf, type ToolCallRef } from "../trace/payloads.ts";
import { maskSecrets } from "../trace/secrets.ts";
import { TraceRecorder } from "../trace/TraceRecorder.ts";
import { terminalOutcome } from "../trace/traceOutcome.ts";
import { CURRENT_TRACE_VERSION, type JsonObject, type JsonValue, type Trace, type TraceStep } from "../trace/TraceTypes.ts";
import { verifyTrace } from "../trace/verifyTrace.ts";
import { firstDifference, renderValue } from "./firstDifference.ts";
import { envApiKeys, PLACEHOLDER_KEY, resolveOptions, type BlackboxOptions, type ResolvedOptions } from "./options.ts";
import { sameFile } from "./sameFile.ts";

type Provider = "anthropic" | "openai";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction = (...args: any[]) => any;
type Promisified<F extends AnyFunction> = (...args: Parameters<F>) => Promise<Awaited<ReturnType<F>>>;
export type WrappedTools<T extends Record<string, AnyFunction>> = { [K in keyof T]: Promisified<T[K]> };

export interface FinishOptions {
  /** The run's final answer, when the agent knows it. */
  result?: string;
  /** The error that ended the run. Takes precedence over any answer. */
  error?: unknown;
}

export interface FinishSummary {
  mode: ResolvedOptions["mode"];
  /** Where the cassette was written (record and fork). */
  path?: string;
  steps: number;
  status: "success" | "error" | "incomplete";
  /** Replay and fork: recorded steps played back. */
  replayedSteps?: number;
}

interface RoundCall extends ToolCallRef {
  /** Replay/fork: the recorded tool steps for this call, when the recording has them. */
  recorded?: { call: TraceStep; result: TraceStep };
  /** Set once a wrapped tool invocation has claimed this call. */
  claimed: boolean;
  /** Record/live: the tool steps to write when the round is flushed. */
  pending?: { input: JsonValue; startedAt: number; done?: { payload: JsonObject; at: number } };
}

interface Round {
  calls: RoundCall[];
  /** Tool invocations the model did not request (recorded after the requested ones). */
  extra: Array<NonNullable<RoundCall["pending"]> & { toolCallId: string; toolName: string }>;
}

function toolInputOf(args: unknown[]): JsonValue {
  if (args.length === 0) return {};
  return json(args.length === 1 ? args[0] : args);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function providerFor(url: string): Provider | "responses" | undefined {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return undefined;
  }
  if (pathname.endsWith(ANTHROPIC_PATH)) return "anthropic";
  if (pathname.endsWith(OPENAI_CHAT_PATH)) return "openai";
  if (pathname.endsWith(OPENAI_RESPONSES_PATH)) return "responses";
  return undefined;
}

function jsonResponse(status: number, body: JsonValue): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function errorBody(provider: Provider | undefined, message: string): JsonValue {
  if (provider === "openai") {
    return { error: { message, type: "invalid_request_error", param: null, code: "blackbox" } };
  }
  return { type: "error", error: { type: "invalid_request_error", message } };
}

export class BlackboxSession {
  readonly mode: ResolvedOptions["mode"];
  readonly #options: ResolvedOptions;
  readonly #ids = new ToolCallIds();
  readonly #secrets = new Set<string>();
  #recorder: TraceRecorder | undefined;
  #round: Round = { calls: [], extra: [] };
  #failure: BlackboxError | undefined;
  #finished: FinishSummary | undefined;
  #finishError: unknown;
  #nextExtraId = 0;
  #modelCallsInFlight = 0;
  #toolsInFlight = 0;
  /** Set when finish() begins: from then on, no call is forwarded or run. */
  #finalizing = false;

  // Replay / fork state.
  readonly #parent: Trace | undefined;
  #cursor = 0;
  #forked = false;
  #scriptIndex = 0;

  constructor(options: BlackboxOptions = {}, env: NodeJS.ProcessEnv = process.env) {
    this.#options = resolveOptions(options, env);
    this.mode = this.#options.mode;
    for (const { value } of envApiKeys(env)) this.#secrets.add(value);

    if (this.mode === "record") {
      if (this.#options.out === undefined) throw new BlackboxError("record mode needs an output path (out / BLACKBOX_OUT)");
      this.#recorder = new TraceRecorder(this.#traceId(this.#options.out));
    }
    if (this.mode === "replay" || this.mode === "fork") {
      this.#parent = this.#loadParent();
    }
    if (this.mode === "fork") this.#checkForkPlan();
    if (this.#parent) this.#round = this.#recordedRound(0, []);
    if (this.mode === "record" || this.mode === "fork") {
      openSessions.add(this);
      installExitHook();
    }
  }

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  /** Pass as the SDK client's `fetch` option. */
  readonly fetch: typeof fetch = async (input, init) => this.#handleFetch(input, init);

  /** Wrap tool functions (same names and parameters; results become Promises). */
  tools<T extends Record<string, AnyFunction>>(functions: T): WrappedTools<T> {
    const wrapped = {} as Record<string, AnyFunction>;
    for (const [name, fn] of Object.entries(functions)) wrapped[name] = this.tool(name, fn);
    return wrapped as WrappedTools<T>;
  }

  /** Wrap one tool function under the tool name the model uses. */
  tool<F extends AnyFunction>(name: string, fn: F): Promisified<F> {
    if (this.mode === "off") return (async (...args: Parameters<F>) => fn(...args)) as Promisified<F>;
    return ((...args: Parameters<F>) => this.#invokeTool(name, fn, args)) as Promisified<F>;
  }

  /** The cassette built so far (record and fork) or replayed so far (replay). */
  get trace(): Trace {
    if (this.#recorder) return this.#recorder.getTrace();
    const steps = this.#parent?.steps.slice(0, this.#cursor) ?? [];
    return { ...(this.#parent as Trace), version: CURRENT_TRACE_VERSION, steps: structuredClone(steps) };
  }

  /** Finish the run: write the cassette (record, fork) or check the replay completed. */
  async finish(options: FinishOptions = {}): Promise<FinishSummary> {
    if (this.#finishError !== undefined) throw this.#finishError;
    if (this.#finished) return this.#finished;
    if (options.error !== undefined && options.result !== undefined) {
      throw new BlackboxError("finish() takes a result or an error, not both");
    }
    if (this.mode === "off") return (this.#finished = { mode: "off", steps: 0, status: "incomplete" });
    this.#finalizing = true;

    try {
      if (this.#failure) throw this.#failure;
      const inFlight = this.#inFlight();
      if (inFlight > 0) {
        throw new BlackboxError(
          `finish() was called while ${inFlight} wrapped call(s) were still running; await every model call and ` +
            "tool call before finish(). Nothing was written, and later calls on this session are refused.",
        );
      }
      if (this.mode === "replay") return (this.#finished = this.#finishReplay(options));

      if (this.mode === "fork" && !this.#forked) {
        throw new BlackboxError(
          `the run ended before reaching the fork point (step ${String(this.#options.forkAt)}); ` +
            `the agent never invoked the tool whose result step ${String(this.#options.forkAt)} records`,
        );
      }
      this.#checkPrefixClaimed();
      this.#flushRound();
      this.#appendTerminal(options);
      const trace = (this.#recorder as TraceRecorder).getTrace();
      this.#checkWritable(trace);
      const path = this.#writeCassette(trace);
      const summary: FinishSummary = { mode: this.mode, path, steps: trace.steps.length, status: terminalOutcome(trace).status };
      if (this.mode === "fork") summary.replayedSteps = this.#options.forkAt as number;
      this.#finished = summary;
      openSessions.delete(this);
      this.#writeReport({ ok: true, ...summary });
      return summary;
    } catch (error) {
      this.#writeReport({ ok: false, mode: this.mode, error: this.#mask(errorMessage(error)) });
      this.#finishError = error;
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Model calls
  // -------------------------------------------------------------------------

  async #handleFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const provider = providerFor(url);
    this.#collectSecrets(input, init);

    if (this.mode === "off") return this.#options.baseFetch(input, init);
    if (this.#finalizing) {
      const message = "[blackbox] the session has finished (finish() was called); this request was not sent";
      if (this.#options.logErrors) console.error(message);
      return jsonResponse(400, errorBody(provider === "responses" ? "openai" : provider, message));
    }
    if (this.#failure) {
      return jsonResponse(400, errorBody(provider === "responses" ? "openai" : provider, `[blackbox] ${this.#failure.message}`));
    }

    try {
      if (provider === "responses") {
        throw new BlackboxUnsupportedError(
          "the OpenAI Responses API is not supported yet; use chat.completions.create (Responses support is planned)",
        );
      }
      if (provider === undefined) {
        if (this.mode === "record" || (this.mode === "fork" && this.#forked && this.#options.continueWith === "live")) {
          return this.#options.baseFetch(input, init);
        }
        throw new BlackboxError(
          `${this.mode} mode answers only model calls (messages.create / chat.completions.create); ` +
            `a request to ${new URL(url).pathname} would need the network`,
        );
      }

      if (this.#modelCallsInFlight > 0) {
        throw new BlackboxUnsupportedError(
          "overlapping model calls in one session are not supported yet; await each call before the next, " +
            "or give each concurrent conversation its own blackbox() session and cassette",
        );
      }
      this.#modelCallsInFlight++;
      try {
        const body = await this.#readBody(input, init);
        if (this.mode === "record" || (this.mode === "fork" && this.#forked)) {
          return await this.#liveCall(provider, body, input, init);
        }
        return this.#replayCall(provider, body);
      } finally {
        this.#modelCallsInFlight--;
      }
    } catch (error) {
      if (!(error instanceof BlackboxError)) throw error;
      return this.#fail(error, provider === "responses" ? "openai" : provider);
    }
  }

  async #readBody(input: string | URL | Request, init?: RequestInit): Promise<Record<string, unknown>> {
    let text: string | undefined;
    if (typeof init?.body === "string") text = init.body;
    else if (input instanceof Request) text = await input.clone().text();
    if (text === undefined) throw new BlackboxError("could not read the request body (expected a JSON string)");
    const parsed = readJson(text, "the request body");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new BlackboxError("the request body is not a JSON object");
    }
    return parsed as Record<string, unknown>;
  }

  #normalizeRequest(provider: Provider, body: Record<string, unknown>): JsonObject {
    return provider === "anthropic" ? normalizeAnthropicRequest(body, this.#ids) : normalizeOpenAIRequest(body, this.#ids);
  }

  /** Record mode, and fork mode after the fork point. */
  async #liveCall(
    provider: Provider,
    body: Record<string, unknown>,
    input: string | URL | Request,
    init: RequestInit | undefined,
  ): Promise<Response> {
    this.#checkPrefixClaimed();
    const startedAt = Date.now();
    const modelInput = this.#normalizeRequest(provider, body);

    if (this.mode === "fork" && this.#options.continueWith === "script") {
      const output = this.#nextScripted();
      this.#appendModelTurn(modelInput, startedAt, output, Date.now());
      return this.#synthesize(provider, output, body, this.#recorder!.size() - 1, Date.now());
    }

    const thinking = body["thinking"];
    if (
      this.mode === "fork" &&
      provider === "anthropic" &&
      typeof thinking === "object" && thinking !== null && (thinking as { type?: unknown }).type !== "disabled"
    ) {
      throw new BlackboxUnsupportedError(
        "fork --live with extended thinking is not supported yet (cassettes leave thinking blocks out, and the API " +
          "requires them on tool-use turns); continue the fork with a script instead",
      );
    }
    const response = await this.#options.baseFetch(input, init);
    if (!response.ok) return response;
    let parsed: unknown;
    try {
      parsed = await response.clone().json();
    } catch {
      throw new BlackboxError(`the provider returned a ${response.status} response whose body is not JSON; it was not recorded`);
    }
    if (typeof parsed !== "object" || parsed === null) {
      throw new BlackboxError("the provider response body is not a JSON object; it was not recorded");
    }
    const output =
      provider === "anthropic"
        ? normalizeAnthropicResponse(parsed as Record<string, unknown>, this.#ids)
        : normalizeOpenAIResponse(parsed as Record<string, unknown>, this.#ids);
    this.#appendModelTurn(modelInput, startedAt, output, Date.now());
    return response;
  }

  #appendModelTurn(modelInput: JsonObject, startedAt: number, output: NeutralOutput, at: number): void {
    this.#checkPrefixClaimed();
    this.#flushRound();
    const recorder = this.#recorder as TraceRecorder;
    recorder.append("model_input", modelInput, startedAt);
    recorder.append("model_output", output as unknown as JsonValue, at);
    this.#round = {
      calls: (output.type === "tool_calls" ? output.calls : []).map((call) => ({ ...call, claimed: false })),
      extra: [],
    };
  }

  #nextScripted(): NeutralOutput {
    const script = this.#script();
    const entry = script[this.#scriptIndex];
    if (entry === undefined) {
      throw new BlackboxError(
        `the fork script ran out after ${script.length} response(s); add more model outputs to it or continue with --live`,
      );
    }
    this.#scriptIndex++;
    if (entry.type === "tool_calls") {
      const calls = entry.calls.map((call) => ({
        toolCallId: this.#ids.fresh(call.toolName),
        toolName: call.toolName,
        toolInput: call.toolInput ?? {},
      }));
      const output: NeutralOutput = { type: "tool_calls", calls };
      if (entry.text !== undefined) output.text = entry.text;
      return output;
    }
    return structuredClone(entry);
  }

  #script(): NeutralOutput[] {
    if (this.#options.script) return this.#options.script;
    const path = this.#options.scriptPath;
    if (path === undefined) throw new BlackboxError("fork with script continuation needs a script (BLACKBOX_SCRIPT)");
    const parsed = readJson(readText(path, "the fork script"), `the fork script ${path}`);
    if (!Array.isArray(parsed) || parsed.some((entry) => !isNeutralOutput(entry))) {
      throw new BlackboxError(
        `the fork script must be a JSON array of model outputs, e.g. [{"type":"final_answer","text":"…"}] or ` +
          `[{"type":"tool_calls","calls":[{"toolName":"search","toolInput":{}}]}]`,
      );
    }
    this.#options.script = parsed as NeutralOutput[];
    return this.#options.script;
  }

  /** Replay mode, and fork mode before the fork point. */
  #replayCall(provider: Provider, body: Record<string, unknown>): Response {
    const parent = this.#parent as Trace;
    this.#settleRecordedRound();

    const inputStep = parent.steps[this.#cursor];
    if (inputStep === undefined || inputStep.type !== "model_input") {
      const recordedCalls = parent.steps.filter((step) => step.type === "model_input").length;
      throw new ReplayDivergenceError({
        stepIndex: this.#cursor,
        path: "model call",
        expected: `no further model call (the cassette records ${recordedCalls})`,
        actual: "the agent made another model call",
      });
    }
    const modelInput = this.#normalizeRequest(provider, body);
    if (this.#options.match === "strict") {
      const difference = firstDifference(inputStep.payload, modelInput);
      if (difference) {
        throw new ReplayDivergenceError({
          stepIndex: inputStep.index,
          path: this.#mask(difference.path),
          expected: this.#mask(renderValue(difference.expected)),
          actual: this.#mask(renderValue(difference.actual)),
          hint:
            "  The agent sent a different request than the one recorded. If the difference comes from " +
            "something nondeterministic (a timestamp, a random id), rerun with --match sequence.",
        });
      }
    }

    const outputStep = parent.steps[this.#cursor + 1];
    if (outputStep === undefined || outputStep.type !== "model_output") {
      throw new BlackboxError(`cassette step ${this.#cursor + 1} should be the model output for step ${this.#cursor}`);
    }
    const output = outputStep.payload as unknown as NeutralOutput;
    this.#cursor += 2;

    this.#round = this.#recordedRound(this.#cursor, toolCallsOf(outputStep.payload));
    return this.#synthesize(provider, output, body, outputStep.index, outputStep.timestamp);
  }

  /**
   * The recorded tool steps from `start` up to the next model_input, as a round:
   * the model-requested calls first (in request order), then tool invocations
   * the model did not request (in recorded order, e.g. a tool the agent ran
   * before its first model call).
   */
  #recordedRound(start: number, requested: ToolCallRef[]): Round {
    const parent = this.#parent as Trace;
    const recorded = new Map<string, { call: TraceStep; result: TraceStep }>();
    for (let scan = start; scan < parent.steps.length && parent.steps[scan].type !== "model_input"; scan++) {
      const step = parent.steps[scan];
      if (step.type !== "tool_call") continue;
      const next = parent.steps[scan + 1];
      const id = (step.payload as { toolCallId?: string }).toolCallId;
      if (next?.type === "tool_result" && id !== undefined) recorded.set(id, { call: step, result: next });
    }
    const requestedIds = new Set(requested.map((call) => call.toolCallId));
    const calls: RoundCall[] = requested.map((call) => {
      this.#ids.register(call.toolCallId, call.toolName);
      const entry: RoundCall = { ...call, claimed: false };
      const steps = recorded.get(call.toolCallId);
      if (steps) entry.recorded = steps;
      return entry;
    });
    for (const [toolCallId, steps] of recorded) {
      if (requestedIds.has(toolCallId)) continue;
      const payload = steps.call.payload as { toolName?: string; toolInput?: JsonValue };
      const toolName = payload.toolName ?? "unknown";
      this.#ids.register(toolCallId, toolName);
      calls.push({ toolCallId, toolName, toolInput: payload.toolInput ?? null, recorded: steps, claimed: false });
    }
    return { calls, extra: [] };
  }

  /**
   * Before the next replayed model call (or at finish), every recorded tool step
   * of the current turn must have been claimed by a wrapped tool invocation, in
   * both match modes: `sequence` relaxes how requests are compared, not whether
   * the recorded run was reproduced.
   */
  #settleRecordedRound(): void {
    const parent = this.#parent as Trace;
    const unclaimed = this.#round.calls.filter((call) => call.recorded && !call.claimed);
    if (unclaimed.length > 0) {
      const first = unclaimed[0];
      throw new ReplayDivergenceError({
        stepIndex: (first.recorded as { call: TraceStep }).call.index,
        path: `tool ${first.toolName}`,
        expected: `the agent runs ${first.toolName} (${first.toolCallId})`,
        actual: "the agent moved on without running it",
      });
    }
    while (this.#cursor < parent.steps.length && (parent.steps[this.#cursor].type === "tool_call" || parent.steps[this.#cursor].type === "tool_result")) {
      this.#cursor++;
    }
  }

  #synthesize(provider: Provider, output: NeutralOutput, body: Record<string, unknown>, stepIndex: number, timestamp: number): Response {
    const model = typeof body["model"] === "string" ? body["model"] : "unknown";
    const responseId = `blackbox-replay-${stepIndex}`;
    const payload =
      provider === "anthropic"
        ? synthesizeAnthropicResponse(output, model, responseId)
        : synthesizeOpenAIResponse(output, model, responseId, Math.floor(timestamp / 1000));
    return jsonResponse(200, payload);
  }

  // -------------------------------------------------------------------------
  // Tools
  // -------------------------------------------------------------------------

  async #invokeTool(name: string, fn: AnyFunction, args: unknown[]): Promise<unknown> {
    if (this.#finalizing) {
      const error = new BlackboxError(`the session has finished (finish() was called); ${name} was not run`);
      if (this.#options.logErrors) console.error(`[blackbox] ${error.message}`);
      throw error;
    }
    if (this.#failure) throw this.#failure;
    const input = toolInputOf(args);
    const call = this.#claimCall(name, input);

    // In a fork, a call the recording completed before the fork point is part of
    // the copied prefix: it is served from the cassette even if the agent only
    // gets to it after the fork happened.
    const inPrefix =
      this.mode === "fork" && call?.recorded !== undefined && call.recorded.result.index < (this.#options.forkAt as number);
    const replaying = this.mode === "replay" || (this.mode === "fork" && (!this.#forked || inPrefix));
    if (replaying) {
      if (call?.recorded === undefined) {
        throw this.#failTool(
          new ReplayDivergenceError({
            stepIndex: this.#cursor,
            path: `tool ${name}`,
            expected: call ? `no recorded result for ${call.toolCallId} (the tool was not wrapped when recording)` : `no request for ${name} in this turn`,
            actual: `the agent ran ${name}`,
          }),
        );
      }
      if (this.mode === "fork" && call.recorded.result.index === this.#options.forkAt) {
        return this.#fork(call);
      }
      if (this.mode === "fork" && call.recorded.result.index > (this.#options.forkAt as number)) {
        // A sibling of the forked call that ran after it in the recording: it
        // belongs to the new branch, so it runs for real.
        return this.#runLive(name, fn, args, input, call);
      }
      const result = call.recorded.result.payload as { result?: JsonValue; error?: string };
      if (result.error !== undefined) throw new Error(result.error);
      return structuredClone(result.result ?? null);
    }
    return this.#runLive(name, fn, args, input, call);
  }

  /**
   * Match an invocation to an unclaimed call of the current turn by name and
   * arguments. When replaying (and for a fork's prefix), the arguments must equal
   * the recorded invocation in strict mode; otherwise the first open call with
   * that name is taken. Identical duplicate calls are matched in invocation order.
   */
  #claimCall(name: string, input: JsonValue): RoundCall | undefined {
    const open = this.#round.calls.filter((call) => !call.claimed && call.toolName === name);
    const wanted = canonicalize(input);
    const expectedInput = (call: RoundCall): JsonValue =>
      call.recorded ? ((call.recorded.call.payload as { toolInput?: JsonValue }).toolInput ?? null) : call.toolInput;
    let call = open.find((candidate) => canonicalize(expectedInput(candidate)) === wanted);
    if (call === undefined) {
      const first = open[0];
      if (first?.recorded && this.#options.match === "strict" && this.#checksRecordedInput(first)) {
        throw this.#failTool(
          new ReplayDivergenceError({
            stepIndex: first.recorded.call.index,
            path: `tool ${name} input`,
            expected: this.#mask(renderValue(expectedInput(first))),
            actual: this.#mask(renderValue(input)),
            hint: "  The agent called the tool with different arguments than it did when recording.",
          }),
        );
      }
      call = first;
    }
    if (call) call.claimed = true;
    return call;
  }

  /** Whether a recorded call is served from the cassette (so its arguments are checked). */
  #checksRecordedInput(call: RoundCall): boolean {
    if (this.mode === "replay") return true;
    return this.mode === "fork" && call.recorded !== undefined && call.recorded.result.index <= (this.#options.forkAt as number);
  }

  /**
   * In a fork, the copied prefix includes the tool steps recorded before the
   * fork point; the agent must actually have run each of those calls again.
   */
  #checkPrefixClaimed(): void {
    if (this.mode !== "fork" || !this.#forked) return;
    const skipped = this.#round.calls.find(
      (call) => call.recorded && !call.claimed && call.recorded.result.index < (this.#options.forkAt as number),
    );
    if (skipped?.recorded) {
      throw new ReplayDivergenceError({
        stepIndex: skipped.recorded.call.index,
        path: `tool ${skipped.toolName}`,
        expected: `the agent runs ${skipped.toolName} (${skipped.toolCallId}) before the fork point, as recorded`,
        actual: "the agent moved on without running it",
      });
    }
  }

  async #runLive(name: string, fn: AnyFunction, args: unknown[], input: JsonValue, call: RoundCall | undefined): Promise<unknown> {
    const pending: NonNullable<RoundCall["pending"]> = { input, startedAt: Date.now() };
    if (call) call.pending = pending;
    else {
      const toolCallId = this.#ids.assign(`unrequested-${this.#nextExtraId++}`, name);
      this.#round.extra.push({ ...pending, toolCallId, toolName: name });
    }
    const extra = call ? undefined : this.#round.extra[this.#round.extra.length - 1];
    const toolCallId = call?.toolCallId ?? (extra as { toolCallId: string }).toolCallId;
    this.#toolsInFlight++;
    try {
      const value: unknown = await fn(...args);
      const done = { payload: { toolCallId, toolName: name, result: json(value === undefined ? null : value) }, at: Date.now() };
      pending.done = done;
      if (extra) extra.done = done;
      return value;
    } catch (error) {
      const done = { payload: { toolCallId, toolName: name, error: this.#mask(errorMessage(error)) }, at: Date.now() };
      pending.done = done;
      if (extra) extra.done = done;
      throw error;
    } finally {
      this.#toolsInFlight--;
    }
  }

  /** Model calls and live wrapped tool calls that have started and not returned. */
  #inFlight(): number {
    return this.#modelCallsInFlight + this.#toolsInFlight;
  }

  /** Write the current turn's finished tool steps in the order the model requested them. */
  #flushRound(): void {
    const recorder = this.#recorder;
    if (!recorder) return;
    const write = (toolCallId: string, toolName: string, toolInput: JsonValue, pending: RoundCall["pending"]): void => {
      if (!pending?.done) return;
      recorder.append("tool_call", { toolCallId, toolName, toolInput }, pending.startedAt);
      recorder.append("tool_result", pending.done.payload, pending.done.at);
    };
    for (const call of this.#round.calls) {
      write(call.toolCallId, call.toolName, call.pending !== undefined ? call.pending.input : call.toolInput, call.pending);
    }
    for (const extra of this.#round.extra) write(extra.toolCallId, extra.toolName, extra.input, extra);
    this.#round = { calls: [], extra: [] };
  }

  // -------------------------------------------------------------------------
  // Fork
  // -------------------------------------------------------------------------

  #checkForkPlan(): void {
    const parent = this.#parent as Trace;
    const at = this.#options.forkAt;
    if (at === undefined) throw new BlackboxError("fork mode needs a fork step (forkAt / BLACKBOX_FORK_AT)");
    if (this.#options.forkSet === undefined) throw new BlackboxError("fork mode needs a replacement result (forkSet / BLACKBOX_FORK_SET)");
    if (this.#options.out === undefined) throw new BlackboxError("fork mode needs an output path (out / BLACKBOX_OUT)");
    this.#checkOutIsNotParent();
    if (this.#options.continueWith === undefined) {
      throw new BlackboxError(
        'fork mode needs to know how to continue after the fork point: "live" (your real API client) or "script" (recorded replies from a file)',
      );
    }
    const step = parent.steps[at];
    if (step === undefined || step.type !== "tool_result") {
      const toolResults = parent.steps.filter((s) => s.type === "tool_result").map((s) => s.index);
      throw new BlackboxError(
        `step ${at} is ${step === undefined ? "past the end of the cassette" : `a ${step.type} step`}; fork at a tool_result step` +
          (toolResults.length > 0
            ? ` (this cassette has tool results at ${toolResults.join(", ")})`
            : ". This cassette has no tool results: wrap your tools with bb.tools({...}) when recording"),
      );
    }
    if ((step.payload as { error?: unknown }).error === undefined && (step.payload as { result?: unknown }).result === undefined) {
      throw new BlackboxError(`step ${at} has no recorded result to replace`);
    }
  }

  #fork(call: RoundCall): JsonValue {
    const parent = this.#parent as Trace;
    const at = this.#options.forkAt as number;
    const original = parent.steps[at];
    const recorder = new TraceRecorder(this.#traceId(this.#options.out as string), {
      parentId: parent.id,
      forkedFromStepId: original.id,
      createdAt: parent.createdAt,
    });
    recorder.loadPrefix(parent.steps.slice(0, at));
    const replacement = this.#options.forkSet as JsonValue;
    recorder.append("tool_result", { toolCallId: call.toolCallId, toolName: call.toolName, result: replacement }, original.timestamp);
    this.#recorder = recorder;
    this.#forked = true;

    // Calls of this turn that the recording completed before the fork point are
    // already in the copied prefix; the rest run for real and are flushed later.
    for (const sibling of this.#round.calls) {
      if (sibling !== call && sibling.recorded && sibling.recorded.result.index < at) sibling.pending = undefined;
    }
    call.pending = undefined;
    return structuredClone(replacement);
  }

  // -------------------------------------------------------------------------
  // Finish, reporting, errors
  // -------------------------------------------------------------------------

  /**
   * A replay is reproduced only when the agent consumed every recorded step (in
   * both match modes) and ended the way the recording did: the terminal step
   * that finish() would write now must equal the recorded one.
   */
  #finishReplay(options: FinishOptions): FinishSummary {
    const parent = this.#parent as Trace;
    this.#settleRecordedRound();
    const last = parent.steps.at(-1);
    const recordedTerminal = last !== undefined && isTerminal(last) ? last : undefined;
    const body = recordedTerminal ? parent.steps.slice(0, -1) : parent.steps;
    const remaining = body.slice(this.#cursor).filter((step) => step.type !== "metadata");
    if (remaining.length > 0) {
      const modelCalls = remaining.filter((s) => s.type === "model_input").length;
      throw new ReplayDivergenceError({
        stepIndex: remaining[0].index,
        path: "end of run",
        expected:
          modelCalls > 0
            ? `${modelCalls} more model call(s)`
            : `the agent runs ${String((remaining[0].payload as { toolName?: unknown }).toolName ?? "the recorded tool")}`,
        actual: "the agent finished",
      });
    }

    const replayed = parent.steps.slice(0, this.#cursor);
    const now = terminalPayload(options, replayed, (text) => this.#mask(text));
    const recorded = recordedTerminal?.payload as JsonObject | undefined;
    if (canonicalize(now ?? null) !== canonicalize(recorded ?? null)) {
      throw new ReplayDivergenceError({
        stepIndex: recordedTerminal?.index ?? parent.steps.length,
        path: "outcome",
        expected: this.#mask(describeTerminal(recorded)),
        actual: this.#mask(describeTerminal(now)),
        hint:
          "  Every model call matched, but the agent ended the run differently: the result or error it passed " +
          "to finish() is not the recorded one.",
      });
    }

    this.#cursor = parent.steps.length;
    const summary: FinishSummary = {
      mode: "replay",
      steps: parent.steps.length,
      status: terminalOutcome(parent).status,
      replayedSteps: this.#cursor,
    };
    this.#writeReport({ ok: true, ...summary });
    return summary;
  }

  #appendTerminal(options: FinishOptions): void {
    const recorder = this.#recorder as TraceRecorder;
    const payload = terminalPayload(options, recorder.getTrace().steps, (text) => this.#mask(text));
    if (payload) recorder.append("metadata", payload);
  }

  /** A fork never writes over the cassette it forks, however the two paths are spelled. */
  #checkOutIsNotParent(): void {
    const { cassette, out } = this.#options;
    if (cassette !== undefined && out !== undefined && sameFile(out, cassette)) {
      throw new BlackboxError(
        `fork refuses to write its output over the cassette it forks: ${out} is the same file as ${cassette}; choose another out path`,
      );
    }
  }

  /** Write the cassette to `out`, checking again that it is not the parent. */
  #writeCassette(trace: Trace): string {
    if (this.mode === "fork") this.#checkOutIsNotParent();
    const path = resolve(this.#options.out as string);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(trace, null, 2));
    return path;
  }

  /** Refuse to write a cassette that fails verification or carries a known secret. */
  #checkWritable(trace: Trace): void {
    for (const secret of this.#secrets) {
      if (!auditTraceNeutrality(trace, secret).found.includes("<api-key-value>")) continue;
      throw new BlackboxError("refusing to write the cassette: it contains your API key");
    }
    const report = verifyTrace(trace);
    if (!report.pass) {
      throw new BlackboxError(
        `refusing to write the cassette: ${report.firstFailure?.name ?? "verification"} failed — ` +
          this.#mask(report.firstFailure?.detail ?? "unknown reason"),
      );
    }
  }

  #fail(error: BlackboxError, provider: Provider | undefined): Response {
    error.message = this.#mask(error.message);
    this.#failure ??= error;
    const message = `[blackbox] ${error.message}`;
    if (this.#options.logErrors) console.error(message);
    return jsonResponse(400, errorBody(provider, message));
  }

  #failTool(error: BlackboxError): BlackboxError {
    error.message = this.#mask(error.message);
    this.#failure ??= error;
    if (this.#options.logErrors) console.error(`[blackbox] ${error.message}`);
    return error;
  }

  #mask(text: string): string {
    return maskSecrets(text, [...this.#secrets]);
  }

  #collectSecrets(input: string | URL | Request, init?: RequestInit): void {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    for (const name of ["x-api-key", "api-key", "authorization"]) {
      const value = headers.get(name);
      if (value === null) continue;
      const secret = value.replace(/^Bearer\s+/i, "");
      if (secret.length > 0 && secret !== PLACEHOLDER_KEY) this.#secrets.add(secret);
    }
  }

  #traceId(outPath: string): string {
    return this.#options.traceId ?? (basename(outPath).replace(/\.json$/, "") || "run");
  }

  #loadParent(): Trace {
    const path = this.#options.cassette;
    if (path === undefined) throw new BlackboxError(`${this.mode} mode needs a cassette (cassette / BLACKBOX_CASSETTE)`);
    const trace = readJson(readText(path, "cassette"), `cassette ${path}`) as Trace;
    if (typeof trace !== "object" || trace === null || trace.version !== CURRENT_TRACE_VERSION) {
      throw new BlackboxError(`${path} is not a v${CURRENT_TRACE_VERSION} cassette`);
    }
    try {
      validateTrace(trace);
    } catch (error) {
      throw new BlackboxError(`${path} failed its hash-chain check: ${errorMessage(error)}`);
    }
    return trace;
  }

  /**
   * Safety net when the process exits without finish(): write what was recorded,
   * ending it like finish() would on a clean exit and as run_failed otherwise.
   */
  writeOnExit(exitCode: number): void {
    openSessions.delete(this);
    if (this.#finished || this.#finishError !== undefined || !this.#recorder || this.#failure) return;
    if (this.mode === "fork" && !this.#forked) return;
    try {
      const inFlight = this.#inFlight();
      if (inFlight === 0) this.#checkPrefixClaimed();
      this.#flushRound();
      if (this.#recorder.size() === 0) return;
      if (inFlight > 0) {
        // The process ended while calls were still running: whatever they did
        // is not in the cassette, so the run cannot count as a success.
        this.#recorder.append("metadata", { event: "run_failed", status: "error", reason: "calls_in_flight", exitCode, inFlight });
      } else if (exitCode === 0) this.#appendTerminal({});
      else {
        this.#recorder.append("metadata", { event: "run_failed", status: "error", reason: "process_exit", exitCode });
      }
      const trace = this.#recorder.getTrace();
      this.#checkWritable(trace);
      const path = this.#writeCassette(trace);
      this.#writeReport({ ok: true, mode: this.mode, path, steps: trace.steps.length, status: terminalOutcome(trace).status, finished: false });
    } catch (error) {
      this.#writeReport({ ok: false, mode: this.mode, error: this.#mask(errorMessage(error)) });
    }
  }

  #writeReport(report: Record<string, unknown>): void {
    const path = this.#options.reportPath;
    if (path === undefined) return;
    try {
      writeFileSync(path, JSON.stringify(report));
    } catch {
      // The report is advisory; the cassette and the exit code carry the result.
    }
  }
}

// One process exit hook for every record/fork session that has not finished.
const openSessions = new Set<BlackboxSession>();
let exitHookInstalled = false;
function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", (code) => {
    for (const session of [...openSessions]) session.writeOnExit(code);
  });
  // A signal (Ctrl-C) ends the process without the "exit" event, so write the
  // cassettes first. If the agent has its own handler, leave shutdown to it;
  // otherwise re-raise the signal so the process ends the way it would have.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const onSignal = (): void => {
      for (const session of [...openSessions]) session.writeOnExit(signal === "SIGINT" ? 130 : 143);
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
    };
    process.once(signal, onSignal);
  }
}

function readText(path: string, what: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new BlackboxError(`could not read ${what} ${path}: ${errorMessage(error)}`);
  }
}

/** Parse JSON; the error names a position, never the content. */
function readJson(text: string, what: string): unknown {
  try {
    return parseJson(text, what);
  } catch (error) {
    throw new BlackboxError(errorMessage(error));
  }
}

/**
 * The terminal metadata step finish() writes for these options after `steps`:
 * the passed error, else the passed result, else the last model output's final
 * answer. Undefined when the run ends without an outcome (incomplete).
 */
function terminalPayload(options: FinishOptions, steps: readonly TraceStep[], mask: (text: string) => string): JsonObject | undefined {
  if (options.error !== undefined) {
    return { event: "run_failed", status: "error", reason: "agent_error", message: mask(errorMessage(options.error)) };
  }
  if (options.result !== undefined) return { event: "run_completed", status: "success", result: options.result };
  const lastOutput = [...steps].reverse().find((step) => step.type === "model_output");
  const payload = lastOutput?.payload as { type?: string; text?: string } | undefined;
  if (payload?.type === "final_answer" && typeof payload.text === "string") {
    return { event: "run_completed", status: "success", result: payload.text };
  }
  return undefined;
}

function isTerminal(step: TraceStep): boolean {
  const event = (step.payload as { event?: unknown } | null)?.event;
  return step.type === "metadata" && (event === "run_completed" || event === "run_failed");
}

function describeTerminal(payload: JsonObject | undefined): string {
  if (payload === undefined) return "no outcome (the run ended incomplete)";
  if (payload["event"] === "run_completed") return `success, result ${renderValue(payload["result"])}`;
  const detail = payload["message"] !== undefined ? `: ${renderValue(payload["message"])}` : "";
  return `error (${String(payload["reason"] ?? "unknown")})${detail}`;
}

function isNeutralOutput(value: unknown): value is NeutralOutput {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (entry["type"] === "final_answer") return typeof entry["text"] === "string";
  if (entry["type"] === "tool_calls") {
    return (
      Array.isArray(entry["calls"]) &&
      entry["calls"].every((call) => typeof call === "object" && call !== null && typeof (call as Record<string, unknown>)["toolName"] === "string")
    );
  }
  return false;
}
