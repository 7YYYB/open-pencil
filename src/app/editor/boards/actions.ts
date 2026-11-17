import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'
import { ensureGraphFonts } from '@/app/editor/fonts'

export const A3 = { width: 3508, height: 4961 } as const

export function createBoard(store: EditorStore, landscape = false) {
  const pageId = store.state.currentPageId
  const siblings = store.graph.getNode(pageId)?.childIds ?? []
  const x = siblings.reduce((edge, id) => {
    const node = store.graph.getNode(id)
    return node ? Math.max(edge, node.x + node.width + 160) : edge
  }, 0)
  store.recordEdit({ label: '新建 A3 展板', restoresSelection: true }, () => {
    const board = store.graph.createNode('FRAME', pageId, {
      name: `A3 ${landscape ? '横版' : '竖版'} · 300 ppi`,
      x, y: 0,
      width: landscape ? A3.height : A3.width,
      height: landscape ? A3.width : A3.height,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
    })
    store.select([board.id])
  })
  store.zoomToSelection()
}

export function selectedBoard(store: EditorStore): SceneNode | undefined {
  const first = [...store.state.selectedIds][0]
  if (!first) return undefined
  let node = store.graph.getNode(first)
  while (node && node.type !== 'CANVAS') {
    if (node.type === 'FRAME' && node.parentId === store.state.currentPageId) return node
    node = node.parentId ? store.graph.getNode(node.parentId) : undefined
  }
  return undefined
}

export async function replaceBoardFonts(store: EditorStore, family: string) {
  const roots = [...store.state.selectedIds]
  if (!roots.length || !family.trim()) throw new Error('请先选择文字、分组或展板，再选择字体。')
  const textIds = new Set<string>()
  function visit(id: string) {
    const node = store.graph.getNode(id)
    if (!node || node.locked) return
    if (node.type === 'TEXT') textIds.add(id)
    for (const child of node.childIds) visit(child)
  }
  roots.forEach(visit)
  if (!textIds.size) throw new Error('所选内容没有可编辑文字；图片中的文字需要先重建。')
  store.recordEdit({ label: '批量更换展板字体' }, () => {
    for (const id of textIds) {
      const node = store.graph.getNode(id)
      if (!node) continue
      store.graph.updateNode(id, {
        fontFamily: family,
        styleRuns: node.styleRuns.map(run => ({ ...run, style: { ...run.style, fontFamily: family } }))
      })
    }
  })
  await ensureGraphFonts(store.graph, [...textIds], store.renderer)
  for (const id of textIds) store.runLayoutForNode(id)
  store.requestRender()
  return textIds.size
}

export async function exportBoard(store: EditorStore, format: 'png' | 'jpg') {
  const board = selectedBoard(store)
  if (!board) throw new Error('请先选中一张展板或展板内的元素。')
  await ensureGraphFonts(store.graph, [board.id], store.renderer)
  await store.exportTarget({ scope: 'selection', nodeIds: [board.id] }, format, { scale: 1 })
}
