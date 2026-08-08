import { scoreFields } from '@/helpers/scoreFields'
import type { SearchField } from '@/helpers/searchFields'
import { tokenize } from '@/helpers/searchTokens'
import type { ApiFeature } from '@diele/common'

/**
 * Returns the texts a feature is searched over, each weighted by how much a hit on it says.
 *
 * The same weighting idea the launcher uses: a hit on the name outranks one on the prose, so
 * typing a feature's name puts it first rather than whichever description mentions it.
 * @param {ApiFeature} feature - Feature to describe
 * @returns {ReadonlyArray<SearchField>} - Weighted fields, the label first
 */
function fieldsOf(feature: ApiFeature): ReadonlyArray<SearchField> {
  return [
    { text: feature.label, weight: 1 },
    { text: feature.id, weight: 0.9 },
    { text: feature.kind, weight: 0.6 },
    { text: feature.description, weight: 0.5 },
    { text: feature.fields.map((field) => field.label).join(' '), weight: 0.45 },
    { text: feature.produces.join(' '), weight: 0.4 },
  ]
}

/**
 * Filters and ranks the features a term addresses, so the admin view can be searched the way
 * the portal is. Every token has to hit something, which makes a second word narrow rather
 * than widen the result.
 * @param {ReadonlyArray<ApiFeature>} features - Everything configurable
 * @param {string} query - Raw search term as typed
 * @returns {ReadonlyArray<ApiFeature>} - Matching features, best first, source order when the term is empty
 */
export function searchFeatures(
  features: ReadonlyArray<ApiFeature>,
  query: string,
): ReadonlyArray<ApiFeature> {
  const tokens = tokenize(query)
  if (tokens.length === 0) {
    return features
  }

  const ranked: Array<{ feature: ApiFeature; score: number; order: number }> = []

  features.forEach((feature, order) => {
    const score = scoreFields(fieldsOf(feature), tokens)
    if (score === undefined) {
      return
    }

    ranked.push({ feature, score, order })
  })

  ranked.sort((a, b) => b.score - a.score || a.order - b.order)

  return ranked.map((entry) => entry.feature)
}
