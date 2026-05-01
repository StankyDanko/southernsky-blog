const tierToLevel: Record<string, string> = {
  foundations: 'Beginner',
  applied: 'Intermediate',
  professional: 'Advanced',
}

export function articleJsonLd(post: {
  title: string
  description: string
  publishDate: Date
  updatedDate?: Date
  tier: string
  estimatedMinutes: number
  difficulty: string
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: post.title,
    description: post.description,
    author: { '@type': 'Person', name: 'J. Martin' },
    datePublished: post.publishDate.toISOString(),
    dateModified: (post.updatedDate || post.publishDate).toISOString(),
    educationalLevel: tierToLevel[post.tier] || 'Intermediate',
    timeRequired: `PT${post.estimatedMinutes}M`,
    proficiencyLevel: post.difficulty,
    publisher: {
      '@type': 'Organization',
      name: 'SouthernSky Cloud LLC',
      url: 'https://southernsky.cloud',
    },
  }
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  }
}
