// App.tsx
import { HashRouter, Routes, Route } from "react-router-dom";
import { Home } from "./domains/Context/Index";
import { CampaignIndex } from "./domains/Campaign/Index";
import { ContextProvider } from "./domains/Context/ContextProvider";
import { ActionServiceProvider } from "./services/Actions/ActionServiceProvider";
import { CampaignView } from "./domains/Campaign/CampaignView";
function App() {
	return (
		<ContextProvider>
			<ActionServiceProvider>
				<HashRouter>
					<Routes>
						<Route path="/" element={<Home />} />
						<Route path="/campaigns" element={<CampaignIndex />} />
						<Route path="/:identifier" element={<CampaignView />} />
					</Routes>
				</HashRouter>
			</ActionServiceProvider>
		</ContextProvider>
	);
}

export default App;
