export type AppearancePreference = 'system' | 'light' | 'dark'

const APPEARANCE_STORAGE_KEY = 'headache-diary-appearance'

export function readAppearancePreference(): AppearancePreference {
  try {
    const stored = window.localStorage.getItem(APPEARANCE_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function writeAppearancePreference(preference: AppearancePreference): void {
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, preference)
  } catch {
    // The current session still applies the choice when browser storage is unavailable.
  }
}
