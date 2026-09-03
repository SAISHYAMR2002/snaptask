import { useOutletContext, useParams } from 'react-router-dom'
import { PageHeader } from '../components/AppLayout'
import PrivateNotes from '../components/PrivateNotes'
import { Pill, Spinner } from '../components/ui'

/**
 * All of my private notes in this workspace, in one place.
 *
 * The per-person view lives on each member's report; this is the page you open
 * before a round of 1:1s, or when a reminder fires and you want the context.
 */
export default function Notes() {
  const { id } = useParams()
  const { workspace, showError } = useOutletContext()

  if (!workspace) {
    return <><PageHeader title="My notes" /><div className="grid flex-1 place-items-center"><Spinner /></div></>
  }

  return (
    <>
      <PageHeader title="My notes" subtitle={workspace.name} badge={<Pill tone="brand">PRIVATE</Pill>} />
      <div className="flex flex-col gap-4 overflow-y-auto p-4 sm:p-7">
        <PrivateNotes workspaceId={id} showError={showError} />
        <div className="pb-2" />
      </div>
    </>
  )
}
