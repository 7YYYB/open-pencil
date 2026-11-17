import type { SceneNode } from '@open-pencil/scene-graph'

import { renderForModel } from '@/app/ai/tools/vision/render'
import type { EditorStore } from '@/app/editor/active-store'

export function selectedImage(store: EditorStore): SceneNode {
  const selected = [...store.state.selectedIds]
  const first = selected.length === 1 ? store.graph.getNode(selected[0]) : undefined
  const images =
    first?.type === 'FRAME'
      ? first.childIds
          .map((id) => store.graph.getNode(id))
          .filter((node) => node?.visible && node.fills.some((fill) => fill.type === 'IMAGE'))
      : [first]
  const image = images.length === 1 ? images[0] : undefined
  if (
    !image ||
    !image.visible ||
    image.childIds.length ||
    !image.fills.some((fill) => fill.type === 'IMAGE')
  ) {
    throw new Error('请单独选中一张完整效果图或一个图片元素。')
  }
  if (image.locked || !image.parentId) throw new Error('请先解锁所选图片。')
  return image
}

export async function captureSource(store: EditorStore, id: string) {
  const graph = store.graph
  const node = graph.getNode(id)
  if (
    !node ||
    node.locked ||
    !node.visible ||
    !node.parentId ||
    node.childIds.length ||
    !node.fills.some((fill) => fill.type === 'IMAGE')
  ) {
    throw new Error('需要选择一个可见且未锁定的图片图层。')
  }
  if (node.rotation !== 0) throw new Error('请先把整张效果图的旋转角度设为 0，再拆分或重生成。')
  const parent = graph.getNode(node.parentId)
  if (!parent || parent.locked) throw new Error('图片所在分组已锁定或移除。')
  const page = graph.closest(node.id, (candidate) => candidate.type === 'CANVAS')
  if (!page) throw new Error('图片不在有效页面中。')
  const snapshot = JSON.stringify({
    fills: node.fills,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    rotation: node.rotation,
    parentId: node.parentId
  })
  const check = () => {
    const current = graph.getNode(id)
    if (
      store.graph !== graph ||
      !current ||
      current.locked ||
      !current.visible ||
      graph.getNode(node.parentId ?? '')?.locked ||
      JSON.stringify({
        fills: current.fills,
        x: current.x,
        y: current.y,
        width: current.width,
        height: current.height,
        rotation: current.rotation,
        parentId: current.parentId
      }) !== snapshot
    ) {
      throw new Error('处理期间原图已被修改或移除，未覆盖你的修改。请重新选择后操作。')
    }
  }
  const rendered = await renderForModel(store, [id], page.id, 2048)
  if (!rendered) throw new Error('无法读取图片图层。')
  check()
  return { node: { ...node }, bytes: rendered.png, check, pageId: page.id }
}
