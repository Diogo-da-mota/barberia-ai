import { Settings as SettingsIcon } from "lucide-react"
import { CatalogFrame, ShopGate } from "@/features/catalog/components/CatalogFrame"
import { useActiveBarbershop } from "@/features/catalog/hooks/useActiveBarbershop"
import { EmptyState, Panel } from "@/ui/finance"
import { TabbedHeader } from "@/ui/tabbed-header"
import { Tabs, TabsContent } from "@/ui/tabs"
import { AiKeyCard } from "../components/AiKeyCard"
import { AssistantChat } from "../components/AssistantChat"
import { LaraInstructionsCard } from "../components/LaraInstructionsCard"

// snip: uma aba só; quando entrar a segunda, usar usePathTab("/configuracoes", …) como em Mensagens.
const TABS = [{ value: "assistente", label: "Assistente" }] as const
const DESCRIPTION = "Ajustes da barbearia que valem para o sistema inteiro."

/** Configurações (gestão): por enquanto a aba Assistente, com a conexão de IA. */
export function Settings() {
  const gate = useActiveBarbershop()
  const manager = gate.state === "ready" && gate.canManage
  return (
    <Tabs value="assistente" className="contents">
      <CatalogFrame title="Configurações" description={DESCRIPTION} full header={<TabbedHeader photo={false} name="configuracoes" icon={SettingsIcon} title="Configurações" description={DESCRIPTION} tabs={manager ? TABS : undefined} />}>
        <ShopGate gate={gate}>
          {(shop, canManage) =>
            canManage ? (
              <TabsContent value="assistente" className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
                <AssistantChat shopId={shop.id} />
                <div className="flex min-w-0 flex-col gap-4">
                  <AiKeyCard shopId={shop.id} />
                  <LaraInstructionsCard shopId={shop.id} />
                </div>
              </TabsContent>
            ) : <Panel><EmptyState title="Área da gestão" description="Só o proprietário e o gerente mudam as configurações." /></Panel>
          }
        </ShopGate>
      </CatalogFrame>
    </Tabs>
  )
}
