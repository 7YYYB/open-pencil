import { useStore } from '@nanostores/vue'
import { invoke } from '@tauri-apps/api/core'
import { computed, watch } from 'vue'

import { locale } from '@open-pencil/vue/i18n'

import { isCloudBinding } from '@/app/cloud/integration'
import { DONATION_URL } from '@/app/donation'
import { useEditorStore } from '@/app/editor/active-store'
import { showsDocument } from '@/app/tabs'
import { isTauri } from '@/app/tauri/env'

import type { AppMenuFeature } from './schema'

const store = useEditorStore()

const available: Record<AppMenuFeature, () => boolean> = {
  // Home and a New file tab hold no document, so they leave out what edits or shows one.
  document: () => showsDocument(),
  // Cloud and storage documents always save; auto-save is a choice only for a file on disk.
  'local-file': () => store.hasWritableSource() && !store.getStorageBinding(),
  // Version history lives on the Cloud server that keeps the document.
  'cloud-document': () => isCloudBinding(store.getStorageBinding()),
  donation: () => DONATION_URL !== null
}

/** Whether a menu item that waits for a feature shows; items without one always do. */
export function menuFeatureAvailable(feature: AppMenuFeature | undefined): boolean {
  return feature === undefined || available[feature]()
}

const availableFeatures = computed(() =>
  (Object.keys(available) as AppMenuFeature[]).filter((feature) => available[feature]())
)

/** Rebuilds the desktop menu when its visible features or the interface language change. */
export function watchNativeMenuFeatures(): () => void {
  const menuLocale = useStore(locale)
  return watch(
    [availableFeatures, menuLocale],
    ([features, locale]) => {
      if (!isTauri()) return
      invoke('set_native_menu_features', { features, locale }).catch((error: unknown) => {
        console.warn('[Menu] Failed to update the native menu', error)
      })
    },
    { immediate: true }
  )
}
