import type { ApiFieldSpec } from '@diele/common'

const LINK_FIELDS: ReadonlyArray<ApiFieldSpec> = [
  { key: 'label', label: 'Label', input: 'text', required: true },
  {
    key: 'url',
    label: 'URL',
    input: 'url',
    required: true,
    placeholder: 'https://example.com',
  },
  {
    key: 'keywords',
    label: 'Keywords',
    input: 'keywords',
    placeholder: 'grafana, dashboards, metrics',
    hint: 'comma separated; extra terms that match this entry beyond its name and url',
  },
]

export const CARD_FIELDS: ReadonlyArray<ApiFieldSpec> = [
  ...LINK_FIELDS,
  {
    key: 'iconId',
    label: 'Icon',
    input: 'icon',
    hint: 'upload an svg; it is stripped of everything but its shapes and recoloured to follow the card',
  },
  {
    key: 'color',
    label: 'Accent',
    input: 'color',
    placeholder: '#1E88E5',
    hint: 'six-digit hex; the brand colour the logo turns on hover, monochrome at rest',
  },
]

export const SITE_FIELDS: ReadonlyArray<ApiFieldSpec> = [
  ...LINK_FIELDS,
  {
    key: 'display',
    label: 'Detail',
    input: 'text',
    hint: 'second column text; falls back to the url host',
  },
]

export const LOCALHOST_FIELDS: ReadonlyArray<ApiFieldSpec> = [
  {
    key: 'scheme',
    label: 'Scheme',
    input: 'select',
    required: true,
    options: [
      { value: 'https', label: 'https' },
      { value: 'http', label: 'http' },
    ],
  },
  {
    key: 'port',
    label: 'Port',
    input: 'number',
    required: true,
    placeholder: '5173',
    hint: 'the host is always localhost; the url follows from the scheme and the port',
  },
  {
    key: 'keywords',
    label: 'Tags',
    input: 'keywords',
    placeholder: 'vue, frontend',
    hint: 'comma separated; what runs on this port, so it is findable by more than its number',
  },
]

export const COMMAND_FIELDS: ReadonlyArray<ApiFieldSpec> = [
  {
    key: 'keyword',
    label: 'Keyword',
    input: 'text',
    required: true,
    placeholder: 'yt',
    hint: 'what follows the slash; no spaces or slashes of its own',
  },
  { key: 'label', label: 'Label', input: 'text', placeholder: 'YouTube' },
  {
    key: 'urlTemplate',
    label: 'Query URL',
    input: 'template',
    required: true,
    placeholder: 'https://www.youtube.com/results?search_query={query}',
    hint: '{query} stands in for whatever follows the keyword and a space',
  },
]

export const USER_FIELDS: ReadonlyArray<ApiFieldSpec> = [
  {
    key: 'username',
    label: 'Username',
    input: 'text',
    required: true,
    hint: 'lowercase, no spaces; what is typed to sign in',
  },
  { key: 'name', label: 'Display name', input: 'text', placeholder: 'Ada Lovelace' },
  {
    key: 'password',
    label: 'Password',
    input: 'secret',
    required: true,
    hint: 'at least 12 characters; stored hashed and never returned',
  },
  {
    key: 'isAdmin',
    label: 'Administrator',
    input: 'toggle',
    hint: 'may open this panel and change what everyone sees',
  },
]

export const ENGINE_FIELDS: ReadonlyArray<ApiFieldSpec> = [
  { key: 'name', label: 'Name', input: 'text', required: true },
  {
    key: 'urlTemplate',
    label: 'Query URL',
    input: 'template',
    required: true,
    placeholder: 'https://example.com/search?q={query}',
    hint: '{query} stands in for the term',
  },
]

/**
 * Fields every connector row carries on top of the ones its own module declares. The label is
 * what tells two instances of the same connector apart in the list.
 * @param {number} defaultIntervalSeconds - What the module refreshes at when nothing is set
 * @returns {ReadonlyArray<ApiFieldSpec>} - Shared connector fields, the label first
 */
export function connectorFields(defaultIntervalSeconds: number): ReadonlyArray<ApiFieldSpec> {
  return [
    {
      key: 'label',
      label: 'Name',
      input: 'text',
      required: true,
      hint: 'what this instance is called here, so two of the same kind stay apart',
    },
    {
      key: 'syncIntervalSeconds',
      label: 'Refresh every',
      input: 'number',
      placeholder: String(defaultIntervalSeconds),
      hint: 'seconds between refreshes; at least 60',
    },
  ]
}
