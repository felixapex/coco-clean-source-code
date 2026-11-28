import { HomePage } from './pages/HomePage.js';
import { CollectionsBedroomPage } from './pages/CollectionsBedroomPage.js';
import { CollectionsTablesPage } from './pages/CollectionsTablesPage.js';
import { CollectionsDiningRoomPage } from './pages/CollectionsDiningRoomPage.js';
import { CollectionsLivingRoomPage } from './pages/CollectionsLivingRoomPage.js';
import { CollectionsLuxuryDiningPage } from './pages/CollectionsLuxuryDiningPage.js';
import './index.css';

declare const React: any;
declare const ReactDOM: any;

const routes: Record<string, any> = {
  "/": HomePage,
  "/collections/bedroom": CollectionsBedroomPage,
  "/collections/tables": CollectionsTablesPage,
  "/collections/dining-room": CollectionsDiningRoomPage,
  "/collections/living-room": CollectionsLivingRoomPage,
  "/collections/luxury-dining": CollectionsLuxuryDiningPage,
};
const Page = routes[window.location.pathname] ?? HomePage;
const root = document.getElementById('root');
if (!root) throw new Error('Missing #root mount point');
ReactDOM.createRoot(root).render(React.createElement(Page));
