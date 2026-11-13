import React from "react"
import ReactDOM from "react-dom/client"
import { RouterProvider } from "react-router-dom"
import { AppProviders } from "@/app/providers"
import { router } from "@/routes"
import { notifyAreaChange } from "@/lib/supabase"
import "@/index.css"

router.subscribe(notifyAreaChange) // cada área (painel/cliente) usa a sua sessão: avisa quando a navegação troca de área

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </React.StrictMode>
)
