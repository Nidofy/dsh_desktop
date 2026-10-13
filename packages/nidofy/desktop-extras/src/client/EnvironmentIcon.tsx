/** Semantic aliases over the shared UI icon library. */
import {
  IconPanelLeftOutlineRegular, IconEditOutlineRegular, IconBranchOutlineRegular,
  IconGlobeOutlineRegular, IconCodeOutlineRegular, IconFolderOpenOutlineRegular,
  IconShieldOutlineRegular, IconSparkleRegular, IconLinkOutlineRegular, IconRefreshOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
type Glyph = 'environment' | 'changes' | 'branch' | 'local' | 'builds' | 'artifacts' | 'protection' | 'pets' | 'connections' | 'refresh'
const icons = {
  environment: IconPanelLeftOutlineRegular, changes: IconEditOutlineRegular, branch: IconBranchOutlineRegular,
  local: IconGlobeOutlineRegular, builds: IconCodeOutlineRegular, artifacts: IconFolderOpenOutlineRegular,
  protection: IconShieldOutlineRegular, pets: IconSparkleRegular, connections: IconLinkOutlineRegular, refresh: IconRefreshOutlineRegular,
} satisfies Record<Glyph, typeof IconPanelLeftOutlineRegular>
export function Icon({ kind }: { kind: Glyph }) {
  const Glyph = icons[kind]
  return <Glyph size={16} />
}
