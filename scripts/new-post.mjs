#!/usr/bin/env node

import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

const args = process.argv.slice(2)

if (args.length === 0 || args.includes('--help')) {
  console.log(`
Usage: npm run new-post -- <slug> [options]

Options:
  --tier <foundations|applied|professional>  Content tier (default: foundations)
  --type <tutorial|explainer|project-walkthrough|cert-study-notes|today-i-learned>
  --category <networking|web-development|cybersecurity|ai-ml|linux|cloud-computing|python|javascript-typescript|devops|career>
  --difficulty <beginner|intermediate|advanced|expert>
  --minutes <number>  Estimated reading time

Example:
  npm run new-post -- my-first-linux-terminal --tier foundations --type tutorial --category linux --difficulty beginner --minutes 20
`)
  process.exit(0)
}

const slug = args[0]
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag)
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback
}

const tier = getArg('--tier', 'foundations')
const postType = getArg('--type', 'tutorial')
const category = getArg('--category', 'linux')
const difficulty = getArg('--difficulty', 'beginner')
const minutes = getArg('--minutes', '15')
const today = new Date().toISOString().split('T')[0]

const dir = join('src', 'content', 'posts', tier)
if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

const filePath = join(dir, `${slug}.md`)
if (existsSync(filePath)) {
  console.error(`File already exists: ${filePath}`)
  process.exit(1)
}

const template = `---
title: ""
description: ""
publishDate: ${today}
author: j-martin
tier: ${tier}
postType: ${postType}
difficulty: ${difficulty}
estimatedMinutes: ${minutes}
prerequisites: []
category: ${category}
tags: []
certTracks: []
featured: false
draft: true
---

## Why Should You Care?

<!-- Hook: What problem does this solve? Why does it matter to the reader? -->

## What We're Building

<!-- Brief: What will the reader have by the end? -->

## Let's Go

### Step 1

<!-- Hands-on: real commands, real output -->

\`\`\`bash
$ command here
\`\`\`

## What You Learned

<!-- Recap: 3-5 bullet points of what the reader now knows -->
`

writeFileSync(filePath, template)
console.log(`Created: ${filePath}`)
console.log(`  Tier: ${tier} | Type: ${postType} | Category: ${category}`)
console.log(`  Edit the file, set draft: false when ready to publish.`)
