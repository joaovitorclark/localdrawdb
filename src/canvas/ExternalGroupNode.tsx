import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { EXTERNAL_SOURCE_HANDLE, EXTERNAL_TARGET_HANDLE } from './pageFilter';
import { Chevron } from '../icons';

type ExternalGroupData = {
  label: string;
  tableCount: number;
  linkCount?: number;
};

function ExternalGroupNodeImpl({ data }: { data: ExternalGroupData }) {
  return (
    <div className="external-group-node" title="Grupo fora da página atual — marque no painel Páginas para expandir">
      <Handle
        type="target"
        position={Position.Left}
        id={EXTERNAL_TARGET_HANDLE}
        className="external-group-node__handle"
      />
      <Handle
        type="source"
        position={Position.Right}
        id={EXTERNAL_SOURCE_HANDLE}
        className="external-group-node__handle"
      />
      <div className="external-group-node__header">
        <Chevron dir="right" className="icon-inline external-group-node__toggle" size={14} />
        <span className="external-group-node__label">{data.label}</span>
      </div>
      <div className="external-group-node__meta">
        {data.linkCount ? `${data.linkCount} ligação(ões) · ` : ''}
        {data.tableCount} tabela(s) fora da página
      </div>
    </div>
  );
}

export const ExternalGroupNode = memo(ExternalGroupNodeImpl);
