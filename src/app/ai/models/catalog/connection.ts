import { joinURL } from 'ufo'
import * as v from 'valibot'

import { IS_TAURI, type AIProviderID } from '@open-pencil/core/constants'

import { readBoundedBody } from '@/app/document/io/browser'
import type { FetchFunction } from '@/app/http/types'
import { validSettingsURL } from '@/app/settings/validation/schema'
import { tauriFetch } from '@/app/tauri/http'

const modelSchema = v.looseObject({
  id: v.pipe(v.string(), v.trim(), v.minLength(1)),
  supported_endpoints: v.fallback(v.optional(v.array(v.string())), undefined),
  supported_endpoint_types: v.fallback(v.optional(v.array(v.string())), undefined),
  output_modalities: v.fallback(v.optional(v.array(v.string())), undefined),
  input_modalities: v.fallback(v.optional(v.array(v.string())), undefined),
  modalities: v.fallback(
    v.optional(
      v.object({
        input: v.fallback(v.optional(v.array(v.string())), undefined),
        output: v.fallback(v.optional(v.array(v.string())), undefined)
      })
    ),
    undefined
  )
})
const catalogSchema = v.object({ data: v.array(v.unknown()) })

export interface AccountModel {
  id: string
  candidate: boolean
  conversation: boolean
  imageInput?: boolean
}

export const MODEL_CATALOG_TIMEOUT_MS = 20_000
const MAX_CATALOG_BYTES = 4 * 1024 * 1024
const CACHE_MS = 5 * 60_000
const cache = new Map<
  string,
  { url: string; revision: number; until: number; models: AccountModel[] }
>()

export function supportsAccountCatalog(providerID: AIProviderID) {
  return providerID === 'openai' || providerID === 'openai-compatible'
}

export function accountCatalogBaseURL(providerID: AIProviderID, customBaseURL: string) {
  return providerID === 'openai' ? 'https://api.openai.com/v1' : customBaseURL.trim()
}

export function cachedAccountModels(id: string, url: string, revision: number) {
  const hit = cache.get(id)
  if (hit?.url === url && hit.revision === revision && hit.until > Date.now()) return hit.models
}

export function rememberAccountModels(
  id: string,
  url: string,
  revision: number,
  models: AccountModel[]
) {
  cache.set(id, { url, revision, models, until: Date.now() + CACHE_MS })
}

export function isChatModelID(id: string): boolean {
  return (
    /(?:^|[/_-])(?:gpt-[456](?:[.\d-]|$)|chatgpt|claude|deepseek|qwen|gemini)/i.test(id) &&
    !/(?:image|imagen|banana)/i.test(id)
  )
}

function imagePreference(id: string) {
  if (/gpt-image/i.test(id)) return 3
  if (/seedream|flux|imagen/i.test(id)) return 2
  if (/dall-e/i.test(id)) return 1
  return 0
}

function accountModel(model: v.InferOutput<typeof modelSchema>): AccountModel {
  const output = model.output_modalities ?? model.modalities?.output
  const input = model.input_modalities ?? model.modalities?.input
  const endpointTypes = model.supported_endpoint_types
  const imageEndpoint =
    model.supported_endpoints?.some((endpoint) =>
      /images\/(?:generations|edits)/i.test(endpoint)
    ) ||
    endpointTypes?.some((endpoint) => /^(?:image[-_]generation|image[-_]edit)$/i.test(endpoint))
  const chatEndpoint = model.supported_endpoints?.some((endpoint) =>
    /chat\/completions|\/responses$/i.test(endpoint)
  )
  const imageName =
    /(?:gpt-image|dall-e|flux|seedream|imagen|stable-diffusion|image-generation|nano[-_ ]banana)/i.test(
      model.id
    )
  const candidate = Boolean(
    imageEndpoint || (output?.length ? output.includes('image') : imageName)
  )
  return {
    id: model.id,
    candidate,
    conversation: Boolean(
      chatEndpoint ||
      output?.includes('text') ||
      (!candidate &&
        !output?.length &&
        !/(?:embed|rerank|moderation|whisper|tts|transcri|speech|video)/i.test(model.id))
    ),
    imageInput: input?.includes('image')
  }
}

/** Model IDs come from the connected account. Names without capability metadata are hints. */
export function parseAccountModels(text: string): AccountModel[] {
  const result = v.safeParse(v.pipe(v.string(), v.parseJson(), catalogSchema), text)
  if (!result.success) throw new Error('服务商未返回可读取的模型列表，可以手动填写模型 ID。')
  const seen = new Set<string>()
  return result.output.data
    .flatMap((entry) => {
      const parsed = v.safeParse(modelSchema, entry)
      if (!parsed.success || seen.has(parsed.output.id)) return []
      seen.add(parsed.output.id)
      return [accountModel(parsed.output)]
    })
    .sort(
      (a, b) =>
        Number(b.candidate) - Number(a.candidate) ||
        imagePreference(b.id) - imagePreference(a.id) ||
        b.id.localeCompare(a.id, undefined, { numeric: true })
    )
}

export async function fetchAccountModels(
  baseURL: string,
  apiKey: string,
  signal: AbortSignal,
  fetcher: FetchFunction = IS_TAURI
    ? (input, init) => tauriFetch(input, init, MAX_CATALOG_BYTES, MODEL_CATALOG_TIMEOUT_MS)
    : fetch
): Promise<AccountModel[]> {
  if (!validSettingsURL(baseURL)) throw new Error('请填写有效的 API 基础 URL。')
  const response = await fetcher(joinURL(baseURL, 'models'), {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal
  }).catch(() => {
    signal.throwIfAborted()
    throw new Error('无法连接 API 的模型列表，请检查基础 URL 和网络。')
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    if (response.status === 401 || response.status === 403) {
      throw new Error('服务商拒绝读取模型列表，请检查密钥和权限。')
    }
    if (response.status === 404) throw new Error('此 API 未提供模型列表，可以手动填写模型 ID。')
    throw new Error(`模型列表读取失败（HTTP ${response.status}）。`)
  }
  const bytes = await readBoundedBody(response, MAX_CATALOG_BYTES, {
    sizeError: '服务商返回的模型列表过大。'
  })
  signal.throwIfAborted()
  return parseAccountModels(new TextDecoder().decode(bytes))
}
