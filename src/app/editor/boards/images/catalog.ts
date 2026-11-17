import { joinURL } from 'ufo'
import * as v from 'valibot'

import type { FetchFunction } from '@/app/http/types'

const modelSchema = v.looseObject({
  id: v.pipe(v.string(), v.minLength(1)),
  supported_endpoints: v.optional(v.array(v.string())),
  output_modalities: v.optional(v.array(v.string()))
})
const catalogSchema = v.object({ data: v.array(modelSchema) })

export interface ImageModelOption {
  id: string
  candidate: boolean
}

function imagePreference(id: string) {
  if (/gpt-image/i.test(id)) return 3
  if (/seedream|flux|imagen/i.test(id)) return 2
  if (/dall-e/i.test(id)) return 1
  return 0
}

/** Only the provider's returned IDs are offered; names are hints, not proof of API support. */
export function parseImageModels(text: string): ImageModelOption[] {
  const result = v.safeParse(v.pipe(v.string(), v.parseJson(), catalogSchema), text)
  if (!result.success) throw new Error('服务商未返回标准模型列表。可在高级设置填写模型 ID。')
  return result.output.data
    .map((model) => ({
      id: model.id,
      candidate:
        model.supported_endpoints?.some((endpoint) => endpoint.includes('images/')) === true ||
        model.output_modalities?.includes('image') === true ||
        /(?:gpt-image|dall-e|flux|seedream|imagen|stable-diffusion|image-generation)/i.test(
          model.id
        )
    }))
    .sort(
      (a, b) =>
        Number(b.candidate) - Number(a.candidate) ||
        imagePreference(b.id) - imagePreference(a.id) ||
        b.id.localeCompare(a.id, undefined, { numeric: true })
    )
}

export async function fetchImageModels(
  baseURL: string,
  apiKey: string,
  fetcher: FetchFunction,
  signal: AbortSignal
): Promise<ImageModelOption[]> {
  const response = await fetcher(joinURL(baseURL, 'models'), {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`模型列表读取失败（HTTP ${response.status}）。可重试或在高级设置填写。`)
  }
  return parseImageModels(await response.text())
}
