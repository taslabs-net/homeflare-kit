/**
 * What a `LiteLLM.Model` declares (props) and what is remembered about it (attributes).
 *
 * ⛔ NO CREDENTIAL VALUE IS A PROP OR AN ATTRIBUTE (S25). Alchemy persists props AND attributes
 *   unencrypted (`StateEncoding.ts` writes a `Redacted` value's inner string beside its tag,
 *   measured on alchemy 2.0.0-beta.79), so `apiKey` is `{ fromEnv: 'NAME' }`: the NAME is stored,
 *   the value lives only in the deploying process and on the wire, and it is sent in LiteLLM's own
 *   reference form `os.environ/NAME` — so the PROXY reads it from ITS environment at call time and
 *   the proxy's own DB row never carries a literal either. A `Redacted` prop would still land in
 *   state as plaintext (mcp-server-types.ts's reasoning, same store).
 * ⛔ THE LIVE ROW'S `litellm_params` ARE NEVER MIRRORED INTO ATTRIBUTES. At v1.103.0 the read
 *   answers the stored params DECRYPTED but STRIPS `api_key` (measured on a live 1.103.0 proxy),
 *   and anything mirrored would land in state as plaintext — Alchemy persists attributes
 *   unencrypted. So a read compares only the visible fields the proxy returns, and this
 *   resource's own attributes carry a DIGEST of the DECLARED values (`paramsSeal`), never the
 *   values: that is how a plan notices a declared credential moved when the read cannot show it.
 * ⚠️ NOT MODELLED, on purpose: the rest of `litellm_params` (rpm/tpm, timeouts, fallbacks,
 *   wildcard routing params, `mock_response`, vertex/aws credential blobs, …), cost fields on
 *   `model_info` beyond what the read returns, `teams`, and the config-file-only rows
 *   (`db_model: false`) — a reconcile that finds one REFUSES it (model-errors.ts): the DB
 *   API cannot manage what the proxy serves from its config file.
 */
import type { FromEnv } from '../secrets/write-only.ts';

/**
 * The LiteLLM-SDK path of the deployment: a provider prefix, then the upstream model, such as
 * `xai/grok-4.7` or `cloudflare/@cf/meta/llama-3.1-8b-instruct`. Required: LiteLLM needs it to
 * pick the provider handler, and an unprefixed name is ambiguous.
 */
export type ModelLiteLLMPath = string;

export interface ModelProps {
  /**
   * The group name callers use (`/chat/completions` `model: …`), one group = one or more
   * deployments. This is also how an existing row is ADOPTED: the live row whose `model_name`
   * equals it. ⛔ Renaming a group changes nothing upstream — LiteLLM keys deployments by id —
   * so a changed `modelName` with no pinned `id` is a REPLACE: the new group gets a fresh id, and
   * the old row survives under the default `RemovalPolicy.retain()` (opt in to `destroy()` to
   * delete it). A pinned `id` is that row: the same deployment is renamed in place
   * (`patchBody` sends `model_name`), and keys routing to the old name miss.
   */
  readonly modelName: string;
  /**
   * Pins the live row (adopts by id) or chooses the id a create asks for. Without it, a live row
   * is found by `modelName` and a new one gets a deterministic physical name. A group name is
   * shared by several deployments on a live proxy: one id selects exactly one.
   */
  readonly id?: string;
  /** The LiteLLM-SDK path, provider prefix included (`xai/grok-4.7`, `cloudflare/@cf/...`). */
  readonly model: string;
  /**
   * The upstream base URL, when the deployment needs one. ⛔ Refused if it carries userinfo, a
   * fragment or a secret-looking query parameter (`?token=…`): the URL is a prop, so it lands in
   * state. Declare the credential as `apiKey` instead.
   */
  readonly apiBase?: string;
  /**
   * The upstream credential, by the NAME of the environment variable that holds it — sent to the
   * proxy as LiteLLM's own reference form `os.environ/NAME`, never a literal value. Omitted
   * leaves the live credential exactly as the proxy holds it (an adopted row is never blanked).
   */
  readonly apiKey?: FromEnv;
  /** The deployment's capabilities, `mode` in LiteLLM's model_info — `chat`, `embedding`, …. */
  readonly mode?: string;
  /** The upstream model this one masquerades as, for cost/prompt mapping. */
  readonly baseModel?: string;
  /** Access groups this deployment belongs to. Always compared (as a set), default empty. */
  readonly accessGroups?: readonly string[];
}

export interface ModelAttributes {
  readonly id: string;
  readonly modelName: string;
  /** Whether the row is served from the database (`model_info.db_model`); false = config-file row. */
  readonly dbModel: boolean;
  /** The provider-prefixed path as the live row carries it (null when the read omits it). */
  readonly model: string | null;
  readonly mode: string | null;
  readonly baseModel: string | null;
  readonly accessGroups: readonly string[];
  /**
   * Digest of the DECLARED params this write would send (`scrypt:<salt>:<digest>`), or `''`.
   * ⛔ Never the values, never a digest of the LIVE row. This is how a plan notices that the
   * environment variable behind `apiKey` rotated: the read strips `api_key`, so the seal is the
   * only signal a declared credential moved (model-form.ts's `declaredDigest`).
   */
  readonly paramsSeal: string;
}

/** Whether a value is not a string with something in it. Takes `unknown`: a declaration can say anything. */
export const isBlank = (value: unknown): boolean =>
  typeof value !== 'string' || value.trim() === '';

export const MODES: readonly string[] = [
  'chat',
  'completion',
  'embedding',
  'audio_transcription',
  'audio_speech',
  'image_generation',
  'image_editing',
  'moderation',
  'rerank',
  'search',
  'realtime',
  'batch',
  'video',
  'ocr',
];

/** Whether `model` carries a provider prefix, LiteLLM's `litellm.utils.get_llm_provider` rule. */
export const hasProviderPrefix = (model: string): boolean => /^[a-z0-9_-]+\//i.test(model);
