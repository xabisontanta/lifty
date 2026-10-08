import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AppProvider } from './store/app'
import { ToastProvider } from './components/ui/kit'
import { registerLiveApi } from './services/api'
import { liveApi } from './services/liveApi'
import { initMonitoring } from './services/monitoring'
import { hasSupabase } from './lib/env'
import './styles/tokens.css'
import './styles/global.css'

initMonitoring()
if (hasSupabase) registerLiveApi(liveApi)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
)
