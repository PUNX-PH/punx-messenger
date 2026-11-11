// Writes src/patterns.css from src/lib/chatPatterns.js:
//
//   node scripts/gen-patterns.mjs
//
// The CSS is committed (the page must have it before the first paint), and
// tests/chat-patterns.test.mjs fails if it is out of date with the definitions.
import fs from 'node:fs'
import { patternsCss } from '../src/lib/chatPatterns.js'

fs.writeFileSync('src/patterns.css', patternsCss().replace(/\r?\n/g, '\r\n'))
console.log('wrote src/patterns.css')
