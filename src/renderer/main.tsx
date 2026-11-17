import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { setDisplayLocale } from '../shared/locale'

// Dates and numbers follow the locale the main process read from the OS.
setDisplayLocale((window as unknown as { electronAPI?: { locale?: string } }).electronAPI?.locale)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
