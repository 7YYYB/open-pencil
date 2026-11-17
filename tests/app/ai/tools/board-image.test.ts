import 'fake-indexeddb/auto'
import { expect, spyOn, test } from 'bun:test'

import { FigmaAPI } from '@open-pencil/core/figma-api'

import { prepareBoardImageTool } from '@/app/ai/tools/board-image'
import * as generation from '@/app/editor/boards/images/generate'
import { createEditorStore } from '@/app/editor/session/create'

const png = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
  0
])

test('does not insert generated artwork after the original run stopped without an SDK abort', async () => {
  const store = createEditorStore()
  const figma = new FigmaAPI(store.graph)
  const generate = spyOn(generation, 'generateBoardImage').mockResolvedValue(png)
  let active = true
  const input = {
    purpose: 'illustration',
    name: '角色',
    prompt: '陶土角色',
    x: 0,
    y: 0,
    width: 100,
    height: 100
  }
  try {
    const ready = await prepareBoardImageTool(store, figma, input, { isLive: () => active })
    const count = figma.currentPage.children.length
    active = false
    expect(() => ready.execute(figma, input)).toThrow('设计任务已停止')
    expect(figma.currentPage.children.length).toBe(count)
  } finally {
    generate.mockRestore()
    store.dispose()
  }
})
