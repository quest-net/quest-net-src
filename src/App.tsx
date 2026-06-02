// App.tsx
import { HashRouter, Routes, Route } from "react-router-dom";
import { Home } from "./domains/Context/Index";
import { CampaignIndex } from "./domains/Campaign/Index";
import { ContextProvider } from "./domains/Context/ContextProvider";
import { ActionServiceProvider } from "./services/Actions/ActionServiceProvider";
import { CampaignView } from "./domains/Campaign/CampaignView";
import { AppSettingEdit } from "./domains/AppSetting/Edit";
import { Wiki } from "./domains/Wiki/Wiki";
import { useIdleRefresh } from "./hooks/useIdleRefresh";
import { isAnyFormDirty } from "./utils/formDirtyRegistry";
import { StorageQuotaErrorOverlay } from "./components/StorageQuotaErrorOverlay";

// Reloads the tab when the user returns after a long absence, resetting any
// browser/GPU-level accumulation and applying pending updates/migrations.
// Skips the reload while any form has unsaved changes so work isn't discarded.
function IdleRefresh() {
	useIdleRefresh({ canRefresh: () => !isAnyFormDirty() });
	return null;
}

function App() {
	return (
		<ContextProvider>
			<ActionServiceProvider>
				<StorageQuotaErrorOverlay />
				<IdleRefresh />
				<HashRouter>
					<Routes>
						<Route path="/" element={<Home />} />
						<Route path="/campaigns" element={<CampaignIndex />} />
						<Route path="/settings" element={<AppSettingEdit />} />
						<Route path="/wiki/*" element={<Wiki />} />
						<Route path="/:identifier" element={<CampaignView />} />
					</Routes>
				</HashRouter>
			</ActionServiceProvider>
		</ContextProvider>
	);
}

export default App;
