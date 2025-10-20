// components/inputs/StatDefinitionEditor.tsx
import { StatDefinition } from '../../domains/CampaignSetting/CampaignSetting';
import { useFormReadOnly } from '../Form/Form';

interface StatDefinitionsEditorProps {
  stats: StatDefinition[];
  onChange: (stats: StatDefinition[]) => void;
  readOnly?: boolean; // Optional - will use FormContext if available
}

export function StatDefinitionsEditor({ stats, onChange, readOnly: readOnlyProp }: StatDefinitionsEditorProps) {
  // Try to get readOnly from FormContext, fall back to prop
  const contextReadOnly = useFormReadOnly();
  const readOnly = readOnlyProp ?? contextReadOnly;
  
  const handleAdd = () => {
    const newStat: StatDefinition = {
      Id: crypto.randomUUID(),
      Name: 'New Stat',
      Color: '#888888',
      Max: 100
    };
    onChange([...stats, newStat]);
  };

  const handleDelete = (id: string) => {
    onChange(stats.filter(s => s.Id !== id));
  };

  const handleUpdate = (id: string, field: keyof StatDefinition, value: any) => {
    onChange(stats.map(s => 
      s.Id === id ? { ...s, [field]: value } : s
    ));
  };

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Color</th>
              <th>Max</th>
              <th>Regen Rate</th>
              {!readOnly && <th></th>}
            </tr>
          </thead>
          <tbody>
            {stats.map(stat => (
              <tr key={stat.Id}>
                <td>
                  <input
                    type="text"
                    value={stat.Name}
                    onChange={(e) => handleUpdate(stat.Id, 'Name', e.target.value)}
                    className="input input-neutral input-sm w-full"
                    disabled={readOnly}
                  />
                </td>
                <td>
                  <input
                    type="color"
                    value={stat.Color}
                    onChange={(e) => handleUpdate(stat.Id, 'Color', e.target.value)}
                    className="input-sm h-10 w-20"
                    disabled={readOnly}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    value={stat.Max}
                    onChange={(e) => handleUpdate(stat.Id, 'Max', Number(e.target.value))}
                    className="input input-neutral input-sm w-24"
                    min={1}
                    disabled={readOnly}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    value={stat.RegenRate ?? ''}
                    onChange={(e) => handleUpdate(stat.Id, 'RegenRate', e.target.value ? Number(e.target.value) : undefined)}
                    placeholder="None"
                    className="input input-neutral input-sm w-24"
                    disabled={readOnly}
                  />
                </td>
                {!readOnly && (
                  <td>
                    <button
                      onClick={() => handleDelete(stat.Id)}
                      className="btn btn-error btn-sm btn-square"
                      title="Delete stat"
                    >
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <button onClick={handleAdd} className="btn btn-outline btn-sm">
          + Add Stat
        </button>
      )}
    </div>
  );
}