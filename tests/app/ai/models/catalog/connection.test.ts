import { expect, test } from 'bun:test'

import { fetchAccountModels, parseAccountModels } from '@/app/ai/models/catalog/connection'

test('only selects image candidates actually listed by the provider, retaining other IDs', () => {
  const models = parseAccountModels(
    JSON.stringify({
      data: [
        { id: 'chat-vision' },
        { id: 'provider/gpt-image-custom' },
        { id: 'private-painter', supported_endpoints: ['/v1/images/generations'] },
        { id: 'vendor-paint', supported_endpoint_types: ['image-generation'] },
        { id: 'vision-chat', modalities: { input: ['text', 'image'], output: ['text'] } },
        { owned_by: 'malformed' }
      ]
    })
  )
  expect(
    models
      .filter((model) => model.candidate)
      .map((model) => model.id)
      .sort()
  ).toEqual(['private-painter', 'provider/gpt-image-custom', 'vendor-paint'])
  expect(models.find((model) => model.id === 'chat-vision')?.candidate).toBe(false)
  expect(
    models
      .filter((model) => model.conversation)
      .map((model) => model.id)
      .sort()
  ).toEqual(['chat-vision', 'vision-chat'])
  expect(models.find((model) => model.id === 'vision-chat')?.imageInput).toBe(true)
})

test('reads the account catalog using its existing base URL and credential without a paid image call', async () => {
  let requested = ''
  const result = await fetchAccountModels(
    'https://gateway.example/v1',
    'test-key',
    new AbortController().signal,
    async (url, init) => {
      requested = String(url)
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-key')
      return Response.json({ data: [{ id: 'gpt-image-custom' }] })
    }
  )
  expect(requested).toBe('https://gateway.example/v1/models')
  expect(result[0]?.id).toBe('gpt-image-custom')
})
