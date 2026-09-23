import { useRef, useState, type ReactNode } from 'react'

import { Icon } from '../../components/Icon'
import { saveMedicine, saveSettings, type SettingsChanges } from '../../data/commands'
import { DiaryRepository, ValidationCommandError } from '../../data/repository'
import type { DiaryFacts, SavedMedicine } from '../../domain/types'
import { AppShell, PageHeader } from '../../app/AppShell'
import { routeHref, type AppRoute } from '../../app/Router'
import { appVersion, buildLabel } from '../../app/buildInfo'

type SettingsRoute = Extract<AppRoute, { kind: 'page'; page: 'settings' }>

interface SettingsPageProps {
  route: SettingsRoute
  facts: DiaryFacts
  repository: DiaryRepository
}

type WriteOperation = (facts: DiaryFacts) => Promise<unknown>

function errorMessage(error: unknown): string {
  if (error instanceof ValidationCommandError) return error.issues.map((issue) => issue.message).join(' ')
  if (error instanceof Error) return error.message
  return 'The diary could not be saved. Your changes are still here; try again.'
}

function SettingsSection({
  title,
  children,
  caption,
}: {
  title: string
  children: ReactNode
  caption?: string
}) {
  const headingId = `settings-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <section className="settings-section" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      {children}
      {caption ? <p className="field-hint settings-caption">{caption}</p> : null}
    </section>
  )
}

export function SettingsPage({ route, facts, repository }: SettingsPageProps) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | undefined>()
  const [medicineName, setMedicineName] = useState('')
  const [doseText, setDoseText] = useState('')
  const [initialMedicineName, setInitialMedicineName] = useState('')
  const [initialDoseText, setInitialDoseText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pendingWrites, setPendingWrites] = useState(0)
  const writeQueue = useRef(Promise.resolve())
  const inFlightKeys = useRef(new Set<string>())

  const activeMedicines = facts.medicines.filter((medicine) => !medicine.archived)
  const archivedMedicines = facts.medicines.filter((medicine) => medicine.archived)

  const enqueueWrite = (key: string, operation: WriteOperation, onSuccess?: () => void) => {
    if (inFlightKeys.current.has(key)) return
    inFlightKeys.current.add(key)
    const task = writeQueue.current
      .catch(() => undefined)
      .then(async () => {
        setPendingWrites((count) => count + 1)
        try {
          const currentFacts = repository.snapshot().facts
          if (!currentFacts) throw new Error('The diary is not ready to save changes.')
          await operation(currentFacts)
          onSuccess?.()
        } catch (writeError) {
          setError(errorMessage(writeError))
        } finally {
          setPendingWrites((count) => Math.max(0, count - 1))
          inFlightKeys.current.delete(key)
        }
      })
    writeQueue.current = task.then(() => undefined)
  }

  const updateSettings = (key: string, changes: SettingsChanges) => {
    setError(null)
    enqueueWrite(`${key}:${JSON.stringify(changes)}`, (currentFacts) =>
      saveSettings(repository, changes, { expectedRevision: currentFacts.metadata.revision }),
    )
  }

  const openNewMedicine = () => {
    setError(null)
    setEditingId(undefined)
    setMedicineName('')
    setDoseText('')
    setInitialMedicineName('')
    setInitialDoseText('')
    setEditorOpen(true)
  }

  const openMedicine = (medicine: SavedMedicine) => {
    setError(null)
    setEditingId(medicine.id)
    setMedicineName(medicine.name)
    setDoseText(medicine.doseText)
    setInitialMedicineName(medicine.name)
    setInitialDoseText(medicine.doseText)
    setEditorOpen(true)
  }

  const closeMedicineEditor = () => {
    setEditorOpen(false)
    setEditingId(undefined)
    setMedicineName('')
    setDoseText('')
    setInitialMedicineName('')
    setInitialDoseText('')
  }

  const saveMedicineForm = () => {
    const name = medicineName.trim()
    const dose = doseText.trim()
    if (name === '' || dose === '') {
      setError('Enter a medicine name and dose.')
      return
    }

    setError(null)
    enqueueWrite(
      'medicine-form',
      async (currentFacts) => {
        const existing = editingId ? currentFacts.medicines.find((medicine) => medicine.id === editingId) : undefined
        await saveMedicine(
          repository,
          {
            ...(editingId ? { id: editingId } : {}),
            name,
            doseText: dose,
            archived: existing?.archived ?? false,
          },
          { expectedRevision: currentFacts.metadata.revision },
        )
      },
      closeMedicineEditor,
    )
  }

  const archiveMedicine = (medicine: SavedMedicine) => {
    setError(null)
    enqueueWrite('archive-medicine', (currentFacts) => {
      const current = currentFacts.medicines.find((candidate) => candidate.id === medicine.id)
      if (!current) throw new Error('That medicine is no longer available.')
      return saveMedicine(
        repository,
        { ...current, archived: true },
        { expectedRevision: currentFacts.metadata.revision },
      )
    })
  }

  const restoreMedicine = (medicine: SavedMedicine) => {
    setError(null)
    enqueueWrite('restore-medicine', (currentFacts) => {
      const current = currentFacts.medicines.find((candidate) => candidate.id === medicine.id)
      if (!current) throw new Error('That medicine is no longer available.')
      return saveMedicine(
        repository,
        { ...current, archived: false },
        { expectedRevision: currentFacts.metadata.revision },
      )
    })
  }

  const medicineEditorDirty =
    editorOpen && (medicineName !== initialMedicineName || doseText !== initialDoseText)

  return (
    <AppShell route={route}>
      <PageHeader
        title="Settings"
        backHref={routeHref({ kind: 'tab', tab: route.tab })}
        dirty={medicineEditorDirty}
        onDiscard={closeMedicineEditor}
      />
      <div className="settings-page">
        {error ? <p className="form-error" role="alert">{error}</p> : null}

        <SettingsSection title="Pain entry" caption="Used by default. You can still switch while entering.">
          <div className="segmented-control settings-segmented" role="group" aria-label="Pain entry default">
            <button
              type="button"
              aria-pressed={facts.settings.painEntryDefault === 'numeric'}
              onClick={() => updateSettings('pain-entry-default', { painEntryDefault: 'numeric' })}
            >
              0 to 10
            </button>
            <button
              type="button"
              aria-pressed={facts.settings.painEntryDefault === 'verbal'}
              onClick={() => updateSettings('pain-entry-default', { painEntryDefault: 'verbal' })}
            >
              Words
            </button>
          </div>
        </SettingsSection>

        <SettingsSection title="Medicines" caption="The default is filled in when you log a dose.">
          <div className="settings-panel">
            {activeMedicines.length === 0 ? (
              <p className="settings-empty">{archivedMedicines.length === 0 ? 'No saved medicines yet.' : 'No active medicines.'}</p>
            ) : (
              activeMedicines.map((medicine) => {
                const isDefault = facts.settings.defaultMedicineId === medicine.id
                return (
                  <div className="settings-medicine-row" key={medicine.id}>
                    <button
                      className="settings-medicine-select"
                      type="button"
                      aria-pressed={isDefault}
                      aria-label={isDefault ? `${medicine.name}, default medicine` : `Make ${medicine.name} the default`}
                      onClick={() => updateSettings(`default-medicine-${medicine.id}`, { defaultMedicineId: medicine.id })}
                    >
                      <span>
                        <strong>{medicine.name}</strong>
                        <small>{medicine.doseText}</small>
                      </span>
                      {isDefault ? <span className="saved-pill">Default</span> : null}
                    </button>
                    <button
                      className="text-action settings-row-action"
                      type="button"
                      aria-label={`Edit ${medicine.name}`}
                      onClick={() => openMedicine(medicine)}
                    >
                      Edit
                    </button>
                    <button
                      className="text-action settings-row-action"
                      type="button"
                      aria-label={`Archive ${medicine.name}`}
                      onClick={() => archiveMedicine(medicine)}
                    >
                      Archive
                    </button>
                  </div>
                )
              })
            )}
            <button className="settings-add" type="button" onClick={openNewMedicine}>
              <Icon name="plus" size={18} />
              Add a medicine
            </button>
          </div>
          {editorOpen ? (
            <section className="form-card settings-editor" aria-labelledby="medicine-editor-heading">
              <p className="section-kicker">{editingId ? 'Edit medicine' : 'New medicine'}</p>
              <h3 id="medicine-editor-heading">{editingId ? 'Update the saved name and dose.' : 'Add a saved medicine.'}</h3>
              <label className="field-label" htmlFor="medicine-name">
                Medicine name
                <input id="medicine-name" value={medicineName} onChange={(event) => setMedicineName(event.target.value)} />
              </label>
              <label className="field-label" htmlFor="medicine-dose">
                Dose
                <input id="medicine-dose" value={doseText} onChange={(event) => setDoseText(event.target.value)} />
              </label>
              <div className="inline-actions">
                <button className="primary-action" type="button" onClick={saveMedicineForm} disabled={pendingWrites > 0}>
                  Save medicine
                </button>
                <button className="secondary-action" type="button" onClick={closeMedicineEditor} disabled={pendingWrites > 0}>
                  Cancel
                </button>
              </div>
            </section>
          ) : null}
          <div className="settings-archived">
            <h3>Archived medicines</h3>
            {archivedMedicines.length === 0 ? (
              <p className="settings-empty">No archived medicines.</p>
            ) : (
              archivedMedicines.map((medicine) => (
                <div className="settings-medicine-row settings-medicine-row--archived" key={medicine.id}>
                  <span>
                    <strong>{medicine.name}</strong>
                    <small>{medicine.doseText}</small>
                  </span>
                  <button
                    className="text-action settings-row-action"
                    type="button"
                    aria-label={`Restore ${medicine.name}`}
                    onClick={() => restoreMedicine(medicine)}
                  >
                    Restore
                  </button>
                </div>
              ))
            )}
          </div>
        </SettingsSection>

        <SettingsSection title="Follow-up check" caption="Shown on Today only. The app can’t send notifications.">
          <div className="settings-panel">
            <div className="settings-switch-row">
              <span id="follow-up-label">Check how a dose worked</span>
              <button
                type="button"
                role="switch"
                aria-checked={facts.settings.followUpEnabled}
                aria-labelledby="follow-up-label"
                onClick={() => updateSettings('follow-up-enabled', { followUpEnabled: !facts.settings.followUpEnabled })}
              >
                <span className="settings-switch" aria-hidden="true">
                  <span className="settings-switch__knob" />
                </span>
              </button>
            </div>
            {facts.settings.followUpEnabled ? (
              <div className="settings-interval">
                <span id="follow-up-interval-label">Check after</span>
                <div className="segmented-control settings-segmented" role="group" aria-labelledby="follow-up-interval-label">
                  {[30, 60, 90, 120].map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      aria-pressed={facts.settings.followUpIntervalMinutes === minutes}
                      onClick={() => updateSettings('follow-up-interval', { followUpIntervalMinutes: minutes as 30 | 60 | 90 | 120 })}
                    >
                      {minutes} min
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </SettingsSection>

        <SettingsSection title="Your data" caption="Your diary is stored only on this device — no account, no cloud. The app can’t tell whether a backup file was saved.">
          <div className="settings-panel">
            <a className="settings-data-link" href={routeHref({ kind: 'page', page: 'backup', tab: route.tab })}>
              <strong>Make backup</strong>
              <span>{facts.metadata.lastExportGeneratedAt ? `File made ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(facts.metadata.lastExportGeneratedAt))}` : 'No file made yet'}</span>
            </a>
            <a className="settings-data-link" href={routeHref({ kind: 'page', page: 'restore', tab: route.tab })}>
              <strong>Restore from backup</strong>
              <span>Review a file before replacing this diary</span>
            </a>
          </div>
        </SettingsSection>

        <SettingsSection title="Device diagnostics" caption="Useful when checking an installation on your iPhone.">
          <div className="settings-panel settings-meta" aria-label="App version and build">
            <div><span>App version</span><strong>{appVersion}</strong></div>
            <div><span>Build</span><strong>{buildLabel}</strong></div>
          </div>
        </SettingsSection>
      </div>
    </AppShell>
  )
}
