import * as v from 'valibot'

export const imageResponseSchema = v.object({
  data: v.pipe(
    v.array(
      v.object({
        b64_json: v.optional(v.string()),
        url: v.optional(v.string())
      })
    ),
    v.minLength(1)
  )
})
