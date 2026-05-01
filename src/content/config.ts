import { defineCollection, z } from 'astro:content'

const posts = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string().max(80),
    description: z.string().max(160),
    publishDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    author: z.string().default('j-martin'),

    tier: z.enum(['foundations', 'applied', 'professional']),
    postType: z.enum([
      'tutorial',
      'explainer',
      'project-walkthrough',
      'cert-study-notes',
      'today-i-learned',
    ]),

    difficulty: z.enum(['beginner', 'intermediate', 'advanced', 'expert']),
    estimatedMinutes: z.number().int().positive(),
    prerequisites: z.array(z.string()).default([]),

    category: z.enum([
      'networking',
      'web-development',
      'cybersecurity',
      'ai-ml',
      'linux',
      'cloud-computing',
      'python',
      'javascript-typescript',
      'devops',
      'career',
    ]),
    tags: z.array(z.string()).default([]),
    certTracks: z.array(z.string()).default([]),

    heroImage: z.string().optional(),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
})

const authors = defineCollection({
  type: 'data',
  schema: z.object({
    name: z.string(),
    title: z.string(),
    bio: z.string(),
    avatar: z.string(),
    links: z.object({
      github: z.string().optional(),
      twitter: z.string().optional(),
      website: z.string().optional(),
    }).default({}),
  }),
})

const certTracks = defineCollection({
  type: 'data',
  schema: z.object({
    name: z.string(),
    shortName: z.string(),
    vendor: z.string(),
    examCode: z.string().optional(),
    description: z.string(),
    color: z.string(),
    postOrder: z.array(z.string()),
  }),
})

export const collections = { posts, authors, 'cert-tracks': certTracks }
