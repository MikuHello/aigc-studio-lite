import { Info } from 'lucide-react';
import { GenerationSettingsPopover } from './GenerationSettingsPopover';

export function ReferenceHelp({ title, details }: { title: string; details: string[] }) {
  return (
    <span className="reference-help">
      <GenerationSettingsPopover
        title={title}
        label="参考说明"
        icon={<Info size={13} />}
        iconOnly
        width={320}
      >
        <div className="reference-help-content">
          {details.map((detail) => (
            <p key={detail}>{detail}</p>
          ))}
        </div>
      </GenerationSettingsPopover>
    </span>
  );
}
