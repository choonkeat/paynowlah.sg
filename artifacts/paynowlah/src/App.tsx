import NotFound from '@/pages/not-found';
import Home from '@/pages/home';

function App() {
  // Navigation is ordinary GET links/forms, so a client-side router is unnecessary.
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const path = window.location.pathname.replace(/\/$/, '');
  return path === base ? <Home /> : <NotFound />;
}

export default App;
