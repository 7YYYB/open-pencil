import { expect, test } from 'bun:test'

import { fetchImageModels, parseImageModels } from '@/app/editor/boards/images/catalog'

test('only selects image candidates actually listed by the provider, retaining other IDs', () => {
  const models = parseImageModels(
    JSON.stringify({
      data: [
        { id: 'chat-vision' },
        { id: 'provider/gpt-image-custom' },
        { id: 'private-painter', supported_endpoints: ['/v1/images/generations'] }
      ]
    })
  )
  expect(
    models
      .filter((model) => model.candidate)
      .map((model) => model.id)
      .sort()
  ).toEqual(['private-painter', 'provider/gpt-image-custom'])
  expect(models.find((model) => model.id === 'chat-vision')?.candidate).toBe(false)
})

test('reads the account catalog using its existing base URL and credential without a paid image call', async () => {
  let requested = ''
  const result = await fetchImageModels(
    'https://gateway.example/v1',
    'test-key',
    async (url, init) => {
      requested = String(url)
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-key')
      return Response.json({ data: [{ id: 'gpt-image-custom' }] })
    },
    new AbortController().signal
  )
  expect(requested).toBe('https://gateway.example/v1/models')
  expect(result[0]?.id).toBe('gpt-image-custom')
})
