import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'
import { prefsStore } from './lib/prefsStore'

// Put the saved look on the page before anything renders. (The script in index.html
// already did, before first paint; this keeps the two in step if they ever differ.)
prefsStore.apply()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary fullscreen title="Something went wrong">
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
