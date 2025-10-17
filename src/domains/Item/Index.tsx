// domains/Item/Index.tsx
import { useQuestContext } from '../Context/ContextProvider';
import { CampaignActions } from '../Campaign/CampaignActions';

export function ItemIndex() {
  const context = useQuestContext();
  const campaign = CampaignActions.getActiveCampaign(context);

  return (
<div></div>
  );
}