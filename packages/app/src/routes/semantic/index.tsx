/**
 * /semantic route — the scoped symbol tables, name resolution and type checking
 * of the semantic pass, replayed from the `sem.analyze` trace.
 */
import { PhasePage } from '../../components/PhasePage';
import { SemanticView } from './SemanticView';

export default function SemanticPhaseRoute() {
  return (
    <PhasePage phase="semantic">
      <SemanticView />
    </PhasePage>
  );
}
