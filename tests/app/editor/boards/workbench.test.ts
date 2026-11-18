import { expect, test } from 'bun:test'

import { isChatModelID, parseImageModels } from '@/app/editor/boards/images/catalog'
import { studioIntent } from '@/app/editor/boards/workbench'

test('routes the competition board workflow from a single composer', () => {
  expect(studioIntent('做一张 A3 横版泥咕咕文创展板', false, true)).toBe('generate')
  expect(studioIntent('拆分这张展板', true, false)).toBe('split')
  expect(studioIntent('把衣服换成朱红色', true, false)).toBe('edit-image')
  expect(studioIntent('再做一版，构图大胆一点', true, false)).toBe('generate')
  expect(studioIntent('把图往左移一点', true, false)).toBeUndefined()
  expect(studioIntent('帮我分析这张展板', true, false)).toBeUndefined()
  expect(studioIntent('你好', false, true)).toBeUndefined()
})

test('a saved GPT chat ID does not become an image candidate by being listed', () => {
  expect(isChatModelID('gpt-6.2-astra')).toBe(true)
  expect(isChatModelID('gpt-image-custom')).toBe(false)
  const catalog = parseImageModels(
    JSON.stringify({
      data: [
        { id: 'gpt-6.2-astra', output_modalities: ['text'] },
        { id: 'custom-editor', supported_endpoints: ['/v1/images/edits'] }
      ]
    })
  )
  expect(catalog.filter(({ candidate }) => candidate).map(({ id }) => id)).toEqual([
    'custom-editor'
  ])
})
