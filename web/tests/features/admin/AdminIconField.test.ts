import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AdminIconField from '@/features/admin/AdminIconField.vue'
import AdminSelectField from '@/features/admin/AdminSelectField.vue'
import { resetIcons } from '@/composables/useIcons'
import { resetPortalConfig } from '@/composables/usePortalConfig'

const SQUARE = {
  id: 3,
  name: 'square',
  svg: '<svg viewBox="0 0 8 8"><path d="M0 0h8v8H0z"/></svg>',
}
const CIRCLE = { id: 4, name: 'circle', svg: '<svg viewBox="0 0 8 8"><circle r="4"/></svg>' }

interface FieldProps {
  modelValue: unknown
  accent?: string
}

/**
 * Answers the icon library, and the upload when one is offered.
 * @param {object} options - What the upload should answer with
 * @returns {ReturnType<typeof vi.fn>} - The stubbed fetch
 */
function stubApi(
  options: {
    upload?: { status: number; body: unknown }
    remove?: { status: number; body: unknown }
  } = {},
) {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const answer = options.upload ?? { status: 201, body: { icon: CIRCLE } }
      return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status }))
    }

    if (init?.method === 'DELETE') {
      const answer = options.remove ?? { status: 200, body: { ok: true } }
      return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status }))
    }

    return Promise.resolve(new Response(JSON.stringify({ icons: [SQUARE] })))
  })
}

/**
 * Mounts the field and waits for the library to arrive.
 * @param {FieldProps} props - Props to mount with
 * @returns {Promise<ReturnType<typeof mount>>} - The mounted field
 */
async function open(props: FieldProps = { modelValue: null }) {
  const wrapper = mount(AdminIconField, { props, attachTo: document.body })
  await vi.waitFor(() =>
    expect(wrapper.findComponent(AdminSelectField).props('options').length).toBeGreaterThan(1),
  )

  return wrapper
}

/**
 * Puts a chosen file on the field's own input, the way a picker would.
 * @param {HTMLInputElement} input - The field's own file input
 * @param {string | undefined} contents - Markup of the chosen file, or undefined for none
 * @returns {void}
 */
function chooseFile(input: HTMLInputElement, contents: string | undefined): void {
  const files = contents === undefined ? [] : [new File([contents], 'icon.svg')]
  Object.defineProperty(input, 'files', { configurable: true, value: files })
}

beforeEach(() => {
  resetIcons()
  resetPortalConfig()
  vi.restoreAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('fetch', stubApi())
})

afterEach(() => {
  resetIcons()
  resetPortalConfig()
  vi.unstubAllGlobals()
})

describe('choosing from the library', () => {
  it('offers every uploaded icon, with a way to choose none', async () => {
    const wrapper = await open()

    expect(wrapper.findComponent(AdminSelectField).props('options')).toEqual([
      { value: '', label: 'No icon' },
      { value: '3', label: 'square' },
    ])
  })

  it('draws the icon the row already holds', async () => {
    const wrapper = await open({ modelValue: 3 })

    expect(wrapper.find('.icon__preview').html()).toContain('M0 0h8v8H0z')
  })

  it('draws nothing for a row that holds no icon', async () => {
    const wrapper = await open({ modelValue: null })

    expect(wrapper.find('.icon__preview').text()).toBe('')
  })

  it('reports the id as a number, and null for the blank option', async () => {
    const wrapper = await open()
    const select = wrapper.findComponent(AdminSelectField)

    select.vm.$emit('update:modelValue', '3')
    select.vm.$emit('update:modelValue', '')

    expect(wrapper.emitted('update:modelValue')).toEqual([[3], [null]])
  })

  // The value is typed into a field and ends up in a style attribute, so anything that is not
  // plainly a colour is not one.
  it('tints the preview only with a plain hex colour', async () => {
    // jsdom rewrites a hex into its rgb form on the way into the style attribute.
    const tinted = await open({ modelValue: 3, accent: '#1E88E5' })
    expect(tinted.find('.icon__preview').attributes('style')).toBe('color: rgb(30, 136, 229);')

    const hostile = await open({ modelValue: 3, accent: 'red; background: url(https://evil.test)' })
    expect(hostile.find('.icon__preview').attributes('style')).toBeUndefined()
  })
})

describe('uploading one', () => {
  it('adds the stored icon to the library and selects it', async () => {
    const wrapper = await open()
    const input = wrapper.find('input[type="file"]').element as HTMLInputElement

    chooseFile(input, '<svg/>')
    await wrapper.find('input[type="file"]').trigger('change')
    await vi.waitFor(() => expect(wrapper.emitted('update:modelValue')).toBeTruthy())

    expect(wrapper.emitted('update:modelValue')).toEqual([[4]])
    await vi.waitFor(() =>
      expect(wrapper.findComponent(AdminSelectField).props('options')).toContainEqual({
        value: '4',
        label: 'circle',
      }),
    )
  })

  it('clears the input, so choosing the same file again still counts', async () => {
    const wrapper = await open()
    const input = wrapper.find('input[type="file"]').element as HTMLInputElement

    chooseFile(input, '<svg/>')
    await wrapper.find('input[type="file"]').trigger('change')
    await vi.waitFor(() => expect(wrapper.emitted('update:modelValue')).toBeTruthy())

    expect(input.value).toBe('')
  })

  it('does nothing at all when no file was chosen', async () => {
    const wrapper = await open()
    const input = wrapper.find('input[type="file"]').element as HTMLInputElement

    chooseFile(input, undefined)
    await wrapper.find('input[type="file"]').trigger('change')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  // A refused svg leaves the field as it was and says why, rather than selecting nothing.
  it('reports a refused upload and changes nothing', async () => {
    vi.stubGlobal('fetch', stubApi({ upload: { status: 400, body: { error: 'not an svg' } } }))
    const wrapper = await open()
    const input = wrapper.find('input[type="file"]').element as HTMLInputElement

    chooseFile(input, 'not markup')
    await wrapper.find('input[type="file"]').trigger('change')
    await vi.waitFor(() => expect(wrapper.text()).toContain('not an svg'))

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('deleting one', () => {
  it('offers nothing to delete while no icon is chosen', async () => {
    const wrapper = await open({ modelValue: null })

    expect(wrapper.find('.icon__delete').attributes('disabled')).toBeDefined()
  })

  // A delete takes the icon off every card that uses it, not only off the one being edited.
  it('asks a second time before it deletes', async () => {
    const wrapper = await open({ modelValue: 3 })

    await wrapper.find('.icon__delete').trigger('click')

    expect(wrapper.find('.icon__delete').text()).toBe('Press again to delete')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.findComponent(AdminSelectField).props('options')).toHaveLength(2)
  })

  it('deletes on the second press and clears the field', async () => {
    const wrapper = await open({ modelValue: 3 })

    await wrapper.find('.icon__delete').trigger('click')
    await wrapper.find('.icon__delete').trigger('click')
    await vi.waitFor(() => expect(wrapper.emitted('update:modelValue')).toBeTruthy())

    expect(wrapper.emitted('update:modelValue')).toEqual([[null]])
    expect(wrapper.findComponent(AdminSelectField).props('options')).toEqual([
      { value: '', label: 'No icon' },
    ])
  })

  // Armed against the icon that was chosen when it was armed: switching the picker in between
  // would otherwise delete whatever the second press happened to land on.
  it('disarms when the chosen icon changes', async () => {
    const wrapper = await open({ modelValue: 3 })

    await wrapper.find('.icon__delete').trigger('click')
    await wrapper.setProps({ modelValue: null })

    expect(wrapper.find('.icon__delete').text()).toBe('Delete icon')
  })

  // A pending delete must not be completed later by a click aimed at something else.
  it('disarms once focus leaves the field', async () => {
    const wrapper = await open({ modelValue: 3 })
    const outside = document.createElement('button')
    document.body.append(outside)

    await wrapper.find('.icon__delete').trigger('click')
    await wrapper.find('.icon').trigger('focusout', { relatedTarget: outside })

    expect(wrapper.find('.icon__delete').text()).toBe('Delete icon')
    outside.remove()
  })

  it('stays armed while focus moves within the field', async () => {
    const wrapper = await open({ modelValue: 3 })
    const inside = wrapper.find('input[type="file"]').element

    await wrapper.find('.icon__delete').trigger('click')
    await wrapper.find('.icon').trigger('focusout', { relatedTarget: inside })

    expect(wrapper.find('.icon__delete').text()).toBe('Press again to delete')
  })

  // A refused upload leaves the selection alone, so nothing else here would disarm it.
  it('disarms when an upload is offered instead', async () => {
    const wrapper = await open({ modelValue: 3 })
    const input = wrapper.find('input[type="file"]').element as HTMLInputElement

    await wrapper.find('.icon__delete').trigger('click')
    chooseFile(input, '<svg/>')
    await wrapper.find('input[type="file"]').trigger('change')

    expect(wrapper.find('.icon__delete').text()).toBe('Delete icon')
  })

  // The button's own label changes under the focus already on it, which is not reliably read out.
  it('announces the armed state to assistive technology', async () => {
    const wrapper = await open({ modelValue: 3 })

    expect(wrapper.find('[role="status"]').exists()).toBe(false)

    await wrapper.find('.icon__delete').trigger('click')

    expect(wrapper.find('[role="status"]').text()).toBe('Press again to delete')
  })

  it('keeps the icon and says why when the server refused', async () => {
    vi.stubGlobal('fetch', stubApi({ remove: { status: 404, body: { error: 'icon not found' } } }))
    const wrapper = await open({ modelValue: 3 })

    await wrapper.find('.icon__delete').trigger('click')
    await wrapper.find('.icon__delete').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('icon not found'))

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.findComponent(AdminSelectField).props('options')).toHaveLength(2)
    // a refused delete leaves nothing armed, so the next press asks again
    expect(wrapper.find('.icon__delete').text()).toBe('Delete icon')
  })
})
