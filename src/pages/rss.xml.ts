import rss from '@astrojs/rss'
import { getCollection } from 'astro:content'
import { siteConfig } from '../data/site-config'
import type { APIContext } from 'astro'

export async function GET(context: APIContext) {
  const posts = (await getCollection('posts', ({ data }) => !data.draft))
    .sort((a, b) => b.data.publishDate.valueOf() - a.data.publishDate.valueOf())

  return rss({
    title: siteConfig.title,
    description: siteConfig.description,
    site: context.site!,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.publishDate,
      description: post.data.description,
      link: `/blog/${post.slug}/`,
      categories: [post.data.tier, post.data.category, ...post.data.tags],
    })),
  })
}
