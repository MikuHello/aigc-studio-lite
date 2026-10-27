import { useAvailableModels } from '@/store/appStore';
import { useAppStore } from '@/store/appStore';
import { ModelPicker } from './ModelPicker';

export function CreationModelPicker({
  value,
  onManage,
}: {
  value: string | null;
  onManage: () => void;
}) {
  const models = useAvailableModels();
  const select = useAppStore((state) => state.setActiveCreationModel);
  return (
    <ModelPicker
      models={models}
      value={value}
      kind="visual"
      label="创作模型"
      compact
      onManage={onManage}
      onChange={(key) => {
        select(key);
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLButtonElement>('.studio-composer-wrap:not([hidden]) .model-trigger')
            ?.focus(),
        );
      }}
    />
  );
}
