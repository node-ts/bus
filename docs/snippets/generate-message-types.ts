import { generateMessageTypes } from '@node-ts/bus-cli'
import { writeFileSync } from 'node:fs'

// Throws MessageTypeGenerationFailed, with a `problems` list, if the types can't be generated
const { outFile, content } = generateMessageTypes({
  entry: ['src/messages/**/*.ts']
})
writeFileSync(outFile, content)
