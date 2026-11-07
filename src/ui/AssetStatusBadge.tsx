/**
 * A small chip saying whether other devices can load an asset: "On this device", "Uploading",
 * "Shared" or "Upload failed" with a retry button. Renders nothing for assets this session did not
 * upload (built-ins, pack assets, earlier sessions). Meant for asset cards; panels opt in.
 */
import { retryAsset, useAssetStatus, type AssetStatus } from '@/assets'

const LABEL: Record<AssetStatus, string> = {
  local: 'On this device',
  uploading: 'Uploading…',
  shared: 'Shared',
  failed: 'Upload failed',
}

const COLOR: Record<AssetStatus, string> = {
  local: 'var(--muted)',
  uploading: 'var(--muted)',
  shared: 'var(--ok)',
  failed: 'var(--bad)',
}

export function AssetStatusBadge({ sha256, canRetry = true }: { sha256: string | null | undefined; canRetry?: boolean }) {
  const info = useAssetStatus(sha256)
  if (!info || !sha256) return null
  const title = info.error ? `${LABEL[info.status]}: ${info.error}` : LABEL[info.status]
  return (
    <span className={`asset-status asset-status--${info.status}`} title={title} role="status"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-xs)', color: COLOR[info.status] }}>
      {LABEL[info.status]}
      {info.status === 'failed' && canRetry && (
        <button type="button" className="link" onClick={() => retryAsset(sha256)} style={{ font: 'inherit' }}>Retry</button>
      )}
    </span>
  )
}
