import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import VerEstoque from './VerEstoque.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <VerEstoque isStandalone />
  </StrictMode>,
)
