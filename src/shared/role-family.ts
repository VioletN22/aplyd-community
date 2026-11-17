export const ROLE_FAMILIES = [
  { key: 'full_stack', label: 'Full stack' },
  { key: 'frontend', label: 'Frontend' },
  { key: 'software', label: 'Software' },
  { key: 'infra_network', label: 'Infra / network' },
  { key: 'ai_ml', label: 'AI / ML' },
  { key: 'retail_casual', label: 'Retail / casual' },
  { key: 'other', label: 'Other' },
] as const;
export type RoleFamily = (typeof ROLE_FAMILIES)[number]['key'];

// First match wins, so the order is the precedence: "Full Stack React
// Developer" is full stack, "ML Platform Engineer" is AI, "Casual Retail
// Assistant" is retail.
const FAMILY_RULES: [RoleFamily, RegExp][] = [
  ['full_stack', /\bfull[\s-]?stack\b/i],
  ['ai_ml', /\b(ai|a\.i\.|ml|mlops|llm|genai|gen ai|machine learning|deep learning|data scien\w*|nlp|computer vision|prompt engineer\w*)\b/i],
  ['frontend', /\b(front[\s-]?end|react|ui|ux\/ui|ui\/ux|web developer|web designer|angular|vue)\b/i],
  ['infra_network', /\b(network\w*|infrastructure|infra|devops|dev ops|cloud|sre|site reliability|platform engineer\w*|sys ?admin\w*|systems? (administrator|engineer)|it support|help ?desk|service desk|technical support|desktop support|security|noc|linux)\b/i],
  ['retail_casual', /\b(retail|casual|sales (assistant|associate)|store|shop|barista|crew|team member|cashier|hospitality|customer service|warehouse|waiter|waitress|kitchen|picker|packer)\b/i],
  ['software', /\b(software|developer|programmer|engineer|back[\s-]?end|graduate|mobile|ios|android|qa|test automation)\b/i],
];

/** Pure keyword bucketing of a job title. */
export function roleFamily(title: string | null | undefined): RoleFamily {
  const t = String(title || '');
  for (const [key, re] of FAMILY_RULES) if (re.test(t)) return key;
  return 'other';
}
