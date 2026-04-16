import React from 'react'
import ReactDOM from 'react-dom/client'
import AppGuard from './AppGuard.jsx'
import { AuthProvider } from './AuthProvider.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <AppGuard />
    </AuthProvider>
  </React.StrictMode>,
)
