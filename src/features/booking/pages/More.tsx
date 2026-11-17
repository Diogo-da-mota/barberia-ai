import { Link } from "react-router-dom"
import { usePathTab } from "@/lib/pathTab"
import { useQuery } from "@tanstack/react-query"
import { Settings } from "lucide-react"
import { AppearanceCard } from "@/app/AppearanceCard"
import { CatalogFrame } from "@/features/catalog/components/CatalogFrame"
import { useActiveBarbershop } from "@/features/catalog/hooks/useActiveBarbershop"
import { PAPEL_LABEL, type MyBarbershop, type Papel } from "@/features/home/domain"
import { CalendarCard } from "@/features/calendar/CalendarCard"
import { PreferencesCard } from "@/features/messaging/components/PreferencesCard"
import { PlanCard } from "@/features/plans/PlanCard"
import { DocumentsTab } from "@/features/settings/components/DocumentsTab"
import { ShopDataTab } from "@/features/settings/components/ShopDataTab"
import { fetchFiscal, fetchShopDetails } from "@/features/settings/api"
import { isMissingSchema } from "@/features/booking/domain"
import { Button } from "@/ui/button"
import { EmptyState, Panel } from "@/ui/finance"
import { Skeleton } from "@/ui/skeleton"
import { Tabs, TabsContent } from "@/ui/tabs"
import { TabbedHeader } from "@/ui/tabbed-header"
import { shopPath } from "@/lib/shopPaths"

const TABS = [
  { value: "dados", label: "Dados da barbearia", icon: Settings },
  { value: "documentos", label: "Documentos", icon: Settings },
] as const

/** Abas que já existiram em Mais e hoje moram em outra rota: links antigos continuam funcionando. */
const MOVED: Record<string, string> = {
  notificacoes: "/mensagens/notificacoes",
  horario: "/equipe",
  whatsapp: "/mais", // a integração WhatsApp mora no card ao lado do Contato comercial
}
const TAB_IDS = TABS.map((t) => t.value)

const DESCRIPTION = "Dados e informações da sua barbearia."

/**
 * Central de configurações. A gestão (proprietário e gerente) vê as quatro abas; os dados moram na própria barbearia e são lidos de um lugar só.
 * Equipe sem gestão e cliente comum veem a versão curta (quem sou, agenda do Google, aparência e novidades). A cor de destaque da barbearia
 * é configurada em Meu site; aqui só quem não alcança Meu site mantém o seletor de aparência.
 */
export function More() {
  const gate = useActiveBarbershop()
  const shop = gate.state === "ready" ? gate.active : null
  const manager = Boolean(shop && gate.state === "ready" && gate.canManage)
  const [tab, setTab] = usePathTab("/mais", TAB_IDS, MOVED)

  if (!manager || !shop) {
    return (
      <CatalogFrame full title="Mais" description={DESCRIPTION} header={<TabbedHeader photo={false} name="mais" icon={Settings} title="Mais" description="Dados e preferências da sua conta." />}>
        {gate.state === "none" && !gate.clientOnly && (
          <Panel>
            <EmptyState title="Você ainda não tem barbearia" description="Crie a sua para cadastrar serviços, equipe e receber reservas." action={<Button asChild className="h-11 md:h-10"><Link to="/barbearias/nova">Criar barbearia</Link></Button>} />
          </Panel>
        )}
        {shop && <ShopSummary shop={shop} />}
        {shop && shop.papel !== "cliente" && <CalendarCard shopId={shop.id} />}
        <AppearanceCard />
        {shop && <PreferencesCard shopId={shop.id} shopName={shop.nome} />}
      </CatalogFrame>
    )
  }

  return (
    <Tabs value={tab} onValueChange={setTab} className="contents">
      <CatalogFrame full title="Mais" description={DESCRIPTION} header={<TabbedHeader photo={false} name="mais" icon={Settings} title="Mais" description={DESCRIPTION} tabs={TABS} />}>
        <TabsContent value="dados"><DataTab shop={shop} /></TabsContent>
        <TabsContent value="documentos"><DocumentsTab shop={shop} owner={shop.papel === "proprietario"} /></TabsContent>
      </CatalogFrame>
    </Tabs>
  )
}

/** Versão curta para a equipe sem gestão: quem sou e em qual barbearia. Nada para editar. */
function ShopSummary({ shop }: { shop: MyBarbershop }) {
  return (
    <Panel className="flex flex-col gap-1 p-4 sm:p-5">
      <h2 className="font-display text-xl font-semibold tracking-wide">{shop.nome}</h2>
      <p className="text-sm text-muted-foreground">Seu papel: {PAPEL_LABEL[shop.papel as Papel]}. Endereço público: {shopPath(shop.slug)}</p>
      {shop.endereco && <p className="text-sm text-muted-foreground">{shop.endereco}</p>}
    </Panel>
  )
}

/** Aba Dados: formulário e, no fim da coluna da direita, o plano e o Google Calendar. Convites moram em Equipe. */
function DataTab({ shop }: { shop: MyBarbershop }) {
  const owner = shop.papel === "proprietario"
  const details = useQuery({ queryKey: ["shop-details", shop.id], queryFn: () => fetchShopDetails(shop.id) })
  const fiscal = useQuery({ queryKey: ["shop-fiscal", shop.id], queryFn: () => fetchFiscal(shop.id), enabled: owner })

  if (details.isError) {
    if (isMissingSchema(details.error)) return <EmptyState title="Dados indisponíveis" description="Este módulo ainda está sendo preparado no banco de dados." />
    return (
      <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm font-semibold">Não foi possível carregar os dados da barbearia</p>
        <Button variant="outline" className="h-11 md:h-10" onClick={() => void details.refetch()}>Tentar novamente</Button>
      </div>
    )
  }
  if (!details.data || (owner && !fiscal.data && !fiscal.isError)) {
    return <div role="status" aria-label="Carregando os dados" className="grid gap-4 xl:grid-cols-2"><Skeleton className="h-64 w-full rounded-card" /><Skeleton className="h-64 w-full rounded-card" /></div>
  }
  return (
    <div className="flex flex-col gap-4">
      <ShopDataTab key={shop.id} shop={shop} details={details.data} fiscal={fiscal.data ?? { supported: false, data: null }} owner={owner} extraRight={<><PlanCard shopId={shop.id} tz={shop.fuso ?? "America/Sao_Paulo"} /><CalendarCard shopId={shop.id} /></>} />
    </div>
  )
}
