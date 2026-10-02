// @ts-check
// A TypeDoc plugin that fails the API reference build on a `{@link}` that
// doesn't resolve, while missing JSDoc (`validation.notDocumented`) stays a
// warning. TypeDoc's own `treatValidationWarningsAsErrors` can't tell the two
// apart, so this checks the links itself and logs each broken one as an error.
import { Application } from 'typedoc'

const LINK_TAGS = new Set(['@link', '@linkcode', '@linkplain'])

/**
 * @param {import('typedoc').CommentDisplayPart[]} parts
 * @returns {string[]} the text of each link that didn't resolve
 */
const brokenLinks = parts =>
  parts
    .filter(
      part =>
        part.kind === 'inline-tag' &&
        LINK_TAGS.has(part.tag) &&
        part.target === undefined
    )
    .map(part => part.text.trim())

/**
 * @param {import('typedoc').Comment | undefined} comment
 * @returns {string[]}
 */
const brokenCommentLinks = comment =>
  comment
    ? [
        ...brokenLinks(comment.summary),
        ...comment.blockTags.flatMap(tag => brokenLinks(tag.content))
      ]
    : []

/**
 * @param {Application} app
 */
export const load = app => {
  app.on(Application.EVENT_VALIDATE_PROJECT, project => {
    // The merged project of every package can hold the same comment twice
    const reported = new Set()
    for (const reflection of Object.values(project.reflections)) {
      for (const link of brokenCommentLinks(reflection.comment)) {
        const message = `Failed to resolve {@link ${link}} in the comment for ${reflection.getFriendlyFullName()}. Link to an exported declaration, or use a plain URL.`
        if (!reported.has(message)) {
          reported.add(message)
          app.logger.error(message)
        }
      }
    }
  })
}
