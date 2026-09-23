import packageJson from '../../package.json'

export const appVersion = packageJson.version
export const buildLabel = import.meta.env.VITE_BUILD_LABEL ?? import.meta.env.MODE
