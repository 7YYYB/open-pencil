import * as v from 'valibot'

const coordinateSchema = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1000))
export const boardTextSchema = v.object({
  blocks: v.pipe(
    v.array(
      v.object({
        text: v.pipe(v.string(), v.maxLength(8000)),
        x: coordinateSchema,
        y: coordinateSchema,
        width: v.pipe(coordinateSchema, v.minValue(1)),
        height: v.pipe(coordinateSchema, v.minValue(1)),
        fontSize: v.pipe(v.number(), v.finite(), v.minValue(1), v.maxValue(500)),
        fontFamily: v.string(),
        fontWeight: v.picklist([100, 200, 300, 400, 500, 600, 700, 800, 900]),
        color: v.pipe(v.string(), v.regex(/^#[0-9a-fA-F]{6}$/)),
        align: v.picklist(['LEFT', 'CENTER', 'RIGHT']),
        decorative: v.boolean(),
        uncertain: v.boolean()
      })
    ),
    v.maxLength(150)
  )
})
export type BoardTextBlock = v.InferOutput<typeof boardTextSchema>['blocks'][number]
